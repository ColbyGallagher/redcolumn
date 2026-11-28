import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  createSession,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  type UserProfile,
} from './auth.ts';
import type { Database } from './db.ts';

export interface CreateInviteInput {
  email: string;
  name?: string | null;
  projectId?: string | null;
  scopeId?: string | null;
  role?: 'user' | 'admin';
  createdBy?: string | null;
  ttlMs?: number;
}

export interface CreatedInvite {
  id: string;
  token: string;
  email: string;
  expiresAt: Date;
}

export type InvitePreviewResult =
  | {
      ok: true;
      invite: {
        email: string;
        name: string | null;
        projectName: string | null;
        scopeName: string | null;
        hasAccount: boolean;
        expiresAt: string;
      };
    }
  | { ok: false; code: 'invite_not_found' | 'invite_expired' | 'invite_already_accepted' };

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
        | 'email_mismatch'
        | 'account_exists'
        | 'invalid_password'
        | 'invalid_name';
    };

export interface AccessibleProject {
  id: string;
  name: string;
  number: string | null;
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

export async function createInvite(db: Kysely<Database>, input: CreateInviteInput): Promise<CreatedInvite> {
  const email = input.email.trim();
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required');
  }
  const id = randomUUID();
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_INVITE_TTL_MS));

  await db
    .insertInto('invites')
    .values({
      id,
      token_hash: tokenHash,
      email,
      email_lower: email.toLowerCase(),
      name: input.name?.trim() || null,
      project_id: input.projectId ?? null,
      scope_id: input.scopeId ?? null,
      role: input.role ?? 'user',
      created_by: input.createdBy ?? null,
      expires_at: expiresAt,
      accepted_at: null,
      accepted_by: null,
    })
    .execute();

  return { id, token, email, expiresAt };
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
      'invites.expires_at as expires_at',
      'invites.accepted_at as accepted_at',
      'projects.name as project_name',
      'scopes.name as scope_name',
    ])
    .where('invites.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row) return { ok: false, code: 'invite_not_found' };
  if (row.accepted_at !== null) return { ok: false, code: 'invite_already_accepted' };
  if (row.expires_at.getTime() <= Date.now()) return { ok: false, code: 'invite_expired' };

  const existingUser = await db
    .selectFrom('users')
    .select('id')
    .where('email_lower', '=', row.email_lower)
    .executeTakeFirst();

  return {
    ok: true,
    invite: {
      email: row.email,
      name: row.name,
      projectName: row.project_name ?? null,
      scopeName: row.scope_name ?? null,
      hasAccount: existingUser !== undefined,
      expiresAt: row.expires_at.toISOString(),
    },
  };
}

export async function acceptInvite(
  db: Kysely<Database>,
  rawToken: string,
  options: {
    signedInUser: UserProfile | null;
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
    .select(['email_lower', 'expires_at', 'accepted_at'])
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!precheckInvite) return { ok: false, status: 404, code: 'invite_not_found' };
  if (precheckInvite.accepted_at !== null) return { ok: false, status: 409, code: 'invite_already_accepted' };
  if (precheckInvite.expires_at.getTime() <= precheckNow.getTime()) {
    return { ok: false, status: 410, code: 'invite_expired' };
  }

  // Hash the password before opening the transaction so we don't hold a DB row lock during argon2id.
  let preparedPasswordHash: string | null = null;
  if (!options.signedInUser) {
    const existingPrecheck = await db
      .selectFrom('users')
      .select('id')
      .where('email_lower', '=', precheckInvite.email_lower)
      .executeTakeFirst();
    if (existingPrecheck) {
      return { ok: false, status: 409, code: 'account_exists' };
    }
    if (typeof options.password !== 'string' || options.password.length < 8) {
      return { ok: false, status: 400, code: 'invalid_password' };
    }
    preparedPasswordHash = await hashPassword(options.password);
  }

  const now = new Date();
  const txResult = await db.transaction().execute(async (trx): Promise<
    | { ok: true; user: UserProfile; needsSession: boolean }
    | { ok: false; status: number; code: Extract<AcceptInviteResult, { ok: false }>['code'] }
  > => {
    const invite = await trx
      .selectFrom('invites')
      .select([
        'id',
        'email',
        'email_lower',
        'name',
        'project_id',
        'role',
        'expires_at',
        'accepted_at',
      ])
      .where('token_hash', '=', tokenHash)
      .forUpdate()
      .executeTakeFirst();

    if (!invite) return { ok: false, status: 404, code: 'invite_not_found' };
    if (invite.accepted_at !== null) return { ok: false, status: 409, code: 'invite_already_accepted' };
    if (invite.expires_at.getTime() <= now.getTime()) return { ok: false, status: 410, code: 'invite_expired' };

    let user: UserProfile;
    let needsSession = false;

    if (options.signedInUser) {
      if (options.signedInUser.email.trim().toLowerCase() !== invite.email_lower) {
        return { ok: false, status: 403, code: 'email_mismatch' };
      }
      user = options.signedInUser;
    } else {
      const existing = await trx
        .selectFrom('users')
        .select('id')
        .where('email_lower', '=', invite.email_lower)
        .executeTakeFirst();
      if (existing) {
        return { ok: false, status: 409, code: 'account_exists' };
      }
      if (!preparedPasswordHash) {
        return { ok: false, status: 400, code: 'invalid_password' };
      }
      const displayName = (options.name?.trim() || invite.name?.trim() || invite.email.split('@')[0] || '').trim();
      if (!displayName) {
        return { ok: false, status: 400, code: 'invalid_name' };
      }

      const id = randomUUID();
      const isAdmin = invite.role === 'admin';
      const inserted = await trx
        .insertInto('users')
        .values({
          id,
          email: invite.email,
          email_lower: invite.email_lower,
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
        email: invite.email,
        name: displayName,
        role: invite.role,
        isAdmin,
      };
      needsSession = true;
    }

    if (invite.project_id) {
      await trx
        .insertInto('project_members')
        .values({
          project_id: invite.project_id,
          user_id: user.id,
          party_id: null,
          state: 'active',
        })
        .onConflict((oc) =>
          oc.columns(['project_id', 'user_id']).doUpdateSet({
            state: 'active',
            updated_at: now,
          }),
        )
        .execute();
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
        .select(['id', 'name', 'number', 'created_at'])
        .where('archived_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute()
    : await db
        .selectFrom('projects')
        .innerJoin('project_members', 'project_members.project_id', 'projects.id')
        .select(['projects.id as id', 'projects.name as name', 'projects.number as number', 'projects.created_at as created_at'])
        .where('project_members.user_id', '=', user.id)
        .where('project_members.state', '=', 'active')
        .where('projects.archived_at', 'is', null)
        .orderBy('projects.created_at', 'desc')
        .execute();

  const projects: AccessibleProject[] = projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    number: row.number,
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
