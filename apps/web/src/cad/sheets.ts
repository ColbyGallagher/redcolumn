import type { LengthUnit } from '@nb/measure';
import { headerNum, INSUNITS_M, num, pt, type Drawing, type Entity, type Layout } from './drawing';
import { apply, boxEmpty, emptyBox, grow, pathBox, polyPath, rotate, scale, then, translate, type Box, type Cmd, type M, type P } from './geom';
import { frameOf, newStats, renderEntities, type Ctx, type Prim, type RenderOptions, type RenderStats } from './render';

/**
 * Pages from a drawing: one per paper-space layout (at its plot paper size, viewports drawn
 * through their scales), or one page around model space when there are no layouts.
 */

export const PT_PER_MM = 72 / 25.4;

/** Metres per unit (as @nb/measure has them; copied so the converter's worker does not load that package). */
const METERS_PER_UNIT: Record<LengthUnit, number> = { in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, mm: 0.001, cm: 0.01, m: 1, km: 1000 };

export interface MeasureScale {
  /** "1:500" or an architectural label. */
  label: string;
  /** The ratio N of 1:N. */
  ratio: number;
  /** False when the ratio was not a standard one and is written as found. */
  standard: boolean;
  unit: LengthUnit;
  /** Feet and inches. */
  feetInches: boolean;
  /** Measure units per page point. */
  unitsPerPoint: number;
}

export interface SheetViewport {
  name: string;
  /** Page rectangle in points (PDF user space, origin bottom-left). */
  rect: { x: number; y: number; w: number; h: number };
  scale: MeasureScale;
  twistDeg: number;
  frozen: string[];
  planView: boolean;
}

export interface ScaleCheck {
  sheet: string;
  viewport: string;
  /** Length measured on the page through the viewport's scale, in drawing units. */
  measured: number;
  /** Length the dimension states, or null when the file does not record it. */
  stated: number | null;
}

export interface Sheet {
  name: string;
  width: number;
  height: number;
  prims: Prim[];
  viewports: SheetViewport[];
  /** Model-space pages are drawn at one scale over the whole page. */
  pageScale: MeasureScale | null;
  scaleChecks: ScaleCheck[];
}

export interface SheetOptions extends RenderOptions {
  /** Layout names to convert; all paper-space layouts when absent. */
  layouts?: readonly string[];
  /** Also a page for model space when the drawing has layouts. */
  includeModel?: boolean;
}

export interface Planned {
  sheets: Sheet[];
  stats: RenderStats;
  /** Notes for the report: units assumed, non-standard scales, non-plan views. */
  notes: ({ kind: 'units-assumed'; unit: string } | { kind: 'model-fit'; scale: string })[];
}

/** Drawing units: metres per unit and whether the drawing is imperial. */
export function drawingUnits(d: Drawing): { metersPerUnit: number; imperial: boolean; assumed: boolean } {
  const code = headerNum(d, '$INSUNITS', 0);
  const metric = headerNum(d, '$MEASUREMENT', 1) === 1;
  const m = INSUNITS_M[code];
  if (m) return { metersPerUnit: m, imperial: [1, 2, 3, 8, 9, 10, 21].includes(code), assumed: false };
  return { metersPerUnit: metric ? 0.001 : 0.0254, imperial: !metric, assumed: true };
}

/** The unit measurements are shown in, for drawing units of `metersPerUnit`. */
function measureUnit(metersPerUnit: number, imperial: boolean): { unit: LengthUnit; feetInches: boolean } {
  if (imperial) {
    if (metersPerUnit >= 1609) return { unit: 'mi', feetInches: false };
    if (Math.abs(metersPerUnit - 0.9144) < 1e-6) return { unit: 'yd', feetInches: false };
    return { unit: 'ft', feetInches: true };
  }
  const named: [LengthUnit, number][] = [
    ['mm', 0.001],
    ['cm', 0.01],
    ['m', 1],
    ['km', 1000],
  ];
  return { unit: named.find(([, m]) => Math.abs(m - metersPerUnit) < 1e-9)?.[0] ?? 'm', feetInches: false };
}

