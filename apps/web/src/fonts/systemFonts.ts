import fontkit from '@pdf-lib/fontkit';
import { isNamedFont, tableCells, type Markup } from '@nb/markup';
import type { SystemFontSource } from '@nb/markup/export';
import { desktop } from '../desktop/host';

/**
 * Installed fonts for text markups (a markup's `style.fontFamily` set to a font's family name).
 * One module hides where they come from: the desktop app's main process (by opaque ids, no
 * paths), or the browser's Local Font Access API (Chromium, which asks the person once), else
 * none, and only the three keyword families are on offer.
 */

export interface SystemFontStyle {
  /** Opaque: desktop face id, or the font's PostScript name in the browser. */
  id: string;
  style: string;
  bold: boolean;
  italic: boolean;
}

export interface SystemFontFamily {
  family: string;
  styles: SystemFontStyle[];
}

/** The Local Font Access API (Chromium), not yet in TypeScript's DOM library. */
interface LocalFont {
  family: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFont[]>;
  }
}

// ---- Choosing a face ----------------------------------------------------------------------------------

const REGULAR_NAMES = /^(regular|normal|book|roman|medium)$/i;

/**
 * The style of a family that best stands for a weight and slant: an exact match (preferring the
 * plain "Regular" / "Bold" / "Italic" / "Bold Italic" names over "Light", "Semibold" ...), else the
 * same slant at any weight, else the first. null for a family without styles.
 */
export function pickStyle<T extends { style: string; bold: boolean; italic: boolean }>(styles: readonly T[], bold: boolean, italic: boolean): T | null {
  const plain = (s: T) => (REGULAR_NAMES.test(s.style) || /^(bold|italic|oblique|bold italic|bold oblique)$/i.test(s.style) ? 0 : 1);
  const best = (list: readonly T[]) => [...list].sort((a, b) => plain(a) - plain(b))[0] ?? null;
  return best(styles.filter((s) => s.bold === bold && s.italic === italic)) ?? best(styles.filter((s) => s.italic === italic && (bold ? s.bold : !s.bold))) ?? best(styles.filter((s) => s.bold === bold)) ?? styles[0] ?? null;
}

/** Every installed family the markups use, with the weights and slants each needs. */
export function namedFontUses(markups: readonly Markup[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (s: { fontFamily?: string; bold?: boolean; italic?: boolean }, measure: boolean) => {
    if (!isNamedFont(s.fontFamily)) return;
    if (!out.has(s.fontFamily)) out.set(s.fontFamily, new Set());
    out.get(s.fontFamily)!.add(`${(s.bold ?? measure) ? 1 : 0}${s.italic ? 1 : 0}`);
  };
  for (const m of markups) {
    add(m.style, true);
    add(m.style, false);
    if (m.type === 'table') for (const c of tableCells(m)) add(c.style, false);
  }
  return out;
}

// ---- The list -------------------------------------------------------------------------------------------

let listed: SystemFontFamily[] | null = null;
let listing: Promise<SystemFontFamily[]> | null = null;
/** Browser fonts by id, for reading their bytes later. */
const localHandles = new Map<string, LocalFont>();

const styleFlags = (style: string) => ({ bold: /\b(bold|black|heavy|semibold|demibold|extrabold)\b/i.test(style), italic: /\b(italic|oblique)\b/i.test(style) });

/** Whether this window can list installed fonts at all (the desktop app, or a browser with the Local Font Access API). */
export const canListSystemFonts = (): boolean => !!desktop()?.fonts || typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';

/**
 * The installed font families. In a browser this asks permission, so call it from a click (a
 * declined or missing permission gives an empty list, not an error, and is asked again next time).
 */
export function listSystemFonts(): Promise<SystemFontFamily[]> {
  if (listed) return Promise.resolve(listed);
  listing ??= (async () => {
    try {
      const host = desktop()?.fonts;
      if (host) return (listed = await host.list());
      const fonts = (await window.queryLocalFonts?.()) ?? [];
      const families = new Map<string, SystemFontFamily>();
      for (const f of fonts) {
        localHandles.set(f.postscriptName, f);
        if (!families.has(f.family)) families.set(f.family, { family: f.family, styles: [] });
        families.get(f.family)!.styles.push({ id: f.postscriptName, style: f.style, ...styleFlags(f.style) });
      }
      const out = [...families.values()].sort((a, b) => a.family.localeCompare(b.family));
      if (out.length) listed = out;
      return out;
    } catch {
      return [];
    } finally {
      listing = null;
    }
  })();
  return listing;
}

/** The font file for a family at a weight and slant, or null where it is not installed or cannot be read. */
export async function loadSystemFont(family: string, bold: boolean, italic: boolean): Promise<Uint8Array | null> {
  try {
    const entry = (listed ?? (await listSystemFonts())).find((f) => f.family === family);
    const style = entry && pickStyle(entry.styles, bold, italic);
    if (!style) return null;
    const host = desktop()?.fonts;
    if (host) return await host.read(style.id);
    const handle = localHandles.get(style.id);
    return handle ? new Uint8Array(await (await handle.blob()).arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** For `exportWithAnnotations({ systemFonts })`: installed fonts embedded into the exported PDF. */
export const exportFontSource: SystemFontSource = { fontkit, load: loadSystemFont };

// ---- On screen -------------------------------------------------------------------------------------------

type Status = 'ready' | 'missing';
const status = new Map<string, Status>();
const registered = new Set<string>();
const listeners = new Set<() => void>();

/** Runs when a font finishes loading or is found missing, so the page can repaint. Returns the unsubscribe. */
export function onSystemFontsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Families the markups use that this computer does not have (they are drawn in the nearest keyword font). */
export const missingFonts = (): string[] => [...status].filter(([, s]) => s === 'missing').map(([f]) => f);

/** Whether a family is known to be missing (false until it has been checked). */
export const isFontMissing = (family: string): boolean => status.get(family) === 'missing';

/** Whether the browser itself resolves the family, by whether it changes the width of text against two different fallbacks. */
function browserHasFont(family: string): boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return false;
    const q = family.replace(/["\\]/g, '');
    const width = (fallback: string) => {
      ctx.font = `40px "${q}", ${fallback}`;
      return ctx.measureText('mmmmmmmmmmlliWWW 0123 qgy').width;
    };
    return width('monospace') === width('serif');
  } catch {
    return false;
  }
}

/**
 * Makes the fonts the markups use ready for the canvas: loads each from its bytes as a FontFace
 * in `document.fonts` (or finds the browser already has it), and notes the ones this computer lacks.
 * Call before drawing; the canvas then draws with the family name.
 */
export async function ensureMarkupFonts(markups: readonly Markup[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  let changed = false;
  for (const [family, variants] of namedFontUses(markups)) {
    for (const v of variants) {
      const key = `${family}|${v}`;
      if (registered.has(key)) continue;
      registered.add(key);
      const bold = v[0] === '1';
      const italic = v[1] === '1';
      const bytes = await loadSystemFont(family, bold, italic);
      if (bytes) {
        try {
          const face = new FontFace(family, bytes as BufferSource, { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' });
          document.fonts.add(await face.load());
          if (status.get(family) !== 'ready') changed = true;
          status.set(family, 'ready');
          continue;
        } catch {
          // Fall through to what the browser itself has.
        }
      }
      const next: Status = status.get(family) === 'ready' || browserHasFont(family) ? 'ready' : 'missing';
      if (status.get(family) !== next) changed = true;
      status.set(family, next);
    }
  }
  if (changed) for (const cb of listeners) cb();
}
