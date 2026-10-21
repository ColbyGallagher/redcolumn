import { arcPoints, type GridPoint, type ParsedModel } from './model';

/**
 * DXF (ASCII): model-space linework from CAD. DXF carries no coordinate system, so its
 * coordinates are taken as grid eastings and northings in the CRS chosen in the panel (survey and
 * civil drawings are usually drawn in MGA). $INSUNITS gives the drawing unit.
 * Read: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, POINT. Blocks (INSERT) are not expanded.
 */

const INSUNITS: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 10: 0.9144, 21: 1200 / 3937 };

export function parseDxf(text: string): ParsedModel {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]!.trim()), lines[i + 1]!.trim()]);
  const warnings: string[] = ['DXF files name no coordinate system: choose the one the drawing is in.'];
  const paths: GridPoint[][] = [];
  const points: ParsedModel['points'] = [];

  let unit = 1;
  const ins = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  if (ins >= 0) unit = INSUNITS[Number(pairs[ins + 1]?.[1])] ?? 1;

  // Entities, as code/value groups from each "0" to the next.
  const start = pairs.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  if (start < 0) return { crsName: null, paths, points, warnings: [...warnings, 'Found no ENTITIES section.'] };
  const ents: { type: string; groups: [number, string][] }[] = [];
  for (let i = start + 1; i < pairs.length; i++) {
    const [c, v] = pairs[i]!;
    if (c !== 0) {
      ents[ents.length - 1]?.groups.push([c, v]);
      continue;
    }
    if (v === 'ENDSEC') break;
    ents.push({ type: v, groups: [] });
  }

  const g = (e: { groups: [number, string][] }, code: number) => Number(e.groups.find(([c]) => c === code)?.[1] ?? 0);
  const at = (x: number, y: number): GridPoint => [x * unit, y * unit];
  let skippedInserts = 0;
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k]!;
    switch (e.type) {
      case 'LINE':
        paths.push([at(g(e, 10), g(e, 20)), at(g(e, 11), g(e, 21))]);
        break;
      case 'LWPOLYLINE': {
        const pts: GridPoint[] = [];
        let x: number | null = null;
        for (const [c, v] of e.groups) {
          if (c === 10) x = Number(v);
          else if (c === 20 && x != null) {
            pts.push(at(x, Number(v)));
            x = null;
          }
        }
        if (g(e, 70) & 1 && pts.length) pts.push(pts[0]!);
        if (pts.length > 1) paths.push(pts);
        break;
      }
      case 'POLYLINE': {
        const pts: GridPoint[] = [];
        const closed = (g(e, 70) & 1) === 1;
        while (ents[k + 1]?.type === 'VERTEX') {
          const v = ents[++k]!;
          pts.push(at(g(v, 10), g(v, 20)));
        }
        if (closed && pts.length) pts.push(pts[0]!);
        if (pts.length > 1) paths.push(pts);
        break;
      }
      case 'CIRCLE':
      case 'ARC': {
        const c = at(g(e, 10), g(e, 20));
        const r = g(e, 40) * unit;
        const a0 = e.type === 'ARC' ? (g(e, 50) * Math.PI) / 180 : 0;
        const a1 = e.type === 'ARC' ? (g(e, 51) * Math.PI) / 180 : 0;
        const p = (t: number): GridPoint => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
        paths.push(arcPoints(c, p(a0), p(a1), true, e.type === 'CIRCLE'));
        break;
      }
      case 'POINT':
        points.push({ name: '', at: at(g(e, 10), g(e, 20)) });
        break;
      case 'INSERT':
        skippedInserts++;
        break;
    }
  }
  if (skippedInserts) warnings.push(`${skippedInserts} block reference${skippedInserts === 1 ? ' is' : 's are'} not drawn.`);
  return { crsName: null, paths, points, warnings };
}
