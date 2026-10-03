import { DEFAULT_STYLES, parseBtx, type ToolSet as RevuToolSet } from '@nb/markup';
import { updateWorkspace, type ToolSet } from '../workspace/profiles';

/**
 * .btx tool sets imported into the Tool Library. They become ordinary tool sets of
 * the active profile, so they can be renamed, reordered and added to like any other.
 */

function fromRevu(set: RevuToolSet): { set: ToolSet; skipped: number } {
  const usable = set.items.filter((i) => i.type);
  return {
    set: {
      id: crypto.randomUUID(),
      name: set.title,
      collapsed: false,
      view: 'icon',
      items: usable.map((i) => ({ id: i.id, type: i.type!, style: i.style, label: i.name, ...(i.subject && i.subject !== i.name ? { subject: i.subject } : {}) })),
    },
    skipped: set.items.length - usable.length,
  };
}

/** A tool set as a file to share: our own format, read back by `importToolSets`. */
export function toolSetFile(set: ToolSet): Blob {
  return new Blob([JSON.stringify({ format: 'redcolumn-toolset', version: 1, set: { ...set, hidden: undefined } }, null, 2)], { type: 'application/json' });
}

function fromFile(json: string): ToolSet {
  const data = JSON.parse(json) as { format?: string; set?: ToolSet };
  if (data.format !== 'redcolumn-toolset' || !data.set || !Array.isArray(data.set.items)) throw new Error('not a redcolumn tool set file');
  // Fresh ids, so importing the same file twice gives two sets.
  return { ...data.set, id: crypto.randomUUID(), collapsed: false, items: data.set.items.map((i) => ({ ...i, id: crypto.randomUUID() })) };
}

/**
 * Imports tool sets: Revu .btx files and redcolumn tool set files (.json). Returns how many tools
 * were added and skipped, and which files failed.
 */
export async function importToolSets(files: File[]): Promise<{ added: number; skipped: number; failed: string[] }> {
  const added: ToolSet[] = [];
  const failed: string[] = [];
  let skipped = 0;
  for (const f of files) {
    try {
      if (/\.json$/i.test(f.name)) {
        added.push(fromFile(await f.text()));
        continue;
      }
      const r = fromRevu(await parseBtx(await f.text(), DEFAULT_STYLES, f.name.replace(/\.btx$/i, '')));
      added.push(r.set);
      skipped += r.skipped;
    } catch (err) {
      failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (added.length) updateWorkspace((w) => ({ ...w, toolChests: [...w.toolChests, ...added] }));
  return { added: added.reduce((n, s) => n + s.items.length, 0), skipped, failed };
}

const LEGACY_KEY = 'nb.toolchest.sets';

/** Moves tool sets imported by earlier versions (kept apart from profiles) into the active profile. */
export function migrateLegacyToolSets() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const legacy = (JSON.parse(raw) as RevuToolSet[]).filter((s) => s && Array.isArray(s.items));
    if (legacy.length) updateWorkspace((w) => ({ ...w, toolChests: [...w.toolChests, ...legacy.map((s) => fromRevu(s).set)] }));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Unreadable: left where it is.
  }
}
