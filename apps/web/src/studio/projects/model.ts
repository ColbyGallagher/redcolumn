/**
 * Projects: a shared OneDrive folder of PDFs with check out / check in, a revision for every
 * check-in, and a Project Record. There is no server, so nothing here has two writers: every
 * piece of state is its own file in the folder, written by one person, and the view is built by
 * reading the folder.
 *
 * Files in the Project folder (a flat folder; names carry the structure):
 *   project.json            the owner's: name, owner, members shown in the UI
 *   dir-<id>.json           a folder of the Project, made by whoever added it
 *   f-<fileId>-r0001.pdf    one immutable PDF per revision
 *   f-<fileId>-r0001.json   its sidecar; a revision exists once this is written (PDF goes up first)
 *   lock-<fileId>-<claim>.json  a check-out claim; the earliest claim for a file holds it
 *   edit-<id>-<claim>.json  a rename, move or delete of a file or folder; the drive's order decides
 *   rec-<person>.json       one person's share of the Project Record
 */

/** What someone may do. OneDrive's own sharing is what enforces it; the app follows it. */
export type Level = 'viewer' | 'editor' | 'owner';
export const LEVEL_LABELS: Record<Level, string> = { viewer: 'Can view', editor: 'Can edit', owner: 'Owner' };

export interface Person {
  name: string;
  /** Their Microsoft account email, when known. */
  email: string | null;
}

/** Who holds a check-out or wrote a record: their email when signed in, else their name. */
export const personKey = (p: Person) => (p.email ?? p.name).trim().toLowerCase();

/** A person key as it can sit in a file name. */
export const keyForFileName = (key: string) => key.replace(/[^a-z0-9@._-]/g, '_').slice(0, 60);

export interface Grant {
  who: string;
  level: Exclude<Level, 'owner'>;
}

/** project.json */
export interface ProjectManifest {
  v: 1;
  name: string;
  owner: string;
  ownerEmail?: string;
  createdAt: number;
  /** People the owner invited, for the members list. OneDrive's sharing decides who can really get in. */
  members: Grant[];
}

export interface ProjectFolder {
  id: string;
  name: string;
  /** null: at the top of the Project. */
  parentId: string | null;
  by: string;
  at: number;
}

export interface ProjectRevision {
  n: number;
  name: string;
  folderId: string | null;
  size: number;
  /** SHA-256 of the PDF, hex. */
  sha256: string;
  at: number;
  by: string;
  comment: string;
}

export interface Checkout {
  by: string;
  key: string;
  at: number;
  note?: string;
  /** The lock file, so it can be released. */
  lockId: string;
}

export interface ProjectFile {
  id: string;
  /** Name, folder and so on as of the latest revision. */
  name: string;
  folderId: string | null;
  revisions: ProjectRevision[];
  checkout: Checkout | null;
}

export type RecordKind = 'project' | 'folder' | 'file' | 'checkout' | 'checkin' | 'members';

export interface ProjectRecordEntry {
  id: string;
  at: number;
  who: string;
  kind: RecordKind;
  text: string;
  fileId?: string;
  folderId?: string;
}

export const MANIFEST_NAME = 'project.json';

/** Roles kept in file properties, so a listing sorts the folder's files without reading them. */
export const ROLE = { manifest: 'pmanifest', dir: 'pdir', rev: 'prev', lock: 'plock', record: 'prec', edit: 'pedit' } as const;

export const pad = (n: number) => String(n).padStart(4, '0');
export const pdfName = (fileId: string, n: number) => `f-${fileId}-r${pad(n)}.pdf`;
export const sidecarName = (fileId: string, n: number) => `f-${fileId}-r${pad(n)}.json`;

/** A file or folder name: no path separators or control characters. */
export function cleanItemName(raw: unknown, max = 200): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, max) : '';
}

/** A short random ID for folders, files and lock claims. */
export const newId = () => Math.random().toString(36).slice(2, 10);

/** The folder and the folders it is in, innermost first. */
export function folderChain(folders: ProjectFolder[], folderId: string | null): ProjectFolder[] {
  const out: ProjectFolder[] = [];
  const seen = new Set<string>();
  for (let id = folderId; id && !seen.has(id); ) {
    seen.add(id);
    const f = folders.find((x) => x.id === id);
    if (!f) break;
    out.push(f);
    id = f.parentId;
  }
  return out;
}

/** "Plans / Level 2" style path for a folder. */
export const folderPath = (folders: ProjectFolder[], folderId: string | null) =>
  folderChain(folders, folderId)
    .map((f) => f.name)
    .reverse()
    .join(' / ');

/** One lock claim as listed. */
export interface LockClaim {
  lockId: string;
  fileId: string;
  by: string;
  key: string;
  at: number;
  note?: string;
  /** Order the drive made it in. */
  created: string;
}

/**
 * Who holds each file: the earliest claim, by the time the drive made it. Two people claiming at
 * once both see the same winner, and the loser removes their claim.
 */
export function holders(claims: LockClaim[]): Map<string, LockClaim> {
  const out = new Map<string, LockClaim>();
  for (const c of claims) {
    const cur = out.get(c.fileId);
    if (!cur || c.created < cur.created || (c.created === cur.created && c.lockId < cur.lockId)) out.set(c.fileId, c);
  }
  return out;
}

