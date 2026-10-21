import { findCrs, type ProjectedCrs } from '@nb/measure';
import { parseDxf } from './dxf';
import { parseGeoJson } from './geojson';
import { parseIfc } from './ifc';
import { parseLandXml } from './landxml';

/** A grid coordinate: easting and northing, in metres. */
export type GridPoint = [number, number];

/**
 * A model or CAD file read for the Geospatial panel: its linework in grid coordinates (eastings
 * and northings in metres, in the coordinate system the file names) for laying over a sheet.
 */
export interface GeoModel {
  name: string;
  format: 'IFC' | 'LandXML' | 'DXF' | 'GeoJSON';
  /** The coordinate system as the file names it, when it does. */
  crsName: string | null;
  /** The offered CRS that name (or code) matches. */
  crs: ProjectedCrs | null;
  /** Lines and outlines, in grid metres. */
  paths: GridPoint[][];
  /** Named points (survey points, structures), in grid metres. */
  points: { name: string; at: GridPoint }[];
  /** What was skipped or assumed while reading. */
  warnings: string[];
}

/** What a parser returns; the name, format and matched CRS are filled in by {@link readModel}. */
export type ParsedModel = Omit<GeoModel, 'name' | 'format' | 'crs'>;

export const MODEL_EXTENSIONS = ['.ifc', '.xml', '.landxml', '.dxf', '.geojson', '.json'];

/** Linework drawn at most, so a huge model stays responsive (the rest is dropped with a warning). */
export const MAX_SEGMENTS = 250_000;

/** Reads a model file by its extension (or, for .xml/.json, its content). */
export function readModel(name: string, text: string): GeoModel {
  const ext = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? '';
  const head = text.slice(0, 4000);
  let format: GeoModel['format'];
  if (ext === '.ifc' || /^\s*ISO-10303-21/.test(head)) format = 'IFC';
  else if (ext === '.dxf') format = 'DXF';
  else if (ext === '.geojson' || ((ext === '.json' || !ext) && /^\s*\{/.test(head))) format = 'GeoJSON';
  else if (/<LandXML\b/i.test(head) || ext === '.landxml') format = 'LandXML';
  else throw new Error(`${name} is not an IFC, LandXML, DXF or GeoJSON file.`);
  const parsed = format === 'IFC' ? parseIfc(text) : format === 'LandXML' ? parseLandXml(text) : format === 'DXF' ? parseDxf(text) : parseGeoJson(text);
  const model: GeoModel = { name, format, ...parsed, crs: findCrs(parsed.crsName) };
  limitSegments(model);
  if (!model.paths.length && !model.points.length) model.warnings.push('Found no linework or points to show.');
  return model;
}

function limitSegments(model: GeoModel) {
  let total = 0;
  const kept: GridPoint[][] = [];
  for (const p of model.paths) {
    const n = Math.max(0, p.length - 1);
    if (total + n > MAX_SEGMENTS) {
      model.warnings.push(`Showing the first ${MAX_SEGMENTS.toLocaleString()} line segments; the rest are left out.`);
      break;
    }
    total += n;
    kept.push(p);
  }
  model.paths = kept;
}

/** The model's extent in grid metres; null when it has nothing in it. */
export function modelBounds(model: Pick<GeoModel, 'paths' | 'points'>): { minE: number; minN: number; maxE: number; maxN: number } | null {
  let minE = Infinity;
  let minN = Infinity;
  let maxE = -Infinity;
  let maxN = -Infinity;
  const add = ([e, n]: GridPoint) => {
    if (!Number.isFinite(e) || !Number.isFinite(n)) return;
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  };
  for (const p of model.paths) p.forEach(add);
  for (const p of model.points) add(p.at);
  return minE <= maxE ? { minE, minN, maxE, maxN } : null;
}

/** Points along a circular arc from `a` to `b` about `c` (counter-clockwise when `ccw`). */
export function arcPoints(c: GridPoint, a: GridPoint, b: GridPoint, ccw: boolean, full = false): GridPoint[] {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let t1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  let sweep = t1 - t0;
  if (full) sweep = ccw ? 2 * Math.PI : -2 * Math.PI;
  else if (ccw && sweep <= 0) sweep += 2 * Math.PI;
  else if (!ccw && sweep >= 0) sweep -= 2 * Math.PI;
  t1 = t0 + sweep;
  const steps = Math.max(2, Math.min(256, Math.ceil(Math.abs(sweep) / (Math.PI / 36))));
  const out: GridPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (sweep * i) / steps;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}
