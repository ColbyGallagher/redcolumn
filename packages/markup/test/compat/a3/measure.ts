// Measurement pages: every measurement tool at a metric scale, again at an architectural imperial
// scale, then viewports (regions at their own scale) and unusual scales. Each cell is captioned
// with what redcolumn itself reads ("rc: ...") so the label Bluebeam shows can be compared.
import { DEFAULT_SCALE, SCALE_PRESETS, measureLabel, type MeasureKind, type Scale } from '@nb/measure';
import { mk, PageBuilder, type PageSpec } from './lib.ts';
import type { Markup, Point, Rect } from '../../../src/model.ts';
import type { Viewport } from '../../../src/viewports.ts';
import { ngon } from './shapes.ts';

export const preset = (label: string): Scale => {
  const s = SCALE_PRESETS.find((p) => p.label === label);
  if (!s) throw new Error(`no scale preset ${label}`);
  return s.scale;
};

const rcLabel = (kind: MeasureKind, points: Point[], scale: Scale, props: Partial<Markup> = {}) => {
  try {
    return measureLabel(kind, points, scale, { holes: props.holes, depth: props.depth, slope: props.slope, bulges: props.bulges }).replace(/\s+/g, ' ');
  } catch {
    return '?';
  }
};

/** Builds a measurement markup and returns it with its redcolumn label as a note. */
function meas(kind: MeasureKind, points: Point[], scale: Scale, extra: Partial<Markup> = {}, style: Partial<Markup['style']> = {}): { m: Markup; note: string } {
  const m = mk(kind, 0, points, extra, style);
  return { m, note: `rc: ${rcLabel(kind, points, scale, extra)}` };
}

const rectPts = (r: Rect, w = r.w, h = r.h): Point[] => [[r.x, r.y], [r.x + w, r.y], [r.x + w, r.y + h], [r.x, r.y + h]];

