import { WGS84, type Ellipsoid, type GeoControlPoint, type GeoProjection, type GeoRegion } from '@nb/measure';
import { dict, nameOf, num, nums, str, userToPage, type PdfDictValue, type PdfPageExtras } from './bluebeam';
import type { Point } from './model';

/**
 * Geospatial PDFs (ISO 32000-2 §12.10; Adobe's geospatial extension, as written by Acrobat,
 * GDAL and map publishers): a page's viewports (/VP) whose /Measure is /GEO register a region of
 * the page to the earth. Its control points (/LPTS, in the unit square over the viewport's /BBox)
 * show the latitudes and longitudes in /GPTS; /GCS names the coordinate system the map is drawn in.
 */

const CLARKE_1866: Ellipsoid = { a: 6378206.4, f: 1 / 294.978698214 };
const AIRY: Ellipsoid = { a: 6377563.396, f: 1 / 299.3249646 };
const SPHERE: Ellipsoid = { a: 6378137, f: 0 };

/** Common projected systems by EPSG code, for files that give the code without WKT. */
function projectionOfEpsg(code: number): GeoProjection | null {
  const tm = (lon0: number, ellipsoid = WGS84): GeoProjection => ({ kind: 'transverseMercator', lon0, ellipsoid });
  const utm = (zone: number, ellipsoid = WGS84) => tm(-183 + 6 * zone, ellipsoid);
  // WGS 84, GDA94, GDA2020, NAD83, NAD27, ETRS89, NZGD2000.
  if ([4326, 4283, 7844, 4269, 4267, 4258, 4167].includes(code)) return { kind: 'geographic' };
  if (code >= 32601 && code <= 32660) return utm(code - 32600);
  if (code >= 32701 && code <= 32760) return utm(code - 32700);
  if (code >= 26901 && code <= 26923) return utm(code - 26900);
  if (code >= 26701 && code <= 26722) return utm(code - 26700, CLARKE_1866);
  // GDA94 / MGA zones 48–58 and GDA2020 / MGA zones 46–59.
  if (code >= 28348 && code <= 28358) return utm(code - 28300);
  if (code >= 7846 && code <= 7859) return utm(code - 7800);
  if (code >= 25828 && code <= 25838) return utm(code - 25800);
  if (code === 2193) return tm(173);
  if (code === 27700) return tm(-2, AIRY);
  if (code === 3857 || code === 900913) return { kind: 'mercator', lon0: 0, ellipsoid: SPHERE };
  if (code === 3395) return { kind: 'mercator', lon0: 0, ellipsoid: WGS84 };
  return null;
}

const squash = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').trim();

/** A WKT (1 or 2) PARAMETER's value by any of its names. */
function wktParam(wkt: string, ...names: string[]): number | null {
  for (const m of wkt.matchAll(/PARAMETER\s*\[\s*"([^"]*)"\s*,\s*(-?[\d.eE+-]+)/gi)) {
    if (names.includes(squash(m[1]!))) return Number(m[2]);
  }
  return null;
}

