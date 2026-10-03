/**
 * Compare Documents: finds what changed between two renderings of a drawing. Both pages are
 * rendered at the same resolution and turned into ink masks; the old page is lined up with the
 * new one, and ink found in one but not near any ink in the other is a change. Changed pixels are
 * gathered into grid cells and neighbouring cells merged into one box per difference.
 *
 * Everything here works on plain arrays so it runs (and is tested) outside the browser.
 */

/** A mask: one byte per pixel, 1 where there is ink. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface Difference extends Box {
  kind: ChangeKind;
  /** Changed pixels inside, new and old. */
  added: number;
  removed: number;
  /** Words added and removed inside (text compare). */
  words?: { added: number; removed: number };
}

/** Ink where a pixel is darker than `threshold` (0–255 luminance) and not transparent. */
export function inkMask(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 200): Mask {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < data.length; p++, i += 4) {
    const a = rgba[i + 3]!;
    if (a < 32) continue;
    // Composite over white, then luminance.
    const k = a / 255;
    const lum = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * k + 255 * (1 - k);
    if (lum < threshold) data[p] = 1;
  }
  return { width, height, data };
}

/** Grows ink by `r` pixels in every direction (a square), so near misses still count as a match. */
export function dilate(mask: Mask, r: number): Mask {
  if (r <= 0) return mask;
  const { width: w, height: h, data } = mask;
  // Separable: rows, then columns, each with a running count over the window.
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) count += data[o + x]!;
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += data[o + x + r]!;
      if (x - r - 1 >= 0) count -= data[o + x - r - 1]!;
      rows[o + x] = count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += rows[y * w + x]!;
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += rows[(y + r) * w + x]!;
      if (y - r - 1 >= 0) count -= rows[(y - r - 1) * w + x]!;
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Shrinks a mask by `f`: a cell has ink if any pixel in it does. */
export function shrink(mask: Mask, f: number): Mask {
  if (f <= 1) return mask;
  const width = Math.ceil(mask.width / f);
  const height = Math.ceil(mask.height / f);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < mask.height; y++) {
    const row = y * mask.width;
    const out = Math.floor(y / f) * width;
    for (let x = 0; x < mask.width; x++) if (mask.data[row + x]) data[out + Math.floor(x / f)] = 1;
  }
  return { width, height, data };
}

/** Ink pixels of `a` that land on ink of `b` when `a` is moved by (dx, dy). */
function overlap(a: Mask, b: Mask, dx: number, dy: number): number {
  let n = 0;
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(a.height, b.height - dy);
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(a.width, b.width - dx);
  for (let y = y0; y < y1; y++) {
    const ra = y * a.width;
    const rb = (y + dy) * b.width + dx;
    for (let x = x0; x < x1; x++) if (a.data[ra + x] && b.data[rb + x]) n++;
  }
  return n;
}

/**
 * The move (in pixels) that best lines the old page `a` up with the new page `b`, within
 * `maxShift` pixels either way. Searched coarse to fine so large shifts stay cheap.
 */
export function findOffset(a: Mask, b: Mask, maxShift: number): [dx: number, dy: number] {
  let best: [number, number] = [0, 0];
  // Start at a size where the search window is about ±24 cells, then halve down to full size.
  let f = 1;
  while (maxShift / f > 24 && f < 64) f *= 2;
  let range = Math.ceil(maxShift / f);
  for (; f >= 1; f /= 2) {
    const sa = shrink(a, f);
    const sb = shrink(b, f);
    const cx = Math.round(best[0] / f);
    const cy = Math.round(best[1] / f);
    // Ties go to the smallest move, so a blank or symmetric page stays where it is.
    let top = -1;
    let at: [number, number] = [cx, cy];
    for (let dy = cy - range; dy <= cy + range; dy++)
      for (let dx = cx - range; dx <= cx + range; dx++) {
        const score = overlap(sa, sb, dx, dy);
        const better = score > top || (score === top && Math.hypot(dx, dy) < Math.hypot(at[0], at[1]));
        if (better) {
          top = score;
          at = [dx, dy];
        }
      }
    best = [at[0] * f, at[1] * f];
    // The next finer level only needs to look around this answer.
    range = 2;
  }
  return best;
}

export interface DiffOptions {
  /** Where the old page's ink lands on the new page, in pixels. */
  offset?: [number, number];
  /** Ink closer than this many pixels to ink in the other page is not a change. */
  proximity?: number;
  /** Size of the cells changes are gathered in, in pixels. */
  cell?: number;
  /** Changed pixels a cell needs before it counts, to skip specks and anti-aliasing. */
  minPixels?: number;
  /** Space added around each difference's box, in pixels. */
  pad?: number;
  /** Only this part of the new page is compared (pixels). */
  region?: Box | null;
}

/**
 * Differences between an old page `a` and a new page `b`, as boxes in `b`'s pixels. Ink only in
 * the new page is `added`, only in the old page `removed`, and a box with both is `changed`.
 */
