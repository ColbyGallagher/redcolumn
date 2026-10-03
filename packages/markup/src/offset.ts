import { boundsOf, type Markup, type Point, type Rect } from './model';

type Pt = readonly [number, number];

/** Adds points along long segments so no two neighbours are more than `step` apart. */
function densify(points: readonly Pt[], step: number): Point[] {
  const out: Point[] = [];
  points.forEach((p, i) => {
    if (i > 0) {
      const q = points[i - 1]!;
      const n = Math.floor(Math.hypot(p[0] - q[0], p[1] - q[1]) / step);
      for (let k = 1; k <= n; k++) out.push([q[0] + ((p[0] - q[0]) * k) / (n + 1), q[1] + ((p[1] - q[1]) * k) / (n + 1)]);
    }
    out.push([p[0], p[1]]);
  });
  return out;
}

/**
 * What is left of a freehand stroke after erasing a circle of radius `r` around `at`: the pieces
 * outside it (each at least two points long), or null if the eraser did not touch the stroke.
 */
export function eraseStroke(points: readonly Pt[], at: Pt, r: number): Point[][] | null {
  const dense = densify(points, r / 2);
  if (!dense.some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) <= r)) return null;
  const pieces: Point[][] = [];
  let cur: Point[] = [];
  for (const p of dense) {
    if (Math.hypot(p[0] - at[0], p[1] - at[1]) <= r) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

/** Left-hand unit normal of segment a→b (page space, y down): the side a positive offset goes. */
function normal(a: Pt, b: Pt): [number, number] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / d, -(b[0] - a[0]) / d];
}

/**
 * A path moved sideways by `d` (positive to the left of its direction), with mitred corners.
 * Closed paths wrap around; very sharp corners are clipped so they do not spike.
 */
export function offsetPath(points: readonly Pt[], d: number, closed: boolean): Point[] {
  const n = points.length;
  if (n < 2) return points.map((p) => [p[0], p[1]] as Point);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? points[i - 1]! : closed ? points[n - 1]! : null;
    const next = i < n - 1 ? points[i + 1]! : closed ? points[0]! : null;
    const p = points[i]!;
    const n1 = prev ? normal(prev, p) : null;
    const n2 = next ? normal(p, next) : null;
    if (!n1 || !n2) {
      const nn = (n1 ?? n2)!;
      out.push([p[0] + nn[0] * d, p[1] + nn[1] * d]);
      continue;
    }
    // Mitre: along the bisector, lengthened so both offset lines pass through it.
    const bx = n1[0] + n2[0];
    const by = n1[1] + n2[1];
    const len = Math.hypot(bx, by);
    if (len < 1e-9) {
      out.push([p[0] + n1[0] * d, p[1] + n1[1] * d]);
      continue;
    }
    const cos = (n1[0] * bx + n1[1] * by) / len;
    const k = d / Math.max(cos, 0.25);
    out.push([p[0] + (bx / len) * k, p[1] + (by / len) * k]);
  }
  return out;
}

/** Signed area; positive when the vertices run clockwise on screen (y down). */
function signedArea(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function distToSegment(p: Pt, a: Pt, b: Pt): { d: number; side: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  const [nx, ny] = normal(a, b);
  return { d, side: Math.sign((p[0] - a[0]) * nx + (p[1] - a[1]) * ny) || 1 };
}

function insidePolygon([px, py]: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type OffsetKind = 'open' | 'polygon' | 'box';

/** How a markup type is offset: its path sideways, its outline in or out, or its box grown. */
function offsetKind(m: Markup): OffsetKind | null {
  switch (m.type) {
    case 'line':
    case 'arrow':
    case 'polyline':
    case 'length':
    case 'polylength':
      return 'open';
    case 'polygon':
    case 'area':
    case 'perimeter':
      return m.points.length >= 3 ? 'polygon' : null;
    case 'rect':
    case 'ellipse':
    case 'cloud':
      return 'box';
    default:
      return null;
  }
}

/** True if Edit › Offset works on this markup. */
export function canOffset(m: Markup): boolean {
  return offsetKind(m) !== null;
}

/**
 * The signed offset that puts a copy of the markup through `p`: for open paths positive is to the
 * left of the path's direction, for closed shapes positive is outward.
 */
export function offsetDistance(m: Markup, p: Pt): number {
  const kind = offsetKind(m);
  if (kind === 'box') {
    const b = boundsOf(m.points);
    const corners: Pt[] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    return outlineDistance(corners, p);
  }
  if (kind === 'polygon') return outlineDistance(m.points, p);
  let best = { d: Infinity, side: 1 };
  for (let i = 1; i < m.points.length; i++) {
    const r = distToSegment(p, m.points[i - 1]!, m.points[i]!);
    if (r.d < best.d) best = r;
  }
  return Number.isFinite(best.d) ? best.d * best.side : 0;
}

function outlineDistance(poly: readonly Pt[], p: Pt): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!).d);
  return insidePolygon(p, poly) ? -d : d;
}

/** The markup's points offset by `d` (see `offsetDistance`), or null if it cannot be offset. */
export function offsetPoints(m: Markup, d: number): Point[] | null {
  const kind = offsetKind(m);
  if (kind === 'open') return offsetPath(m.points, d, false);
  if (kind === 'polygon') {
    // Positive is outward whichever way the vertices run: clockwise on screen, outside is on the left.
    const outward = signedArea(m.points) > 0 ? 1 : -1;
    return offsetPath(m.points, d * outward, true);
  }
  if (kind === 'box') {
    const b: Rect = boundsOf(m.points);
    // A box cannot shrink past nothing.
    const g = Math.max(d, -Math.min(b.w, b.h) / 2 + 0.5);
    return [
      [b.x - g, b.y - g],
      [b.x + b.w + g, b.y + b.h + g],
    ];
  }
  return null;
}
