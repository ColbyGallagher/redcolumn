// Pages 1 and 2: open paths (lines, arrows, polylines, arcs, pen, custom line styles) and closed
// shapes (rectangles, ellipses, polygons, clouds, hatches).
import { mk, PageBuilder, type PageSpec } from './lib.ts';
import type { Point } from '../../../src/model.ts';
import type { CustomLine } from '../../../src/lineStyle.ts';
import type { LineEnding } from '../../../src/style.ts';
import { customHatchId } from '../../../src/hatches.ts';

const ENDINGS: LineEnding[] = ['none', 'openArrow', 'closedArrow', 'filledArrow', 'circle', 'filledCircle', 'square', 'filledSquare', 'diamond', 'filledDiamond', 'tick', 'slash'];

// Bluebeam's own Advanced line style set, as it stores them.
export const GAS: CustomLine = { name: 'Gas', spec: [true, [0, 18, -2, ['GAS', 'Helvetica', 6, false, false, true], -2]] };
export const ZIGZAG: CustomLine = { name: 'Zig Zag', spec: [true, [0, [7, 7, 1, false, 0, -7, 0, 1, -3, -4, 1, 4, 3, 1, 7, 0]]] };
export const DOUBLE: CustomLine = { name: 'Double', spec: [true, [-3], [3]] };
export const ROAD: CustomLine = { name: 'Road', spec: [true, [-3], [0, 3, -3], [3]] };
export const FENCE_CIRCLE: CustomLine = {
  name: 'Fenceline Circle',
  spec: [true, [0, 22, [2, 2, 1, false, 0, 0, -2, 2, 1.10457, -2, 2, 2, -1.10457, 2, 2, 0, 2, 2, 1.10457, 2, 1.10457, 2, 2, 0, 2, 2, -1.10457, 2, 2, -2, 1.10457, 2, -2, 0, 2, -2, -1.10457, 2, -1.10457, -2, 2, 0, -2]]],
};

/** A regular polygon's vertices. */
export function ngon(cx: number, cy: number, rx: number, ry: number, n: number, start = -Math.PI / 2): Point[] {
  return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos(start + (i * 2 * Math.PI) / n), cy + ry * Math.sin(start + (i * 2 * Math.PI) / n)] as Point);
}
export function star(cx: number, cy: number, ro: number, ri: number, n = 5): Point[] {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? ri : ro;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Point;
  });
}
const wave = (x: number, y: number, w: number, h: number, n: number, cycles = 3): Point[] =>
  Array.from({ length: n }, (_, i) => [x + (w * i) / (n - 1), y + h / 2 + (h / 2) * Math.sin((i / (n - 1)) * Math.PI * 2 * cycles)] as Point);

