import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFDict, decodePDFRawStream, rgb } from 'pdf-lib';
import { DEFAULT_STYLES, type Markup, type StoredManualStitch, type StoredStitchGroup } from '@nb/markup';
import { stitchToPage, stitchedMarkups } from './stitchPages.ts';
import { adoptDetected, autoPair, dragToShift, lineProblem, mergeStitch, moverLine, newMatchLine, nudgeToShift, pairLines, shiftLine, withViewportRegions } from './stitching.ts';

/** Two 400 × 300 sheets of one road, split at a match line 300 pt in from the first sheet's left. */
async function sheets() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([400, 300]);
    p.drawLine({ start: { x: 0, y: 150 }, end: { x: 400, y: 150 }, color: rgb(0, 0, 0), thickness: 2 });
    // Title block in the bottom-right corner.
    p.drawRectangle({ x: 320, y: 0, width: 80, height: 40, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  }
  return doc.save();
}

const contentText = (doc: PDFDocument, pageIndex: number) => {
  const c = doc.getPage(pageIndex).node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r) as PDFRawStream) : [c as PDFRawStream];
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n');
};

/** Sheet 1 at x 0–300, sheet 2 placed to its right from its own x 100 on (same scale). */
const group: StoredStitchGroup = {
  placements: [
    { pageIndex: 0, toWorld: [1, 0, 0, 1, 0, 0], clips: [{ point: [300, 0], normal: [-1, 0] }], region: [[0, 0], [400, 0], [400, 250], [0, 250]] },
    { pageIndex: 1, toWorld: [1, 0, 0, 1, 200, 0], clips: [{ point: [100, 0], normal: [1, 0] }] },
  ],
  edges: [{ a: 0, b: 1, station: null, votes: 0, confidence: 1 }],
};

test('stitching adds one page holding both sheets clipped at the match line', async () => {
  const result = await stitchToPage(await sheets(), group);
  const doc = await PDFDocument.load(result.bytes);
  assert.equal(doc.getPageCount(), 3);
  assert.equal(result.pageIndex, 2);
  // World x 0–600 and y 0–300, plus a 36 pt margin all round.
  const { width, height } = doc.getPage(2).getSize();
  assert.equal(width, 600 + 72);
  assert.equal(height, 300 + 72);
  const xo = doc.getPage(2).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  assert.deepEqual(xo.keys().map(String).sort(), ['/S0', '/S1']);
  const ops = contentText(doc, 2);
  // Each sheet draws inside its own clip path.
  assert.equal(ops.match(/ W n /g)?.length, 2);
  assert.match(ops, /\/S0 Do/);
  assert.match(ops, /\/S1 Do/);
  // Sheet 1's region stops above its title block: page y 250 lands at 300 + 36 - 250 in user space.
  assert.match(ops, /336 86 l 36 86 l/);
});

test('markups follow their sheet; those outside the kept part are left out', () => {
  const mk = (id: string, pageIndex: number, points: [number, number][]): Markup => ({ id, type: 'line', pageIndex, points, style: { ...DEFAULT_STYLES.line }, author: 'a', createdAt: 0, modifiedAt: 0, status: 'none', seq: 4, groupId: 'g' }) as Markup;
  const markups = [mk('a', 0, [[10, 10], [50, 10]]), mk('title', 0, [[350, 280], [390, 280]]), mk('b', 1, [[150, 100], [180, 100]]), mk('past', 1, [[20, 20], [60, 20]])];
  const visible = new Map([
    [0, [[0, 0], [300, 0], [300, 250], [0, 250]] as [number, number][]],
    [1, [[100, 0], [400, 0], [400, 300], [100, 300]] as [number, number][]],
  ]);
  const toPage = new Map([
    [0, [1, 0, 0, 1, 36, 36] as const],
    [1, [1, 0, 0, 1, 236, 36] as const],
  ]);
  let n = 0;
  const copies = stitchedMarkups(markups, { pageIndex: 2, toPage, visible }, () => `new${++n}`);
  assert.deepEqual(copies.map((m) => [m.id, m.pageIndex, m.points[0]]), [
    ['new1', 2, [46, 46]],
    ['new2', 2, [386, 136]],
  ]);
  assert.equal(copies[0]!.seq, undefined);
  assert.equal(copies[0]!.groupId, undefined);
});

