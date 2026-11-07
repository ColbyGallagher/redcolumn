import { CadReadError } from './dxf';
import { aciRgb, trueRgb, type Rgb } from './aci';
import { headerNum, num, nums, pt, str, type Block, type Drawing, type Entity, type Groups, type Layer } from './drawing';
import { apply, applyV, arcCmds, bspline, bulgeCmds, circleM, meanScale, ocs, polyPath, rotate, scale, then, throughPoints, translate, type Cmd, type M, type P } from './geom';
import { decodeSpecial, mtextParagraphs } from './text';

/**
 * Entities to page primitives. Everything comes out in page points: the context's matrix maps
 * drawing units to the page, while lineweights and (paper-scaled) linetypes stay in paper units.
 */

export type FontKey = 'sans' | 'serif' | 'mono';

export interface StrokePrim {
  k: 'stroke';
  d: Cmd[];
  rgb: Rgb;
  layer: string;
  /** Line width in points. */
  width: number;
  /** PDF dash array in points, or null for a continuous line. */
  dash: number[] | null;
}
export interface FillPrim {
  k: 'fill';
  d: Cmd[];
  rgb: Rgb;
  layer: string;
}
export interface HatchPrim {
  k: 'hatch';
  /** Boundary, filled even-odd (islands are holes). */
  clip: Cmd[];
  lines: Cmd[];
  rgb: Rgb;
  layer: string;
  width: number;
}
export interface TextPrim {
  k: 'text';
  layer: string;
  rgb: Rgb;
  font: FontKey;
  lines: string[];
  /** Insertion point on the page. */
  origin: P;
  /** Page vectors for one drawing unit along the baseline and up the glyphs. */
  u: P;
  v: P;
  /** Cap height in drawing units. */
  h: number;
  widthFactor: number;
  /** Radians, slanting glyphs to the right. */
  oblique: number;
  /** 0 left, 1 centre, 2 right. */
  halign: 0 | 1 | 2;
  /** 0 baseline, 1 bottom, 2 middle, 3 top (of the first line, or of the whole block for MTEXT). */
  valign: 0 | 1 | 2 | 3;
  /** MTEXT: lines and paragraphs flow as one block (wrap and vertical alignment of the block). */
  block: boolean;
  /** Wrap width in drawing units (MTEXT), or null. */
  wrap: number | null;
  /** Baseline-to-baseline distance in drawing units. */
  spacing: number;
  /** Aligned / fit TEXT: the baseline length to fill, in drawing units. */
  fit: number | null;
  /** Aligned TEXT keeps its proportions: the height scales with the fit. */
  fitHeight: boolean;
}
/** Primitives drawn inside a clip (a viewport). */
export interface ClipPrim {
  k: 'clip';
  clip: Cmd[];
  prims: Prim[];
}
export type Prim = StrokePrim | FillPrim | HatchPrim | TextPrim | ClipPrim;

export type ColorMode = 'color' | 'grey' | 'mono';

export interface RenderOptions {
  colorMode: ColorMode;
  lineweights: boolean;
  /** Drawings supplied for external references, by `referenceKey` of their file name. */
  references?: ReadonlyMap<string, Drawing>;
}

/** What rendering met that the report should mention. */
export interface RenderStats {
  skipped: Map<string, number>;
  xrefs: Map<string, string>;
  images: Set<string>;
  /** Font file or family -> the font drawn instead. */
  fonts: Map<string, FontKey>;
  /** Linear and aligned dimensions drawn, for the scale check. */
  dims: DimSample[];
  /** Work done so far, shared by every pass over one drawing. */
  budget: Budget;
}

/** How much drawing one conversion may do: a bound on hostile or runaway files (block fan-out). */
export interface Budget {
  entities: number;
  blocks: number;
}
export const MAX_ENTITY_DRAWS = 10_000_000;
export const MAX_BLOCK_DRAWS = 2_000_000;
const tooComplex = () => new CadReadError('This drawing is too complex to convert.');

export interface DimSample {
  /** Length on the page in points. */
  pageLength: number;
  /** The length the dimension states (group 42), in drawing units; null when the file leaves it out. */
  measurement: number | null;
  /** Midpoint on the page, to find which viewport it is in. */
  at: P;
}

export const newStats = (budget: Budget = { entities: 0, blocks: 0 }): RenderStats => ({ skipped: new Map(), xrefs: new Map(), images: new Set(), fonts: new Map(), dims: [], budget });

const PT_PER_MM = 72 / 25.4;
const MIN_LW_MM = 0.1;
const NO_LW_MM = 0.18;
const MAX_DEPTH = 32;
const MAX_HATCH_SEGMENTS = 200_000;

/** What an INSERT passes to the entities of its block (BYBLOCK, layer 0). */
interface Inherit {
  layer: string;
  rgb: Rgb | null;
  linetype: string;
  lineweight: number;
}

