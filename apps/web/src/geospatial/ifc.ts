import type { GridPoint, ParsedModel } from './model';

/**
 * IFC (STEP physical file, ISO 10303-21), IFC4 and IFC4.3. The model is georeferenced by an
 * IfcMapConversion from its engineering coordinates to an IfcProjectedCRS; this reads that, then
 * draws each product's plan linework through its placements: curves (polylines, indexed poly
 * curves, trimmed lines and circles, composite curves), extrusion profiles, faceted and
 * tessellated surfaces' edges, mapped items, and IFC4.3 horizontal alignment segments.
 */

type Value = number | string | boolean | null | Ref | Typed | Enum | Value[];
class Ref {
  constructor(readonly id: number) {}
}
class Enum {
  constructor(readonly value: string) {}
}
class Typed {
  constructor(
    readonly type: string,
    readonly value: Value,
  ) {}
}
interface Entity {
  type: string;
  args: Value[];
}

// ---- STEP ------------------------------------------------------------------------------------

/** The file's DATA section as entities by instance number. */
export function parseStep(text: string): Map<number, Entity> {
  const out = new Map<number, Entity>();
  const data = text.search(/\bDATA\s*;/i);
  let i = data < 0 ? 0 : data;
  const n = text.length;
  while (i < n) {
    const hash = text.indexOf('#', i);
    if (hash < 0) break;
    // An instance: #id = TYPE ( args ) ;
    const m = /^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/.exec(text.slice(hash, hash + 80));
    if (!m) {
      i = hash + 1;
      continue;
    }
    const at = { i: hash + m[0].length };
    const args = parseList(text, at);
    out.set(Number(m[1]), { type: m[2]!.toUpperCase(), args });
    const semi = text.indexOf(';', at.i);
    i = semi < 0 ? n : semi + 1;
  }
  return out;
}

/** A parenthesised list's items, from just after its `(` to just after its `)`. */
function parseList(s: string, at: { i: number }): Value[] {
  const out: Value[] = [];
  for (;;) {
    skipSpace(s, at);
    const c = s[at.i];
    if (c === undefined) return out;
    if (c === ')') {
      at.i++;
      return out;
    }
    if (c === ',') {
      at.i++;
      continue;
    }
    out.push(parseValue(s, at));
  }
}

function skipSpace(s: string, at: { i: number }) {
  for (;;) {
    while (at.i < s.length && /\s/.test(s[at.i]!)) at.i++;
    if (s.startsWith('/*', at.i)) {
      const end = s.indexOf('*/', at.i + 2);
      at.i = end < 0 ? s.length : end + 2;
    } else return;
  }
}

function parseValue(s: string, at: { i: number }): Value {
  const c = s[at.i]!;
  if (c === '(') {
    at.i++;
    return parseList(s, at);
  }
  if (c === "'") {
    let out = '';
    at.i++;
    while (at.i < s.length) {
      const ch = s[at.i]!;
      if (ch === "'") {
        if (s[at.i + 1] === "'") {
          out += "'";
          at.i += 2;
          continue;
        }
        at.i++;
        break;
      }
      out += ch;
      at.i++;
    }
    return decodeStepString(out);
  }
  if (c === '#') {
    const m = /^#(\d+)/.exec(s.slice(at.i, at.i + 16))!;
    at.i += m[0].length;
    return new Ref(Number(m[1]));
  }
  if (c === '$' || c === '*') {
    at.i++;
    return null;
  }
  if (c === '.') {
    const end = s.indexOf('.', at.i + 1);
    const v = s.slice(at.i + 1, end);
    at.i = end + 1;
    return v === 'T' ? true : v === 'F' ? false : v === 'U' ? null : new Enum(v);
  }
  const num = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(at.i, at.i + 40));
  if (num) {
    at.i += num[0].length;
    return Number(num[0]);
  }
  const typed = /^([A-Za-z0-9_]+)\s*\(/.exec(s.slice(at.i, at.i + 80));
  if (typed) {
    at.i += typed[0].length;
    const inner = parseList(s, at);
    return new Typed(typed[1]!.toUpperCase(), inner.length === 1 ? inner[0]! : inner);
  }
  at.i++;
  return null;
}

