import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairInOrder } from '@nb/stitch';
import type { StoredManualStitch } from '@nb/markup';
import { bulkStitch, stitchSourceSheets } from './bulkStitch.ts';
import { mergeStitch } from './stitching.ts';

/** A vertical match line at x on a sheet, drawn as one segment from y 100 to 500. */
const drawn = (x: number) => new Float32Array([x, 100, x, 500]);

/** Sheets 0 and 1 joined at x 700 on sheet 0 and x 100 on sheet 1; sheet 2 has a stray line. */
const roads: StoredManualStitch = {
  lines: [
    { id: 'a', pageIndex: 0, p0: [700, 110], p1: [700, 490], contentSide: -1, name: 'CH 280', matchTo: 'b' },
    { id: 'b', pageIndex: 1, p0: [100, 110], p1: [100, 490], contentSide: 1, name: 'CH 280', matchTo: 'a', offset: [2, 0] },
    { id: 'c', pageIndex: 2, p0: [50, 50], p1: [50, 400], contentSide: 1, name: 'ML-1', matchTo: null },
  ],
  regions: { 0: [[10, 10], [780, 10], [780, 580], [10, 580]] },
};

test('stitchSourceSheets lists sheets with matched lines', () => {
  assert.deepEqual(stitchSourceSheets(roads), [0, 1]);
});

test('bulkStitch copies a stitch onto later sheets of the same document and nudges it onto their line work', async () => {
  const pairs = pairInOrder(stitchSourceSheets(roads), [3, 4]);
  const src: Record<number, number> = { 0: 700, 1: 100 };
  // Sheet 4 (the second drainage sheet) is drawn 1.5 pt to the right; sheet 3 has no line work at all.
  const { next, results } = await bulkStitch({
    source: roads,
    target: roads,
    pairs,
    toleranceMm: 3,
    sourceSegments: async (p) => drawn(src[p]!),
    targetSegments: async (p) => (p === 4 ? drawn(101.5) : new Float32Array()),
  });
  assert.equal(next.lines.length, 5);
  const copies = next.lines.slice(3);
  assert.deepEqual(copies.map((l) => l.pageIndex), [3, 4]);
  assert.equal(copies[0]!.matchTo, copies[1]!.id);
  assert.equal(copies[1]!.matchTo, copies[0]!.id);
  assert.deepEqual(copies[1]!.offset, [2, 0]);
  assert.equal(copies[0]!.name, 'CH 280');
  // Kept where copied on sheet 3, nudged on sheet 4.
  assert.deepEqual(copies[0]!.p0, [700, 110]);
  assert.ok(Math.abs(copies[1]!.p0[0] - 101.5) < 0.01);
  assert.deepEqual(next.regions[3], roads.regions[0]);
  assert.deepEqual(
    results.map((r) => [r.target, r.snapped, r.problem !== null]),
    [
      [3, 0, true],
      [4, 1, false],
    ],
  );
  // The copies stitch: sheets 3 and 4 make a group of their own.
  const groups = mergeStitch([], next);
  assert.equal(groups.length, 2);
  assert.ok(groups.some((g) => g.placements.map((p) => p.pageIndex).sort().join() === '3,4'));
});

test('bulkStitch replaces stitching already on the target sheets', async () => {
  const other: StoredManualStitch = {
    lines: [
      { id: 'x', pageIndex: 0, p0: [1, 1], p1: [1, 90], contentSide: 1, name: 'ML-1', matchTo: 'y' },
      { id: 'y', pageIndex: 5, p0: [2, 1], p1: [2, 90], contentSide: -1, name: 'ML-1', matchTo: 'x', offset: [1, 1] },
    ],
    regions: { 0: [[0, 0], [1, 0], [1, 1]], 5: [[0, 0], [2, 0], [2, 2]] },
  };
  // Into another document: its page 0 takes the source's page 0.
  const { next } = await bulkStitch({ source: roads, target: other, pairs: pairInOrder([0, 1], [0, 1], []), toleranceMm: 0, sourceSegments: async () => null, targetSegments: async () => null });
  const y = next.lines.find((l) => l.id === 'y')!;
  assert.equal(y.matchTo, null);
  assert.equal(y.offset, undefined);
  assert.equal(next.lines.filter((l) => l.pageIndex === 0).length, 1);
  assert.deepEqual(next.regions[5], other.regions[5]);
  assert.deepEqual(next.regions[0], roads.regions[0]);
  assert.equal(next.regions[1], undefined);
});
