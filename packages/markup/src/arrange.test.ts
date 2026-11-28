import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, arrangeUnits, centerOnPage, distribute, flip, matchSize, insidePolygon, insideRect, multiplyOffsets, paintedStyle, restack, scaledAbout, touchesPolygon, touchesRect } from './arrange.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';

function box(id: string, x: number, y: number, w: number, h: number, type: MarkupType = 'rect', createdAt = 0): Markup {
  return { id, type, pageIndex: 0, points: [[x, y], [x + w, y + h]], style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt, modifiedAt: 0 };
}

test('align lines markups up on the edges and centres of their combined bounds', () => {
  const a = box('a', 0, 0, 10, 10);
  const b = box('b', 50, 30, 20, 10);
  assert.deepEqual(align([a, b], 'left').get('b')?.points, [[0, 30], [20, 40]]);
  assert.equal(align([a, b], 'left').has('a'), false);
  assert.deepEqual(align([a, b], 'right').get('a')?.points, [[60, 0], [70, 10]]);
  assert.deepEqual(align([a, b], 'top').get('b')?.points, [[50, 0], [70, 10]]);
  assert.deepEqual(align([a, b], 'middle').get('a')?.points, [[0, 15], [10, 25]]);
  assert.deepEqual(align([a, b], 'center').get('a')?.points, [[30, 0], [40, 10]]);
});

test('align moves each group as a single unit without adjusting members inside it', () => {
  // Group 1 spans x: [0, 30], y: [0, 20]
  const g1a: Markup = { ...box('g1a', 0, 0, 10, 10), groupId: 'g1' };
  const g1b: Markup = { ...box('g1b', 20, 10, 10, 10), groupId: 'g1' };
  // Group 2 spans x: [60, 100], y: [40, 60]
  const g2a: Markup = { ...box('g2a', 60, 40, 10, 10), groupId: 'g2' };
  const g2b: Markup = { ...box('g2b', 90, 50, 10, 10), groupId: 'g2' };
  const both = [g1a, g1b, g2a, g2b];

  assert.equal(arrangeUnits(both).length, 2);

  // Align left: group 1 stays put; group 2 shifts left by 60 keeping internal layout intact.
  const left = align(both, 'left');
  assert.equal(left.has('g1a'), false);
  assert.equal(left.has('g1b'), false);
  assert.deepEqual(left.get('g2a')?.points, [[0, 40], [10, 50]]);
  assert.deepEqual(left.get('g2b')?.points, [[30, 50], [40, 60]]);

  // Align right: group 2 stays put; group 1 shifts right by 70 (100 - 30).
  const right = align(both, 'right');
  assert.deepEqual(right.get('g1a')?.points, [[70, 0], [80, 10]]);
  assert.deepEqual(right.get('g1b')?.points, [[90, 10], [100, 20]]);
  assert.equal(right.has('g2a'), false);
  assert.equal(right.has('g2b'), false);

  // Align center: combined x is [0, 100] (center 50).
  // Group 1 center is 15 -> dx = +35. Group 2 center is 80 -> dx = -30.
  const center = align(both, 'center');
  assert.deepEqual(center.get('g1a')?.points, [[35, 0], [45, 10]]);
  assert.deepEqual(center.get('g1b')?.points, [[55, 10], [65, 20]]);
  assert.deepEqual(center.get('g2a')?.points, [[30, 40], [40, 50]]);
  assert.deepEqual(center.get('g2b')?.points, [[60, 50], [70, 60]]);

  // Align top: group 1 stays put; group 2 shifts up by 40.
  const top = align(both, 'top');
  assert.equal(top.has('g1a'), false);
  assert.equal(top.has('g1b'), false);
  assert.deepEqual(top.get('g2a')?.points, [[60, 0], [70, 10]]);
  assert.deepEqual(top.get('g2b')?.points, [[90, 10], [100, 20]]);

  // Align middle: combined y is [0, 60] (middle 30).
  // Group 1 middle is 10 -> dy = +20. Group 2 middle is 50 -> dy = -20.
  const middle = align(both, 'middle');
  assert.deepEqual(middle.get('g1a')?.points, [[0, 20], [10, 30]]);
  assert.deepEqual(middle.get('g1b')?.points, [[20, 30], [30, 40]]);
  assert.deepEqual(middle.get('g2a')?.points, [[60, 20], [70, 30]]);
  assert.deepEqual(middle.get('g2b')?.points, [[90, 30], [100, 40]]);

  // Align bottom: group 2 stays put; group 1 shifts down by 40.
  const bottom = align(both, 'bottom');
  assert.deepEqual(bottom.get('g1a')?.points, [[0, 40], [10, 50]]);
  assert.deepEqual(bottom.get('g1b')?.points, [[20, 50], [30, 60]]);
  assert.equal(bottom.has('g2a'), false);
  assert.equal(bottom.has('g2b'), false);

  // A single group on its own is one unit: align must not touch its members.
  assert.equal(align([g1a, g1b], 'left').size, 0);
  assert.equal(align([g1a, g1b], 'top').size, 0);

  // One group + one ungrouped markup: aligns the group as a whole with the ungrouped markup.
  const solo = box('solo', 80, 0, 10, 10);
  const mixed = align([g1a, g1b, solo], 'right');
  assert.deepEqual(mixed.get('g1a')?.points, [[60, 0], [70, 10]]);
  assert.deepEqual(mixed.get('g1b')?.points, [[80, 10], [90, 20]]);
  assert.equal(mixed.has('solo'), false);
});