/** The standard set of measurement cells on a page whose scale is `scale`. */
function standardSet(P: PageBuilder, scale: Scale, depth: number) {
  /** A cell whose bottom line carries what redcolumn itself reads for each measurement in it. */
  const cell = (label: string, size: [number, number] | null, build: (r: Rect) => { m: Markup; note: string }[]) => {
    P.cell(label, size, (r, c) => {
      const out = build(r);
      const notes = out.map((o) => o.note).join(' | ');
      if (notes) P.spec.captions.push({ x: c.x + 5, y: c.y + c.h - 5, text: notes.slice(0, 90), size: 5.5 });
      return out.map((o) => o.m);
    });
  };
  const S = scale;

  cell('M01 length, horizontal 100 pt', null, (r) => [meas('length', [[r.x, r.y + 40], [r.x + 100, r.y + 40]], S)]);
  cell('M02 length, diagonal 3-4-5 (120 x 90 pt)', null, (r) => [meas('length', [[r.x, r.y], [r.x + 120, r.y + 90]], S)]);
  cell('M03 length, leader +16 and -16 (extension lines)', null, (r) => [
    meas('length', [[r.x, r.y + 20], [r.x + 110, r.y + 20]], S, { subject: 'M03 leader +16' }, { leader: 16 }),
    meas('length', [[r.x, r.y + 55], [r.x + 110, r.y + 55]], S, { subject: 'M03 leader -16' }, { leader: -16 }),
  ]);
  cell('M04 length, label slid +30 and rotated 25', null, (r) => [
    meas('length', [[r.x, r.y + 25], [r.x + 130, r.y + 25]], S, { subject: 'M04 labelOffset 30' }, { labelOffset: 30 }),
    meas('length', [[r.x, r.y + 60], [r.x + 130, r.y + 60]], S, { subject: 'M04 labelRotation 25' }, { labelRotation: 25 }),
  ]);
  cell('M05 length label: hidden / no background / yellow / 14pt', [2, 1], (r) => [
    meas('length', [[r.x, r.y + 10], [r.x + 140, r.y + 10]], S, { subject: 'M05 hidden' }, { showLabel: false }),
    meas('length', [[r.x, r.y + 40], [r.x + 140, r.y + 40]], S, { subject: 'M05 no background' }, { labelBackground: null }),
    meas('length', [[r.x + 180, r.y + 10], [r.x + 320, r.y + 10]], S, { subject: 'M05 yellow' }, { labelBackground: '#fde047' }),
    meas('length', [[r.x + 180, r.y + 50], [r.x + 320, r.y + 50]], S, { subject: 'M05 14pt' }, { fontSize: 14 }),
  ]);
  cell('M06 length with slope: pitch 6:12, 15 deg, 10%', null, (r) =>
    ([{ kind: 'pitch', value: 6 }, { kind: 'degrees', value: 15 }, { kind: 'percent', value: 10 }] as const).map((sl, i) =>
      meas('length', [[r.x, r.y + 8 + i * 25], [r.x + 110, r.y + 8 + i * 25]], S, { slope: sl, subject: `M06 slope ${sl.kind} ${sl.value}` }),
    ),
  );
  cell('M07 length with depth (wall area)', null, (r) => [meas('length', [[r.x, r.y + 30], [r.x + 120, r.y + 30]], S, { depth })]);
  cell('M08 polylength 5 points', null, (r) => [meas('polylength', [[r.x, r.y + 60], [r.x + 40, r.y], [r.x + 80, r.y + 60], [r.x + 120, r.y], [r.x + 160, r.y + 60]], S)]);
  cell('M09 polylength with curved segments (bulges)', null, (r) => [meas('polylength', [[r.x, r.y + 40], [r.x + 55, r.y + 40], [r.x + 110, r.y + 40], [r.x + 160, r.y + 40]], S, { bulges: [0.5, 0, -0.4] })]);
  cell('M10 area, rectangle 100 x 60', null, (r) => [meas('area', rectPts(r, 100, 60), S)]);
  cell('M11 area, L-shape', null, (r) => [meas('area', [[r.x, r.y], [r.x + 60, r.y], [r.x + 60, r.y + 30], [r.x + 120, r.y + 30], [r.x + 120, r.y + 70], [r.x, r.y + 70]], S)]);
  cell('M12 area with one cutout', null, (r) => [meas('area', rectPts(r, 130, 70), S, { holes: [rectPts({ x: r.x + 40, y: r.y + 20, w: 40, h: 30 })] })]);
  cell('M13 area with two cutouts, hatched', null, (r) => [meas('area', rectPts(r, 150, 70), S, { holes: [rectPts({ x: r.x + 15, y: r.y + 15, w: 40, h: 40 }), ngon(r.x + 110, r.y + 35, 22, 22, 6)] }, { hatch: 'diagonalUp' })]);
  cell('M14 area, sloped 20 deg, green fill', null, (r) => [meas('area', rectPts(r, 120, 60), S, { slope: { kind: 'degrees', value: 20 } }, { fill: '#22c55e', fillOpacity: 0.35 })]);
  cell('M15 area with depth (volume value)', null, (r) => [meas('area', rectPts(r, 120, 60), S, { depth })]);
  cell('M16 area with curved edges (bulges)', null, (r) => [meas('area', rectPts(r, 130, 70), S, { bulges: [0.2, 0, -0.15, 0] })]);
  cell('M17 perimeter, rectangle; perimeter with cutout', [2, 1], (r) => [
    meas('perimeter', rectPts({ x: r.x, y: r.y + 5, w: 130, h: 70 }), S, { subject: 'M17 perimeter' }),
    meas('perimeter', rectPts({ x: r.x + 170, y: r.y + 5, w: 150, h: 70 }), S, { subject: 'M17 perimeter with cutout', holes: [rectPts({ x: r.x + 200, y: r.y + 25, w: 50, h: 30 })] }),
  ]);
  cell('M18 count, 6 items (default marker)', null, (r) => [meas('count', Array.from({ length: 6 }, (_, i) => [r.x + 8 + i * 26, r.y + 20 + (i % 2) * 30] as Point), S)]);
  cell('M19 count marker shapes (6 kinds, 3 points each)', [2, 1], (r) =>
    (['circle', 'check', 'square', 'diamond', 'triangle', 'cross'] as const).map((sh, i) =>
      meas('count', [0, 1, 2].map((k) => [r.x + 10 + i * 56, r.y + 8 + k * 24] as Point), S, { subject: `M19 count ${sh}` }, { countShape: sh, stroke: ['#9333ea', '#16a34a', '#2563eb', '#ea580c', '#dc2626', '#0f766e'][i]!, fill: ['#9333ea', '#16a34a', '#2563eb', '#ea580c', '#dc2626', '#0f766e'][i]! }),
    ),
  );
  cell('M20 count marker sizes 3 / 8 / 14', null, (r) => [3, 8, 14].map((a, i) => meas('count', [[r.x + 15 + i * 45, r.y + 35]], S, { subject: `M20 count radius ${a}` }, { arcRadius: a })));
  cell('M21 count: one point; 100-point grid', [2, 1], (r) => [
    meas('count', [[r.x + 5, r.y + 10]], S, { subject: 'M21 count single' }),
    meas('count', Array.from({ length: 100 }, (_, i) => [r.x + 40 + (i % 20) * 14, r.y + 6 + Math.floor(i / 20) * 14] as Point), S, { subject: 'M21 count x100' }, { arcRadius: 4 }),
  ]);
  cell('M22 angle 90 deg, 45 deg, 135 deg', [2, 1], (r) => [
    meas('angle', [[r.x + 60, r.y + 70], [r.x, r.y + 70], [r.x, r.y + 10]], S, { subject: 'M22 angle 90' }),
    meas('angle', [[r.x + 190, r.y + 70], [r.x + 110, r.y + 70], [r.x + 166, r.y + 14]], S, { subject: 'M22 angle 45' }),
    meas('angle', [[r.x + 330, r.y + 70], [r.x + 250, r.y + 70], [r.x + 194, r.y + 14]], S, { subject: 'M22 angle 135' }),
  ]);
  cell('M23 angle, reflex arrangement and very small (2 deg)', null, (r) => [
    meas('angle', [[r.x + 10, r.y + 10], [r.x + 70, r.y + 40], [r.x + 10, r.y + 70]], S, { subject: 'M23 reflex-looking' }),
    meas('angle', [[r.x + 160, r.y + 50], [r.x + 80, r.y + 50], [r.x + 160, r.y + 47.2]], S, { subject: 'M23 2 deg' }),
  ]);
  cell('M24 diameter', null, (r) => [meas('diameter', [[r.x + 10, r.y + 40], [r.x + 80, r.y + 40]], S)]);
  cell('M25 radius', null, (r) => [meas('radius', [[r.x + 50, r.y + 40], [r.x + 85, r.y + 40]], S)]);
  cell('M26 arc length (3 points)', null, (r) => [meas('arcLength', [[r.x, r.y + 60], [r.x + 70, r.y], [r.x + 150, r.y + 60]], S)]);
  cell('M27 volume (polygon, depth)', null, (r) => [meas('volume', rectPts(r, 110, 60), S, { depth })]);
  cell('M28 volume with cutout, hatched', null, (r) => [meas('volume', rectPts(r, 130, 70), S, { depth, holes: [rectPts({ x: r.x + 45, y: r.y + 20, w: 40, h: 30 })] }, { hatch: 'dots20' })]);
  cell('M29 measurement: dashed, 3pt, orange, with arrow caps', null, (r) => [meas('length', [[r.x, r.y + 30], [r.x + 140, r.y + 30]], S, {}, { dash: 'dashed', width: 3, stroke: '#ea580c', startCap: 'openArrow', endCap: 'closedArrow' })]);
  cell('M30 edge: zero-length length; 1 pt2 area; huge area', null, (r) => [
    meas('length', [[r.x + 10, r.y + 10], [r.x + 10, r.y + 10]], S, { subject: 'M30 zero length' }),
    meas('area', [[r.x + 30, r.y + 10], [r.x + 31, r.y + 10], [r.x + 31, r.y + 11], [r.x + 30, r.y + 11]], S, { subject: 'M30 1pt area' }),
    meas('area', rectPts({ x: r.x + 50, y: r.y - 4, w: 110, h: 84 }), S, { subject: 'M30 whole-cell area' }),
  ]);
}

