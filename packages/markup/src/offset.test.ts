import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOffset, eraseStroke, offsetDistance, offsetPath, offsetPoints } from './offset.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';

function markup(type: MarkupType, points: Point[]): Markup {
  return { id: type, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: 0, modifiedAt: 0 };
}

const close = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);

test('erasing splits a stroke where the eraser passes and leaves it alone elsewhere', () => {
  const stroke: Point[] = [[0, 0], [100, 0]];
  const pieces = eraseStroke(stroke, [50, 0], 10)!;
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0]!.every(([x]) => x < 40 + 1e-9) && pieces[1]!.every(([x]) => x > 60 - 1e-9));
  assert.equal(eraseStroke(stroke, [50, 30], 10), null);
  // Erasing the whole stroke leaves nothing.
  assert.deepEqual(eraseStroke([[0, 0], [5, 0]], [2, 0], 10), []);
});

test('open paths offset sideways with mitred corners', () => {
  // Left of a rightward line (y down) is up: negative y.
  assert.ok(close(offsetPath([[0, 0], [10, 0]], 2, false).flat(), [0, -2, 10, -2]));
  // An L turning down: the outside corner mitres to (12, -2).
  const l = offsetPath([[0, 0], [10, 0], [10, 10]], 2, false);
  assert.ok(close(l[1]!, [12, -2]));
});

test('closed shapes grow outward for a positive offset whichever way they are drawn', () => {
  const cw = markup('polygon', [[0, 0], [10, 0], [10, 10], [0, 10]]);
  const ccw = markup('polygon', [[0, 0], [0, 10], [10, 10], [10, 0]]);
  for (const m of [cw, ccw]) {
    const out = offsetPoints(m, 1)!;
    const xs = out.map((p) => p[0]);
    assert.ok(close([Math.min(...xs), Math.max(...xs)], [-1, 11]));
  }
  assert.deepEqual(offsetPoints(markup('rect', [[0, 0], [10, 10]]), 2), [[-2, -2], [12, 12]]);
  // Shrinking a box stops before it turns inside out.
  const tiny = offsetPoints(markup('rect', [[0, 0], [10, 10]]), -20)!;
  assert.ok(tiny[1]![0] > tiny[0]![0]);
});

test('the offset distance follows the pointer: sign by side, outward positive', () => {
  assert.ok(Math.abs(offsetDistance(markup('line', [[0, 0], [10, 0]]), [5, -3]) - 3) < 1e-9);
  assert.ok(Math.abs(offsetDistance(markup('line', [[0, 0], [10, 0]]), [5, 3]) + 3) < 1e-9);
  assert.ok(Math.abs(offsetDistance(markup('rect', [[0, 0], [10, 10]]), [5, 12]) - 2) < 1e-9);
  assert.ok(Math.abs(offsetDistance(markup('rect', [[0, 0], [10, 10]]), [5, 8]) + 2) < 1e-9);
  assert.equal(canOffset(markup('pen', [[0, 0], [1, 1]])), false);
});