export interface Ctx {
  dwg: Drawing;
  opts: RenderOptions;
  out: Prim[];
  /** Drawing units to page points. */
  m: M;
  /** Points per linetype unit (LTSCALE included). */
  dashPt: number;
  /** Layers frozen in this viewport. */
  frozen: ReadonlySet<string>;
  parent: Inherit | null;
  depth: number;
  stack: Set<string>;
  stats: RenderStats;
}

// ---- properties -----------------------------------------------------------------------------

function layerOf(c: Ctx, e: Entity): { name: string; layer: Layer } {
  const name = e.layer === '0' && c.parent ? c.parent.layer : e.layer;
  const layer = c.dwg.layers.get(name) ?? c.dwg.layers.get('0')!;
  return { name, layer };
}

function visible(c: Ctx, e: Entity): boolean {
  if (e.invisible) return false;
  const { name, layer } = layerOf(c, e);
  if (layer.frozen || layer.off || !layer.plot || c.frozen.has(name)) return false;
  // An entity on its own layer inside a block also obeys that layer.
  if (e.layer !== name) {
    const own = c.dwg.layers.get(e.layer);
    if (own && (own.frozen || own.off || !own.plot || c.frozen.has(e.layer))) return false;
  }
  return true;
}

function rawRgb(c: Ctx, e: Entity): Rgb {
  if (e.trueColor !== null) return trueRgb(e.trueColor);
  if (e.color === 0) return c.parent?.rgb ?? aciRgb(7);
  if (e.color === 256 || !e.color) {
    const { layer } = layerOf(c, e);
    return layer.trueColor !== null ? trueRgb(layer.trueColor) : aciRgb(layer.color);
  }
  return aciRgb(e.color);
}

/** The colour as plotted: white (ACI 7 on a light background) prints black; grey and mono modes. */
export function plotRgb(rgb: Rgb, mode: ColorMode): Rgb {
  if (mode === 'mono') return [0, 0, 0];
  const white = rgb[0] > 0.97 && rgb[1] > 0.97 && rgb[2] > 0.97;
  if (white) return [0, 0, 0];
  if (mode === 'grey') {
    const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    return [l, l, l];
  }
  return rgb;
}

function linetypeName(c: Ctx, e: Entity): string {
  const n = e.linetype.toUpperCase();
  if (n === 'BYLAYER') return layerOf(c, e).layer.linetype.toUpperCase();
  if (n === 'BYBLOCK') return c.parent?.linetype ?? 'CONTINUOUS';
  return n;
}

function lineweightOf(c: Ctx, e: Entity): number {
  let lw = e.lineweight;
  if (lw === -1) lw = layerOf(c, e).layer.lineweight;
  if (lw === -2) lw = c.parent?.lineweight ?? -3;
  if (lw < 0) lw = headerNum(c.dwg, '$LWDEFAULT', 25);
  return lw;
}

function strokeOf(c: Ctx, e: Entity, d: Cmd[], widthPt?: number): StrokePrim {
  const lwMm = c.opts.lineweights ? Math.max(lineweightOf(c, e) / 100, MIN_LW_MM) : NO_LW_MM;
  return { k: 'stroke', d, rgb: plotRgb(rawRgb(c, e), c.opts.colorMode), layer: layerOf(c, e).name, width: widthPt && widthPt > 0 ? widthPt : lwMm * PT_PER_MM, dash: dashOf(c, e) };
}

function dashOf(c: Ctx, e: Entity): number[] | null {
  const name = linetypeName(c, e);
  if (name === 'CONTINUOUS') return null;
  const lt = c.dwg.linetypes.get(name);
  if (!lt || lt.pattern.length < 2) return null;
  const k = c.dashPt * (e.ltscale || 1) * headerNum(c.dwg, '$LTSCALE', 1);
  // Alternate on/off starting with "on"; merge runs of the same sign; dots get a tiny dash.
  const out: number[] = [];
  let on = true;
  if (lt.pattern[0]! < 0) out.push(0), (on = false);
  for (const len of lt.pattern) {
    const isOn = len >= 0;
    const v = len === 0 ? 0.3 : Math.abs(len) * k;
    if (isOn === on) out.push(v);
    else out[out.length - 1] = (out[out.length - 1] ?? 0) + v;
    on = !isOn;
  }
  const period = out.reduce((a, b) => a + b, 0);
  // Too fine to see (or to render quickly): draw it continuous.
  if (!(period > 1) || out.length < 2) return null;
  if (out.length % 2) out.push(...out);
  return out;
}

/** A frame drawn with an entity's properties (a viewport's border), when its layer plots. */
export function frameOf(c: Ctx, e: Entity, d: Cmd[]): StrokePrim | null {
  return visible(c, e) ? strokeOf(c, e, d) : null;
}

// ---- entities --------------------------------------------------------------------------------

