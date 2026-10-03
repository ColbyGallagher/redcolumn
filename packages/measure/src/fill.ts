import type { Pt } from './measure.ts';

export interface FillOptions {
  /** Page size in points: the fill never leaves the page. */
  width: number;
  height: number;
  /** Grid cell edge in points; finer finds narrower spaces but costs more. Default: page / 1600. */
  cell?: number;
  /**
   * Gaps up to this many points wide in the line work are treated as closed (door openings drawn
   * as arcs, lines that stop just short of each other). Default: 1.5 cells.
   */
  gap?: number;
  /** Outline simplification tolerance in points. Default: one cell. */
  tolerance?: number;
  /** Largest share of the page a fill may cover before it counts as not enclosed. Default 0.9. */
  maxShare?: number;
}

/**
 * Smart Fill: the region enclosed by line work around a point, as a polygon in page space, or
 * null when the point is on a line or the region leaks to the page edge.
 *
 * The line work (`segments`, flat [x1, y1, x2, y2, ...]) is drawn onto a grid, thickened by the
 * gap tolerance, flood-filled from the point, and the filled cells' outline is traced and
 * simplified. The outline follows the inside faces of the boundary lines.
 */
export function dynamicFill(segments: ArrayLike<number>, at: Pt, options: FillOptions): Pt[] | null {
  const { width, height } = options;
  const cell = options.cell ?? Math.max(width, height) / 1600;
  const gap = options.gap ?? cell * 1.5;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  if (cols < 3 || rows < 3) return null;
  const wall = new Uint8Array(cols * rows);
  // Thicken each line to half the gap on either side, so gaps up to `gap` close.
  const r = Math.max(0, Math.round(gap / 2 / cell));
  const mark = (cx: number, cy: number) => {
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        if (x >= 0 && x < cols && dx * dx + dy * dy <= r * r + r) wall[y * cols + x] = 1;
      }
    }
  };
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const x1 = segments[i]! / cell;
    const y1 = segments[i + 1]! / cell;
    const x2 = segments[i + 2]! / cell;
    const y2 = segments[i + 3]! / cell;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2));
    let lastX = -1;
    let lastY = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.floor(x1 + (x2 - x1) * t);
      const cy = Math.floor(y1 + (y2 - y1) * t);
      if (cx === lastX && cy === lastY) continue;
      lastX = cx;
      lastY = cy;
      mark(cx, cy);
    }
  }

  const sx = Math.floor(at[0] / cell);
  const sy = Math.floor(at[1] / cell);
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows || wall[sy * cols + sx]) return null;

  // Flood fill (4-connected). Reaching the page edge means the region is open.
  const filled = new Uint8Array(cols * rows);
  const stack = new Int32Array(cols * rows);
  let top = 0;
  stack[top++] = sy * cols + sx;
  filled[sy * cols + sx] = 1;
  let count = 0;
  const limit = cols * rows * (options.maxShare ?? 0.9);
  while (top) {
    const i = stack[--top]!;
    count++;
    if (count > limit) return null;
    const x = i % cols;
    const y = (i - x) / cols;
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) return null;
    for (const j of [i - 1, i + 1, i - cols, i + cols]) {
      if (!filled[j] && !wall[j]) {
        filled[j] = 1;
        stack[top++] = j;
      }
    }
  }

  const loop = outerBoundary(filled, cols, rows);
  if (!loop || loop.length < 3) return null;
  const pts = loop.map(([x, y]) => [x * cell, y * cell] as Pt);
  const simple = simplifyClosed(pts, options.tolerance ?? cell);
  return simple.length >= 3 ? simple : null;
}

/**
 * The outer outline of a filled region as grid-corner coordinates: the boundary edges between
 * filled and empty cells chained into loops, keeping the longest (the outside, not a hole).
 */
function outerBoundary(filled: Uint8Array, cols: number, rows: number): [number, number][] | null {
  // Directed edges with the filled cell on the right (clockwise on screen with y down): each
  // corner maps to the next corner. Keyed by corner index (cols + 1 wide).
  const W = cols + 1;
  const next = new Map<number, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = ay * W + ax;
    const list = next.get(k);
    if (list) list.push(by * W + bx);
    else next.set(k, [by * W + bx]);
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && filled[y * cols + x] === 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y); // top edge, left to right
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right edge, downward
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1); // bottom edge, right to left
      if (!at(x - 1, y)) add(x, y + 1, x, y); // left edge, upward
    }
  }
  let best: number[] | null = null;
  while (next.size) {
    const [start] = next.keys();
    const loop: number[] = [start!];
    let cur = start!;
    for (;;) {
      const list = next.get(cur);
      if (!list?.length) break;
      const n = list.pop()!;
      if (!list.length) next.delete(cur);
      if (n === start) break;
      loop.push(n);
      cur = n;
    }
    if (!best || loop.length > best.length) best = loop;
  }
  return best ? best.map((k) => [k % W, Math.floor(k / W)] as [number, number]) : null;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on an open polyline. */
function simplifyOpen(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let dist = tol;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i]!, pts[a]!, pts[b]!);
      if (d > dist) {
        dist = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas–Peucker on a closed loop: split at the two mutually farthest-ish points. */
export function simplifyClosed(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 4) return [...pts];
  // Farthest point from the first, then split the loop there.
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]![0] - pts[0]![0], pts[i]![1] - pts[0]![1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol);
  const b = simplifyOpen([...pts.slice(far), pts[0]!], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
