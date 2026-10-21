/**
 * Geospatial PDFs: maps registered to the earth (ISO 32000-2 §12.10, Adobe's geospatial
 * extension). A region of a page lists control points (a page point and the latitude/longitude
 * it shows); the map between them is the drawing's projection, which is affine in projected
 * metres. So the points are projected, an affine map is fitted from the page to them, and a page
 * point is taken through that map and the inverse projection back to latitude and longitude.
 */

type Pt = readonly [number, number];

/** An ellipsoid: semi-major axis (m) and flattening. */
export interface Ellipsoid {
  a: number;
  f: number;
}

export const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 };

/**
 * How the map is drawn. Scale factors and false eastings/northings are left out: the fitted
 * affine map takes them up.
 */
export type GeoProjection =
  | { kind: 'geographic' }
  | { kind: 'transverseMercator'; lon0: number; ellipsoid: Ellipsoid }
  | { kind: 'mercator'; lon0: number; ellipsoid: Ellipsoid }
  | { kind: 'lambertConic'; lon0: number; lat0: number; lat1: number; lat2: number; ellipsoid: Ellipsoid }
  /** Unknown projection: a transverse Mercator centred on the control points stands in for it. */
  | { kind: 'local' };

/** A control point: where on the page, and the latitude/longitude (degrees) it shows. */
export interface GeoControlPoint {
  at: Pt;
  lat: number;
  lon: number;
}

/** A region of a page registered to the earth. */
export interface GeoRegion {
  id: string;
  pageIndex: number;
  name: string;
  /** The region's outline in page space (where the coordinates apply). */
  bounds: Pt[];
  points: GeoControlPoint[];
  projection: GeoProjection;
  /** The coordinate system's name ("GDA94 / MGA zone 56", "EPSG:4326"), when the file gives one. */
  crs?: string;
  /** The coordinate system's EPSG code and OGC WKT, as the file gives them (written back to /GCS). */
  epsg?: number;
  wkt?: string;
}

const RAD = Math.PI / 180;

// ---- Projections (Snyder, "Map Projections: A Working Manual", 1987) -------------------------

interface Projector {
  forward(lat: number, lon: number): [number, number];
  inverse(x: number, y: number): [number, number];
}

const e2Of = (el: Ellipsoid) => el.f * (2 - el.f);

function transverseMercator(lon0: number, el: Ellipsoid): Projector {
  const { a } = el;
  const e2 = e2Of(el);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const ep2 = e2 / (1 - e2);
  const m1 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
  const m2 = (3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024;
  const m3 = (15 * e4) / 256 + (45 * e6) / 1024;
  const m4 = (35 * e6) / 3072;
  const meridian = (p: number) => a * (m1 * p - m2 * Math.sin(2 * p) + m3 * Math.sin(4 * p) - m4 * Math.sin(6 * p));
  const l0 = lon0 * RAD;
  return {
    forward(lat, lon) {
      const p = lat * RAD;
      const s = Math.sin(p);
      const c = Math.cos(p);
      const n = a / Math.sqrt(1 - e2 * s * s);
      const t = Math.tan(p) ** 2;
      const cc = ep2 * c * c;
      const A = (lon * RAD - l0) * c;
      const x = n * (A + ((1 - t + cc) * A ** 3) / 6 + ((5 - 18 * t + t * t + 72 * cc - 58 * ep2) * A ** 5) / 120);
      const y = meridian(p) + n * Math.tan(p) * ((A * A) / 2 + ((5 - t + 9 * cc + 4 * cc * cc) * A ** 4) / 24 + ((61 - 58 * t + t * t + 600 * cc - 330 * ep2) * A ** 6) / 720);
      return [x, y];
    },
    inverse(x, y) {
      const mu = y / (a * m1);
      const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
      const p1 =
        mu +
        ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
        ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
        ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
        ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
      const s = Math.sin(p1);
      const c = Math.cos(p1);
      const c1 = ep2 * c * c;
      const t1 = Math.tan(p1) ** 2;
      const n1 = a / Math.sqrt(1 - e2 * s * s);
      const r1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
      const d = x / n1;
      const lat = p1 - ((n1 * Math.tan(p1)) / r1) * ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
      const lon = l0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / c;
      return [lat / RAD, lon / RAD];
    },
  };
}

/** Isometric latitude's t (Snyder 15-9) and its inverse by iteration (7-9). */
function tsfn(p: number, e: number) {
  const s = e * Math.sin(p);
  return Math.tan(Math.PI / 4 - p / 2) / ((1 - s) / (1 + s)) ** (e / 2);
}
function phiOfT(t: number, e: number) {
  let p = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 15; i++) {
    const s = e * Math.sin(p);
    const next = Math.PI / 2 - 2 * Math.atan(t * ((1 - s) / (1 + s)) ** (e / 2));
    if (Math.abs(next - p) < 1e-12) return next;
    p = next;
  }
  return p;
}

