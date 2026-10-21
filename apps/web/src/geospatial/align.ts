import { crsProjection, crsWkt, gridToLatLon, type GeoRegion, type ProjectedCrs } from '@nb/measure';
import { modelBounds, type GeoModel, type GridPoint } from './model';

type Pt = [number, number];

/**
 * Where a model lies on a page: a similarity (move, turn, uniform scale) from grid coordinates
 * (north up) to page points (y down). The grid point (e0, n0) sits at page point (x, y).
 */
export interface ModelPlacement {
  e0: number;
  n0: number;
  x: number;
  y: number;
  /** Page points per grid metre. */
  scale: number;
  /** Counter-clockwise turn of grid north on the sheet, in radians. */
  rotation: number;
}

export function gridToPage(p: ModelPlacement, [e, n]: readonly [number, number]): Pt {
  const dx = e - p.e0;
  const dy = n - p.n0;
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return [p.x + p.scale * (dx * c - dy * s), p.y - p.scale * (dx * s + dy * c)];
}

export function pageToGrid(p: ModelPlacement, [x, y]: readonly [number, number]): GridPoint {
  const rx = (x - p.x) / p.scale;
  const ry = -(y - p.y) / p.scale;
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return [p.e0 + rx * c + ry * s, p.n0 - rx * s + ry * c];
}

/** A paper scale's ratio (1:500 → 500) for a placement's points per metre. */
export const ratioOfScale = (pointsPerMetre: number) => 72 / 0.0254 / pointsPerMetre;
export const scaleOfRatio = (ratio: number) => 72 / 0.0254 / ratio;

/** An area to place a model in: a page, or a stitched view's world. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A first placement, centred in the box and north up: at the sheet's drawing scale (so a model
 * lands at its true size), else fitted into the box.
 */
export function initialPlacement(model: Pick<GeoModel, 'paths' | 'points'>, box: Box, scale: number | null): ModelPlacement {
  const b = modelBounds(model) ?? { minE: 0, minN: 0, maxE: 1, maxN: 1 };
  const w = Math.max(b.maxE - b.minE, 1e-6);
  const h = Math.max(b.maxN - b.minN, 1e-6);
  const fit = Math.min((box.width * 0.8) / w, (box.height * 0.8) / h);
  return {
    e0: (b.minE + b.maxE) / 2,
    n0: (b.minN + b.maxN) / 2,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    scale: scale && scale > 0 ? scale : fit,
    rotation: 0,
  };
}

const wrapAngle = (a: number) => (a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a);

/**
 * The placement that takes two grid points onto two page points (the two-point alignment);
 * null when either pair is a single point. With `scale` (points per metre, from the sheet's
 * calibration) only the move and turn are fitted, centred between the pairs, and the scale stays.
 */
export function placementFromPairs(a: GridPoint, pa: Pt, b: GridPoint, pb: Pt, scale?: number): ModelPlacement | null {
  const de = b[0] - a[0];
  const dn = b[1] - a[1];
  // Page vector with y up, to compare with north-up grid.
  const vx = pb[0] - pa[0];
  const vy = -(pb[1] - pa[1]);
  const lm = Math.hypot(de, dn);
  const lp = Math.hypot(vx, vy);
  if (lm < 1e-9 || lp < 1e-9) return null;
  const rotation = wrapAngle(Math.atan2(vy, vx) - Math.atan2(dn, de));
  if (scale === undefined) return { e0: a[0], n0: a[1], x: pa[0], y: pa[1], scale: lp / lm, rotation };
  return { e0: (a[0] + b[0]) / 2, n0: (a[1] + b[1]) / 2, x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2, scale, rotation };
}

/** The placement moved by a page offset. */
export const movePlacement = (p: ModelPlacement, dx: number, dy: number): ModelPlacement => ({ ...p, x: p.x + dx, y: p.y + dy });

/** The placement turned and scaled about a page point (which stays where it is). */
export function aboutPoint(p: ModelPlacement, pivot: Pt, change: { rotation?: number; scale?: number }): ModelPlacement {
  const g = pageToGrid(p, pivot);
  return { ...p, e0: g[0], n0: g[1], x: pivot[0], y: pivot[1], rotation: change.rotation ?? p.rotation, scale: change.scale ?? p.scale };
}

/**
 * A page's map registration: the area given (the whole page, or a stitched sheet's drawing
 * region) with a grid of control points, taken to grid coordinates by `toGrid` and to latitude
 * and longitude by the CRS.
 */
export function geoRegionFor(opts: { toGrid: (p: Pt) => GridPoint; crs: ProjectedCrs; pageIndex: number; bounds: Pt[]; name: string }): GeoRegion {
  const { toGrid, crs, pageIndex, bounds, name } = opts;
  const xs = bounds.map((p) => p[0]);
  const ys = bounds.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const points: GeoRegion['points'] = [];
  for (const u of [0, 0.5, 1]) {
    for (const v of [0, 0.5, 1]) {
      const at: Pt = [x0 + u * (x1 - x0), y0 + v * (y1 - y0)];
      const [e, n] = toGrid(at);
      points.push({ at, ...gridToLatLon(crs, e, n) });
    }
  }
  return {
    id: `geo-${pageIndex}-${Date.now().toString(36)}`,
    pageIndex,
    name,
    bounds,
    points,
    projection: crsProjection(crs),
    crs: crs.name,
    epsg: crs.epsg,
    wkt: crsWkt(crs),
  };
}
