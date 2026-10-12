/**
 * Lists in text markups. A list is plain text (`• item`, `1. item`, `[ ] item`) indented four spaces
 * per level, so it round-trips through other PDF tools as ordinary characters and the markup's
 * `text` stays a plain string. Everything here is a pure function from text and selection to text
 * and selection; the editor applies the result.
 */

export type ListKind = 'bullet' | 'number' | 'letter' | 'roman' | 'check';
type OrderedKind = 'number' | 'letter' | 'roman';

/** Spaces of indent per list level. */
export const LIST_INDENT = 4;
const MAX_LEVEL = 8;
/** Bullets by level. All are in WinAnsi, so they survive export in the PDF standard fonts. */
export const BULLETS = ['•', '–', '›'];
/** Numbered lists change style as they nest: 1. then a. then i. */
const NUMBER_CYCLE: OrderedKind[] = ['number', 'letter', 'roman'];

export interface ListItem {
  level: number;
  kind: ListKind;
  /** The marker as written: `•`, `[x]`, `12.`, `b)`. */
  marker: string;
  /** Ordered markers: the number it stands for, whether it is upper case, and its delimiter. */
  value: number;
  upper: boolean;
  delim: '.' | ')';
  /** A lone letter that could be a roman numeral (`i`, `v`, `x`…); its style depends on its neighbours. */
  ambiguous: boolean;
  /** Length of the text before the content: indent, marker and the space after it. */
  prefixLen: number;
  content: string;
}

/** A text change and where the selection lands after it. */
export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

const ITEM = /^( *)(\[[ xX]\]|[•–›·*-]|\d{1,4}[.)]|[A-Za-z]{1,4}[.)]) (.*)$/;

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const ROMAN_VALUE: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function toRoman(n: number): string {
  let s = '';
  for (const [v, r] of ROMAN) {
    while (n >= v) {
      s += r;
      n -= v;
    }
  }
  return s;
}

/** The value of a canonical roman numeral (any case), or null. */
function fromRoman(s: string): number | null {
  const t = s.toLowerCase();
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN_VALUE[t[i]!];
    if (!v) return null;
    total += v < (ROMAN_VALUE[t[i + 1]!] ?? 0) ? -v : v;
  }
  return total > 0 && toRoman(total) === t ? total : null;
}

const letterValue = (s: string) => s.toLowerCase().charCodeAt(0) - 96;
const toLetter = (n: number) => String.fromCharCode(97 + ((Math.max(n, 1) - 1) % 26));

const cycleKind = (level: number): OrderedKind => NUMBER_CYCLE[level % NUMBER_CYCLE.length]!;
const isOrdered = (k: ListKind): k is OrderedKind => k === 'number' || k === 'letter' || k === 'roman';

/** The marker text for an ordered item. */
function orderedMarker(kind: OrderedKind, value: number, upper: boolean, delim: string): string {
  const body = kind === 'number' ? String(value) : kind === 'letter' ? toLetter(value) : toRoman(value);
  return (upper ? body.toUpperCase() : body) + delim;
}

/** A marker's value read as the given ordered style, or null if it is not one. */
function valueUnder(marker: string, kind: OrderedKind): number | null {
  const body = marker.slice(0, -1);
  if (kind === 'number') return /^\d+$/.test(body) ? Number(body) : null;
  if (kind === 'letter') return body.length === 1 && /[a-z]/i.test(body) ? letterValue(body) : null;
  return fromRoman(body);
}

/** The list item a line is, or null for ordinary text. */
export function parseListItem(line: string): ListItem | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  const indent = m[1]!;
  const marker = m[2]!;
  const base = { level: Math.floor(indent.length / LIST_INDENT), marker, prefixLen: indent.length + marker.length + 1, content: m[3]! };
  if (marker.startsWith('[')) return { ...base, kind: 'check', value: 0, upper: false, delim: '.', ambiguous: false };
  const delim = marker.endsWith(')') ? ')' : '.';
  const body = marker.slice(0, -1);
  if (!/[.)]$/.test(marker)) return { ...base, kind: 'bullet', value: 0, upper: false, delim: '.', ambiguous: false };
  if (/^\d+$/.test(body)) return { ...base, kind: 'number', value: Number(body), upper: false, delim, ambiguous: false };
  const upper = body === body.toUpperCase();
  if (body.length === 1) {
    // `i.` is a letter in a lettered list and a numeral in a roman one: decided with its neighbours.
    // On its own it is a numeral (a lettered list gets to `i` by way of `h`), as is any at the third level.
    const ambiguous = /[ivxlcdm]/i.test(body);
    const kind: OrderedKind = ambiguous && (body.toLowerCase() === 'i' || base.level % NUMBER_CYCLE.length === 2) ? 'roman' : 'letter';
    return { ...base, kind, value: kind === 'roman' ? fromRoman(body)! : letterValue(body), upper, delim, ambiguous };
  }
  const value = fromRoman(body);
  return value === null ? null : { ...base, kind: 'roman', value, upper, delim, ambiguous: false };
}

