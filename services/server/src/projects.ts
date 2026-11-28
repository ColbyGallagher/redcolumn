import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { UserProfile } from './auth.ts';
import type { Database, ProjectRole } from './db.ts';
import { createInvite, isValidEmail } from './invites.ts';
import { lockProject } from './projectLock.ts';

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
    | 'invite_not_found'
    | 'invite_already_accepted'
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
export type RevokeProjectInviteResult = { ok: true; inviteId: string } | ProjectError;

/**
 * Who may close issues in a new project's scope. The schema's default names nobody, which
 * @nb/policy reads as "no one may close", so project admins are the closers until a process says
 * otherwise.
 */
const DEFAULT_CLOSING_RULES = { allowedClosers: [{ kind: 'role', role: 'project_admin' }] };

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
    // The project goes in a workspace the actor already belongs to, otherwise in a new one of
    // their own. Nobody is ever added to a workspace that someone else set up. The lock on the
    // actor's row stops two concurrent first projects from making two workspaces.
    await trx.selectFrom('users').select('id').where('id', '=', actor.id).forNoKeyUpdate().execute();

    const membership = await trx
      .selectFrom('workspace_members')
      .select('workspace_id')
      .where('user_id', '=', actor.id)
      .orderBy('created_at', 'asc')
      .executeTakeFirst();

    const workspaceId = membership?.workspace_id ?? randomUUID();
    if (!membership) {
      await trx.insertInto('workspaces').values({ id: workspaceId, name: actor.name }).execute();
      await trx
        .insertInto('workspace_members')
        .values({ workspace_id: workspaceId, user_id: actor.id, role: 'admin' })
        .execute();
    }

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
        closing_json: JSON.stringify(DEFAULT_CLOSING_RULES),
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
  // Only admins act on pending invitations, so only they see who has been invited.
  const isAdmin = membership.role === 'project_admin';

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
    .where('project_members.state', 'in', isAdmin ? ['active', 'invited'] : ['active'])
    .orderBy('project_members.created_at', 'asc')
    .execute();

  const inviteRows = isAdmin
    ? await db
        .selectFrom('invites')
        .select(['id', 'email', 'name', 'project_role', 'expires_at', 'created_at'])
        .where('project_id', '=', projectId)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .execute()
    : [];

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
  // The role check and the insert share the project lock, so an admin who is being demoted or
  // removed cannot leave a new invite behind.
  return db.transaction().execute(async (trx): Promise<CreateProjectInviteResult> => {
    const admin = await lockProjectForAdmin(trx, projectId, actorId);
    if (!admin.ok) return admin;
    return insertProjectInvite(trx, projectId, actorId, input);
  });
}

async function insertProjectInvite(
  trx: Transaction<Database>,
  projectId: string,
  actorId: string,
  input: Parameters<typeof createProjectInvite>[3],
): Promise<CreateProjectInviteResult> {
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
    const scopeRow = await trx
      .selectFrom('scopes')
      .select('id')
      .where('id', '=', scopeId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!scopeRow) {
      return { ok: false, status: 400, code: 'invalid_scope' };
    }
  } else {
    const defaultScope = await trx
      .selectFrom('scopes')
      .select('id')
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .executeTakeFirst();
    scopeId = defaultScope?.id ?? null;
  }

  const created = await createInvite(trx, {
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
    // In the fragment, which the browser does not send, so opening the link puts no token in
    // server or proxy request logs.
    inviteUrl: `/#/invite/${created.token}`,
  };
}

