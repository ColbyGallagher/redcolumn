import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY,
  affineFromPoints,
  affineRotationDegrees,
  alignRenderScale,
  applyAffine,
  applyOffset,
  invertAffine,
  isIdentityAffine,
  mapBox,
  preAlignTransform,
  scaleToFitTransform,
  type Affine,
} from './affine.ts';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 1e-6, `${a} vs ${b}`));

test('three point pairs give the map between them', () => {
  const m: Affine = [1.5, 0.1, -0.2, 1.4, 30, -12];
  const from: [number, number][] = [
    [10, 10],
    [400, 20],
    [50, 300],
  ];
  const got = affineFromPoints(
    from,
    from.map((p) => applyAffine(m, p)),
  );
  assert.ok(got);
  close(got, m);
});

test('points in a line or fewer than three give no map', () => {
  assert.equal(
    affineFromPoints(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    ),
    null,
  );
  assert.equal(
    affineFromPoints(
      [
        [0, 0],
        [10, 0],
      ],
      [
        [0, 0],
        [10, 0],
      ],
    ),
    null,
  );
});

test('a map undone by its inverse; boxes map to their bounds', () => {
  const m: Affine = [2, 0, 0, 2, 5, 7];
  close(applyAffine(invertAffine(m), applyAffine(m, [3, 4])), [3, 4]);
  const b = mapBox(m, { x: 1, y: 2, w: 3, h: 4 });
  close([b.x, b.y, b.w, b.h], [7, 11, 6, 8]);
});

test('scaleToFitTransform scales matching aspect ratios and ignores mismatched or equal sizes', () => {
  close(scaleToFitTransform({ width: 1728, height: 1296 }, { width: 1152, height: 864 }), [2 / 3, 0, 0, 2 / 3, 0, 0]);
  assert.equal(isIdentityAffine(scaleToFitTransform({ width: 1728, height: 1296 }, { width: 1728, height: 1296 })), true);
  // Different aspect ratios: stays identity.
  assert.equal(isIdentityAffine(scaleToFitTransform({ width: 1728, height: 1296 }, { width: 1296, height: 1728 })), true);
});

test('preAlignTransform, applyOffset, alignRenderScale and affineRotationDegrees', () => {
  const manual: Affine = [1, 0, 0, 1, 10, 20];
  assert.deepEqual(preAlignTransform({ width: 100, height: 100 }, { width: 200, height: 200 }, { transform: manual, scaleToFit: true }), manual);
  close(preAlignTransform({ width: 100, height: 100 }, { width: 200, height: 200 }, { scaleToFit: true }), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(applyOffset(IDENTITY, [5, -3]), [1, 0, 0, 1, 5, -3]);
  assert.ok(Math.abs(alignRenderScale({ width: 720, height: 720 }, { width: 720, height: 720 }, 100) - 100 / 72) < 1e-9);
  assert.ok(Math.abs(alignRenderScale({ width: 10000, height: 5000 }, { width: 10000, height: 5000 }, 100, 7000) - 0.7) < 1e-9);
  assert.ok(Math.abs(affineRotationDegrees([0, 1, -1, 0, 0, 0]) - 90) < 1e-9);
});
