import { AREA_LABELS, areaUnitOf, formatArea, formatLength, formatVolume, METERS_PER_UNIT, VOLUME_LABELS, volumeUnitOf, type Scale } from './scale.ts';

export type Pt = readonly [number, number];

export type MeasureKind = 'length' | 'polylength' | 'area' | 'perimeter' | 'count' | 'angle' | 'diameter' | 'radius' | 'arcLength' | 'volume';

export const MEASURE_KINDS: readonly MeasureKind[] = ['length', 'polylength', 'area', 'perimeter', 'count', 'angle', 'diameter', 'radius', 'arcLength', 'volume'];

/** What a kind measures: a length, an area, a volume, a number of items, or an angle. */
export type Quantity = 'length' | 'area' | 'volume' | 'count' | 'angle';

export const QUANTITY: Record<MeasureKind, Quantity> = {
  length: 'length',
  polylength: 'length',
  perimeter: 'length',
  diameter: 'length',
  radius: 'length',
  arcLength: 'length',
  area: 'area',
  volume: 'volume',
  count: 'count',
  angle: 'angle',
};

/** How steep a measured run or surface is: rise per 12 of run, degrees, or percent grade. */
export interface Slope {
  kind: 'pitch' | 'degrees' | 'percent';
  value: number;
}

/**
 * Extra properties of a measurement: cutouts (holes subtracted from areas and volumes), a depth
 * or height in meters (volume for areas, wall area for lengths), and a slope (lengths and areas
 * measured on plan grow to their true, sloped size).
 */
export interface MeasureProps {
  holes?: readonly (readonly Pt[])[];
  depth?: number;
  slope?: Slope;
  /** Curved segments: per segment (from point i to i + 1, the last closing a shape), its bulge; 0 or missing is straight. */
  bulges?: readonly number[];
  /** Cutouts' curved segments: per cutout, its bulges as for `bulges` (ignored unless one per edge). */
  holeBulges?: readonly (readonly number[] | null | undefined)[];
}

// --- Arc segments ---------------------------------------------------------------------------------
// A segment's bulge is tan(θ/4), θ its arc's included angle: 0 straight, ±1 a half circle. Positive
// bulges lie to the right of the direction of travel (x right, y up; mirrored on y-down pages, the
// same way for lengths and areas).

/** The bulge of the arc from `p` to `q` through a point `m` near the middle of the arc. */
export function bulgeThrough(p: Pt, q: Pt, m: Pt): number {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const c = Math.hypot(dx, dy);
  if (c < 1e-9) return 0;
  // Signed distance of m from the chord (right of travel positive), as the sagitta.
  const h = ((m[0] - p[0]) * dy - (m[1] - p[1]) * dx) / c;
  return (2 * h) / c;
}

/** An arc segment's length and the signed area between its chord and the arc. */
export function arcSegment(p: Pt, q: Pt, bulge: number): { length: number; area: number } {
  const c = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (!bulge || c < 1e-12) return { length: c, area: 0 };
  const theta = 4 * Math.atan(Math.abs(bulge));
  const r = c / (2 * Math.sin(theta / 2));
  return { length: theta * r, area: Math.sign(bulge) * ((r * r) / 2) * (theta - Math.sin(theta)) };
}

/** Points along an arc segment (excluding `p`, including `q`), for drawing and export. */
export function arcPoints(p: Pt, q: Pt, bulge: number, steps = 24): [number, number][] {
  if (!bulge) return [[q[0], q[1]]];
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const c = Math.hypot(dx, dy);
  const theta = 4 * Math.atan(bulge);
  const r = c / (2 * Math.sin(Math.abs(theta) / 2));
  // The centre is on the chord's perpendicular, away from the bulge for arcs under half a circle.
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (c / 2) * (c / 2))) * (Math.abs(theta) > Math.PI ? -1 : 1);
  // Unit vector to the right of travel.
  const rx = dy / c;
  const ry = -dx / c;
  const s = Math.sign(bulge);
  const cx = mx - rx * d * s;
  const cy = my - ry * d * s;
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  const out: [number, number][] = [];
  const n = Math.max(2, Math.ceil(steps * (Math.abs(theta) / Math.PI)));
  // Leaving p towards the right of travel turns counter-clockwise about the centre (x right, y up).
  for (let i = 1; i <= n; i++) {
    const a = a0 + (theta * i) / n;
    out.push(i === n ? [q[0], q[1]] : [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** A path with its arc segments turned into points (for drawing, hit tests and export); a closed one without repeating its start. */
export function expandArcs(points: readonly Pt[], bulges: readonly number[] | undefined, closed = false): [number, number][] {
  if (!points.length) return [];
  const out: [number, number][] = [[points[0]![0], points[0]![1]]];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const b = bulges?.[i] ?? 0;
    if (b) out.push(...arcPoints(p, q, b));
    else if (i + 1 < points.length) out.push([q[0], q[1]]);
  }
  // A closed shape does not repeat its first point.
  if (closed && out.length > 1 && (bulges?.[points.length - 1] ?? 0)) out.pop();
  return out;
}

/** Length of a path whose segments may be arcs. */
export function pathLengthArcs(points: readonly Pt[], bulges: readonly number[] | undefined, closed = false): number {
  if (!bulges?.some(Boolean)) return pathLength(points, closed);
  let sum = 0;
  const n = closed && points.length > 2 ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) sum += arcSegment(points[i]!, points[(i + 1) % points.length]!, bulges[i] ?? 0).length;
  return sum;
}

/** Area of a shape whose edges may be arcs. */
export function polygonAreaArcs(points: readonly Pt[], bulges: readonly number[] | undefined): number {
  if (!bulges?.some(Boolean)) return polygonArea(points);
  let twice = 0;
  let segments = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    twice += p[0] * q[1] - q[0] * p[1];
    segments += arcSegment(p, q, bulges[i] ?? 0).area;
  }
  // A counter-clockwise outline (positive shoelace) has its inside on the left, so bulges to the
  // right add area; on a clockwise one they cut into it. Both are the signed sum.
  return Math.abs(twice / 2 + segments);
}

