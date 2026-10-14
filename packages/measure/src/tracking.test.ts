import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapIndex, type SnapKind } from './snap.ts';
import { track, trackingPaths } from './tracking.ts';

/** A circle of radius `r` about (cx, cy) flattened into `n` joined curve pieces. */
function circle(cx: number, cy: number, r: number, n = 32, sweep = 360): { segs: number[]; curves: number[] } {
  const segs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i / n) * sweep * Math.PI) / 180;
    const b = (((i + 1) / n) * sweep * Math.PI) / 180;
    segs.push(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  return { segs, curves: segs.filter((_, i) => i % 4 === 0).map(() => 1) };
}

const close = (a: readonly number[] | undefined, b: readonly number[]) => !!a && Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 0.05;
const kinds = (...k: SnapKind[]) => new Set<SnapKind>(k);

test('a circle in the drawing snaps at its centre and quadrants', () => {
  const c = circle(100, 100, 40);
  const idx = new SnapIndex(new Float32Array(c.segs), 24, new Uint8Array(c.curves));
  const centre = idx.snap([102, 99], 6, [], kinds('center'));
  assert.equal(centre?.kind, 'center');
  assert.ok(close(centre?.point, [100, 100]));
  const top = idx.snap([101, 62], 6, [], kinds('quadrant'));
  assert.equal(top?.kind, 'quadrant');
  assert.ok(close(top?.point, [100, 60]));
});

test('a half arc snaps at the quadrant it passes but not at the ones it stops short of', () => {
  // From east, round through south (page y down), to west.
  const c = circle(0, 0, 50, 16, 180);
  const idx = new SnapIndex(new Float32Array(c.segs), 24, new Uint8Array(c.curves));
  assert.ok(close(idx.snap([1, 49], 5, [], kinds('quadrant'))?.point, [0, 50]));
  assert.equal(idx.snap([1, -49], 5, [], kinds('quadrant')), null);
});

test('perpendicular and tangent snaps are taken from the point being drawn from', () => {
  // A wall along y = 0 from x = 0 to 200; drawing from (60, 80).
  const idx = new SnapIndex(new Float32Array([0, 0, 200, 0]), 24);
  assert.deepEqual(idx.snap([63, 2], 6, [], kinds('perpendicular'), true, { from: [60, 80] })?.point, [60, 0]);
  // Without a from point there is nothing to be perpendicular to.
  assert.equal(idx.snap([63, 2], 6, [], kinds('perpendicular')), null);

  const c = circle(0, 0, 30);
  const ring = new SnapIndex(new Float32Array(c.segs), 24, new Uint8Array(c.curves));
  // From (60, 0), the tangent points are at 60° either side of the line to the centre.
  const t = ring.snap([16, 27], 6, [], kinds('tangent'), true, { from: [60, 0] });
  assert.equal(t?.kind, 'tangent');
  assert.ok(close(t?.point, [15, 25.98]));
});

test('apparent intersections are where two lines would meet if extended', () => {
  // Two lines that stop short of each other's line: their extensions meet at (50, 50).
  const idx = new SnapIndex(new Float32Array([0, 50, 46, 50, 50, 0, 50, 46]), 16);
  assert.equal(idx.snap([49, 49], 6, [], kinds('intersection')), null);
  assert.deepEqual(idx.snap([49, 49], 6, [], kinds('apparent'))?.point, [50, 50]);
});

test('extra lines (markup outlines) are snapped onto and crossed, but their ends do not snap', () => {
  const idx = new SnapIndex(new Float32Array([0, 50, 100, 50]), 16);
  const lines = [50, 0, 50, 100];
  assert.deepEqual(idx.snap([51, 49], 5, [], undefined, true, { lines })?.kind, 'intersection');
  assert.equal(idx.snap([50, 1], 3, [], kinds('endpoint'), true, { lines }), null);
});

test('an acquired point gives straight paths through it, and two cross where both line up', () => {
  const acquired = [{ point: [100, 100] as const }, { point: [300, 200] as const }];
  const opts = { acquired, objectTracking: true, polarStep: null, extensions: false };
  // Level with the first point, well off to the right.
  const level = track([250, 103], 8, opts);
  assert.deepEqual(level?.point, [250, 100]);
  assert.equal(level?.paths[0]?.angle, 0);
  // Below the second and level with the first: where both paths cross.
  const both = track([297, 104], 8, opts);
  assert.deepEqual(both?.point, [300, 100]);
  assert.equal(both?.paths.length, 2);
  // Right by an acquired point the pointer is not pulled onto its paths.
  assert.equal(track([103, 100], 8, opts), null);
});

test('polar tracking follows angles from the point being drawn from', () => {
  const opts = { acquired: [], objectTracking: true, polarStep: 45, extensions: false, from: [0, 0] as const };
  const t = track([70, -72], 6, opts);
  // 45° on paper is up and to the right (page y runs down).
  assert.equal(t?.paths[0]?.kind, 'polar');
  assert.equal(t?.paths[0]?.angle, 45);
  assert.ok(Math.abs(t!.point[0] + t!.point[1]) < 1e-9);
  assert.equal(trackingPaths(opts).length, 8);
});

test('an extension runs on past the end of a line, and a tracking path stops at a line it crosses', () => {
  const acquired = [{ point: [100, 0] as const, extensions: [[1, 0]] as const }];
  const opts = { acquired, objectTracking: false, polarStep: null, extensions: true };
  assert.deepEqual(track([180, 3], 6, opts)?.point, [180, 0]);
  // Not back over the line itself.
  assert.equal(track([40, 3], 6, opts), null);
  // A wall at x = 182 nearby: the extension meets it.
  const hit = track([180, 3], 6, opts, [182, -50, 182, 50]);
  assert.deepEqual(hit?.point, [182, 0]);
  assert.equal(hit?.onLine, true);
});

test('parallel paths run from the point being drawn from in an acquired line direction', () => {
  const d = Math.SQRT1_2;
  const opts = { acquired: [], objectTracking: false, polarStep: null, extensions: false, from: [0, 0] as const, parallels: [[d, d]] as const };
  const t = track([-52, -48], 6, opts);
  assert.equal(t?.paths[0]?.kind, 'parallel');
  assert.ok(Math.abs(t!.point[0] - t!.point[1]) < 1e-9);
});
