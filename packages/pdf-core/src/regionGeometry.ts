/**
 * Geometry for clearing regions out of page content. A region is a box, or a polygon (with the
 * box as its bounds, used to rule things out cheaply). Pure functions, no PDFium, so they can be tested.
 */

export type Pt = [number, number];

/** An axis-aligned box: left, right, bottom, top. */
export interface Box {
  l: number;
  r: number;
  b: number;
  t: number;
}

/** `poly` is absent for a plain rectangle, which is tested as the box itself (edges inclusive). */
export interface Region {
  box: Box;
  poly?: Pt[];
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon([px, py]: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function boxOf(poly: readonly Pt[]): Box {
  let l = Infinity;
  let r = -Infinity;
  let b = Infinity;
  let t = -Infinity;
  for (const [x, y] of poly) {
    l = Math.min(l, x);
    r = Math.max(r, x);
    b = Math.min(b, y);
    t = Math.max(t, y);
  }
  return { l, r, b, t };
}

export function polygonRegion(poly: Pt[]): Region {
  return { box: boxOf(poly), poly };
}

export function rectRegion(box: Box): Region {
  return { box };
}

export function boxesOverlap(a: Box, g: Box): boolean {
  return a.l < g.r && a.r > g.l && a.b < g.t && a.t > g.b;
}

export function boxWithin(a: Box, g: Box): boolean {
  return a.l >= g.l && a.r <= g.r && a.b >= g.b && a.t <= g.t;
}

const corners = (a: Box): Pt[] => [[a.l, a.b], [a.r, a.b], [a.r, a.t], [a.l, a.t]];

/** The parameter range [t0, t1] of the segment a→b inside the closed box (Liang–Barsky), or null. */
export function clipSegmentToBox(a: Pt, b: Pt, g: Box): [number, number] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a[0] - g.l],
    [dx, g.r - a[0]],
    [-dy, a[1] - g.b],
    [dy, g.t - a[1]],
  ] as [number, number][]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t0 < t1 ? [t0, t1] : null;
}

/** Does a polygon edge pass through the inside of the box (touching its border does not count)? */
function edgeCrossesBox(poly: readonly Pt[], a: Box): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j]!;
    const q = poly[i]!;
    const clip = clipSegmentToBox(p, q, a);
    if (!clip) continue;
    const t = (clip[0] + clip[1]) / 2;
    const x = p[0] + (q[0] - p[0]) * t;
    const y = p[1] + (q[1] - p[1]) * t;
    if (x > a.l && x < a.r && y > a.b && y < a.t) return true;
  }
  return false;
}

/**
 * Does the box overlap the region? For a polygon: the box's centre is inside it, or one of its
 * vertices is inside the box, or one of the box's corners is inside it, or an edge runs through the box.
 */
export function regionHits(g: Region, a: Box): boolean {
  if (!boxesOverlap(a, g.box)) return false;
  const poly = g.poly;
  if (!poly) return true;
  if (pointInPolygon([(a.l + a.r) / 2, (a.b + a.t) / 2], poly)) return true;
  if (poly.some(([x, y]) => x >= a.l && x <= a.r && y >= a.b && y <= a.t)) return true;
  if (corners(a).some((c) => pointInPolygon(c, poly))) return true;
  return edgeCrossesBox(poly, a);
}

/** Is the box wholly inside the region? For a polygon: all four corners inside and no edge cutting through. */
export function regionContains(g: Region, a: Box): boolean {
  if (!g.poly) return boxWithin(a, g.box);
  if (!boxWithin(a, g.box)) return false;
  return corners(a).every((c) => pointInPolygon(c, g.poly!)) && !edgeCrossesBox(g.poly, a);
}

/** Does the region contain the point? */
export function regionHasPoint(g: Region, [x, y]: Pt): boolean {
  if (x < g.box.l || x > g.box.r || y < g.box.b || y > g.box.t) return false;
  return g.poly ? pointInPolygon([x, y], g.poly) : true;
}

/** Parameter intervals of the segment a→b that lie inside one region. */
function insideIntervals(a: Pt, b: Pt, g: Region): [number, number][] {
  const clip = clipSegmentToBox(a, b, g.box);
  if (!clip) return [];
  if (!g.poly) return [clip];
  const poly = g.poly;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ts = [clip[0], clip[1]];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j]!;
    const q = poly[i]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (den === 0) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (u >= 0 && u <= 1 && t > clip[0] && t < clip[1]) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let k = 1; k < ts.length; k++) {
    const s = ts[k - 1]!;
    const e = ts[k]!;
    if (e <= s) continue;
    const m = (s + e) / 2;
    if (!pointInPolygon([a[0] + dx * m, a[1] + dy * m], poly)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === s) last[1] = e;
    else out.push([s, e]);
  }
  return out;
}

/** The parts of the segment a→b outside every region (parameter intervals along it). */
export function outsideParts(a: Pt, b: Pt, regions: readonly Region[]): [number, number][] {
  const inside = regions.flatMap((g) => insideIntervals(a, b, g));
  inside.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let from = 0;
  for (const [s, e] of inside) {
    if (s > from) out.push([from, s]);
    from = Math.max(from, e);
  }
  if (from < 1) out.push([from, 1]);
  return out;
}
