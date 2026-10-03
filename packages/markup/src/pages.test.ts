import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPageOps, rotatePagePoint } from './pages.ts';

test('delete, move and insert renumber pages', () => {
  // 0 1 2 3 4 -> delete 1 -> 0 2 3 4 -> move [3] (old 4) to 0 -> 4 0 2 3 -> insert 2 pages at 1.
  const plan = planPageOps(
    5,
    [
      { type: 'delete', pages: [1] },
      { type: 'move', pages: [3], to: 0 },
      { type: 'insert', source: 0, at: 1 },
    ],
    [2],
  );
  assert.deepEqual(plan.oldToNew, [3, null, 4, 5, 0]);
  assert.equal(plan.newCount, 6);
});

test('moving several pages keeps their given order', () => {
  assert.deepEqual(planPageOps(4, [{ type: 'move', pages: [3, 1], to: 0 }]).oldToNew, [2, 1, 3, 0]);
});

test('rotations accumulate per page', () => {
  const plan = planPageOps(3, [
    { type: 'rotate', pages: [0, 2], quarterTurns: 1 },
    { type: 'rotate', pages: [0], quarterTurns: -2 },
  ]);
  assert.deepEqual(plan.turns, [3, 0, 1]);
});

test('rotating a point follows the page', () => {
  // Landscape 200 x 100 page; the top-left corner goes to the top-right after one clockwise turn.
  assert.deepEqual(rotatePagePoint([0, 0], 200, 100, 1), [100, 0]);
  assert.deepEqual(rotatePagePoint([200, 0], 200, 100, 1), [100, 200]);
  assert.deepEqual(rotatePagePoint([10, 20], 200, 100, 2), [190, 80]);
  assert.deepEqual(rotatePagePoint([10, 20], 200, 100, 4), [10, 20]);
  // Three clockwise turns equal one anticlockwise turn.
  assert.deepEqual(rotatePagePoint([0, 0], 200, 100, 3), [0, 200]);
});

test('blank pages shift the pages after them; past the end appends', () => {
  assert.deepEqual(planPageOps(3, [{ type: 'blank', at: 1, count: 2, width: 612, height: 792 }]).oldToNew, [0, 3, 4]);
  const appended = planPageOps(2, [{ type: 'blank', at: 99, count: 1, width: 612, height: 792 }]);
  assert.deepEqual(appended.oldToNew, [0, 1]);
  assert.equal(appended.newCount, 3);
});