function mercator(lon0: number, el: Ellipsoid): Projector {
  const e = Math.sqrt(e2Of(el));
  const l0 = lon0 * RAD;
  return {
    forward: (lat, lon) => [el.a * (lon * RAD - l0), -el.a * Math.log(tsfn(lat * RAD, e))],
    inverse: (x, y) => [phiOfT(Math.exp(-y / el.a), e) / RAD, (x / el.a + l0) / RAD],
  };
}

function lambertConic(lon0: number, lat0: number, lat1: number, lat2: number, el: Ellipsoid): Projector {
  const e2 = e2Of(el);
  const e = Math.sqrt(e2);
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const [p0, p1, p2, l0] = [lat0 * RAD, lat1 * RAD, lat2 * RAD, lon0 * RAD];
  const n = Math.abs(p1 - p2) < 1e-10 ? Math.sin(p1) : (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(tsfn(p1, e)) - Math.log(tsfn(p2, e)));
  const F = m(p1) / (n * tsfn(p1, e) ** n);
  const rho0 = el.a * F * tsfn(p0, e) ** n;
  const sign = n < 0 ? -1 : 1;
  return {
    forward(lat, lon) {
      const rho = el.a * F * tsfn(lat * RAD, e) ** n;
      const theta = n * (lon * RAD - l0);
      return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
    },
    inverse(x, y) {
      const rho = sign * Math.hypot(x, rho0 - y);
      const theta = Math.atan2(sign * x, sign * (rho0 - y));
      return [phiOfT((rho / (el.a * F)) ** (1 / n), e) / RAD, (theta / n + l0) / RAD];
    },
  };
}

function projector(p: GeoProjection, points: readonly GeoControlPoint[]): Projector {
  switch (p.kind) {
    case 'geographic':
      return { forward: (lat, lon) => [lon, lat], inverse: (x, y) => [y, x] };
    case 'transverseMercator':
      return transverseMercator(p.lon0, p.ellipsoid);
    case 'mercator':
      return mercator(p.lon0, p.ellipsoid);
    case 'lambertConic':
      return lambertConic(p.lon0, p.lat0, p.lat1, p.lat2, p.ellipsoid);
    case 'local': {
      // Conformal and centred on the map: close to whatever projection drew it.
      const lon0 = points.reduce((s, q) => s + q.lon, 0) / (points.length || 1);
      return transverseMercator(lon0, WGS84);
    }
  }
}

/** A latitude/longitude in a projection's metres (degrees for geographic), before scale and false origin. */
export function geoProject(projection: GeoProjection, lat: number, lon: number, near: readonly GeoControlPoint[] = []): [number, number] {
  return projector(projection, near).forward(lat, lon);
}

/** The inverse of {@link geoProject}: latitude and longitude, in degrees. */
export function geoUnproject(projection: GeoProjection, x: number, y: number, near: readonly GeoControlPoint[] = []): [number, number] {
  return projector(projection, near).inverse(x, y);
}

// ---- Fitting --------------------------------------------------------------------------------

