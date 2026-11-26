import { findCrs, gridToLatLon, latLonToGrid, type ProjectedCrs } from './crs.ts';
import { geoInverse, geoTransform, type GeoRegion } from './geo.ts';

/**
 * The world frame drawings and 3D models meet in: grid eastings and northings (metres, in a
 * projected CRS such as GDA2020 / MGA zone 56) and orthometric height (metres, AHD).
 *
 * Grid coordinates run to millions of metres, more than a 32-bit float (what a GPU draws with)
 * holds to the millimetre. So geometry is drawn relative to a local origin near the work, kept
 * at whole kilometres so the offsets stay readable ("E 318 250" is "250" from origin 318 000).
 * Nothing here depends on a renderer; a 3D view maps local (east, north, up) to its own axes.
 */
export interface WorldFrame {
  /** The CRS the grid coordinates are in, when known. */
  crs: ProjectedCrs | null;
  /** The local origin: easting, northing, height (metres), each a whole multiple of {@link FRAME_STEP}. */
  origin: [number, number, number];
}

/** The frame origin's step: whole kilometres. */
export const FRAME_STEP = 1000;

const snap = (v: number) => Math.floor(v / FRAME_STEP) * FRAME_STEP;

/** A frame whose origin is the whole kilometre at or below a grid point (heights stay at datum). */
export function worldFrame(easting: number, northing: number, crs: ProjectedCrs | null = null): WorldFrame {
  return { crs, origin: [snap(easting), snap(northing), 0] };
}

/** Grid easting, northing and height to the frame's local east, north and up (metres). */
export function gridToLocal(frame: WorldFrame, easting: number, northing: number, height = 0): [number, number, number] {
  const [e0, n0, h0] = frame.origin;
  return [easting - e0, northing - n0, height - h0];
}

/** The inverse of {@link gridToLocal}. */
export function localToGrid(frame: WorldFrame, east: number, north: number, up = 0): [number, number, number] {
  const [e0, n0, h0] = frame.origin;
  return [east + e0, north + n0, up + h0];
}

type Pt = readonly [number, number];

/** The CRS a /GEO region is in: the one given, else the one its EPSG code or name matches. */
export function regionCrs(region: GeoRegion, crs?: ProjectedCrs | null): ProjectedCrs | null {
  return crs ?? findCrs(region.epsg ?? null) ?? findCrs(region.crs ?? null);
}

/**
 * A page point in a geospatial PDF region to grid easting and northing (metres) in `crs` (the
 * region's own CRS when not given). Null off a region whose control points cannot fix a map, or
 * when no CRS is known.
 */
export function pageToGrid(region: GeoRegion, p: Pt, crs?: ProjectedCrs | null): [number, number] | null {
  const c = regionCrs(region, crs);
  const t = geoTransform(region);
  if (!c || !t) return null;
  const { lat, lon } = t(p);
  return latLonToGrid(c, lat, lon);
}

/** The inverse of {@link pageToGrid}: the page point in a region showing a grid easting and northing. */
export function gridToPage(region: GeoRegion, easting: number, northing: number, crs?: ProjectedCrs | null): [number, number] | null {
  const c = regionCrs(region, crs);
  const inv = geoInverse(region);
  if (!c || !inv) return null;
  const { lat, lon } = gridToLatLon(c, easting, northing);
  const [x, y] = inv(lat, lon);
  return [x, y];
}
