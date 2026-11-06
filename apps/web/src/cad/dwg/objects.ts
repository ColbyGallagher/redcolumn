import { CadReadError } from '../dxf';
import { BitReader, R2004, R2007, R2010, R2013, R2018, stringStream, type Color } from './bits';

/**
 * DWG objects (ODA spec 20): the common object and entity data, then each type's own fields.
 * Each object comes out as a plain record of DXF-style group codes, so the DXF renderer can draw
 * it; handles stay numbers until the drawing is assembled.
 */

export type G = [number, string][];

export interface EntRec {
  kind: 'entity';
  type: string;
  handle: number;
  /** 0 owned by `owner`, 1 paper space, 2 model space. */
  mode: number;
  owner: number;
  layer: number;
  /** 0 BYLAYER, 1 BYBLOCK, 2 CONTINUOUS, 3 by handle. */
  ltFlags: number;
  ltype: number;
  color: Color;
  ltscale: number;
  invisible: boolean;
  /** Hundredths of a mm; -1 BYLAYER, -2 BYBLOCK, -3 DEFAULT. */
  lineweight: number;
  /** R2000 entity chain. */
  next: number;
  extrusion: [number, number, number];
  g: G;
  /** Handles this entity refers to, by role. */
  refs: { style?: number; block?: number; imageDef?: number; frozen?: number[]; boundary?: number; owned?: number[]; first?: number; last?: number };
  name?: string;
}

export interface ObjRec {
  kind: 'object';
  type: string;
  handle: number;
  owner: number;
  data: Record<string, unknown>;
}

export type Rec = EntRec | ObjRec;

const FIXED: Record<number, string> = {
  1: 'TEXT',
  2: 'ATTRIB',
  3: 'ATTDEF',
  4: 'BLOCK',
  5: 'ENDBLK',
  6: 'SEQEND',
  7: 'INSERT',
  8: 'MINSERT',
  10: 'VERTEX_2D',
  11: 'VERTEX_3D',
  12: 'VERTEX_MESH',
  13: 'VERTEX_PFACE',
  14: 'VERTEX_PFACE_FACE',
  15: 'POLYLINE_2D',
  16: 'POLYLINE_3D',
  17: 'ARC',
  18: 'CIRCLE',
  19: 'LINE',
  20: 'DIMENSION_ORDINATE',
  21: 'DIMENSION_LINEAR',
  22: 'DIMENSION_ALIGNED',
  23: 'DIMENSION_ANG_3PT',
  24: 'DIMENSION_ANG_2LN',
  25: 'DIMENSION_RADIUS',
  26: 'DIMENSION_DIAMETER',
  27: 'POINT',
  28: '3DFACE',
  29: 'POLYLINE_PFACE',
  30: 'POLYLINE_MESH',
  31: 'SOLID',
  32: 'TRACE',
  33: 'SHAPE',
  34: 'VIEWPORT',
  35: 'ELLIPSE',
  36: 'SPLINE',
  37: 'REGION',
  38: '3DSOLID',
  39: 'BODY',
  40: 'RAY',
  41: 'XLINE',
  42: 'DICTIONARY',
  43: 'OLEFRAME',
  44: 'MTEXT',
  45: 'LEADER',
  46: 'TOLERANCE',
  47: 'MLINE',
  48: 'BLOCK_CONTROL',
  49: 'BLOCK_HEADER',
  50: 'LAYER_CONTROL',
  51: 'LAYER',
  52: 'STYLE_CONTROL',
  53: 'STYLE',
  56: 'LTYPE_CONTROL',
  57: 'LTYPE',
  60: 'VIEW_CONTROL',
  61: 'VIEW',
  62: 'UCS_CONTROL',
  63: 'UCS',
  64: 'VPORT_CONTROL',
  65: 'VPORT',
  66: 'APPID_CONTROL',
  67: 'APPID',
  68: 'DIMSTYLE_CONTROL',
  69: 'DIMSTYLE',
  70: 'VP_ENT_HDR_CONTROL',
  71: 'VP_ENT_HDR',
  72: 'GROUP',
  73: 'MLINESTYLE',
  74: 'OLE2FRAME',
  77: 'LWPOLYLINE',
  78: 'HATCH',
  79: 'XRECORD',
  80: 'ACDBPLACEHOLDER',
  82: 'LAYOUT',
};

/** Types whose fields we read; any other is recorded by type only (and reported if it draws). */
const ENTITY_TYPES = new Set([
  'TEXT', 'ATTRIB', 'ATTDEF', 'BLOCK', 'ENDBLK', 'SEQEND', 'INSERT', 'MINSERT', 'VERTEX_2D', 'VERTEX_3D', 'VERTEX_MESH', 'VERTEX_PFACE', 'VERTEX_PFACE_FACE',
  'POLYLINE_2D', 'POLYLINE_3D', 'POLYLINE_PFACE', 'POLYLINE_MESH', 'ARC', 'CIRCLE', 'LINE', 'DIMENSION_ORDINATE', 'DIMENSION_LINEAR', 'DIMENSION_ALIGNED',
  'DIMENSION_ANG_3PT', 'DIMENSION_ANG_2LN', 'DIMENSION_RADIUS', 'DIMENSION_DIAMETER', 'ARC_DIMENSION', 'POINT', '3DFACE', 'SOLID', 'TRACE', 'SHAPE', 'VIEWPORT',
  'ELLIPSE', 'SPLINE', 'REGION', '3DSOLID', 'BODY', 'RAY', 'XLINE', 'OLEFRAME', 'MTEXT', 'LEADER', 'TOLERANCE', 'MLINE', 'OLE2FRAME', 'LWPOLYLINE', 'HATCH',
  'IMAGE', 'WIPEOUT', 'MULTILEADER', 'ACAD_TABLE', 'ACAD_PROXY_ENTITY', 'MESH', 'SURFACE', 'PLANESURFACE', 'UNDERLAY', 'PDFUNDERLAY', 'DWFUNDERLAY', 'DGNUNDERLAY',
]);

