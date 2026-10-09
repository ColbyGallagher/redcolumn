import type { Pt } from './measure.ts';

export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'nearest';

export interface Snap {
  point: [number, number];
  kind: SnapKind;
}

/** Lower wins when several snaps are within range. */
const PRIORITY: Record<SnapKind, number> = { endpoint: 0, intersection: 1, midpoint: 2, nearest: 3 };
/** Grid cells are indexed with a fixed offset so small negative coordinates still hash uniquely. */
const OFFSET = 4096;
const STRIDE = 16384;
/** Cap on segments examined pairwise for intersections per query. */
const MAX_INTERSECT_CANDIDATES = 48;

/**
 * Spatial index over a page's vector line work for CAD-style snapping. Segments are
 * registered in every uniform-grid cell they pass through, so queries only touch nearby lines.
 */
export class SnapIndex {
  readonly segments: Float32Array;
  private cellSize: number;
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array;
  private query = 0;

  /**
   * @param segments flat [x1, y1, x2, y2, ...] in page space
   * @param cellSize grid cell edge in points; a few times the typical snap radius works well
   */
  constructor(segments: Float32Array, cellSize = 24) {
    this.segments = segments;
    this.cellSize = cellSize;
    this.stamp = new Uint32Array(segments.length / 4);
    for (let i = 0; i < segments.length / 4; i++) this.insert(i);
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

  /**
   * Best snap target within `radius` of `p`, or null. `extraPoints` (e.g. vertices of existing
   * markups) snap as endpoints. `kinds`, when given, limits the drawing geometry snapped to.
   */
  snap(p: Pt, radius: number, extraPoints: readonly Pt[] = [], kinds?: ReadonlySet<SnapKind>): Snap | null {
    const [px, py] = p;
    const s = this.segments;
    let best: Snap | null = null;
    let bestScore = Infinity;
    const consider = (x: number, y: number, kind: SnapKind, extra = false) => {
      if (kinds && !extra && !kinds.has(kind)) return;
      const d = Math.hypot(x - px, y - py);
      if (d > radius) return;
      // Priority dominates; distance breaks ties within a kind.
      const score = PRIORITY[kind] * radius * 10 + d;
      if (score < bestScore) {
        bestScore = score;
        best = { point: [x, y], kind };
      }
    };

    for (const [x, y] of extraPoints) consider(x, y, 'endpoint', true);

    const near: { i: number; d: number }[] = [];
    for (const i of this.candidates(px - radius, py - radius, px + radius, py + radius)) {
      const x1 = s[i * 4]!;
      const y1 = s[i * 4 + 1]!;
      const x2 = s[i * 4 + 2]!;
      const y2 = s[i * 4 + 3]!;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
      const nx = x1 + t * dx;
      const ny = y1 + t * dy;
      const d = Math.hypot(nx - px, ny - py);
      if (d > radius) continue;
      near.push({ i, d });
      consider(x1, y1, 'endpoint');
      consider(x2, y2, 'endpoint');
      consider((x1 + x2) / 2, (y1 + y2) / 2, 'midpoint');
      consider(nx, ny, 'nearest');
    }

    near.sort((a, b) => a.d - b.d);
    const pool = near.slice(0, MAX_INTERSECT_CANDIDATES);
    for (let a = 0; a < pool.length; a++) {
      for (let b = a + 1; b < pool.length; b++) {
        const hit = intersect(s, pool[a]!.i, pool[b]!.i);
        if (hit) consider(hit[0], hit[1], 'intersection');
      }
    }
    return best;
  }
}

/** Proper intersection point of two segments (excluding shared endpoints and parallels). */
function intersect(s: Float32Array, i: number, j: number): [number, number] | null {
  const ax = s[i * 4]!;
  const ay = s[i * 4 + 1]!;
  const bx = s[i * 4 + 2]!;
  const by = s[i * 4 + 3]!;
  const cx = s[j * 4]!;
  const cy = s[j * 4 + 1]!;
  const dx = s[j * 4 + 2]!;
  const dy = s[j * 4 + 3]!;
  const rx = bx - ax;
  const ry = by - ay;
  const qx = dx - cx;
  const qy = dy - cy;
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * qy - (cy - ay) * qx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return [ax + t * rx, ay + t * ry];
}