test('distribute equalises the gaps between three or more markups', () => {
  const ms = [box('a', 0, 0, 10, 10), box('c', 90, 0, 10, 10), box('b', 20, 0, 20, 10)];
  const moved = distribute(ms, 'horizontal');
  // Total span 100, sizes 40, so each of the two gaps is 30: b starts at 40.
  assert.deepEqual(moved.get('b')?.points, [[40, 0], [60, 10]]);
  assert.equal(moved.has('a') || moved.has('c'), false);
  assert.equal(distribute(ms.slice(0, 2), 'horizontal').size, 0);
});

test('distribute moves each group as a single unit and requires three or more units', () => {
  // Group 1: x [0, 20]; Group 2: x [30, 50]; Group 3: x [100, 120]
  // Total span 120, sizes 20 + 20 + 20 = 60, gap = 30 -> Group 2 should start at 50 (dx = +20).
  const g1a: Markup = { ...box('g1a', 0, 0, 10, 10), groupId: 'g1' };
  const g1b: Markup = { ...box('g1b', 10, 5, 10, 10), groupId: 'g1' };
  const g2a: Markup = { ...box('g2a', 30, 0, 10, 10), groupId: 'g2' };
  const g2b: Markup = { ...box('g2b', 40, 5, 10, 10), groupId: 'g2' };
  const g3a: Markup = { ...box('g3a', 100, 0, 10, 10), groupId: 'g3' };
  const g3b: Markup = { ...box('g3b', 110, 5, 10, 10), groupId: 'g3' };

  const moved = distribute([g1a, g1b, g2a, g2b, g3a, g3b], 'horizontal');
  assert.deepEqual(moved.get('g2a')?.points, [[50, 0], [60, 10]]);
  assert.deepEqual(moved.get('g2b')?.points, [[60, 5], [70, 15]]);
  assert.equal(moved.has('g1a') || moved.has('g1b') || moved.has('g3a') || moved.has('g3b'), false);

  // Two groups (4 markups) is only 2 units: distribute must do nothing.
  assert.equal(distribute([g1a, g1b, g2a, g2b], 'horizontal').size, 0);
});

test('flip mirrors across the selection centre', () => {
  const line: Markup = { ...box('l', 0, 0, 10, 10, 'line'), points: [[0, 0], [10, 4]] };
  assert.deepEqual(flip([line], 'horizontal').get('l')?.points, [[10, 0], [0, 4]]);
  assert.deepEqual(flip([line], 'vertical').get('l')?.points, [[0, 4], [10, 0]]);
});

