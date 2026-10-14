import type { Pt } from './measure.ts';

/**
 * Object snaps, after AutoCAD's: `endpoint`, `midpoint`, `intersection` and `nearest` on line
 * work; `center` and `quadrant` of circles and arcs (and ellipses); `geocenter`, a closed shape's
 * centroid; `apparent`, where two nearby lines would cross if extended; and, from the point a line
 * is being drawn from, `perpendicular` to a line or circle and `tangent` to a circle.
 */
export type SnapKind = 'endpoint' | 'center' | 'geocenter' | 'intersection' | 'apparent' | 'midpoint' | 'quadrant' | 'perpendicular' | 'tangent' | 'nearest';

export interface Snap {
  point: [number, number];
  kind: SnapKind;
  /**
   * The direction of the straight line it was found on (a unit vector): for an endpoint, pointing
   * out past that end (an extension carries on that way); for a point on a line, along the line.
   */
  dir?: [number, number];
}

export interface SnapOptions {
  /** The point the line being drawn starts from: perpendicular and tangent snaps are taken from it. */
  from?: Pt | null;
  /**
   * More line work as flat [x1, y1, x2, y2, ...] (e.g. the outlines of markups): snapped onto,
   * crossed and extended, but their own ends and middles do not snap (those come as points).
   */
  lines?: ArrayLike<number>;
}

/** Lower wins when several snaps are within range. */
const PRIORITY: Record<SnapKind, number> = { endpoint: 0, center: 0, geocenter: 0, intersection: 1, midpoint: 2, quadrant: 2, perpendicular: 2, tangent: 2, apparent: 3, nearest: 4 };
/** Grid cells are indexed with a fixed offset so small negative coordinates still hash uniquely. */
const OFFSET = 4096;
const STRIDE = 16384;
/** Cap on segments examined pairwise for intersections per query. */
const MAX_INTERSECT_CANDIDATES = 48;

/** A circle, arc or ellipse found in the line work; `r` is 0 for an ellipse (no tangents). */
interface Circle {
  cx: number;
  cy: number;
  r: number;
}

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Near extends Seg {
  d: number;
  curve: boolean;
  /** Its own ends and middle snap (the drawing's line work, not extra lines). */
  ends: boolean;
  circle: Circle | undefined;
}

/**
 * Spatial index over a page's vector line work for CAD-style snapping. Segments are
 * registered in every uniform-grid cell they pass through, so queries only touch nearby lines.
 * Runs of joined curve pieces are fitted with circles when built, so their centres and quadrants snap.
 */
export class SnapIndex {
  readonly segments: Float32Array;
  /** 1 for each segment flattened from a curve, when known. */
  private curves: Uint8Array | undefined;
  private cellSize: number;
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array;
  private query = 0;
  /** Circles fitted to curve runs, and the circle each curve segment belongs to. */
  private circles: Circle[] = [];
  private segCircle = new Map<number, number>();
  /** Centres and quadrants of the fitted circles, by grid cell. */
  private points: { x: number; y: number; kind: SnapKind }[] = [];
  private pointGrid = new Map<number, number[]>();

  /**
   * @param segments flat [x1, y1, x2, y2, ...] in page space
   * @param cellSize grid cell edge in points; a few times the typical snap radius works well
   * @param curves 1 for each segment flattened from a curve
   */
  constructor(segments: Float32Array, cellSize = 24, curves?: Uint8Array) {
    this.segments = segments;
    this.curves = curves;
    this.cellSize = cellSize;
    this.stamp = new Uint32Array(segments.length / 4);
    for (let i = 0; i < segments.length / 4; i++) this.insert(i);
    if (curves) this.fitCircles();
  }

  get size() {
    return this.segments.length / 4;
  }

  private key(cx: number, cy: number) {
    return (cx + OFFSET) * STRIDE + (cy + OFFSET);
  }

