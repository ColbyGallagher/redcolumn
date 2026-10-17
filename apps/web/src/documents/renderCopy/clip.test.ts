import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asRect, clipLines, clipRegion, flattenCurve, inside, type Polyline } from './clip.ts';

const poly = (pts: number[], closed = true): Polyline => ({ pts, closed, src: 'SRC\n' });

test('a rectangle written with extra points along its sides is a rectangle', () => {
  // ArchiCAD's viewport clip: seven points, two of them on the top edge.
  assert.deepEqual(asRect([poly([25, 579, 25, 17, 739, 17, 739, 579, 238, 579, 114, 579, 25, 579])]), [25, 17, 739, 579]);
  assert.deepEqual(asRect([poly([0, 0, 10, 0, 10, 5, 0, 5])]), [0, 0, 10, 5]);
});

test('shapes that are not axis-aligned rectangles are not', () => {
  assert.equal(asRect([poly([0, 0, 10, 2, 8, 12, -2, 10])]), null, 'rotated');
  assert.equal(asRect([poly([0, 0, 10, 0, 10, 5, 5, 5, 5, 10, 0, 10])]), null, 'L-shaped');
  assert.equal(asRect([poly([0, 0, 10, 0, 5, 0, 10, 0, 10, 5, 0, 5])]), null, 'doubles back on itself');
  assert.equal(asRect([poly([0, 0, 10, 0, 10, 5, 0, 5]), poly([20, 0, 30, 0, 30, 5, 20, 5])]), null, 'two rectangles');
});

test('inside follows the fill rule', () => {
  // A square with a square hole drawn the same way round: a hole for even-odd, filled for non-zero.
  const shape = [poly([0, 0, 10, 0, 10, 10, 0, 10]), poly([3, 3, 7, 3, 7, 7, 3, 7])];
  assert.equal(inside(clipRegion(shape, true)!, 5, 5), false);
  assert.equal(inside(clipRegion(shape, false)!, 5, 5), true);
  assert.equal(inside(clipRegion(shape, true)!, 1, 1), true);
  assert.equal(inside(clipRegion(shape, false)!, 11, 5), false);
});

test('lines are cut where they leave the clip', () => {
  const r = clipRegion([poly([0, 0, 10, 0, 10, 10, 0, 10])], false)!;
  assert.equal(clipLines([poly([-5, 5, 15, 5], false)], r), '0 5 m\n10 5 l\n');
  // Wholly inside: kept as written (curves and closing included).
  assert.equal(clipLines([poly([2, 2, 8, 2, 8, 8], true)], r), 'SRC\n');
  // Wholly outside: nothing.
  assert.equal(clipLines([poly([20, 20, 30, 30], false)], r), '');
  // In, out and in again: two pieces.
  const u = clipRegion([poly([0, 0, 4, 0, 4, 10, 6, 10, 6, 0, 10, 0, 10, 12, 0, 12])], false)!;
  assert.equal(clipLines([poly([-1, 5, 11, 5], false)], u), '0 5 m\n4 5 l\n6 5 m\n10 5 l\n');
});

test('a polyline running on inside the clip stays one piece', () => {
  const r = clipRegion([poly([0, 0, 10, 0, 10, 10, 0, 10])], false)!;
  // Enters, turns inside, leaves: one subpath with its corner.
  assert.equal(clipLines([poly([-5, 2, 5, 2, 5, 15], false)], r), '0 2 m\n5 2 l\n5 10 l\n');
});

test('flattened curves end exactly where the curve does', () => {
  const pts = [0, 0];
  flattenCurve(pts, 0, 0, 0, 10, 10, 10, 10, 0);
  assert.deepEqual(pts.slice(-2), [10, 0]);
  assert.ok(pts.length > 8, 'a bend that size takes several segments');
  // Straight "curves" take one segment.
  const flat = [0, 0];
  flattenCurve(flat, 0, 0, 1, 0, 2, 0, 3, 0);
  assert.deepEqual(flat, [0, 0, 3, 0]);
});