test('pairing, unpairing and matching by name', () => {
  const size = { width: 400, height: 300 };
  let lines = [newMatchLine([], 0, [300, 0], [300, 300], size)];
  lines.push(newMatchLine(lines, 1, [100, 300], [100, 0], size));
  assert.deepEqual(lines.map((l) => l.name), ['ML-1', 'ML-2']);
  // A line near the right edge keeps the left; one near the left keeps the right.
  assert.equal(lines[0]!.contentSide, 1);
  assert.equal(lineProblem(lines[0]!, {}), 'Not matched to a line on another sheet');
  lines = pairLines(lines, lines[0]!.id, lines[1]!.id);
  assert.equal(lines[1]!.matchTo, lines[0]!.id);
  lines.push(newMatchLine(lines, 2, [10, 0], [10, 300], size));
  // Re-pairing the first line drops its old partner.
  lines = pairLines(lines, lines[0]!.id, lines[2]!.id);
  assert.deepEqual(lines.map((l) => l.matchTo), [lines[2]!.id, null, lines[0]!.id]);

  const named = autoPair([
    { ...lines[1]!, name: '12+00', matchTo: null },
    { ...lines[0]!, name: 'other', matchTo: null },
    { ...lines[2]!, pageIndex: 3, name: '12+00 ', matchTo: null },
  ]);
  assert.equal(named.paired, 1);
  assert.equal(named.lines[0]!.matchTo, named.lines[2]!.id);
});

test('regions: drawn, from the biggest viewport, and checked against the line ends', () => {
  const line = { id: 'a', pageIndex: 0, p0: [300, 10] as [number, number], p1: [300, 280] as [number, number], contentSide: 1 as const, name: 'A', matchTo: 'b' };
  const manual: StoredManualStitch = { lines: [line], regions: {} };
  const vp = (w: number) => ({ id: `v${w}`, pageIndex: 0, name: '', rect: { x: 0, y: 0, w, h: 250 }, scale: { metersPerPoint: 1, unit: 'm' } as never });
  assert.deepEqual(withViewportRegions(manual, [vp(100), vp(320)]).regions[0], [[0, 0], [320, 0], [320, 250], [0, 250]]);
  // The bottom end (y 280) is below the viewport.
  assert.equal(lineProblem(line, withViewportRegions(manual, [vp(320)]).regions), 'An end is outside the region');
  assert.equal(lineProblem(line, { 0: [[0, 0], [400, 0], [400, 300], [0, 300]] }), null);
});

test('hand-placed groups replace the detected ones on the same sheets', () => {
  const auto: StoredStitchGroup[] = [
    { placements: [{ pageIndex: 0, toWorld: [1, 0, 0, 1, 0, 0], clips: [] }, { pageIndex: 5, toWorld: [1, 0, 0, 1, 9, 9], clips: [] }], edges: [] },
    { placements: [{ pageIndex: 7, toWorld: [1, 0, 0, 1, 0, 0], clips: [] }], edges: [] },
  ];
  const size = { width: 400, height: 300 };
  const a = { ...newMatchLine([], 0, [300, 0], [300, 300], size), id: 'a', matchTo: 'b' };
  const b = { ...newMatchLine([], 1, [100, 300], [100, 0], size), id: 'b', matchTo: 'a' };
  const merged = mergeStitch(auto, { lines: [a, b], regions: { 7: [[0, 0], [10, 0], [10, 10]] } });
  assert.deepEqual(merged.map((g) => g.placements.map((p) => p.pageIndex)), [[0, 1], [7]]);
  assert.deepEqual(merged[1]!.placements[0]!.region, [[0, 0], [10, 0], [10, 10]]);
  // Nothing placed by hand: the detected groups as they were.
  assert.equal(mergeStitch(auto, { lines: [], regions: {} }), auto);
});

