import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Bluebeam Revu's settings folders on this computer, for the Revu migration wizard: its tool sets,
 * line styles, hatches, profiles, stamps, bookmark templates, categories and keyboard shortcuts.
 *
 * Revu keeps them in `%APPDATA%\Bluebeam Software\Revu\<version>` (`21`, `20`, `2019`...). The main
 * process lists the library files there and the page gets, for each, an opaque id, its path inside
 * the version folder (`Stamps/Approved.pdf`) and its size. It never gets or supplies a full path.
 * Only library files are listed: Revu's other settings (DigitalIDs.xml with certificate thumbprints,
 * UserPreferences.xml, recent files) are never offered or read. A file is read again only after a
 * check that it still sits inside the folder it was listed in. Nothing is written.
 * (docs/SECURITY-HARDENING.md, IPC and path safety.)
 */

export interface RevuFile {
  /** Opaque: hands `RevuSettings.read` the file. */
  id: string;
  /** Inside the version folder, with forward slashes: `My Tools.btx`, `Stamps/en-GB/Approved.pdf`. */
  path: string;
  size: number;
}

export interface RevuVersion {
  /** The folder's name: `21`, `20`, `2019`. */
  version: string;
  files: RevuFile[];
}

/** Where Revu keeps its settings: one folder per version under this. Windows only (Revu is). */
export function revuSettingsRoot(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string | null {
  if (platform !== 'win32' || !env.APPDATA) return null;
  return path.win32.join(env.APPDATA, 'Bluebeam Software', 'Revu');
}

/** A bigger file is not offered (stamp PDFs are kilobytes, tool sets a few megabytes). */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 2000;
/** Revu's own config files that sit beside the libraries; never offered whatever is in them. */
const NEVER = new Set(['applicationsettings.xml', 'digitalids.xml', 'userpreferences.xml']);
/** Folders with nothing to import (form templates, the start page's workflows, a browser cache, per-user state). */
const SKIP_DIRS = new Set(['templates', 'workflows', 'webcache', 'revuusers']);

/**
 * Whether a path inside a version folder is a library file worth offering, by name and place alone.
 * Root .xml files other than KeyboardShortcuts.xml are bookmark templates only by content (`isBookmarkXml`).
 */
export function revuCandidate(rel: string): 'yes' | 'peek' | 'no' {
  const parts = rel.split('/');
  const name = parts[parts.length - 1]!.toLowerCase();
  const dirs = parts.slice(0, -1).map((d) => d.toLowerCase());
  if (dirs.some((d) => SKIP_DIRS.has(d)) || parts.length > 3) return 'no';
  if (dirs[0] === 'stamps') return name.endsWith('.pdf') ? 'yes' : 'no';
  if (dirs[0] === 'categories') return parts.length === 2 && name.endsWith('.xml') ? 'yes' : 'no';
  if (/\.(btx|blx|bhx|bpx)$/.test(name)) return 'yes';
  if (parts.length === 1 && name.endsWith('.xml') && !NEVER.has(name)) return name === 'keyboardshortcuts.xml' ? 'yes' : 'peek';
  return 'no';
}

/** A Revu bookmark template starts `<root>` then `<bookmark`. */
export function isBookmarkXml(head: string): boolean {
  return /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?<root>\s*<bookmark\b/.test(head);
}

const within = (file: string, root: string) => file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

async function head(file: string, bytes = 2048): Promise<string> {
  const fh = await fs.open(file, 'r');
  try {
    const b = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(b, 0, bytes, 0);
    return b.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

export class RevuSettings {
  private files = new Map<string, { file: string; root: string }>();
  /** A file keeps its id across scans, so a list one window holds still reads after another window scans. */
  private ids = new Map<string, string>();
  private root: string | null;

  /** `root`: the folder holding one folder per Revu version (see `revuSettingsRoot`). */
  constructor(root: string | null) {
    this.root = root;
  }

  /** Every Revu version found, newest first, with its library files. Scanned afresh each time; ids stay the same. */
  async scan(): Promise<RevuVersion[]> {
    if (!this.root) return [];
    const base = await fs.realpath(this.root).catch(() => null);
    if (!base) return [];
    const versions: RevuVersion[] = [];
    let total = 0;
    for (const v of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!(v.isDirectory() || v.isSymbolicLink()) || !/^\d{2,4}$/.test(v.name)) continue;
      // A version folder may be a junction to elsewhere (moved to another drive, say): followed, since
      // this module chose it, not the page. Files are then kept to the folder it resolves to.
      const root = await fs.realpath(path.join(base, v.name)).catch(() => null);
      if (!root || !(await fs.stat(root).then((s) => s.isDirectory(), () => false))) continue;
      const files: RevuFile[] = [];
      const walk = async (dir: string, rel: string[]) => {
        for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (total >= MAX_FILES) return;
          const parts = [...rel, e.name];
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (parts.length < 3 && !SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, parts);
            continue;
          }
          if (!e.isFile()) continue;
          const relPath = parts.join('/');
          const verdict = revuCandidate(relPath);
          if (verdict === 'no') continue;
          try {
            const real = await fs.realpath(full);
            if (!within(real, root)) continue;
            const { size } = await fs.stat(real);
            if (size === 0 || size > MAX_FILE_BYTES) continue;
            if (verdict === 'peek' && !isBookmarkXml(await head(real))) continue;
            let id = this.ids.get(real);
            if (!id) this.ids.set(real, (id = randomBytes(16).toString('hex')));
            this.files.set(id, { file: real, root });
            files.push({ id, path: relPath, size });
            total++;
          } catch {
            // Unreadable: left out.
          }
        }
      };
      await walk(root, []);
      if (files.length) versions.push({ version: v.name, files: files.sort((a, b) => a.path.localeCompare(b.path)) });
    }
    // 21 before 20 before 2019: a two-digit version is the newer naming.
    const rank = (v: string) => (v.length <= 2 ? 10000 + Number(v) : Number(v));
    return versions.sort((a, b) => rank(b.version) - rank(a.version));
  }

  /** A listed file's bytes, by id from a `scan`. Anything else is refused. */
  async read(id: unknown): Promise<Uint8Array> {
    const entry = typeof id === 'string' ? this.files.get(id) : undefined;
    if (!entry) throw new Error('That Revu file is not available.');
    const real = await fs.realpath(entry.file).catch(() => null);
    if (!real || !within(real, entry.root)) throw new Error('That Revu file is not available.');
    const data = await fs.readFile(real);
    if (data.length > MAX_FILE_BYTES) throw new Error('That Revu file is not available.');
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
}