test('flip turns a rotated box the other way', () => {
  const r: Markup = { ...box('r', 0, 0, 10, 10), rotation: 30 };
  assert.equal((flip([r], 'horizontal').get('r') as { rotation?: number }).rotation, -30);
  assert.equal('rotation' in flip([box('p', 0, 0, 5, 5)], 'vertical').get('p')!, false);
});

test('centerOnPage moves the selection as one so its bounds centre on the page', () => {
  const ms = [box('a', 0, 0, 10, 10), box('b', 30, 20, 10, 10)];
  // Union 0-40 x 0-30; page 200 x 100 centre (100, 50) -> shift (80, 35).
  const moved = centerOnPage(ms, 200, 100);
  assert.deepEqual(moved.get('a')?.points, [[80, 35], [90, 45]]);
  assert.deepEqual(moved.get('b')?.points, [[110, 55], [120, 65]]);
  assert.equal(centerOnPage([box('c', 90, 45, 20, 10)], 200, 100).size, 0);
});

test('matchSize stretches the others to the first markup about their own centres', () => {
  const first = box('f', 0, 0, 10, 20);
  const r = box('r', 100, 100, 40, 40);
  assert.deepEqual(matchSize([first, r], 'width').get('r')?.points, [[115, 100], [125, 140]]);
  assert.deepEqual(matchSize([first, r], 'height').get('r')?.points, [[100, 110], [140, 130]]);
  assert.deepEqual(matchSize([first, r], 'both').get('r')?.points, [[115, 110], [125, 130]]);
  assert.equal(matchSize([first, r], 'both').has('f'), false);
  assert.equal(matchSize([first], 'both').size, 0);
  // A polyline's points follow its bounds.
  const line: Markup = { ...box('l', 0, 0, 1, 1, 'polyline'), points: [[0, 0], [20, 10], [40, 0]] };
  assert.deepEqual(matchSize([first, line], 'width').get('l')?.points, [[15, 0], [20, 10], [25, 0]]);
});

test('matchSize resizes a group as one object, scaling its layout', () => {
  const first = box('f', 0, 0, 80, 20);
  // The group spans x: [100, 140], y: [100, 140], centred on (120, 120).
  const g1: Markup = { ...box('g1', 100, 100, 10, 10), groupId: 'g' };
  const g2: Markup = { ...box('g2', 130, 130, 10, 10), groupId: 'g' };
  const width = matchSize([first, g1, g2], 'width');
  assert.deepEqual(width.get('g1')?.points, [[80, 100], [100, 110]]);
  assert.deepEqual(width.get('g2')?.points, [[140, 130], [160, 140]]);
  const both = matchSize([first, g1, g2], 'both');
  assert.deepEqual(both.get('g1')?.points, [[80, 110], [100, 115]]);
  assert.deepEqual(both.get('g2')?.points, [[140, 125], [160, 130]]);
});

test('matchSize takes the size of the whole first group and leaves its members alone', () => {
  const g1: Markup = { ...box('g1', 0, 0, 10, 10), groupId: 'g' };
  const g2: Markup = { ...box('g2', 30, 30, 10, 10), groupId: 'g' };
  const r = box('r', 100, 100, 20, 20);
  const out = matchSize([g1, r, g2], 'both');
  assert.deepEqual([...out.keys()], ['r']);
  assert.deepEqual(out.get('r')?.points, [[90, 90], [130, 130]]);
  assert.equal(matchSize([g1, g2], 'both').size, 0);
});

test('matchSize leaves a group with a frozen member whole, though a frozen first unit still sets the size', () => {
  const first = box('f', 0, 0, 80, 20);
  const g1: Markup = { ...box('g1', 100, 100, 10, 10), groupId: 'g' };
  const g2: Markup = { ...box('g2', 130, 130, 10, 10), groupId: 'g' };
  const r = box('r', 200, 200, 40, 40);
  const out = matchSize([first, g1, g2, r], 'width', (m) => m.id === 'f' || m.id === 'g2');
  assert.deepEqual([...out.keys()], ['r']);
});

test('matchSize resizes a text box but not its font', () => {
  const first = box('f', 0, 0, 100, 50);
  const t = box('t', 0, 0, 50, 50, 'text');
  const out = matchSize([first, t], 'both').get('t');
  assert.deepEqual(out?.points, [[-25, 0], [75, 50]]);
  assert.equal('style' in (out ?? {}), false);
});

