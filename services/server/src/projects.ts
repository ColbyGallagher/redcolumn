import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { UserProfile } from './auth.ts';
import type { Database, ProjectRole } from './db.ts';
import { createInvite, isValidEmail } from './invites.ts';

export const PROJECT_ROLES: readonly ProjectRole[] = ['project_admin', 'reviewer', 'viewer'] as const;

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === 'project_admin' || value === 'reviewer' || value === 'viewer';
}

const DEFAULT_PROJECT_STATUSES: readonly { id: string; name: string; category: 'open' | 'closed' | 'void'; position: number }[] = [
  { id: 'open', name: 'Open', category: 'open', position: 0 },
  { id: 'actioned', name: 'Actioned', category: 'open', position: 1 },
  { id: 'answered', name: 'Answered', category: 'open', position: 2 },
  { id: 'closed', name: 'Closed', category: 'closed', position: 3 },
  { id: 'void', name: 'Not applicable', category: 'void', position: 4 },
];

export interface ProjectSummary {
  id: string;
  name: string;
  number: string | null;
  description: string | null;
  role: ProjectRole;
  createdAt: string;
}

export interface ProjectMemberRecord {
  userId: string;
  email: string;
  name: string;
  role: ProjectRole;
  state: 'invited' | 'active';
  createdAt: string;
}

export interface PendingProjectInvite {
  id: string;
  email: string | null;
  name: string | null;
  role: ProjectRole;
  expiresAt: string;
  createdAt: string;
}

export type ProjectError = {
  ok: false;
  status: number;
  code:
    | 'invalid_request'
    | 'invalid_role'
    | 'invalid_email'
    | 'invalid_scope'
    | 'not_found'
    | 'forbidden'
    | 'member_not_found'
    | 'last_admin';
};

export type CreateProjectResult =
  | {
      ok: true;
      project: ProjectSummary;
      scope: {
        id: string;
        projectId: string;
        kind: 'review' | 'session';
        name: string;
        state: 'open' | 'locked' | 'closed' | null;
        createdAt: string;
      };
      lane: {
        id: string;
        name: string;
      };
      role: ProjectRole;
    }
  | ProjectError;

export type GetProjectResult = { ok: true; project: ProjectSummary; role: ProjectRole } | ProjectError;

export type ListProjectMembersResult =
  | {
      ok: true;
      role: ProjectRole;
      members: ProjectMemberRecord[];
      invites: PendingProjectInvite[];
    }
  | ProjectError;

export type CreateProjectInviteResult =
  | {
      ok: true;
      invite: PendingProjectInvite;
      token: string;
      inviteUrl: string;
    }
  | ProjectError;

export type UpdateMemberRoleResult = { ok: true; member: ProjectMemberRecord } | ProjectError;
export type RemoveMemberResult = { ok: true; userId: string } | ProjectError;

const MAX_NAME_LENGTH = 200;
const MAX_NUMBER_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 2000;