export async function revokeProjectInvite(
  db: Kysely<Database>,
  projectId: string,
  actorId: string,
  inviteId: string,
): Promise<RevokeProjectInviteResult> {
  return db.transaction().execute(async (trx): Promise<RevokeProjectInviteResult> => {
    const admin = await lockProjectForAdmin(trx, projectId, actorId);
    if (!admin.ok) return admin;

    const invite = await trx
      .selectFrom('invites')
      .select(['accepted_at', 'revoked_at'])
      .where('id', '=', inviteId)
      .where('project_id', '=', projectId)
      .forUpdate()
      .executeTakeFirst();
    if (!invite) {
      return { ok: false, status: 404, code: 'invite_not_found' };
    }
    if (invite.accepted_at !== null) {
      return { ok: false, status: 409, code: 'invite_already_accepted' };
    }
    if (invite.revoked_at === null) {
      await trx.updateTable('invites').set({ revoked_at: new Date() }).where('id', '=', inviteId).execute();
    }
    return { ok: true, inviteId };
  });
}

interface MembershipRow {
  user_id: string;
  role: ProjectRole;
  state: 'invited' | 'active' | 'removed';
  created_at: Date;
}

/** Locks the project, then checks under the lock that the caller is still one of its admins. */
async function lockProjectForAdmin(
  trx: Transaction<Database>,
  projectId: string,
  actorId: string,
): Promise<{ ok: true; members: MembershipRow[] } | ProjectError> {
  const project = await lockProject(trx, projectId);
  if (!project || project.archived_at !== null) {
    return { ok: false, status: 404, code: 'not_found' };
  }
  const members = await trx
    .selectFrom('project_members')
    .select(['user_id', 'role', 'state', 'created_at'])
    .where('project_id', '=', projectId)
    .execute();
  const caller = members.find((m) => m.user_id === actorId && m.state === 'active');
  if (!caller) {
    return { ok: false, status: 404, code: 'not_found' };
  }
  if (caller.role !== 'project_admin') {
    return { ok: false, status: 403, code: 'forbidden' };
  }
  return { ok: true, members };
}

function isLastActiveAdmin(members: readonly MembershipRow[], target: MembershipRow): boolean {
  if (target.state !== 'active' || target.role !== 'project_admin') return false;
  return members.filter((m) => m.state === 'active' && m.role === 'project_admin').length <= 1;
}

/**
 * Withdraws the project's unused invites that could hand authority back to someone who is losing
 * it: those `createdBy` made and, when `sentTo` is given, those addressed to that email.
 */
async function revokePendingInvites(
  trx: Transaction<Database>,
  projectId: string,
  { createdBy, sentTo }: { createdBy: string; sentTo?: string },
  now: Date,
): Promise<void> {
  await trx
    .updateTable('invites')
    .set({ revoked_at: now })
    .where('project_id', '=', projectId)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where((eb) =>
      eb.or([eb('created_by', '=', createdBy), ...(sentTo === undefined ? [] : [eb('email_lower', '=', sentTo)])]),
    )
    .execute();
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
    // The project lock keeps concurrent changes from racing past the last-active-admin invariant.
    const admin = await lockProjectForAdmin(trx, projectId, actorId);
    if (!admin.ok) return admin;

    const target = admin.members.find((m) => m.user_id === targetUserId && m.state !== 'removed');
    if (!target) {
      return { ok: false, status: 404, code: 'member_not_found' };
    }

    if (nextRole !== 'project_admin') {
      if (isLastActiveAdmin(admin.members, target)) {
        return { ok: false, status: 409, code: 'last_admin' };
      }
      await revokePendingInvites(trx, projectId, { createdBy: targetUserId }, now);
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
    const admin = await lockProjectForAdmin(trx, projectId, actorId);
    if (!admin.ok) return admin;

    const target = admin.members.find((m) => m.user_id === targetUserId && m.state !== 'removed');
    if (!target) {
      return { ok: false, status: 404, code: 'member_not_found' };
    }

    if (isLastActiveAdmin(admin.members, target)) {
      return { ok: false, status: 409, code: 'last_admin' };
    }

    const { email_lower: targetEmail } = await trx
      .selectFrom('users')
      .select('email_lower')
      .where('id', '=', targetUserId)
      .executeTakeFirstOrThrow();
    await revokePendingInvites(trx, projectId, { createdBy: targetUserId, sentTo: targetEmail }, now);

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