const indentOf = (level: number) => ' '.repeat(level * LIST_INDENT);

/** The first marker of a list of this kind at this level. */
function startMarker(kind: ListKind, level: number): string {
  if (kind === 'bullet') return BULLETS[level % BULLETS.length]!;
  if (kind === 'check') return '[ ]';
  return orderedMarker(kind === 'number' ? cycleKind(level) : kind, 1, false, '.');
}

// ---- Numbering -------------------------------------------------------------------------------------

interface Run {
  kind: OrderedKind;
  upper: boolean;
  delim: string;
  next: number;
}

/** A lone `i` or `v` is a letter or a numeral: read as whichever makes the next item in its list follow on. */
function peekKind(items: (ListItem | null)[], i: number): OrderedKind | null {
  const it = items[i]!;
  for (let j = i + 1; j < items.length; j++) {
    const next = items[j];
    if (!next || next.level < it.level) return null;
    if (next.level > it.level || !isOrdered(next.kind)) continue;
    for (const kind of ['letter', 'roman'] as const) {
      const a = valueUnder(it.marker, kind);
      const b = valueUnder(next.marker, kind);
      if (a !== null && b === a + 1) return kind;
    }
    return null;
  }
  return null;
}

/**
 * Renumbers the ordered lists in lines `from..to`, widened to the list blocks they touch. A list's
 * first item keeps its own number (so a list can start at 3); the rest follow on from it, in its
 * style. Text that is not a list item ends every list above it. Returns the style and number each
 * ordered item ended up with, by line.
 */
function renumber(lines: string[], from: number, to: number): Map<number, { kind: OrderedKind; value: number }> {
  const result = new Map<number, { kind: OrderedKind; value: number }>();
  let a = Math.max(from, 0);
  let b = Math.min(to, lines.length - 1);
  while (a > 0 && parseListItem(lines[a - 1]!)) a--;
  while (b < lines.length - 1 && parseListItem(lines[b + 1]!)) b++;
  const items = lines.slice(a, b + 1).map(parseListItem);
  const runs: (Run | undefined)[] = [];
  items.forEach((it, k) => {
    if (!it) {
      runs.length = 0;
      return;
    }
    runs.length = Math.min(runs.length, it.level + 1);
    if (!isOrdered(it.kind)) {
      runs[it.level] = undefined;
      return;
    }
    let kind: OrderedKind = it.kind;
    let value = it.value;
    if (it.ambiguous) {
      const run = runs[it.level];
      kind = run && run.kind !== 'number' ? run.kind : (peekKind(items, k) ?? it.kind);
      value = valueUnder(it.marker, kind) ?? value;
    }
    let run = runs[it.level];
    if (!run || run.kind !== kind || run.upper !== it.upper) run = runs[it.level] = { kind, upper: it.upper, delim: it.delim, next: value };
    const number = run.next++;
    result.set(a + k, { kind: run.kind, value: number });
    lines[a + k] = `${indentOf(it.level)}${orderedMarker(run.kind, number, run.upper, run.delim)} ${it.content}`;
  });
  return result;
}

// ---- Selection helpers -----------------------------------------------------------------------------

function locate(lines: string[], pos: number): { line: number; col: number } {
  let line = 0;
  let off = 0;
  while (line < lines.length - 1 && pos > off + lines[line]!.length) {
    off += lines[line]!.length + 1;
    line++;
  }
  return { line, col: pos - off };
}

function offsetOf(lines: string[], line: number, col: number): number {
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i]!.length + 1;
  return off + Math.min(col, lines[line]!.length);
}

/** The lines a selection touches; one that ends at the very start of a line does not take that line in. */
function affected(lines: string[], start: number, end: number): { first: number; last: number } {
  const first = locate(lines, start).line;
  let last = locate(lines, end).line;
  if (last > first && locate(lines, end).col === 0) last--;
  return { first, last };
}

