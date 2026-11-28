import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import {
  createSession,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  type UserProfile,
} from './auth.ts';
import type { Database, ProjectRole } from './db.ts';
import { lockProject } from './projectLock.ts';

export interface CreateInviteInput {
  email?: string | null;
  name?: string | null;
  projectId?: string | null;
  scopeId?: string | null;
  role?: 'user' | 'admin';
  projectRole?: ProjectRole | null;
  createdBy?: string | null;
  ttlMs?: number;
}

export interface CreatedInvite {
  id: string;
  token: string;
  email: string | null;
  name: string | null;
  projectRole: ProjectRole | null;
  expiresAt: Date;
  createdAt: Date;
}

export type InvitePreviewResult =
  | {
      ok: true;
      invite: {
        email: string | null;
        name: string | null;
        projectName: string | null;
        scopeName: string | null;
        projectRole: ProjectRole | null;
        hasAccount: boolean;
        expiresAt: string;
      };
    }
  | { ok: false; code: 'invite_not_found' | 'invite_expired' | 'invite_already_accepted' | 'invite_revoked' };

export type AcceptInviteResult =
  | {
      ok: true;
      user: UserProfile;
      session?: { sessionId: string; token: string; expiresAt: Date };
    }
  | {
      ok: false;
      status: number;
      code:
        | 'invite_not_found'
        | 'invite_expired'
        | 'invite_already_accepted'
        | 'invite_revoked'
        | 'already_member'
        | 'lane_unresolved'
        | 'email_mismatch'
        | 'account_exists'
        | 'invalid_email'
        | 'invalid_password'
        | 'invalid_name';
    };

export interface AccessibleProject {
  id: string;
  name: string;
  number: string | null;
  description: string | null;
  role: ProjectRole | null;
  createdAt: string;
}

export interface AccessibleSession {
  id: string;
  projectId: string;
  projectName: string;
  kind: 'review' | 'session';
  name: string;
  state: 'open' | 'locked' | 'closed' | null;
  createdAt: string;
}

const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320 || /\s/.test(trimmed)) return false;
  const atIndex = trimmed.indexOf('@');
  return atIndex > 0 && atIndex < trimmed.length - 1;
}

export async function createInvite(db: Kysely<Database>, input: CreateInviteInput): Promise<CreatedInvite> {
  const rawEmail = input.email === undefined || input.email === null ? null : input.email.trim();
  const email = rawEmail && rawEmail.length > 0 ? rawEmail : null;
  if (email !== null && !isValidEmail(email)) {
    throw new Error('A valid email address is required');
  }
  const role = input.role ?? 'user';
  // Mirrors invites_link_only_check: a bearer link may only add an ordinary user to a project.
  if (email === null && (!input.projectId || role !== 'user')) {
    throw new Error('An invite without an email must be a project invite with the user role');
  }
  const id = randomUUID();
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_INVITE_TTL_MS));
  const name = input.name?.trim() || null;
  const projectRole: ProjectRole | null =
    input.projectRole ?? (input.projectId ? 'reviewer' : null);

  await db
    .insertInto('invites')
    .values({
      id,
      token_hash: tokenHash,
      email,
      email_lower: email ? email.toLowerCase() : null,
      name,
      project_id: input.projectId ?? null,
      scope_id: input.scopeId ?? null,
      role,
      project_role: projectRole,
      revoked_at: null,
      created_by: input.createdBy ?? null,
      expires_at: expiresAt,
      accepted_at: null,
      accepted_by: null,
    })
    .execute();

  return { id, token, email, name, projectRole, expiresAt, createdAt: now };
}

