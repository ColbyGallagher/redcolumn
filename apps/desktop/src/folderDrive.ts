import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Projects on a folder on this computer, which the person's own sync client (OneDrive, Dropbox,
 * Google Drive, a network share) keeps in step with everyone else's (docs/SECURITY-HARDENING.md,
 * E3). redcolumn signs in to nothing and holds no token: the sync client moves the files.
 *
 * The page sees opaque IDs, never paths: `lf:<root>:<path in the root, base64url>`. Every path is
 * resolved through realpath and must stay inside a root the person chose in a dialog; symbolic
 * links that lead out are refused. Only the file types Projects write are created (.json, .pdf),
 * new files never replace another, and replacements are written beside the file then renamed over
 * it, so a sync client never uploads half a file.
 */

export interface FolderFile {
  id: string;
  name: string;
  mimeType: string;
  /** A hash of the content: sync clients can change modification times. */
  version: string;
  size: number;
  createdTime: string;
  properties: Record<string, string>;
}

/** Where Drive-style properties live inside a JSON file, as on OneDrive. */
const PROPS_KEY = '_nb';
/** Files Projects write; anything else (a sync client's conflict copy, a stray file) is not listed. */
const APP_FILE = /^[\w@.-]+\.(json|pdf)$/i;
const REMOVABLE = /^lock-[\w@.-]+\.json$/i;
const PREFIX = 'lf:';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export class FolderStore {
  /** Root token to absolute path; persisted by the caller. */
  private roots = new Map<string, string>();
  readonly owner: string;

  constructor(roots: Record<string, string> = {}, owner = randomBytes(12).toString('base64url')) {
    for (const [k, v] of Object.entries(roots)) this.roots.set(k, v);
    this.owner = owner;
  }

  /** The chosen roots, to save. */
  saved(): Record<string, string> {
    return Object.fromEntries(this.roots);
  }

  /** Remembers a folder the person chose, and returns its ID. */
  async addRoot(dir: string): Promise<string> {
    const real = await fs.realpath(dir);
    for (const [k, v] of this.roots) if (v === real) return `${PREFIX}${k}:`;
    const token = randomBytes(9).toString('base64url');
    this.roots.set(token, real);
    return `${PREFIX}${token}:`;
  }

  private idFor(root: string, rel: string) {
    return `${PREFIX}${root}:${rel ? b64(rel) : ''}`;
  }

  /** The absolute path for an ID, checked to be inside its root (symbolic links followed). */
  async resolve(id: string, mustExist = true): Promise<{ root: string; rel: string; abs: string }> {
    const m = /^lf:([\w-]+):([\w-]*)$/.exec(String(id));
    if (!m) throw new Error('That is not a folder on this computer.');
    const base = this.roots.get(m[1]!);
    if (!base) throw new Error('That folder is no longer chosen. Open it again with “Open a project folder on this computer…” in Projects.');
    const rel = m[2] ? unb64(m[2]) : '';
    if (rel && rel.split(/[\\/]/).some((part) => part === '..' || part === '.' || part === '')) throw new Error('That path is not allowed.');
    const abs = path.resolve(base, rel);
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('That path is not allowed.');
    if (mustExist) {
      const real = await fs.realpath(abs);
      if (real !== base && !real.startsWith(base + path.sep)) throw new Error('That path leads outside the chosen folder.');
    }
    return { root: m[1]!, rel, abs };
  }

  private async describe(root: string, rel: string, abs: string): Promise<FolderFile | null> {
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) return null;
    const name = path.basename(abs);
    if (st.isDirectory()) return { id: this.idFor(root, rel), name, mimeType: 'folder', version: String(st.mtimeMs), size: 0, createdTime: st.birthtime.toISOString(), properties: {} };
    if (!APP_FILE.test(name)) return null;
    const raw = await fs.readFile(abs);
    let properties: Record<string, string> = {};
    if (/\.json$/i.test(name)) {
      try {
        properties = ((JSON.parse(raw.toString('utf8')) as Record<string, unknown>)[PROPS_KEY] as Record<string, string>) ?? {};
      } catch {
        return null; // Half-synced or damaged: listed once it is whole.
      }
    } else properties = { nbRole: 'document' };
    return {
      id: this.idFor(root, rel),
      name,
      mimeType: /\.pdf$/i.test(name) ? 'application/pdf' : 'application/json',
      version: createHash('sha256').update(raw).digest('hex').slice(0, 32),
      size: raw.byteLength,
      createdTime: st.birthtime.toISOString(),
      properties,
    };
  }

  async list(folderId: string): Promise<FolderFile[]> {
    const { root, rel, abs } = await this.resolve(folderId);
    const out: FolderFile[] = [];
    for (const entry of await fs.readdir(abs)) {
      if (entry.startsWith('.') || entry.endsWith('.tmp')) continue;
      const f = await this.describe(root, rel ? `${rel}/${entry}` : entry, path.join(abs, entry)).catch(() => null);
      if (f && f.mimeType !== 'folder') out.push(f);
    }
    return out;
  }

  /** A file's content; JSON without its stored properties. */
  async download(fileId: string): Promise<Uint8Array> {
    const { abs } = await this.resolve(fileId);
    const raw = await fs.readFile(abs);
    if (!/\.json$/i.test(abs)) return raw;
    const { [PROPS_KEY]: _props, ...body } = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    return Buffer.from(JSON.stringify(body));
  }

  /** A new folder inside a chosen root (a number is added when the name is taken). */
  async createFolder(parentId: string, name: string): Promise<string> {
    const { root, rel, abs } = await this.resolve(parentId);
    const safe = safeName(name) || 'redcolumn project';
    for (let n = 0; ; n++) {
      const candidate = n ? `${safe} ${n}` : safe;
      try {
        await fs.mkdir(path.join(abs, candidate));
        return this.idFor(root, rel ? `${rel}/${candidate}` : candidate);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
  }

  /** A new file; it never replaces another of the same name (a number is added instead). */
  async createFile(folderId: string, name: string, body: Uint8Array, properties: Record<string, string>): Promise<FolderFile> {
    const { root, rel, abs } = await this.resolve(folderId);
    const clean = safeName(name);
    if (!APP_FILE.test(clean)) throw new Error('Only the files Projects use can be made here.');
    const bytes = /\.json$/i.test(clean) ? withProps(body, { ...properties, nbOwner: this.owner }) : body;
    const dot = clean.lastIndexOf('.');
    for (let n = 0; ; n++) {
      const candidate = n ? `${clean.slice(0, dot)}-${n}${clean.slice(dot)}` : clean;
      const target = path.join(abs, candidate);
      const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, bytes);
      try {
        // A hard link fails when the name is taken, so nothing is replaced; the file appears whole.
        await fs.link(tmp, target);
        await fs.unlink(tmp).catch(() => undefined);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          await fs.unlink(tmp).catch(() => undefined);
          continue;
        }
        // Some network shares cannot link: create exclusively instead.
        await fs.unlink(tmp).catch(() => undefined);
        try {
          await fs.writeFile(target, bytes, { flag: 'wx' });
        } catch (again) {
          if ((again as NodeJS.ErrnoException).code === 'EEXIST') continue;
          throw again;
        }
      }
      return (await this.describe(root, rel ? `${rel}/${candidate}` : candidate, target))!;
    }
  }

  /** Replaces a file's content (JSON keeps its stored properties), written beside it then renamed over. */
  async updateContent(fileId: string, body: Uint8Array): Promise<string> {
    const { root, rel, abs } = await this.resolve(fileId);
    const bytes = /\.json$/i.test(abs) ? withProps(body, await this.props(abs)) : body;
    await writeAtomic(abs, Buffer.from(bytes));
    return (await this.describe(root, rel, abs))!.version;
  }

  async updateProperties(fileId: string, properties: Record<string, string>): Promise<string> {
    const { root, rel, abs } = await this.resolve(fileId);
    if (!/\.json$/i.test(abs)) throw new Error('Only JSON files keep properties here.');
    const raw = JSON.parse((await fs.readFile(abs)).toString('utf8')) as Record<string, unknown>;
    const merged = { ...((raw[PROPS_KEY] as Record<string, string>) ?? {}), ...properties };
    await writeAtomic(abs, Buffer.from(JSON.stringify({ ...raw, [PROPS_KEY]: merged })));
    return (await this.describe(root, rel, abs))!.version;
  }

  private async props(abs: string): Promise<Record<string, string>> {
    try {
      return ((JSON.parse((await fs.readFile(abs)).toString('utf8')) as Record<string, unknown>)[PROPS_KEY] as Record<string, string>) ?? {};
    } catch {
      return {};
    }
  }

  /** Deletes the app's own check-out lock files only. One already gone counts as deleted. */
  async remove(fileId: string): Promise<void> {
    const { abs } = await this.resolve(fileId, false);
    if (!REMOVABLE.test(path.basename(abs))) throw new Error('redcolumn only deletes its own lock files.');
    await fs.unlink(abs).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  /** Whether this install made the file (the Project's owner made its manifest). */
  async ownedByMe(fileId: string): Promise<boolean> {
    const { abs } = await this.resolve(fileId);
    return (await this.props(abs)).nbOwner === this.owner;
  }

  /** The absolute folder for "Show in folder"; stays in the main process. */
  async folderPath(id: string): Promise<string> {
    return (await this.resolve(id)).abs;
  }
}

/** Writes beside the file (a dot-file, so it is not listed), then renames over it. */
async function writeAtomic(file: string, data: Uint8Array) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, file);
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    throw err;
  }
}

function safeName(name: string): string {
  return String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 180);
}

function withProps(body: Uint8Array, props: Record<string, string>): Uint8Array {
  const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
  return Buffer.from(JSON.stringify({ ...parsed, [PROPS_KEY]: props }));
}