const METRIC_RATIOS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 12500, 20000, 25000, 50000, 100000, 200000, 250000, 500000];
const IMPERIAL: [number, string][] = [
  [1, '1:1'],
  [2, '6" = 1\'-0"'],
  [4, '3" = 1\'-0"'],
  [8, '1 1/2" = 1\'-0"'],
  [12, '1" = 1\'-0"'],
  [16, '3/4" = 1\'-0"'],
  [24, '1/2" = 1\'-0"'],
  [32, '3/8" = 1\'-0"'],
  [48, '1/4" = 1\'-0"'],
  [64, '3/16" = 1\'-0"'],
  [96, '1/8" = 1\'-0"'],
  [128, '3/32" = 1\'-0"'],
  [192, '1/16" = 1\'-0"'],
  [120, '1" = 10\''],
  [240, '1" = 20\''],
  [360, '1" = 30\''],
  [480, '1" = 40\''],
  [600, '1" = 50\''],
  [720, '1" = 60\''],
  [1200, '1" = 100\''],
  [2400, '1" = 200\''],
  [4800, '1" = 400\''],
];

/** A measured ratio snapped to a standard one when within 0.5%, with its label. */
export function snapRatio(ratio: number, imperial: boolean): { ratio: number; label: string; standard: boolean } {
  const near = (n: number) => Math.abs(n / ratio - 1) < 0.005;
  if (imperial) {
    const hit = IMPERIAL.find(([n]) => near(n));
    if (hit) return { ratio: hit[0], label: hit[1], standard: true };
  }
  const std = METRIC_RATIOS.find(near);
  if (std) return { ratio: std, label: `1:${std}`, standard: true };
  const rounded = Math.round(ratio);
  if (rounded > 0 && Math.abs(rounded / ratio - 1) < 1e-4) return { ratio: rounded, label: `1:${rounded}`, standard: false };
  const shown = ratio >= 10 ? ratio.toFixed(1) : ratio.toPrecision(4);
  return { ratio, label: `1:${Number(shown)}`, standard: false };
}

/**
 * The measure scale for `ptPerUnit` page points per drawing unit, given the paper's millimetres
 * per point: ratio N in "1:N" compares real length with length on paper.
 */
function measureScale(d: Drawing, ptPerUnit: number): MeasureScale {
  const { metersPerUnit, imperial } = drawingUnits(d);
  const paperMetersPerPoint = 0.0254 / 72;
  const exact = metersPerUnit / (ptPerUnit * paperMetersPerPoint);
  const snapped = snapRatio(exact, imperial);
  const { unit, feetInches } = measureUnit(metersPerUnit, imperial);
  // A nearby standard is useful for naming, but must not change PDF calibration.
  // Only absorb floating-point noise around an exactly standard ratio.
  const matches = Math.abs(exact - snapped.ratio) <= Math.max(1, Math.abs(exact)) * 1e-12;
  const ratio = matches ? snapped.ratio : exact;
  const label = matches ? snapped.label : `1:${Number(exact.toPrecision(12))}`;
  return { label, ratio, standard: matches && snapped.standard, unit, feetInches, unitsPerPoint: paperMetersPerPoint * ratio / METERS_PER_UNIT[unit] };
}

const ctxFor = (d: Drawing, opts: RenderOptions, stats: RenderStats, m: M, dashPt: number, frozen: ReadonlySet<string> = new Set()): Ctx => ({
  dwg: d,
  opts,
  out: [],
  m,
  dashPt,
  frozen,
  parent: null,
  depth: 0,
  stack: new Set(),
  stats,
});

/** Paper-space layouts that hold something besides their own overall viewport. */
export function paperLayouts(d: Drawing): { layout: Layout; entities: Entity[] }[] {
  return d.layouts.flatMap((layout) => {
    if (layout.isModel) return [];
    const entities = d.blockByRecord.get(layout.record)?.entities ?? [];
    const used = entities.some((e) => !(e.type === 'VIEWPORT' && num(e.g, 69) === 1));
    return used ? [{ layout, entities }] : [];
  });
}

export function planSheets(d: Drawing, opts: SheetOptions): Planned {
  const stats = newStats();
  const notes: Planned['notes'] = [];
  const units = drawingUnits(d);
  if (units.assumed) notes.push({ kind: 'units-assumed', unit: units.imperial ? 'inches' : 'millimetres' });
  const layouts = paperLayouts(d).filter(({ layout }) => !opts.layouts || opts.layouts.includes(layout.name));
  const sheets = layouts.map(({ layout, entities }) => layoutSheet(d, opts, stats, layout, entities));
  if (!paperLayouts(d).length || opts.includeModel) {
    const model = modelSheet(d, opts, stats);
    sheets.push(model);
    notes.push({ kind: 'model-fit', scale: model.pageScale!.label });
  }
  return { sheets, stats, notes };
}

// ---- layouts ---------------------------------------------------------------------------------

