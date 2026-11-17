import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairInOrder } from '@nb/stitch';
import type { StoredManualStitch } from '@nb/markup';
import { applyStitching, bulkStitch, placeCopies, replacementSummary, sameSize, stitchSourceSheets, unpartneredLines, type StitchDocument } from './bulkStitch.ts';
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
const src: Record<number, number> = { 0: 700, 1: 100 };
const none = async () => null;

test('stitchSourceSheets lists sheets with matched lines', () => {
  assert.deepEqual(stitchSourceSheets(roads), [0, 1]);
});

test('bulkStitch copies a stitch onto later sheets of the same document and nudges it onto their line work', async () => {
  const pairs = pairInOrder(stitchSourceSheets(roads), [3, 4]);
  const progress: string[] = [];
  // Sheet 4 (the second drainage sheet) is drawn 1.5 pt to the right; sheet 3 has no line work at all.
  const { copy, results } = await bulkStitch({
    source: roads,
    pairs,
    toleranceMm: 3,
    sourceSegments: async (p) => drawn(src[p]!),
    targetSegments: async (p) => (p === 4 ? drawn(101.5) : new Float32Array()),
    onProgress: (d, n) => progress.push(`${d}/${n}`),
  });
  assert.deepEqual(progress, ['1/2', '2/2']);
  const next = placeCopies(roads, copy);
  assert.equal(next.lines.length, 5);
  const copies = next.lines.slice(3);
  assert.deepEqual(copies.map((l) => l.pageIndex), [3, 4]);
  assert.equal(copies[0]!.matchTo, copies[1]!.id);
  assert.equal(copies[1]!.matchTo, copies[0]!.id);
  assert.equal(copies[0]!.name, 'CH 280');
  // Kept where copied on sheet 3, nudged on sheet 4.
  assert.deepEqual(copies[0]!.p0, [700, 110]);
  assert.ok(Math.abs(copies[1]!.p0[0] - 101.5) < 0.01);
  // The snapped copy sits on its own sheet's line: the source's hand adjustment does not carry over.
  assert.equal(copies[1]!.offset, undefined);
  assert.deepEqual(next.regions[3], roads.regions[0]);
  assert.deepEqual(
    results.map((r) => [r.target, r.snapped, r.unpartnered, r.problem !== null]),
    [
      [3, 0, 0, true],
      [4, 1, 0, false],
    ],
  );
  // The copies stitch: sheets 3 and 4 make a group of their own.
  const groups = mergeStitch([], next);
  assert.equal(groups.length, 2);
  assert.ok(groups.some((g) => g.placements.map((p) => p.pageIndex).sort().join() === '3,4'));
});

test('bulkStitch keeps the hand adjustment on a copy it left in place', async () => {
  const { copy } = await bulkStitch({ source: roads, pairs: pairInOrder([0, 1], [3, 4]), toleranceMm: 0, sourceSegments: none, targetSegments: none });
  assert.deepEqual(copy.lines.find((l) => l.pageIndex === 4)!.offset, [2, 0]);
});

test('bulkStitch copies onto a mismatched sheet without snapping it', async () => {
  const { copy, results } = await bulkStitch({
    source: roads,
    pairs: pairInOrder([0, 1], [3, 4]),
    toleranceMm: 3,
    sourceSegments: async (p) => drawn(src[p]!),
    targetSegments: async () => drawn(101.5),
    copyOnly: new Map([[4, 'A different page size']]),
  });
  assert.deepEqual(copy.lines.find((l) => l.pageIndex === 4)!.p0, [100, 110]);
  assert.equal(results.find((r) => r.target === 4)!.problem, 'A different page size');
  assert.deepEqual(results.map((r) => r.checked), [true, false]);
  assert.equal(sameSize({ width: 2384, height: 1684 }, { width: 2383, height: 1685 }), true);
  assert.equal(sameSize({ width: 2384, height: 1684 }, { width: 1684, height: 2384 }), false);
  // A half turn, or a quarter turn of a square page, keeps the size: the rotation tells them apart.
  assert.equal(sameSize({ width: 2384, height: 1684, rotation: 0 }, { width: 2384, height: 1684, rotation: 180 }), false);
  assert.equal(sameSize({ width: 800, height: 800, rotation: 90 }, { width: 800, height: 800, rotation: -270 }), true);
  assert.equal(sameSize({ width: 800, height: 800, rotation: 90 }, { width: 800, height: 800 }), true);
});

