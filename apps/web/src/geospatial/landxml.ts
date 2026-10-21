import { arcPoints, type GridPoint, type ParsedModel } from './model';
import { descendants, kid, kids, numbersOf, parseXml, type XmlElement } from './xml';

/**
 * LandXML (1.0–1.2): survey and civil design exchange. Coordinates are written northing first
 * ("N E [Z]"); CoordinateSystem names the grid. Read here: CgPoints, alignments, parcels and plan
 * features (lines, arcs, spirals, irregular lines), surface outlines and boundaries, and pipe
 * networks (pipes between structure centres).
 */

const FEET: Record<string, number> = { foot: 0.3048, ussurveyfoot: 1200 / 3937, internationalfoot: 0.3048 };

export function parseLandXml(text: string): ParsedModel {
  const doc = parseXml(text);
  const root = descendants(doc, 'LandXML')[0] ?? doc;
  const warnings: string[] = [];
  const paths: GridPoint[][] = [];
  const points: ParsedModel['points'] = [];

  const units = kid(root, 'Units');
  const imperial = kid(units, 'Imperial');
  const linear = (imperial?.attrs.linearUnit ?? kid(units, 'Metric')?.attrs.linearUnit ?? 'meter').toLowerCase().replace(/[^a-z]/g, '');
  const toMetres = imperial ? (FEET[linear] ?? 0.3048) : linear === 'millimeter' ? 0.001 : linear === 'centimeter' ? 0.01 : linear === 'kilometer' ? 1000 : 1;

  const cs = kid(root, 'CoordinateSystem') ?? descendants(root, 'CoordinateSystem')[0];
  const crsName = cs ? cs.attrs.epsgCode ? `EPSG:${cs.attrs.epsgCode}` : (cs.attrs.horizontalCoordinateSystemName || cs.attrs.name || cs.attrs.ogcWktCode || null) : null;
  if (!cs) warnings.push('The file names no coordinate system: choose the one its coordinates are in.');

  // "N E [Z]" → [E, N] in metres.
  const gridOf = (nums: readonly number[], at = 0): GridPoint | null => (nums.length >= at + 2 ? [nums[at + 1]! * toMetres, nums[at]! * toMetres] : null);
  const named = new Map<string, GridPoint>();
  for (const p of descendants(root, 'CgPoint')) {
    const at = gridOf(numbersOf(p.text));
    if (!at) continue;
    const name = p.attrs.name ?? p.attrs.oID ?? '';
    if (name) named.set(name, at);
    points.push({ name, at });
  }
  // A point element: its own coordinates, else the CgPoint it refers to.
  const pointOf = (el: XmlElement | undefined): GridPoint | null => {
    if (!el) return null;
    const own = gridOf(numbersOf(el.text));
    if (own) return own;
    const ref = el.attrs.pntRef;
    return ref ? (named.get(ref) ?? null) : null;
  };

  /** A CoordGeom's elements as one path (a new one wherever it does not join up). */
  const coordGeom = (cg: XmlElement) => {
    let path: GridPoint[] = [];
    const flush = () => {
      if (path.length > 1) paths.push(path);
      path = [];
    };
    const extend = (pts: GridPoint[]) => {
      if (pts.length < 2) return;
      const last = path[path.length - 1];
      if (last && Math.hypot(last[0] - pts[0]![0], last[1] - pts[0]![1]) < 1e-6) path.push(...pts.slice(1));
      else {
        flush();
        path = [...pts];
      }
    };
    for (const g of cg.children) {
      const start = pointOf(kid(g, 'Start'));
      const end = pointOf(kid(g, 'End'));
      if (g.name === 'Line' && start && end) extend([start, end]);
      else if (g.name === 'Curve' && start && end) {
        const c = pointOf(kid(g, 'Center'));
        extend(c ? arcPoints(c, start, end, (g.attrs.rot ?? 'ccw').toLowerCase() !== 'cw') : [start, end]);
      } else if (g.name === 'Spiral' && start && end) {
        // A spiral, drawn as the curve through its tangent intersection: close at drawing scales.
        const pi = pointOf(kid(g, 'PI'));
        extend(pi ? quadratic(start, pi, end) : [start, end]);
      } else if (g.name === 'IrregularLine' || g.name === 'Chain') {
        const list = kid(g, 'PntList2D') ?? kid(g, 'PntList3D');
        const dim = list?.name === 'PntList3D' ? 3 : 2;
        const nums = list ? numbersOf(list.text) : [];
        const pts: GridPoint[] = [];
        for (let k = 0; k + 1 < nums.length; k += dim) pts.push(gridOf(nums, k)!);
        extend(pts.length ? pts : [start, end].filter((p): p is GridPoint => !!p));
      }
    }
    flush();
  };

  for (const cg of descendants(root, 'CoordGeom')) coordGeom(cg);

  // Surfaces: the triangulation's outline (edges of one face only), and any boundaries given.
  for (const s of descendants(root, 'Surface')) {
    const def = kid(s, 'Definition');
    const pnts = new Map<string, GridPoint>();
    for (const p of kids(kid(def, 'Pnts'), 'P')) {
      const at = gridOf(numbersOf(p.text));
      if (at && p.attrs.id) pnts.set(p.attrs.id, at);
    }
    const edges = new Map<string, number>();
    for (const f of kids(kid(def, 'Faces'), 'F')) {
      if (f.attrs.i === '1') continue;
      const ids = f.text.trim().split(/\s+/);
      for (let k = 0; k < ids.length; k++) {
        const a = ids[k]!;
        const b = ids[(k + 1) % ids.length]!;
        const key = a < b ? `${a} ${b}` : `${b} ${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      if (count !== 1) continue;
      const [a, b] = key.split(' ');
      const pa = pnts.get(a!);
      const pb = pnts.get(b!);
      if (pa && pb) paths.push([pa, pb]);
    }
    for (const list of [...descendants(s, 'Boundary'), ...descendants(s, 'Breakline')].flatMap((b) => [...kids(b, 'PntList3D'), ...kids(b, 'PntList2D')])) {
      const dim = list.name === 'PntList3D' ? 3 : 2;
      const nums = numbersOf(list.text);
      const pts: GridPoint[] = [];
      for (let k = 0; k + 1 < nums.length; k += dim) pts.push(gridOf(nums, k)!);
      if (pts.length > 1) paths.push(pts);
    }
  }

  // Pipe networks: structures as points, pipes as lines between them.
  for (const net of descendants(root, 'PipeNetwork')) {
    const structs = new Map<string, GridPoint>();
    for (const st of descendants(net, 'Struct')) {
      const at = pointOf(kid(st, 'Center'));
      if (!at) continue;
      if (st.attrs.name) structs.set(st.attrs.name, at);
      points.push({ name: st.attrs.name ?? '', at });
    }
    for (const p of descendants(net, 'Pipe')) {
      const a = structs.get(p.attrs.refStart ?? '');
      const b = structs.get(p.attrs.refEnd ?? '');
      if (a && b) paths.push([a, b]);
    }
  }

  return { crsName, paths, points, warnings };
}

function quadratic(a: GridPoint, c: GridPoint, b: GridPoint, steps = 16): GridPoint[] {
  const out: GridPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}