test('matchSize and centerOnPage use the size a turned box shows on the page', () => {
  // 100 x 50 turned a quarter turn looks 50 wide and 100 tall.
  const ref: Markup = { ...box('ref', 0, 0, 100, 50), rotation: 90 };
  const r = box('r', 200, 200, 40, 40);
  assert.deepEqual(matchSize([ref, r], 'both').get('r')?.points, [[195, 170], [245, 270]]);
  // A target turned a quarter turn is stretched along its own sides the other way round.
  const t: Markup = { ...box('t', 0, 0, 20, 20), rotation: 90 };
  assert.deepEqual(matchSize([ref, t], 'both').get('t')?.points, [[-40, -15], [60, 35]]);
  // The turned box is measured by its turned outline (x 25-75, y -25-75) when centring.
  assert.deepEqual(centerOnPage([ref, box('b', 100, 0, 10, 10)], 200, 100).get('b')?.points, [[132.5, 25], [142.5, 35]]);
});

test('restack moves markups one step past their neighbours', () => {
  const page = [box('a', 0, 0, 1, 1, 'rect', 1), box('b', 0, 0, 1, 1, 'rect', 2), box('c', 0, 0, 1, 1, 'rect', 3)];
  assert.deepEqual([...restack(page, new Set(['a']), 'forward')], [['a', 2], ['b', 1]]);
  assert.deepEqual([...restack(page, new Set(['c']), 'backward')], [['c', 2], ['b', 3]]);
  // Already on top: nothing to do.
  assert.equal(restack(page, new Set(['c']), 'forward').size, 0);
  // Two adjacent markups move together without swapping with each other.
  const both = restack(page, new Set(['a', 'b']), 'forward');
  assert.deepEqual([...both.entries()].sort(), [['a', 2], ['b', 3], ['c', 1]]);
});

test('multiplyOffsets lays copies out in a grid, skipping the original', () => {
  assert.deepEqual(multiplyOffsets({ x: 0, y: 0, w: 10, h: 5 }, 2, 2, 2, 1), [
    [12, 0],
    [0, 6],
    [12, 6],
  ]);
});

test('lasso and box selection need the whole shape inside', () => {
  const m = box('m', 10, 10, 10, 10);
  const lasso: Point[] = [[0, 0], [30, 0], [30, 30], [0, 30]];
  assert.equal(insidePolygon(m, lasso), true);
  assert.equal(insidePolygon(box('n', 25, 25, 10, 10), lasso), false);
  assert.equal(insideRect(m, { x: 5, y: 5, w: 20, h: 20 }), true);
  assert.equal(insideRect(m, { x: 15, y: 5, w: 20, h: 20 }), false);
});

test('format painter copies appearance but keeps zoom-sized details across types', () => {
  const src = { ...box('s', 0, 0, 1, 1, 'rect'), style: { stroke: '#00ff00', fill: '#ff0000', width: 3, opacity: 0.5, dash: 'dashed' as const } };
  const cloud = { ...box('t', 0, 0, 1, 1, 'cloud'), style: { ...DEFAULT_STYLES.cloud, arcRadius: 7 } };
  assert.deepEqual(paintedStyle(src, cloud), { stroke: '#00ff00', fill: '#ff0000', width: 3, opacity: 0.5, dash: 'dashed', arcRadius: 7 });
  const rect2 = box('r', 0, 0, 1, 1, 'rect');
  assert.deepEqual(paintedStyle(src, rect2), src.style);
});

test('scaledAbout grows a markup about a point, keeping that point still', () => {
  const m = { id: 'a', type: 'image', pageIndex: 0, points: [[10, 10], [30, 20]], style: { stroke: '#000', fill: null, width: 2, opacity: 1 }, status: 'none', author: '', createdAt: 0, modifiedAt: 0 } as unknown as Markup;
  const out = scaledAbout(m, [10, 10], 3);
  assert.deepEqual(out.points, [[10, 10], [70, 40]]);
  assert.equal(out.style, undefined, 'line width left alone');
  const text = scaledAbout({ ...m, type: 'text', style: { ...m.style, fontSize: 10 } }, [0, 0], 0.5);
  assert.equal(text.style?.fontSize, 5);
});