export async function createProject(
  db: Kysely<Database>,
  actor: UserProfile,
  input: { name: string; number?: string | null; description?: string | null },
): Promise<CreateProjectResult> {
  const name = input.name.trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, status: 400, code: 'invalid_request' };
  }

  const rawNumber = input.number === undefined || input.number === null ? null : input.number.trim();
  const number = rawNumber && rawNumber.length > 0 ? rawNumber : null;
  if (number !== null && number.length > MAX_NUMBER_LENGTH) {
    return { ok: false, status: 400, code: 'invalid_request' };
  }

  const rawDescription = input.description === undefined || input.description === null ? null : input.description.trim();
  const description = rawDescription && rawDescription.length > 0 ? rawDescription : null;
  if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, status: 400, code: 'invalid_request' };
  }

  const projectId = randomUUID();
  const scopeId = randomUUID();
  const laneId = randomUUID();
  const now = new Date();

  const created = await db.transaction().execute(async (trx) => {
    // Reuse a workspace the actor belongs to, or the first workspace on the server,
    // or create a default workspace when starting from an empty database.
    let workspaceRow = await trx
      .selectFrom('workspace_members')
      .select('workspace_id as id')
      .where('user_id', '=', actor.id)
      .orderBy('created_at', 'asc')
      .executeTakeFirst();

    if (!workspaceRow) {
      workspaceRow = await trx
        .selectFrom('workspaces')
        .select('id')
        .orderBy('created_at', 'asc')
        .executeTakeFirst();
    }

    let workspaceId: string;
    if (workspaceRow) {
      workspaceId = workspaceRow.id;
    } else {
      workspaceId = 'default';
      await trx
        .insertInto('workspaces')
        .values({ id: workspaceId, name: 'Default Workspace' })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
    }

    await trx
      .insertInto('workspace_members')
      .values({
        workspace_id: workspaceId,
        user_id: actor.id,
        role: actor.isAdmin ? 'admin' : 'member',
      })
      .onConflict((oc) => oc.doNothing())
      .execute();

    const projectRow = await trx
      .insertInto('projects')
      .values({
        id: projectId,
        workspace_id: workspaceId,
        name,
        number,
        description,
      })
      .returning(['id', 'name', 'number', 'description', 'created_at'])
      .executeTakeFirstOrThrow();

    const scopeRow = await trx
      .insertInto('scopes')
      .values({
        id: scopeId,
        project_id: projectId,
        kind: 'session',
        parent_review_id: null,
        document_set_id: null,
        name: 'General review',
        default_draft_visibility: 'lane',
        auto_release_on_create: true,
        numbering_mode: 'on_create',
        tick_closes_issue: false,
        allow_amendment_while_open: true,
        session_state: 'open',
      })
      .returning(['id', 'project_id', 'kind', 'name', 'session_state', 'created_at'])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('lanes')
      .values({
        id: laneId,
        project_id: projectId,
        scope_id: scopeId,
        name: 'Team',
        position: 0,
        default_draft_visibility: 'lane',
        party_visibility_mode: 'open',
        lead_party_id: null,
      })
      .execute();

    await trx
      .insertInto('project_members')
      .values({
        project_id: projectId,
        user_id: actor.id,
        party_id: null,
        role: 'project_admin',
        state: 'active',
        updated_at: now,
      })
      .execute();

    await trx
      .insertInto('lane_members')
      .values({
        lane_id: laneId,
        subject_kind: 'user',
        subject_id: actor.id,
      })
      .execute();

    await trx
      .insertInto('statuses')
      .values(
        DEFAULT_PROJECT_STATUSES.map((s) => ({
          project_id: projectId,
          id: s.id,
          name: s.name,
          category: s.category,
          position: s.position,
        })),
      )
      .execute();

    return { projectRow, scopeRow };
  });

  const project: ProjectSummary = {
    id: created.projectRow.id,
    name: created.projectRow.name,
    number: created.projectRow.number,
    description: created.projectRow.description,
    role: 'project_admin',
    createdAt: created.projectRow.created_at.toISOString(),
  };

  return {
    ok: true,
    project,
    scope: {
      id: created.scopeRow.id,
      projectId: created.scopeRow.project_id,
      kind: created.scopeRow.kind,
      name: created.scopeRow.name,
      state: created.scopeRow.session_state,
      createdAt: created.scopeRow.created_at.toISOString(),
    },
    lane: { id: laneId, name: 'Team' },
    role: 'project_admin',
  };
}

export async function getProjectForMember(
  db: Kysely<Database>,
  projectId: string,
  actorId: string,
): Promise<GetProjectResult> {
  const row = await db
    .selectFrom('projects')
    .innerJoin('project_members', 'project_members.project_id', 'projects.id')
    .select([
      'projects.id as id',
      'projects.name as name',
      'projects.number as number',
      'projects.description as description',
      'projects.created_at as created_at',
      'project_members.role as role',
    ])
    .where('projects.id', '=', projectId)
    .where('projects.archived_at', 'is', null)
    .where('project_members.user_id', '=', actorId)
    .where('project_members.state', '=', 'active')
    .executeTakeFirst();

  if (!row) {
    return { ok: false, status: 404, code: 'not_found' };
  }

  return {
    ok: true,
    project: {
      id: row.id,
      name: row.name,
      number: row.number,
      description: row.description,
      role: row.role,
      createdAt: row.created_at.toISOString(),
    },
    role: row.role,
  };
}

