import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The fonts installed on this computer, for text markups set in a font of the person's choice.
 *
 * The main process lists the font files in the system's font folders and reads each one's family and
 * style names. The page gets the family list with an opaque id for each face, and later asks for a
 * face's bytes by id. It never gets (or supplies) a path: an id maps only to a file this module
 * found in one of the font folders, and a file is read again only after a check that it still sits
 * there (a symlink pointing outside is refused). Nothing is written. (docs/SECURITY-HARDENING.md, IPC and path safety.)
 */

export interface FontStyle {
  /** Opaque: hands `SystemFonts.read` the face. */
  id: string;
  /** "Regular", "Bold Italic", "Light" ... */
  style: string;
  bold: boolean;
  italic: boolean;
}

export interface FontFamilyEntry {
  family: string;
  styles: FontStyle[];
}

/** The folders installed fonts live in. */
export function systemFontDirs(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = env.USERPROFILE ?? env.HOME ?? ''): string[] {
  if (platform === 'win32') {
    return [path.join(env.WINDIR ?? env.SystemRoot ?? 'C:\\Windows', 'Fonts'), ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : [])];
  }
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', ...(home ? [path.join(home, 'Library', 'Fonts')] : [])];
  return ['/usr/share/fonts', '/usr/local/share/fonts', ...(home ? [path.join(home, '.fonts'), path.join(home, '.local', 'share', 'fonts')] : [])];
}

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
/** A bigger file is not read (CJK collections run to tens of megabytes). */
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_DEPTH = 4;

// ---- Reading font files ---------------------------------------------------------------------------

interface Face {
  family: string;
  style: string;
  bold: boolean;
  italic: boolean;
}

const tag = (b: Buffer, o: number) => b.toString('latin1', o, o + 4);

/** A name table string: Windows records are UTF-16BE, Macintosh ones Mac Roman (read as Latin-1, enough for the ASCII names fonts use). */
function nameString(table: Buffer, storage: number, rec: { platform: number; offset: number; length: number }): string {
  const raw = table.subarray(storage + rec.offset, storage + rec.offset + rec.length);
  if (rec.platform === 1) return raw.toString('latin1');
  const out = Buffer.from(raw);
  out.swap16();
  return out.toString('utf16le');
}

function readNames(table: Buffer): Map<number, string> {
  const out = new Map<number, string>();
  if (table.length < 6) return out;
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const rank = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    if (o + 12 > table.length) break;
    const platform = table.readUInt16BE(o);
    const encoding = table.readUInt16BE(o + 2);
    const language = table.readUInt16BE(o + 4);
    const id = table.readUInt16BE(o + 6);
    if (![1, 2, 16, 17].includes(id)) continue;
    // Prefer Windows English, then any Windows name, then Macintosh.
    const r = platform === 3 && (encoding === 1 || encoding === 10) ? (language === 0x409 ? 3 : 2) : platform === 1 && encoding === 0 ? 1 : 0;
    if (r === 0 || r <= (rank.get(id) ?? 0)) continue;
    const length = table.readUInt16BE(o + 8);
    const offset = table.readUInt16BE(o + 10);
    if (storage + offset + length > table.length) continue;
    const text = nameString(table, storage, { platform, offset, length }).replace(/\0/g, '').trim();
    if (!text) continue;
    out.set(id, text);
    rank.set(id, r);
  }
  return out;
}

/** The tables of the sfnt font whose directory starts at `base` in the file. */
async function tableDirectory(fh: fs.FileHandle, base: number): Promise<{ header: Buffer; tables: Map<string, { offset: number; length: number }> } | null> {
  const header = Buffer.alloc(12);
  if ((await fh.read(header, 0, 12, base)).bytesRead < 12) return null;
  const version = header.readUInt32BE(0);
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) return null;
  const count = header.readUInt16BE(4);
  if (count === 0 || count > 200) return null;
  const dir = Buffer.alloc(count * 16);
  if ((await fh.read(dir, 0, dir.length, base + 12)).bytesRead < dir.length) return null;
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) tables.set(tag(dir, i * 16), { offset: dir.readUInt32BE(i * 16 + 8), length: dir.readUInt32BE(i * 16 + 12) });
  return { header, tables };
}

async function readTable(fh: fs.FileHandle, size: number, t: { offset: number; length: number } | undefined, max: number): Promise<Buffer | null> {
  if (!t || t.length === 0 || t.length > max || t.offset + t.length > size) return null;
  const b = Buffer.alloc(t.length);
  return (await fh.read(b, 0, t.length, t.offset)).bytesRead === t.length ? b : null;
}

async function readFace(fh: fs.FileHandle, size: number, base: number): Promise<Face | null> {
  const dir = await tableDirectory(fh, base);
  if (!dir) return null;
  const name = await readTable(fh, size, dir.tables.get('name'), 1 << 20);
  if (!name) return null;
  const names = readNames(name);
  const family = names.get(16) ?? names.get(1);
  if (!family) return null;
  let style = names.get(17) ?? names.get(2) ?? 'Regular';
  const os2 = await readTable(fh, size, dir.tables.get('OS/2'), 1 << 16);
  const head = await readTable(fh, size, dir.tables.get('head'), 1 << 10);
  let bold = /\bbold\b/i.test(style);
  let italic = /\b(italic|oblique)\b/i.test(style);
  if (os2 && os2.length >= 64) {
    const weight = os2.readUInt16BE(4);
    const selection = os2.readUInt16BE(62);
    bold = selection & 0x20 ? true : weight >= 600;
    italic = !!(selection & 0x01) || italic;
  } else if (head && head.length >= 46) {
    const mac = head.readUInt16BE(44);
    bold = !!(mac & 1);
    italic = !!(mac & 2);
  }
  style = style.slice(0, 80);
  return { family: family.slice(0, 100), style, bold, italic };
}

