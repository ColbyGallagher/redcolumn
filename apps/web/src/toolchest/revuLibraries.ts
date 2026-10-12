import { parseBhx, parseBlx } from '@nb/markup';
import { updateWorkspace } from '../workspace/profiles';
import { importToolSets } from './toolSets';

/** The kinds of Revu file importRevuFiles takes, as an `accept` list. */
export const REVU_LIBRARY_ACCEPT = '.btx,.blx,.bhx,.json,application/xml,text/xml,application/json';
export const isRevuLibraryFile = (name: string) => /\.(btx|json|blx|bhx)$/i.test(name);

/** `Imported 3 line styles (Advanced).` */
const said = (n: number, what: string, title: string) => `Imported ${n} ${what}${n === 1 ? '' : 's'} (${title}).`;

/**
 * Imports Revu's library files in one go: tool sets (.btx, or redcolumn .json), line style sets
 * (.blx) and hatch sets (.bhx). They land in the active profile. Returns what was added and what
 * failed as one message, for a toast.
 */
export async function importRevuFiles(files: File[]): Promise<string> {
  const out: string[] = [];
  const failed: string[] = [];

  const tools = files.filter((f) => /\.(btx|json)$/i.test(f.name));
  if (tools.length) {
    const r = await importToolSets(tools);
    if (r.added) out.push(`Imported ${r.added} tool${r.added === 1 ? '' : 's'}.`);
    if (r.skipped) out.push(`${r.skipped} tool${r.skipped === 1 ? ' is' : 's are'} not supported yet (stamps, images, symbols…).`);
    failed.push(...r.failed);
  }

  for (const f of files) {
    const fail = (err: unknown) => failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    try {
      if (/\.blx$/i.test(f.name)) {
        const set = await parseBlx(await f.text(), f.name.replace(/\.blx$/i, ''));
        if (!set.styles.length) throw new Error('no line styles in it');
        // Importing a set again replaces the one of the same name.
        updateWorkspace((w) => ({ ...w, lineSets: [...w.lineSets.filter((s) => s.title !== set.title), set] }));
        out.push(said(set.styles.length, 'line style', set.title));
      } else if (/\.bhx$/i.test(f.name)) {
        const set = await parseBhx(await f.text(), f.name.replace(/\.bhx$/i, ''));
        if (!set.hatches.length) throw new Error('no hatches in it');
        // Revu's Standard set is the built-in one: only patterns that are new are kept.
        const fresh = { ...set, hatches: set.hatches.filter((h) => !h.builtIn) };
        if (!fresh.hatches.length) out.push(`${set.title}: its ${set.hatches.length} hatches are already built in.`);
        else {
          updateWorkspace((w) => ({ ...w, hatchSets: [...w.hatchSets.filter((s) => s.title !== set.title), fresh] }));
          out.push(`Imported ${fresh.hatches.length} hatch${fresh.hatches.length === 1 ? '' : 'es'} (${set.title}).`);
        }
      } else if (!isRevuLibraryFile(f.name)) failed.push(`${f.name}: not a file redcolumn can import`);
    } catch (err) {
      fail(err);
    }
  }
  return [...out, ...failed].join(' ') || 'Nothing found to import.';
}
