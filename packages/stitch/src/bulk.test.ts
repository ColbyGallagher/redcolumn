import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLinework, leftoverTargets, pairInOrder, refineCopiedLine, segmentsNear, PT_PER_MM } from './bulk.ts';

type Seg = [number, number, number, number];
const flat = (segs: Seg[]) => new Float32Array(segs.flat());
const shifted = (segs: Seg[], dx: number, dy: number): Seg[] => segs.map(([a, b, c, d]) => [a + dx, b + dy, c + dx, d + dy]);

/** A vertical dashed line at x from y 200 to 1390: dashes `dash` long every `every` points. */
function dashed(x: number, dash = 30, every = 40): Seg[] {
  const out: Seg[] = [];
  for (let y = 200; y < 1390; y += every) out.push([x, y, x, Math.min(y + dash, 1390)]);
  return out;
}

/**
 * A plan sheet's line work near a vertical match line at x 1000 running y 200..1390: the match
 * line itself (drawn as dashes), its end caps, and road edges crossing it.
 */
function sheet(): Seg[] {
  const out = dashed(1000);
  out.push([993, 200, 1007, 200], [993, 1390, 1007, 1390]);
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
  assert.equal(leftoverTargets([0, 1, 2], [1, 4, 4, 5]), 0);
  assert.equal(leftoverTargets([0, 1], [2, 3, 4, 5]), 2);
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

test('segmentsNear keeps only line work around the lines', () => {
  const near = segmentsNear(flat([...sheet(), [100, 100, 200, 100], [1000, 1500, 1000, 1600]]), [clicked], TOL);
  // The dashes, the bottom cap and the road edges crossing the box; not the top cap (8.5 pt
  // tolerance above y 210 stops at 201.5) or the two segments far away.
  assert.equal(near.length / 4, sheet().length - 1);
  const f = findLinework(clicked.p0, clicked.p1, near, TOL)!;
  assert.deepEqual(f, findLinework(clicked.p0, clicked.p1, flat(sheet()), TOL));
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
    // Farther moves are less sure, but these are well within the tolerance.
    assert.ok(r.confidence >= 0.75, `${dx},${dy}: ${r.confidence}`);
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

test('refineCopiedLine never moves a copy farther than the tolerance', () => {
  // Each drawn line is within the tolerance of the copy, on opposite sides: the move would be
  // nearly twice the tolerance.
  const src = shifted(sheet(), 0.4 - 0.9 * TOL, 0);
  const tgt = shifted(sheet(), 0.4 + 0.9 * TOL, 0);
  const r = refineCopiedLine(clicked, flat(src), flat(tgt), TOL);
  assert.equal(r.snapped, false);
  assert.deepEqual(r.p0, clicked.p0);
  assert.match(r.reason!, /farther than the tolerance/);
});

test('refineCopiedLine flags a target with only part of the line drawn', () => {
  const part = sheet().filter((s) => s[1] < 500 || s[0] !== 1000 || s[2] !== 1000);
  const r = refineCopiedLine(clicked, flat(sheet()), flat(part), TOL);
  assert.equal(r.snapped, false);
  assert.ok(r.confidence < 0.5);
});

test('refineCopiedLine does not snap to a longer unrelated parallel line', () => {
  // The target has no match line, only a kerb running the length of the sheet 2.5 mm off.
  const kerb: Seg[] = [[1000 + 2.5 * PT_PER_MM, 0, 1000 + 2.5 * PT_PER_MM, 1680]];
  const r = refineCopiedLine(clicked, flat(sheet()), flat(kerb), TOL);
  assert.equal(r.snapped, false);
  assert.deepEqual(r.p0, clicked.p0);
});

test('refineCopiedLine is unsure when the target covers far more of the line than the source', () => {
  // A sparse dash-dot match line on the source (40% covered), a solid line on the target.
  const source = dashed(1000, 16, 40);
  const solid: Seg[] = [[1001, 200, 1001, 1390]];
  const f = findLinework(clicked.p0, clicked.p1, flat(source), TOL)!;
  assert.ok(f.coverage > 0.3 && f.coverage < 0.45, `${f.coverage}`);
  const r = refineCopiedLine(clicked, flat(source), flat(solid), TOL);
  assert.equal(r.snapped, false);
  assert.ok(r.confidence < 0.5, `${r.confidence}`);
});

test('refineCopiedLine ignores a dash-dot line too sparse to measure', () => {
  // 6 pt dashes every 40 pt: 15% of the line, below the coverage floor.
  const r = refineCopiedLine(clicked, flat(dashed(1000, 6, 40)), flat(dashed(1001, 6, 40)), TOL);
  assert.equal(r.snapped, false);
  assert.match(r.reason!, /source/);
});

test('refineCopiedLine picks the line nearest the source offset but is unsure with a twin close by', () => {
  // The target has the match line moved 1 pt, and an identical line 5 pt beyond it.
  const twin = [...sheet(), ...shifted(dashed(1000), 5, 0)];
  const r = refineCopiedLine(clicked, flat(sheet()), flat(shifted(twin, 1, 0)), TOL);
  // It lands on the nearer line (moved 1 pt), not the twin (6 pt)...
  assert.ok(Math.abs(r.p0[0] - (clicked.p0[0] + 1)) < 0.05 || !r.snapped, `${r.p0}`);
  // ...and says it may be the wrong one: half its usual confidence, just at the snap threshold.
  assert.ok(r.confidence <= 0.5);
  const alone = refineCopiedLine(clicked, flat(sheet()), flat(shifted(sheet(), 1, 0)), TOL);
  assert.ok(alone.confidence > 0.9 && alone.snapped);
  assert.ok(Math.abs(r.confidence - alone.confidence / 2) < 0.02);
});
