import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, centerOnPage, distribute, flip, matchSize, insidePolygon, insideRect, multiplyOffsets, paintedStyle, restack, scaledAbout } from './arrange.ts';
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

test('distribute equalises the gaps between three or more markups', () => {
  const ms = [box('a', 0, 0, 10, 10), box('c', 90, 0, 10, 10), box('b', 20, 0, 20, 10)];
  const moved = distribute(ms, 'horizontal');
  // Total span 100, sizes 40, so each of the two gaps is 30: b starts at 40.
  assert.deepEqual(moved.get('b')?.points, [[40, 0], [60, 10]]);
  assert.equal(moved.has('a') || moved.has('c'), false);
  assert.equal(distribute(ms.slice(0, 2), 'horizontal').size, 0);
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
  assert.deepEqual(matchSize(first, [first, r], 'width').get('r')?.points, [[115, 100], [125, 140]]);
  assert.deepEqual(matchSize(first, [first, r], 'height').get('r')?.points, [[100, 110], [140, 130]]);
  assert.deepEqual(matchSize(first, [first, r], 'both').get('r')?.points, [[115, 110], [125, 130]]);
  assert.equal(matchSize(first, [first, r], 'both').has('f'), false);
  assert.equal(matchSize(first, [first], 'both').size, 0);
  // A polyline's points follow its bounds.
  const line: Markup = { ...box('l', 0, 0, 1, 1, 'polyline'), points: [[0, 0], [20, 10], [40, 0]] };
  assert.deepEqual(matchSize(first, [first, line], 'width').get('l')?.points, [[15, 0], [20, 10], [25, 0]]);
});

test('matchSize resizes a text box but not its font', () => {
  const first = box('f', 0, 0, 100, 50);
  const t = box('t', 0, 0, 50, 50, 'text');
  const out = matchSize(first, [first, t], 'both').get('t');
  assert.deepEqual(out?.points, [[-25, 0], [75, 50]]);
  assert.equal('style' in (out ?? {}), false);
});

test('matchSize and centerOnPage use the size a turned box shows on the page', () => {
  // 100 x 50 turned a quarter turn looks 50 wide and 100 tall.
  const ref: Markup = { ...box('ref', 0, 0, 100, 50), rotation: 90 };
  const r = box('r', 200, 200, 40, 40);
  assert.deepEqual(matchSize(ref, [ref, r], 'both').get('r')?.points, [[195, 170], [245, 270]]);
  // A target turned a quarter turn is stretched along its own sides the other way round.
  const t: Markup = { ...box('t', 0, 0, 20, 20), rotation: 90 };
  assert.deepEqual(matchSize(ref, [ref, t], 'both').get('t')?.points, [[-40, -15], [60, 35]]);
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
