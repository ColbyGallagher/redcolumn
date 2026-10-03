import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, distribute, flip, insidePolygon, insideRect, multiplyOffsets, paintedStyle, restack } from './arrange.ts';
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
