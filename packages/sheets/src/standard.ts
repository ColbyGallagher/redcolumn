import { disciplineFor, isDrawingNumberShape, normalizeSheetNumber } from './detect.ts';
import type { ChainageHints } from './chainage.ts';
import type { LinkHints } from './links.ts';
import { textInRegion, type Region } from './regions.ts';
import type { PageText, SheetInfo, Word } from './types.ts';

/**
 * Drawing standards: what a person knows about one client's drawings, written down once and used
 * on every set from that client. This file holds the title-block part (which box holds the sheet
 * number, title, revision and scale, and how the client numbers drawings); detection falls back to
 * its heuristics wherever a page does not fit.
 */

/**
 * What a title-block box holds. `ignore` boxes hold numbers that are not the sheet's (file,
 * contract); `custom` boxes hold a field the person names (Status, Drawn by, Package).
 */
export type TitleField = 'number' | 'title' | 'revision' | 'scale' | 'custom' | 'ignore';

export const TITLE_FIELDS: Record<TitleField, string> = {
  number: 'Sheet number',
  title: 'Sheet title',
  revision: 'Revision',
  scale: 'Scale',
  custom: 'Your own field…',
  ignore: 'Ignore (other number)',
};

/**
 * A title-block box as fractions of the page's width and height, so a set printed at another
 * paper size (A1 sheets as A3) reads from the same place.
 */
export interface TitleBox {
  field: TitleField;
  /** A custom field's name (Status, Drawn by). */
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What detection needs from a drawing standard to read sheets. */
export interface SheetHints {
  boxes: TitleBox[];
  /**
   * How the client numbers drawings: `#` a digit, `@` a letter, `?` either, `*` a run of letters
   * and digits, `\` before one of those for the character itself; anything else as written.
   * `HLD1BDD-WSPAU-####-@@-DRG-######`. Null when any number shape will do.
   */
  template: string | null;
  /** Which part of the number (split at `-`, `.`, `_`, `/` and spaces) names the discipline; null: the US CAD standard prefix. */
  disciplinePart: number | null;
  /** Discipline names by code (`BR` → Bridges). A code without one reads as itself. */
  disciplines: Record<string, string>;
}

export const NO_SHEET_HINTS: SheetHints = { boxes: [], template: null, disciplinePart: null, disciplines: {} };

/** Everything detection takes from a drawing standard: how to read sheets, and how to read links between them. */
export interface SetHints {
  sheets: SheetHints;
  links: LinkHints;
  chainage: ChainageHints;
}

/** A box drawn on a page, as a title-block box of that page. */
export function boxFromRegion(r: Region, page: { width: number; height: number }, field: TitleField, name?: string): TitleBox {
  const f = (v: number, of: number) => Math.round((v / of) * 1e5) / 1e5;
  const box: TitleBox = { field, x: f(r.x, page.width), y: f(r.y, page.height), w: f(r.w, page.width), h: f(r.h, page.height) };
  if (field === 'custom') box.name = name?.trim() || 'Field';
  return box;
}

/** Where a title-block box sits on a page, in page space. */
export function regionOfBox(b: TitleBox, page: { width: number; height: number }): Region {
  return { x: b.x * page.width, y: b.y * page.height, w: b.w * page.width, h: b.h * page.height };
}

const SEPARATORS = /([-._/\s]+)/;

/** The parts of a drawing number, without separators: `HLD1BDD-WSPAU-0508-BR` → HLD1BDD, WSPAU, 0508, BR. */
export function numberParts(number: string): string[] {
  return number
    .trim()
    .toUpperCase()
    .split(SEPARATORS)
    .filter((p, i) => i % 2 === 0 && p);
}

const TEMPLATE_CHARS = new Set(['#', '@', '?', '*', '\\']);
/** A character as itself in a template. */
const literal = (ch: string) => (TEMPLATE_CHARS.has(ch) ? `\\${ch}` : ch);

/** A drawing-number template as a pattern for whole numbers (see SheetHints.template). */
export function templateRegex(template: string): RegExp {
  let src = '';
  const t = template.trim().toUpperCase();
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === '\\' && i + 1 < t.length) src += escape(t[++i]!);
    else if (ch === '#') src += '\\d';
    else if (ch === '@') src += '[A-Z]';
    else if (ch === '?') src += '[A-Z0-9]';
    else if (ch === '*') src += '[A-Z0-9]+';
    else src += escape(ch);
  }
  return new RegExp(`^${src}$`);
}