/** Solves the 3×3 system m·x = v; null when singular. */
function solve3(m: number[][], v: number[]): number[] | null {
  const a = m.map((row, i) => [...row, v[i]!]);
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[pivot]![c]!)) pivot = r;
    if (Math.abs(a[pivot]![c]!) < 1e-12) return null;
    [a[c], a[pivot]] = [a[pivot]!, a[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = a[r]![c]! / a[c]![c]!;
      for (let j = c; j < 4; j++) a[r]![j]! -= k * a[c]![j]!;
    }
  }
  return a.map((row, i) => row[3]! / row[i]!);
}

/** Least-squares affine map page → projected, as [a b c d e f]: x' = a·x + b·y + c, y' = d·x + e·y + f. */
function fitAffine(from: readonly Pt[], to: readonly Pt[]): number[] | null {
  if (from.length < 3) return null;
  // Centred for conditioning.
  const cx = from.reduce((s, p) => s + p[0], 0) / from.length;
  const cy = from.reduce((s, p) => s + p[1], 0) / from.length;
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const vx = [0, 0, 0];
  const vy = [0, 0, 0];
  from.forEach((p, i) => {
    const row = [p[0] - cx, p[1] - cy, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) m[r]![c]! += row[r]! * row[c]!;
      vx[r]! += row[r]! * to[i]![0];
      vy[r]! += row[r]! * to[i]![1];
    }
  });
  const sx = solve3(m, vx);
  const sy = solve3(m, vy);
  if (!sx || !sy) return null;
  return [sx[0]!, sx[1]!, sx[2]! - sx[0]! * cx - sx[1]! * cy, sy[0]!, sy[1]!, sy[2]! - sy[0]! * cx - sy[1]! * cy];
}

/** A region's page → latitude/longitude map; null when its control points cannot fix one. */
export type GeoTransform = (p: Pt) => { lat: number; lon: number };

const fitted = new WeakMap<GeoRegion, GeoTransform | null>();

export function geoTransform(region: GeoRegion): GeoTransform | null {
  if (fitted.has(region)) return fitted.get(region)!;
  const proj = projector(region.projection, region.points);
  const affine = fitAffine(
    region.points.map((q) => q.at),
    region.points.map((q) => proj.forward(q.lat, q.lon)),
  );
  const t: GeoTransform | null = affine
    ? ([x, y]) => {
        const [a, b, c, d, e, f] = affine as [number, number, number, number, number, number];
        const [lat, lon] = proj.inverse(a * x + b * y + c, d * x + e * y + f);
        return { lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
      }
    : null;
  fitted.set(region, t);
  return t;
}

function insidePolygon(poly: readonly Pt[], [x, y]: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  return Math.abs(s) / 2;
}

/** The geo region on a page containing a point (the smallest where they overlap). */
export function geoRegionAt(regions: readonly GeoRegion[], pageIndex: number, p: Pt): GeoRegion | null {
  let best: GeoRegion | null = null;
  for (const r of regions) {
    if (r.pageIndex !== pageIndex || !insidePolygon(r.bounds, p) || !geoTransform(r)) continue;
    if (!best || polygonArea(r.bounds) < polygonArea(best.bounds)) best = r;
  }
  return best;
}

/** Latitude and longitude at a page point; null off every map. */
export function geoAt(regions: readonly GeoRegion[], pageIndex: number, p: Pt): { lat: number; lon: number; region: GeoRegion } | null {
  const region = geoRegionAt(regions, pageIndex, p);
  const t = region && geoTransform(region);
  return t ? { ...t(p), region: region! } : null;
}

// ---- Display --------------------------------------------------------------------------------

export type GeoFormat = 'decimal' | 'dms';

function dms(v: number, pos: string, neg: string): string {
  const hemi = v < 0 ? neg : pos;
  // Round once, at the tenth of a second, so 59.95″ carries into the minute.
  let tenths = Math.round(Math.abs(v) * 36000);
  const s = (tenths % 600) / 10;
  tenths = Math.floor(tenths / 600);
  const m = tenths % 60;
  const d = Math.floor(tenths / 60);
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${hemi}`;
}

/** "-33.868820, 151.209290" or "33°52′07.8″S 151°12′33.4″E". */
export function formatLatLon(lat: number, lon: number, format: GeoFormat = 'decimal'): string {
  return format === 'dms' ? `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}` : `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