export function lines(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Lines, arrows and paths', sheet: 'A-101' });
  P.cell('L01 line, default style', null, (r) => [mk('line', 0, [[r.x, r.y + r.h / 2], [r.x + r.w, r.y + r.h / 2]])]);
  P.cell('L02 line widths 0.25 / 3 / 12', null, (r) => [0.25, 3, 12].map((w, i) => mk('line', 0, [[r.x, r.y + 12 + i * 26], [r.x + r.w, r.y + 12 + i * 26]], { subject: `L02 width ${w}` }, { width: w })));
  P.cell('L03 dashes: dashed longDash dotted dashDot dashDotDot', null, (r) =>
    (['dashed', 'longDash', 'dotted', 'dashDot', 'dashDotDot'] as const).map((d, i) => mk('line', 0, [[r.x, r.y + 5 + i * 15], [r.x + r.w, r.y + 5 + i * 15]], { subject: `L03 ${d}` }, { width: 2, dash: d })),
  );
  P.cell('L04 exact dash arrays [10 2 2 2] [0.5 4] [30 10]', null, (r) =>
    ([[10, 2, 2, 2], [0.5, 4], [30, 10]] as number[][]).map((a, i) => mk('line', 0, [[r.x, r.y + 12 + i * 26], [r.x + r.w, r.y + 12 + i * 26]], { subject: `L04 [${a}]` }, { width: 2, dashArray: a, dash: 'dashed' })),
  );
  P.cell('L05 arrow, default', null, (r) => [mk('arrow', 0, [[r.x, r.y + r.h / 2], [r.x + r.w, r.y + r.h / 2 - 20]])]);
  P.cell('L06 arrow both ends, blue, 3pt', null, (r) => [mk('arrow', 0, [[r.x, r.y + 20], [r.x + r.w, r.y + 60]], {}, { stroke: '#1d4ed8', width: 3, startCap: 'filledArrow', endCap: 'filledArrow' })]);
  P.cell('L07 every line ending, start and end (12 lines)', [2, 2], (r) =>
    ENDINGS.map((e, i) => mk('line', 0, [[r.x + 10, r.y + 6 + i * 15.5], [r.x + r.w - 10, r.y + 6 + i * 15.5]], { subject: `L07 ${e} -> ${ENDINGS[(i + 5) % 12]}` }, { width: 1.5, startCap: e, endCap: ENDINGS[(i + 5) % 12]! })),
  );
  P.cell('L08 line ending size x0.5 x2 x3', null, (r) =>
    [0.5, 2, 3].map((s, i) => mk('arrow', 0, [[r.x, r.y + 12 + i * 26], [r.x + r.w, r.y + 12 + i * 26]], { subject: `L08 capScale ${s}` }, { width: 2, endCap: 'closedArrow', capScale: s })),
  );
  P.cell('L09 opacity .3, 10pt crossing lines (blend)', null, (r) => [
    mk('line', 0, [[r.x, r.y], [r.x + r.w, r.y + r.h]], {}, { width: 10, opacity: 0.3, stroke: '#dc2626' }),
    mk('line', 0, [[r.x, r.y + r.h], [r.x + r.w, r.y]], {}, { width: 10, opacity: 0.3, stroke: '#2563eb' }),
  ]);
  P.cell('L10 polyline zigzag, 7 points', null, (r) => [mk('polyline', 0, Array.from({ length: 7 }, (_, i) => [r.x + (r.w * i) / 6, r.y + (i % 2 ? r.h : 0)] as Point))]);
  P.cell('L11 polyline dashed + open arrow + circle', null, (r) => [mk('polyline', 0, [[r.x, r.y + r.h], [r.x + 50, r.y + 10], [r.x + 110, r.y + r.h - 10], [r.x + r.w, r.y + 20]], {}, { dash: 'dashed', startCap: 'circle', endCap: 'openArrow', width: 2 })]);
  P.cell('L12 polyline rounded corners r=10', null, (r) => [mk('polyline', 0, [[r.x, r.y + r.h], [r.x + 60, r.y], [r.x + 110, r.y + r.h], [r.x + r.w, r.y + 10]], {}, { cornerRadius: 10, width: 2 })]);
  P.cell('L13 polyline with two points', null, (r) => [mk('polyline', 0, [[r.x, r.y + 10], [r.x + r.w, r.y + r.h - 10]])]);
  P.cell('L14 polyline closed on itself (first = last)', null, (r) => [mk('polyline', 0, [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]])]);
  P.cell('L15 arc', null, (r) => [mk('arc', 0, [[r.x, r.y + r.h], [r.x + r.w / 2, r.y], [r.x + r.w, r.y + r.h]])]);
  P.cell('L16 arc dashed with arrow', null, (r) => [mk('arc', 0, [[r.x, r.y + 10], [r.x + r.w / 2, r.y + r.h], [r.x + r.w, r.y + 10]], {}, { dash: 'dashed', endCap: 'filledArrow', startCap: 'circle', width: 2 })]);
  P.cell('L17 arc, nearly straight (edge)', null, (r) => [mk('arc', 0, [[r.x, r.y + r.h / 2], [r.x + r.w / 2, r.y + r.h / 2 - 0.4], [r.x + r.w, r.y + r.h / 2]])]);
  P.cell('L18 arc, near full circle', null, (r) => [mk('arc', 0, [[r.x + 60, r.y + 10], [r.x + 20, r.y + 40], [r.x + 61, r.y + 10.5]], {}, { width: 2 })]);
  P.cell('L19 elliptical arcs 0-180, 45-300, 270-90, 10-350', [2, 1], (r) =>
    ([[0, 180], [45, 300], [270, 90], [10, 350]] as [number, number][]).map(([a, b], i) =>
      mk('ellipticalArc', 0, [[r.x + i * 80, r.y + 8], [r.x + i * 80 + 70, r.y + 70]], { arcAngles: [a, b], subject: `L19 ${a}-${b}` }, { width: 2, stroke: ['#e11d48', '#2563eb', '#16a34a', '#9333ea'][i]! }),
    ),
  );
  P.cell('L20 pen, freehand wave (60 pts)', null, (r) => [mk('pen', 0, wave(r.x, r.y + 5, r.w, r.h - 10, 60))]);
  P.cell('L21 pen dashed 3pt + pen opacity .5 12pt', null, (r) => [
    mk('pen', 0, wave(r.x, r.y, r.w, 36, 40, 2), {}, { dash: 'dashed', width: 3 }),
    mk('pen', 0, wave(r.x, r.y + 44, r.w, 36, 40, 2), {}, { width: 12, opacity: 0.5, stroke: '#16a34a' }),
  ]);
  P.cell('L22 highlighter strokes', null, (r) => [
    mk('highlighter', 0, [[r.x, r.y + 15], [r.x + r.w, r.y + 15]]),
    mk('highlighter', 0, wave(r.x, r.y + 35, r.w, 40, 30, 1.5), {}, { stroke: '#22c55e', width: 20, opacity: 0.3 }),
  ]);
  P.cell('L23 custom line styles: Gas, Zig Zag, Double, Road, Fenceline Circle', [2, 2], (r) =>
    [GAS, ZIGZAG, DOUBLE, ROAD, FENCE_CIRCLE].map((cl, i) =>
      mk(i === 1 ? 'polyline' : 'line', 0, i === 1 ? [[r.x + 10, r.y + 15 + i * 30], [r.x + 150, r.y + 25 + i * 30], [r.x + r.w - 10, r.y + 15 + i * 30]] : [[r.x + 10, r.y + 15 + i * 30], [r.x + r.w - 10, r.y + 15 + i * 30]], { subject: `L23 ${cl.name}` }, { width: 2, lineStyle: cl, stroke: '#0f766e' }),
    ),
  );
  P.cell('L24 stroke colours (white on dark)', null, (r, c) => {
    P.spec.extras.push((cv) => cv.rect({ x: r.x + r.w / 2, y: r.y - 4, w: r.w / 2 + 4, h: r.h + 8 }, { fill: [0.15, 0.15, 0.2], stroke: null }));
    return ['#000000', '#ff0000', '#00aa00', '#0000ff', '#ff00ff', '#00bcd4', '#888888', '#ffffff'].map((col, i) =>
      mk('line', 0, [[r.x + (i < 4 ? 0 : r.w / 2 + 2), r.y + 6 + (i % 4) * 20], [r.x + (i < 4 ? r.w / 2 - 4 : r.w), r.y + 6 + (i % 4) * 20]], { subject: `L24 ${col}` }, { stroke: col, width: 4 }),
    );
  });
  P.cell('L25 dimension: default, leader +14, long text 14pt', [2, 1], (r) => [
    mk('dimension', 0, [[r.x, r.y + 60], [r.x + 140, r.y + 60]], { text: `3'-6"` }),
    mk('dimension', 0, [[r.x + 160, r.y + 60], [r.x + 300, r.y + 60]], { text: '4200 mm', subject: 'L25 dimension leader' }, { leader: 14 }),
    mk('dimension', 0, [[r.x, r.y + 15], [r.x + 300, r.y + 15]], { text: 'OVERALL WIDTH 12 600 (TO FACE OF STUD)', subject: 'L25 dimension long text' }, { fontSize: 14, stroke: '#7c3aed' }),
  ]);
  return P.spec;
}