export async function previewInvite(db: Kysely<Database>, rawToken: string): Promise<InvitePreviewResult> {
  const token = rawToken.trim();
  if (!token) return { ok: false, code: 'invite_not_found' };

  const tokenHash = hashSessionToken(token);
  const row = await db
    .selectFrom('invites')
    .leftJoin('projects', 'projects.id', 'invites.project_id')
    .leftJoin('scopes', 'scopes.id', 'invites.scope_id')
    .select([
      'invites.email as email',
      'invites.email_lower as email_lower',
      'invites.name as name',
      'invites.project_role as project_role',
      'invites.expires_at as expires_at',
      'invites.accepted_at as accepted_at',
      'invites.revoked_at as revoked_at',
      'projects.name as project_name',
      'scopes.name as scope_name',
    ])
    .where('invites.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row) return { ok: false, code: 'invite_not_found' };
  if (row.accepted_at !== null) return { ok: false, code: 'invite_already_accepted' };
  if (row.revoked_at !== null) return { ok: false, code: 'invite_revoked' };
  if (row.expires_at.getTime() <= Date.now()) return { ok: false, code: 'invite_expired' };

  const existingUser = row.email_lower
    ? await db
        .selectFrom('users')
        .select('id')
        .where('email_lower', '=', row.email_lower)
        .executeTakeFirst()
    : undefined;

  return {
    ok: true,
    invite: {
      email: row.email,
      name: row.name,
      projectName: row.project_name ?? null,
      scopeName: row.scope_name ?? null,
      projectRole: row.project_role ?? null,
      hasAccount: existingUser !== undefined,
      expiresAt: row.expires_at.toISOString(),
    },
  };
}

/**
 * Backstop for revocation: a project invite is only as good as its creator's authority when it is
 * used. The creator must be enabled and still an active project admin. A server admin who has never
 * been a member of the project (an invite made by an operator, not through the project routes) also
 * counts. An invite with no creator on record is refused.
 */
async function creatorMayStillInvite(
  trx: Transaction<Database>,
  projectId: string,
  creatorId: string | null,
): Promise<boolean> {
  if (creatorId === null) return false;
  const creator = await trx
    .selectFrom('users')
    .leftJoin('project_members', (join) =>
      join.onRef('project_members.user_id', '=', 'users.id').on('project_members.project_id', '=', projectId),
    )
    .select([
      'users.is_admin as is_admin',
      'users.disabled_at as disabled_at',
      'project_members.role as role',
      'project_members.state as state',
    ])
    .where('users.id', '=', creatorId)
    .executeTakeFirst();
  if (!creator || creator.disabled_at !== null) return false;
  if (creator.state === null) return creator.is_admin;
  return creator.state === 'active' && creator.role === 'project_admin';
}

/**
 * The lanes of the scope an invite points at: its own scope, or else the project's default (oldest)
 * scope.
 *
 * Choosing a lane: invites do not name one yet, so a new member only joins an unambiguous target,
 * the scope's single lane. Several lanes mean a wall, and joining all of them, or guessing one,
 * would put the user on a side nobody chose, so the caller refuses the invite. Once invites carry a
 * lane id, the inviting admin chooses the lane and that id replaces this rule.
 */
async function targetScopeLanes(
  trx: Transaction<Database>,
  projectId: string,
  inviteScopeId: string | null,
): Promise<string[]> {
  let scopeId = inviteScopeId;
  if (scopeId === null) {
    const defaultScope = await trx
      .selectFrom('scopes')
      .select('id')
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .executeTakeFirst();
    if (!defaultScope) return [];
    scopeId = defaultScope.id;
  }
  const lanes = await trx
    .selectFrom('lanes')
    .select('id')
    .where('project_id', '=', projectId)
    .where('scope_id', '=', scopeId)
    .execute();
  return lanes.map((lane) => lane.id);
}

export async function acceptInvite(
  db: Kysely<Database>,
  rawToken: string,
  options: {
    signedInUser: UserProfile | null;
    email?: string;
    name?: string;
    password?: string;
    sessionTtlMs: number;
  },
): Promise<AcceptInviteResult> {
  const token = rawToken.trim();
  if (!token) return { ok: false, status: 404, code: 'invite_not_found' };

  const tokenHash = hashSessionToken(token);

  // Pre-check invite existence, expiry, acceptance, and existing account before hashing
  // so bogus/expired/used tokens never trigger argon2id work or return 400 invalid_password.
  const precheckNow = new Date();
  const precheckInvite = await db
    .selectFrom('invites')
    .select(['email', 'email_lower', 'project_id', 'expires_at', 'accepted_at', 'revoked_at'])
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!precheckInvite) return { ok: false, status: 404, code: 'invite_not_found' };
  if (precheckInvite.accepted_at !== null) return { ok: false, status: 409, code: 'invite_already_accepted' };
  if (precheckInvite.revoked_at !== null) return { ok: false, status: 410, code: 'invite_revoked' };
  if (precheckInvite.expires_at.getTime() <= precheckNow.getTime()) {
    return { ok: false, status: 410, code: 'invite_expired' };
  }

  // Hash the password before opening the transaction so we don't hold a DB row lock during argon2id.
  let preparedPasswordHash: string | null = null;
  let suppliedEmail: string | null = null;
  if (!options.signedInUser) {
    let targetEmailLower = precheckInvite.email_lower;
    if (targetEmailLower === null) {
      const candidate = options.email?.trim() ?? '';
      if (!isValidEmail(candidate)) {
        return { ok: false, status: 400, code: 'invalid_email' };
      }
      suppliedEmail = candidate;
      targetEmailLower = candidate.toLowerCase();
    }

    // Checked before the account lookup, so a request with no usable password gets the same answer
    // whether or not the address has an account.
    if (typeof options.password !== 'string' || options.password.length < 8) {
      return { ok: false, status: 400, code: 'invalid_password' };
    }

    const existingPrecheck = await db
      .selectFrom('users')
      .select('id')
      .where('email_lower', '=', targetEmailLower)
      .executeTakeFirst();
    if (existingPrecheck) {
      return { ok: false, status: 409, code: 'account_exists' };
    }
    preparedPasswordHash = await hashPassword(options.password);
  }

  const now = new Date();
  const txResult = await db.transaction().execute(async (trx): Promise<
    | { ok: true; user: UserProfile; needsSession: boolean }
    | { ok: false; status: number; code: Extract<AcceptInviteResult, { ok: false }>['code'] }
  > => {
    // Returning a refusal commits the transaction, so every refusal below comes before the first
    // write. The project lock comes before the invite row lock (see lockProject).
    if (precheckInvite.project_id !== null) {
      await lockProject(trx, precheckInvite.project_id);
    }

    const invite = await trx
      .selectFrom('invites')
      .select([
        'id',
        'email',
        'email_lower',
        'name',
        'project_id',
        'scope_id',
        'role',
        'project_role',
        'created_by',
        'expires_at',
        'accepted_at',
        'revoked_at',
      ])
      .where('token_hash', '=', tokenHash)
      .forUpdate()
      .executeTakeFirst();

    if (!invite) return { ok: false, status: 404, code: 'invite_not_found' };
    if (invite.accepted_at !== null) return { ok: false, status: 409, code: 'invite_already_accepted' };
    if (invite.revoked_at !== null) return { ok: false, status: 410, code: 'invite_revoked' };
    if (invite.expires_at.getTime() <= now.getTime()) return { ok: false, status: 410, code: 'invite_expired' };

    let user: UserProfile;
    let needsSession = false;

    if (
      options.signedInUser &&
      invite.email_lower !== null &&
      options.signedInUser.email.trim().toLowerCase() !== invite.email_lower
    ) {
      return { ok: false, status: 403, code: 'email_mismatch' };
    }

    let laneIds: string[] = [];
    if (invite.project_id) {
      if (!(await creatorMayStillInvite(trx, invite.project_id, invite.created_by))) {
        return { ok: false, status: 410, code: 'invite_revoked' };
      }
      // An invite adds a member; it never changes one. Overwriting an active member's role would
      // let a stale or test link demote them, and would bypass the last-admin guard. The invite
      // stays unused, and role changes go through the members routes. A new account cannot be a
      // member yet, so only a signed-in user needs the check.
      if (options.signedInUser) {
        const membership = await trx
          .selectFrom('project_members')
          .select('state')
          .where('project_id', '=', invite.project_id)
          .where('user_id', '=', options.signedInUser.id)
          .executeTakeFirst();
        if (membership?.state === 'active') {
          return { ok: false, status: 409, code: 'already_member' };
        }
      }
      laneIds = await targetScopeLanes(trx, invite.project_id, invite.scope_id);
      if (laneIds.length > 1) {
        return { ok: false, status: 409, code: 'lane_unresolved' };
      }
    }

    if (options.signedInUser) {
      user = options.signedInUser;
    } else {
      const targetEmail = invite.email ?? suppliedEmail ?? '';
      const targetEmailLower = invite.email_lower ?? targetEmail.toLowerCase();
      if (!targetEmail || !isValidEmail(targetEmail)) {
        return { ok: false, status: 400, code: 'invalid_email' };
      }

      const existing = await trx
        .selectFrom('users')
        .select('id')
        .where('email_lower', '=', targetEmailLower)
        .executeTakeFirst();
      if (existing) {
        return { ok: false, status: 409, code: 'account_exists' };
      }
      if (!preparedPasswordHash) {
        return { ok: false, status: 400, code: 'invalid_password' };
      }
      const displayName = (options.name?.trim() || invite.name?.trim() || targetEmail.split('@')[0] || '').trim();
      if (!displayName) {
        return { ok: false, status: 400, code: 'invalid_name' };
      }

      const id = randomUUID();
      const isAdmin = invite.role === 'admin';
      const inserted = await trx
        .insertInto('users')
        .values({
          id,
          email: targetEmail,
          email_lower: targetEmailLower,
          name: displayName,
          password_hash: preparedPasswordHash,
          role: invite.role,
          is_admin: isAdmin,
          disabled_at: null,
        })
        .onConflict((oc) => oc.column('email_lower').doNothing())
        .returning('id')
        .executeTakeFirst();

      if (!inserted) {
        return { ok: false, status: 409, code: 'account_exists' };
      }

      user = {
        id,
        email: targetEmail,
        name: displayName,
        role: invite.role,
        isAdmin,
      };
      needsSession = true;
    }

    if (invite.project_id) {
      const projectRole: ProjectRole = invite.project_role ?? 'reviewer';
      await trx
        .insertInto('project_members')
        .values({
          project_id: invite.project_id,
          user_id: user.id,
          party_id: null,
          role: projectRole,
          state: 'active',
        })
        .onConflict((oc) =>
          oc.columns(['project_id', 'user_id']).doUpdateSet({
            role: projectRole,
            state: 'active',
            updated_at: now,
          }),
        )
        .execute();

      for (const laneId of laneIds) {
        await trx
          .insertInto('lane_members')
          .values({
            lane_id: laneId,
            subject_kind: 'user',
            subject_id: user.id,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
    }

    await trx
      .updateTable('invites')
      .set({
        accepted_at: now,
        accepted_by: user.id,
      })
      .where('id', '=', invite.id)
      .execute();

    return { ok: true, user, needsSession };
  });

  if (!txResult.ok) {
    return txResult;
  }

  if (txResult.needsSession) {
    const session = await createSession(db, txResult.user.id, options.sessionTtlMs);
    return { ok: true, user: txResult.user, session };
  }

  return { ok: true, user: txResult.user };
}

export async function listAccessibleSessions(
  db: Kysely<Database>,
  user: UserProfile,
): Promise<{ projects: AccessibleProject[]; sessions: AccessibleSession[] }> {
  const projectRows = user.isAdmin
    ? await db
        .selectFrom('projects')
        .leftJoin('project_members', (join) =>
          join
            .onRef('project_members.project_id', '=', 'projects.id')
            .on('project_members.user_id', '=', user.id)
            .on('project_members.state', '=', 'active'),
        )
        .select([
          'projects.id as id',
          'projects.name as name',
          'projects.number as number',
          'projects.description as description',
          'projects.created_at as created_at',
          'project_members.role as role',
        ])
        .where('projects.archived_at', 'is', null)
        .orderBy('projects.created_at', 'desc')
        .execute()
    : await db
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
        .where('project_members.user_id', '=', user.id)
        .where('project_members.state', '=', 'active')
        .where('projects.archived_at', 'is', null)
        .orderBy('projects.created_at', 'desc')
        .execute();

  const projects: AccessibleProject[] = projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    number: row.number,
    description: row.description,
    role: row.role ?? null,
    createdAt: row.created_at.toISOString(),
  }));

  if (projects.length === 0) {
    return { projects: [], sessions: [] };
  }

  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const projectIds = projects.map((p) => p.id);

  const scopeRows = await db
    .selectFrom('scopes')
    .select(['id', 'project_id', 'kind', 'name', 'session_state', 'created_at'])
    .where('project_id', 'in', projectIds)
    .orderBy('created_at', 'desc')
    .execute();

  const sessions: AccessibleSession[] = scopeRows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: projectNames.get(row.project_id) ?? '',
    kind: row.kind,
    name: row.name,
    state: row.session_state,
    createdAt: row.created_at.toISOString(),
  }));

  return { projects, sessions };
}
