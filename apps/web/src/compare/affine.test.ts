import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affineFromPoints, applyAffine, invertAffine, mapBox, type Affine } from './affine.ts';

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

test('points in a line give no map', () => {
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
});

test('a map undone by its inverse; boxes map to their bounds', () => {
  const m: Affine = [2, 0, 0, 2, 5, 7];
  close(applyAffine(invertAffine(m), applyAffine(m, [3, 4])), [3, 4]);
  const b = mapBox(m, { x: 1, y: 2, w: 3, h: 4 });
  close([b.x, b.y, b.w, b.h], [7, 11, 6, 8]);
});