/** Renders a list of entities in the context's space. */
export function renderEntities(c: Ctx, list: readonly Entity[]) {
  for (const e of list) {
    if (e.type === 'VIEWPORT') continue;
    if (!visible(c, e)) continue;
    if (++c.stats.budget.entities > MAX_ENTITY_DRAWS) throw tooComplex();
    try {
      renderEntity(c, e);
    } catch (err) {
      // Running out of budget stops the conversion; anything else loses just this entity.
      if (err instanceof CadReadError) throw err;
      count(c, `${e.type} (unreadable)`);
    }
  }
}

function count(c: Ctx, type: string) {
  c.stats.skipped.set(type, (c.stats.skipped.get(type) ?? 0) + 1);
}

/** OCS (from the entity's extrusion) then the context matrix. */
const om = (c: Ctx, e: Entity): M => then(ocs(e.extrusion), c.m);

function renderEntity(c: Ctx, e: Entity) {
  const g = e.g;
  switch (e.type) {
    case 'LINE': {
      // LINE points are WCS.
      const a = apply(c.m, pt(g, 10));
      const b = apply(c.m, pt(g, 11));
      c.out.push(strokeOf(c, e, [['M', a[0], a[1]], ['L', b[0], b[1]]]));
      return;
    }
    case 'LWPOLYLINE':
      return lwpolyline(c, e);
    case 'POLYLINE':
      return polyline(c, e);
    case 'CIRCLE': {
      const m = then(circleM(pt(g, 10), num(g, 40)), om(c, e));
      c.out.push(strokeOf(c, e, [...arcCmds(m, 0, 2 * Math.PI, true), ['Z']]));
      return;
    }
    case 'ARC': {
      const m = then(circleM(pt(g, 10), num(g, 40)), om(c, e));
      const a0 = (num(g, 50) * Math.PI) / 180;
      let a1 = (num(g, 51) * Math.PI) / 180;
      while (a1 <= a0) a1 += 2 * Math.PI;
      c.out.push(strokeOf(c, e, arcCmds(m, a0, a1, true)));
      return;
    }
    case 'ELLIPSE': {
      // WCS centre and major axis; the minor axis is the major turned a quarter about the extrusion.
      const ctr = pt(g, 10);
      const maj = pt(g, 11);
      const ratio = num(g, 40, 1);
      const flip = e.extrusion[2] < 0 ? -1 : 1;
      const m: M = then([maj[0], maj[1], -maj[1] * ratio * flip, maj[0] * ratio * flip, ctr[0], ctr[1]], c.m);
      const t0 = num(g, 41, 0);
      let t1 = num(g, 42, 2 * Math.PI);
      while (t1 <= t0) t1 += 2 * Math.PI;
      const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9;
      c.out.push(strokeOf(c, e, [...arcCmds(m, t0, t1, true), ...(full ? [['Z'] as Cmd] : [])]));
      return;
    }
    case 'SPLINE':
    case 'HELIX':
      return spline(c, e);
    case 'POINT': {
      const p = apply(c.m, pt(g, 10));
      const r = 0.15 * PT_PER_MM;
      c.out.push({ k: 'fill', d: [...arcCmds(circleM(p, r), 0, 2 * Math.PI, true), ['Z']], rgb: plotRgb(rawRgb(c, e), c.opts.colorMode), layer: layerOf(c, e).name });
      return;
    }
    case 'SOLID':
    case 'TRACE': {
      const p = [pt(g, 10), pt(g, 11), pt(g, 13, pt(g, 12)), pt(g, 12)].map((q) => apply(om(c, e), q));
      c.out.push({ k: 'fill', d: polyPath(p, true), rgb: plotRgb(rawRgb(c, e), c.opts.colorMode), layer: layerOf(c, e).name });
      return;
    }
    case '3DFACE': {
      const p = [pt(g, 10), pt(g, 11), pt(g, 12), pt(g, 13, pt(g, 12))].map((q) => apply(c.m, q));
      c.out.push(strokeOf(c, e, polyPath(p, true)));
      return;
    }
    case 'LEADER': {
      const xs = nums(g, 10);
      const ys = nums(g, 20);
      const p = xs.map((x, i): P => apply(c.m, [x, ys[i] ?? 0]));
      if (p.length > 1) c.out.push(strokeOf(c, e, polyPath(p)));
      return;
    }
    case 'TEXT':
    case 'ATTRIB':
      return text(c, e);
    case 'MTEXT':
      return mtext(c, e);
    case 'HATCH':
      return hatch(c, e);
    case 'INSERT':
      return insert(c, e);
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION':
      return dimension(c, e);
    case 'ACAD_TABLE': {
      const b = c.dwg.blocks.get(str(g, 2).toUpperCase());
      if (b) drawBlock(c, e, b, then(translate(-b.base[0], -b.base[1]), then(translate(...pt(g, 10)), ocs(e.extrusion))));
      else count(c, 'ACAD_TABLE');
      return;
    }
    case 'IMAGE':
      return image(c, e);
    case 'ATTDEF':
      return;
    default:
      count(c, e.type);
  }
}

