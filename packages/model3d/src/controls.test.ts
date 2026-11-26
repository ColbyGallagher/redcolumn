import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxPlanes, directionOffset, orientationOf, padBox } from './controls.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

test('view directions put the camera on the right side of the target, at the distance asked', () => {
  assert.deepEqual(directionOffset('front', 10), [0, 0, 10]);
  assert.deepEqual(directionOffset('left', 5), [-5, 0, 0]);
  const top = directionOffset('top', 10);
  close(top[1], 10);
  const iso = directionOffset('iso', 10);
  close(Math.hypot(...iso), 10);
});

test('a section box clips everything outside it: every plane faces in', () => {
  const planes = boxPlanes([0, 0, 0], [10, 4, 6]);
  assert.equal(planes.length, 6);
  // A point inside is on the positive side of all six (kept); one outside is behind at least one.
  const side = (p: number[], pl: (typeof planes)[number]) => pl.normal.reduce((s, n, i) => s + n * (p[i]! - pl.point[i]!), 0);
  assert.ok(planes.every((pl) => side([5, 2, 3], pl) > 0));
  assert.ok(planes.some((pl) => side([11, 2, 3], pl) < 0));
});

test('the section box starts a little outside what it frames', () => {
  const [min, max] = padBox([0, 0, 0], [10, 2, 2], 0.1);
  assert.deepEqual(min, [-1, -1, -1]);
  assert.deepEqual(max, [11, 3, 3]);
});

test('orientation: looking north is yaw 0, looking east is a quarter turn, straight down is pitch -π/2', () => {
  close(orientationOf([0, 0, -1]).yaw, 0);
  close(orientationOf([1, 0, 0]).yaw, Math.PI / 2);
  close(orientationOf([0, -1, 0]).pitch, -Math.PI / 2);
});