/**
 * A rename, move or delete of a file or folder. Written as a file of its own so nobody overwrites
 * anybody; applied in the order the drive made them, and only over what is older than it.
 */
export interface EditRecord {
  target: 'file' | 'folder';
  id: string;
  name?: string;
  /** The new folder (for a folder, its new parent); null is the top of the Project. Absent: unchanged. */
  to?: string | null;
  deleted?: boolean;
  /** When the drive made the edit file, and its ID (the tie-break). */
  created: string;
  key: string;
}

const inOrder = (a: { created: string; key: string }, b: { created: string; key: string }) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Folders with their renames, moves and deletes applied (deleted ones are kept, marked). */
export function applyFolderEdits(folders: (ProjectFolder & { created: string })[], edits: EditRecord[]): (ProjectFolder & { deleted?: boolean })[] {
  const out = folders.map((f) => ({ ...f }) as ProjectFolder & { created: string; deleted?: boolean });
  for (const e of [...edits].filter((x) => x.target === 'folder').sort(inOrder)) {
    const f = out.find((x) => x.id === e.id);
    if (!f || e.created < f.created) continue;
    if (e.name !== undefined) f.name = e.name;
    if (e.to !== undefined) f.parentId = e.to;
    if (e.deleted !== undefined) f.deleted = e.deleted;
  }
  return out.map(({ created: _c, ...f }) => f);
}

/**
 * Folds revision sidecars into files. The latest revision names and places a file; edits made after
 * it (by the drive's order) rename, move or delete it. A check-in carries the file's current name
 * and folder, so edits older than the latest revision are already part of it.
 */
export function buildFiles(revisions: (ProjectRevision & { fileId: string; created: string })[], claims: LockClaim[], edits: EditRecord[] = []): (ProjectFile & { deleted?: boolean })[] {
  const held = holders(claims);
  const byFile = new Map<string, (ProjectRevision & { fileId: string; created: string })[]>();
  for (const r of revisions) byFile.set(r.fileId, [...(byFile.get(r.fileId) ?? []), r]);
  const fileEdits = [...edits].filter((x) => x.target === 'file').sort(inOrder);
  const files: (ProjectFile & { deleted?: boolean })[] = [];
  for (const [id, list] of byFile) {
    list.sort((a, b) => a.n - b.n);
    const latest = list[list.length - 1]!;
    let name = latest.name;
    let folderId = latest.folderId;
    let deleted = false;
    for (const e of fileEdits) {
      if (e.id !== id || e.created < latest.created) continue;
      if (e.name !== undefined) name = e.name;
      if (e.to !== undefined) folderId = e.to;
      if (e.deleted !== undefined) deleted = e.deleted;
    }
    const lock = held.get(id);
    files.push({
      id,
      name,
      folderId,
      revisions: list.map(({ fileId: _f, created: _c, ...r }) => r),
      checkout: lock ? { by: lock.by, key: lock.key, at: lock.at, ...(lock.note ? { note: lock.note } : {}), lockId: lock.lockId } : null,
      ...(deleted ? { deleted } : {}),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Folders that are deleted, or inside one that is. */
export function deletedFolderIds(folders: (ProjectFolder & { deleted?: boolean })[]): Set<string> {
  const out = new Set<string>();
  for (const f of folders) {
    const seen = new Set<string>();
    for (let cur: (ProjectFolder & { deleted?: boolean }) | undefined = f; cur && !seen.has(cur.id); cur = folders.find((x) => x.id === cur!.parentId)) {
      seen.add(cur.id);
      if (cur.deleted) {
        out.add(f.id);
        break;
      }
    }
  }
  return out;
}

/** What is left once deleted files and folders (and what is inside deleted folders) are taken out. */
export function liveView(folders: (ProjectFolder & { deleted?: boolean })[], files: (ProjectFile & { deleted?: boolean })[]) {
  const gone = deletedFolderIds(folders);
  return {
    folders: folders.filter((f) => !gone.has(f.id)).map(({ deleted: _d, ...f }) => f as ProjectFolder),
    files: files.filter((f) => !f.deleted && !(f.folderId && gone.has(f.folderId))).map(({ deleted: _d, ...f }) => f as ProjectFile),
  };
}

/** The folder's subfolders at any depth. */
export function descendantFolders(folders: ProjectFolder[], folderId: string): ProjectFolder[] {
  const out: ProjectFolder[] = [];
  const queue = [folderId];
  while (queue.length) {
    const id = queue.pop()!;
    for (const f of folders) if (f.parentId === id && !out.includes(f)) (out.push(f), queue.push(f.id));
  }
  return out;
}

/** Whether moving folder `id` under `parentId` would put it inside itself. */
export const wouldCycle = (folders: ProjectFolder[], id: string, parentId: string | null) => parentId === id || folderChain(folders, parentId).some((f) => f.id === id);

/** Everyone's Record shards as one list, oldest first (entries of one shard keep their order). */
export const mergeRecord = (shards: ProjectRecordEntry[][]): ProjectRecordEntry[] => shards.flat().sort((a, b) => a.at - b.at);
