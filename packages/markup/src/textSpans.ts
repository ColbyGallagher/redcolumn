// Per-selection text styling: bold, italic, underline, strikethrough and colour on parts of a text
// markup's text. `Markup.text` stays the plain string (it is what /Contents holds, so other tools
// and round trips read it unchanged); `Markup.spans` rides beside it and only overrides the markup's
// own style where a run differs. Offsets are UTF-16 code units into `text`.

import { parseListItem } from './textLists.ts';
import { textColor } from './style.ts';
import type { MarkupStyle } from './model';

/** What a span changes about the markup's own text style. A flag left out means "as the markup". */
export interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** #rrggbb */
  color?: string;
}

/** `[start, end)` of the text drawn in `style`. */
export interface TextSpan {
  start: number;
  end: number;
  style: SpanStyle;
}

/** The markup's own text style, which spans override. */
export interface BaseTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color: string;
}

/** A piece of text drawn in one style, every flag resolved. */
export interface TextRun {
  text: string;
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string;
}

/** Width of a string in the font of the given weight and slant, at the markup's size. */
export type StyledMeasure = (s: string, bold: boolean, italic: boolean) => number;

/** The markup's own text style, which a span overrides. */
export function baseTextStyle(m: { style: MarkupStyle }): BaseTextStyle {
  return { bold: m.style.bold, italic: m.style.italic, underline: m.style.underline, strikethrough: m.style.strikethrough, color: textColor(m.style) };
}

const FLAGS = ['bold', 'italic', 'underline', 'strikethrough'] as const;
export type SpanFlag = (typeof FLAGS)[number];

const COLOR = /^#[0-9a-f]{6}$/i;

/** A style with only its meaningful fields (a flag left unset stays unset; false is an override). */
function cleanStyle(s: SpanStyle): SpanStyle {
  const out: SpanStyle = {};
  for (const f of FLAGS) if (typeof s[f] === 'boolean') out[f] = s[f];
  if (typeof s.color === 'string' && COLOR.test(s.color)) out.color = s.color.toLowerCase();
  return out;
}

const sameStyle = (a: SpanStyle, b: SpanStyle) => FLAGS.every((f) => a[f] === b[f]) && a.color === b.color;
const isEmptyStyle = (s: SpanStyle) => FLAGS.every((f) => s[f] === undefined) && s.color === undefined;

/**
 * Spans tidied for a text of `length`: clipped to it, in order, none empty, none overlapping (a
 * later span wins where two overlap), and neighbours of the same style joined. Anything that is not
 * a span is dropped, so spans read from a file are safe to use.
 */
export function normalizeSpans(spans: readonly TextSpan[] | undefined | null, length: number): TextSpan[] {
  if (!Array.isArray(spans) || !length) return [];
  // Per-character style, painted in order so a later span wins an overlap.
  const per: (SpanStyle | undefined)[] = new Array(length);
  for (const sp of spans) {
    if (!sp || typeof sp.start !== 'number' || typeof sp.end !== 'number' || !sp.style || typeof sp.style !== 'object') continue;
    const style = cleanStyle(sp.style);
    if (isEmptyStyle(style)) continue;
    const a = Math.max(0, Math.floor(sp.start));
    const b = Math.min(length, Math.floor(sp.end));
    for (let i = a; i < b; i++) per[i] = { ...per[i], ...style };
  }
  return fromPerChar(per);
}

function fromPerChar(per: readonly (SpanStyle | undefined)[]): TextSpan[] {
  const out: TextSpan[] = [];
  let i = 0;
  while (i < per.length) {
    const s = per[i];
    if (!s || isEmptyStyle(s)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < per.length && per[j] && sameStyle(per[j]!, s)) j++;
    out.push({ start: i, end: j, style: s });
    i = j;
  }
  return out;
}

/** The spans a markup draws with, or none. */
export function spansOf(m: { text?: string; spans?: readonly TextSpan[] }): TextSpan[] {
  return m.spans?.length ? normalizeSpans(m.spans, (m.text ?? '').length) : [];
}

/** Whether styling the markup's text per run changes anything about how it draws. */
export const hasSpans = (m: { text?: string; spans?: readonly TextSpan[] }): boolean => spansOf(m).length > 0;

/** The text split into runs of one style each, every flag resolved against the markup's own style. */
export function styleRuns(text: string, spans: readonly TextSpan[], base: BaseTextStyle): TextRun[] {
  const per = perChar(text.length, spans);
  const runs: TextRun[] = [];
  let i = 0;
  const resolve = (s: SpanStyle | undefined) => ({
    bold: s?.bold ?? !!base.bold,
    italic: s?.italic ?? !!base.italic,
    underline: s?.underline ?? !!base.underline,
    strikethrough: s?.strikethrough ?? !!base.strikethrough,
    color: s?.color ?? base.color,
  });
  while (i < text.length) {
    const r = resolve(per[i]);
    let j = i + 1;
    while (j < text.length) {
      const n = resolve(per[j]);
      if (n.bold !== r.bold || n.italic !== r.italic || n.underline !== r.underline || n.strikethrough !== r.strikethrough || n.color !== r.color) break;
      j++;
    }
    runs.push({ text: text.slice(i, j), start: i, end: j, ...r });
    i = j;
  }
  return runs;
}

