import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureValue } from './measure.ts';

/** Midpoint-rule integral of f over [0, π], fine enough to stand in for the exact value. */
const integrate = (f: (t: number) => number, n = 400_000) => {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f(((i + 0.5) * Math.PI) / n);
  return (sum * Math.PI) / n;
};
const within = (actual: number, expected: number, rel: number) => assert.ok(Math.abs(actual / expected - 1) <= rel, `${actual} vs ${expected}`);

// One page point is one meter, so the numbers read as meters. A bulge of 1 is a half circle.
const m = 1;
const route: [number, number][] = [[0, 0], [5, 0], [5, 4], [8, 4]];
const routeBulges = [0, 1, 0];

test('a curved polyline keeps its exact circular length when X and Y agree', () => {
  // 5 m straight, a half circle of radius 2 m, 3 m straight.
  within(measureValue('polylength', route, m, { bulges: routeBulges }), 8 + 2 * Math.PI, 1e-12);
  within(measureValue('polylength', route, m, { bulges: routeBulges }, m), 14.283, 1e-4);
});

test('with Y twice X, a half circle becomes a true half ellipse', () => {
  // x = 5 + 2 sin t, y = 2 - 2 cos t with y doubled; the length by independent numeric integration.
  const arc = integrate((t) => Math.hypot(2 * Math.cos(t), 4 * Math.sin(t)));
  within(measureValue('polylength', route, m, { bulges: routeBulges }, 2 * m), 5 + arc + 3, 2e-4);
});

test('a room with a half-circle end: exact at X == Y, stretched by sy/sx otherwise', () => {
  const room: [number, number][] = [[0, 0], [4, 0], [4, 2], [0, 2]];
  const props = { bulges: [0, 1, 0, 0] };
  within(measureValue('area', room, m, props), 8 + Math.PI / 2, 1e-12);
  within(measureValue('area', room, m, props), 9.571, 1e-4);
  within(measureValue('area', room, m, props, 2 * m), 2 * (8 + Math.PI / 2), 5e-4);
  within(measureValue('area', room, m, props, 0.5 * m), 0.5 * (8 + Math.PI / 2), 5e-4);
  // Perimeter with Y doubled: bottom 4 + top 4 + left 2 doubled + the end arc, a half ellipse.
  const arc = integrate((t) => Math.hypot(Math.cos(t), 2 * Math.sin(t)));
  within(measureValue('perimeter', room, m, props, 2 * m), 4 + 4 + 4 + arc, 2e-4);
});

test('curved cutouts are stretched too', () => {
  const room: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole: [number, number][] = [[2, 2], [4, 2], [4, 4], [2, 4]];
  const props = { holes: [hole], holeBulges: [[0, 1, 0, 0]] };
  const flat = measureValue('area', room, m, props);
  within(flat, 100 - (4 + Math.PI / 2), 1e-12);
  within(measureValue('area', room, m, props, 3 * m), 3 * flat, 5e-4);
});

test('a three-point arc is a half ellipse when Y differs', () => {
  const half = integrate((t) => Math.hypot(Math.sin(t), 2 * Math.cos(t)));
  within(measureValue('arcLength', [[0, 0], [1, 1], [2, 0]], m), Math.PI, 1e-12);
  within(measureValue('arcLength', [[0, 0], [1, 1], [2, 0]], m, {}, 2 * m), half, 2e-4);
});