function lwpolyline(c: Ctx, e: Entity) {
  const g = e.g;
  const verts: { p: P; bulge: number }[] = [];
  for (const [code, v] of g) {
    if (code === 10) verts.push({ p: [Number(v), 0], bulge: 0 });
    else if (code === 20 && verts.length) verts[verts.length - 1]!.p[1] = Number(v);
    else if (code === 42 && verts.length) verts[verts.length - 1]!.bulge = Number(v);
  }
  const closed = (num(g, 70) & 1) === 1;
  const m = om(c, e);
  const d = bulgePath(verts, closed);
  const width = num(g, 43);
  c.out.push(strokeOf(c, e, mapCmds(m, d), width > 0 ? width * meanScale(m) : undefined));
}

function polyline(c: Ctx, e: Entity) {
  const flags = num(e.g, 70);
  if (flags & (16 | 64)) {
    count(c, flags & 64 ? 'POLYFACE MESH' : 'POLYGON MESH');
    return;
  }
  // Spline frame control points (vertex flag 16) are not on the curve; fit vertices are.
  const verts = e.children.filter((v) => !(num(v.g, 70) & 16)).map((v) => ({ p: pt(v.g, 10), bulge: num(v.g, 42) }));
  const closed = (flags & 1) === 1;
  // 3D polylines are WCS; 2D ones are in the polyline's OCS.
  const m = flags & 8 ? c.m : om(c, e);
  const width = num(e.g, 40);
  c.out.push(strokeOf(c, e, mapCmds(m, bulgePath(verts, closed)), width > 0 ? width * meanScale(m) : undefined));
}

function bulgePath(verts: { p: P; bulge: number }[], closed: boolean): Cmd[] {
  if (!verts.length) return [];
  const d: Cmd[] = [['M', verts[0]!.p[0], verts[0]!.p[1]]];
  const n = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    d.push(...bulgeCmds(a.p, b.p, a.bulge));
  }
  if (closed) d.push(['Z']);
  return d;
}

const mapCmds = (m: M, d: Cmd[]): Cmd[] =>
  d.map((cmd): Cmd => {
    if (cmd[0] === 'Z') return cmd;
    if (cmd[0] === 'C') {
      const a = apply(m, [cmd[1], cmd[2]]);
      const b = apply(m, [cmd[3], cmd[4]]);
      const q = apply(m, [cmd[5], cmd[6]]);
      return ['C', a[0], a[1], b[0], b[1], q[0], q[1]];
    }
    const p = apply(m, [cmd[1], cmd[2]]);
    return [cmd[0], p[0], p[1]];
  });

function spline(c: Ctx, e: Entity) {
  const g = e.g;
  const degree = num(g, 71, 3);
  const closed = (num(g, 70) & 1) === 1;
  const knots = nums(g, 40);
  const weights = nums(g, 41);
  const ctrl: P[] = [];
  const fit: P[] = [];
  for (let i = 0; i < g.length; i++) {
    const [code, v] = g[i]!;
    if (code === 10) ctrl.push([Number(v), Number(g[i + 1]?.[0] === 20 ? g[i + 1]![1] : 0)]);
    else if (code === 11) fit.push([Number(v), Number(g[i + 1]?.[0] === 21 ? g[i + 1]![1] : 0)]);
  }
  let d: Cmd[];
  if (ctrl.length >= 2) d = polyPath(bspline(degree, ctrl, knots, weights.length ? weights : null, Math.min(2000, Math.max(32, ctrl.length * 12))), false);
  else if (fit.length >= 2) d = throughPoints(fit, closed);
  else return;
  // SPLINE coordinates are WCS.
  c.out.push(strokeOf(c, e, mapCmds(c.m, d)));
}

// ---- text ------------------------------------------------------------------------------------

const METRIC_SAFE = /^(arial|arialbd|ariali|arialbi|arialn|helvetica|times|timesbd|timesi|timesbi|tnr|cour|courbd|couri|courbi|liberation)/i;

/** The font drawn for a text style, noting a substitution unless it is metric-compatible. */
export function fontFor(c: Pick<Ctx, 'dwg' | 'stats'>, styleName: string): FontKey {
  const st = c.dwg.styles.get((styleName || 'STANDARD').toUpperCase());
  const shown = (st?.font || '').replace(/^.*[\\/]/, '');
  const file = shown.toLowerCase();
  const family = (st?.family || '').toLowerCase();
  const name = file || family || 'txt.shx';
  const base = name.replace(/\.(shx|ttf|ttc|otf)$/, '');
  let key: FontKey = 'sans';
  if (/mono|cour|consol|lucon/.test(base)) key = 'mono';
  else if (/times|roman[tcd]?|serif|georgia|garamond|cambria|book/.test(base) && !/romans/.test(base)) key = 'serif';
  const shx = name.endsWith('.shx') || !/\.(ttf|ttc|otf)$/.test(name);
  if (shx || !METRIC_SAFE.test(base)) {
    const label = shown || st?.family || 'txt.shx';
    if (!(file === '' && METRIC_SAFE.test(family))) c.stats.fonts.set(label, key);
  }
  return key;
}

