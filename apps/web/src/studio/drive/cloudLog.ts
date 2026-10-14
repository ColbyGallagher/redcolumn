/**
 * What the app did in OneDrive, kept in this browser only and never sent anywhere,
 * so a careful person can check it touched only what it said (Preferences › Account › Activity;
 * docs/SECURITY-HARDENING.md, 1.4). A repeat of a recent action on the same item is counted on its
 * line, so a Live Session's steady saves do not push older actions out.
 */

export type CloudProvider = 'onedrive';
export type CloudAction = 'create folder' | 'upload' | 'replace' | 'share by link' | 'invite' | 'change access' | 'stop sharing' | 'delete' | 'delete folder' | 'save app file';

export interface CloudLogEntry {
  /** When it last happened (ms since 1970). */
  at: number;
  /** When it first happened, when it has happened more than once. */
  first?: number;
  provider: CloudProvider;
  action: CloudAction;
  /** The file, folder or person it was about, as the app knew it. */
  name: string;
  count: number;
}

const KEY = 'nb.cloud.activity';
const MAX = 300;
/** How far back a repeat is folded into an earlier line. */
const RECENT = 20;
const listeners = new Set<() => void>();
let entries: CloudLogEntry[] | null = null;

function load(): CloudLogEntry[] {
  if (entries) return entries;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    // Older builds also logged Google Drive actions; only OneDrive ones are kept.
    entries = Array.isArray(raw) ? (raw as CloudLogEntry[]).filter((e) => e && e.provider === 'onedrive' && typeof e.at === 'number' && typeof e.name === 'string') : [];
  } catch {
    entries = [];
  }
  return entries;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Kept for this visit only.
  }
  for (const l of listeners) l();
}

/** Notes one cloud action. */
export function logCloudAction(provider: CloudProvider, action: CloudAction, name: string, now = Date.now()) {
  const list = [...load()];
  // A Live Session saves a few files in turn; a recent line for the same thing is counted and moved last.
  const at = list.findIndex((e, i) => i >= list.length - RECENT && e.provider === provider && e.action === action && e.name === name);
  if (at >= 0) {
    const [same] = list.splice(at, 1);
    list.push({ ...same!, first: same!.first ?? same!.at, at: now, count: same!.count + 1 });
  } else {
    list.push({ at: now, provider, action, name, count: 1 });
    if (list.length > MAX) list.splice(0, list.length - MAX);
  }
  entries = list;
  save();
}

/** The actions noted so far, oldest first. */
export function cloudLog(): CloudLogEntry[] {
  return load();
}

export function clearCloudLog() {
  entries = [];
  save();
}

export function subscribeCloudLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
