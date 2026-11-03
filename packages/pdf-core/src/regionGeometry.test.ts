import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipSegmentToBox, outsideParts, pointInPolygon, polygonRegion, rectRegion, regionContains, regionHasPoint, regionHits, type Box, type Pt } from './regionGeometry.ts';

const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
const triangle: Pt[] = [[0, 0], [10, 0], [0, 10]];
// A "U": the notch between x 3..7 is outside, above y 4.
const concave: Pt[] = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 4], [3, 4], [3, 10], [0, 10]];
const box = (l: number, b: number, r: number, t: number): Box => ({ l, b, r, t });

test('point in polygon: convex and concave', () => {
  assert.equal(pointInPolygon([2, 2], triangle), true);
  assert.equal(pointInPolygon([8, 8], triangle), false);
  assert.equal(pointInPolygon([1, 8], concave), true);
  assert.equal(pointInPolygon([5, 8], concave), false);
  assert.equal(pointInPolygon([5, 2], concave), true);
});

test('box vs triangle: inside its bounds but outside the triangle is not hit', () => {
  const g = polygonRegion(triangle);
  assert.equal(regionHits(g, box(7, 7, 9, 9)), false);
  assert.equal(regionHits(g, box(1, 1, 2, 2)), true);
  // Straddling the hypotenuse.
  assert.equal(regionHits(g, box(4, 4, 7, 7)), true);
  // Polygon vertex inside a box too big to have its centre inside.
  assert.equal(regionHits(polygonRegion([[5, 5], [6, 5], [5, 6]]), box(0, 0, 5.2, 5.2)), true);
  assert.equal(regionHits(g, box(20, 20, 30, 30)), false);
});

test('wholly inside needs no edge crossing, which matters for concave polygons', () => {
  const g = polygonRegion(concave);
  assert.equal(regionContains(g, box(1, 1, 2, 2)), true);
  // All four corners inside the U, but the notch cuts through.
  assert.equal(regionContains(g, box(1, 3, 9, 5)), false);
  assert.equal(regionContains(g, box(4, 5, 6, 8)), false);
  assert.equal(regionContains(polygonRegion(triangle), box(1, 1, 3, 3)), true);
  assert.equal(regionContains(polygonRegion(triangle), box(4, 4, 7, 7)), false);
});

test('a rectangle region keeps the old box semantics', () => {
  const g = rectRegion(box(0, 0, 10, 10));
  assert.equal(regionContains(g, box(0, 0, 10, 10)), true);
  assert.equal(regionHits(g, box(9, 9, 12, 12)), true);
  assert.equal(regionHits(g, box(10, 0, 12, 5)), false);
  assert.equal(regionHasPoint(polygonRegion(triangle), [8, 8]), false);
  assert.equal(regionHasPoint(g, [8, 8]), true);
});

test('segments: fully inside, fully outside, crossing', () => {
  const g = [polygonRegion(square)];
  assert.deepEqual(outsideParts([2, 2], [8, 8], g), []);
  assert.deepEqual(outsideParts([20, 0], [30, 0], g), [[0, 1]]);
  const parts = outsideParts([-10, 5], [20, 5], g);
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts[0]![1] - 1 / 3) < 1e-9);
  assert.ok(Math.abs(parts[1]![0] - 2 / 3) < 1e-9);
});

test('segments through a concave polygon come out in pieces', () => {
  const g = [polygonRegion(concave)];
  // y = 8 runs through the two arms of the U and across the notch.
  const parts = outsideParts([-1, 8], [11, 8], g);
  assert.equal(parts.length, 3);
  const at = (t: number) => -1 + 12 * t;
  assert.ok(Math.abs(at(parts[0]![0]) - -1) < 1e-9 && Math.abs(at(parts[0]![1]) - 0) < 1e-9);
  assert.ok(Math.abs(at(parts[1]![0]) - 3) < 1e-9 && Math.abs(at(parts[1]![1]) - 7) < 1e-9);
  assert.ok(Math.abs(at(parts[2]![0]) - 10) < 1e-9);
});

// The box-only code this replaces.
function reference(a: Pt, b: Pt, regions: Box[]): [number, number][] {
  const inside: [number, number][] = [];
  for (const g of regions) {
    const c = clipSegmentToBox(a, b, g);
    if (c) inside.push(c);
  }
  inside.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let from = 0;
  for (const [s, e] of inside) {
    if (s > from) out.push([from, s]);
    from = Math.max(from, e);
  }
  if (from < 1) out.push([from, 1]);
  return out;
}

test('a rectangle as a polygon matches the box clipping', () => {
  const boxes = [box(0, 0, 10, 10), box(8, 4, 20, 6)];
  const polys = boxes.map((g) => polygonRegion([[g.l, g.b], [g.r, g.b], [g.r, g.t], [g.l, g.t]]));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 40 - 10;
  for (let i = 0; i < 300; i++) {
    const a: Pt = [rnd(), rnd()];
    const b: Pt = [rnd(), rnd()];
    const want = reference(a, b, boxes);
    const got = outsideParts(a, b, polys);
    assert.equal(got.length, want.length, `${a} ${b}`);
    got.forEach(([s, e], k) => {
      assert.ok(Math.abs(s - want[k]![0]) < 1e-9 && Math.abs(e - want[k]![1]) < 1e-9);
    });
    assert.deepEqual(outsideParts(a, b, boxes.map(rectRegion)), want);
  }
});