function styleOf(c: Ctx, name: string) {
  return c.dwg.styles.get((name || 'STANDARD').toUpperCase());
}

function text(c: Ctx, e: Entity) {
  const g = e.g;
  if (e.type === 'ATTRIB' && num(g, 70) & 1) return;
  const raw = str(g, 1);
  if (!raw.trim()) return;
  const st = styleOf(c, str(g, 7, 'STANDARD'));
  const h = num(g, 40) || st?.height || headerNum(c.dwg, '$TEXTSIZE', 2.5);
  const width = num(g, 41) || st?.widthFactor || 1;
  const oblique = ((num(g, 51, st?.oblique ?? 0) || 0) * Math.PI) / 180;
  const gen = num(g, 71, st?.generation ?? 0);
  const hal = num(g, 72);
  const val = num(g, e.type === 'ATTRIB' ? 74 : 73);
  const m = om(c, e);
  const p10 = pt(g, 10);
  const p11 = pt(g, 11, p10);
  let rot = (num(g, 50) * Math.PI) / 180;
  let origin = p10;
  let fit: number | null = null;
  let halign: 0 | 1 | 2 = 0;
  let valign: 0 | 1 | 2 | 3 = 0;
  if (hal === 3 || hal === 5) {
    rot = Math.atan2(p11[1] - p10[1], p11[0] - p10[0]);
    fit = Math.hypot(p11[0] - p10[0], p11[1] - p10[1]) || null;
  } else if (hal || val) {
    origin = p11;
    halign = hal === 4 ? 1 : (Math.min(hal, 2) as 0 | 1 | 2);
    valign = hal === 4 ? 2 : (Math.min(val, 3) as 0 | 1 | 2 | 3);
  }
  let u = applyV(m, [Math.cos(rot), Math.sin(rot)]);
  let v = applyV(m, [-Math.sin(rot), Math.cos(rot)]);
  if (gen & 2) u = [-u[0], -u[1]];
  if (gen & 4) v = [-v[0], -v[1]];
  c.out.push({
    k: 'text',
    layer: layerOf(c, e).name,
    rgb: plotRgb(rawRgb(c, e), c.opts.colorMode),
    font: fontFor(c, str(g, 7, 'STANDARD')),
    lines: [decodeSpecial(raw)],
    origin: apply(m, origin),
    u,
    v,
    h,
    widthFactor: width,
    oblique,
    halign,
    valign,
    block: false,
    wrap: null,
    spacing: h * (5 / 3),
    fit,
    fitHeight: hal === 3,
  });
}

function mtext(c: Ctx, e: Entity) {
  const g = e.g;
  const raw = g.filter(([code]) => code === 3).map(([, v]) => v).join('') + str(g, 1);
  if (!raw.trim()) return;
  const st = styleOf(c, str(g, 7, 'STANDARD'));
  const h = num(g, 40) || st?.height || headerNum(c.dwg, '$TEXTSIZE', 2.5);
  const attach = Math.min(Math.max(num(g, 71, 1), 1), 9);
  // Direction: group 11 (WCS vector) wins over rotation 50 (degrees, in the OCS).
  let dir: P;
  let m: M;
  if (g.some(([code]) => code === 11)) {
    dir = pt(g, 11);
    m = c.m;
  } else {
    const r = (num(g, 50) * Math.PI) / 180;
    dir = [Math.cos(r), Math.sin(r)];
    m = om(c, e);
  }
  const len = Math.hypot(dir[0], dir[1]) || 1;
  dir = [dir[0] / len, dir[1] / len];
  // Up: the direction turned a quarter counter-clockwise (clockwise when the extrusion points down).
  const flip = e.extrusion[2] < 0 && m === c.m ? -1 : 1;
  const up: P = [-dir[1] * flip, dir[0] * flip];
  const wrap = num(g, 41);
  c.out.push({
    k: 'text',
    layer: layerOf(c, e).name,
    rgb: plotRgb(rawRgb(c, e), c.opts.colorMode),
    font: fontFor(c, str(g, 7, 'STANDARD')),
    lines: mtextParagraphs(raw),
    origin: apply(m, pt(g, 10)),
    u: applyV(m, dir),
    v: applyV(m, up),
    h,
    widthFactor: st?.widthFactor || 1,
    oblique: ((st?.oblique ?? 0) * Math.PI) / 180,
    halign: ((attach - 1) % 3) as 0 | 1 | 2,
    valign: attach <= 3 ? 3 : attach <= 6 ? 2 : 1,
    block: true,
    wrap: wrap > 0 ? wrap : null,
    spacing: (num(g, 44, 1) || 1) * h * (5 / 3),
    fit: null,
    fitHeight: false,
  });
}

// ---- blocks ----------------------------------------------------------------------------------

