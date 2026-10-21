import { findCrs, GDA2020_MGA, latLonToGrid } from '@nb/measure';
import type { GridPoint, ParsedModel } from './model';

/**
 * GeoJSON. RFC 7946 files are longitude/latitude (WGS 84, within a metre or so of GDA2020): they
 * are projected into the MGA zone at their centre. Older files may name a projected CRS
 * ("crs": {"properties": {"name": "urn:ogc:def:crs:EPSG::7856"}}), whose coordinates are used as they are.
 */
export function parseGeoJson(text: string): ParsedModel {
  const json = JSON.parse(text) as { crs?: { properties?: { name?: string } } };
  const named = json.crs?.properties?.name ?? null;
  const projected = findCrs(named);
  const warnings: string[] = [];
  const paths: number[][][] = [];
  const points: { name: string; at: number[] }[] = [];

  const visit = (geom: any, name: string) => {
    if (!geom || typeof geom !== 'object') return;
    const c = geom.coordinates;
    switch (geom.type) {
      case 'Point':
        points.push({ name, at: c });
        break;
      case 'MultiPoint':
        for (const p of c) points.push({ name, at: p });
        break;
      case 'LineString':
        paths.push(c);
        break;
      case 'MultiLineString':
      case 'Polygon':
        paths.push(...c);
        break;
      case 'MultiPolygon':
        for (const poly of c) paths.push(...poly);
        break;
      case 'GeometryCollection':
        for (const g of geom.geometries ?? []) visit(g, name);
        break;
    }
  };
  const root = json as any;
  if (root.type === 'FeatureCollection') for (const f of root.features ?? []) visit(f.geometry, String(f.properties?.name ?? f.properties?.Name ?? ''));
  else if (root.type === 'Feature') visit(root.geometry, String(root.properties?.name ?? ''));
  else visit(root, '');

  const valid = (p: unknown): p is number[] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  if (projected || (named && !/CRS84|4326|4283|7844/i.test(named))) {
    if (!projected) warnings.push(`The file's coordinate system (${named}) is not one offered: choose the one its coordinates are in.`);
    return {
      crsName: named,
      paths: paths.map((p) => p.filter(valid).map((q) => [q[0]!, q[1]!] as GridPoint)),
      points: points.filter((p) => valid(p.at)).map((p) => ({ name: p.name, at: [p.at[0]!, p.at[1]!] as GridPoint })),
      warnings,
    };
  }
  // Longitude/latitude: into the zone the data's centre falls in.
  const lons = [...paths.flat(), ...points.map((p) => p.at)].filter(valid).map((p) => p[0]!);
  const mid = lons.length ? (Math.min(...lons) + Math.max(...lons)) / 2 : 135;
  const zone = GDA2020_MGA.find((c) => Math.abs(mid - c.lon0) <= 3) ?? GDA2020_MGA.find((c) => c.epsg === 7853)!;
  if (Math.abs(mid - zone.lon0) > 3) warnings.push('The data lies outside the MGA zones.');
  const grid = (p: number[]): GridPoint => latLonToGrid(zone, p[1]!, p[0]!);
  return {
    crsName: zone.id,
    paths: paths.map((p) => p.filter(valid).map(grid)),
    points: points.filter((p) => valid(p.at)).map((p) => ({ name: p.name, at: grid(p.at) })),
    warnings: [...warnings, `Longitudes and latitudes were projected into ${zone.name}.`],
  };
}
