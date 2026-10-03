/**
 * Team Projects: shared folders of PDFs on the redcolumn server, with check out / check in,
 * every check-in kept as a revision, per-folder permissions and a Project Record.
 */

/** What someone may do in a folder (and the folders inside it). */
export type Level = 'none' | 'read' | 'write' | 'delete' | 'full';
export const LEVELS: readonly Level[] = ['none', 'read', 'write', 'delete', 'full'];
const RANK: Record<Level, number> = { none: 0, read: 1, write: 2, delete: 3, full: 4 };
export const atLeast = (have: Level, need: Level) => RANK[have] >= RANK[need];

/** A person (a Google account email, or a name) and their level. */
export interface Grant {
  who: string;
  level: Level;
}

export interface ProjectFolder {
  id: string;
  name: string;
  /** null: at the top of the Project. */
  parentId: string | null;
  /** Set on a folder, these replace what it would inherit: for the people listed, and for everyone else if `default` is given. */
  permissions?: { default?: Level; people: Grant[] };
}

export interface ProjectRevision {
  n: number;
  /** SHA-256 of the PDF (its file name on the server). */
  blob: string;
  size: number;
  at: number;
  by: string;
  comment: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  folderId: string | null;
  revisions: ProjectRevision[];
  /** Checked out: only this person can check in until they check it in or undo. */
  checkout: { by: string; key: string; at: number; note?: string } | null;
}

export interface ProjectMeta {
  id: string;
  name: string;
  owner: string;
  ownerEmail?: string;
  createdAt: number;
  /** Project-wide levels; folders can override them. */
  members: Grant[];
  /** Everyone else with the Project ID. `none` makes the Project private to its members. */
  defaultLevel: Level;
  folders: ProjectFolder[];
  files: ProjectFile[];
}

export interface ProjectRecordEntry {
  id: string;
  at: number;
  who: string;
  kind: 'project' | 'folder' | 'file' | 'checkout' | 'checkin' | 'permissions' | 'session';
  text: string;
  fileId?: string;
  folderId?: string;
}

export interface Person {
  name: string;
  email: string | null;
  isOwner: boolean;
}

/** Who holds a check-out: their Google email when signed in, else their name. */
export const personKey = (p: Pick<Person, 'name' | 'email'>) => (p.email ?? p.name).trim().toLowerCase();

const matches = (grant: Grant, p: Person) => {
  const w = grant.who.trim().toLowerCase();
  return !!w && (w === p.name.trim().toLowerCase() || (!!p.email && w === p.email.toLowerCase()));
};

/** The folder and the folders it is in, innermost first. */
export function folderChain(meta: ProjectMeta, folderId: string | null): ProjectFolder[] {
  const out: ProjectFolder[] = [];
  const seen = new Set<string>();
  for (let id = folderId; id && !seen.has(id); ) {
    seen.add(id);
    const f = meta.folders.find((x) => x.id === id);
    if (!f) break;
    out.push(f);
    id = f.parentId;
  }
  return out;
}

/**
 * What `p` may do in a folder: the owner always has full control; otherwise the innermost folder
 * with a rule for them (by name or email, else its default) decides, then the Project's members
 * list, then the Project default.
 */
export function levelFor(meta: ProjectMeta, folderId: string | null, p: Person): Level {
  if (p.isOwner) return 'full';
  for (const f of folderChain(meta, folderId)) {
    const rules = f.permissions;
    if (!rules) continue;
    const mine = rules.people.find((g) => matches(g, p));
    if (mine) return mine.level;
    if (rules.default) return rules.default;
  }
  return meta.members.find((g) => matches(g, p))?.level ?? meta.defaultLevel;
}

/** The Project as `p` sees it: folders and files they cannot read are left out. */
export function visibleTo(meta: ProjectMeta, p: Person): ProjectMeta & { levels: Record<string, Level> } {
  const levels: Record<string, Level> = { '': levelFor(meta, null, p) };
  for (const f of meta.folders) levels[f.id] = levelFor(meta, f.id, p);
  const folders = meta.folders.filter((f) => atLeast(levels[f.id]!, 'read'));
  const files = meta.files.filter((f) => atLeast(levels[f.folderId ?? '']!, 'read'));
  const out = { ...meta, folders, files, levels };
  // Who else has access is for those who can change it.
  if (!atLeast(levels['']!, 'full')) {
    out.members = [];
    out.folders = folders.map(({ permissions: _, ...f }) => f);
  }
  return out;
}

/** Levels given by a client, cleaned: known levels only, short names, no duplicates. */
export function cleanGrants(raw: unknown): Grant[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Grant[] = [];
  for (const g of raw as Partial<Grant>[]) {
    const who = typeof g?.who === 'string' ? g.who.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
    if (!who || !LEVELS.includes(g.level as Level) || out.some((x) => x.who.toLowerCase() === who.toLowerCase())) continue;
    out.push({ who, level: g.level as Level });
  }
  return out;
}

/** A file or folder name: no path separators or control characters. */
export function cleanItemName(raw: unknown, max = 200): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, max) : '';
}

/** Whether moving folder `id` under `parentId` would put it inside itself. */
export function wouldCycle(meta: ProjectMeta, id: string, parentId: string | null): boolean {
  return folderChain(meta, parentId).some((f) => f.id === id);
}
