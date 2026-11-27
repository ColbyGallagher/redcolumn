import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify, type Options as Argon2Options } from '@node-rs/argon2';
import type { Kysely } from 'kysely';
import type { Database } from './db.ts';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  isAdmin: boolean;
}

export interface SessionInfo {
  sessionId: string;
  expiresAt: Date;
  user: UserProfile;
}

/** How often a session's last_seen_at is refreshed while it is in use. */
const LAST_SEEN_RESOLUTION_MS = 60_000;

/**
 * Each argon2id verify holds ~19 MiB, so verifies run at most this many at a time; the rest
 * wait their turn instead of all allocating at once under a burst of logins.
 */
const MAX_CONCURRENT_VERIFIES = 4;
let activeVerifies = 0;
const verifyWaiters: (() => void)[] = [];

async function withVerifySlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeVerifies >= MAX_CONCURRENT_VERIFIES) {
    await new Promise<void>((resolve) => verifyWaiters.push(resolve));
  } else {
    activeVerifies += 1;
  }
  try {
    return await fn();
  } finally {
    const next = verifyWaiters.shift();
    if (next) next();
    else activeVerifies -= 1;
  }
}

// Algorithm.Argon2id = 2 (numeric literal avoids ambient const enum with verbatimModuleSyntax).
const ARGON2_OPTIONS: Argon2Options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2Hash('dummy-password-for-timing-equalization', ARGON2_OPTIONS);
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return withVerifySlot(async () => {
    try {
      return await argon2Verify(passwordHash, password);
    } catch {
      return false;
    }
  });
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

export function formatSessionCookie(
  name: string,
  token: string,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function formatClearSessionCookie(name: string, options: { secure: boolean }): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function extractSessionToken(
  headers: { cookie?: string | string[]; authorization?: string | string[] },
  cookieName: string,
): string | null {
  const cookieHeader = Array.isArray(headers.cookie) ? headers.cookie.join('; ') : headers.cookie;
  const cookies = parseCookies(cookieHeader);
  const fromCookie = cookies[cookieName];
  if (fromCookie && fromCookie.length > 0) return fromCookie;

  const authHeader = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  if (authHeader) {
    const match = /^Bearer\s+([A-Za-z0-9_.-]+)$/i.exec(authHeader.trim());
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function createLocalUser(
  db: Kysely<Database>,
  input: { email: string; name: string; password: string; role?: 'user' | 'admin' },
): Promise<UserProfile> {
  const email = input.email.trim();
  const name = input.name.trim();
  const password = input.password;
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required');
  }
  if (!name) {
    throw new Error('A display name is required');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const role = input.role ?? 'user';
  const isAdmin = role === 'admin';
  const id = randomUUID();
  const passwordHash = await hashPassword(password);

  await db
    .insertInto('users')
    .values({
      id,
      email,
      email_lower: email.toLowerCase(),
      name,
      password_hash: passwordHash,
      role,
      is_admin: isAdmin,
      disabled_at: null,
    })
    .execute();

  return { id, email, name, role, isAdmin };
}

export async function authenticateLocalUser(
  db: Kysely<Database>,
  email: string,
  password: string,
): Promise<UserProfile | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) return null;

  const row = await db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'password_hash', 'role', 'is_admin', 'disabled_at'])
    .where('email_lower', '=', normalized)
    .executeTakeFirst();

  if (!row || row.disabled_at !== null) {
    await verifyPassword(await getDummyHash(), password);
    return null;
  }

  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isAdmin: row.is_admin,
  };
}

export async function createSession(
  db: Kysely<Database>,
  userId: string,
  ttlMs: number,
): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const sessionId = randomUUID();
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .insertInto('sessions')
    .values({
      id: sessionId,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked_at: null,
    })
    .execute();

  return { sessionId, token, expiresAt };
}

export async function lookupSession(db: Kysely<Database>, token: string): Promise<SessionInfo | null> {
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as session_id',
      'sessions.expires_at as expires_at',
      'sessions.revoked_at as revoked_at',
      'users.id as user_id',
      'users.email as email',
      'users.name as name',
      'users.role as role',
      'users.is_admin as is_admin',
      'users.disabled_at as disabled_at',
    ])
    .where('sessions.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.disabled_at !== null) return null;
  if (row.expires_at.getTime() <= now.getTime()) return null;

  await db
    .updateTable('sessions')
    .set({ last_seen_at: now })
    .where('id', '=', row.session_id)
    .where('last_seen_at', '<', new Date(now.getTime() - LAST_SEEN_RESOLUTION_MS))
    .execute();

  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      isAdmin: row.is_admin,
    },
  };
}

/** Revokes the session for `token`. Returns its id, or null if no active session matched. */
export async function revokeSession(db: Kysely<Database>, token: string): Promise<string | null> {
  const tokenHash = hashSessionToken(token);
  const row = await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('token_hash', '=', tokenHash)
    .where('revoked_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row?.id ?? null;
}