function shapeOf(id: string, type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { ...box(id, 0, 0, 1, 1, type), points, ...extra, style: { ...DEFAULT_STYLES[type], ...(extra.style ?? {}) } };
}

test('touchesRect: a segment crossing the rectangle with both ends outside counts', () => {
  const line = shapeOf('l', 'polyline', [[0, 50], [100, 50]]);
  assert.equal(touchesRect(line, { x: 40, y: 40, w: 20, h: 20 }), true);
  assert.equal(touchesRect(line, { x: 40, y: 60, w: 20, h: 20 }), false);
});

test('touchesRect: a vertex inside the rectangle counts', () => {
  const line = shapeOf('l', 'polyline', [[0, 0], [10, 10], [200, 200]]);
  assert.equal(touchesRect(line, { x: 5, y: 5, w: 10, h: 10 }), true);
});

test('touchesRect: a rectangle wholly inside a filled area counts, but inside an open outline does not', () => {
  const ring: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const area = shapeOf('a', 'area', ring);
  const outline = shapeOf('p', 'polygon', ring, { style: { ...DEFAULT_STYLES.polygon, fill: null } });
  const inner = { x: 40, y: 40, w: 10, h: 10 };
  assert.equal(touchesRect(area, inner), true);
  assert.equal(touchesRect(outline, inner), false);
  // One edge of the area reaching into the rectangle is enough, from outside.
  assert.equal(touchesRect(area, { x: 90, y: -20, w: 30, h: 40 }), true);
});

test('touchesRect: near by bounding box only is not a touch', () => {
  // An L-shaped polyline: its bounding box covers the rectangle, its lines do not.
  const l = shapeOf('l', 'polyline', [[0, 0], [0, 100], [100, 100]]);
  assert.equal(touchesRect(l, { x: 40, y: 40, w: 20, h: 20 }), false);
  const diagonal = shapeOf('d', 'line', [[0, 0], [100, 100]]);
  assert.equal(touchesRect(diagonal, { x: 70, y: 10, w: 20, h: 20 }), false);
});

test('touchesRect: counts, text boxes, arcs and rotated boxes use their real shape', () => {
  const count = shapeOf('c', 'count', [[10, 10], [200, 200]]);
  assert.equal(touchesRect(count, { x: 195, y: 195, w: 10, h: 10 }), true);
  assert.equal(touchesRect(count, { x: 100, y: 100, w: 10, h: 10 }), false);
  const text = shapeOf('t', 'text', [[0, 0], [100, 50]]);
  assert.equal(touchesRect(text, { x: 40, y: 20, w: 5, h: 5 }), true);
  const arc = shapeOf('arc', 'arc', [[0, 0], [50, -50], [100, 0]]);
  assert.equal(touchesRect(arc, { x: 45, y: -60, w: 10, h: 20 }), true);
  assert.equal(touchesRect(arc, { x: 45, y: -20, w: 10, h: 10 }), false);
  // A wide bar turned upright: it now reaches into a rectangle above its middle.
  const bar = shapeOf('r', 'rect', [[0, 0], [100, 10]], { rotation: 90 });
  assert.equal(touchesRect(bar, { x: 40, y: -40, w: 20, h: 4 }), true);
  assert.equal(touchesRect(bar, { x: 90, y: -2, w: 8, h: 8 }), false);
});

test('touchesPolygon: a lasso crossing any part of a polyline touches it', () => {
  const line = shapeOf('l', 'polyline', [[0, 0], [100, 0], [100, 100], [200, 100]]);
  const lasso: Point[] = [[90, 40], [120, 40], [120, 60], [90, 60]];
  assert.equal(touchesPolygon(line, lasso), true);
  assert.equal(touchesPolygon(line, [[10, 40], [40, 40], [40, 60], [10, 60]]), false);
  assert.equal(touchesPolygon(line, [[0, 0], [1, 1]]), false);
});
