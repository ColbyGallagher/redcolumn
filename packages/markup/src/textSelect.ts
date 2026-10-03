import type { Point } from './model';

/** A word on the page in page space (matches pdf-core's TextWord). */
export interface WordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Distance from a point to a word's box (0 inside). */
function distance([x, y]: Point, w: WordBox): number {
  const dx = x < w.x0 ? w.x0 - x : x > w.x1 ? x - w.x1 : 0;
  const dy = y < w.y0 ? w.y0 - y : y > w.y1 ? y - w.y1 : 0;
  return Math.hypot(dx, dy);
}

/** Index of the word nearest a point, if one lies within `reach` points of it. */
export function wordAt(words: readonly WordBox[], p: Point, reach: number): number {
  let best = -1;
  let bestD = reach;
  words.forEach((w, i) => {
    const d = distance(p, w);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * The words from the one under `from` to the one under `to`, in reading (content) order, as when
 * dragging across text. Empty when either end is not near any word.
 */
export function selectWords(words: readonly WordBox[], from: Point, to: Point, reach: number): WordBox[] {
  const a = wordAt(words, from, reach);
  const b = wordAt(words, to, reach);
  if (a < 0 || b < 0) return [];
  return words.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Relative width of a character, so a position along a word maps to a character boundary. */
function charWeight(c: string): number {
  if ("iljIt.,:;'!|()[]fr ".includes(c)) return 0.5;
  if ('mwMW@'.includes(c)) return 1.5;
  return 1;
}

/** The character boundary (0..length) of `w` nearest to page x position `x`. */
function boundaryAt(w: WordBox, x: number): number {
  const chars = [...w.text];
  const total = chars.reduce((n, c) => n + charWeight(c), 0) || 1;
  const t = Math.max(0, Math.min(1, (x - w.x0) / Math.max(w.x1 - w.x0, 1e-6))) * total;
  let acc = 0;
  for (let i = 0; i < chars.length; i++) {
    const next = acc + charWeight(chars[i]!);
    if (t < (acc + next) / 2) return i;
    acc = next;
  }
  return chars.length;
}

/** x position of the character boundary `k` of `w`. */
function xOfBoundary(w: WordBox, k: number): number {
  const chars = [...w.text];
  const total = chars.reduce((n, c) => n + charWeight(c), 0) || 1;
  const before = chars.slice(0, k).reduce((n, c) => n + charWeight(c), 0);
  return w.x0 + ((w.x1 - w.x0) * before) / total;
}

/** `w` cut down to its characters from boundary `from` to `to` (widths estimated per character). */
function slice(w: WordBox, from: number, to: number): WordBox {
  const chars = [...w.text];
  return { text: chars.slice(from, to).join(''), x0: xOfBoundary(w, from), x1: xOfBoundary(w, to), y0: w.y0, y1: w.y1 };
}

/**
 * Like `selectWords`, but the first and last words are cut at the characters under `from` and `to`,
 * so a drag over part of a word selects only that part.
 */
export function selectRange(words: readonly WordBox[], from: Point, to: Point, reach: number): WordBox[] {
  let a = wordAt(words, from, reach);
  let b = wordAt(words, to, reach);
  if (a < 0 || b < 0) return [];
  let [pa, pb] = [from, to];
  if (a > b || (a === b && from[0] > to[0])) [a, b, pa, pb] = [b, a, pb, pa];
  const ka = boundaryAt(words[a]!, pa[0]);
  const kb = boundaryAt(words[b]!, pb[0]);
  if (a === b) {
    const [lo, hi] = ka <= kb ? [ka, kb] : [kb, ka];
    // A bare click inside a word still marks the whole word.
    return hi > lo ? [slice(words[a]!, lo, hi)] : [words[a]!];
  }
  const out = words.slice(a, b + 1).map((w) => ({ ...w }));
  out[0] = slice(words[a]!, ka, [...words[a]!.text].length);
  out[out.length - 1] = slice(words[b]!, 0, kb);
  return out.filter((w) => w.text);
}

/** True if two word boxes sit on the same line (they overlap by at least half the smaller height). */
function sameLine(a: WordBox, b: WordBox): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap >= 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
}

/**
 * Words merged into one rectangle per line, as markup points: two opposite corners per line. The
 * text comes with a space between words and a line break between lines.
 */
export function lineRects(words: readonly WordBox[]): { points: Point[]; text: string } {
  const lines: { box: WordBox; parts: string[] }[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && sameLine(last.box, w)) {
      last.box = { text: '', x0: Math.min(last.box.x0, w.x0), y0: Math.min(last.box.y0, w.y0), x1: Math.max(last.box.x1, w.x1), y1: Math.max(last.box.y1, w.y1) };
      last.parts.push(w.text);
    } else {
      lines.push({ box: { ...w }, parts: [w.text] });
    }
  }
  return {
    points: lines.flatMap(({ box }) => [[box.x0, box.y0] as Point, [box.x1, box.y1] as Point]),
    text: lines.map((l) => l.parts.join(' ')).join('\n'),
  };
}

/** The line rectangles of a text markup (its points taken two at a time). */
export function markupLines(points: readonly Point[]): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [a, b] = [points[i]!, points[i + 1]!];
    out.push({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
  }
  return out;
}
