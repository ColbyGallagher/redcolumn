import type { StoredFile } from './fileStore';

export interface RecentOptions {
  /** Preferences › Recent Files: how many the list holds. */
  count: number;
  /** Preferences › Opened in the Last: days (0: any time). */
  days: number;
  now?: number;
  /** The file on disk a document came from (the desktop app's token), so one file is listed once. */
  locationOf?: (id: string) => string | null;
  /** Templates are left out where only documents belong (Search › Recent Files). */
  templates?: boolean;
}

/**
 * The recent files list: the most recently opened first, at most `count` of them. A document taken
 * off the list is not in it, and when one file on disk has more than one document on the device (it
 * changed on disk since it was first opened) only the latest is listed.
 */
export function recentFiles(files: readonly StoredFile[], { count, days, now = Date.now(), locationOf, templates = true }: RecentOptions): StoredFile[] {
  const seen = new Set<string>();
  const out: StoredFile[] = [];
  for (const f of [...files].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)) {
    if (out.length >= count) break;
    if (f.recentHidden || (!templates && f.template)) continue;
    if (days && now - f.lastOpenedAt >= days * 86_400_000) continue;
    const location = locationOf?.(f.id);
    if (location) {
      if (seen.has(location)) continue;
      seen.add(location);
    }
    out.push(f);
  }
  return out;
}
