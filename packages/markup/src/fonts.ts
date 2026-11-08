/**
 * Font choice for text markups. A markup's `fontFamily` is either one of three keywords, which map
 * to the PDF standard fonts so they look the same in every viewer, or the family name of a font
 * installed on the computer ("Segoe UI", "Calibri"), which is embedded into exported PDFs.
 */

/** The three built-in families. */
export type FontKeyword = 'sans' | 'serif' | 'mono';

/** A keyword, or an installed font's family name. (`string & {}` keeps the keywords in editor completion.) */
export type FontFamily = FontKeyword | (string & {});

export const FONT_KEYWORDS: readonly FontKeyword[] = ['sans', 'serif', 'mono'];

/** CSS stacks for the keywords. */
export const FONT_FAMILIES: { value: FontKeyword; label: string; css: string }[] = [
  { value: 'sans', label: 'Helvetica / Arial', css: 'Helvetica, Arial, sans-serif' },
  { value: 'serif', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { value: 'mono', label: 'Courier New', css: '"Courier New", Courier, monospace' },
];

/** True for 'sans', 'serif' and 'mono' (so a font family literally named one of those cannot be chosen by name). */
export function isFontKeyword(family: string | undefined | null): family is FontKeyword {
  return family === 'sans' || family === 'serif' || family === 'mono';
}

/** True for an installed font's family name: any non-empty string that is not a keyword. */
export function isNamedFont(family: string | undefined | null): family is string {
  return typeof family === 'string' && family.trim() !== '' && !isFontKeyword(family);
}

/**
 * The family name as stored: trimmed, control characters and markup characters removed, at most 100
 * characters. A keyword (in any case) gives that keyword; an empty name gives undefined.
 */
export function cleanFontName(raw: string): FontFamily | undefined {
  const name = raw.replace(/[\u0000-\u001f\u007f<>";]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return isFontKeyword(lower) ? lower : name;
}

/**
 * The keyword nearest a font, for everywhere only the three standard fonts are available (a font
 * that cannot be embedded, a viewer without the font). Deliberately simple: a name containing
 * Mono, Courier, Consolas, Typewriter or the like is mono; Times, Georgia, Garamond, Cambria, a
 * "Serif" without "Sans", and similar are serif; everything else is sans.
 */
export function fontKeyword(family: FontFamily | undefined | null): FontKeyword {
  if (!family) return 'sans';
  if (isFontKeyword(family)) return family;
  const n = family.toLowerCase();
  if (/mono|courier|consolas|typewriter|fixed|lucida console|menlo|monaco|source code/.test(n)) return 'mono';
  if (/sans|gothic|grotesk|arial|helvetica|calibri|verdana|tahoma|segoe/.test(n)) return 'sans';
  if (/serif|times|georgia|garamond|palatino|cambria|bookman|book antiqua|century|didot|bodoni|baskerville|minion|roman|caslon|constantia/.test(n)) return 'serif';
  return 'sans';
}

/** A CSS font-family list: the keyword's stack, or the quoted family name followed by the nearest keyword's stack. */
export function cssFontFamily(family: FontFamily | undefined | null): string {
  const keyword = FONT_FAMILIES.find((f) => f.value === fontKeyword(family))!;
  if (!isNamedFont(family)) return keyword.css;
  return `"${family.replace(/["\\]/g, '')}", ${keyword.css}`;
}

/** Acrobat's default-resource names for the keywords, used in FreeText /DA strings. */
const DA_KEYWORD_NAMES: Record<FontKeyword, string> = { sans: 'Helv', serif: 'TiRo', mono: 'Cour' };

/** The font name for a FreeText /DA: Acrobat's name for a keyword, else the family name made safe as a PDF name (no spaces). */
export function daFontName(family: FontFamily | undefined | null): string {
  if (!isNamedFont(family)) return DA_KEYWORD_NAMES[fontKeyword(family)];
  return family.replace(/[^A-Za-z0-9_.+-]/g, '') || DA_KEYWORD_NAMES[fontKeyword(family)];
}

/** Font names, styles and sizes are read from files; anything longer than this is cut before it is parsed. */
export const MAX_FONT_STRING = 256;

const isSpace = (c: string | undefined) => c !== undefined && c.trim() === '';

/** The text without quotes and whitespace at both ends. */
export function trimQuotesAndSpace(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === "'" || s[a] === '"' || isSpace(s[a]))) a++;
  while (b > a && (s[b - 1] === "'" || s[b - 1] === '"' || isSpace(s[b - 1]))) b--;
  return s.slice(a, b);
}

/** The name without trailing style words (bold, italic, oblique, regular) and the -, comma and space runs before them. */
function stripStyleSuffix(s: string): string {
  const lower = s.toLowerCase();
  let end = s.length;
  for (;;) {
    const word = ['bold', 'italic', 'oblique', 'regular'].find((w) => end >= w.length && lower.startsWith(w, end - w.length));
    if (!word) return s.slice(0, end);
    end -= word.length;
    while (end > 0 && (s[end - 1] === '-' || s[end - 1] === ',' || isSpace(s[end - 1]))) end--;
  }
}

/**
 * Lengths written like "12pt" or "9.5 px" (digits and dots, optional spaces, then a unit), in order
 * and without overlap. Scans the text once, so it is linear however it is made up.
 */
export function findLengths(s: string, units: readonly string[]): { start: number; end: number; value: string }[] {
  const lower = s.toLowerCase();
  const out: { start: number; end: number; value: string }[] = [];
  let floor = 0;
  for (let j = 0; j < s.length; j++) {
    const unit = units.find((u) => lower.startsWith(u, j));
    if (!unit) continue;
    let k = j;
    while (k > floor && isSpace(s[k - 1])) k--;
    let m = k;
    while (m > floor && /[\d.]/.test(s[m - 1]!)) m--;
    if (m === k) continue;
    out.push({ start: m, end: j + unit.length, value: s.slice(m, k) });
    floor = j + unit.length;
    j = floor - 1;
  }
  return out;
}

/** The value of the first `name: value` declaration in a CSS-like string whose property is one of `names` (case-insensitive). */
export function cssDeclaration(css: string, names: readonly string[]): string | undefined {
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const key = decl.slice(0, i).trim().toLowerCase();
    if (names.some((n) => key === n || key.endsWith(`-${n}`))) return decl.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * The family a /DA font name or rich text font-family stands for: the keyword for the standard
 * names (Helv, Arial, Times New Roman, Courier ...), else the name itself, with the style
 * suffixes PostScript names carry ("Calibri-Bold", "ComicSansMS,Italic") taken off.
 */
export function familyFromPdfName(rawName: string): FontFamily {
  const name = rawName.slice(0, MAX_FONT_STRING).replace(/^[A-Z]{6}\+/, '').trim();
  // PostScript names (no spaces) end in -Bold, MT, PS and the like; a family with spaces ("Gill Sans MT") is kept whole.
  const style = stripStyleSuffix;
  const postScript = !/\s/.test(style(name));
  const base = postScript ? style(style(name).replace(/(?:PSMT|MT|PS)$/, '')).replace(/(?:PSMT|MT|PS)$/, '') : style(name);
  const squashed = base.toLowerCase().replace(/[\s_-]+/g, '');
  if (['helv', 'helvetica', 'arial'].includes(squashed)) return 'sans';
  if (['tiro', 'times', 'timesroman', 'timesnewroman'].includes(squashed)) return 'serif';
  if (['cour', 'courier', 'couriernew'].includes(squashed)) return 'mono';
  return cleanFontName(base) ?? 'sans';
}

// ---- Embedding permission (OS/2 fsType) ---------------------------------------------------------------

export type FontEmbedding = 'installable' | 'editable' | 'preview' | 'restricted';

export interface FontPermissions {
  embedding: FontEmbedding;
  /** The font says it must not be subset: embed all of it. */
  noSubsetting: boolean;
  /** Only bitmaps may be embedded, which a PDF text font cannot use. */
  bitmapOnly: boolean;
}

const u16 = (v: DataView, o: number) => v.getUint16(o, false);
const u32 = (v: DataView, o: number) => v.getUint32(o, false);

/** The location of a table in a single-font sfnt file (TrueType or OpenType), or null. */
function sfntTable(v: DataView, tag: string): { offset: number; length: number } | null {
  if (v.byteLength < 12) return null;
  const count = u16(v, 4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > v.byteLength) return null;
    const t = String.fromCharCode(v.getUint8(rec), v.getUint8(rec + 1), v.getUint8(rec + 2), v.getUint8(rec + 3));
    if (t === tag) return { offset: u32(v, rec + 8), length: u32(v, rec + 12) };
  }
  return null;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Whether the bytes are a single sfnt font with TrueType outlines (the only kind pdf-lib embeds correctly as FontFile2). */
export function isTrueTypeOutline(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const v = view(bytes);
  const version = u32(v, 0);
  return (version === 0x00010000 || version === 0x74727565) && !!sfntTable(v, 'glyf');
}

/**
 * What the font's OS/2 table (fsType) allows. Restricted license embedding (0x0002) forbids
 * embedding at all; preview and print (0x0004), editable (0x0008) and installable (0) allow it.
 * A font without an OS/2 table states no restriction. null when the bytes are not an sfnt font.
 */
export function fontPermissions(bytes: Uint8Array): FontPermissions | null {
  if (bytes.length < 12) return null;
  const v = view(bytes);
  const version = u32(v, 0);
  if (version !== 0x00010000 && version !== 0x74727565 && version !== 0x4f54544f) return null;
  const os2 = sfntTable(v, 'OS/2');
  if (!os2 || os2.offset + 10 > v.byteLength) return { embedding: 'installable', noSubsetting: false, bitmapOnly: false };
  const fs = u16(v, os2.offset + 8);
  const embedding: FontEmbedding = fs & 0x0002 ? 'restricted' : fs & 0x0008 ? 'editable' : fs & 0x0004 ? 'preview' : 'installable';
  return { embedding, noSubsetting: !!(fs & 0x0100), bitmapOnly: !!(fs & 0x0200) };
}

/** Whether a font may be embedded in an exported PDF. */
export function canEmbedFont(bytes: Uint8Array): boolean {
  const p = fontPermissions(bytes);
  return !!p && p.embedding !== 'restricted' && !p.bitmapOnly;
}
