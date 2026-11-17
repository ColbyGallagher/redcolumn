/**
 * What is in a Revu settings folder (`%APPDATA%\Bluebeam Software\Revu\21`), sorted into the kinds
 * the migration wizard imports. Pure: the desktop app lists the folder for us (revuSettings.ts in
 * apps/desktop), a browser hands over the files of a folder the person picks.
 */

export type RevuKind = 'toolSet' | 'lineStyles' | 'hatches' | 'profile' | 'stamp' | 'bookmarks' | 'categories' | 'shortcuts';

/**
 * In the order the wizard lists and imports them. Profiles come last: each .bpx becomes a copy of the
 * active profile, so the copy should already hold the tool sets, stamps and shortcuts imported here.
 */
export const REVU_KINDS: readonly RevuKind[] = ['toolSet', 'stamp', 'lineStyles', 'hatches', 'bookmarks', 'categories', 'shortcuts', 'profile'];

export const REVU_KIND_LABEL: Readonly<Record<RevuKind, string>> = {
  toolSet: 'Tool sets',
  stamp: 'Stamps',
  lineStyles: 'Line styles',
  hatches: 'Hatch patterns',
  profile: 'Profiles (markup list columns)',
  bookmarks: 'Bookmark templates',
  categories: 'Sets categories',
  shortcuts: 'Keyboard shortcuts',
};

/** Revu's own config files: never offered. DigitalIDs.xml holds certificate thumbprints. */
const NEVER = new Set(['applicationsettings.xml', 'digitalids.xml', 'userpreferences.xml']);
const SKIP_DIRS = new Set(['templates', 'workflows', 'webcache', 'revuusers']);

/**
 * The kind of a file by its path inside a version folder (`Stamps/Approved.pdf`), or null when it
 * is not one to import. A root .xml other than KeyboardShortcuts.xml is taken as a bookmark
 * template; the import reads it to be sure.
 */
export function classifyRevuPath(rel: string): RevuKind | null {
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  const name = parts[parts.length - 1]!.toLowerCase();
  const dirs = parts.slice(0, -1).map((d) => d.toLowerCase());
  if (dirs.some((d) => SKIP_DIRS.has(d))) return null;
  if (dirs[0] === 'stamps') return name.endsWith('.pdf') ? 'stamp' : null;
  if (dirs[0] === 'categories') return parts.length === 2 && name.endsWith('.xml') ? 'categories' : null;
  if (name.endsWith('.btx')) return 'toolSet';
  if (name.endsWith('.blx')) return 'lineStyles';
  if (name.endsWith('.bhx')) return 'hatches';
  if (name.endsWith('.bpx')) return 'profile';
  if (parts.length === 1 && name.endsWith('.xml') && !NEVER.has(name)) return name === 'keyboardshortcuts.xml' ? 'shortcuts' : 'bookmarks';
  return null;
}

export interface RevuEntry {
  /** Inside the version folder, with forward slashes. */
  path: string;
  size: number;
}

export interface RevuItem<T extends RevuEntry = RevuEntry> {
  entry: T;
  kind: RevuKind;
  /** As shown: `My Tools`, `Approved`, `Construction`. */
  name: string;
}

/**
 * The importable files among `entries`, sorted by kind then name. Revu keeps a copy of its stamps
 * per language (`Stamps/en-GB/Approved.pdf`) beside the main ones: a stamp is offered once, from
 * the main folder when it is there, else from the first language folder that has it.
 */
export function revuItems<T extends RevuEntry>(entries: readonly T[]): RevuItem<T>[] {
  const out: RevuItem<T>[] = [];
  const stamps = new Map<string, RevuItem<T>>();
  for (const entry of [...entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))) {
    const kind = classifyRevuPath(entry.path);
    if (!kind) continue;
    const file = entry.path.split('/').pop()!;
    const name = file.replace(/\.[^.]+$/, '');
    if (kind === 'stamp') {
      const key = file.toLowerCase();
      if (!stamps.has(key)) stamps.set(key, { entry, kind, name });
      continue;
    }
    out.push({ entry, kind, name });
  }
  out.push(...stamps.values());
  return out.sort((a, b) => REVU_KINDS.indexOf(a.kind) - REVU_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
}

export interface PickedVersion<T> {
  /** `21`, or the picked folder's own name when it is a version folder already. */
  version: string;
  entries: T[];
}

/**
 * Files from a folder the person picked (`webkitRelativePath`: `Revu/21/Stamps/Approved.pdf`),
 * split by Revu version. They may pick the `Revu` folder (versions inside) or one version's folder.
 */
export function splitPickedFolder<T extends { relativePath: string }>(files: readonly T[]): PickedVersion<T & RevuEntry>[] {
  const rows = files.map((f) => ({ f, parts: f.relativePath.split('/').filter(Boolean) })).filter((r) => r.parts.length >= 2);
  if (!rows.length) return [];
  const top = rows[0]!.parts[0]!;
  // Picked the Revu folder: version folders under it hold the libraries.
  const versioned = rows.some((r) => r.parts.length >= 3 && /^\d{2,4}$/.test(r.parts[1]!) && classifyRevuPath(r.parts.slice(2).join('/')));
  const groups = new Map<string, (T & RevuEntry)[]>();
  for (const { f, parts } of rows) {
    if (versioned) {
      if (parts.length < 3 || !/^\d{2,4}$/.test(parts[1]!)) continue;
      const list = groups.get(parts[1]!) ?? [];
      list.push({ ...f, path: parts.slice(2).join('/'), size: (f as { size?: number }).size ?? 0 });
      groups.set(parts[1]!, list);
    } else {
      const list = groups.get(top) ?? [];
      list.push({ ...f, path: parts.slice(1).join('/'), size: (f as { size?: number }).size ?? 0 });
      groups.set(top, list);
    }
  }
  const rank = (v: string) => (/^\d{2}$/.test(v) ? 10000 + Number(v) : /^\d+$/.test(v) ? Number(v) : -1);
  return [...groups.entries()].map(([version, entries]) => ({ version, entries })).sort((a, b) => rank(b.version) - rank(a.version));
}