const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
export function lineweightOf(index: number): number {
  if (index === 28 || index === 29) return -1;
  if (index === 30) return -2;
  if (index === 31) return -3;
  return LW[index] ?? -3;
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const f = (n: number) => String(n);

/** The streams of one object: data, strings (R2007+: their own), handles. */
class Obj {
  t: BitReader;
  h: BitReader;
  handle = 0;
  constructor(
    readonly d: BitReader,
    readonly version: number,
    /** Bit position where the object's data starts (after its size, and handle size from R2010). */
    readonly start: number,
    /** R2010+: where the handle stream starts. */
    handleStart: number | null,
  ) {
    this.t = d;
    this.h = d.clone(handleStart ?? d.pos);
    if (handleStart !== null) this.t = stringStream(d, handleStart - 1) ?? d.clone(d.end);
  }
  /** R2000–R2007: the data size (in bits) locates the handle stream (and R2007's strings). */
  dataSize() {
    if (this.version < R2010) {
      const size = this.d.RL();
      this.h = this.d.clone(this.start + size);
      if (this.version === R2007) this.t = stringStream(this.d, this.start + size - 1) ?? this.d.clone(this.d.end);
    }
  }
  TV() {
    if (this.version >= R2007 && this.t.pos >= this.t.end) return '';
    return this.t.TV();
  }
  H(ref = 0) {
    return this.h.H(ref);
  }
  /** Handle relative to this object's own handle (owner, reactors and similar). */
  Hr() {
    return this.h.H(this.handle);
  }
}
export interface ReadContext {
  version: number;
  classes: Map<number, string>;
  decoder: TextDecoder;
}

/** Reads the object at byte `offset` of `buf`. */
export function readObject(buf: Uint8Array, offset: number, ctx: ReadContext): Rec | null {
  const { version } = ctx;
  const head = new BitReader(buf, version, ctx.decoder);
  head.bytePos = offset;
  const size = head.MS();
  if (size <= 0) return null;
  let handleStart: number | null = null;
  if (version >= R2010) {
    const handleBits = head.MC();
    handleStart = head.pos + size * 8 - handleBits;
  }
  const start = head.pos;
  const d = head.clone(start);
  const o = new Obj(d, version, start, handleStart);
  const code = d.OT();
  const type = code >= 500 ? (ctx.classes.get(code) ?? `CLASS_${code}`) : (FIXED[code] ?? `TYPE_${code}`);
  const norm = type === 'LWPLINE' ? 'LWPOLYLINE' : type;

  if (ENTITY_TYPES.has(norm)) return readEntity(o, norm);
  switch (norm) {
    case 'LAYER':
    case 'LTYPE':
    case 'STYLE':
    case 'BLOCK_HEADER':
    case 'LAYOUT':
    case 'IMAGEDEF':
    case 'VPORT':
      return readTableObject(o, norm);
    default:
      return { kind: 'object', type: norm, handle: 0, owner: 0, data: {} };
  }
}

function common(o: Obj) {
  o.dataSize();
  o.handle = o.d.H();
  // Extended data: size, application handle, then that many bytes.
  for (let size = o.d.BS(); size !== 0; size = o.d.BS()) {
    o.d.H();
    o.d.skipBytes(size);
  }
}

function reactorsAndXdic(o: Obj) {
  const n = o.d.BL();
  for (let i = 0; i < n; i++) o.Hr();
  const missing = o.version >= R2004 ? o.d.B() : 0;
  if (!missing) o.Hr();
  if (o.version >= R2013) o.d.B();
}

/** An entity's own properties after its handle and extended data (the spec's "entity mode" onwards). */
function entityMode(o: Obj) {
  const d = o.d;
  const mode = d.BB();
  const owner = mode === 0 ? o.Hr() : 0;
  reactorsAndXdic(o);
  let next = 0;
  if (o.version < R2004) {
    if (!d.B()) {
      o.Hr();
      next = o.Hr();
    } else next = o.handle + 1;
  }
  const color = d.ENC();
  if (o.version >= R2004 && color.book) o.H();
  const ltscale = d.BD();
  const layer = o.H();
  const ltFlags = d.BB();
  const ltype = ltFlags === 3 ? o.H() : 0;
  if (o.version >= R2007) {
    if (d.BB() === 3) o.H();
    d.RC();
  }
  if (d.BB() === 3) o.H();
  if (o.version >= R2010) {
    if (d.B()) o.H();
    if (d.B()) o.H();
    if (d.B()) o.H();
  }
  const invisible = (d.BS() & 1) === 1;
  const lineweight = lineweightOf(d.RC());
  return { mode, owner, next, color, ltscale, layer, ltFlags, ltype, invisible, lineweight };
}

function readEntity(o: Obj, type: string): EntRec {
  const d = o.d;
  common(o);
  if (d.B()) {
    const n = o.version >= R2010 ? d.BLL() : d.RL();
    d.skipBytes(n);
  }
  const { mode, owner, next, color, ltscale, layer, ltFlags, ltype, invisible, lineweight } = entityMode(o);
  const e: EntRec = {
    kind: 'entity',
    type,
    handle: o.handle,
    mode,
    owner,
    layer,
    ltFlags,
    ltype,
    color,
    ltscale: ltscale || 1,
    invisible,
    lineweight,
    next,
    extrusion: [0, 0, 1],
    g: [],
    refs: {},
  };
  entityData(o, e);
  return e;
}

const push = (g: G, code: number, v: number | string) => g.push([code, typeof v === 'number' ? f(v) : v]);
const pt2 = (g: G, code: number, p: readonly number[]) => {
  push(g, code, p[0]!);
  push(g, code + 10, p[1]!);
};

function entityData(o: Obj, e: EntRec) {
  const d = o.d;
  const g = e.g;
  const v = o.version;
  switch (e.type) {
    case 'LINE': {
      const zz = d.B();
      const sx = d.RD();
      const ex = d.DD(sx);
      const sy = d.RD();
      const ey = d.DD(sy);
      if (!zz) {
        const sz = d.RD();
        d.DD(sz);
      }
      d.BT();
      e.extrusion = d.BE();
      pt2(g, 10, [sx, sy]);
      pt2(g, 11, [ex, ey]);
      return;
    }
    case 'CIRCLE':
    case 'ARC': {
      const c = d.BD3();
      const r = d.BD();
      d.BT();
      e.extrusion = d.BE();
      pt2(g, 10, c);
      push(g, 40, r);
      if (e.type === 'ARC') {
        push(g, 50, deg(d.BD()));
        push(g, 51, deg(d.BD()));
      }
      return;
    }
    case 'ELLIPSE': {
      const c = d.BD3();
      const maj = d.BD3();
      e.extrusion = d.BD3();
      pt2(g, 10, c);
      pt2(g, 11, maj);
      push(g, 40, d.BD());
      push(g, 41, d.BD());
      push(g, 42, d.BD());
      return;
    }
    case 'POINT': {
      const p = d.BD3();
      d.BT();
      e.extrusion = d.BE();
      d.BD();
      pt2(g, 10, p);
      return;
    }
    case 'SOLID':
    case 'TRACE': {
      d.BT();
      d.BD();
      const pts = [d.RD2(), d.RD2(), d.RD2(), d.RD2()];
      e.extrusion = d.BE();
      pts.forEach((p, i) => pt2(g, 10 + i, p));
      return;
    }
    case '3DFACE': {
      const noFlags = d.B();
      const zZero = d.B();
      const p1 = [d.RD(), d.RD(), zZero ? 0 : d.RD()];
      const p2 = d.DD3(p1);
      const p3 = d.DD3(p2);
      const p4 = d.DD3(p3);
      if (!noFlags) d.BS();
      [p1, p2, p3, p4].forEach((p, i) => pt2(g, 10 + i, p));
      return;
    }
    case 'LWPOLYLINE': {
      const flags = d.BS();
      let width = 0;
      if (flags & 4) width = d.BD();
      if (flags & 8) d.BD();
      if (flags & 2) d.BD();
      if (flags & 1) e.extrusion = d.BD3();
      const n = d.BL();
      const nb = flags & 0x10 ? d.BL() : 0;
      const ni = flags & 0x400 ? d.BL() : 0;
      const nw = flags & 0x20 ? d.BL() : 0;
      guard(n + nb + ni + nw);
      const verts: number[][] = [];
      if (n > 0) {
        let p = d.RD2();
        verts.push(p);
        for (let j = 1; j < n; j++) verts.push((p = d.DD2(p)));
      }
      const bulges: number[] = [];
      for (let k = 0; k < nb; k++) bulges.push(d.BD());
      for (let k = 0; k < ni; k++) d.BL();
      for (let k = 0; k < nw; k++) {
        d.BD();
        d.BD();
      }
      push(g, 70, (flags & 0x200 ? 1 : 0) | (flags & 0x100 ? 128 : 0));
      if (width) push(g, 43, width);
      verts.forEach((p, i) => {
        pt2(g, 10, p);
        if (bulges[i]) push(g, 42, bulges[i]!);
      });
      return;
    }
    case 'POLYLINE_2D': {
      const flags = d.BS();
      d.BS();
      const sw = d.BD();
      d.BD();
      d.BT();
      d.BD();
      e.extrusion = d.BE();
      push(g, 70, flags);
      if (sw) push(g, 40, sw);
      children(o, e);
      return;
    }
    case 'POLYLINE_3D': {
      const sf = d.RC();
      const closed = d.RC() & 1;
      push(g, 70, 8 | closed | (sf & 3 ? 4 : 0));
      children(o, e);
      return;
    }
    case 'POLYLINE_PFACE':
      // Vertex and face counts, then its vertices and face records.
      d.BS();
      d.BS();
      children(o, e);
      return;
    case 'VERTEX_PFACE_FACE':
      // Face record: up to four 1-based vertex indexes; negative hides the edge from that vertex.
      push(g, 70, 128);
      for (let k = 0; k < 4; k++) push(g, 71 + k, d.BS());
      return;
    case 'POLYLINE_MESH':
      return;
    case 'VERTEX_2D': {
      const flags = d.RC();
      const p = d.BD3();
      const w = d.BD();
      if (w >= 0) d.BD();
      const bulge = d.BD();
      if (v >= R2010) d.BL();
      d.BD();
      push(g, 70, flags);
      pt2(g, 10, p);
      if (bulge) push(g, 42, bulge);
      return;
    }
    case 'VERTEX_3D':
    case 'VERTEX_MESH':
    case 'VERTEX_PFACE': {
      const flags = d.RC();
      // A polyface's vertices are positions (64 | 128 in DXF terms), whatever the byte says.
      push(g, 70, e.type === 'VERTEX_PFACE' ? 192 : flags);
      pt2(g, 10, d.BD3());
      return;
    }
    case 'SPLINE': {
      let scenario = d.BL();
      let closed = false;
      if (v >= R2013) {
        const flags1 = d.BL();
        const knotParam = d.BL();
        closed = (flags1 & 4) !== 0;
        // Control points unless the knots come from fit points (flag 8, non-custom parametrization).
        scenario = knotParam === 15 || (flags1 & 8) === 0 ? 1 : 2;
      }
      const degree = d.BL();
      let nf = 0;
      let nk = 0;
      let nc = 0;
      let weighted = false;
      if (scenario === 1) {
        d.B();
        closed = d.B() === 1 || closed;
        d.B();
        d.BD();
        d.BD();
        nk = d.BL();
        nc = d.BL();
        weighted = d.B() === 1;
      } else {
        d.BD();
        d.BD3();
        d.BD3();
        nf = d.BL();
      }
      guard(nk + nc + nf);
      push(g, 70, closed ? 1 : 0);
      push(g, 71, degree);
      for (let k = 0; k < nk; k++) push(g, 40, d.BD());
      for (let k = 0; k < nc; k++) {
        pt2(g, 10, d.BD3());
        if (weighted) push(g, 41, d.BD());
      }
      for (let k = 0; k < nf; k++) pt2(g, 11, d.BD3());
      return;
    }
    case 'TEXT':
    case 'ATTRIB':
    case 'ATTDEF':
      return text(o, e);
    case 'MTEXT':
      return mtext(o, e);
    case 'INSERT':
    case 'MINSERT':
    case 'ACAD_TABLE': {
      // A table starts as an insert of the anonymous block that draws it; the cell data after
      // that is not needed to plot it.
      const p = d.BD3();
      let sx = 1;
      let sy = 1;
      switch (d.BB()) {
        case 0:
          sx = d.RD();
          sy = d.DD(sx);
          d.DD(sx);
          break;
        case 1:
          sy = d.DD(1);
          d.DD(1);
          break;
        case 2:
          sx = sy = d.RD();
          break;
      }
      const rot = d.BD();
      e.extrusion = d.BD3();
      const hasAtts = d.B();
      const owned = v >= R2004 && hasAtts ? d.BL() : 0;
      guard(owned);
      let cols = 1;
      let rows = 1;
      let cs = 0;
      let rs = 0;
      if (e.type === 'MINSERT') {
        cols = d.BS();
        rows = d.BS();
        cs = d.BD();
        rs = d.BD();
      }
      e.refs.block = o.H();
      if (hasAtts) {
        if (v < R2004) {
          e.refs.first = o.H();
          e.refs.last = o.H();
        } else e.refs.owned = Array.from({ length: owned }, () => o.H());
        o.H(); // SEQEND
      }
      if (e.type !== 'ACAD_TABLE') e.type = 'INSERT';
      pt2(g, 10, p);
      push(g, 41, sx);
      push(g, 42, sy);
      push(g, 50, deg(rot));
      if (cols > 1 || rows > 1) {
        push(g, 70, cols);
        push(g, 71, rows);
        push(g, 44, cs);
        push(g, 45, rs);
      }
      if (hasAtts) push(g, 66, 1);
      return;
    }
    case 'DIMENSION_LINEAR':
    case 'DIMENSION_ALIGNED':
    case 'DIMENSION_ORDINATE':
    case 'DIMENSION_ANG_3PT':
    case 'DIMENSION_ANG_2LN':
    case 'DIMENSION_RADIUS':
    case 'DIMENSION_DIAMETER':
    case 'ARC_DIMENSION':
      return dimension(o, e);
    case 'HATCH':
      return hatch(o, e);
    case 'LEADER': {
      d.B();
      d.BS();
      d.BS();
      const n = d.BL();
      guard(n);
      for (let k = 0; k < n; k++) pt2(g, 10, d.BD3());
      return;
    }
    case 'VIEWPORT':
      return viewport(o, e);
    case 'MULTILEADER':
      return multileader(o, e);
    case 'IMAGE':
    case 'WIPEOUT': {
      // Wipeouts are stored as images (of size 1 x 1) with a clip boundary.
      d.BL();
      const p = d.BD3();
      const u = d.BD3();
      const w = d.BD3();
      const size = d.RD2();
      d.BS();
      d.B();
      d.RC();
      d.RC();
      d.RC();
      if (v >= R2010) d.B();
      const clip = d.BS();
      const boundary: number[][] = [];
      if (clip === 1) {
        boundary.push(d.RD2(), d.RD2());
      } else if (clip === 2) {
        const n = d.BL();
        guard(n);
        for (let k = 0; k < n; k++) boundary.push(d.RD2());
      }
      e.refs.imageDef = o.H();
      pt2(g, 10, p);
      pt2(g, 11, u);
      pt2(g, 12, w);
      pt2(g, 13, size);
      push(g, 91, boundary.length);
      for (const b of boundary) pt2(g, 14, b);
      return;
    }
    case 'BLOCK':
      e.name = o.TV();
      return;
    default:
      return;
  }
}

/** Polyline vertices: an owned list (R2004+) or first and last (R2000). */
function children(o: Obj, e: EntRec) {
  if (o.version >= R2004) {
    const n = o.d.BL();
    guard(n);
    e.refs.owned = Array.from({ length: n }, () => o.H());
  } else {
    e.refs.first = o.H();
    e.refs.last = o.H();
  }
  o.H(); // SEQEND
}

function text(o: Obj, e: EntRec) {
  const d = o.d;
  const g = e.g;
  const flags = d.RC();
  if (!(flags & 1)) d.RD(); // elevation
  const ins = d.RD2();
  let align: number[] | null = null;
  if (!(flags & 2)) align = [d.DD(ins[0]), d.DD(ins[1])];
  e.extrusion = d.BE();
  d.BT();
  const oblique = flags & 4 ? 0 : d.RD();
  const rot = flags & 8 ? 0 : d.RD();
  const h = d.RD();
  const width = flags & 0x10 ? 1 : d.RD();
  const value = o.TV();
  const mirror = flags & 0x20 ? 0 : d.BS();
  const hal = flags & 0x40 ? 0 : d.BS();
  const val = flags & 0x80 ? 0 : d.BS();
  e.refs.style = o.H();
  push(g, 1, value);
  pt2(g, 10, ins);
  if (align) pt2(g, 11, align);
  push(g, 40, h);
  push(g, 41, width);
  push(g, 50, deg(rot));
  push(g, 51, deg(oblique));
  push(g, 71, mirror);
  push(g, 72, hal);
  if (e.type === 'TEXT') {
    push(g, 73, val);
    return;
  }
  push(g, 74, val);
  // Attribute data.
  if (o.version >= R2010) d.RC();
  let attType = 1;
  if (o.version >= R2018) attType = d.RC();
  if (attType === 2 || attType === 4) {
    // Multi-line attributes carry an MTEXT; drawn as their single-line text here.
    const sub: EntRec = { ...e, g: [], refs: {} };
    // The MTEXT carries a full set of entity properties of its own.
    entityMode(o);
    mtextBody(o, sub);
    const n = d.BS();
    if (n > 0) {
      d.skipBytes(n);
      o.H();
      d.BS();
    }
  }
  push(g, 2, o.TV());
  d.BS();
  const af = d.RC();
  if (o.version >= R2007) d.B();
  push(g, 70, af);
}

function mtext(o: Obj, e: EntRec) {
  mtextBody(o, e);
}

function mtextBody(o: Obj, e: EntRec) {
  const d = o.d;
  const g = e.g;
  const v = o.version;
  const ins = d.BD3();
  e.extrusion = d.BD3();
  const dir = d.BD3();
  const width = d.BD();
  if (v >= R2007) d.BD();
  const h = d.BD();
  const attach = d.BS();
  const drawDir = d.BS();
  d.BD();
  d.BD();
  const value = o.TV();
  e.refs.style = o.H();
  let spacing = 1;
  d.BS();
  spacing = d.BD();
  d.B();
  if (v >= R2004) {
    const bg = d.BL();
    if (bg & 1 || (v > R2013 && bg & 0x10)) {
      d.BD();
      d.CMC(o.t);
      d.BL();
    }
  }
  pt2(g, 10, ins);
  pt2(g, 11, dir);
  push(g, 40, h);
  push(g, 41, width);
  push(g, 71, attach);
  push(g, 72, drawDir);
  push(g, 44, spacing || 1);
  push(g, 1, value);
  // R2018 annotative and column data follow; nothing after them is needed.
}

function dimension(o: Obj, e: EntRec) {
  const d = o.d;
  const g = e.g;
  const v = o.version;
  if (v >= R2010) d.RC();
  e.extrusion = d.BD3();
  d.RD2(); // text midpoint
  d.BD(); // elevation
  d.RC(); // flags
  push(g, 1, o.TV());
  d.BD(); // text rotation
  d.BD(); // horizontal direction
  d.BD3(); // insertion scale
  d.BD(); // insertion rotation
  d.BS();
  d.BS();
  d.BD();
  d.BD();
  if (v >= R2007) {
    d.B();
    d.B();
    d.B();
  }
  const ins = d.RD2();
  pt2(g, 12, ins);
  const kinds: Record<string, number> = {
    DIMENSION_LINEAR: 0,
    DIMENSION_ALIGNED: 1,
    DIMENSION_ANG_2LN: 2,
    DIMENSION_DIAMETER: 3,
    DIMENSION_RADIUS: 4,
    DIMENSION_ANG_3PT: 5,
    DIMENSION_ORDINATE: 6,
    ARC_DIMENSION: 8,
  };
  const kind = kinds[e.type] ?? 0;
  switch (e.type) {
    case 'DIMENSION_LINEAR':
    case 'DIMENSION_ALIGNED': {
      const p13 = d.BD3();
      const p14 = d.BD3();
      d.BD3();
      d.BD(); // oblique
      pt2(g, 13, p13);
      pt2(g, 14, p14);
      if (e.type === 'DIMENSION_LINEAR') push(g, 50, deg(d.BD()));
      break;
    }
    case 'DIMENSION_ORDINATE':
      d.BD3();
      d.BD3();
      d.BD3();
      d.RC();
      break;
    case 'DIMENSION_ANG_3PT':
      d.BD3();
      d.BD3();
      d.BD3();
      d.BD3();
      break;
    case 'DIMENSION_ANG_2LN':
      d.RD2();
      d.BD3();
      d.BD3();
      d.BD3();
      d.BD3();
      break;
    case 'DIMENSION_RADIUS':
    case 'DIMENSION_DIAMETER':
      d.BD3();
      d.BD3();
      d.BD();
      break;
    case 'ARC_DIMENSION':
      d.BD3();
      d.BD3();
      d.BD3();
      d.BD3();
      d.B();
      d.BD();
      d.BD();
      d.B();
      d.BD3();
      d.BD3();
      break;
  }
  o.H(); // dimension style
  e.refs.block = o.H();
  push(g, 70, kind | 32);
  e.type = e.type === 'ARC_DIMENSION' ? 'ARC_DIMENSION' : 'DIMENSION';
}

function hatch(o: Obj, e: EntRec) {
  const d = o.d;
  const g = e.g;
  const v = o.version;
  let gradient = false;
  if (v >= R2004) {
    gradient = d.BL() !== 0;
    d.BL();
    d.BD();
    d.BD();
    d.BL();
    d.BD();
    const n = d.BL();
    guard(n);
    for (let k = 0; k < n; k++) {
      d.BD();
      d.CMC(o.t);
    }
    o.TV();
  }
  d.BD(); // elevation
  e.extrusion = d.BD3();
  o.TV(); // pattern name
  const solid = d.B();
  d.B(); // associative
  const npaths = d.BL();
  guard(npaths);
  push(g, 70, solid ? 1 : 0);
  push(g, 91, npaths);
  let derived = false;
  for (let p = 0; p < npaths; p++) {
    const flags = d.BL();
    if (flags & 4) derived = true;
    push(g, 92, flags);
    if (!(flags & 2)) {
      const n = d.BL();
      guard(n);
      push(g, 93, n);
      for (let k = 0; k < n; k++) {
        const et = d.RC();
        push(g, 72, et);
        if (et === 1) {
          pt2(g, 10, d.RD2());
          pt2(g, 11, d.RD2());
        } else if (et === 2) {
          pt2(g, 10, d.RD2());
          push(g, 40, d.BD());
          push(g, 50, deg(d.BD()));
          push(g, 51, deg(d.BD()));
          push(g, 73, d.B());
        } else if (et === 3) {
          pt2(g, 10, d.RD2());
          pt2(g, 11, d.RD2());
          push(g, 40, d.BD());
          push(g, 50, deg(d.BD()));
          push(g, 51, deg(d.BD()));
          push(g, 73, d.B());
        } else if (et === 4) {
          const degree = d.BL();
          const rational = d.B();
          const periodic = d.B();
          const nk = d.BL();
          const nc = d.BL();
          guard(nk + nc);
          push(g, 94, degree);
          push(g, 73, rational);
          push(g, 74, periodic);
          push(g, 95, nk);
          push(g, 96, nc);
          for (let q = 0; q < nk; q++) push(g, 40, d.BD());
          for (let q = 0; q < nc; q++) {
            pt2(g, 10, d.RD2());
            if (rational) push(g, 42, d.BD());
          }
          if (v >= R2010) {
            const nfit = d.BL();
            guard(nfit);
            if (nfit > 0) {
              for (let q = 0; q < nfit; q++) d.RD2();
              d.RD2();
              d.RD2();
            }
          }
        } else throw new CadReadError('This DWG file is damaged (bad hatch edge).');
      }
    } else {
      const bulges = d.B();
      const closed = d.B();
      const n = d.BL();
      guard(n);
      push(g, 72, bulges);
      push(g, 73, closed);
      push(g, 93, n);
      for (let k = 0; k < n; k++) {
        pt2(g, 10, d.RD2());
        if (bulges) push(g, 42, d.BD());
      }
    }
    const nb = d.BL();
    guard(nb);
    push(g, 97, nb);
    for (let k = 0; k < nb; k++) o.H();
  }
  push(g, 75, d.BS());
  push(g, 76, d.BS());
  if (!solid) {
    push(g, 52, deg(d.BD()));
    push(g, 41, d.BD());
    push(g, 77, d.B());
    const n = d.BS();
    guard(n);
    push(g, 78, n);
    for (let k = 0; k < n; k++) {
      push(g, 53, deg(d.BD()));
      const base = d.BD2();
      const off = d.BD2();
      push(g, 43, base[0]);
      push(g, 44, base[1]);
      push(g, 45, off[0]);
      push(g, 46, off[1]);
      const nd = d.BS();
      guard(nd);
      push(g, 79, nd);
      for (let q = 0; q < nd; q++) push(g, 49, d.BD());
    }
  }
  if (derived) d.BD();
  if (gradient) push(g, 450, 1);
}

/**
 * A multileader, written out in DXF's own layout (CONTEXT_DATA{, LEADER{, LEADER_LINE{) so the
 * renderer reads both formats the same way. Only what draws it is kept: leader lines and landing,
 * arrowhead size, and the text or block content.
 */
function multileader(o: Obj, e: EntRec) {
  const d = o.d;
  const g = e.g;
  const v = o.version;
  if (v >= R2010) d.BS();
  push(g, 300, 'CONTEXT_DATA{');
  const roots = d.BL();
  guard(roots);
  const rootGroups: G[] = [];
  for (let r = 0; r < roots; r++) {
    const rg: G = [];
    d.B();
    d.B();
    const conn = d.BD3();
    const dir = d.BD3();
    const nBreaks = d.BL();
    guard(nBreaks);
    for (let k = 0; k < nBreaks; k++) {
      d.BD3();
      d.BD3();
    }
    const index = d.BL();
    const landing = d.BD();
    push(rg, 302, 'LEADER{');
    pt2(rg, 10, conn);
    pt2(rg, 11, dir);
    push(rg, 90, index);
    push(rg, 40, landing);
    const nLines = d.BL();
    guard(nLines);
    for (let l = 0; l < nLines; l++) {
      push(rg, 304, 'LEADER_LINE{');
      const n = d.BL();
      guard(n);
      for (let k = 0; k < n; k++) pt2(rg, 10, d.BD3());
      const nInfo = d.BL();
      guard(nInfo);
      for (let k = 0; k < nInfo; k++) {
        d.BL();
        const m = d.BL();
        guard(m);
        for (let q = 0; q < m; q++) {
          d.BD3();
          d.BD3();
        }
      }
      push(rg, 91, d.BL());
      if (v >= R2010) {
        d.BS();
        d.CMC(o.t);
        o.H();
        d.BL();
        d.BD();
        o.H();
        d.BL();
      }
      push(rg, 305, '}');
    }
    if (v >= R2010) d.BS();
    push(rg, 303, '}');
    rootGroups.push(rg);
  }
  push(g, 40, d.BD()); // scale
  pt2(g, 10, d.BD3()); // content base point
  push(g, 41, d.BD()); // text height
  push(g, 140, d.BD()); // arrowhead size
  push(g, 145, d.BD()); // landing gap
  d.BS();
  d.BS();
  d.BS();
  d.BS();
  if (d.B()) {
    push(g, 290, 1);
    push(g, 304, o.TV());
    d.BD3(); // normal
    o.H(); // style
    pt2(g, 12, d.BD3());
    pt2(g, 13, d.BD3());
    push(g, 42, d.BD());
    push(g, 43, d.BD());
    d.BD(); // boundary height
    push(g, 45, d.BD());
    d.BS();
    d.CMC(o.t);
    push(g, 171, d.BS());
    d.BS();
    d.CMC(o.t);
    d.BD();
    d.BL();
    d.B();
    d.B();
    d.BS();
    d.B();
    d.BD();
    d.BD();
    d.B();
    const nCols = d.BL();
    guard(nCols);
    for (let k = 0; k < nCols; k++) d.BD();
    d.B();
    d.B();
  } else if (d.B()) {
    push(g, 296, 1);
    push(g, 341, o.H().toString(16).toUpperCase());
    d.BD3();
    pt2(g, 15, d.BD3());
    const sc = d.BD3();
    push(g, 16, sc[0]);
    push(g, 26, sc[1]);
    push(g, 46, d.BD());
    d.CMC(o.t);
    for (let k = 0; k < 16; k++) d.BD();
  }
  for (const rg of rootGroups) g.push(...rg);
  push(g, 301, '}');
}

function viewport(o: Obj, e: EntRec) {
  const d = o.d;
  const g = e.g;
  const v = o.version;
  const c = d.BD3();
  const w = d.BD();
  const h = d.BD();
  const target = d.BD3();
  const dir = d.BD3();
  const twist = d.BD();
  const viewHeight = d.BD();
  d.BD();
  d.BD();
  d.BD();
  d.BD();
  const viewCenter = d.RD2();
  d.RD2();
  d.RD2();
  d.RD2();
  d.BS();
  if (v >= R2007) d.BS();
  const nFrozen = d.BL();
  guard(nFrozen);
  const status = d.BL();
  o.TV();
  d.RC();
  d.B();
  d.B();
  d.BD3();
  d.BD3();
  d.BD3();
  d.BD();
  d.BS();
  if (v >= R2004) d.BS();
  if (v >= R2007) {
    d.B();
    d.RC();
    d.BD();
    d.BD();
    d.CMC(o.t);
  }
  e.refs.frozen = Array.from({ length: nFrozen }, () => o.H());
  e.refs.boundary = o.H();
  pt2(g, 10, c);
  push(g, 40, w);
  push(g, 41, h);
  pt2(g, 12, viewCenter);
  push(g, 17, target[0]);
  push(g, 27, target[1]);
  push(g, 16, dir[0]);
  push(g, 26, dir[1]);
  push(g, 36, dir[2]);
  push(g, 45, viewHeight);
  push(g, 51, deg(twist));
  push(g, 90, status);
  push(g, 68, status & 0x20000 ? 0 : 1);
}

// ---- table entries and objects ----------------------------------------------------------------

function xrefBit(o: Obj) {
  if (o.version >= R2007) o.d.BS();
  else {
    o.d.B();
    o.d.BS();
    o.d.B();
  }
}

function readTableObject(o: Obj, type: string): ObjRec {
  const d = o.d;
  const v = o.version;
  common(o);
  const owner = o.Hr();
  reactorsAndXdic(o);
  const data: Record<string, unknown> = {};
  switch (type) {
    case 'LAYER': {
      data.name = o.TV();
      xrefBit(o);
      const values = d.BS();
      data.frozen = (values & 1) !== 0;
      data.off = (values & 2) !== 0;
      data.plot = (values & 0x10) !== 0;
      data.lineweight = lineweightOf((values & 0x3e0) >> 5);
      data.color = d.CMC(o.t);
      o.H(); // layer control
      o.H(); // plot style
      if (v >= R2007) o.H(); // material
      data.ltype = o.H();
      break;
    }
    case 'LTYPE': {
      data.name = o.TV();
      xrefBit(o);
      o.TV(); // description
      d.BD(); // total length
      d.RC(); // alignment
      const n = d.RC();
      const pattern: number[] = [];
      let hasText = false;
      for (let i = 0; i < n; i++) {
        pattern.push(d.BD());
        d.BS();
        d.RD();
        d.RD();
        d.BD();
        d.BD();
        if (d.BS() & 2) hasText = true;
      }
      data.pattern = pattern;
      // Shape and text segments (and the text area after them) are not drawn.
      void hasText;
      break;
    }
    case 'STYLE': {
      data.name = o.TV();
      xrefBit(o);
      d.B(); // shape file
      d.B(); // vertical
      data.height = d.BD();
      data.width = d.BD();
      data.oblique = d.BD();
      data.generation = d.RC();
      d.BD(); // last height
      data.font = o.TV();
      data.bigFont = o.TV();
      break;
    }
    case 'BLOCK_HEADER': {
      data.name = o.TV();
      xrefBit(o);
      d.B(); // anonymous
      d.B(); // has attributes
      const xref = d.B();
      const overlay = d.B();
      d.B(); // unloaded
      data.xref = !!(xref || overlay);
      let owned = 0;
      if (v >= R2004 && !xref && !overlay) owned = d.BL();
      guard(owned);
      data.base = d.BD3();
      data.xrefPath = o.TV();
      let inserts = 0;
      while (d.RC() !== 0) inserts++;
      o.TV(); // comments
      const preview = d.BL();
      guard(preview);
      d.skipBytes(preview);
      if (v >= R2007) {
        d.BS();
        d.B();
        d.RC();
      }
      o.H(); // null
      data.block = o.H();
      if (v < R2004 && !xref && !overlay) {
        data.first = o.H();
        data.last = o.H();
      }
      if (v >= R2004) data.owned = Array.from({ length: owned }, () => o.H());
      data.endBlock = o.H();
      for (let i = 0; i < inserts; i++) o.H();
      data.layout = o.H();
      break;
    }
    case 'LAYOUT': {
      o.TV(); // page name
      o.TV(); // printer
      d.BS(); // flags
      data.margins = [d.BD(), d.BD(), d.BD(), d.BD()];
      data.paperWidth = d.BD();
      data.paperHeight = d.BD();
      o.TV(); // paper size
      data.origin = [d.BD(), d.BD()];
      data.units = d.BS();
      data.rotation = d.BS();
      d.BS(); // plot type
      d.BD();
      d.BD();
      d.BD();
      d.BD();
      if (v === 1015) o.TV();
      data.numerator = d.BD();
      data.denominator = d.BD();
      data.styleSheet = o.TV();
      d.BS();
      d.BD();
      d.BD2();
      if (v >= R2004) {
        d.BS();
        d.BS();
        d.BS();
        o.H();
      }
      if (v >= R2007) o.H();
      data.name = o.TV();
      data.tabOrder = d.BL();
      d.BS();
      d.BD3();
      d.RD2();
      d.RD2();
      d.BD3();
      d.BD3();
      d.BD3();
      d.BD();
      d.BS();
      d.BD3();
      d.BD3();
      if (v >= R2004) d.BL();
      data.block = o.H();
      break;
    }
    case 'IMAGEDEF': {
      d.BL();
      d.RD2();
      data.path = o.TV();
      break;
    }
    case 'VPORT': {
      data.name = o.TV();
      xrefBit(o);
      d.BD(); // view height
      d.BD(); // aspect
      d.RD2(); // centre
      data.target = d.BD3();
      d.BD3(); // direction
      data.twist = d.BD();
      break;
    }
  }
  return { kind: 'object', type, handle: o.handle, owner, data };
}

const MAX_COUNT = 10_000_000;
function guard(n: number) {
  if (!(n >= 0) || n > MAX_COUNT) throw new CadReadError('This DWG file is damaged (bad count).');
}

