import { addToLibrary } from '../assemblies/estimatingLibrary';
import { updateWorkspace } from '../workspace/profiles';
import { packCounts, type PackCounts, type TradePack } from './pack';

/**
 * Adds a trade pack to this browser: its assemblies to My Assemblies, its items, product lists
 * and templates to the estimating library, and its tool sets and drawing standards to the active
 * profile. Assemblies and estimating records merge by id (adding a pack again updates them);
 * tool sets added from the same pack before are replaced; standards replace by id. `source` names
 * the pack: its library id, or its name for a pack file.
 */
export function installPack(pack: TradePack, source: string): { counts: PackCounts; saved: boolean } {
  const e = pack.estimating;
  const saved = e.assemblies.length || e.items.length || e.productLists.length || e.templates.length ? addToLibrary(e) : true;
  if (pack.toolSets.length || pack.standards.length) {
    updateWorkspace((w) => {
      const ids = new Set(pack.standards.map((s) => s.id));
      return {
        ...w,
        toolChests: [...w.toolChests.filter((s) => s.pack !== source), ...pack.toolSets.map((s) => ({ ...s, pack: source }))],
        drawingStandards: [...w.drawingStandards.filter((s) => !ids.has(s.id)), ...pack.standards],
      };
    });
  }
  return { counts: packCounts(pack), saved };
}

