import type { Markup } from '@nb/markup';
import { ensureMarkupFonts, missingFonts, namedFontUses, onSystemFontsChanged } from './systemFonts';

export { onSystemFontsChanged };

/**
 * Loads the installed fonts a document's markups use, so the canvas can draw them, and returns the
 * ones this computer lacks (drawn in a similar font). Cheap to repeat: fonts already checked are skipped.
 */
export async function usedMissingFonts(markups: readonly Markup[]): Promise<string[]> {
  await ensureMarkupFonts(markups);
  const used = namedFontUses(markups);
  return missingFonts().filter((f) => used.has(f));
}
