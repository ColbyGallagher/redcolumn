import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { formatSessionId, parseSessionId } from './protocol.ts';
import { cleanEmails, InviteLimit, invitationText, type Mailer } from './mailer.ts';
import {
  atLeast,
  cleanGrants,
  cleanItemName,
  LEVELS,
  levelFor,
  personKey,
  visibleTo,
  wouldCycle,
  type Level,
  type Person,
  type ProjectFile,
  type ProjectMeta,
  type ProjectRecordEntry,
} from './projectModel.ts';

const MAX_PDF_BYTES = 250 * 1024 * 1024;
const MAX_RECORD = 5000;

interface StoredProject {
  meta: ProjectMeta;
  ownerKey: string;
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${randomBytes(3).toString('hex')}`;

async function writeAtomic(path: string, data: string | Uint8Array) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

const isPdf = (b: Uint8Array) => b.byteLength >= 5 && new TextDecoder().decode(b.subarray(0, 5)) === '%PDF-';

/** One Project: its metadata and Record as JSON, its PDFs by content hash. */
export class Project {
  private dir: string;
  private stored: StoredProject;
  private recordCache: ProjectRecordEntry[] | null = null;
  /** Changes are applied one at a time, so two check-ins cannot interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string, stored: StoredProject) {
    this.dir = dir;
    this.stored = stored;
  }

  get meta() {
    return this.stored.meta;
  }

  isOwnerKey(key: string | null | undefined): boolean {
    if (!key) return false;
    const a = Buffer.from(key);
    const b = Buffer.from(this.stored.ownerKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Runs changes one after another. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async save() {
    await writeAtomic(join(this.dir, 'project.json'), JSON.stringify(this.stored));
  }

  async record(): Promise<ProjectRecordEntry[]> {
    if (!this.recordCache) this.recordCache = await readFile(join(this.dir, 'record.json'), 'utf8').then((t) => JSON.parse(t) as ProjectRecordEntry[], () => []);
    return this.recordCache;
  }

  async note(who: string, kind: ProjectRecordEntry['kind'], text: string, extra: Partial<ProjectRecordEntry> = {}) {
    const log = await this.record();
    log.push({ id: newId(), at: Date.now(), who, kind, text, ...extra });
    if (log.length > MAX_RECORD) log.splice(0, log.length - MAX_RECORD);
    await writeAtomic(join(this.dir, 'record.json'), JSON.stringify(log));
  }

  async putBlob(bytes: Uint8Array): Promise<string> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(this.dir, 'blobs'), { recursive: true });
    const path = join(this.dir, 'blobs', `${hash}.pdf`);
    await readFile(path).catch(() => writeAtomic(path, bytes));
    return hash;
  }

  blobPath(hash: string) {
    return /^[0-9a-f]{64}$/.test(hash) ? join(this.dir, 'blobs', `${hash}.pdf`) : null;
  }

  file(id: string): ProjectFile | undefined {
    return this.meta.files.find((f) => f.id === id);
  }
}

/** All Projects, one directory each under `dataDir`. */
export class ProjectRegistry {
  private projects = new Map<string, Project>();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private dirFor(id: string) {
    return join(this.dataDir, id);
  }

  async create(name: string, owner: string, ownerEmail: string | null, defaultLevel: Level): Promise<{ project: Project; ownerKey: string }> {
    await mkdir(this.dataDir, { recursive: true });
    const taken = new Set(await readdir(this.dataDir).catch(() => []));
    let id: string;
    do id = formatSessionId(String(randomInt(100_000_000, 1_000_000_000)));
    while (taken.has(id) || this.projects.has(id));
    const ownerKey = randomBytes(24).toString('base64url');
    const meta: ProjectMeta = { id, name, owner, createdAt: Date.now(), members: [], defaultLevel, folders: [], files: [] };
    if (ownerEmail) meta.ownerEmail = ownerEmail;
    await mkdir(this.dirFor(id), { recursive: true });
    const project = new Project(this.dirFor(id), { meta, ownerKey });
    await project.save();
    this.projects.set(id, project);
    await project.note(owner, 'project', `created the Project “${name}”`);
    return { project, ownerKey };
  }

  async get(id: string): Promise<Project | null> {
    const live = this.projects.get(id);
    if (live) return live;
    try {
      const stored = JSON.parse(await readFile(join(this.dirFor(id), 'project.json'), 'utf8')) as StoredProject;
      const project = this.projects.get(id) ?? new Project(this.dirFor(id), stored);
      this.projects.set(id, project);
      return project;
    } catch {
      return null;
    }
  }
}

export interface ProjectDeps {
  emailOf: (c: Context) => Promise<string | null>;
  attendeeOf: (c: Context) => string;
  mailer: Mailer | null;
  /** The app's address, for links in invitations (null: the ID alone). */
  appUrl: (c: Context) => string | null;
}

/** The Project routes, under /v1/projects. */
export function mountProjects(app: Hono, registry: ProjectRegistry, deps: ProjectDeps) {
  const limit = new InviteLimit();

  const personOf = async (c: Context, p: Project): Promise<Person> => {
    const email = await deps.emailOf(c);
    const isOwner = p.isOwnerKey(c.req.header('x-studio-project-key')) || (!!email && email === p.meta.ownerEmail);
    return { name: deps.attendeeOf(c), email, isOwner };
  };

  const load = async (c: Context): Promise<Project | Response> => {
    const id = parseSessionId(c.req.param('id') ?? '');
    const p = id ? await registry.get(id) : null;
    return p ?? c.json({ error: 'No Project with that ID.' }, 404);
  };

  /** The Project and the person, or a refusal when they cannot even read it. */
  const open = async (c: Context) => {
    const p = await load(c);
    if (p instanceof Response) return p;
    const who = await personOf(c, p);
    const seen = visibleTo(p.meta, who);
    if (!atLeast(seen.levels['']!, 'read') && !seen.folders.length) return c.json({ error: 'You do not have access to this Project. Ask its owner to add you.' }, 403);
    return { p, who };
  };

  const denied = (c: Context, what: string) => c.json({ error: `You do not have permission to ${what} here.` }, 403);
  const view = (p: Project, who: Person) => ({ project: visibleTo(p.meta, who), me: { name: who.name, email: who.email, isOwner: who.isOwner, key: personKey(who) } });
  const folderOk = (p: Project, id: unknown): id is string | null => id === null || (typeof id === 'string' && p.meta.folders.some((f) => f.id === id));

  app.post('/v1/projects', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: string; owner?: string; defaultLevel?: Level } | null;
    const name = cleanItemName(body?.name, 120);
    if (!name) return c.json({ error: 'A Project needs a name.' }, 400);
    const owner = deps.attendeeOf(c);
    const level = LEVELS.includes(body?.defaultLevel as Level) ? (body!.defaultLevel as Level) : 'none';
    const { project, ownerKey } = await registry.create(name, owner, await deps.emailOf(c), level);
    return c.json({ ...view(project, { name: owner, email: await deps.emailOf(c), isOwner: true }), ownerKey }, 201);
  });

  app.get('/v1/projects/:id', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    return c.json(view(o.p, o.who));
  });

  app.patch('/v1/projects/:id', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    if (!atLeast(levelFor(p.meta, null, who), 'full')) return denied(c, 'change the Project');
    const body = (await c.req.json().catch(() => null)) as { name?: string; members?: unknown; defaultLevel?: Level } | null;
    return p.serial(async () => {
      const name = cleanItemName(body?.name, 120);
      if (name && name !== p.meta.name) {
        await p.note(who.name, 'project', `renamed the Project to “${name}”`);
        p.meta.name = name;
      }
      const members = body && 'members' in body ? cleanGrants(body.members) : null;
      if (members) {
        p.meta.members = members;
        await p.note(who.name, 'permissions', `set the Project members: ${members.map((m) => `${m.who} (${m.level})`).join(', ') || 'none'}`);
      }
      if (body?.defaultLevel && LEVELS.includes(body.defaultLevel) && body.defaultLevel !== p.meta.defaultLevel) {
        p.meta.defaultLevel = body.defaultLevel;
        await p.note(who.name, 'permissions', `set access for everyone else with the ID to ${body.defaultLevel}`);
      }
      await p.save();
      return c.json(view(p, who));
    });
  });

  app.get('/v1/projects/:id/record', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const seen = visibleTo(p.meta, who);
    const readable = new Set(Object.entries(seen.levels).filter(([, l]) => atLeast(l, 'read')).map(([k]) => k));
    const since = Number(c.req.query('since') ?? 0) || 0;
    const entries = (await p.record()).filter((e) => {
      if (e.at <= since) return false;
      if (e.fileId) {
        const f = p.file(e.fileId);
        return f ? readable.has(f.folderId ?? '') : readable.has('');
      }
      if (e.folderId) return readable.has(e.folderId);
      return true;
    });
    return c.json({ entries });
  });

  // --- Folders ---

  app.post('/v1/projects/:id/folders', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const body = (await c.req.json().catch(() => null)) as { name?: string; parentId?: string | null } | null;
    const name = cleanItemName(body?.name, 120);
    const parentId = body?.parentId ?? null;
    if (!name) return c.json({ error: 'A folder needs a name.' }, 400);
    if (!folderOk(p, parentId)) return c.json({ error: 'No such folder.' }, 404);
    if (!atLeast(levelFor(p.meta, parentId, who), 'write')) return denied(c, 'add folders');
    return p.serial(async () => {
      const folder = { id: newId(), name, parentId };
      p.meta.folders.push(folder);
      await p.save();
      await p.note(who.name, 'folder', `created the folder “${name}”`, { folderId: folder.id });
      return c.json({ folder, ...view(p, who) }, 201);
    });
  });

  app.patch('/v1/projects/:id/folders/:folder', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const folder = p.meta.folders.find((f) => f.id === c.req.param('folder'));
    if (!folder) return c.json({ error: 'No such folder.' }, 404);
    const body = (await c.req.json().catch(() => null)) as { name?: string; parentId?: string | null; permissions?: { default?: Level | null; people?: unknown } | null } | null;
    return p.serial(async () => {
      if (body?.permissions !== undefined) {
        if (!atLeast(levelFor(p.meta, folder.id, who), 'full')) return denied(c, 'change permissions');
        if (body.permissions === null) delete folder.permissions;
        else {
          const people = cleanGrants(body.permissions.people ?? []) ?? [];
          const def = body.permissions.default;
          folder.permissions = { people, ...(def && LEVELS.includes(def) ? { default: def } : {}) };
        }
        await p.note(who.name, 'permissions', body.permissions === null ? `made “${folder.name}” inherit its permissions` : `set the permissions of “${folder.name}”`, { folderId: folder.id });
      }
      const name = cleanItemName(body?.name, 120);
      if (name && name !== folder.name) {
        if (!atLeast(levelFor(p.meta, folder.id, who), 'write')) return denied(c, 'rename folders');
        await p.note(who.name, 'folder', `renamed the folder “${folder.name}” to “${name}”`, { folderId: folder.id });
        folder.name = name;
      }
      if (body && 'parentId' in body && body.parentId !== folder.parentId) {
        const to = body.parentId ?? null;
        if (!folderOk(p, to) || wouldCycle(p.meta, folder.id, to)) return c.json({ error: 'A folder cannot go there.' }, 400);
        if (!atLeast(levelFor(p.meta, folder.id, who), 'delete') || !atLeast(levelFor(p.meta, to, who), 'write')) return denied(c, 'move folders');
        folder.parentId = to;
        await p.note(who.name, 'folder', `moved the folder “${folder.name}”`, { folderId: folder.id });
      }
      await p.save();
      return c.json(view(p, who));
    });
  });

  app.delete('/v1/projects/:id/folders/:folder', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const folder = p.meta.folders.find((f) => f.id === c.req.param('folder'));
    if (!folder) return c.json({ error: 'No such folder.' }, 404);
    if (!atLeast(levelFor(p.meta, folder.id, who), 'delete')) return denied(c, 'delete folders');
    if (p.meta.files.some((f) => f.folderId === folder.id) || p.meta.folders.some((f) => f.parentId === folder.id)) return c.json({ error: 'Only empty folders can be deleted.' }, 409);
    return p.serial(async () => {
      p.meta.folders = p.meta.folders.filter((f) => f !== folder);
      await p.save();
      await p.note(who.name, 'folder', `deleted the folder “${folder.name}”`);
      return c.json(view(p, who));
    });
  });

  // --- Files ---

  const pdfBody = bodyLimit({ maxSize: MAX_PDF_BYTES, onError: (c) => c.json({ error: 'That PDF is too large.' }, 413) });

  app.post('/v1/projects/:id/files', pdfBody, async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const folderId = c.req.query('folder') || null;
    if (!folderOk(p, folderId)) return c.json({ error: 'No such folder.' }, 404);
    if (!atLeast(levelFor(p.meta, folderId, who), 'write')) return denied(c, 'add files');
    const name = cleanItemName(c.req.query('name')) || 'Document.pdf';
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!isPdf(bytes)) return c.json({ error: 'Only PDF files can be added.' }, 415);
    const comment = cleanItemName(c.req.query('comment'), 500);
    return p.serial(async () => {
      if (p.meta.files.some((f) => f.folderId === folderId && f.name.toLowerCase() === name.toLowerCase())) return c.json({ error: `There is already a file called ${name} there: check it out and in to add a revision.` }, 409);
      const blob = await p.putBlob(bytes);
      const file: ProjectFile = { id: newId(), name, folderId, checkout: null, revisions: [{ n: 1, blob, size: bytes.byteLength, at: Date.now(), by: who.name, comment: comment || 'Added' }] };
      p.meta.files.push(file);
      await p.save();
      await p.note(who.name, 'file', `added ${name}`, { fileId: file.id });
      return c.json({ file, ...view(p, who) }, 201);
    });
  });

  /** The file, with the person's level in its folder. */
  const fileOf = (c: Context, p: Project, who: Person) => {
    const file = p.file(c.req.param('file') ?? '');
    return file ? { file, level: levelFor(p.meta, file.folderId, who) } : null;
  };

  app.get('/v1/projects/:id/files/:file', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const f = fileOf(c, o.p, o.who);
    if (!f || !atLeast(f.level, 'read')) return c.json({ error: 'No such file.' }, 404);
    const n = Number(c.req.query('rev') ?? 0);
    const rev = n ? f.file.revisions.find((r) => r.n === n) : f.file.revisions.at(-1);
    const path = rev && o.p.blobPath(rev.blob);
    if (!rev || !path) return c.json({ error: 'No such revision.' }, 404);
    return c.body(await readFile(path), 200, { 'content-type': 'application/pdf', 'x-revision': String(rev.n), 'access-control-expose-headers': 'x-revision', 'cache-control': 'private, no-cache' });
  });

  app.patch('/v1/projects/:id/files/:file', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const f = fileOf(c, p, who);
    if (!f || !atLeast(f.level, 'read')) return c.json({ error: 'No such file.' }, 404);
    const body = (await c.req.json().catch(() => null)) as { name?: string; folderId?: string | null } | null;
    return p.serial(async () => {
      const { file } = f;
      if (file.checkout && file.checkout.key !== personKey(who)) return c.json({ error: `${file.checkout.by} has it checked out.` }, 409);
      const name = cleanItemName(body?.name);
      if (name && name !== file.name) {
        if (!atLeast(f.level, 'write')) return denied(c, 'rename files');
        await p.note(who.name, 'file', `renamed ${file.name} to ${name}`, { fileId: file.id });
        file.name = name;
      }
      if (body && 'folderId' in body && (body.folderId ?? null) !== file.folderId) {
        const to = body.folderId ?? null;
        if (!folderOk(p, to)) return c.json({ error: 'No such folder.' }, 404);
        if (!atLeast(f.level, 'delete') || !atLeast(levelFor(p.meta, to, who), 'write')) return denied(c, 'move files');
        file.folderId = to;
        await p.note(who.name, 'file', `moved ${file.name} to ${to ? p.meta.folders.find((x) => x.id === to)!.name : 'the top of the Project'}`, { fileId: file.id });
      }
      await p.save();
      return c.json(view(p, who));
    });
  });

  app.delete('/v1/projects/:id/files/:file', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const f = fileOf(c, p, who);
    if (!f || !atLeast(f.level, 'read')) return c.json({ error: 'No such file.' }, 404);
    if (!atLeast(f.level, 'delete')) return denied(c, 'delete files');
    return p.serial(async () => {
      if (f.file.checkout && f.file.checkout.key !== personKey(who)) return c.json({ error: `${f.file.checkout.by} has it checked out.` }, 409);
      p.meta.files = p.meta.files.filter((x) => x !== f.file);
      await p.save();
      await p.note(who.name, 'file', `deleted ${f.file.name}`);
      return c.json(view(p, who));
    });
  });

  app.post('/v1/projects/:id/files/:file/checkout', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const f = fileOf(c, p, who);
    if (!f || !atLeast(f.level, 'read')) return c.json({ error: 'No such file.' }, 404);
    if (!atLeast(f.level, 'write')) return denied(c, 'check out files');
    const body = (await c.req.json().catch(() => null)) as { note?: string } | null;
    return p.serial(async () => {
      const { file } = f;
      if (file.checkout && file.checkout.key !== personKey(who)) return c.json({ error: `${file.checkout.by} has it checked out.` }, 409);
      const note = cleanItemName(body?.note, 200);
      file.checkout = { by: who.name, key: personKey(who), at: Date.now(), ...(note ? { note } : {}) };
      await p.save();
      await p.note(who.name, 'checkout', `checked out ${file.name}${note ? ` (${note})` : ''}`, { fileId: file.id });
      return c.json({ file, ...view(p, who) });
    });
  });

  app.post('/v1/projects/:id/files/:file/undo-checkout', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const f = fileOf(c, p, who);
    if (!f || !atLeast(f.level, 'read')) return c.json({ error: 'No such file.' }, 404);
    return p.serial(async () => {
      const { file } = f;
      if (!file.checkout) return c.json(view(p, who));
      const mine = file.checkout.key === personKey(who);
      // Someone with full control can release another person's check-out.
      if (!mine && !atLeast(f.level, 'full')) return c.json({ error: `${file.checkout.by} has it checked out.` }, 409);
      const holder = file.checkout.by;
      file.checkout = null;
      await p.save();
      await p.note(who.name, 'checkout', mine ? `undid the check-out of ${file.name}` : `released ${holder}’s check-out of ${file.name}`, { fileId: file.id });
      return c.json({ file, ...view(p, who) });
    });
  });

  app.post('/v1/projects/:id/files/:file/checkin', pdfBody, async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const f = fileOf(c, p, who);
    if (!f || !atLeast(f.level, 'read')) return c.json({ error: 'No such file.' }, 404);
    if (!atLeast(f.level, 'write')) return denied(c, 'check in files');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!isPdf(bytes)) return c.json({ error: 'Only PDF files can be checked in.' }, 415);
    const comment = cleanItemName(c.req.query('comment'), 500);
    const keep = c.req.query('keep') === '1';
    return p.serial(async () => {
      const { file } = f;
      if (!file.checkout || file.checkout.key !== personKey(who)) return c.json({ error: file.checkout ? `${file.checkout.by} has it checked out.` : 'Check the file out first.' }, 409);
      const blob = await p.putBlob(bytes);
      const n = (file.revisions.at(-1)?.n ?? 0) + 1;
      file.revisions.push({ n, blob, size: bytes.byteLength, at: Date.now(), by: who.name, comment: comment || `Revision ${n}` });
      if (!keep) file.checkout = null;
      await p.save();
      await p.note(who.name, 'checkin', `checked in ${file.name} as revision ${n}${comment ? `: ${comment}` : ''}`, { fileId: file.id });
      return c.json({ file, ...view(p, who) });
    });
  });

  app.post('/v1/projects/:id/files/:file/restore', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    const f = fileOf(c, p, who);
    if (!f || !atLeast(f.level, 'read')) return c.json({ error: 'No such file.' }, 404);
    if (!atLeast(f.level, 'write')) return denied(c, 'restore revisions');
    const body = (await c.req.json().catch(() => null)) as { n?: number } | null;
    return p.serial(async () => {
      const { file } = f;
      if (file.checkout && file.checkout.key !== personKey(who)) return c.json({ error: `${file.checkout.by} has it checked out.` }, 409);
      const from = file.revisions.find((r) => r.n === body?.n);
      if (!from) return c.json({ error: 'No such revision.' }, 404);
      const n = file.revisions.at(-1)!.n + 1;
      file.revisions.push({ ...from, n, at: Date.now(), by: who.name, comment: `Restored revision ${from.n}` });
      await p.save();
      await p.note(who.name, 'checkin', `restored revision ${from.n} of ${file.name} as revision ${n}`, { fileId: file.id });
      return c.json({ file, ...view(p, who) });
    });
  });

  /** A note in the Record from the app (a file sent to or back from a Session). */
  app.post('/v1/projects/:id/files/:file/note', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const f = fileOf(c, o.p, o.who);
    if (!f || !atLeast(f.level, 'write')) return c.json({ error: 'No such file.' }, 404);
    const body = (await c.req.json().catch(() => null)) as { text?: string } | null;
    const text = cleanItemName(body?.text, 300);
    if (!text) return c.json({ error: 'Nothing to note.' }, 400);
    await o.p.note(o.who.name, 'session', text, { fileId: f.file.id });
    return c.json({ ok: true });
  });

  // --- Invitations ---

  app.post('/v1/projects/:id/invite', async (c) => {
    const o = await open(c);
    if (o instanceof Response) return o;
    const { p, who } = o;
    if (!atLeast(levelFor(p.meta, null, who), 'full')) return denied(c, 'invite people');
    const body = (await c.req.json().catch(() => null)) as { emails?: unknown; level?: Level; note?: string } | null;
    const emails = cleanEmails(body?.emails);
    if (!emails) return c.json({ error: 'Give up to 20 email addresses.' }, 400);
    const level = body?.level && LEVELS.includes(body.level) && body.level !== 'none' ? body.level : 'read';
    if (deps.mailer && !limit.take(`project:${p.meta.id}`, emails.length)) return c.json({ error: 'Too many invitations today.' }, 429);
    return p.serial(async () => {
      const members = [...p.meta.members.filter((m) => !emails.includes(m.who.toLowerCase())), ...emails.map((e) => ({ who: e, level }))];
      p.meta.members = members;
      await p.save();
      await p.note(who.name, 'permissions', `invited ${emails.join(', ')} (${level})`);
      const sent = await sendInvites(c, deps, emails, { from: who.name, what: 'Project', name: p.meta.name, id: p.meta.id, note: body?.note, query: 'project' });
      return c.json({ ...view(p, who), sent });
    });
  });
}

/**
 * Sends invitation emails if the server has a mail provider; `sent: false` tells the app to offer
 * the user's own mail app instead.
 */
export async function sendInvites(
  c: Context,
  deps: Pick<ProjectDeps, 'mailer' | 'appUrl'>,
  emails: string[],
  o: { from: string; what: 'Session' | 'Project'; name: string; id: string; note?: string; query: 'studio' | 'project' },
): Promise<{ sent: boolean; failed: string[] }> {
  if (!deps.mailer) return { sent: false, failed: [] };
  const base = deps.appUrl(c);
  const link = base ? `${base.replace(/\/+$/, '')}/?${o.query}=${encodeURIComponent(o.id)}` : null;
  const text = invitationText({ from: o.from, what: o.what, name: o.name, id: o.id, link, note: typeof o.note === 'string' ? o.note.slice(0, 1000) : '' });
  const failed: string[] = [];
  for (const to of emails) {
    try {
      await deps.mailer({ to, subject: `${o.from} invited you to “${o.name}”`, text });
    } catch {
      failed.push(to);
    }
  }
  return { sent: true, failed };
}