/** STEP string escapes: \X2\…\X0\ (UTF-16 hex), \X\hh, \S\c. */
function decodeStepString(s: string): string {
  if (!s.includes('\\')) return s;
  return s
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, hex: string) => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))))
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, ch: string) => String.fromCharCode(ch.charCodeAt(0) + 128))
    .replace(/\\\\/g, '\\');
}

// ---- Geometry --------------------------------------------------------------------------------

type V3 = [number, number, number];
/** A placement: rotation columns x, y, z and origin o. */
interface Frame {
  x: V3;
  y: V3;
  z: V3;
  o: V3;
}
const IDENTITY: Frame = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], o: [0, 0, 0] };

const apply = (f: Frame, p: readonly number[]): V3 => {
  const [a, b, c = 0] = p as [number, number, number?];
  return [f.o[0] + f.x[0] * a + f.y[0] * b + f.z[0] * c, f.o[1] + f.x[1] * a + f.y[1] * b + f.z[1] * c, f.o[2] + f.x[2] * a + f.y[2] * b + f.z[2] * c];
};
const rotate = (f: Frame, v: V3): V3 => [f.x[0] * v[0] + f.y[0] * v[1] + f.z[0] * v[2], f.x[1] * v[0] + f.y[1] * v[1] + f.z[1] * v[2], f.x[2] * v[0] + f.y[2] * v[1] + f.z[2] * v[2]];
/** `outer` ∘ `inner`: a frame given in `outer`'s coordinates, in the world. */
const compose = (outer: Frame, inner: Frame): Frame => ({ x: rotate(outer, inner.x), y: rotate(outer, inner.y), z: rotate(outer, inner.z), o: apply(outer, inner.o) });