export function closedShapes(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Closed shapes, clouds and hatches', sheet: 'A-102' });
  const box = (r: { x: number; y: number; w: number; h: number }, i = 0, n = 1): Point[] => {
    const w = r.w / n;
    return [[r.x + i * w + 2, r.y], [r.x + (i + 1) * w - 2, r.y + r.h]];
  };
  P.cell('S01 rectangle, default', null, (r) => [mk('rect', 0, box(r))]);
  P.cell('S02 rectangle filled, opacity .6, fillOpacity .5', null, (r) => [mk('rect', 0, box(r), {}, { fill: '#38bdf8', opacity: 0.6, fillOpacity: 0.5, width: 3 })]);
  P.cell('S03 hatches: brick, diagonalDown, grid, dots20', [2, 1], (r) =>
    (['brick', 'diagonalDown', 'grid', 'dots20'] as const).map((h, i) => mk('rect', 0, box(r, i, 4), { subject: `S03 hatch ${h}` }, { hatch: h, stroke: '#9a3412' })),
  );
  P.cell('S04 hatch scale 50 / 200, hatch colour blue, fill yellow', null, (r) => [
    mk('rect', 0, box(r, 0, 2), { subject: 'S04 hatch scale 50' }, { hatch: 'diagonalUp', hatchScale: 50, hatchColor: '#2563eb', fill: '#fef08a' }),
    mk('rect', 0, box(r, 1, 2), { subject: 'S04 hatch scale 200' }, { hatch: 'weave', hatchScale: 200, hatchColor: '#dc2626' }),
  ]);
  P.cell('S05 dashed outlines 1 / 3 / 6 pt', null, (r) => [1, 3, 6].map((w, i) => mk('rect', 0, box(r, i, 3), { subject: `S05 dashed ${w}` }, { dash: 'dashed', width: w })));
  P.cell('S06 rounded corners r=12 and r=30', null, (r) => [12, 30].map((cr, i) => mk('rect', 0, box(r, i, 2), { subject: `S06 corner ${cr}` }, { cornerRadius: cr, width: 2 })));
  P.cell('S07 rotated rectangles 30 / 90 / 45 filled', null, (r) => [30, 90, 45].map((a, i) => mk('rect', 0, [[r.x + i * 52 + 10, r.y + 15], [r.x + i * 52 + 50, r.y + 55]], { rotation: a, subject: `S07 rotation ${a}` }, i === 2 ? { fill: '#a3e635' } : {})));
  P.cell('S08 line width 0 / 0.1 / 40 (edge)', null, (r) => [0, 0.1, 40].map((w, i) => mk('rect', 0, [[r.x + i * 54 + 6, r.y + 18], [r.x + i * 54 + 40, r.y + 52]], { subject: `S08 width ${w}` }, { width: w, fill: '#fde68a' })));
  P.cell('S09 very thin 1x70, 70x1, tiny 3x3', null, (r) => [
    mk('rect', 0, [[r.x + 5, r.y], [r.x + 6, r.y + 70]], { subject: 'S09 thin tall' }),
    mk('rect', 0, [[r.x + 15, r.y + 30], [r.x + 85, r.y + 31]], { subject: 'S09 thin wide' }),
    mk('rect', 0, [[r.x + 110, r.y + 30], [r.x + 113, r.y + 33]], { subject: 'S09 tiny' }),
  ]);
  P.cell('S10 ellipse, circle, filled, rotated 45 hatched', [2, 1], (r) => [
    mk('ellipse', 0, [[r.x, r.y + 10], [r.x + 80, r.y + 60]], { subject: 'S10 ellipse' }),
    mk('ellipse', 0, [[r.x + 90, r.y + 5], [r.x + 150, r.y + 65]], { subject: 'S10 circle' }),
    mk('ellipse', 0, [[r.x + 160, r.y + 5], [r.x + 230, r.y + 65]], { subject: 'S10 filled' }, { fill: '#fb923c', fillOpacity: 0.6 }),
    mk('ellipse', 0, [[r.x + 245, r.y + 15], [r.x + 320, r.y + 55]], { rotation: 45, subject: 'S10 rotated hatched' }, { hatch: 'diagonalDown' }),
  ]);
  P.cell('S11 polygons: triangle, 5-point star, hexagon hatched', [2, 1], (r) => [
    mk('polygon', 0, [[r.x + 5, r.y + 70], [r.x + 45, r.y + 5], [r.x + 85, r.y + 70]], { subject: 'S11 triangle' }),
    mk('polygon', 0, star(r.x + 135, r.y + 38, 38, 15), { subject: 'S11 star' }, { fill: '#facc15', fillOpacity: 0.7 }),
    mk('polygon', 0, ngon(r.x + 225, r.y + 38, 38, 38, 6), { subject: 'S11 hexagon' }, { hatch: 'grid' }),
  ]);
  P.cell('S12 bowtie (self-intersecting) filled; 24-gon; rounded polygon', [2, 1], (r) => [
    mk('polygon', 0, [[r.x + 5, r.y + 5], [r.x + 75, r.y + 65], [r.x + 75, r.y + 5], [r.x + 5, r.y + 65]], { subject: 'S12 bowtie' }, { fill: '#f472b6' }),
    mk('polygon', 0, ngon(r.x + 140, r.y + 36, 36, 36, 24), { subject: 'S12 24-gon' }),
    mk('polygon', 0, [[r.x + 200, r.y + 65], [r.x + 230, r.y + 5], [r.x + 290, r.y + 5], [r.x + 320, r.y + 65]], { subject: 'S12 rounded' }, { cornerRadius: 12, width: 2 }),
  ]);
  P.cell('S13 clouds: default, arc 3, arc 14, inside', [2, 1], (r) => [
    mk('cloud', 0, [[r.x, r.y + 6], [r.x + 70, r.y + 64]], { subject: 'S13 cloud default' }),
    mk('cloud', 0, [[r.x + 80, r.y + 6], [r.x + 150, r.y + 64]], { subject: 'S13 cloud arc 3' }, { arcRadius: 3 }),
    mk('cloud', 0, [[r.x + 160, r.y + 6], [r.x + 240, r.y + 64]], { subject: 'S13 cloud arc 14' }, { arcRadius: 14 }),
    mk('cloud', 0, [[r.x + 250, r.y + 6], [r.x + 320, r.y + 64]], { subject: 'S13 cloud inside' }, { cloudInside: true }),
  ]);
  P.cell('S14 clouds: filled, rotated 20, tiny 12x12, thin 150x8', [2, 1], (r) => [
    mk('cloud', 0, [[r.x, r.y + 6], [r.x + 70, r.y + 64]], { subject: 'S14 filled' }, { fill: '#fca5a5', fillOpacity: 0.5 }),
    mk('cloud', 0, [[r.x + 85, r.y + 10], [r.x + 150, r.y + 60]], { rotation: 20, subject: 'S14 rotated' }),
    mk('cloud', 0, [[r.x + 170, r.y + 30], [r.x + 182, r.y + 42]], { subject: 'S14 tiny' }),
    mk('cloud', 0, [[r.x + 190, r.y + 60], [r.x + 340, r.y + 68]], { subject: 'S14 thin' }),
  ]);
  P.cell('S15 polygon clouds: L-shape, star, inside', [2, 1], (r) => [
    mk('polygonCloud', 0, [[r.x, r.y + 5], [r.x + 50, r.y + 5], [r.x + 50, r.y + 35], [r.x + 90, r.y + 35], [r.x + 90, r.y + 70], [r.x, r.y + 70]], { subject: 'S15 L-shape' }),
    mk('polygonCloud', 0, star(r.x + 155, r.y + 38, 38, 18), { subject: 'S15 star' }),
    mk('polygonCloud', 0, ngon(r.x + 245, r.y + 38, 36, 36, 5), { subject: 'S15 inside' }, { cloudInside: true, fill: '#bae6fd' }),
  ]);
  P.cell('S16 Cloud+ (cloud + callout, grouped)', [2, 1], (r) => [
    mk('cloud', 0, [[r.x, r.y + 10], [r.x + 90, r.y + 62]], { groupId: 'cloudplus-1', subject: 'S16 Cloud+ cloud' }),
    mk('callout', 0, [[r.x + 60, r.y + 40], [r.x + 130, r.y + 20], [r.x + 160, r.y + 5], [r.x + 320, r.y + 55]], { groupId: 'cloudplus-1', text: 'REVISE DETAIL 4/A-501\nSEE RFI-0042', subject: 'S16 Cloud+ callout' }),
  ]);
  P.cell('S17 custom hatch set:A3 Test/Zig (spec travels with markup)', null, (r) => [
    mk('rect', 0, box(r), {}, {
      hatch: customHatchId('A3 Test', 'Zig'),
      hatchSpec: { scaleX: 1, scaleY: 1, size: 18, lineWidth: 1, elements: [{ type: 'line', x1: 0, y1: 0, x2: 0.5, y2: 1 }, { type: 'line', x1: 0.5, y1: 1, x2: 1, y2: 0 }, { type: 'dot', x: 0.5, y: 0.5, size: 'small' }] },
      hatchColor: '#0f766e',
    }),
  ]);
  P.cell('S18 stacked translucent fills (multiply)', null, (r) => ['#ef4444', '#3b82f6', '#22c55e'].map((c, i) => mk('rect', 0, [[r.x + i * 25, r.y + i * 10], [r.x + i * 25 + 70, r.y + i * 10 + 50]], {}, { fill: c, opacity: 0.5, fillOpacity: 0.6 })));
  P.cell('S19 ellipse and polygon with dash dot + width 2', null, (r) => [
    mk('ellipse', 0, box(r, 0, 2), {}, { dash: 'dashDot', width: 2 }),
    mk('polygon', 0, ngon(r.x + r.w * 0.75, r.y + r.h / 2, 32, 32, 5), {}, { dash: 'dashDotDot', width: 2 }),
  ]);
  return P.spec;
}