/** The projection a WKT coordinate system describes; null when it is not one handled here. */
export function projectionOfWkt(wkt: string): GeoProjection | null {
  const root = /^\s*(\w+)\s*\[/.exec(wkt)?.[1]?.toUpperCase() ?? '';
  if (['GEOGCS', 'GEOGCRS', 'GEODCRS', 'GEOGRAPHICCRS'].includes(root)) return { kind: 'geographic' };
  const sph = /(?:SPHEROID|ELLIPSOID)\s*\[\s*"[^"]*"\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)/i.exec(wkt);
  const invF = sph ? Number(sph[2]) : NaN;
  const ellipsoid: Ellipsoid = sph && Number(sph[1]) > 0 ? { a: Number(sph[1]), f: invF > 0 ? 1 / invF : 0 } : WGS84;
  const method = squash(/(?:PROJECTION|METHOD)\s*\[\s*"([^"]*)"/i.exec(wkt)?.[1] ?? '');
  const lon0 = wktParam(wkt, 'central meridian', 'longitude of natural origin', 'longitude of origin', 'longitude of false origin') ?? 0;
  const lat0 = wktParam(wkt, 'latitude of origin', 'latitude of natural origin', 'latitude of false origin') ?? 0;
  if (method.includes('transverse mercator') || method === 'utm') return { kind: 'transverseMercator', lon0, ellipsoid };
  if (method.includes('pseudo mercator') || /pseudo.mercator|web.mercator/i.test(wkt)) return { kind: 'mercator', lon0, ellipsoid: { a: ellipsoid.a, f: 0 } };
  if (method.includes('mercator')) return { kind: 'mercator', lon0, ellipsoid };
  if (method.includes('lambert conformal conic')) {
    const lat1 = wktParam(wkt, 'standard parallel 1', 'latitude of 1st standard parallel') ?? lat0;
    const lat2 = wktParam(wkt, 'standard parallel 2', 'latitude of 2nd standard parallel') ?? lat1;
    return { kind: 'lambertConic', lon0, lat0, lat1, lat2, ellipsoid };
  }
  return null;
}

/** A coordinate system dictionary's projection and name. */
function readGcs(gcs: PdfDictValue | null): { projection: GeoProjection; crs?: string; epsg?: number; wkt?: string } {
  const wkt = str(gcs?.WKT) ?? '';
  const epsg = num(gcs?.EPSG);
  const name = /^\s*\w+\s*\[\s*"([^"]+)"/.exec(wkt)?.[1];
  const crs = name ?? (epsg ? `EPSG:${epsg}` : undefined);
  const projection = (wkt && projectionOfWkt(wkt)) || (epsg && projectionOfEpsg(epsg)) || (nameOf(gcs?.Type) === 'GEOGCS' ? { kind: 'geographic' as const } : { kind: 'local' as const });
  return { projection, ...(crs ? { crs } : {}), ...(epsg ? { epsg } : {}), ...(wkt ? { wkt } : {}) };
}

/** Flat numbers taken pairwise. */
const pairs = (flat: readonly number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
};

/** The page's geospatial regions, from its /VP entries whose /Measure is /GEO. */
export function importGeoRegions(pageIndex: number, page: Pick<PdfPageExtras, 'matrix' | 'viewports'>): GeoRegion[] {
  const toPage = userToPage(page.matrix);
  const out: GeoRegion[] = [];
  page.viewports.forEach((vp, i) => {
    const m = dict(vp.Measure);
    if (!m || nameOf(m.Subtype) !== 'GEO') return;
    const box = nums(vp.BBox);
    if (box.length < 4) return;
    const x0 = Math.min(box[0]!, box[2]!);
    const y0 = Math.min(box[1]!, box[3]!);
    const w = Math.abs(box[2]! - box[0]!);
    const h = Math.abs(box[3]! - box[1]!);
    // The unit square is laid over the viewport's box, from its lower-left corner.
    const onPage = ([u, v]: [number, number]): Point => toPage(x0 + u * w, y0 + v * h);
    const boundsUnit = pairs(nums(m.Bounds));
    const bounds = (boundsUnit.length >= 3 ? boundsUnit : ([[0, 0], [0, 1], [1, 1], [1, 0]] as [number, number][])).map(onPage);
    const lpts = pairs(nums(m.LPTS));
    const local = lpts.length ? lpts : boundsUnit;
    const geo = pairs(nums(m.GPTS));
    const points: GeoControlPoint[] = [];
    for (let k = 0; k < Math.min(local.length, geo.length); k++) {
      const [lat, lon] = geo[k]!;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 360) continue;
      points.push({ at: onPage(local[k]!), lat, lon });
    }
    if (points.length < 3) return;
    out.push({
      id: `pdf-geo-${pageIndex}-${i}`,
      pageIndex,
      name: str(vp.Name) || 'Map',
      bounds,
      points,
      ...readGcs(dict(m.GCS)),
    });
  });
  return out;
}

/** True for a /VP entry that registers a map (kept as it is when the page's scales are written). */
export const isGeoViewport = (vp: PdfDictValue | null) => nameOf(dict(vp?.Measure)?.Subtype) === 'GEO';