const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A frame from a Z axis and an approximate X direction (IFC's Axis/RefDirection). */
function frameOf(o: V3, z: V3 | null, ref: V3 | null): Frame {
  const zz = norm(z ?? [0, 0, 1]);
  let xx: V3 = ref ?? (Math.abs(zz[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const d = dot(xx, zz);
  xx = norm([xx[0] - d * zz[0], xx[1] - d * zz[1], xx[2] - d * zz[2]]);
  if (!Number.isFinite(xx[0]) || Math.hypot(...xx) < 0.5) xx = Math.abs(zz[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  return { x: xx, y: cross(zz, xx), z: zz, o };
}

export function parseIfc(text: string): ParsedModel {
  const ents = parseStep(text);
  const warnings: string[] = [];
  const paths: GridPoint[][] = [];
  const points: ParsedModel['points'] = [];
  const get = (v: Value | undefined): Entity | null => (v instanceof Ref ? (ents.get(v.id) ?? null) : null);
  const num = (v: Value | undefined): number | null => (typeof v === 'number' ? v : v instanceof Typed ? num(v.value) : null);
  const str = (v: Value | undefined): string | null => (typeof v === 'string' ? v : v instanceof Typed ? str(v.value) : null);
  const list = (v: Value | undefined): Value[] => (Array.isArray(v) ? v : []);
  const enumOf = (v: Value | undefined) => (v instanceof Enum ? v.value : null);

  const byType = (type: string) => [...ents.values()].filter((e) => e.type === type);

  // Units: the project's length unit (metres per unit), plane angle (radians per unit).
  const unitScale = (e: Entity | null, kind: string): number | null => {
    if (!e) return null;
    if (e.type === 'IFCSIUNIT' && enumOf(e.args[1]) === kind) return prefixScale(enumOf(e.args[2]));
    if (e.type === 'IFCCONVERSIONBASEDUNIT' && enumOf(e.args[1]) === kind) {
      const mwu = get(e.args[3]);
      const factor = num(mwu?.args[0]) ?? 1;
      return factor * (unitScale(get(mwu?.args[1]), kind) ?? 1);
    }
    return null;
  };
  const project = byType('IFCPROJECT')[0];
  const assignment = get(project?.args[8]) ?? byType('IFCUNITASSIGNMENT')[0] ?? null;
  const units = list(assignment?.args[0]).map(get);
  const lengthUnit = units.map((u) => unitScale(u, 'LENGTHUNIT')).find((s) => s != null) ?? 1;
  const angleUnit = units.map((u) => unitScale(u, 'PLANEANGLEUNIT')).find((s) => s != null) ?? 1;

  // Georeferencing.
  const conv = byType('IFCMAPCONVERSION')[0] ?? byType('IFCMAPCONVERSIONSCALED')[0];
  const crsEnt = get(conv?.args[1]);
  let crsName: string | null = null;
  let toGrid = (p: readonly number[]): GridPoint => [p[0]! * lengthUnit, p[1]! * lengthUnit];
  if (conv && crsEnt) {
    crsName = str(crsEnt.args[0]) ?? null;
    const zone = str(crsEnt.args[5]);
    if (crsName && zone && !/\d{4}/.test(crsName) && !/zone/i.test(crsName)) crsName = `${crsName} zone ${zone}`;
    const mapUnit = unitScale(get(crsEnt.args[6]), 'LENGTHUNIT') ?? 1;
    const e0 = num(conv.args[2]) ?? 0;
    const n0 = num(conv.args[3]) ?? 0;
    const ax = num(conv.args[5]) ?? 1;
    const ay = num(conv.args[6]) ?? 0;
    const l = Math.hypot(ax, ay) || 1;
    const [c, s] = [ax / l, ay / l];
    // Scale takes engineering units to map units; without one, the units' own ratio does.
    const scale = num(conv.args[7]) ?? lengthUnit / mapUnit;
    // IFC4.3's IfcMapConversionScaled adds a factor per axis (its drafts gave IfcMapConversion a ScaleY).
    const scaled = conv.type === 'IFCMAPCONVERSIONSCALED';
    const scaleX = scaled ? scale * (num(conv.args[8]) ?? 1) : scale;
    const scaleY = scaled ? scale * (num(conv.args[9]) ?? 1) : (num(conv.args[8]) ?? scale);
    toGrid = ([x, y]) => [(e0 + scaleX * (c * x! - s * y!)) * mapUnit, (n0 + scaleY * (s * x! + c * y!)) * mapUnit];
  } else {
    warnings.push('The model has no IfcMapConversion: its coordinates are taken as grid eastings and northings.');
  }

  // Placements.
  const point3 = (v: Value | undefined): V3 | null => {
    const e = get(v);
    if (!e) return null;
    const c = list(e.args[0]).map((x) => num(x) ?? 0);
    return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  };
  const dir3 = (v: Value | undefined): V3 | null => point3(v);
  const axisPlacement = (e: Entity | null): Frame => {
    if (!e) return IDENTITY;
    const o = point3(e.args[0]) ?? [0, 0, 0];
    if (e.type === 'IFCAXIS2PLACEMENT2D') {
      const r = dir3(e.args[1]);
      return frameOf(o, [0, 0, 1], r ? [r[0], r[1], 0] : null);
    }
    if (e.type === 'IFCAXIS2PLACEMENT3D') return frameOf(o, dir3(e.args[1]), dir3(e.args[2]));
    return { ...IDENTITY, o };
  };
  const placements = new Map<number, Frame>();
  let linear = false;
  const placementOf = (v: Value | undefined, depth = 0): Frame => {
    if (!(v instanceof Ref)) return IDENTITY;
    const done = placements.get(v.id);
    if (done) return done;
    const e = ents.get(v.id);
    let f = IDENTITY;
    if (e?.type === 'IFCLOCALPLACEMENT' && depth < 64) f = compose(placementOf(e.args[0], depth + 1), axisPlacement(get(e.args[1])));
    else if (e?.type === 'IFCLINEARPLACEMENT') {
      linear = true;
      // Placed along an alignment; its cached axis placement (IFC4.3) gives where.
      f = compose(placementOf(e.args[0], depth + 1), axisPlacement(get(e.args[2])));
    }
    placements.set(v.id, f);
    return f;
  };

  // Curves, as 2D/3D points in the item's own coordinates.
  const add = (frame: Frame, pts: readonly (readonly number[])[], closed = false) => {
    if (pts.length < 2) return;
    const out = pts.map((p) => toGrid(apply(frame, p)));
    if (closed) out.push(out[0]!);
    paths.push(out);
  };
  const pointList = (e: Entity | null): number[][] => (e ? list(e.args[0]).map((p) => list(p).map((x) => num(x) ?? 0)) : []);
  const cartesian = (v: Value | undefined): number[] | null => {
    const e = get(v);
    return e?.type === 'IFCCARTESIANPOINT' ? list(e.args[0]).map((x) => num(x) ?? 0) : null;
  };
  let skipped = new Set<string>();

  const curve = (e: Entity | null, depth = 0): number[][] => {
    if (!e || depth > 16) return [];
    switch (e.type) {
      case 'IFCPOLYLINE':
        return list(e.args[0]).flatMap((p) => {
          const c = cartesian(p);
          return c ? [c] : [];
        });
      case 'IFCINDEXEDPOLYCURVE': {
        const pts = pointList(get(e.args[0]));
        const segs = list(e.args[1]);
        if (!segs.length) return pts;
        const out: number[][] = [];
        for (const sg of segs) {
          if (!(sg instanceof Typed)) continue;
          const idx = list(Array.isArray(sg.value) ? sg.value : [sg.value]).map((x) => (num(x) ?? 1) - 1);
          const ps = idx.map((k) => pts[k]).filter((p): p is number[] => !!p);
          const run = sg.type === 'IFCARCINDEX' && ps.length === 3 ? arc3(ps[0]!, ps[1]!, ps[2]!) : ps;
          out.push(...(out.length ? run.slice(1) : run));
        }
        return out;
      }
      case 'IFCCOMPOSITECURVE':
      case 'IFCCOMPOSITECURVEONSURFACE':
        return list(e.args[0]).flatMap((s, k) => {
          const seg = get(s);
          const sub = seg?.type === 'IFCCOMPOSITECURVESEGMENT' ? curve(get(seg.args[2]), depth + 1) : [];
          const ordered = seg?.args[1] === false ? [...sub].reverse() : sub;
          if (seg?.type === 'IFCCURVESEGMENT') skipped.add('curve segments');
          return k ? ordered.slice(1) : ordered;
        });
      case 'IFCTRIMMEDCURVE':
        return trimmed(e, depth);
      case 'IFCCIRCLE': {
        const f = axisPlacement(get(e.args[0]));
        const r = num(e.args[1]) ?? 0;
        return Array.from({ length: 73 }, (_, k) => {
          const t = (k / 72) * 2 * Math.PI;
          return apply(f, [r * Math.cos(t), r * Math.sin(t)]);
        });
      }
      case 'IFCELLIPSE': {
        const f = axisPlacement(get(e.args[0]));
        const [a, b] = [num(e.args[1]) ?? 0, num(e.args[2]) ?? 0];
        return Array.from({ length: 73 }, (_, k) => {
          const t = (k / 72) * 2 * Math.PI;
          return apply(f, [a * Math.cos(t), b * Math.sin(t)]);
        });
      }
      default:
        skipped.add(e.type.slice(3).toLowerCase());
        return [];
    }
  };

  const trimmed = (e: Entity, depth: number): number[][] => {
    const basis = get(e.args[0]);
    const trimPoint = (v: Value | undefined) => list(v).map(cartesian).find((p) => p) ?? null;
    const trimParam = (v: Value | undefined) => {
      for (const t of list(v)) if (t instanceof Typed && t.type === 'IFCPARAMETERVALUE') return num(t.value);
      return null;
    };
    const sense = e.args[3] !== false;
    if (basis?.type === 'IFCLINE') {
      const p0 = cartesian(basis.args[0]) ?? [0, 0, 0];
      const vec = get(basis.args[1]);
      const d = point3(vec?.args[0]) ?? [1, 0, 0];
      const mag = num(vec?.args[1]) ?? 1;
      const at = (t: number) => p0.map((c, k) => c + (d[k] ?? 0) * mag * t);
      const a = trimPoint(e.args[1]) ?? at(trimParam(e.args[1]) ?? 0);
      const b = trimPoint(e.args[2]) ?? at(trimParam(e.args[2]) ?? 1);
      return [a, b];
    }
    if (basis?.type === 'IFCCIRCLE') {
      const f = axisPlacement(get(basis.args[0]));
      const r = num(basis.args[1]) ?? 0;
      const local = (p: number[]): number => {
        const v: V3 = [p[0]! - f.o[0], p[1]! - f.o[1], (p[2] ?? 0) - f.o[2]];
        return Math.atan2(dot(v, f.y), dot(v, f.x));
      };
      const angleOf = (v: Value | undefined) => {
        const p = trimPoint(v);
        if (p) return local(p);
        const t = trimParam(v);
        return t == null ? null : t * angleUnit;
      };
      const t0 = angleOf(e.args[1]) ?? 0;
      let t1 = angleOf(e.args[2]) ?? 2 * Math.PI;
      if (sense) while (t1 <= t0) t1 += 2 * Math.PI;
      else while (t1 >= t0) t1 -= 2 * Math.PI;
      const steps = Math.max(2, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 36)));
      return Array.from({ length: steps + 1 }, (_, k) => {
        const t = t0 + ((t1 - t0) * k) / steps;
        return apply(f, [r * Math.cos(t), r * Math.sin(t)]);
      });
    }
    return curve(basis, depth + 1);
  };

  const profile = (e: Entity | null, frame: Frame) => {
    if (!e) return;
    switch (e.type) {
      case 'IFCRECTANGLEPROFILEDEF': {
        const f = compose(frame, axisPlacement(get(e.args[2])));
        const [w, h] = [(num(e.args[3]) ?? 0) / 2, (num(e.args[4]) ?? 0) / 2];
        add(f, [[-w, -h], [w, -h], [w, h], [-w, h]], true);
        return;
      }
      case 'IFCCIRCLEPROFILEDEF':
      case 'IFCCIRCLEHOLLOWPROFILEDEF': {
        const f = compose(frame, axisPlacement(get(e.args[2])));
        const r = num(e.args[3]) ?? 0;
        add(f, Array.from({ length: 49 }, (_, k) => [r * Math.cos((k / 48) * 2 * Math.PI), r * Math.sin((k / 48) * 2 * Math.PI)]));
        return;
      }
      case 'IFCARBITRARYCLOSEDPROFILEDEF':
      case 'IFCARBITRARYOPENPROFILEDEF':
        add(frame, curve(get(e.args[2])));
        return;
      case 'IFCARBITRARYPROFILEDEFWITHVOIDS':
        add(frame, curve(get(e.args[2])));
        for (const v of list(e.args[3])) add(frame, curve(get(v)));
        return;
      default:
        skipped.add(e.type.slice(3).toLowerCase());
    }
  };

  const faces = (frame: Frame, loops: number[][][]) => {
    // Each edge once, and vertical edges (a point in plan) left out.
    const seen = new Set<string>();
    for (const loop of loops) {
      for (let k = 0; k < loop.length; k++) {
        const a = apply(frame, loop[k]!);
        const b = apply(frame, loop[(k + 1) % loop.length]!);
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) continue;
        const key = [a, b]
          .map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`)
          .sort()
          .join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        paths.push([toGrid(a), toGrid(b)]);
      }
    }
  };

  const shellLoops = (shell: Entity | null): number[][][] =>
    list(shell?.args[0]).flatMap((fv) =>
      list(get(fv)?.args[0]).flatMap((bv) => {
        const loop = get(get(bv)?.args[0]);
        return loop?.type === 'IFCPOLYLOOP' ? [list(loop.args[0]).map((p) => cartesian(p) ?? [0, 0, 0])] : [];
      }),
    );

  const item = (e: Entity | null, frame: Frame, depth = 0) => {
    if (!e || depth > 8) return;
    switch (e.type) {
      case 'IFCEXTRUDEDAREASOLID':
      case 'IFCEXTRUDEDAREASOLIDTAPERED':
        profile(get(e.args[0]), compose(frame, axisPlacement(get(e.args[1]))));
        return;
      case 'IFCREVOLVEDAREASOLID':
        profile(get(e.args[0]), compose(frame, axisPlacement(get(e.args[1]))));
        return;
      case 'IFCFACETEDBREP':
        faces(frame, shellLoops(get(e.args[0])));
        return;
      case 'IFCSHELLBASEDSURFACEMODEL':
      case 'IFCFACEBASEDSURFACEMODEL':
        for (const s of list(e.args[0])) faces(frame, shellLoops(get(s)));
        return;
      case 'IFCTRIANGULATEDFACESET':
      case 'IFCPOLYGONALFACESET': {
        const coords = pointList(get(e.args[0]));
        const pn = list(e.args[e.type === 'IFCTRIANGULATEDFACESET' ? 4 : 3]).map((x) => num(x) ?? 0);
        const pt = (k: number) => coords[(pn.length ? (pn[k - 1] ?? k) : k) - 1] ?? [0, 0, 0];
        const loops =
          e.type === 'IFCTRIANGULATEDFACESET'
            ? list(e.args[3]).map((t) => list(t).map((k) => pt(num(k) ?? 1)))
            : list(e.args[2]).map((f) => list(get(f)?.args[0]).map((k) => pt(num(k) ?? 1)));
        faces(frame, loops);
        return;
      }
      case 'IFCMAPPEDITEM': {
        const source = get(e.args[0]);
        const target = get(e.args[1]);
        const origin = axisPlacement(get(source?.args[0]));
        const op = cartesianOperator(target);
        const f = compose(compose(frame, op), origin);
        for (const it of list(get(source?.args[1])?.args[3])) item(get(it), f, depth + 1);
        return;
      }
      case 'IFCBOOLEANRESULT':
      case 'IFCBOOLEANCLIPPINGRESULT':
        item(get(e.args[1]), frame, depth + 1);
        return;
      case 'IFCGEOMETRICSET':
      case 'IFCGEOMETRICCURVESET':
        for (const el of list(e.args[0])) item(get(el), frame, depth + 1);
        return;
      case 'IFCCARTESIANPOINT':
        return;
      default:
        add(frame, curve(e));
    }
  };

  const cartesianOperator = (e: Entity | null): Frame => {
    if (!e) return IDENTITY;
    const x = dir3(e.args[0]);
    const y = dir3(e.args[1]);
    const o = point3(e.args[2]) ?? [0, 0, 0];
    const s = num(e.args[3]) ?? 1;
    const z = e.type.includes('3D') ? dir3(e.args[4]) : null;
    const f = frameOf(o, z ?? (x && y ? cross(x, y) : [0, 0, 1]), x);
    const sy = e.type.includes('NONUNIFORM') ? (num(e.type.includes('3D') ? e.args[5] : e.args[4]) ?? s) : s;
    const sz = e.type.includes('NONUNIFORM') && e.type.includes('3D') ? (num(e.args[6]) ?? s) : s;
    return { x: f.x.map((c) => c * s) as V3, y: f.y.map((c) => c * sy) as V3, z: f.z.map((c) => c * sz) as V3, o };
  };

  // Alignments (IFC4.3): horizontal segments, drawn from their own parameters.
  const nestedBy = new Map<number, number>();
  for (const rel of byType('IFCRELNESTS')) {
    const parent = rel.args[4];
    if (parent instanceof Ref) for (const c of list(rel.args[5])) if (c instanceof Ref) nestedBy.set(c.id, parent.id);
  }
  const alignmentFrame = (id: number): Frame => {
    for (let at: number | undefined = id, k = 0; at != null && k < 8; at = nestedBy.get(at), k++) {
      const e = ents.get(at);
      if (e?.type === 'IFCALIGNMENT') return placementOf(e.args[5]);
    }
    return IDENTITY;
  };
  const horizontal = [...ents.entries()].filter(([, e]) => e.type === 'IFCALIGNMENTHORIZONTALSEGMENT');
  // Each segment's IfcAlignmentSegment, which holds it as its design parameters.
  const holders = new Map<number, number>();
  for (const [id, a] of ents) if (a.type === 'IFCALIGNMENTSEGMENT' && a.args[7] instanceof Ref) holders.set(a.args[7].id, id);
  for (const [id, e] of horizontal) {
    const start = cartesian(e.args[2]);
    if (!start) continue;
    const frame = alignmentFrame(holders.get(id) ?? id);
    add(frame, horizontalSegment(start, (num(e.args[3]) ?? 0) * angleUnit, num(e.args[4]) ?? 0, num(e.args[5]) ?? 0, num(e.args[6]) ?? 0, enumOf(e.args[8]) ?? 'LINE'));
  }

  // Products: each one's representation items, at its placement.
  for (const e of ents.values()) {
    const rep = get(e.args[6]);
    if (rep?.type !== 'IFCPRODUCTDEFINITIONSHAPE') continue;
    // With business-logic segments drawn, an alignment's own curve would draw them twice.
    if (horizontal.length && (e.type === 'IFCALIGNMENT' || e.type.startsWith('IFCALIGNMENT'))) continue;
    const frame = placementOf(e.args[5]);
    const reps = list(rep.args[2]).map(get).filter((r): r is Entity => !!r);
    // Plan linework where the product has it, else its body.
    const plan = reps.filter((r) => ['FootPrint', 'Axis', 'Annotation', 'Plan', 'Profile'].includes(str(r.args[1]) ?? ''));
    for (const r of plan.length ? plan : reps.filter((x) => str(x.args[1]) !== 'Box')) for (const it of list(r.args[3])) item(get(it), frame);
  }

  // Annotation points and survey points: IfcAnnotation with a single point, and named IfcGeographicElement origins.
  for (const e of byType('IFCANNOTATION')) {
    const rep = get(e.args[6]);
    for (const r of list(rep?.args[2]).map(get)) {
      for (const it of list(r?.args[3]).map(get)) {
        if (it?.type !== 'IFCCARTESIANPOINT') continue;
        const at = apply(placementOf(e.args[5]), list(it.args[0]).map((x) => num(x) ?? 0));
        points.push({ name: str(e.args[2]) ?? '', at: toGrid(at) });
      }
    }
  }

  if (linear) warnings.push('Some elements are placed along an alignment (IfcLinearPlacement); they are drawn at their cached placement.');
  skipped = new Set([...skipped].filter((s) => s && s !== 'cartesianpoint'));
  if (skipped.size) warnings.push(`Not drawn: ${[...skipped].slice(0, 6).join(', ')}${skipped.size > 6 ? '…' : ''}.`);
  return { crsName, paths, points, warnings };
}

function prefixScale(prefix: string | null): number {
  const p: Record<string, number> = { MILLI: 1e-3, CENTI: 1e-2, DECI: 1e-1, DECA: 1e1, HECTO: 1e2, KILO: 1e3, MICRO: 1e-6 };
  return prefix ? (p[prefix] ?? 1) : 1;
}

/** Points along the circular arc through three points. */
function arc3(a: number[], m: number[], b: number[]): number[][] {
  const [ax, ay] = a as [number, number];
  const [mx, my] = m as [number, number];
  const [bx, by] = b as [number, number];
  const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
  if (Math.abs(d) < 1e-12) return [a, b];
  const ux = ((ax * ax + ay * ay) * (my - by) + (mx * mx + my * my) * (by - ay) + (bx * bx + by * by) * (ay - my)) / d;
  const uy = ((ax * ax + ay * ay) * (bx - mx) + (mx * mx + my * my) * (ax - bx) + (bx * bx + by * by) * (mx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const t0 = Math.atan2(ay - uy, ax - ux);
  const tm = Math.atan2(my - uy, mx - ux);
  const t1 = Math.atan2(by - uy, bx - ux);
  // Counter-clockwise when the middle point lies on the way from t0 to t1 going that way.
  const ccw = (x: number) => (((x - t0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = ccw(tm) < ccw(t1) ? ccw(t1) : ccw(t1) - 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = t0 + (sweep * k) / steps;
    return [ux + r * Math.cos(t), uy + r * Math.sin(t)];
  });
}

/**
 * A horizontal alignment segment (IfcAlignmentHorizontalSegment): from its start point and
 * direction, curvature going linearly from 1/start radius to 1/end radius over its length (exact
 * for lines, arcs and clothoids; close for the other transition curves). Radius 0 is straight;
 * positive radii turn left.
 */
export function horizontalSegment(start: readonly number[], dir: number, r0: number, r1: number, length: number, type: string): number[][] {
  const k0 = r0 ? 1 / r0 : 0;
  const k1 = type === 'CIRCULARARC' ? k0 : r1 ? 1 / r1 : 0;
  const L = Math.abs(length);
  const steps = type === 'LINE' || (k0 === 0 && k1 === 0) ? 1 : Math.max(4, Math.min(512, Math.ceil(L / 2)));
  const heading = (s: number) => dir + k0 * s + ((k1 - k0) * s * s) / (2 * (L || 1));
  const out: number[][] = [[start[0]!, start[1]!]];
  let [x, y] = [start[0]!, start[1]!];
  const h = L / steps;
  for (let i = 0; i < steps; i++) {
    // Simpson's rule over each step.
    const [s0, sm, s1] = [i * h, (i + 0.5) * h, (i + 1) * h];
    x += (h / 6) * (Math.cos(heading(s0)) + 4 * Math.cos(heading(sm)) + Math.cos(heading(s1)));
    y += (h / 6) * (Math.sin(heading(s0)) + 4 * Math.sin(heading(sm)) + Math.sin(heading(s1)));
    out.push([x, y]);
  }
  return out;
}