test('a detected join taken over by hand keeps its placement, and a drag becomes an adjustment', () => {
  // Sheet 1 sits 200 pt right of sheet 0 and turned a quarter turn in the world.
  const group: StoredStitchGroup = {
    placements: [
      { pageIndex: 0, toWorld: [1, 0, 0, 1, 0, 0], clips: [] },
      { pageIndex: 1, toWorld: [0, 1, -1, 0, 500, -100], clips: [] },
    ],
    edges: [{ a: 0, b: 1, station: '12+00', votes: 5, confidence: 0.8, line: { p0: [300, 0], p1: [300, 300], contentSide: 1 } }],
  };
  const lines = adoptDetected(group, []);
  assert.deepEqual(lines.map((l) => [l.pageIndex, l.name, l.matchTo === lines.find((o) => o.pageIndex !== l.pageIndex)!.id]), [
    [0, '12+00', true],
    [1, '12+00', true],
  ]);
  const [rebuilt] = mergeStitch([], { lines, regions: {} });
  for (const [k, v] of rebuilt!.placements[1]!.toWorld.entries()) assert.ok(Math.abs(v - group.placements[1]!.toWorld[k]!) < 1e-9, `toWorld[${k}]`);

  // Sheet 1 is placed from sheet 0, so it is the one that moves.
  assert.equal(moverLine(lines, lines[0]!.id, rebuilt!)?.pageIndex, 1);
  // A drag down the screen runs along the line (p0 → p1 is +y on sheet 0); locked, the sideways part is dropped.
  assert.deepEqual(dragToShift(lines, lines[1]!.id, [1, 0, 0, 1], [3, 10], true), [10, 0]);
  const [along, across] = dragToShift(lines, lines[1]!.id, [1, 0, 0, 1], [3, 10], false);
  assert.equal(along, 10);
  // Across points out of sheet 0's drawing (it keeps the side left of x 300): +x.
  assert.equal(across, 3);
  const moved = shiftLine(lines, lines[1]!.id, along, across);
  const [after] = mergeStitch([], { lines: moved, regions: {} });
  const p: [number, number] = [50, 60];
  const at = (t: readonly number[]) => [t[0]! * p[0] + t[2]! * p[1] + t[4]!, t[1]! * p[0] + t[3]! * p[1] + t[5]!];
  const [x0, y0] = at(rebuilt!.placements[1]!.toWorld);
  const [x1, y1] = at(after!.placements[1]!.toWorld);
  assert.ok(Math.abs(x1! - x0! - 3) < 1e-9 && Math.abs(y1! - y0! - 10) < 1e-9);
  // Shifting back clears the adjustment.
  assert.equal(shiftLine(moved, lines[1]!.id, -along, -across)[1]!.offset, undefined);
});

test('a nudged join survives its sheets being reordered', () => {
  const size = { width: 400, height: 300 };
  const a = { ...newMatchLine([], 0, [300, 0], [300, 300], size), id: 'a', matchTo: 'b' };
  const b = { ...newMatchLine([], 1, [100, 300], [100, 0], size), id: 'b', matchTo: 'a', offset: [0, 10] as [number, number] };
  const place = (lines: typeof a[]) => {
    const [g] = mergeStitch([], { lines, regions: {} });
    const pa = g!.placements.find((p) => p.pageIndex === lines[0]!.pageIndex)!.toWorld;
    const pb = g!.placements.find((p) => p.pageIndex === lines[1]!.pageIndex)!.toWorld;
    // Sheet b's page space in sheet a's: the same whichever sheet the group is laid out from.
    const at = (m: readonly number[], p: [number, number]) => [m[0]! * p[0] + m[2]! * p[1] + m[4]!, m[1]! * p[0] + m[3]! * p[1] + m[5]!];
    const w = at(pb, [50, 50]);
    const det = pa[0] * pa[3] - pa[1] * pa[2];
    const [dx, dy] = [w[0]! - pa[4], w[1]! - pa[5]];
    return [(pa[3] * dx - pa[2] * dy) / det, (-pa[1] * dx + pa[0] * dy) / det];
  };
  const before = place([a, b]);
  // Move sheet b in front of sheet a: same lines, page numbers swapped.
  const after = place([{ ...a, pageIndex: 1 }, { ...b, pageIndex: 0 }]);
  assert.ok(Math.hypot(before[0]! - after[0]!, before[1]! - after[1]!) < 1e-6, `${before} vs ${after}`);
  // The 10 pt adjustment really moved sheet b apart from a (+x, out of a's drawing on the left).
  const plain = place([a, { ...b, offset: undefined } as typeof a]);
  assert.ok(Math.abs(before[0]! - plain[0]! - 10) < 1e-6);
  // ▼ (apart) is +across on b's line, but -across when the moving line is the reference.
  assert.deepEqual(nudgeToShift([a, b], 'b', 0, 5), [0, 5]);
  assert.deepEqual(nudgeToShift([a, b], 'a', 0, 5), [0, -5]);
});