/** The faces in a font file: one for .ttf/.otf, several for a collection. */
async function readFile(file: string): Promise<{ face: Face; index: number }[]> {
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    if (size < 12 || size > MAX_FILE_BYTES) return [];
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    if (tag(head, 0) === 'ttcf') {
      const count = Math.min(head.readUInt32BE(8), 64);
      const offsets = Buffer.alloc(count * 4);
      await fh.read(offsets, 0, offsets.length, 12);
      const out: { face: Face; index: number }[] = [];
      for (let i = 0; i < count; i++) {
        const face = await readFace(fh, size, offsets.readUInt32BE(i * 4)).catch(() => null);
        if (face) out.push({ face, index: i });
      }
      return out;
    }
    const face = await readFace(fh, size, 0);
    return face ? [{ face, index: 0 }] : [];
  } finally {
    await fh.close();
  }
}

/**
 * The bytes of one face as a standalone font file: a .ttf/.otf as it is, a collection's face with
 * its own tables copied out (the table data is shared by offset in a collection, which a PDF
 * embedder cannot use).
 */
export function faceBytes(file: Buffer, index: number): Buffer {
  if (tag(file, 0) !== 'ttcf') return file;
  const count = file.readUInt32BE(8);
  if (index >= count) throw new Error('That font is not available.');
  const base = file.readUInt32BE(12 + index * 4);
  const tableCount = file.readUInt16BE(base + 4);
  if (tableCount === 0 || tableCount > 200 || base + 12 + tableCount * 16 > file.length) throw new Error('That font is not available.');
  const headerSize = 12 + tableCount * 16;
  const parts: Buffer[] = [];
  const header = Buffer.alloc(headerSize);
  file.copy(header, 0, base, base + headerSize);
  let at = headerSize;
  for (let i = 0; i < tableCount; i++) {
    const rec = 12 + i * 16;
    const offset = file.readUInt32BE(base + rec + 8);
    const length = file.readUInt32BE(base + rec + 12);
    if (offset + length > file.length) throw new Error('That font is not available.');
    header.writeUInt32BE(at, rec + 8);
    const padded = Buffer.alloc((length + 3) & ~3);
    file.copy(padded, 0, offset, offset + length);
    parts.push(padded);
    at += padded.length;
  }
  return Buffer.concat([header, ...parts]);
}

// ---- The list ---------------------------------------------------------------------------------------

const within = (file: string, roots: string[]) => roots.some((r) => file === r || file.startsWith(r.endsWith(path.sep) ? r : r + path.sep));

export class SystemFonts {
  private faces = new Map<string, { file: string; index: number }>();
  private cached: Promise<FontFamilyEntry[]> | null = null;
  private roots: string[] = [];

  /** `dirs`: the font folders (see `systemFontDirs`). */
  private dirs: string[];

  constructor(dirs: string[]) {
    this.dirs = dirs;
  }

  /** Every installed family with its styles. Listed once, then cached until the app restarts. */
  list(): Promise<FontFamilyEntry[]> {
    this.cached ??= this.scan();
    return this.cached;
  }

  private async scan(): Promise<FontFamilyEntry[]> {
    this.roots = [];
    for (const dir of this.dirs) {
      try {
        this.roots.push(await fs.realpath(dir));
      } catch {
        // A folder this computer lacks.
      }
    }
    const files: string[] = [];
    const walk = async (dir: string, depth: number) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < MAX_DEPTH) await walk(full, depth + 1);
        else if ((e.isFile() || e.isSymbolicLink()) && FONT_EXTENSIONS.has(path.extname(e.name).toLowerCase())) files.push(full);
      }
    };
    for (const root of this.roots) await walk(root, 0);

    const families = new Map<string, FontFamilyEntry>();
    const queue = [...files];
    const worker = async () => {
      for (let file = queue.pop(); file; file = queue.pop()) {
        try {
          const real = await fs.realpath(file);
          if (!within(real, this.roots)) continue;
          for (const { face, index } of await readFile(real)) {
            const id = randomBytes(16).toString('hex');
            this.faces.set(id, { file: real, index });
            let entry = families.get(face.family.toLowerCase());
            if (!entry) families.set(face.family.toLowerCase(), (entry = { family: face.family, styles: [] }));
            entry.styles.push({ id, style: face.style, bold: face.bold, italic: face.italic });
          }
        } catch {
          // An unreadable or broken font file is left out.
        }
      }
    };
    await Promise.all(Array.from({ length: 12 }, worker));
    const out = [...families.values()].sort((a, b) => a.family.localeCompare(b.family));
    for (const f of out) f.styles.sort((a, b) => Number(a.bold) - Number(b.bold) || Number(a.italic) - Number(b.italic) || a.style.localeCompare(b.style));
    return out;
  }

  /** A face's font file, by an id from `list`. Anything else is refused. */
  async read(id: unknown): Promise<Uint8Array> {
    if (typeof id !== 'string') throw new Error('That font is not available.');
    await this.list();
    const face = this.faces.get(id);
    if (!face) throw new Error('That font is not available.');
    // The file may have moved or been replaced by a link since it was listed.
    const real = await fs.realpath(face.file).catch(() => null);
    if (!real || !within(real, this.roots)) throw new Error('That font is not available.');
    const data = await fs.readFile(real);
    if (data.length > MAX_FILE_BYTES) throw new Error('That font is not available.');
    const bytes = faceBytes(data, face.index);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}
