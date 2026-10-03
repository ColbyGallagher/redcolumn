import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotationAffine } from './affine.ts';

const apply = (m: readonly number[], [x, y]: [number, number]): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];

test('rotationAffine turns a page clockwise and keeps it in the positive quadrant', () => {
  const w = 300;
  const h = 200;
  // Clockwise: the top-right corner goes to the bottom-right, the top-left to the top-right.
  assert.deepEqual(apply(rotationAffine(1, w, h), [w, 0]), [h, w]);
  assert.deepEqual(apply(rotationAffine(1, w, h), [0, 0]), [h, 0]);
  assert.deepEqual(apply(rotationAffine(2, w, h), [0, 0]), [w, h]);
  assert.deepEqual(apply(rotationAffine(3, w, h), [0, 0]), [0, w]);
  assert.deepEqual(apply(rotationAffine(4, w, h), [10, 20]), [10, 20]);
  assert.deepEqual(apply(rotationAffine(-1, w, h), [0, 0]), [0, w]);
  // Every corner lands inside the rotated page's box.
  for (const q of [1, 2, 3]) {
    const [bw, bh] = q % 2 ? [h, w] : [w, h];
    for (const c of [[0, 0], [w, 0], [w, h], [0, h]] as [number, number][]) {
      const [x, y] = apply(rotationAffine(q, w, h), c);
      assert.ok(x >= 0 && y >= 0 && x <= bw && y <= bh, `turn ${q} corner ${c}`);
    }
  }
});
