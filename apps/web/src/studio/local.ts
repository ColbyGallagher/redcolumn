import type { Backend } from './types';

/** Small per-browser memory for sessions: the one to rejoin, recent ones, and host keys. */

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Remembered for this visit only.
  }
}

const CURRENT_KEY = 'nb.studio.current';
const RECENT_KEY = 'nb.studio.recent';

export interface SessionRef {
  backend: Backend;
  id: string;
}

export interface RecentSession extends SessionRef {
  name: string;
  joinedAt: number;
}

/** Sessions this browser has created or joined, newest first: the Sessions list. */
export function recentSessions(): RecentSession[] {
  // Older builds also kept redcolumn server sessions (no backend, or 'server'): they are dropped.
  return readLocal<(Omit<RecentSession, 'backend'> & { backend?: string })[]>(RECENT_KEY, []).filter((r): r is RecentSession => isBackend(r.backend));
}

/** The sessions this browser is in (it can be in several at once), rejoined on the next visit. */
export function currentSessions(): SessionRef[] {
  // Older builds kept one session (an id string, or one ref), and also server sessions: dropped.
  const cur = readLocal<{ backend?: string; id: string }[] | { backend?: string; id: string } | string | null>(CURRENT_KEY, null);
  if (!cur || typeof cur === 'string') return [];
  return (Array.isArray(cur) ? cur : [cur]).filter((r): r is SessionRef => isBackend(r.backend));
}

const isBackend = (b: string | undefined): b is Backend => b === 'drive' || b === 'onedrive';

export function rememberSession(ref: SessionRef, name: string) {
  const recent = recentSessions().filter((r) => r.id !== ref.id);
  writeLocal(RECENT_KEY, [{ ...ref, name, joinedAt: Date.now() }, ...recent].slice(0, 40));
  writeLocal(CURRENT_KEY, [...currentSessions().filter((r) => r.id !== ref.id), { backend: ref.backend, id: ref.id }]);
}

/** Stops rejoining a session on the next visit (after leaving it). */
export function forgetCurrentSession(id: string) {
  writeLocal(CURRENT_KEY, currentSessions().filter((r) => r.id !== id));
}

/** Removes a session from the Sessions list. */
export function forgetRecentSession(id: string) {
  writeLocal(RECENT_KEY, recentSessions().filter((r) => r.id !== id));
  forgetCurrentSession(id);
}

/** A link that opens the app and joins a session: `?gdrive=` (Google Drive) or `?onedrive=`. */
export function inviteLink(ref: SessionRef): string {
  const url = new URL(typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(ref.backend === 'drive' ? 'gdrive' : 'onedrive', ref.id);
  return url.href;
}