const prefixOf = (line: string) => parseListItem(line)?.prefixLen ?? line.length - line.trimStart().length;

/**
 * The edit that turns `before` into `after` when no lines were added or removed, carrying the
 * selection along. A selection that starts at the start of a line keeps the whole line, marker included.
 */
function remapped(before: string[], after: string[], start: number, end: number): TextEdit {
  const map = (pos: number, wholeLine: boolean) => {
    const { line, col } = locate(before, pos);
    const o = prefixOf(before[line]!);
    const n = prefixOf(after[line]!);
    return offsetOf(after, line, wholeLine && col === 0 ? 0 : col < o ? n : col - o + n);
  };
  return { text: after.join('\n'), start: map(start, start !== end), end: map(end, false) };
}

// ---- Operations ------------------------------------------------------------------------------------

/** Whether an item is already of the kind a toggle asks for. A numbered list counts at every level of its cycle. */
function isKind(it: ListItem, kind: ListKind): boolean {
  if (kind === 'number') return isOrdered(it.kind) && it.kind === cycleKind(it.level);
  return it.kind === kind;
}

/**
 * Makes the selected lines a list of `kind`, or takes them out of one when they all already are.
 * Lines that are already items keep their level; other lines start at the top level.
 */
export function toggleList(text: string, start: number, end: number, kind: ListKind): TextEdit {
  const before = text.split('\n');
  const after = [...before];
  const { first, last } = affected(before, start, end);
  const rows: number[] = [];
  for (let i = first; i <= last; i++) if (before[i]!.trim() || first === last) rows.push(i);
  const off = rows.every((i) => {
    const it = parseListItem(before[i]!);
    return !!it && isKind(it, kind);
  });
  // New ordered items are numbered in turn, so a lone `i.` is not mistaken for a letter.
  const counts: number[] = [];
  for (const i of rows) {
    const it = parseListItem(before[i]!);
    if (off) {
      after[i] = it ? it.content : before[i]!;
      continue;
    }
    const level = it?.level ?? 0;
    counts.length = level + 1;
    const n = (counts[level] = (counts[level] ?? 0) + 1);
    const marker = isOrdered(kind) ? orderedMarker(kind === 'number' ? cycleKind(level) : kind, n, false, '.') : startMarker(kind, level);
    after[i] = `${indentOf(level)}${marker} ${it ? it.content : before[i]!.trimStart()}`;
  }
  renumber(after, first, last);
  return remapped(before, after, start, end);
}

/** Moves the selected list items one level in (`1`) or out (`-1`); null when the selection holds no list item. */
export function shiftList(text: string, start: number, end: number, dir: 1 | -1): TextEdit | null {
  const before = text.split('\n');
  const after = [...before];
  const { first, last } = affected(before, start, end);
  let any = false;
  for (let i = first; i <= last; i++) {
    const it = parseListItem(before[i]!);
    if (!it) continue;
    any = true;
    const level = Math.min(MAX_LEVEL, Math.max(0, it.level + dir));
    if (level === it.level) continue;
    let marker = it.marker;
    if (it.kind === 'bullet') marker = BULLETS[level % BULLETS.length]!;
    else if (isOrdered(it.kind)) {
      // A numbered list changes style with its level; a lettered or roman one keeps its own. It
      // starts over at 1 unless there is a list at the new level for it to join.
      const kind = it.kind === cycleKind(it.level) ? cycleKind(level) : it.kind;
      marker = orderedMarker(kind, 1, it.upper, it.delim);
    }
    after[i] = `${indentOf(level)}${marker} ${it.content}`;
  }
  if (!any) return null;
  renumber(after, first, last);
  return remapped(before, after, start, end);
}

/**
 * Enter in a list: a new item below, carrying the text after the caret. On an empty item it ends the
 * list instead (or moves out a level). Null when the caret is not in a list item.
 */
