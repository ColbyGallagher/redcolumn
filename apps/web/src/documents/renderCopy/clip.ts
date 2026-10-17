/**
 * Cutting stroked lines to a clipping polygon, so the clip itself can go. A renderer draws every
 * object under a non-rectangular clip through a mask the size of the clip, which makes drawings
 * that clip each hatch to its region slow in proportion to their pixels; lines already cut to the
 * region need no clip.
 */

/**
 * A subpath as straight segments (curves flattened): flat x, y pairs, whether it closes back to
 * its start, and its operators as written (kept when it lies wholly inside a clip).
 */
export interface Polyline {
  pts: number[];
  closed: boolean;
  src: string;
}

/** Most a flattened curve strays from the true one (user space units: about 1/7000 inch). */
const FLATNESS = 0.01;

/** Appends a cubic Bézier from (x0, y0), flattened, to `pts`. */
export function flattenCurve(pts: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  const dd = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3));
  const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / FLATNESS))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
}

/**
 * The axis-aligned rectangle `subpaths` trace, as [x0, y0, x1, y1], or null. CAD exports often
 * write a rectangular clip as a polygon with extra points along its sides, which a renderer then
 * clips through a mask instead of its fast rectangle path.
 */
export function asRect(subpaths: Polyline[]): [number, number, number, number] | null {
  if (subpaths.length !== 1) return null;
  const src = subpaths[0]!.pts;
  // Drop repeated points (a closing point equal to the first included).
  const pts: number[] = [];
  for (let i = 0; i < src.length; i += 2) {
    const n = pts.length;
    if (n && Math.abs(pts[n - 2]! - src[i]!) < 1e-6 && Math.abs(pts[n - 1]! - src[i + 1]!) < 1e-6) continue;
    pts.push(src[i]!, src[i + 1]!);
  }
  if (pts.length > 2 && Math.abs(pts[0]! - pts[pts.length - 2]!) < 1e-6 && Math.abs(pts[1]! - pts[pts.length - 1]!) < 1e-6) pts.length -= 2;
  // Keep only corners: points where the direction changes.
  const n = pts.length / 2;
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const ax = pts[i * 2]! - pts[p * 2]!;
    const ay = pts[i * 2 + 1]! - pts[p * 2 + 1]!;
    const bx = pts[q * 2]! - pts[i * 2]!;
    const by = pts[q * 2 + 1]! - pts[i * 2 + 1]!;
    if (Math.abs(ax * by - ay * bx) > 1e-6 * (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-12)) corners.push(pts[i * 2]!, pts[i * 2 + 1]!);
    // Doubling back along the same line is not a rectangle.
    else if (ax * bx + ay * by < 0) return null;
  }
  if (corners.length !== 8) return null;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const dx = corners[j * 2]! - corners[i * 2]!;
    const dy = corners[j * 2 + 1]! - corners[i * 2 + 1]!;
    if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6) return null;
  }
  const xs = [corners[0]!, corners[2]!, corners[4]!, corners[6]!];
  const ys = [corners[1]!, corners[3]!, corners[5]!, corners[7]!];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Most clip edges worth testing every line against. */
const MAX_EDGES = 256;
const EPS = 1e-9;

/** A clipping region: its edges (x0, y0, x1, y1 each) and fill rule. */
export interface ClipRegion {
  edges: Float64Array;
  evenOdd: boolean;
  /** Bounding box, for lines wholly outside it. */
  box: [number, number, number, number];
}

/** The region `subpaths` enclose (each closed implicitly), or null when it has too many edges. */
export function clipRegion(subpaths: Polyline[], evenOdd: boolean): ClipRegion | null {
  const edges: number[] = [];
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { pts } of subpaths) {
    const n = pts.length / 2;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = pts[i * 2]!;
      const y0 = pts[i * 2 + 1]!;
      edges.push(x0, y0, pts[j * 2]!, pts[j * 2 + 1]!);
      box[0] = Math.min(box[0], x0);
      box[1] = Math.min(box[1], y0);
      box[2] = Math.max(box[2], x0);
      box[3] = Math.max(box[3], y0);
    }
  }
  if (!edges.length || edges.length / 4 > MAX_EDGES) return null;
  return { edges: Float64Array.from(edges), evenOdd, box };
}

/** Whether a point is inside the region (non-zero winding, or even-odd). */
export function inside(r: ClipRegion, x: number, y: number): boolean {
  if (x < r.box[0] || x > r.box[2] || y < r.box[1] || y > r.box[3]) return false;
  const e = r.edges;
  let winding = 0;
  for (let k = 0; k < e.length; k += 4) {
    const x0 = e[k]!;
    const y0 = e[k + 1]!;
    const x1 = e[k + 2]!;
    const y1 = e[k + 3]!;
    if (y0 <= y) {
      if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) winding++;
    } else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) winding--;
  }
  return r.evenOdd ? winding % 2 !== 0 : winding !== 0;
}

/** Where along a→b (0..1) it crosses the region's edges, sorted, with 0 and 1. */
function crossings(r: ClipRegion, ax: number, ay: number, bx: number, by: number): number[] {
  const ts = [0, 1];
  const e = r.edges;
  const dx = bx - ax;
  const dy = by - ay;
  for (let k = 0; k < e.length; k += 4) {
    const ex = e[k + 2]! - e[k]!;
    const ey = e[k + 3]! - e[k + 1]!;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < EPS) continue;
    const fx = e[k]! - ax;
    const fy = e[k + 1]! - ay;
    const t = (fx * ey - fy * ex) / den;
    const u = (fx * dy - fy * dx) / den;
    if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) ts.push(t);
  }
  return ts.sort((p, q) => p - q);
}

const fmt = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * The parts of `lines` inside the region, as path operators. A subpath wholly inside is kept as
 * written (curves, joins and closing included); one partly inside becomes the straight pieces
 * inside (curves flattened). Empty when nothing is inside.
 */
export function clipLines(lines: Polyline[], r: ClipRegion): string {
  let out = '';
  for (const { pts, closed, src } of lines) {
    const n = pts.length / 2;
    if (n === 0) continue;
    const segs = closed && n > 1 ? n : n - 1;
    if (segs === 0) {
      // A lone point (a dot with round caps): kept when inside.
      if (inside(r, pts[0]!, pts[1]!)) out += src;
      continue;
    }
    let piece = '';
    let whole = true;
    /** The current piece ends where the next kept interval would begin (so it continues). */
    let open = false;
    for (let s = 0; s < segs; s++) {
      const ax = pts[s * 2]!;
      const ay = pts[s * 2 + 1]!;
      const b = (s + 1) % n;
      const bx = pts[b * 2]!;
      const by = pts[b * 2 + 1]!;
      const ts = crossings(r, ax, ay, bx, by);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k]!;
        const t1 = ts[k + 1]!;
        if (t1 - t0 < EPS) continue;
        const tm = (t0 + t1) / 2;
        if (!inside(r, ax + (bx - ax) * tm, ay + (by - ay) * tm)) {
          whole = false;
          open = false;
          continue;
        }
        if (!open || t0 > 0) piece += `${fmt(ax + (bx - ax) * t0)} ${fmt(ay + (by - ay) * t0)} m\n`;
        piece += `${fmt(ax + (bx - ax) * t1)} ${fmt(ay + (by - ay) * t1)} l\n`;
        open = t1 === 1;
      }
    }
    out += whole ? src : piece;
  }
  return out;
}