function escape(ch: string): string {
  return /[\\^$.*+?()[\]{}|/-]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * The template that fits a set of drawing numbers: parts that are the same on every sheet are
 * kept as written, parts that change become `#`/`@`/`?` per character (or `*` when their length
 * changes too). Null when the numbers are not built the same way (different separators or parts).
 */
export function deriveTemplate(numbers: readonly string[]): string | null {
  const split = [...new Set(numbers.map((n) => n.trim().toUpperCase()).filter(Boolean))].map((n) => n.split(SEPARATORS));
  if (!split.length) return null;
  const shape = split[0]!;
  if (split.some((s) => s.length !== shape.length || s.some((p, i) => i % 2 === 1 && p !== shape[i]))) return null;
  let out = '';
  for (let i = 0; i < shape.length; i++) {
    const values = split.map((s) => s[i]!);
    if (i % 2 === 1) out += values[0];
    else if (values.every((v) => v === values[0])) out += [...values[0]!].map(literal).join('');
    else if (values.every((v) => v.length === values[0]!.length))
      out += [...values[0]!]
        // Digits in a part that changes are counted, never kept (300082 and 300090 share 3000 by chance).
        .map((ch, k) => (values.every((v) => /\d/.test(v[k]!)) ? '#' : values.every((v) => v[k] === ch) ? literal(ch) : values.every((v) => /[A-Z]/.test(v[k]!)) ? '@' : '?'))
        .join('');
    else out += '*';
  }
  return out;
}

/**
 * The discipline a number names under a standard: its discipline part's name. Numbers outside the
 * client's scheme (another consultant's sheets), and standards that name no part, use the US CAD
 * standard prefix.
 */
export function disciplineOf(number: string, hints: SheetHints): string | null {
  if (hints.disciplinePart === null || (hints.template && !templateRegex(hints.template).test(number.trim().toUpperCase()))) return disciplineFor(number);
  const code = numberParts(number)[hints.disciplinePart];
  if (!code) return null;
  return hints.disciplines[code] ?? code;
}

const TRAILING = new Set([',', ';', ':', ')']);
/** A word without opening brackets or trailing punctuation (trimmed by hand: a `[...]+$` regex is slow on long runs). */
const clean = (t: string) => {
  const s = t.trim().toUpperCase();
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === '(') start++;
  while (end > start && TRAILING.has(s[end - 1]!)) end--;
  return s.slice(start, end);
};
/** Labels printed in front of each field inside the boxes people draw: `DRAWING TITLE`, `SHEET NO.`, `REV`. */
const FIELD_LABEL: Record<TitleField, RegExp> = {
  number: /^((SHEET|DRAWING|DRG|DWG|DOCUMENT|DOC|PLAN)\.?\s+)?(NO\.?|NUMBER|NUM|#)\s*:?\s*/i,
  title: /^((SHEET|DRAWING|DRG|DWG)\s+)?TITLE\s*:?\s*/i,
  revision: /^(REV\.?|REVISION|ISSUE)(\s+NO\.?)?\s*:?\s*/i,
  scale: /^SCALE\s*:?\s*/i,
  custom: /^/,
  ignore: /^/,
};
/** A single word that is only a label, never a sheet number. */
const LABEL_WORD = /^(SHEET|DRAWING|DRG|DWG|DOCUMENT|DOC|PLAN|NO\.?|NUMBER|NUM|#|:|-)$/;

function inBox(w: Word, r: Region): boolean {
  const cx = (w.x0 + w.x1) / 2;
  const cy = (w.y0 + w.y1) / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

/** A box's text without the field's label in front of it. */
function fieldText(words: readonly Word[], r: Region, field: TitleField): string {
  return textInRegion(words, r).replace(FIELD_LABEL[field], '').trim();
}

/**
 * The sheet number in a box: a word (or the box's words run together, for `C - 101`) that fits the
 * template; with no template, the largest word shaped like a drawing number.
 */
function numberIn(words: readonly Word[], r: Region, pattern: RegExp | null): string | null {
  const inside = words.filter((w) => inBox(w, r) && w.text.trim()).sort((a, b) => b.size - a.size);
  const tokens = inside.map((w) => clean(w.text)).filter((t) => t && !LABEL_WORD.test(t));
  const joined = fieldText(words, r, 'number').toUpperCase().replace(/\s+/g, '');
  const options = [...tokens, joined];
  if (pattern) return options.find((t) => pattern.test(t)) ?? null;
  return options.find((t) => normalizeSheetNumber(t) || isDrawingNumberShape(t)) ?? null;
}

/**
 * A page's sheet info read from the standard's boxes, or null when its number box holds no number
 * that fits (a cover, a report page, a sheet from another consultant): those pages are left to the
 * heuristics.
 */
export function readSheet(page: PageText, hints: SheetHints): SheetInfo | null {
  const pattern = hints.template ? templateRegex(hints.template) : null;
  const boxes = (field: TitleField) => hints.boxes.filter((b) => b.field === field).map((b) => regionOfBox(b, page));
  let number: string | null = null;
  for (const r of boxes('number')) if ((number = numberIn(page.words, r, pattern))) break;
  if (!number) return null;
  const text = (field: TitleField) =>
    boxes(field)
      .map((r) => fieldText(page.words, r, field))
      .filter(Boolean)
      .join(' ') || null;
  const revision = text('revision');
  const info: SheetInfo = {
    number,
    title: text('title'),
    discipline: disciplineOf(number, hints),
    scaleText: text('scale'),
    // A revision box often holds the whole history; the current one is the last entry.
    revision: revision ? revision.split(' ').at(-1)! : null,
    source: 'standard',
    confidence: pattern ? 0.95 : 0.8,
  };
  const fields = customFields(page, hints.boxes);
  if (fields) info.fields = fields;
  return info;
}

/** The custom fields' values on a page, each without its own name printed in front (`STATUS: FOR CONSTRUCTION`). */
function customFields(page: PageText, boxes: readonly TitleBox[]): Record<string, string> | null {
  // A Map, so a field named like an Object property (`__proto__`) is still just a field.
  const out = new Map<string, string>();
  for (const b of boxes) {
    if (b.field !== 'custom' || !b.name) continue;
    let value = textInRegion(page.words, regionOfBox(b, page)).trim();
    const name = b.name.toUpperCase();
    if (value.toUpperCase().startsWith(name)) {
      value = value.slice(name.length);
      let k = 0;
      while (k < value.length && (value[k] === ':' || value[k] === ' ')) k++;
      value = value.slice(k);
    }
    // Two boxes with one name (a field split over two lines) read as one.
    if (value) out.set(b.name, out.has(b.name) ? `${out.get(b.name)} ${value}` : value);
  }
  return out.size ? Object.fromEntries(out) : null;
}

/** Whether a word on a page sits in one of the standard's ignore boxes. */
export function ignoredBy(hints: SheetHints, page: { width: number; height: number }): (w: Word) => boolean {
  const ignore = hints.boxes.filter((b) => b.field === 'ignore').map((b) => regionOfBox(b, page));
  return (w) => ignore.some((r) => inBox(w, r));
}

/** How well a standard reads a set: the pages whose number box gave a number, and the ones it did not. */
export function standardCoverage(pages: readonly PageText[], hints: SheetHints): { read: number[]; missed: number[] } {
  const read: number[] = [];
  const missed: number[] = [];
  pages.forEach((p, i) => (p.words.length && readSheet(p, hints) ? read : missed).push(i));
  return { read, missed };
}

/**
 * How well a drawing standard fits a set, from 0 to 1, read from up to `sample` pages with text
 * spread through it: the share of them whose number box holds a number in the client's scheme,
 * or that print one of `identify` (the client's name, a project code). Null when the standard has
 * neither a template nor identifying words, since any set would seem to fit it.
 */
export function standardFit(pages: readonly PageText[], hints: SheetHints, identify: readonly string[] = [], sample = 30): number | null {
  const words = identify.map((w) => w.trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean);
  const scheme = !!hints.template && hints.boxes.some((b) => b.field === 'number');
  if (!scheme && !words.length) return null;
  const withText = pages.filter((p) => p.words.length);
  if (!withText.length) return 0;
  const step = Math.max(1, withText.length / sample);
  let fits = 0;
  let seen = 0;
  for (let k = 0; k < withText.length && seen < sample; k += step, seen++) {
    const page = withText[Math.floor(k)]!;
    if (scheme && readSheet(page, hints)) fits++;
    else if (words.length) {
      const text = ` ${page.words.map((w) => w.text.trim().toUpperCase()).join(' ')} `;
      if (words.some((w) => text.includes(` ${w} `))) fits++;
    }
  }
  return fits / seen;
}
