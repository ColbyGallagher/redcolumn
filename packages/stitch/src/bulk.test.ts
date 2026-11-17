import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLinework, pairInOrder, refineCopiedLine, PT_PER_MM } from './bulk.ts';

type Seg = [number, number, number, number];
const flat = (segs: Seg[]) => new Float32Array(segs.flat());
const shifted = (segs: Seg[], dx: number, dy: number): Seg[] => segs.map(([a, b, c, d]) => [a + dx, b + dy, c + dx, d + dy]);

/**
 * A plan sheet's line work near a vertical match line at x 1000 running y 200..1400: the match
 * line itself (drawn as dashes), its end caps, and road edges crossing it.
 */
function sheet(): Seg[] {
  const out: Seg[] = [];
  for (let y = 200; y < 1400; y += 40) out.push([1000, y, 1000, Math.min(y + 30, 1400)]);
  out.push([993, 200, 1007, 200], [993, 1400, 1007, 1400]);
  for (const y of [600, 640, 760, 800]) out.push([700, y, 1300, y + 20]);
  return out;
}
/** The user's line: clicked a little off the drawn one, and short of its ends. */
const clicked = { p0: [1000.4, 210] as [number, number], p1: [1000.4, 1390] as [number, number] };
const TOL = 3 * PT_PER_MM;

test('pairInOrder pairs sources in page order with targets in the order picked, skipping extras', () => {
  assert.deepEqual(pairInOrder([3, 1, 2], [7, 5, 6]), [
    { source: 1, target: 7 },
    { source: 2, target: 5 },
    { source: 3, target: 6 },
  ]);
  // A target that is a source, or picked twice, is dropped; a source left over is skipped.
  assert.deepEqual(pairInOrder([0, 1, 2], [1, 4, 4, 5]), [
    { source: 0, target: 4 },
    { source: 1, target: 5 },
    { source: 2, target: null },
  ]);
  // Targets in another document may share page numbers with the sources.
  assert.deepEqual(pairInOrder([0, 1], [0, 1], []), [
    { source: 0, target: 0 },
    { source: 1, target: 1 },
  ]);
});

test('findLinework finds the dashed match line, not the crossing road edges', () => {
  const f = findLinework(clicked.p0, clicked.p1, flat(sheet()), TOL)!;
  assert.ok(f);
  assert.ok(Math.abs(Math.abs(f.offset) - 0.4) < 0.01, `offset ${f.offset}`);
  assert.ok(f.coverage > 0.7 && f.coverage <= 1);
  assert.ok(Math.abs(f.tMin - -10) < 0.01 && Math.abs(f.tMax - 1180) < 0.01);
});

test('refineCopiedLine leaves a copy alone on an identical sheet', () => {
  const r = refineCopiedLine(clicked, flat(sheet()), flat(sheet()), TOL);
  assert.equal(r.snapped, true);
  assert.equal(r.confidence, 1);
  assert.ok(Math.abs(r.shift[0]) < 1e-6 && Math.abs(r.shift[1]) < 1e-6);
});

test('refineCopiedLine nudges a copy onto a target drawn a little off, keeping the click offset', () => {
  for (const [dx, dy] of [
    [2, 0],
    [-4.5, 3],
    [1.2, -6],
  ] as const) {
    const r = refineCopiedLine(clicked, flat(sheet()), flat(shifted(sheet(), dx, dy)), TOL);
    assert.equal(r.snapped, true, `${dx},${dy}`);
    assert.ok(r.confidence >= 0.9);
    // The copy moves with the drawing, so it sits on the target as the original sits on the source.
    assert.ok(Math.abs(r.p0[0] - (clicked.p0[0] + dx)) < 0.05 && Math.abs(r.p0[1] - (clicked.p0[1] + dy)) < 0.05, `${dx},${dy}: ${r.p0}`);
    assert.ok(Math.abs(r.p1[0] - (clicked.p1[0] + dx)) < 0.05 && Math.abs(r.p1[1] - (clicked.p1[1] + dy)) < 0.05);
  }
});

test('refineCopiedLine keeps the copy where it is when nothing is close enough', () => {
  // Farther across than the tolerance.
  const far = refineCopiedLine(clicked, flat(sheet()), flat(shifted(sheet(), 20, 0)), TOL);
  assert.equal(far.snapped, false);
  assert.deepEqual(far.p0, clicked.p0);
  assert.match(far.reason!, /target/);
  // No drawn line under the source line: nothing to look for.
  const bare = refineCopiedLine({ p0: [200, 210], p1: [200, 1390] }, flat(sheet()), flat(sheet()), TOL);
  assert.equal(bare.snapped, false);
  assert.match(bare.reason!, /source/);
});

test('refineCopiedLine flags a target with only part of the line drawn', () => {
  const part = sheet().filter((s) => s[1] < 500 || s[0] !== 1000 || s[2] !== 1000);
  const r = refineCopiedLine(clicked, flat(sheet()), flat(part), TOL);
  assert.equal(r.snapped, false);
  assert.ok(r.confidence < 0.5);
});

test('refineCopiedLine picks the parallel line nearest the source offset and lowers confidence when two are alike', () => {
  const twin = [...sheet(), ...shifted(sheet().slice(0, 30), 5, 0)];
  const r = refineCopiedLine(clicked, flat(sheet()), flat(shifted(twin, 1, 0)), TOL);
  assert.ok(r.confidence <= 0.5);
});