  private insert(i: number) {
    const s = this.segments;
    const x1 = s[i * 4]!;
    const y1 = s[i * 4 + 1]!;
    const x2 = s[i * 4 + 2]!;
    const y2 = s[i * 4 + 3]!;
    // Walk the segment in half-cell steps; adjacent-cell misses are covered by querying the
    // radius-expanded box around the cursor.
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / (this.cellSize / 2)));
    let last = NaN;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const key = this.key(Math.floor((x1 + (x2 - x1) * t) / this.cellSize), Math.floor((y1 + (y2 - y1) * t) / this.cellSize));
      if (key === last) continue;
      last = key;
      let cell = this.grid.get(key);
      if (!cell) this.grid.set(key, (cell = []));
      if (cell[cell.length - 1] !== i) cell.push(i);
    }
  }

  private addPoint(x: number, y: number, kind: SnapKind) {
    const key = this.key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
    let cell = this.pointGrid.get(key);
    if (!cell) this.pointGrid.set(key, (cell = []));
    cell.push(this.points.length);
    this.points.push({ x, y, kind });
  }

  /** Fits circles to runs of joined curve pieces (a flattened arc, circle or ellipse). */
  private fitCircles() {
    const s = this.segments;
    const n = this.size;
    let i = 0;
    while (i < n) {
      if (this.curves![i] !== 1) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < n && this.curves![j + 1] === 1 && Math.abs(s[j * 4 + 2]! - s[(j + 1) * 4]!) < 1e-3 && Math.abs(s[j * 4 + 3]! - s[(j + 1) * 4 + 1]!) < 1e-3) j++;
      if (j - i >= 2) this.fitRun(i, j);
      i = j + 1;
    }
  }

  /**
   * A run that lies on a circle snaps at the circle's centre and at its compass points the run
   * reaches. One that closes on itself without being a circle (an ellipse) snaps at the middle of
   * its box and at its top, bottom, left and right.
   */
  private fitRun(first: number, last: number) {
    const s = this.segments;
    const pts: Pt[] = [[s[first * 4]!, s[first * 4 + 1]!]];
    for (let k = first; k <= last; k++) pts.push([s[k * 4 + 2]!, s[k * 4 + 3]!]);
    const a = pts[0]!;
    const z = pts[pts.length - 1]!;
    const closed = Math.hypot(z[0] - a[0], z[1] - a[1]) < 1e-2;
    const c = circleThrough(a, pts[Math.floor(pts.length / 3)]!, pts[Math.floor((pts.length * 2) / 3)]!);
    const round = !!c && pts.every((p) => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) <= Math.max(0.25, c.r * 0.02));
    let circle: Circle;
    if (round) circle = c!;
    else if (closed) {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      circle = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: 0 };
    } else return;
    const id = this.circles.length;
    this.circles.push(circle);
    for (let k = first; k <= last; k++) this.segCircle.set(k, id);
    this.addPoint(circle.cx, circle.cy, 'center');
    // The run's top, right, bottom and left points; on an arc that stops short of a compass
    // point its end is the extreme instead, which is no quadrant.
    const keys = [(p: Pt) => p[1], (p: Pt) => -p[0], (p: Pt) => -p[1], (p: Pt) => p[0]];
    const { cx, cy, r } = circle;
    const exact: Pt[] = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
    const tol = Math.max(0.5, r * 0.05);
    keys.forEach((key, q) => {
      const p = pts.reduce((best, x) => (key(x) < key(best) ? x : best));
      if (!round) return this.addPoint(p[0], p[1], 'quadrant');
      const e = exact[q]!;
      if (Math.hypot(p[0] - e[0], p[1] - e[1]) <= tol) this.addPoint(e[0], e[1], 'quadrant');
    });
  }

  /** Indices of segments passing near the box [x0,x1]×[y0,y1]. */
  private candidates(x0: number, y0: number, x1: number, y1: number): number[] {
    this.query = (this.query + 1) >>> 0 || 1;
    const out: number[] = [];
    const c = this.cellSize;
    for (let cx = Math.floor(x0 / c) - 1; cx <= Math.floor(x1 / c) + 1; cx++) {
      for (let cy = Math.floor(y0 / c) - 1; cy <= Math.floor(y1 / c) + 1; cy++) {
        const cell = this.grid.get(this.key(cx, cy));
        if (!cell) continue;
        for (const i of cell) {
          if (this.stamp[i] === this.query) continue;
          this.stamp[i] = this.query;
          out.push(i);
        }
      }
    }
    return out;
  }

  /** Segments within `radius` of `p`, as flat [x1, y1, x2, y2, ...] (for tracking paths to cross). */
  linesNear(p: Pt, radius: number, curves = true): number[] {
    const out: number[] = [];
    const s = this.segments;
    for (const i of this.candidates(p[0] - radius, p[1] - radius, p[0] + radius, p[1] + radius)) {
      if (!curves && this.curves?.[i] === 1) continue;
      const [x1, y1, x2, y2] = [s[i * 4]!, s[i * 4 + 1]!, s[i * 4 + 2]!, s[i * 4 + 3]!];
      if (segmentDistance(p, x1, y1, x2, y2).d <= radius) out.push(x1, y1, x2, y2);
    }
    return out;
  }

  /**
   * Best snap target within `radius` of `p`, or null. `extraPoints` (e.g. vertices of existing
   * markups) snap as endpoints, or as their own kind when given as snaps. `kinds`, when given,
   * limits the drawing geometry snapped to. Without `curves`, line work flattened from curves is
   * ignored; with it, the nearest point on a curve is snapped to whether or not `kinds` has
   * 'nearest' (which then means straight lines).
   */
  snap(p: Pt, radius: number, extraPoints: readonly (Pt | Snap)[] = [], kinds?: ReadonlySet<SnapKind>, curves = true, options: SnapOptions = {}): Snap | null {
    const [px, py] = p;
    const s = this.segments;
    let best: Snap | null = null;
    let bestScore = Infinity;
    const has = (kind: SnapKind) => !kinds || kinds.has(kind);
    const consider = (x: number, y: number, kind: SnapKind, extra = false, dir?: [number, number]) => {
      if (!extra && !has(kind)) return;
      const d = Math.hypot(x - px, y - py);
      if (d > radius) return;
      // Priority dominates; distance breaks ties within a kind.
      const score = PRIORITY[kind] * radius * 10 + d;
      if (score < bestScore) {
        bestScore = score;
        best = dir ? { point: [x, y], kind, dir } : { point: [x, y], kind };
      }
    };

    for (const e of extraPoints) {
      if ('kind' in e) consider(e.point[0], e.point[1], e.kind, true, e.dir);
      else consider(e[0], e[1], 'endpoint', true);
    }

    const near: Near[] = [];
    for (const i of this.candidates(px - radius, py - radius, px + radius, py + radius)) {
      const curve = this.curves?.[i] === 1;
      if (curve && !curves) continue;
      const [x1, y1, x2, y2] = [s[i * 4]!, s[i * 4 + 1]!, s[i * 4 + 2]!, s[i * 4 + 3]!];
      const { d } = segmentDistance(p, x1, y1, x2, y2);
      if (d > radius) continue;
      const c = this.segCircle.get(i);
      near.push({ x1, y1, x2, y2, d, curve, ends: true, circle: c === undefined ? undefined : this.circles[c] });
    }
    const lines = options.lines;
    if (lines) {
      for (let k = 0; k + 3 < lines.length; k += 4) {
        const [x1, y1, x2, y2] = [lines[k]!, lines[k + 1]!, lines[k + 2]!, lines[k + 3]!];
        if (Math.min(x1, x2) - radius > px || Math.max(x1, x2) + radius < px || Math.min(y1, y2) - radius > py || Math.max(y1, y2) + radius < py) continue;
        const { d } = segmentDistance(p, x1, y1, x2, y2);
        if (d <= radius) near.push({ x1, y1, x2, y2, d, curve: false, ends: false, circle: undefined });
      }
    }

    const from = options.from;
    const seen = new Set<Circle>();
    for (const g of near) {
      const { x1, y1, x2, y2, curve } = g;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const u: [number, number] = [(x2 - x1) / len, (y2 - y1) / len];
      if (g.ends) {
        consider(x1, y1, 'endpoint', false, curve ? undefined : [-u[0], -u[1]]);
        consider(x2, y2, 'endpoint', false, curve ? undefined : u);
        consider((x1 + x2) / 2, (y1 + y2) / 2, 'midpoint');
      }
      const { x: nx, y: ny } = segmentDistance(p, x1, y1, x2, y2);
      consider(nx, ny, 'nearest', curve, curve ? undefined : u);
      if (from && !curve && has('perpendicular')) {
        // The foot of the perpendicular from `from` onto the line, within the segment.
        const t = ((from[0] - x1) * u[0] + (from[1] - y1) * u[1]) / len;
        if (t >= 0 && t <= 1) consider(x1 + t * (x2 - x1), y1 + t * (y2 - y1), 'perpendicular');
      }
      const c = g.circle;
      if (!from || !c || c.r <= 0 || seen.has(c)) continue;
      seen.add(c);
      const dx = from[0] - c.cx;
      const dy = from[1] - c.cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-9) {
        // Perpendicular to a circle: where the line through its centre meets it.
        consider(c.cx + (dx / dist) * c.r, c.cy + (dy / dist) * c.r, 'perpendicular');
        consider(c.cx - (dx / dist) * c.r, c.cy - (dy / dist) * c.r, 'perpendicular');
      }
      if (dist > c.r) {
        const base = Math.atan2(dy, dx);
        const spread = Math.acos(c.r / dist);
        for (const a of [base + spread, base - spread]) consider(c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a), 'tangent');
      }
    }

    // Centres and quadrants of circles found in the drawing.
    const cs = this.cellSize;
    for (let cx = Math.floor((px - radius) / cs); cx <= Math.floor((px + radius) / cs); cx++) {
      for (let cy = Math.floor((py - radius) / cs); cy <= Math.floor((py + radius) / cs); cy++) {
        for (const k of this.pointGrid.get(this.key(cx, cy)) ?? []) {
          const q = this.points[k]!;
          consider(q.x, q.y, q.kind);
        }
      }
    }

    near.sort((a, b) => a.d - b.d);
    const pool = near.slice(0, MAX_INTERSECT_CANDIDATES);
    const apparent = has('apparent');
    for (let a = 0; a < pool.length; a++) {
      for (let b = a + 1; b < pool.length; b++) {
        const hit = intersect(pool[a]!, pool[b]!);
        if (hit?.proper) consider(hit.x, hit.y, 'intersection');
        else if (hit && apparent && !pool[a]!.curve && !pool[b]!.curve) consider(hit.x, hit.y, 'apparent');
      }
    }
    return best;
  }
}