function layoutSheet(d: Drawing, opts: SheetOptions, stats: RenderStats, layout: Layout, entities: Entity[]): Sheet {
  const unitPt = layout.mm ? PT_PER_MM : 72;
  const p = layout.printScale || 1;
  const w = layout.paperWidth * PT_PER_MM;
  const h = layout.paperHeight * PT_PER_MM;
  const quarter = layout.rotation & 3;
  const width = quarter % 2 ? h : w;
  const height = quarter % 2 ? w : h;
  // Paper space to the unrotated paper, then the plot rotation onto the page.
  let m: M = then(scale(p * unitPt), translate((layout.margins[0] + layout.origin[0]) * PT_PER_MM, (layout.margins[1] + layout.origin[1]) * PT_PER_MM));
  if (quarter) {
    const turned = then(m, rotate((quarter * Math.PI) / 2));
    const shift: P = quarter === 1 ? [h, 0] : quarter === 2 ? [w, h] : [0, w];
    m = then(turned, translate(shift[0], shift[1]));
  }
  const paperDash = p * unitPt;
  const ctx = ctxFor(d, opts, stats, m, paperDash);
  const prims: Prim[] = [];
  const viewports: SheetViewport[] = [];
  const scaleChecks: ScaleCheck[] = [];
  const psLtScale = headerNum(d, '$PSLTSCALE', 1) !== 0;

  // Viewports draw beneath paper-space entities, in their file order, as plotting does.
  let n = 0;
  for (const vp of entities) {
    if (vp.type !== 'VIEWPORT' || num(vp.g, 69) === 1 || num(vp.g, 68, 1) <= 0) continue;
    const g = vp.g;
    const center = pt(g, 10);
    const vw = num(g, 40);
    const vh = num(g, 41);
    const viewHeight = num(g, 45);
    if (!(vw > 0 && vh > 0 && viewHeight > 0)) continue;
    n++;
    const k = vh / viewHeight;
    const twist = num(g, 51);
    const viewCenter = pt(g, 12);
    const target = pt(g, 17);
    const dir = [num(g, 16), num(g, 26), num(g, 36, 1)];
    const planView = Math.abs(dir[0]!) < 1e-9 && Math.abs(dir[1]!) < 1e-9;
    const toPaper: M = then(then(then(translate(-target[0], -target[1]), scale(k)), rotate((twist * Math.PI) / 180)), translate(center[0] - viewCenter[0] * k, center[1] - viewCenter[1] * k));
    const frozen = g.flatMap(([c, v]) => (c === 331 && d.layerByHandle.has(v) ? [d.layerByHandle.get(v)!] : []));
    const rectPaper: P[] = [
      [center[0] - vw / 2, center[1] - vh / 2],
      [center[0] + vw / 2, center[1] - vh / 2],
      [center[0] + vw / 2, center[1] + vh / 2],
      [center[0] - vw / 2, center[1] + vh / 2],
    ];
    // Non-rectangular viewports clip to their boundary entity.
    const boundary = num(g, 90) & 0x10000 ? d.byHandle.get(g.find(([c]) => c === 340)?.[1] ?? '') : undefined;
    const clipPaper = boundary ? boundaryPath(boundary) : null;
    const clip: Cmd[] = clipPaper ? mapCmds(m, clipPaper) : polyPath(rectPaper.map((q) => apply(m, q)), true);
    const vpStats = newStats();
    const inner = ctxFor(d, opts, vpStats, then(toPaper, m), psLtScale ? paperDash : paperDash * k, new Set(frozen));
    renderEntities(inner, d.modelSpace);
    mergeStats(stats, vpStats);
    prims.push({ k: 'clip', clip, prims: inner.out });
    const frame = frameOf(ctx, vp, clip);
    if (frame) prims.push(frame);

    const ptPerUnit = k * p * unitPt;
    const s = measureScale(d, ptPerUnit);
    const box = pathBox(clip);
    const name = `Viewport ${n}`;
    viewports.push({ name, rect: { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }, scale: s, twistDeg: twist, frozen, planView });
    for (const dim of vpStats.dims) scaleChecks.push({ sheet: layout.name, viewport: name, measured: dim.pageLength / ptPerUnit, stated: dim.measurement });
  }
  renderEntities(ctx, entities);
  prims.push(...ctx.out);
  return { name: layout.name, width, height, prims, viewports, pageScale: null, scaleChecks };
}

function mergeStats(into: RenderStats, from: RenderStats) {
  for (const [k, v] of from.skipped) into.skipped.set(k, (into.skipped.get(k) ?? 0) + v);
  for (const [k, v] of from.xrefs) into.xrefs.set(k, v);
  for (const v of from.images) into.images.add(v);
  for (const [k, v] of from.fonts) into.fonts.set(k, v);
}