function perChar(length: number, spans: readonly TextSpan[]): (SpanStyle | undefined)[] {
  const per: (SpanStyle | undefined)[] = new Array(length);
  for (const sp of normalizeSpans(spans, length)) for (let i = sp.start; i < sp.end; i++) per[i] = sp.style;
  return per;
}

/** The runs cut at `[start, end)`: the part of each run inside it. */
export function runsWithin(runs: readonly TextRun[], start: number, end: number): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const a = Math.max(r.start, start);
    const b = Math.min(r.end, end);
    if (a < b) out.push({ ...r, text: r.text.slice(a - r.start, b - r.start), start: a, end: b });
  }
  return out;
}

/** Styles `[start, end)` with the changes in `patch` (a flag set to undefined goes back to the markup's own); neighbours are merged. */
export function applySpanStyle(spans: readonly TextSpan[] | undefined, start: number, end: number, patch: SpanStyle & { [K in keyof SpanStyle]: SpanStyle[K] | undefined }, length: number): TextSpan[] {
  const per = perChar(length, spans ?? []);
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(length, Math.max(start, end));
  for (let i = a; i < b; i++) {
    const next: SpanStyle = { ...per[i] };
    for (const k of Object.keys(patch) as (keyof SpanStyle)[]) {
      if (patch[k] === undefined) delete next[k];
      else (next as Record<string, unknown>)[k] = patch[k];
    }
    per[i] = isEmptyStyle(next) ? undefined : next;
  }
  return fromPerChar(per);
}

/**
 * Toggles a flag over `[start, end)` as Word does: on unless all of it already has it, then off.
 * An override that matches the markup's own style is dropped, so the text is "plain" again.
 */
export function toggleSpanFlag(text: string, spans: readonly TextSpan[] | undefined, start: number, end: number, flag: SpanFlag, base: BaseTextStyle): TextSpan[] {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));
  const covered = styleRuns(text, spans ?? [], base).filter((r) => r.end > a && r.start < b && !/^\s*$/.test(text.slice(Math.max(r.start, a), Math.min(r.end, b))));
  // Blank selections (only spaces and line breaks) style as if the lot had no flag.
  const all = covered.length > 0 && covered.every((r) => r[flag]);
  const value = !all;
  return applySpanStyle(spans, a, b, { [flag]: value === !!base[flag] ? undefined : value }, text.length);
}

/** Whether every non-blank character in `[start, end)` has the flag (what a toolbar button shows as pressed). */
export function rangeHasFlag(text: string, spans: readonly TextSpan[] | undefined, start: number, end: number, flag: SpanFlag, base: BaseTextStyle): boolean {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const covered = styleRuns(text, spans ?? [], base).filter((r) => r.end > a && r.start < b);
  return covered.length > 0 && covered.every((r) => r[flag]);
}

/**
 * Spans moved to where the same characters sit after `before` became `after`: the part that
 * differs (found from the common head and tail) is replaced, characters typed inside a span take
 * its style, and spans on removed characters shrink or go.
 */
