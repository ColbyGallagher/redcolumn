import type { Pt } from './measure.ts';

export interface SearchRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SymbolMatch {
  /** Centre of the matched symbol. */
  center: [number, number];
  /** Axis-aligned bounds of the matched symbol's lines. */
  rect: SearchRect;
  /** Rotation from the template, in degrees (0 when rotations are off). */
  angle: number;
  /** Share of the template's lines found (0–1). */
  score: number;
  /** Size relative to the template (1 unless scaled copies are searched for). */
  scale: number;
}

export interface VisualSearchOptions {
  /** Find the symbol at any rotation, not just as drawn. */
  rotations?: boolean;
  /** How far matching endpoints may be apart, in points. Default 0.75. */
  tolerance?: number;
  /** Share of the template's lines a match must have. Default 0.9. */
  minScore?: number;
  /** Also find copies drawn larger or smaller (half to twice the size). */
  scales?: boolean;
}

type Seg = [number, number, number, number];

/** The line work fully inside a box: the symbol to look for. */
export function templateSegments(segments: ArrayLike<number>, box: SearchRect, margin = 0.5): Seg[] {
  const inside = (x: number, y: number) => x >= box.x - margin && x <= box.x + box.w + margin && y >= box.y - margin && y <= box.y + box.h + margin;
  const out: Seg[] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const s: Seg = [segments[i]!, segments[i + 1]!, segments[i + 2]!, segments[i + 3]!];
    if (inside(s[0], s[1]) && inside(s[2], s[3]) && Math.hypot(s[2] - s[0], s[3] - s[1]) > 1e-3) out.push(s);
  }
  return out;
}

/** Page segments hashed by midpoint, for "is there a segment with these endpoints?" lookups. */
class SegmentHash {
  private cells = new Map<number, number[]>();
  private segs: ArrayLike<number>;
  private cell: number;
  constructor(segs: ArrayLike<number>, cell: number) {
    this.segs = segs;
    this.cell = cell;
    for (let i = 0; i + 3 < segs.length; i += 4) {
      const k = this.key((segs[i]! + segs[i + 2]!) / 2, (segs[i + 1]! + segs[i + 3]!) / 2);
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(x: number, y: number) {
    return Math.floor(x / this.cell) * 1_000_003 + Math.floor(y / this.cell);
  }
  /** Whether a segment joins (ax, ay) and (bx, by), either way round, within `tol`. */
  has(ax: number, ay: number, bx: number, by: number, tol: number): boolean {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const cx = Math.floor(mx / this.cell);
    const cy = Math.floor(my / this.cell);
    const s = this.segs;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get((cx + dx) * 1_000_003 + (cy + dy));
        if (!list) continue;
        for (const i of list) {
          const x1 = s[i]!;
          const y1 = s[i + 1]!;
          const x2 = s[i + 2]!;
          const y2 = s[i + 3]!;
          if ((Math.hypot(x1 - ax, y1 - ay) <= tol && Math.hypot(x2 - bx, y2 - by) <= tol) || (Math.hypot(x1 - bx, y1 - by) <= tol && Math.hypot(x2 - ax, y2 - ay) <= tol)) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Symbol Search on vector line work: every place the symbol (`template`, see templateSegments) appears on a page, the
 * original included. The template's longest line anchors the search: each page line of the same
 * length is tried as its image (both ways round), and the match is kept when enough of the
 * template's other lines are there too after the same move (and turn, with `rotations`).
 */
export function visualSearch(segments: ArrayLike<number>, template: readonly Seg[], options: VisualSearchOptions = {}): SymbolMatch[] {
  if (template.length < 2) return [];
  const tol = options.tolerance ?? 0.75;
  const minScore = options.minScore ?? 0.9;
  const len = (s: Seg) => Math.hypot(s[2] - s[0], s[3] - s[1]);
  const anchor = template.reduce((a, b) => (len(b) > len(a) ? b : a));
  const L = len(anchor);
  const aAngle = Math.atan2(anchor[3] - anchor[1], anchor[2] - anchor[0]);
  const amx = (anchor[0] + anchor[2]) / 2;
  const amy = (anchor[1] + anchor[3]) / 2;
  // Template geometry relative to the anchor's midpoint.
  const rel = template.filter((s) => s !== anchor).map((s) => [s[0] - amx, s[1] - amy, s[2] - amx, s[3] - amy] as Seg);
  // The symbol's own extent (its lines), not the looser box drawn around it.
  const xs0 = template.flatMap((t) => [t[0], t[2]]);
  const ys0 = template.flatMap((t) => [t[1], t[3]]);
  const tb = { x: Math.min(...xs0), y: Math.min(...ys0), w: Math.max(...xs0) - Math.min(...xs0), h: Math.max(...ys0) - Math.min(...ys0) };
  const corners: Pt[] = [
    [tb.x - amx, tb.y - amy],
    [tb.x + tb.w - amx, tb.y - amy],
    [tb.x + tb.w - amx, tb.y + tb.h - amy],
    [tb.x - amx, tb.y + tb.h - amy],
  ];
  const centerRel: Pt = [tb.x + tb.w / 2 - amx, tb.y + tb.h / 2 - amy];
  const hash = new SegmentHash(segments, Math.max(4 * tol, L / 2, 2));
  const matches: SymbolMatch[] = [];
  const angleTol = Math.max(0.002, (2 * tol) / Math.max(L, 1));

  for (let i = 0; i + 3 < segments.length; i += 4) {
    const x1 = segments[i]!;
    const y1 = segments[i + 1]!;
    const x2 = segments[i + 2]!;
    const y2 = segments[i + 3]!;
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    // The page line's length gives the copy's size.
    let k = 1;
    if (options.scales) {
      k = segLen / L;
      if (k < 0.5 || k > 2) continue;
    } else if (Math.abs(segLen - L) > tol * 2) continue;
    const ktol = tol * Math.max(1, k);
    const sAngle = Math.atan2(y2 - y1, x2 - x1);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    // The page line may be the anchor either way round: a turn of φ or φ + π.
    for (const flip of [0, Math.PI]) {
      let phi = sAngle - aAngle + flip;
      phi = Math.atan2(Math.sin(phi), Math.cos(phi));
      if (!options.rotations && Math.abs(phi) > angleTol) continue;
      if (!options.rotations) phi = 0;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const map = (x: number, y: number): Pt => [mx + k * (x * c - y * sn), my + k * (x * sn + y * c)];
      let found = 1; // the anchor itself
      let missing = 0;
      const allowed = Math.floor((1 - minScore) * template.length);
      for (const r of rel) {
        const [ax, ay] = map(r[0], r[1]);
        const [bx, by] = map(r[2], r[3]);
        if (hash.has(ax, ay, bx, by, ktol)) found++;
        else if (++missing > allowed) break;
      }
      if (missing > allowed) continue;
      const pts = corners.map(([x, y]) => map(x, y));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const center = map(centerRel[0], centerRel[1]);
      matches.push({ center: [center[0], center[1]], rect, angle: (phi * 180) / Math.PI, score: found / template.length, scale: k });
    }
  }

  // One match per place: symmetric symbols match several ways, and repeated lines several times.
  const out: SymbolMatch[] = [];
  const near = Math.max(Math.min(tb.w, tb.h) / 2, tol * 4);
  for (const m of matches.sort((a, b) => b.score - a.score)) {
    if (!out.some((o) => Math.hypot(o.center[0] - m.center[0], o.center[1] - m.center[1]) < near * Math.min(o.scale, m.scale))) out.push(m);
  }
  return out.sort((a, b) => a.center[1] - b.center[1] || a.center[0] - b.center[0]);
}
