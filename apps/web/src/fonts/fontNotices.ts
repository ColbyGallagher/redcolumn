import { fontKeyword, isNamedFont, tableCells, type FontKeyword, type Markup } from '@nb/markup';
import type { FontFallbackReason } from '@nb/markup/export';

/** Whether any markup (or table cell) uses an installed font by name, a cheap check before loading the fonts module. */
export function markupsUseNamedFonts(markups: readonly Markup[]): boolean {
  for (const m of markups) {
    if (isNamedFont(m.style.fontFamily)) return true;
    if (m.type === 'table' && tableCells(m).some((c) => isNamedFont(c.style.fontFamily))) return true;
  }
  return false;
}

const STANDARD: Record<FontKeyword, string> = { sans: 'Helvetica', serif: 'Times', mono: 'Courier' };

const WHY: Record<FontFallbackReason, (plural: boolean) => string> = {
  restricted: (p) => `${p ? "aren't" : "isn't"} allowed to be embedded by ${p ? 'their' : 'its'} licence`,
  unsupported: (p) => `can't be embedded (${p ? "they aren't" : "it isn't"} TrueType)`,
  unavailable: () => "couldn't be read from this computer",
};

const join = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Plain sentences for the fonts an export replaced, one per reason, e.g. "Segoe Script isn't
 * allowed to be embedded by its licence, so Helvetica was used in the PDF." Null when nothing fell back.
 */
export function fontFallbackNotice(fallbacks: readonly { family: string; reason: FontFallbackReason }[]): string | null {
  const parts: string[] = [];
  for (const reason of ['restricted', 'unsupported', 'unavailable'] as const) {
    const names = [...new Set(fallbacks.filter((f) => f.reason === reason).map((f) => f.family))];
    if (!names.length) continue;
    const used = [...new Set(names.map((n) => STANDARD[fontKeyword(n)]))];
    parts.push(`${join(names)} ${WHY[reason](names.length > 1)}, so ${join(used)} ${used.length > 1 ? 'were' : 'was'} used in the PDF.`);
  }
  return parts.length ? parts.join(' ') : null;
}

/** The quiet notice for a document that uses fonts this computer lacks. */
export function missingFontsNotice(families: readonly string[]): string | null {
  return families.length ? `This document uses fonts not installed here: ${families.join(', ')}. They're shown in a similar font.` : null;
}

let sink: ((message: string) => void) | null = null;
/** Where export font notices go (the app's notice line). Returns the unset function. */
export function setFontNoticeSink(fn: (message: string) => void): () => void {
  sink = fn;
  return () => {
    if (sink === fn) sink = null;
  };
}

/**
 * The font options for `exportWithAnnotations`: installed fonts are embedded, and `done()` shows one
 * notice for whatever had to be replaced. Loads the fonts module only when a markup uses a named font.
 */
export async function fontExport(markups: readonly Markup[]): Promise<{ systemFonts?: import('@nb/markup/export').SystemFontSource; onFontFallback: (family: string, reason: FontFallbackReason) => void; done: () => void }> {
  const found: { family: string; reason: FontFallbackReason }[] = [];
  const onFontFallback = (family: string, reason: FontFallbackReason) => void found.push({ family, reason });
  const done = () => {
    const text = fontFallbackNotice(found);
    if (text) sink?.(text);
  };
  if (!markupsUseNamedFonts(markups)) return { onFontFallback, done };
  return { systemFonts: (await import('./systemFonts')).exportFontSource, onFontFallback, done };
}
