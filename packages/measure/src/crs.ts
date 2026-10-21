import { geoProject, geoUnproject, type Ellipsoid, type GeoProjection } from './geo.ts';

/**
 * Projected coordinate systems a model or CAD file's eastings and northings can be in, for turning
 * them into latitude and longitude. For now: Australia's GDA2020, as Map Grid of Australia zones.
 */

/** GRS 1980, the ellipsoid GDA2020 (and GDA94) is defined on. */
export const GRS80: Ellipsoid = { a: 6378137, f: 1 / 298.257222101 };

/** A projected CRS: a transverse Mercator grid with its scale factor and false origin. */
export interface ProjectedCrs {
  /** "EPSG:7856". */
  id: string;
  epsg: number;
  /** "GDA2020 / MGA zone 56". */
  name: string;
  /** Where it is used, for the picker ("144°E to 150°E"). */
  area: string;
  lon0: number;
  k0: number;
  falseEasting: number;
  falseNorthing: number;
  ellipsoid: Ellipsoid;
}

/** GDA2020 / MGA zones 46–59 (EPSG:7846–7859). */
export const GDA2020_MGA: readonly ProjectedCrs[] = Array.from({ length: 14 }, (_, i) => {
  const zone = 46 + i;
  const lon0 = -183 + 6 * zone;
  return {
    id: `EPSG:${7800 + zone}`,
    epsg: 7800 + zone,
    name: `GDA2020 / MGA zone ${zone}`,
    area: `${lon0 - 3}°E to ${lon0 + 3}°E`,
    lon0,
    k0: 0.9996,
    falseEasting: 500000,
    falseNorthing: 10000000,
    ellipsoid: GRS80,
  };
});

/** Every coordinate system the Geospatial panel offers. */
export const PROJECTED_CRS: readonly ProjectedCrs[] = GDA2020_MGA;

export const crsById = (id: string): ProjectedCrs | null => PROJECTED_CRS.find((c) => c.id === id) ?? null;

/**
 * The CRS a file names, by EPSG code ("EPSG:7856", "7856") or by name ("GDA2020 / MGA zone 56",
 * "MGA2020 Zone 56", "GDA2020 MGA Zone 56"); null when it is none of those offered.
 */
export function findCrs(text: string | number | null | undefined): ProjectedCrs | null {
  if (text == null) return null;
  const s = String(text).trim();
  const code = /^(?:EPSG\s*:+\s*)?(\d{4,5})$/i.exec(s)?.[1] ?? /EPSG\D{0,3}(\d{4,5})/i.exec(s)?.[1];
  if (code) return PROJECTED_CRS.find((c) => c.epsg === Number(code)) ?? null;
  // MGA2020 / GDA2020 by zone; GDA94's MGA zones (MGA94) are not GDA2020, so they are not matched.
  if (/(GDA|MGA)\s*-?\s*2020/i.test(s)) {
    const zone = /zone\s*(\d{2})|\bz\s*(\d{2})\b|\bMGA\s*(?:2020)?\s*-?\s*(\d{2})\b/i.exec(s);
    const n = Number(zone?.[1] ?? zone?.[2] ?? zone?.[3]);
    return GDA2020_MGA.find((c) => c.epsg === 7800 + n) ?? null;
  }
  return null;
}

/** The CRS's projection as a geospatial PDF records it (scale and false origin left to the fit). */
export const crsProjection = (crs: ProjectedCrs): GeoProjection => ({ kind: 'transverseMercator', lon0: crs.lon0, ellipsoid: crs.ellipsoid });

/** Easting and northing (metres) to latitude and longitude (degrees). */
export function gridToLatLon(crs: ProjectedCrs, easting: number, northing: number): { lat: number; lon: number } {
  const [lat, lon] = geoUnproject(crsProjection(crs), (easting - crs.falseEasting) / crs.k0, (northing - crs.falseNorthing) / crs.k0);
  return { lat, lon };
}

/** Latitude and longitude (degrees) to easting and northing (metres). */
export function latLonToGrid(crs: ProjectedCrs, lat: number, lon: number): [number, number] {
  const [x, y] = geoProject(crsProjection(crs), lat, lon);
  return [x * crs.k0 + crs.falseEasting, y * crs.k0 + crs.falseNorthing];
}

/** The CRS as OGC WKT 1, for a geospatial PDF's /GCS. */
export function crsWkt(crs: ProjectedCrs): string {
  const invF = crs.ellipsoid.f ? 1 / crs.ellipsoid.f : 0;
  return (
    `PROJCS["${crs.name}",GEOGCS["GDA2020",DATUM["Geocentric_Datum_of_Australia_2020",SPHEROID["GRS 1980",${crs.ellipsoid.a},${invF}]],` +
    `PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],` +
    `PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${crs.lon0}],PARAMETER["scale_factor",${crs.k0}],` +
    `PARAMETER["false_easting",${crs.falseEasting}],PARAMETER["false_northing",${crs.falseNorthing}],UNIT["metre",1],AUTHORITY["EPSG","${crs.epsg}"]]`
  );
}