export async function listProjectMembers(
  db: Kysely<Database>,
  projectId: string,
  actorId: string,
): Promise<ListProjectMembersResult> {
  const membership = await getProjectForMember(db, projectId, actorId);
  if (!membership.ok) return membership;

  const memberRows = await db
    .selectFrom('project_members')
    .innerJoin('users', 'users.id', 'project_members.user_id')
    .select([
      'project_members.user_id as user_id',
      'users.email as email',
      'users.name as name',
      'project_members.role as role',
      'project_members.state as state',
      'project_members.created_at as created_at',
    ])
    .where('project_members.project_id', '=', projectId)
    .where('project_members.state', 'in', ['active', 'invited'])
    .orderBy('project_members.created_at', 'asc')
    .execute();

  const now = new Date();
  const inviteRows = await db
    .selectFrom('invites')
    .select(['id', 'email', 'name', 'project_role', 'expires_at', 'created_at'])
    .where('project_id', '=', projectId)
    .where('accepted_at', 'is', null)
    .where('expires_at', '>', now)
    .orderBy('created_at', 'desc')
    .execute();

  const members: ProjectMemberRecord[] = memberRows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    state: row.state === 'invited' ? 'invited' : 'active',
    createdAt: row.created_at.toISOString(),
  }));

  const invites: PendingProjectInvite[] = inviteRows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.project_role ?? 'reviewer',
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  }));

  return {
    ok: true,
    role: membership.role,
    members,
    invites,
  };
}

export async function createProjectInvite(
  db: Kysely<Database>,
  projectId: string,
  actorId: string,
  input: {
    email?: string | null;
    name?: string | null;
    role?: unknown;
    scopeId?: string | null;
    ttlMs?: number;
  },
): Promise<CreateProjectInviteResult> {
  const membership = await getProjectForMember(db, projectId, actorId);
  if (!membership.ok) return membership;
  if (membership.role !== 'project_admin') {
    return { ok: false, status: 403, code: 'forbidden' };
  }

  const projectRole: ProjectRole = input.role === undefined ? 'reviewer' : isProjectRole(input.role) ? input.role : ('' as ProjectRole);
  if (!isProjectRole(projectRole)) {
    return { ok: false, status: 400, code: 'invalid_role' };
  }

  const rawEmail = input.email === undefined || input.email === null ? null : input.email.trim();
  const email = rawEmail && rawEmail.length > 0 ? rawEmail : null;
  if (email !== null && !isValidEmail(email)) {
    return { ok: false, status: 400, code: 'invalid_email' };
  }

  let scopeId: string | null = input.scopeId ?? null;
  if (scopeId !== null) {
    const scopeRow = await db
      .selectFrom('scopes')
      .select('id')
      .where('id', '=', scopeId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!scopeRow) {
      return { ok: false, status: 400, code: 'invalid_scope' };
    }
  } else {
    const defaultScope = await db
      .selectFrom('scopes')
      .select('id')
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    scopeId = defaultScope?.id ?? null;
  }

  const created = await createInvite(db, {
    email,
    name: input.name,
    projectId,
    scopeId,
    role: 'user',
    projectRole,
    createdBy: actorId,
    ttlMs: input.ttlMs,
  });

  return {
    ok: true,
    invite: {
      id: created.id,
      email: created.email,
      name: created.name,
      role: projectRole,
      expiresAt: created.expiresAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
    },
    token: created.token,
    inviteUrl: `/invite/${created.token}`,
  };
}