export function continueList(text: string, start: number, end: number): TextEdit | null {
  const joined = text.slice(0, start) + text.slice(end);
  const lines = joined.split('\n');
  const { line, col } = locate(lines, start);
  const it = parseListItem(lines[line]!);
  if (!it) return null;
  if (!it.content.trim()) {
    // Nothing typed in this item: leave the list, a level at a time.
    if (it.level > 0) return shiftList(joined, start, start, -1);
    lines[line] = '';
    return { text: lines.join('\n'), start: offsetOf(lines, line, 0), end: offsetOf(lines, line, 0) };
  }
  if (col < it.prefixLen) {
    // Enter before the item's text pushes the whole item down behind an empty one.
    lines.splice(line, 0, `${indentOf(it.level)}${isOrdered(it.kind) ? it.marker : it.kind === 'check' ? '[ ]' : it.marker} `);
    renumber(lines, line, line + 1);
    return { text: lines.join('\n'), start: offsetOf(lines, line + 1, prefixOf(lines[line + 1]!)), end: offsetOf(lines, line + 1, prefixOf(lines[line + 1]!)) };
  }
  const head = lines[line]!.slice(0, col);
  const tail = lines[line]!.slice(col).trimStart();
  let marker = it.kind === 'check' ? '[ ]' : it.marker;
  if (isOrdered(it.kind)) {
    // The item's own style and number, as its list sees them (not as it reads alone).
    const own = renumber([...lines], line, line).get(line);
    marker = orderedMarker(own?.kind ?? it.kind, (own?.value ?? it.value) + 1, it.upper, it.delim);
  }
  const next = `${indentOf(it.level)}${marker} `;
  lines[line] = head;
  lines.splice(line + 1, 0, next + tail);
  renumber(lines, line, line + 1);
  const caret = offsetOf(lines, line + 1, prefixOf(lines[line + 1]!));
  return { text: lines.join('\n'), start: caret, end: caret };
}

/**
 * Backspace at the start of an item's text: out a level, or out of the list from the top level.
 * Null anywhere else, so Backspace deletes as usual.
 */
export function backspaceList(text: string, start: number, end: number): TextEdit | null {
  if (start !== end) return null;
  const lines = text.split('\n');
  const { line, col } = locate(lines, start);
  const it = parseListItem(lines[line]!);
  if (!it || col !== it.prefixLen) return null;
  if (it.level > 0) return shiftList(text, start, end, -1);
  lines[line] = it.content;
  renumber(lines, line, line);
  const caret = offsetOf(lines, line, 0);
  return { text: lines.join('\n'), start: caret, end: caret };
}

/**
 * Typing a space after `-`, `*` or `[]` at the start of a line turns it into a bullet or checkbox.
 * `caret` is just after the space. Null when the line is not in that form.
 */
export function autoFormatList(text: string, caret: number): TextEdit | null {
  const lines = text.split('\n');
  const { line, col } = locate(lines, caret);
  const m = /^( *)(-|\*|\[\]) /.exec(lines[line]!);
  if (!m || col !== m[0].length) return null;
  const level = Math.floor(m[1]!.length / LIST_INDENT);
  const marker = m[2] === '[]' ? '[ ]' : BULLETS[level % BULLETS.length]!;
  const rest = lines[line]!.slice(m[0].length);
  lines[line] = `${indentOf(level)}${marker} ${rest}`;
  const at = offsetOf(lines, line, level * LIST_INDENT + marker.length + 1);
  return { text: lines.join('\n'), start: at, end: at };
}

// ---- Layout ----------------------------------------------------------------------------------------

/**
 * Wraps text into lines no wider than `maxWidth`, a list item's wrapped lines hanging under its
 * text rather than under its marker. Each line's `indent` is how far in it starts; the first line
 * of an item carries its marker, and `indent` 0. `measure` gives a string's width.
 */
export function layoutParagraphs(text: string, maxWidth: number, measure: (s: string) => number): { text: string; indent: number }[] {
  const out: { text: string; indent: number }[] = [];
  for (const para of text.split('\n')) {
    const item = parseListItem(para);
    const prefix = item ? para.slice(0, item.prefixLen) : '';
    // Measured with a trailing glyph, since widths of trailing spaces may not count.
    const hang = item ? Math.min(measure(`${prefix}|`) - measure('|'), maxWidth / 2) : 0;
    wrapParagraph(item ? item.content : para, maxWidth - hang, measure).forEach((line, i) => {
      out.push(i === 0 ? { text: prefix + line, indent: 0 } : { text: line, indent: hang });
    });
  }
  return out;
}

/** Greedy word wrap of one paragraph. */
export function wrapParagraph(para: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of para.split(/(\s+)/)) {
    const next = line + word;
    if (line && measure(next.trimEnd()) > maxWidth) {
      lines.push(line.trimEnd());
      line = word.trimStart();
    } else {
      line = next;
    }
  }
  lines.push(line.trimEnd());
  return lines;
}