export function metric(p0: number): PageSpec {
  const scale = preset('1:100');
  const P = new PageBuilder(p0, { title: 'Measurements, metric 1:100', sheet: 'M-101', scale });
  standardSet(P, scale, 0.3);
  return P.spec;
}

export function imperial(p0: number): PageSpec {
  const scale = preset('1/8" = 1\'-0"');
  const P = new PageBuilder(p0, { title: 'Measurements, imperial 1/8" = 1\'-0"', sheet: 'M-102', scale });
  standardSet(P, scale, 0.1524);
  return P.spec;
}

/** Metric 1:50 page with two viewports at their own scales, and a measurement straddling one. */
export function viewports(p0: number): { page: PageSpec; viewports: Viewport[] } {
  const scale = preset('1:50');
  const P = new PageBuilder(p0, { title: 'Viewports: 1:50 page, 1:20 and 1:10 details', sheet: 'M-103', scale });
  const vps: Viewport[] = [];
  const S = scale;
  P.cell('V01 page scale 1:50: length, area', null, (r) => [meas('length', [[r.x, r.y + 20], [r.x + 100, r.y + 20]], S).m, meas('area', rectPts({ x: r.x, y: r.y + 35, w: 100, h: 40 }), S).m]);
  for (const [name, label, id] of [['Detail 1 (1:20)', '1:20', 'vp-1'], ['Section A (1:10)', '1:10', 'vp-2']] as const) {
    const vs = preset(label);
    const c = P.alloc(2, 2);
    const rect = { x: c.x + 6, y: c.y + 14, w: c.w - 12, h: c.h - 20 };
    vps.push({ id, pageIndex: p0, name, rect, scale: vs });
    P.spec.extras.push((cv) => cv.rect(rect, { width: 1, dash: [6, 3], stroke: [0.6, 0.1, 0.1] }));
    P.spec.captions.push({ x: c.x + 8, y: c.y + 10, text: `${name}: viewport, scale ${label}`, size: 7 });
    const out = [
      meas('length', [[rect.x + 20, rect.y + 25], [rect.x + 160, rect.y + 25]], vs, { subject: `${name} length` }),
      meas('area', rectPts({ x: rect.x + 20, y: rect.y + 50, w: 120, h: 60 }), vs, { subject: `${name} area` }),
      meas('count', [[rect.x + 200, rect.y + 40], [rect.x + 220, rect.y + 60], [rect.x + 240, rect.y + 80]], vs, { subject: `${name} count` }),
      meas('angle', [[rect.x + 300, rect.y + 120], [rect.x + 230, rect.y + 120], [rect.x + 290, rect.y + 70]], vs, { subject: `${name} angle` }),
    ];
    for (const o of out) o.m.pageIndex = p0;
    P.spec.markups.push(...out.map((o) => o.m));
    P.spec.captions.push({ x: c.x + 8, y: c.y + c.h - 4, text: out.map((o) => o.note).join(' | ').slice(0, 120), size: 5.5 });
  }
  P.cell('V04 outside every viewport: page scale 1:50 applies', null, (r) => [meas('length', [[r.x, r.y + 30], [r.x + 140, r.y + 30]], S).m]);
  // Which scale a measurement uses is decided by its first point.
  const first = vps[0]!.rect;
  const second = vps[1]!.rect;
  const startsInside = meas('length', [[first.x + 100, first.y + first.h - 40], [first.x + 100, first.y + first.h + 40]], vps[0]!.scale, { subject: 'V05 starts inside Detail 1, ends outside (uses 1:20)' });
  const startsOutside = meas('length', [[second.x + 100, second.y + second.h + 40], [second.x + 100, second.y + second.h - 40]], S, { subject: 'V06 starts outside Section A, ends inside (uses page 1:50)' });
  P.add(startsInside.m, startsOutside.m);
  P.spec.captions.push({ x: first.x + 104, y: first.y + first.h + 20, text: 'V05 starts inside, ends outside', size: 6 }, { x: second.x + 104, y: second.y + second.h + 20, text: 'V06 starts outside, ends inside', size: 6 });
  return { page: P.spec, viewports: vps };
}