/** The slope as an angle in radians. */
export function slopeAngle(slope: Slope): number {
  if (slope.kind === 'degrees') return (slope.value * Math.PI) / 180;
  return Math.atan(slope.kind === 'pitch' ? slope.value / 12 : slope.value / 100);
}

/** Plan-to-true multiplier for a slope (1 when flat). */
export function slopeFactor(slope: Slope | undefined): number {
  if (!slope || !slope.value) return 1;
  const a = slopeAngle(slope);
  return Math.abs(Math.cos(a)) < 1e-6 ? 1 : 1 / Math.cos(a);
}

export function formatSlope(slope: Slope): string {
  if (slope.kind === 'pitch') return `${+slope.value.toFixed(2)}:12`;
  if (slope.kind === 'degrees') return `${+slope.value.toFixed(1)}°`;
  return `${+slope.value.toFixed(1)}%`;
}

/**
 * Circle through three points, or null when they are (nearly) in a line.
 */
export function circleThrough3(a: Pt, b: Pt, c: Pt): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const sa = a[0] * a[0] + a[1] * a[1];
  const sb = b[0] * b[0] + b[1] * b[1];
  const sc = c[0] * c[0] + c[1] * c[1];
  const cx = (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d;
  const cy = (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/** Length of the arc from `a` through `b` to `c` (a straight line when they are in a line). */
export function arcLength3(a: Pt, b: Pt, c: Pt): number {
  const circle = circleThrough3(a, b, c);
  if (!circle) return Math.hypot(c[0] - a[0], c[1] - a[1]);
  const { cx, cy, r } = circle;
  const ang = (p: Pt) => Math.atan2(p[1] - cy, p[0] - cx);
  const TAU = Math.PI * 2;
  const norm = (x: number) => ((x % TAU) + TAU) % TAU;
  // Sweep from a to c counter-clockwise; if b is not on that side, the arc goes the other way.
  const sweepC = norm(ang(c) - ang(a));
  const sweepB = norm(ang(b) - ang(a));
  const sweep = sweepB <= sweepC ? sweepC : TAU - sweepC;
  return r * sweep;
}

export function isMeasureKind(type: string): type is MeasureKind {
  return (MEASURE_KINDS as readonly string[]).includes(type);
}

/** Minimum points a finished measurement of each kind needs. */
export const MIN_POINTS: Record<MeasureKind, number> = {
  length: 2,
  polylength: 2,
  area: 3,
  perimeter: 3,
  count: 1,
  angle: 3,
  diameter: 2,
  radius: 2,
  arcLength: 3,
  volume: 3,
};

/** Kinds that finish automatically once they have this many points. */
export const FIXED_POINTS: Partial<Record<MeasureKind, number>> = { length: 2, angle: 3, diameter: 2, radius: 2, arcLength: 3 };

export function pathLength(points: readonly Pt[], closed = false): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  if (closed && points.length > 2) {
    const a = points[points.length - 1]!;
    const b = points[0]!;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

/** Unsigned polygon area (shoelace formula), in square points. */
export function polygonArea(points: readonly Pt[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** Area-weighted centroid, falling back to the vertex average for degenerate polygons. */
export function polygonCentroid(points: readonly Pt[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length || 1;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Angle at vertex `b` between rays b→a and b→c, in degrees (0–180). */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = Math.atan2(a[1] - b[1], a[0] - b[0]);
  const v2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = Math.abs(v1 - v2) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

/** Plan area of a polygon less its cutouts, in square points. */
function netArea(points: readonly Pt[], holes: MeasureProps['holes'], bulges?: readonly number[], holeBulges?: MeasureProps['holeBulges']): number {
  const hole = (h: readonly Pt[], i: number) => {
    const b = holeBulges?.[i];
    return b && b.length === h.length ? polygonAreaArcs(h, b) : polygonArea(h);
  };
  return Math.max(0, polygonAreaArcs(points, bulges) - (holes ?? []).reduce((sum, h, i) => sum + (h.length > 2 ? hole(h, i) : 0), 0));
}

/**
 * Numeric value of a measurement: meters for lengths, square meters for areas, cubic meters for
 * volumes, items for counts, degrees for angles. Slopes apply to lengths and areas; cutouts to
 * areas and volumes.
 */
export function measureValue(kind: MeasureKind, points: readonly Pt[], metersPerPoint: number, props: MeasureProps = {}): number {
  const k = slopeFactor(props.slope);
  switch (kind) {
    case 'length':
    case 'polylength':
    case 'diameter':
    case 'radius':
      return (kind === 'polylength' ? pathLengthArcs(points, props.bulges) : pathLength(points.slice(0, 2))) * metersPerPoint * k;
    case 'arcLength':
      return (points.length >= 3 ? arcLength3(points[0]!, points[1]!, points[2]!) : pathLength(points)) * metersPerPoint * k;
    case 'perimeter':
      return pathLengthArcs(points, props.bulges, true) * metersPerPoint * k;
    case 'area':
      return netArea(points, props.holes, props.bulges, props.holeBulges) * metersPerPoint * metersPerPoint * k;
    case 'volume':
      return netArea(points, props.holes, props.bulges, props.holeBulges) * metersPerPoint * metersPerPoint * (props.depth ?? 0);
    case 'count':
      return points.length;
    case 'angle':
      return points.length >= 3 ? angleAt(points[0]!, points[1]!, points[2]!) : 0;
  }
}

/** Secondary quantities shown beside a measurement's value (meters, m², m³). */
export interface MeasureDetails {
  length?: number;
  area?: number;
  volume?: number;
  /** Lengths with a depth (height): the wall they describe. */
  wallArea?: number;
}

export function measureDetails(kind: MeasureKind, points: readonly Pt[], metersPerPoint: number, props: MeasureProps = {}): MeasureDetails {
  const q = QUANTITY[kind];
  if (q === 'length') {
    const length = measureValue(kind, points, metersPerPoint, props);
    return props.depth ? { length, wallArea: length * props.depth } : { length };
  }
  if (kind === 'area' || kind === 'volume') {
    const out: MeasureDetails = {
      length: pathLengthArcs(points, props.bulges, true) * metersPerPoint,
      area: measureValue('area', points, metersPerPoint, kind === 'volume' ? { holes: props.holes, bulges: props.bulges, holeBulges: props.holeBulges } : props),
    };
    if (props.depth) out.volume = measureValue('volume', points, metersPerPoint, props);
    return out;
  }
  return {};
}

export function formatMeasure(kind: MeasureKind, value: number, scale: Scale): string {
  switch (QUANTITY[kind]) {
    case 'length':
      return formatLength(value, scale);
    case 'area':
      return formatArea(value, scale);
    case 'volume':
      return formatVolume(value, scale);
    case 'count':
      return `${value} ea`;
    case 'angle':
      return `${value.toFixed(1)}°`;
  }
}

/**
 * A measured value in the scale's display units, for spreadsheets: lengths in `scale.unit`
 * (decimal, even when shown as feet-inches), areas in its square, counts in items, angles in degrees.
 */
export function toDisplayQuantity(kind: MeasureKind, value: number, scale: Scale): { value: number; unit: string } {
  const per = METERS_PER_UNIT[scale.unit];
  const perArea = METERS_PER_UNIT[areaUnitOf(scale)];
  const perVolume = METERS_PER_UNIT[volumeUnitOf(scale)];
  switch (QUANTITY[kind]) {
    case 'length':
      return { value: value / per, unit: scale.unit };
    case 'area':
      return { value: value / (perArea * perArea), unit: AREA_LABELS[areaUnitOf(scale)] };
    case 'volume':
      return { value: value / (perVolume * perVolume * perVolume), unit: VOLUME_LABELS[volumeUnitOf(scale)] };
    case 'count':
      return { value, unit: 'ea' };
    case 'angle':
      return { value, unit: 'deg' };
  }
}

export function measureLabel(kind: MeasureKind, points: readonly Pt[], scale: Scale, props: MeasureProps = {}): string {
  return formatMeasure(kind, measureValue(kind, points, scale.metersPerPoint, props), scale);
}

/** Where a measurement's label sits, in page space. */
export function labelAnchor(kind: MeasureKind, points: readonly Pt[]): [number, number] {
  if (kind === 'area' || kind === 'perimeter' || kind === 'volume') return polygonCentroid(points);
  // Circles: the label sits at the middle of the measured line (the diameter, or the radius).
  if (kind === 'diameter' || kind === 'radius') return points.length >= 2 ? [(points[0]![0] + points[1]![0]) / 2, (points[0]![1] + points[1]![1]) / 2] : [points[0]![0], points[0]![1]];
  if (kind === 'arcLength' && points.length >= 2) return [points[1]![0], points[1]![1]];
  if (kind === 'angle' && points.length >= 2) return [points[1]![0], points[1]![1]];
  if (kind === 'count') return [points[0]![0], points[0]![1]];
  // Midpoint of the segment containing the path's halfway point.
  const half = pathLength(points) / 2;
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (run + len >= half) {
      const t = len ? (half - run) / len : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    run += len;
  }
  return [points[0]![0], points[0]![1]];
}
