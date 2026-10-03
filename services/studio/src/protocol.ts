/**
 * Wire format shared with the web client (apps/web/src/studio). Each WebSocket carries one room:
 * the session room (record, chat and presence) or one document's markups. Messages start with a
 * varUint type; sync and awareness use y-protocols, meta is a JSON snapshot of the session.
 */
export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const MSG_META = 3;

/** Room name for the session-wide doc; any other room name is a document id. */
export const SESSION_ROOM = 'session';

/** WebSocket close code when a document is removed from the session. */
export const CLOSE_REMOVED = 4404;
/** WebSocket close code when this attendee has no access to the session. */
export const CLOSE_DENIED = 4403;
/** WebSocket close code when the session needs a Google sign-in (missing or expired). */
export const CLOSE_SIGN_IN = 4401;

export interface Permissions {
  /** Attendees may add, edit and delete markups (the host always may). */
  markup: boolean;
  /** Attendees may add documents to the session. */
  addDocuments: boolean;
  /** Attendees may save copies of documents (download, export, print); missing means yes. */
  saveCopy?: boolean;
  /** Attendees may see the Session ID and invite link to invite others; missing means yes. */
  invite?: boolean;
}

export interface SessionDocument {
  id: string;
  name: string;
  size: number;
  addedBy: string;
  addedAt: number;
  /** Bumped each time the host updates the document to a new revision (missing: 1). */
  version?: number;
  updatedAt?: number;
}

export interface Attendee {
  name: string;
  /** Their Google email, when they joined signed in (verified by the server). */
  email?: string;
  firstJoined: number;
  lastSeen: number;
}

export type SessionStatus = 'active' | 'finished';

/** What every attendee sees about a session. */
export interface SessionMeta {
  id: string;
  name: string;
  host: string;
  createdAt: number;
  status: SessionStatus;
  endedAt: number | null;
  permissions: Permissions;
  documents: SessionDocument[];
  attendees: Attendee[];
  /** Who may view or markup; missing on sessions from before access control. */
  access?: AccessPolicy;
  /**
   * Only people signed in with Google may join, and people and groups match their Google email
   * (typed names no longer count). The redcolumn server verifies the sign-in.
   */
  requireGoogle?: boolean;
  /** The host's Google email: signed in with it, the host has host rights on any device. */
  hostEmail?: string;
  /** When the session ends by itself (ms since epoch); null or missing for never. */
  expiresAt?: number | null;
}

export type RecordKind = 'chat' | 'join' | 'leave' | 'markup' | 'document' | 'session' | 'alert';

/** One line in the session Record: a chat message or something that happened. */
export interface RecordEntry {
  id: string;
  at: number;
  author: string;
  kind: RecordKind;
  text: string;
  docId?: string;
  page?: number;
  markupId?: string;
}

/** Formats a session id for display: 123-456-789. */
export function formatSessionId(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

/** Accepts `123456789`, `123-456-789`, `123 456 789`; returns the canonical form or null. */
export function parseSessionId(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(digits) ? formatSessionId(digits) : null;
}

/**
 * What one person may do in a session:
 * - `none`: cannot join or open its documents.
 * - `view`: sees documents, markups and the Record, and can chat, but cannot change markups.
 * - `markup`: can also add, edit and comment on markups.
 */
export type Access = 'none' | 'view' | 'markup';

export const ACCESS_LEVELS: readonly Access[] = ['none', 'view', 'markup'];

/** A named set of people who share one access level. */
export interface AccessGroup {
  id: string;
  name: string;
  access: Access;
  /** Names (or emails), matched without regard to case. */
  members: string[];
}

/** A person invited to the session. `access: null` takes it from their groups, else the default. */
export interface AccessPerson {
  name: string;
  access: Access | null;
}

/** Who may do what. The host always has full control. */
export interface AccessPolicy {
  /** For anyone with the session ID who is not listed. */
  default: Access;
  people: AccessPerson[];
  groups: AccessGroup[];
}

const RANK: Record<Access, number> = { none: 0, view: 1, markup: 2 };

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The access policy of a session; sessions from before policies map their markup lock onto the default. */
export function policyOf(meta: Pick<SessionMeta, 'access' | 'permissions'>): AccessPolicy {
  return meta.access ?? { default: meta.permissions.markup ? 'markup' : 'view', people: [], groups: [] };
}

/**
 * What someone may do: their own setting, else the most generous of their groups, else the default.
 * People and group members are matched by Google email when `email` is given (verified), and by the
 * typed name unless the session requires Google sign-in.
 */
export function accessFor(
  meta: Pick<SessionMeta, 'access' | 'permissions' | 'requireGoogle' | 'hostEmail'>,
  name: string,
  isHost: boolean,
  email?: string | null,
): Access {
  if (isHost || (email && meta.hostEmail && sameName(email, meta.hostEmail))) return 'markup';
  if (meta.requireGoogle && !email) return 'none';
  const policy = policyOf(meta);
  const matches = (who: string) => (!!email && sameName(who, email)) || (!meta.requireGoogle && sameName(who, name));
  const own = policy.people.find((p) => matches(p.name));
  if (own?.access) return own.access;
  const groups = policy.groups.filter((g) => g.members.some(matches));
  if (groups.length) return groups.reduce<Access>((best, g) => (RANK[g.access] > RANK[best] ? g.access : best), 'none');
  return policy.default;
}

/** Cleans a policy from a client: known levels only, trimmed names, no duplicates, sane sizes. */
export function cleanPolicy(raw: unknown): AccessPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<AccessPolicy>;
  const level = (a: unknown): Access | null => (ACCESS_LEVELS.includes(a as Access) ? (a as Access) : null);
  const name = (n: unknown) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '');
  const people: AccessPerson[] = [];
  for (const p of Array.isArray(r.people) ? r.people.slice(0, 500) : []) {
    const n = name(p?.name);
    if (n && !people.some((x) => sameName(x.name, n))) people.push({ name: n, access: level(p?.access) });
  }
  const groups: AccessGroup[] = [];
  for (const g of Array.isArray(r.groups) ? r.groups.slice(0, 100) : []) {
    const n = name(g?.name);
    const id = typeof g?.id === 'string' ? g.id.slice(0, 40) : '';
    if (!n || !id || groups.some((x) => x.id === id)) continue;
    const members: string[] = [];
    for (const m of Array.isArray(g.members) ? g.members.slice(0, 500) : []) {
      const mn = name(m);
      if (mn && !members.some((x) => sameName(x, mn))) members.push(mn);
    }
    groups.push({ id, name: n, access: level(g.access) ?? 'view', members });
  }
  return { default: level(r.default) ?? 'markup', people, groups };
}

/** An active session whose end date has passed (it finishes the next time anyone touches it). */
export function isExpired(meta: Pick<SessionMeta, 'status' | 'expiresAt'>, now = Date.now()): boolean {
  return meta.status === 'active' && typeof meta.expiresAt === 'number' && now >= meta.expiresAt;
}

/** Whether attendees may do something the host allows or not (the host always may). */
export function allows(meta: Pick<SessionMeta, 'permissions'>, what: 'saveCopy' | 'invite' | 'addDocuments' | 'markup'): boolean {
  return meta.permissions[what] ?? true;
}
