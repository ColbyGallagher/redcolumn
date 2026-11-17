import { importRevuShortcuts, revuNote } from '../commands/revuKeys';
import { importRevuStamps } from '../stamps/revuStamps';
import { importRevuFiles } from '../toolchest/revuLibraries';
import { updateWorkspace } from '../workspace/profiles';
import { REVU_KINDS, type RevuItem, type RevuKind } from './revuFolder';

/** An item the wizard can import: where it is, and how to get its bytes. */
export type RevuSource = RevuItem<{ path: string; size: number; read: () => Promise<Uint8Array> }>;

export interface KindResult {
  kind: RevuKind;
  /** What was imported, as the importers say it. */
  notes: string[];
  failed: string[];
}

const asFile = async (item: RevuSource) => {
  const bytes = await item.entry.read();
  const file = item.entry.path.split('/').pop()!;
  return new File([bytes.slice()], file);
};

/**
 * Imports the chosen Revu files into the active profile, kind by kind with the same importers the
 * Tool Library, Stamps and Keyboard Shortcuts dialogs use. `progress` hears each kind as it starts.
 */
export async function runRevuMigration(items: readonly RevuSource[], progress?: (kind: RevuKind, done: number, total: number) => void): Promise<KindResult[]> {
  const results: KindResult[] = [];
  const kinds = REVU_KINDS.filter((k) => items.some((i) => i.kind === k));
  let done = 0;
  for (const kind of kinds) {
    progress?.(kind, done, items.length);
    const group = items.filter((i) => i.kind === kind);
    const result: KindResult = { kind, notes: [], failed: [] };
    const files: File[] = [];
    for (const item of group) {
      try {
        files.push(await asFile(item));
      } catch (err) {
        result.failed.push(`${item.entry.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      if (kind === 'stamp') {
        const r = await importRevuStamps(files);
        if (r.added.length) result.notes.push(`Imported ${r.added.length} stamp${r.added.length === 1 ? '' : 's'}.`);
        result.failed.push(...r.failed);
      } else if (kind === 'shortcuts') {
        for (const f of files) {
          try {
            const r = importRevuShortcuts(await f.text());
            updateWorkspace((w) => ({ ...w, shortcuts: r.overrides }));
            result.notes.push(revuNote(r.changed, r.unmapped));
          } catch (err) {
            result.failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } else if (files.length) {
        // One file at a time, so a message belongs to its file.
        for (const f of files) {
          const said = await importRevuFiles([f]);
          if (said.startsWith(`${f.name}: `)) result.failed.push(said);
          // Tool set messages do not name the set ("Imported 8 tools."): the file does.
          else result.notes.push(kind === 'toolSet' ? `${f.name.replace(/\.btx$/i, '')}: ${said}` : said);
        }
      }
    } catch (err) {
      result.failed.push(err instanceof Error ? err.message : String(err));
    }
    done += group.length;
    results.push(result);
  }
  progress?.(kinds[kinds.length - 1] ?? 'toolSet', items.length, items.length);
  return results;
}