export function diffMasks(a: Mask, b: Mask, options: DiffOptions = {}): Difference[] {
  const [dx, dy] = options.offset ?? [0, 0];
  const proximity = options.proximity ?? 2;
  const cell = Math.max(2, Math.round(options.cell ?? 16));
  const minPixels = options.minPixels ?? 6;
  const pad = options.pad ?? 4;
  const { width: w, height: h } = b;
  // The old page's ink moved into the new page's frame.
  const moved = new Uint8Array(w * h);
  for (let y = 0; y < a.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < a.width; x++) {
      const tx = x + dx;
      if (tx >= 0 && tx < w && a.data[y * a.width + x]) moved[ty * w + tx] = 1;
    }
  }
  const old: Mask = { width: w, height: h, data: moved };
  const nearOld = dilate(old, proximity);
  const nearNew = dilate(b, proximity);
  const region = options.region;
  const inRegion = (x: number, y: number) => !region || (x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h);

  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const added = new Uint32Array(cols * rows);
  const removed = new Uint32Array(cols * rows);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!inRegion(x, y)) continue;
      const c = Math.floor(y / cell) * cols + Math.floor(x / cell);
      if (b.data[p] && !nearOld.data[p]) added[c]!++;
      else if (moved[p] && !nearNew.data[p]) removed[c]!++;
    }
  return clusterCells(added, removed, cols, rows, cell, minPixels, pad, w, h);
}

/** Joins touching cells with enough changes into boxes (8-connected), then merges overlapping boxes. */
function clusterCells(added: Uint32Array, removed: Uint32Array, cols: number, rows: number, cell: number, minPixels: number, pad: number, w: number, h: number): Difference[] {
  const hot = (c: number) => added[c]! + removed[c]! >= minPixels;
  const seen = new Uint8Array(cols * rows);
  const out: Difference[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !hot(start)) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let nAdded = 0;
    let nRemoved = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cols;
      const cy = (c - cx) / cols;
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      nAdded += added[c]!;
      nRemoved += removed[c]!;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (!seen[n] && hot(n)) {
            seen[n] = 1;
            stack.push(n);
          }
        }
    }
    const x = Math.max(0, minX * cell - pad);
    const y = Math.max(0, minY * cell - pad);
    out.push({ x, y, w: Math.min(w, (maxX + 1) * cell + pad) - x, h: Math.min(h, (maxY + 1) * cell + pad) - y, added: nAdded, removed: nRemoved, kind: kindOf(nAdded, nRemoved) });
  }
  return mergeBoxes(out);
}

/**
 * A box is added or removed when nearly all its changes are one way; otherwise changed. Words
 * decide when there are any: a word swapped for another is a change however its pixels compare.
 */
function kindOf(added: number, removed: number, words?: { added: number; removed: number }): ChangeKind {
  if (words && (words.added || words.removed)) {
    if (words.added && words.removed) return 'changed';
    // Only new words: still a change if more ink went than came.
    if (words.added) return removed > added ? 'changed' : 'added';
    return added > removed ? 'changed' : 'removed';
  }
  if (removed <= added * 0.1) return 'added';
  if (added <= removed * 0.1) return 'removed';
  return 'changed';
}

const touches = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Merges boxes that overlap until none do. */
export function mergeBoxes(list: Difference[]): Difference[] {
  const boxes = [...list];
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (!touches(a, b)) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const added = a.added + b.added;
        const removed = a.removed + b.removed;
        const words = a.words || b.words ? { added: (a.words?.added ?? 0) + (b.words?.added ?? 0), removed: (a.words?.removed ?? 0) + (b.words?.removed ?? 0) } : undefined;
        boxes[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, added, removed, ...(words ? { words } : {}), kind: kindOf(added, removed, words) };
        boxes.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A word with its box, in page points. */
export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Text compare: words in the new page that the old page does not have at (about) the same place
 * are `added`, and old words missing from the new page `removed`. `offset` moves old words into
 * the new page's frame (points); `tolerance` is how far a word may move and still match.
 */
export function diffWords(oldWords: readonly Word[], newWords: readonly Word[], offset: [number, number] = [0, 0], tolerance = 3, pad = 2): Difference[] {
  const moved = oldWords.map((w) => ({ ...w, x0: w.x0 + offset[0], x1: w.x1 + offset[0], y0: w.y0 + offset[1], y1: w.y1 + offset[1] }));
  const key = (w: Word) => w.text.trim();
  const matches = (a: Word, b: Word) => key(a) === key(b) && Math.abs(a.x0 - b.x0) <= tolerance && Math.abs(a.y0 - b.y0) <= tolerance;
  const box = (w: Word, kind: 'added' | 'removed'): Difference => ({
    x: w.x0 - pad,
    y: w.y0 - pad,
    w: w.x1 - w.x0 + pad * 2,
    h: w.y1 - w.y0 + pad * 2,
    kind,
    added: 0,
    removed: 0,
    words: { added: kind === 'added' ? 1 : 0, removed: kind === 'removed' ? 1 : 0 },
  });
  const out: Difference[] = [];
  const used = new Set<number>();
  for (const w of newWords) {
    if (!key(w)) continue;
    const i = moved.findIndex((o, k) => !used.has(k) && matches(o, w));
    if (i >= 0) used.add(i);
    else out.push(box(w, 'added'));
  }
  moved.forEach((o, k) => {
    if (!used.has(k) && key(o)) out.push(box(o, 'removed'));
  });
  return mergeBoxes(out);
}