export function shiftSpans(spans: readonly TextSpan[] | undefined, before: string, after: string): TextSpan[] {
  const old = normalizeSpans(spans, before.length);
  if (!old.length || before === after) return before === after ? old : [];
  const max = Math.min(before.length, after.length);
  let head = 0;
  while (head < max && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const removed = before.length - tail - head;
  const added = after.length - tail - head;
  const per: (SpanStyle | undefined)[] = new Array(after.length);
  const was = perChar(before.length, old);
  for (let i = 0; i < head; i++) per[i] = was[i];
  for (let i = 0; i < tail; i++) per[after.length - 1 - i] = was[before.length - 1 - i];
  // New characters take the style of the one before them when it continues past the edit (typing inside a span).
  const inside = head > 0 && head < before.length && was[head - 1] && was[head] && sameStyle(was[head - 1]!, was[head]!) ? was[head - 1] : head > 0 && removed > 0 ? was[head - 1] : undefined;
  for (let i = 0; i < added; i++) per[head + i] = inside;
  return fromPerChar(per);
}

/** A word's offsets are found by walking the paragraph in these pieces: runs of spaces, single CJK characters, and the rest. */
const CJK_CHAR = '\\u2e80-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff\\uff00-\\uffef';

/** One laid-out line: where it sits in the text, how far a wrapped list line hangs in, and how wide it draws. */
export interface RunLine {
  text: string;
  start: number;
  end: number;
  indent: number;
  last: boolean;
  width: number;
}

/**
 * `layoutParagraphs` for text with runs of different weight and slant: wraps at `maxWidth`, each
 * word measured in the font of the characters it is made of. Lines are ranges of the text, so a
 * caller can cut them into the runs they are drawn in.
 */
export function layoutRuns(text: string, spans: readonly TextSpan[], base: BaseTextStyle, maxWidth: number, measure: StyledMeasure): RunLine[] {
  const runs = styleRuns(text, spans, base);
  const fallback = { bold: !!base.bold, italic: !!base.italic };
  /** Width of `[a, b)`, each piece in its own font. */
  const rangeWidth = (a: number, b: number): number => {
    if (b <= a) return 0;
    let w = 0;
    for (const r of runsWithin(runs, a, b)) w += measure(r.text, r.bold, r.italic);
    return w;
  };
  const out: RunLine[] = [];
  let offset = 0;
  for (const para of text.split('\n')) {
    const start = offset;
    offset += para.length + 1;
    const item = parseListItem(para);
    const prefixLen = item ? item.prefixLen : 0;
    // Measured with a trailing glyph, since widths of trailing spaces may not count.
    const pipe = measure('|', fallback.bold, fallback.italic);
    const hang = item ? Math.min(rangeWidthWithGlyph(runs, start, start + prefixLen, measure, fallback) - pipe, maxWidth / 2) : 0;
    const lines = wrapRange(para.slice(prefixLen), start + prefixLen, maxWidth - hang, rangeWidth);
    lines.forEach((ln, i) => {
      const last = i === lines.length - 1;
      const first = i === 0;
      const a = first ? start : ln.start;
      out.push({ text: text.slice(a, ln.end), start: a, end: ln.end, indent: first ? 0 : hang, last, width: rangeWidth(a, ln.end) });
    });
  }
  return out;
}

function rangeWidthWithGlyph(runs: readonly TextRun[], a: number, b: number, measure: StyledMeasure, fb: { bold: boolean; italic: boolean }): number {
  if (b <= a) return measure('|', fb.bold, fb.italic);
  const inside = runsWithin(runs, a, b);
  let w = 0;
  inside.forEach((r, i) => {
    w += measure(i === inside.length - 1 ? `${r.text}|` : r.text, r.bold, r.italic);
  });
  return w;
}

/** Greedy word wrap of `para` (whose first character is at `base` in the text), as `wrapParagraph` does, as ranges. */
function wrapRange(para: string, base: number, maxWidth: number, width: (a: number, b: number) => number): { start: number; end: number }[] {
  const lines: { start: number; end: number }[] = [];
  const tokens: { text: string; start: number }[] = [];
  let pos = 0;
  for (const word of para.split(new RegExp(`(\\s+|[${CJK_CHAR}])`)).filter((w) => w !== '')) {
    tokens.push({ text: word, start: base + pos });
    pos += word.length;
  }
  let lineStart = base;
  let lineEnd = base;
  /** End of the line's text, trailing blanks off. */
  const trimmedEnd = (a: number, b: number) => {
    let e = b;
    while (e > a && /\s/.test(para[e - 1 - base]!)) e--;
    return e;
  };
  const breakLong = () => {
    // A word wider than the box breaks where it runs out, as other tools break it.
    while (maxWidth > 0) {
      const a = lineStart;
      const e = trimmedEnd(a, lineEnd);
      if (e <= a || width(a, e) <= maxWidth) return;
      const chars = Array.from(para.slice(a - base, e - base));
      if (chars.length <= 1) return;
      let n = chars.length - 1;
      const cut = (k: number) => a + chars.slice(0, k).join('').length;
      while (n > 1 && width(a, cut(n)) > maxWidth) n--;
      lines.push({ start: a, end: cut(n) });
      lineStart = cut(n);
    }
  };
  let first = true;
  for (const t of tokens) {
    const tEnd = t.start + t.text.length;
    if (first) {
      lineStart = t.start;
      lineEnd = tEnd;
      first = false;
    } else {
      const startsLine = /^\s/.test(t.text) ? false : width(lineStart, trimmedEnd(lineStart, tEnd)) > maxWidth && trimmedEnd(lineStart, lineEnd) > lineStart;
      if (startsLine) {
        lines.push({ start: lineStart, end: trimmedEnd(lineStart, lineEnd) });
        lineStart = t.start;
        lineEnd = tEnd;
      } else {
        lineEnd = tEnd;
      }
    }
    breakLong();
  }
  lines.push({ start: lineStart, end: Math.max(lineStart, trimmedEnd(lineStart, lineEnd)) });
  return lines;
}