test('joining two detected sheets by hand keeps the rest of the detected chain', () => {
  const line = { p0: [300, 0] as [number, number], p1: [300, 300] as [number, number], contentSide: 1 as const };
  const auto: StoredStitchGroup[] = [
    {
      placements: [
        { pageIndex: 0, toWorld: [1, 0, 0, 1, 0, 0], clips: [] },
        { pageIndex: 1, toWorld: [1, 0, 0, 1, 200, 0], clips: [] },
        { pageIndex: 2, toWorld: [1, 0, 0, 1, 400, 0], clips: [] },
      ],
      edges: [
        { a: 0, b: 1, station: null, votes: 5, confidence: 0.8, line },
        { a: 1, b: 2, station: null, votes: 5, confidence: 0.8, line },
      ],
    },
  ];
  const size = { width: 400, height: 300 };
  const a = { ...newMatchLine([], 0, [300, 0], [300, 300], size), id: 'a', matchTo: 'b' };
  const b = { ...newMatchLine([], 1, [100, 300], [100, 0], size), id: 'b', matchTo: 'a', offset: [5, 0] as [number, number] };
  const [g, ...rest] = mergeStitch(auto, { lines: [a, b], regions: {} });
  assert.equal(rest.length, 0);
  assert.deepEqual(g!.placements.map((p) => p.pageIndex).sort(), [0, 1, 2]);
  // Sheet 2 stays 200 pt on from sheet 1, wherever the hand-placed join put sheet 1.
  const at = (i: number) => g!.placements.find((p) => p.pageIndex === i)!.toWorld;
  assert.ok(Math.abs(at(2)[4] - at(1)[4] - 200) < 1e-6 && Math.abs(at(2)[5] - at(1)[5]) < 1e-6);
  // Sheet 1 was cut at the hand-placed line and at the detected one to sheet 2.
  assert.equal(g!.placements.find((p) => p.pageIndex === 1)!.clips.length, 2);
});

test('a match line with its ends together stitches nothing and says why', () => {
  const size = { width: 400, height: 300 };
  const a = { ...newMatchLine([], 0, [300, 0], [300, 300], size), id: 'a', matchTo: 'b' };
  const b = { ...newMatchLine([], 1, [100, 300], [100, 0], size), id: 'b', matchTo: 'a', p1: [100, 300] as [number, number] };
  assert.deepEqual(mergeStitch([], { lines: [a, b], regions: {} }), []);
  assert.equal(lineProblem(b, {}), 'The line is too short: drag its ends apart');
});

test('hand-joining 1-2 and 3-4 keeps the detected 2-3 join between them', () => {
  const line = { p0: [300, 0] as [number, number], p1: [300, 300] as [number, number], contentSide: 1 as const };
  const auto: StoredStitchGroup[] = [
    {
      placements: [0, 1, 2, 3].map((i) => ({ pageIndex: i, toWorld: [1, 0, 0, 1, i * 200, 0] as [number, number, number, number, number, number], clips: [] })),
      edges: [0, 1, 2].map((i) => ({ a: i, b: i + 1, station: null, votes: 5, confidence: 0.8, line })),
    },
  ];
  const size = { width: 400, height: 300 };
  const pair = (x: string, y: string, pa: number) => [
    { ...newMatchLine([], pa, [300, 0], [300, 300], size), id: x, matchTo: y },
    { ...newMatchLine([], pa + 1, [100, 300], [100, 0], size), id: y, matchTo: x },
  ];
  const groups = mergeStitch(auto, { lines: [...pair('a', 'b', 0), ...pair('c', 'd', 2)], regions: {} });
  assert.deepEqual(groups.map((g) => g.placements.map((p) => p.pageIndex).sort()), [[0, 1, 2, 3]]);
});

test('re-pairing a line drops the adjustment it had with its old partner', () => {
  const size = { width: 400, height: 300 };
  const a = { ...newMatchLine([], 0, [300, 0], [300, 300], size), id: 'a', matchTo: 'b', offset: [3, 4] as [number, number] };
  const b = { ...newMatchLine([], 1, [100, 300], [100, 0], size), id: 'b', matchTo: 'a', offset: [20, 0] as [number, number] };
  const c = { ...newMatchLine([], 2, [100, 300], [100, 0], size), id: 'c' };
  const lines = pairLines([a, b, c], 'a', 'c');
  assert.deepEqual(lines.map((l) => [l.id, l.matchTo, l.offset]), [['a', 'c', undefined], ['b', null, undefined], ['c', 'a', undefined]]);
  // Pairing a line with the partner it already has keeps its adjustment.
  assert.deepEqual(pairLines([a, b], 'a', 'b')[0]!.offset, [3, 4]);
});
