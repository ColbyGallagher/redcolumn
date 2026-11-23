import { geoRegionAt, type GeoRegion } from '@nb/measure';
import { gridToPage, pageToGrid, placementFromGeoRegion } from '../geospatial/align';
import { MAX_FIT_ERROR } from '../geospatial/modelOnSheet';
import type { SheetSource } from './sheetOverlays';

type Pt = [number, number];

/**
 * Links between a model's elements and the sheets registered to the same map: from a page point
 * to the map (to find what is there in the model), and from a map position to the sheets that
 * show it (to open them where an element lies).
 */

/** Where a region's registration places it on the map, when it fits well enough to trust. */
export function fitOf(region: GeoRegion) {
  const fit = placementFromGeoRegion(region);
  return fit && fit.error <= MAX_FIT_ERROR ? fit.placement : null;
}

/** The map position (grid easting, northing) at a page point, from the smallest registration there; null off every map. */
export function gridAtPage(regions: readonly GeoRegion[], pageIndex: number, pt: Pt): Pt | null {
  const region = geoRegionAt(regions, pageIndex, pt);
  const placement = region && fitOf(region);
  return placement ? pageToGrid(placement, pt) : null;
}

/** A sheet that shows a map position, and where on its page. */
export interface SheetHit {
  source: SheetSource;
  /** The page point (PDF points, y down). */
  point: Pt;
}

/** The sheets whose registered region shows a map position, each with the page point there. */
export function sheetsAt(sources: readonly SheetSource[], easting: number, northing: number): SheetHit[] {
  const hits: SheetHit[] = [];
  for (const source of sources) {
    const placement = fitOf(source.region);
    if (!placement) continue;
    const point = gridToPage(placement, [easting, northing]);
    if (inside(source.region.bounds, point)) hits.push({ source, point });
  }
  return hits;
}

/** A square around a page point, as wide as `size`, for the highlight shown when a sheet opens there. */
export function ringAround([x, y]: Pt, size = 36) {
  return { x: x - size / 2, y: y - size / 2, w: size, h: size };
}

export function inside(poly: readonly (readonly [number, number])[], [x, y]: Pt): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
