import type { GeoRegion } from '@nb/measure';
import type { PlanView } from '@nb/model3d';
import { gridToPage, pageToGrid } from '../geospatial/align';
import type { PageView } from '../viewer/TileViewer';
import { fitOf, inside } from './links';

type Pt = [number, number];

/**
 * Sync view between a sheet and a model, both on the same map: the model's plan camera shows what
 * the sheet's view shows (the same place, scale and heading), and moving either moves the other.
 */

/** Which way is up on screen, as a page direction, for a view turned clockwise by quarter turns. */
const SCREEN_UP: Pt[] = [
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 0],
];

/** The plan the model shows for a sheet's view; null when the view's centre is off every registered region. */
export function planForSheet(regions: readonly GeoRegion[], view: PageView): PlanView | null {
  const region = regionAt(regions, view.pageIndex, view.centre);
  const placement = region && fitOf(region);
  if (!placement || !(view.zoom > 0)) return null;
  const c = view.centre;
  const centre = pageToGrid(placement, c);
  const [ux, uy] = SCREEN_UP[((view.rotation % 4) + 4) % 4]!;
  const ahead = pageToGrid(placement, [c[0] + ux, c[1] + uy]);
  const up: Pt = [ahead[0] - centre[0], ahead[1] - centre[1]];
  const metresPerPoint = Math.hypot(...up);
  if (!(metresPerPoint > 0)) return null;
  return { centre: [centre[0], centre[1]], metresPerPixel: metresPerPoint / view.zoom, up: [up[0] / metresPerPoint, up[1] / metresPerPoint] };
}

/**
 * The sheet view that shows a model's plan: the same place at the same scale, keeping the sheet's
 * page when a region on it shows the place (else the first page that does) and its rotation.
 * Null when no registered region shows the plan's centre.
 */
export function sheetForPlan(regions: readonly GeoRegion[], plan: PlanView, current: PageView): PageView | null {
  const shows = (r: GeoRegion) => {
    const placement = fitOf(r);
    if (!placement) return null;
    const point = gridToPage(placement, plan.centre);
    return inside(r.bounds, point) ? { r, placement, point } : null;
  };
  const hits = regions.map(shows).filter((h) => !!h);
  const hit = hits.find((h) => h.r.pageIndex === current.pageIndex) ?? hits[0];
  if (!hit || !(plan.metresPerPixel > 0)) return null;
  const next = pageToGrid(hit.placement, [hit.point[0] + 1, hit.point[1]]);
  const metresPerPoint = Math.hypot(next[0] - plan.centre[0], next[1] - plan.centre[1]);
  return { pageIndex: hit.r.pageIndex, centre: hit.point, zoom: metresPerPoint / plan.metresPerPixel, rotation: current.rotation };
}

/** Whether two plans are the same to within a pixel's worth of movement and a tenth of a percent of scale. */
export function samePlan(a: PlanView | null, b: PlanView | null): boolean {
  if (!a || !b) return a === b;
  const px = Math.max(a.metresPerPixel, b.metresPerPixel);
  return (
    Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]) < px &&
    Math.abs(a.metresPerPixel / b.metresPerPixel - 1) < 1e-3 &&
    Math.abs(a.up[0] * b.up[1] - a.up[1] * b.up[0]) < 1e-3 &&
    a.up[0] * b.up[0] + a.up[1] * b.up[1] > 0
  );
}

/** The smallest registered region on a page that contains a point. */
function regionAt(regions: readonly GeoRegion[], pageIndex: number, pt: Pt): GeoRegion | null {
  let best: GeoRegion | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    if (r.pageIndex !== pageIndex || !inside(r.bounds, pt) || !fitOf(r)) continue;
    const area = Math.abs(r.bounds.reduce((s, [x, y], i) => {
      const [nx, ny] = r.bounds[(i + 1) % r.bounds.length]!;
      return s + x * ny - nx * y;
    }, 0));
    if (area < bestArea) [best, bestArea] = [r, area];
  }
  return best;
}