/** Pages at other scales: engineering decimal, 1/4" imperial, calibrated, non-uniform, unset. */
export function oddScales(p0: number): PageSpec[] {
  const out: PageSpec[] = [];
  const variants: { title: string; sheet: string; scale: Scale | undefined; note: string }[] = [
    { title: 'Measurements, engineering 1" = 20\'', sheet: 'M-104', scale: preset('1" = 20\''), note: 'decimal feet' },
    { title: 'Measurements, 1/4" = 1\'-0" inches', sheet: 'M-105', scale: { ...preset('1/4" = 1\'-0"'), unit: 'in', feetInches: true, precision: 8, label: '1/4" = 1\'-0" (in)' }, note: 'fractional inches' },
    { title: 'Measurements, calibrated (50 mm per pt), mm + m2', sheet: 'M-106', scale: { metersPerPoint: 0.05, unit: 'mm', areaUnit: 'm', feetInches: false, precision: 0, label: 'Calibrated 1 pt = 50 mm' }, note: 'mm lengths, m2 areas' },
    { title: 'Measurements, non-uniform scale (Y is half of X)', sheet: 'M-107', scale: { metersPerPoint: 0.04, yMetersPerPoint: 0.02, unit: 'm', feetInches: false, precision: 2, label: 'Non-uniform 1:2 in Y' }, note: 'anisotropic' },
    { title: 'Measurements, page scale never set', sheet: 'M-108', scale: undefined, note: 'no scale in the file: each app uses its own default' },
  ];
  variants.forEach((v, i) => {
    const P = new PageBuilder(p0 + i, { title: v.title, sheet: v.sheet, ...(v.scale ? { scale: v.scale } : {}), note: v.note });
    const S = v.scale ?? DEFAULT_SCALE;
    const cell = (label: string, size: [number, number] | null, build: (r: Rect) => { m: Markup; note: string }[]) =>
      P.cell(label, size, (r, c) => {
        const o = build(r);
        P.spec.captions.push({ x: c.x + 5, y: c.y + c.h - 5, text: (v.scale ? o.map((x) => x.note).join(' | ') : "no page scale: the app's default decides").slice(0, 90), size: 5.5 });
        return o.map((x) => x.m);
      });
    cell('length 100 pt', null, (r) => [meas('length', [[r.x, r.y + 30], [r.x + 100, r.y + 30]], S)]);
    cell('length vertical 100 pt', null, (r) => [meas('length', [[r.x + 30, r.y], [r.x + 30, r.y + 80]], S)]);
    cell('polylength', null, (r) => [meas('polylength', [[r.x, r.y + 60], [r.x + 50, r.y], [r.x + 100, r.y + 60], [r.x + 150, r.y]], S)]);
    cell('area 100 x 60', null, (r) => [meas('area', rectPts(r, 100, 60), S)]);
    cell('perimeter 100 x 60', null, (r) => [meas('perimeter', rectPts(r, 100, 60), S)]);
    cell('count 4', null, (r) => [meas('count', [[r.x + 10, r.y + 10], [r.x + 50, r.y + 40], [r.x + 90, r.y + 10], [r.x + 130, r.y + 40]], S)]);
    cell('angle 60 deg', null, (r) => [meas('angle', [[r.x + 100, r.y + 70], [r.x, r.y + 70], [r.x + 50, r.y + 70 - 86.6]], S)]);
    cell('diameter / radius', null, (r) => [meas('diameter', [[r.x, r.y + 20], [r.x + 100, r.y + 20]], S, { subject: 'diameter' }), meas('radius', [[r.x + 50, r.y + 60], [r.x + 110, r.y + 60]], S, { subject: 'radius' })]);
    cell('arc length', null, (r) => [meas('arcLength', [[r.x, r.y + 60], [r.x + 70, r.y], [r.x + 140, r.y + 60]], S)]);
    cell('volume depth 0.25 m', null, (r) => [meas('volume', rectPts(r, 100, 60), S, { depth: 0.25 })]);
    cell('length with slope 10 deg', null, (r) => [meas('length', [[r.x, r.y + 30], [r.x + 120, r.y + 30]], S, { slope: { kind: 'degrees', value: 10 } })]);
    out.push(P.spec);
  });
  return out;
}
