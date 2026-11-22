import { regionCrs, type GeoRegion } from '@nb/measure';
import { gridToPage, placementFromGeoRegion } from './align';
import type { GeoModel } from './model';

type Pt = [number, number];

/** A model's linework placed on one geospatial region of a sheet. */
export interface ModelLayer {
  /** The region's outline: the linework is drawn only inside it. */
  bounds: Pt[];
  paths: Pt[][];
}

/** A fit worse than this (page points) is not trusted: the region is skewed or stretched. */
export const MAX_FIT_ERROR = 2;

/** Whether a model is in a region's coordinate system (a model naming none is taken to be). */
export function sameCrs(model: Pick<GeoModel, 'crs' | 'crsName'>, region: GeoRegion): boolean {
  const rc = regionCrs(region);
  if (!rc) return false;
  if (!model.crs) return !model.crsName;
  return model.crs.epsg === rc.epsg;
}

/**
 * The models' linework on a page's geospatial regions: each region placed through its own map
 * registration, keeping only the lines that come near it. Regions that are not in the model's
 * coordinate system, or that a move, turn and scale cannot follow, are left out.
 */
export function modelLayers(models: readonly GeoModel[], regions: readonly GeoRegion[], pageIndex: number): ModelLayer[] {
  const out: ModelLayer[] = [];
  for (const region of regions) {
    if (region.pageIndex !== pageIndex || region.bounds.length < 3) continue;
    const fit = placementFromGeoRegion(region);
    if (!fit || fit.error > MAX_FIT_ERROR) continue;
    const xs = region.bounds.map((p) => p[0]);
    const ys = region.bounds.map((p) => p[1]);
    const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.02;
    const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
    const paths: Pt[][] = [];
    for (const model of models) {
      if (!sameCrs(model, region)) continue;
      for (const path of model.paths) {
        const onPage = path.map((g) => gridToPage(fit.placement, g));
        // Off the region entirely: its bounding box misses the region's.
        let [a, b, c, d] = [Infinity, -Infinity, Infinity, -Infinity];
        for (const [x, y] of onPage) {
          if (x < a) a = x;
          if (x > b) b = x;
          if (y < c) c = y;
          if (y > d) d = y;
        }
        if (b < x0 || a > x1 || d < y0 || c > y1) continue;
        paths.push(onPage);
      }
    }
    if (paths.length) out.push({ bounds: region.bounds.map(([x, y]) => [x, y] as Pt), paths });
  }
  return out;
}
