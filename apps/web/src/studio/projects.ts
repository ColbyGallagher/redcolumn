import { googleAuth } from './drive/google';
import { studioServer } from './StudioSession';
import { offlineReason } from '../offline/network';

/**
 * Team Projects on the redcolumn server: shared folders of PDFs with check out / check in,
 * revisions, per-folder permissions and a Project Record. Projects this browser has opened are
 * remembered (with the owner key for those it made), and library files opened from a Project are
 * linked to the Project file and revision they came from.
 */

export type Level = 'none' | 'read' | 'write' | 'delete' | 'full';
export const LEVEL_LABELS: Record<Level, string> = { none: 'No access', read: 'Read', write: 'Read/Write', delete: 'Read/Write/Delete', full: 'Full Control' };
const RANK: Record<Level, number> = { none: 0, read: 1, write: 2, delete: 3, full: 4 };
export const atLeast = (have: Level | undefined, need: Level) => RANK[have ?? 'none'] >= RANK[need];

export interface Grant {
  who: string;
  level: Level;
}

export interface ProjectFolder {
  id: string;
  name: string;
  parentId: string | null;
  permissions?: { default?: Level; people: Grant[] };
}

export interface ProjectRevision {
  n: number;
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
  checkout: { by: string; key: string; at: number; note?: string } | null;
}

export interface ProjectView {
  id: string;
  name: string;
  owner: string;
  createdAt: number;
  members: Grant[];
  defaultLevel: Level;
  folders: ProjectFolder[];
  files: ProjectFile[];
  /** The viewer's level per folder id ('' is the top of the Project). */
  levels: Record<string, Level>;
}

export interface ProjectMe {
  name: string;
  email: string | null;
  isOwner: boolean;
  /** Matches `checkout.key` when the viewer holds a check-out. */
  key: string;
}

export interface ProjectRecordEntry {
  id: string;
  at: number;
  who: string;
  kind: string;
  text: string;
  fileId?: string;
  folderId?: string;
}

export class ProjectError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const KNOWN = 'nb.projects';
const LINKS = 'nb.projectLinks';

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Not remembered.
  }
}

/** Projects this browser has opened, most recent first. */
export interface KnownProject {
  id: string;
  name: string;
  ownerKey?: string;
}
export const knownProjects = (): KnownProject[] => read<KnownProject[]>(KNOWN, []);
export function rememberProject(p: KnownProject) {
  const old = knownProjects().find((x) => x.id === p.id);
  write(KNOWN, [{ ...old, ...p }, ...knownProjects().filter((x) => x.id !== p.id)]);
}
export function forgetProject(id: string) {
  write(KNOWN, knownProjects().filter((x) => x.id !== id));
}

/** A library file opened from a Project: which file and revision it is. */
export interface ProjectLink {
  projectId: string;
  fileId: string;
  rev: number;
  name: string;
}
export const projectLinks = (): Record<string, ProjectLink> => read<Record<string, ProjectLink>>(LINKS, {});
export const linkOf = (libraryId: string): ProjectLink | null => projectLinks()[libraryId] ?? null;
export function setLink(libraryId: string, link: ProjectLink | null) {
  const all = { ...projectLinks() };
  if (link) all[libraryId] = link;
  else delete all[libraryId];
  write(LINKS, all);
}
/** The library copy of a Project file, if there is one. */
export const libraryCopyOf = (projectId: string, fileId: string): string | null => Object.entries(projectLinks()).find(([, l]) => l.projectId === projectId && l.fileId === fileId)?.[0] ?? null;