/** Distance from `p` to a segment, and the nearest point on it. */
export function segmentDistance(p: Pt, x1: number, y1: number, x2: number, y2: number): { d: number; x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / len2)) : 0;
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return { d: Math.hypot(x - p[0], y - p[1]), x, y };
}

/**
 * Where two segments' lines cross (null when parallel or when they meet at an end): `proper`
 * when within both segments, otherwise where they would cross if extended.
 */
function intersect(a: Seg, b: Seg): { x: number; y: number; proper: boolean } | null {
  const rx = a.x2 - a.x1;
  const ry = a.y2 - a.y1;
  const qx = b.x2 - b.x1;
  const qy = b.y2 - b.y1;
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-9 * Math.max(1e-9, Math.hypot(rx, ry) * Math.hypot(qx, qy))) return null;
  const t = ((b.x1 - a.x1) * qy - (b.y1 - a.y1) * qx) / den;
  const u = ((b.x1 - a.x1) * ry - (b.y1 - a.y1) * rx) / den;
  const eps = 1e-6;
  const inside = t > eps && t < 1 - eps && u > eps && u < 1 - eps;
  // Lines that meet at an end make an endpoint, not an intersection or an apparent one.
  if (!inside && t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) return null;
  return { x: a.x1 + t * rx, y: a.y1 + t * ry, proper: inside };
}

/** The circle through three points, or null when they are in a line. */
function circleThrough(a: Pt, b: Pt, c: Pt): Circle | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}
