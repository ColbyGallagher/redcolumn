import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptCentre } from './keepView.ts';

test('keeps the same point on a page of the same size', () => {
  assert.deepEqual(keptCentre([300, 200], { width: 1224, height: 792 }), [300, 200]);
});

test('keeps the same page coordinate on a larger page', () => {
  assert.deepEqual(keptCentre([300, 200], { width: 2448, height: 1584 }), [300, 200]);
});

test('clamps to the bounds of a smaller page', () => {
  assert.deepEqual(keptCentre([1000, 700], { width: 600, height: 400 }), [600, 400]);
  assert.deepEqual(keptCentre([-50, -10], { width: 600, height: 400 }), [0, 0]);
});

test('falls back to the middle when the point is not finite', () => {
  assert.deepEqual(keptCentre([Number.NaN, 5], { width: 600, height: 400 }), [300, 5]);
});