async function call(path: string, init: RequestInit & { me: string; projectId?: string } ): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-studio-attendee', init.me);
  const key = init.projectId ? knownProjects().find((p) => p.id === init.projectId)?.ownerKey : undefined;
  if (key) headers.set('x-studio-project-key', key);
  const token = googleAuth.valid();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${studioServer()}${path}`, { ...init, headers });
  } catch {
    throw new ProjectError(navigator.onLine === false ? offlineReason('Team Projects') : `Cannot reach the redcolumn server at ${studioServer()}.`, 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ProjectError(body?.error ?? `redcolumn server error (${res.status}).`, res.status);
  }
  return res;
}

type Loaded = { project: ProjectView; me: ProjectMe };
const json = async <T>(res: Promise<Response>) => (await (await res).json()) as T;

/** A client for one person's view of the redcolumn server's Projects. */
export function projectsApi(me: string) {
  const at = (id: string, rest = '') => `/v1/projects/${encodeURIComponent(id)}${rest}`;
  const post = (id: string, rest: string, body: unknown) => json<Loaded & Record<string, unknown>>(call(at(id, rest), { method: 'POST', body: JSON.stringify(body ?? {}), me, projectId: id }));
  return {
    async create(name: string, defaultLevel: Level = 'none') {
      const r = await json<Loaded & { ownerKey: string }>(call('/v1/projects', { method: 'POST', body: JSON.stringify({ name, defaultLevel }), me }));
      rememberProject({ id: r.project.id, name: r.project.name, ownerKey: r.ownerKey });
      return r;
    },
    async get(id: string) {
      const r = await json<Loaded>(call(at(id), { me, projectId: id }));
      rememberProject({ id, name: r.project.name });
      return r;
    },
    update: (id: string, patch: { name?: string; members?: Grant[]; defaultLevel?: Level }) => json<Loaded>(call(at(id), { method: 'PATCH', body: JSON.stringify(patch), me, projectId: id })),
    record: (id: string, since = 0) => json<{ entries: ProjectRecordEntry[] }>(call(at(id, `/record?since=${since}`), { me, projectId: id })),
    newFolder: (id: string, name: string, parentId: string | null) => post(id, '/folders', { name, parentId }),
    updateFolder: (id: string, folderId: string, patch: { name?: string; parentId?: string | null; permissions?: { default?: Level; people: Grant[] } | null }) =>
      json<Loaded>(call(at(id, `/folders/${folderId}`), { method: 'PATCH', body: JSON.stringify(patch), me, projectId: id })),
    deleteFolder: (id: string, folderId: string) => json<Loaded>(call(at(id, `/folders/${folderId}`), { method: 'DELETE', me, projectId: id })),
    upload: (id: string, folderId: string | null, name: string, bytes: ArrayBuffer, comment = '') =>
      json<Loaded & { file: ProjectFile }>(call(at(id, `/files?${new URLSearchParams({ ...(folderId ? { folder: folderId } : {}), name, ...(comment ? { comment } : {}) })}`), { method: 'POST', body: bytes, headers: { 'content-type': 'application/pdf' }, me, projectId: id })),
    async download(id: string, fileId: string, rev?: number): Promise<{ bytes: ArrayBuffer; rev: number }> {
      const res = await call(at(id, `/files/${fileId}${rev ? `?rev=${rev}` : ''}`), { me, projectId: id });
      return { bytes: await res.arrayBuffer(), rev: Number(res.headers.get('x-revision') ?? rev ?? 0) };
    },
    updateFile: (id: string, fileId: string, patch: { name?: string; folderId?: string | null }) => json<Loaded>(call(at(id, `/files/${fileId}`), { method: 'PATCH', body: JSON.stringify(patch), me, projectId: id })),
    deleteFile: (id: string, fileId: string) => json<Loaded>(call(at(id, `/files/${fileId}`), { method: 'DELETE', me, projectId: id })),
    checkout: (id: string, fileId: string, note = '') => post(id, `/files/${fileId}/checkout`, { note }) as Promise<Loaded & { file: ProjectFile }>,
    undoCheckout: (id: string, fileId: string) => post(id, `/files/${fileId}/undo-checkout`, {}) as Promise<Loaded & { file: ProjectFile }>,
    checkin: (id: string, fileId: string, bytes: ArrayBuffer, comment: string, keep = false) =>
      json<Loaded & { file: ProjectFile }>(call(at(id, `/files/${fileId}/checkin?${new URLSearchParams({ comment, ...(keep ? { keep: '1' } : {}) })}`), { method: 'POST', body: bytes, headers: { 'content-type': 'application/pdf' }, me, projectId: id })),
    restore: (id: string, fileId: string, n: number) => post(id, `/files/${fileId}/restore`, { n }) as Promise<Loaded & { file: ProjectFile }>,
    note: (id: string, fileId: string, text: string) => json<{ ok: boolean }>(call(at(id, `/files/${fileId}/note`), { method: 'POST', body: JSON.stringify({ text }), me, projectId: id })),
    invite: (id: string, emails: string[], level: Level, note: string) =>
      json<Loaded & { sent: { sent: boolean; failed: string[] } }>(call(at(id, '/invite'), { method: 'POST', body: JSON.stringify({ emails, level, note }), me, projectId: id })),
  };
}

export type ProjectsApi = ReturnType<typeof projectsApi>;

/** A folder's path from the top of the Project, as names. */
export function folderPath(p: Pick<ProjectView, 'folders'>, folderId: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let id = folderId; id && !seen.has(id); ) {
    seen.add(id);
    const f = p.folders.find((x) => x.id === id);
    if (!f) break;
    out.unshift(f.name);
    id = f.parentId;
  }
  return out;
}

/** A mailto: link for an invitation, for when the server cannot send mail. */
export function mailtoInvite(emails: string[], subject: string, lines: string[]): string {
  return `mailto:${emails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

/** Splits typed addresses (commas, semicolons, spaces or new lines). */
export const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