function inheritOf(c: Ctx, e: Entity): Inherit {
  return { layer: layerOf(c, e).name, rgb: rawRgb(c, e), linetype: linetypeName(c, e), lineweight: lineweightOf(c, e) };
}

function drawBlock(c: Ctx, e: Entity, b: Pick<Block, 'name' | 'entities'>, blockM: M, dwg: Drawing = c.dwg) {
  if (++c.stats.budget.blocks > MAX_BLOCK_DRAWS) throw tooComplex();
  const key = dwg === c.dwg ? b.name : `xref:${b.name}`;
  if (c.depth >= MAX_DEPTH || c.stack.has(key)) {
    count(c, 'INSERT (nested too deep)');
    return;
  }
  c.stack.add(key);
  const child: Ctx = { ...c, dwg, m: then(blockM, c.m), parent: inheritOf(c, e), depth: c.depth + 1 };
  renderEntities(child, b.entities);
  c.stack.delete(key);
}

/** The key a reference drawing is supplied under: its file name, lower case, without folder or extension. */
export const referenceKey = (path: string) =>
  path
    .replace(/^.*[\\/]/, '')
    .replace(/\.(dwg|dxf)$/i, '')
    .toLowerCase();

/** The drawing supplied for an external reference, by its path's file name or else its block name. */
function referenceFor(c: Ctx, b: Block): Drawing | null {
  const refs = c.opts.references;
  if (!refs?.size) return null;
  return refs.get(referenceKey(b.xrefPath || b.name)) ?? refs.get(referenceKey(b.name)) ?? null;
}

function insert(c: Ctx, e: Entity) {
  const g = e.g;
  const name = str(g, 2);
  const b = c.dwg.blocks.get(name.toUpperCase());
  const isXref = !!b && !!(b.flags & 4 || b.xrefPath);
  const ref = isXref ? referenceFor(c, b!) : null;
  if (isXref && !ref) {
    c.stats.xrefs.set(b!.name, b!.xrefPath);
  } else if (!b) {
    count(c, 'INSERT (missing block)');
  } else {
    const sx = num(g, 41, 1) || 1;
    const sy = num(g, 42, 1) || 1;
    const rot = (num(g, 50) * Math.PI) / 180;
    const cols = Math.max(1, Math.floor(num(g, 70, 1)) || 1);
    const rows = Math.max(1, Math.floor(num(g, 71, 1)) || 1);
    if (cols * rows > MAX_BLOCK_DRAWS) throw tooComplex();
    const cs = num(g, 44);
    const rs = num(g, 45);
    const tail = then(rotate(rot), then(translate(...pt(g, 10)), ocs(e.extrusion)));
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const m = then(then(then(translate(-b.base[0], -b.base[1]), scale(sx, sy)), translate(col * cs, r * rs)), tail);
        // A supplied reference drawing is drawn from its model space, with its own tables.
        if (ref) drawBlock(c, e, { name: b.name, entities: ref.modelSpace }, m, ref);
        else drawBlock(c, e, b, m);
      }
    }
  }
  // Attributes sit in the insert's own space, not the block's.
  if (e.children.length) {
    const attrCtx: Ctx = { ...c, parent: inheritOf(c, e) };
    renderEntities(attrCtx, e.children);
  }
}

function dimension(c: Ctx, e: Entity) {
  const g = e.g;
  const b = c.dwg.blocks.get(str(g, 2).toUpperCase());
  if (!b) {
    count(c, `${e.type} (no block)`);
    return;
  }
  // The block is drawn in the dimension's OCS, moved by its insertion point when it has one.
  const ins = g.some(([code]) => code === 12) ? pt(g, 12) : [0, 0];
  drawBlock(c, e, b, then(translate(-b.base[0] + ins[0]!, -b.base[1] + ins[1]!), ocs(e.extrusion)));
  // Linear (0) and aligned (1) dimensions feed the scale check.
  const kind = num(g, 70) & 7;
  const measurement = num(g, 42);
  if ((kind === 0 || kind === 1) && g.some(([code]) => code === 13)) {
    const p13 = pt(g, 13);
    const p14 = pt(g, 14);
    let vec: P = [p14[0] - p13[0], p14[1] - p13[1]];
    if (kind === 0) {
      const a = (num(g, 50) * Math.PI) / 180;
      const dir: P = [Math.cos(a), Math.sin(a)];
      const t = vec[0] * dir[0] + vec[1] * dir[1];
      vec = [dir[0] * t, dir[1] * t];
    }
    const pv = applyV(c.m, vec);
    const mid = apply(c.m, [(p13[0] + p14[0]) / 2, (p13[1] + p14[1]) / 2]);
    c.stats.dims.push({ pageLength: Math.hypot(pv[0], pv[1]), measurement: measurement > 0 ? measurement : null, at: mid });
  }
}