export async function updateProjectMemberRole(
  db: Kysely<Database>,
  projectId: string,
  actorId: string,
  targetUserId: string,
  roleInput: unknown,
): Promise<UpdateMemberRoleResult> {
  if (!isProjectRole(roleInput)) {
    return { ok: false, status: 400, code: 'invalid_role' };
  }
  const nextRole: ProjectRole = roleInput;
  const now = new Date();

  return db.transaction().execute(async (trx): Promise<UpdateMemberRoleResult> => {
    const project = await trx
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!project) {
      return { ok: false, status: 404, code: 'not_found' };
    }

    // Lock all membership rows for this project so concurrent role changes cannot
    // race past the last-active-admin invariant.
    const lockedMembers = await trx
      .selectFrom('project_members')
      .select(['user_id', 'role', 'state', 'created_at'])
      .where('project_id', '=', projectId)
      .orderBy('user_id', 'asc')
      .forUpdate()
      .execute();

    const caller = lockedMembers.find((m) => m.user_id === actorId && m.state === 'active');
    if (!caller) {
      return { ok: false, status: 404, code: 'not_found' };
    }
    if (caller.role !== 'project_admin') {
      return { ok: false, status: 403, code: 'forbidden' };
    }

    const target = lockedMembers.find((m) => m.user_id === targetUserId && m.state !== 'removed');
    if (!target) {
      return { ok: false, status: 404, code: 'member_not_found' };
    }

    if (target.state === 'active' && target.role === 'project_admin' && nextRole !== 'project_admin') {
      const activeAdminCount = lockedMembers.filter(
        (m) => m.state === 'active' && m.role === 'project_admin',
      ).length;
      if (activeAdminCount <= 1) {
        return { ok: false, status: 409, code: 'last_admin' };
      }
    }

    await trx
      .updateTable('project_members')
      .set({ role: nextRole, updated_at: now })
      .where('project_id', '=', projectId)
      .where('user_id', '=', targetUserId)
      .execute();

    const userRow = await trx
      .selectFrom('users')
      .select(['email', 'name'])
      .where('id', '=', targetUserId)
      .executeTakeFirstOrThrow();

    return {
      ok: true,
      member: {
        userId: targetUserId,
        email: userRow.email,
        name: userRow.name,
        role: nextRole,
        state: target.state === 'invited' ? 'invited' : 'active',
        createdAt: target.created_at.toISOString(),
      },
    };
  });
}

export async function removeProjectMember(
  db: Kysely<Database>,
  projectId: string,
  actorId: string,
  targetUserId: string,
): Promise<RemoveMemberResult> {
  const now = new Date();

  return db.transaction().execute(async (trx): Promise<RemoveMemberResult> => {
    const project = await trx
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!project) {
      return { ok: false, status: 404, code: 'not_found' };
    }

    const lockedMembers = await trx
      .selectFrom('project_members')
      .select(['user_id', 'role', 'state'])
      .where('project_id', '=', projectId)
      .orderBy('user_id', 'asc')
      .forUpdate()
      .execute();

    const caller = lockedMembers.find((m) => m.user_id === actorId && m.state === 'active');
    if (!caller) {
      return { ok: false, status: 404, code: 'not_found' };
    }
    if (caller.role !== 'project_admin') {
      return { ok: false, status: 403, code: 'forbidden' };
    }

    const target = lockedMembers.find((m) => m.user_id === targetUserId && m.state !== 'removed');
    if (!target) {
      return { ok: false, status: 404, code: 'member_not_found' };
    }

    if (target.state === 'active' && target.role === 'project_admin') {
      const activeAdminCount = lockedMembers.filter(
        (m) => m.state === 'active' && m.role === 'project_admin',
      ).length;
      if (activeAdminCount <= 1) {
        return { ok: false, status: 409, code: 'last_admin' };
      }
    }

    await trx
      .updateTable('project_members')
      .set({ state: 'removed', updated_at: now })
      .where('project_id', '=', projectId)
      .where('user_id', '=', targetUserId)
      .execute();

    const laneRows = await trx
      .selectFrom('lanes')
      .select('id')
      .where('project_id', '=', projectId)
      .execute();

    if (laneRows.length > 0) {
      await trx
        .deleteFrom('lane_members')
        .where('subject_kind', '=', 'user')
        .where('subject_id', '=', targetUserId)
        .where(
          'lane_id',
          'in',
          laneRows.map((l) => l.id),
        )
        .execute();
    }

    return { ok: true, userId: targetUserId };
  });
}