function boundaryPath(e: Entity): Cmd[] | null {
  if (e.type !== 'LWPOLYLINE') return null;
  const pts: P[] = [];
  for (const [c, v] of e.g) {
    if (c === 10) pts.push([Number(v), 0]);
    else if (c === 20 && pts.length) pts[pts.length - 1]![1] = Number(v);
  }
  return pts.length > 2 ? polyPath(pts, true) : null;
}

const mapCmds = (m: M, d: Cmd[]): Cmd[] =>
  d.map((c): Cmd => {
    if (c[0] === 'Z') return c;
    if (c[0] === 'C') {
      const a = apply(m, [c[1], c[2]]);
      const b = apply(m, [c[3], c[4]]);
      const q = apply(m, [c[5], c[6]]);
      return ['C', a[0], a[1], b[0], b[1], q[0], q[1]];
    }
    const q = apply(m, [c[1], c[2]]);
    return [c[0], q[0], q[1]];
  });

// ---- model space -----------------------------------------------------------------------------

/** Largest page a model-space drawing is fitted to (A0, either way round), in mm. */
const MODEL_MAX_MM: [number, number] = [1189, 841];

function modelSheet(d: Drawing, opts: SheetOptions, stats: RenderStats): Sheet {
  const { metersPerUnit, imperial } = drawingUnits(d);
  // First pass in drawing units, for the extents.
  const probe = ctxFor(d, opts, newStats(), [1, 0, 0, 1, 0, 0], 1);
  renderEntities(probe, d.modelSpace);
  const box = primsBox(probe.out);
  if (boxEmpty(box)) {
    box.x0 = box.y0 = 0;
    box.x1 = box.y1 = 1;
  }
  const mmPerUnit = metersPerUnit * 1000;
  // A line can have zero width/height. Give such a model a real sheet and stroke clearance.
  if (box.x1 - box.x0 < 1e-9 || box.y1 - box.y0 < 1e-9) {
    const pad = 1 / mmPerUnit;
    box.x0 -= pad; box.y0 -= pad; box.x1 += pad; box.y1 += pad;
  }
  const ext = [(box.x1 - box.x0) * mmPerUnit, (box.y1 - box.y0) * mmPerUnit];
  const fits = (n: number) => Math.max(...ext) / n <= MODEL_MAX_MM[0] && Math.min(...ext) / n <= MODEL_MAX_MM[1];
  const ratios = imperial ? IMPERIAL.map(([n]) => n).sort((a, b) => a - b) : METRIC_RATIOS;
  const ratio = ratios.find(fits) ?? Math.max(...ext) / MODEL_MAX_MM[0];
  const s = (mmPerUnit * PT_PER_MM) / ratio;
  const m = then(translate(-box.x0, -box.y0), scale(s));
  const ctx = ctxFor(d, opts, stats, m, s);
  renderEntities(ctx, d.modelSpace);
  return { name: 'Model', width: ext[0]! / ratio * PT_PER_MM, height: ext[1]! / ratio * PT_PER_MM, prims: ctx.out, viewports: [], pageScale: measureScale(d, s), scaleChecks: [] };
}

/** Rough extents of primitives: paths exactly (with control points), text from its size. */
export function primsBox(prims: readonly Prim[], box: Box = emptyBox()): Box {
  for (const p of prims) {
    if (p.k === 'stroke' || p.k === 'fill') pathBox(p.d, box);
    else if (p.k === 'hatch') pathBox(p.clip, box);
    else if (p.k === 'clip') pathBox(p.clip, box);
    else {
      const chars = Math.max(...p.lines.map((l) => l.length), 1);
      const len = p.fit ?? p.wrap ?? chars * 0.6 * p.h * p.widthFactor;
      const x0 = -len * (p.halign / 2);
      const lines = p.block ? p.lines.length : 1;
      const top = p.valign === 3 ? 0 : p.valign === 2 ? (p.h + (lines - 1) * p.spacing) / 2 : p.valign === 1 ? p.h + (lines - 1) * p.spacing : p.h;
      const y0 = top - p.h - (lines - 1) * p.spacing;
      for (const [x, y] of [
        [x0, y0],
        [x0 + len, y0],
        [x0 + len, top],
        [x0, top],
      ] as P[])
        grow(box, p.origin[0] + p.u[0] * x + p.v[0] * y, p.origin[1] + p.u[1] * x + p.v[1] * y);
    }
  }
  return box;
}