function image(c: Ctx, e: Entity) {
  const g = e.g;
  const def = c.dwg.imageDefs.get(str(g, 340));
  if (def) c.stats.images.add(def.path);
  else count(c, 'IMAGE');
  const p = pt(g, 10);
  const uu = pt(g, 11);
  const vv = pt(g, 12);
  const size = pt(g, 13, [1, 1]);
  const a: P = [uu[0] * size[0], uu[1] * size[0]];
  const b: P = [vv[0] * size[1], vv[1] * size[1]];
  const local: P[] = [p, [p[0] + a[0], p[1] + a[1]], [p[0] + a[0] + b[0], p[1] + a[1] + b[1]], [p[0] + b[0], p[1] + b[1]]];
  const corners = local.map((q) => apply(c.m, q));
  // A placeholder frame where the picture would be.
  c.out.push({ ...strokeOf(c, e, polyPath(corners, true)), rgb: [0.5, 0.5, 0.5], dash: null });
}

// ---- hatch -----------------------------------------------------------------------------------

interface HatchData {
  solid: boolean;
  loops: Cmd[][];
  lines: { angle: number; base: P; offset: P; dashes: number[] }[];
}

/** Reads a HATCH's boundary loops (OCS) and pattern definition lines. */
export function readHatch(g: Groups): HatchData {
  let i = 0;
  const at = (code: number) => {
    while (i < g.length && g[i]![0] !== code) i++;
    return i < g.length ? Number(g[i++]![1]) : 0;
  };
  const next = () => g[i++]!;
  const peek = () => g[i]?.[0];
  const solid = num(g, 70) === 1;
  const loops: Cmd[][] = [];
  const count91 = at(91);
  for (let l = 0; l < count91 && i < g.length; l++) {
    const type = at(92);
    const d: Cmd[] = [];
    if (type & 2) {
      const hasBulge = at(72);
      at(73); // closed flag: hatch loops are closed whatever it says
      const n = at(93);
      const verts: { p: P; bulge: number }[] = [];
      for (let k = 0; k < n; k++) {
        const x = at(10);
        const y = at(20);
        let bulge = 0;
        if (hasBulge && peek() === 42) bulge = Number(next()[1]);
        verts.push({ p: [x, y], bulge });
      }
      d.push(...bulgePath(verts, true));
    } else {
      const n = at(93);
      let cur: P | null = null;
      const goTo = (p: P) => {
        if (!cur) d.push(['M', p[0], p[1]]);
        else if (Math.hypot(cur[0] - p[0], cur[1] - p[1]) > 1e-9) d.push(['L', p[0], p[1]]);
      };
      for (let k = 0; k < n; k++) {
        const et = at(72);
        if (et === 1) {
          const a: P = [at(10), at(20)];
          const b: P = [at(11), at(21)];
          goTo(a);
          d.push(['L', b[0], b[1]]);
          cur = b;
        } else if (et === 2 || et === 3) {
          const ctr: P = [at(10), at(20)];
          let m: M;
          if (et === 2) m = circleM(ctr, at(40));
          else {
            const maj: P = [at(11), at(21)];
            const ratio = at(40);
            m = [maj[0], maj[1], -maj[1] * ratio, maj[0] * ratio, ctr[0], ctr[1]];
          }
          const s = (at(50) * Math.PI) / 180;
          const e = (at(51) * Math.PI) / 180;
          const ccw = at(73) !== 0;
          let a0: number;
          let a1: number;
          if (ccw) {
            a0 = s;
            a1 = e;
            while (a1 <= a0) a1 += 2 * Math.PI;
          } else {
            // Clockwise edges store complementary angles (360 - a).
            a0 = -s;
            a1 = -e;
            while (a1 >= a0) a1 -= 2 * Math.PI;
          }
          goTo(apply(m, [Math.cos(a0), Math.sin(a0)]));
          d.push(...arcCmds(m, a0, a1, false));
          cur = apply(m, [Math.cos(a1), Math.sin(a1)]);
        } else if (et === 4) {
          const degree = at(94);
          at(73);
          at(74);
          const nk = at(95);
          const nc = at(96);
          const knots: number[] = [];
          for (let q = 0; q < nk; q++) knots.push(at(40));
          const ctrl: P[] = [];
          const weights: number[] = [];
          for (let q = 0; q < nc; q++) {
            ctrl.push([at(10), at(20)]);
            if (peek() === 42) weights.push(Number(next()[1]));
          }
          const pts = bspline(degree, ctrl, knots, weights.length === nc ? weights : null, Math.max(16, nc * 8));
          if (pts.length) {
            goTo(pts[0]!);
            for (const p of pts.slice(1)) d.push(['L', p[0], p[1]]);
            cur = pts[pts.length - 1]!;
          }
          // Fit points and tangents may follow (97, 11/21, 12/22, 13/23): skipped by the next at().
        }
      }
      d.push(['Z']);
    }
    loops.push(d);
    // Source boundary objects.
    const nb = peek() === 97 ? Number(next()[1]) : 0;
    for (let k = 0; k < nb && peek() === 330; k++) next();
  }
  const lines: HatchData['lines'] = [];
  if (!solid) {
    const j = g.findIndex(([code]) => code === 78);
    if (j >= 0) {
      i = j + 1;
      const n = Number(g[j]![1]);
      for (let k = 0; k < n; k++) {
        const angle = (at(53) * Math.PI) / 180;
        const base: P = [at(43), at(44)];
        const offset: P = [at(45), at(46)];
        const nd = at(79);
        const dashes: number[] = [];
        for (let q = 0; q < nd; q++) dashes.push(at(49));
        lines.push({ angle, base, offset, dashes });
      }
    }
  }
  return { solid, loops, lines };
}