test('a skipped partner row leaves its partner unmatched, and says so', async () => {
  // Sheet 1's row is skipped: the copy of sheet 0's line has nothing to join.
  const pairs = [
    { source: 0, target: 3 },
    { source: 1, target: null },
  ];
  assert.equal(unpartneredLines(roads, pairs), 1);
  const { copy, results } = await bulkStitch({ source: roads, pairs, toleranceMm: 0, sourceSegments: none, targetSegments: none });
  assert.equal(copy.lines.length, 1);
  assert.equal(copy.lines[0]!.matchTo, null);
  assert.equal(copy.lines[0]!.offset, undefined);
  assert.equal(results[0]!.unpartnered, 1);
  assert.equal(unpartneredLines(roads, pairInOrder([0, 1], [3, 4])), 0);
});

test('placeCopies replaces stitching on the target sheets and keeps changes made meanwhile', async () => {
  const other: StoredManualStitch = {
    lines: [
      { id: 'x', pageIndex: 0, p0: [1, 1], p1: [1, 90], contentSide: 1, name: 'ML-1', matchTo: 'y' },
      { id: 'y', pageIndex: 5, p0: [2, 1], p1: [2, 90], contentSide: -1, name: 'ML-1', matchTo: 'x', offset: [1, 1] },
    ],
    regions: { 0: [[0, 0], [1, 0], [1, 1]], 5: [[0, 0], [2, 0], [2, 2]] },
  };
  assert.deepEqual(replacementSummary(other, [0, 1]), { lines: 1, regions: 1, sheets: 1, broken: 1 });
  // Into another document: its page 0 takes the source's page 0.
  const { copy } = await bulkStitch({ source: roads, pairs: pairInOrder([0, 1], [0, 1], []), toleranceMm: 0, sourceSegments: none, targetSegments: none });
  // Someone adds a line on page 7 while the copy is worked out: it stays.
  const meanwhile: StoredManualStitch = { ...other, lines: [...other.lines, { id: 'z', pageIndex: 7, p0: [5, 5], p1: [5, 50], contentSide: 1, name: 'ML-2', matchTo: null }] };
  const next = placeCopies(meanwhile, copy);
  const y = next.lines.find((l) => l.id === 'y')!;
  assert.equal(y.matchTo, null);
  assert.equal(y.offset, undefined);
  assert.ok(next.lines.some((l) => l.id === 'z'));
  assert.equal(next.lines.filter((l) => l.pageIndex === 0).length, 1);
  assert.deepEqual(next.regions[5], other.regions[5]);
  assert.deepEqual(next.regions[0], roads.regions[0]);
  assert.equal(next.regions[1], undefined);
});

test('bulkStitch stops when aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(bulkStitch({ source: roads, pairs: pairInOrder([0, 1], [3, 4]), toleranceMm: 0, sourceSegments: none, targetSegments: none, signal: ac.signal }));
});

test('applyStitching stopped part way writes nothing', async () => {
  let written = 0;
  const doc: StitchDocument = {
    store: { manualStitch: () => roads, setManualStitch: () => void written++ },
    doc: { geometry: async () => ({ segments: drawn(700) }) },
  };
  const ac = new AbortController();
  const progress: number[] = [];
  // Stop is pressed once the first pair is done.
  await assert.rejects(applyStitching(doc, doc, pairInOrder([0, 1], [3, 4]), 3, { signal: ac.signal, onProgress: (d) => (progress.push(d), ac.abort()) }));
  assert.deepEqual(progress, [1]);
  assert.equal(written, 0);
  // Not stopped: written once.
  await applyStitching(doc, doc, pairInOrder([0, 1], [3, 4]), 3);
  assert.equal(written, 1);
});