function hatch(c: Ctx, e: Entity) {
  const data = readHatch(e.g);
  if (!data.loops.length) return;
  const m = om(c, e);
  const clip = data.loops.flatMap((d) => mapCmds(m, d));
  const rgb = plotRgb(rawRgb(c, e), c.opts.colorMode);
  const layer = layerOf(c, e).name;
  const gradient = e.g.some(([code]) => code === 450) && num(e.g, 450) !== 0;
  if (data.solid || gradient || !data.lines.length) {
    c.out.push({ k: 'fill', d: clip, rgb, layer });
    return;
  }
  // Pattern lines across the boundary's box, in OCS, then clipped by the boundary when drawn.
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const d of data.loops)
    for (const cmd of d) {
      if (cmd[0] === 'Z') continue;
      for (let k = 1; k < cmd.length; k += 2) {
        const x = cmd[k] as number;
        const y = cmd[k + 1] as number;
        box.x0 = Math.min(box.x0, x);
        box.x1 = Math.max(box.x1, x);
        box.y0 = Math.min(box.y0, y);
        box.y1 = Math.max(box.y1, y);
      }
    }
  const corners: P[] = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
  ];
  const segs: Cmd[] = [];
  let total = 0;
  for (const line of data.lines) {
    const dir: P = [Math.cos(line.angle), Math.sin(line.angle)];
    const nrm: P = [-dir[1], dir[0]];
    const spacing = line.offset[0] * nrm[0] + line.offset[1] * nrm[1];
    if (Math.abs(spacing) < 1e-9) continue;
    const proj = corners.map((q) => ((q[0] - line.base[0]) * nrm[0] + (q[1] - line.base[1]) * nrm[1]) / spacing);
    const k0 = Math.floor(Math.min(...proj));
    const k1 = Math.ceil(Math.max(...proj));
    const period = line.dashes.reduce((a, b) => a + Math.abs(b), 0);
    // A line of nothing but gaps draws nothing (and would otherwise step along forever).
    if (line.dashes.length && !line.dashes.some((d) => d >= 0)) continue;
    for (let k = k0; k <= k1; k++) {
      const o: P = [line.base[0] + line.offset[0] * k, line.base[1] + line.offset[1] * k];
      const along = corners.map((q) => (q[0] - o[0]) * dir[0] + (q[1] - o[1]) * dir[1]);
      const s0 = Math.min(...along);
      const s1 = Math.max(...along);
      const seg = (a: number, b: number) => {
        const p = apply(m, [o[0] + dir[0] * a, o[1] + dir[1] * a]);
        const q = apply(m, [o[0] + dir[0] * b, o[1] + dir[1] * b]);
        segs.push(['M', p[0], p[1]], ['L', q[0], q[1]]);
        total++;
      };
      if (!line.dashes.length || period <= 0) seg(s0, s1);
      else if (period < (s1 - s0) / 1e6) {
        // Dashes far too fine for the area: give up rather than step a million times.
        total = MAX_HATCH_SEGMENTS + 1;
      } else {
        let s = Math.floor(s0 / period) * period;
        let steps = 0;
        while (s < s1 && total <= MAX_HATCH_SEGMENTS && steps++ <= MAX_HATCH_SEGMENTS * 4) {
          for (const dash of line.dashes) {
            const len = Math.abs(dash);
            if (dash > 0) seg(Math.max(s, s0), Math.min(s + len, s1));
            else if (dash === 0) seg(s, s + period * 0.001);
            const next = s + len;
            // Past what floating point can still add to, s stops moving: stop too.
            if (next === s && len > 0) steps = Infinity;
            s = next;
            if (s >= s1) break;
          }
        }
        if (steps > MAX_HATCH_SEGMENTS * 4) total = MAX_HATCH_SEGMENTS + 1;
      }
      if (total > MAX_HATCH_SEGMENTS) break;
    }
    if (total > MAX_HATCH_SEGMENTS) break;
  }
  if (total > MAX_HATCH_SEGMENTS) {
    count(c, 'HATCH (pattern too dense)');
    return;
  }
  const s = strokeOf(c, e, []);
  c.out.push({ k: 'hatch', clip, lines: segs, rgb, layer, width: Math.min(s.width, 0.25 * PT_PER_MM) });
}
