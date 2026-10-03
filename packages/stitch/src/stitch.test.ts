import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Word } from '@nb/sheets';
import { apply, compose, invert, rigid, type Affine } from './affine.ts';
import { stitchSet } from './layout.ts';
import type { StitchPage } from './matchLines.ts';

const W = 2592;
const H = 1728;

/** World line work for a road corridor running along +x: edges, centreline, utilities, cross streets. */
function world(pieces = 50): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  for (const y of [-20, 0, 20, 35, -52, 88, -130]) {
    for (let x = -100; x < 3100; x += pieces) segs.push([x, y, Math.min(3100, x + pieces), y]);
  }
  // Cross streets and diagonal pipes at irregular stations.
  for (const x of [230, 610, 980, 1015, 1333, 1720, 1985, 2040, 2480]) segs.push([x, -300, x, 300]);
  for (const x of [400, 995, 1500, 2010]) segs.push([x - 60, -200, x + 60, 200]);
  return segs;
}

/** Clips a segment to world x in [x0, x1]. */
function clipX([ax, ay, bx, by]: [number, number, number, number], x0: number, x1: number): [number, number, number, number] | null {
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1) return null;
  const at = (x: number) => (bx === ax ? [x, ay] : [x, ay + ((by - ay) * (x - ax)) / (bx - ax)]);
  const [sx, sy] = ax < x0 ? at(x0) : ax > x1 ? at(x1) : [ax, ay];
  const [ex, ey] = bx < x0 ? at(x0) : bx > x1 ? at(x1) : [bx, by];
  return [sx!, sy!, ex!, ey!];
}

interface SheetSpec {
  number: string;
  x0: number;
  x1: number;
  /** World → page placement. */
  angle: number;
}

function wordAt(text: string, p: [number, number], dir: [number, number], size: number): Word {
  const w = text.length * size * 0.6;
  const q: [number, number] = [p[0] + dir[0] * w, p[1] + dir[1] * w];
  return {
    text,
    x0: Math.min(p[0], q[0]) - size / 2,
    y0: Math.min(p[1], q[1]) - size / 2,
    x1: Math.max(p[0], q[0]) + size / 2,
    y1: Math.max(p[1], q[1]) + size / 2,
    size,
    angle: Math.atan2(dir[1], dir[0]),
  };
}

/** Builds a sheet: its slice of the corridor, match lines at its ends and their labels. */
function sheet(
  spec: SheetSpec,
  neighbours: { x: number; station: string; target: string; side: 1 | -1 }[],
  opts: { pieces?: number; titleBlock?: boolean } = {},
): { page: StitchPage; worldToPage: Affine } {
  const cx = (spec.x0 + spec.x1) / 2;
  // World → page: centre the slice on the sheet, rotated by spec.angle.
  const worldToPage = compose(rigid(spec.angle, W / 2, H / 2), rigid(0, -cx, 0));
  const segs: number[] = [];
  const push = (s: [number, number, number, number]) => {
    const a = apply(worldToPage, [s[0], s[1]]);
    const b = apply(worldToPage, [s[2], s[3]]);
    segs.push(a[0], a[1], b[0], b[1]);
  };
  for (const s of world(opts.pieces)) {
    const c = clipX(s, spec.x0, spec.x1);
    if (c) push(c);
  }
  if (opts.titleBlock) {
    // Border and title block in page space: lots of line work that is not part of the drawing.
    const rect = (x: number, y: number, w: number, h: number) =>
      segs.push(x, y, x + w, y, x + w, y, x + w, y + h, x + w, y + h, x, y + h, x, y + h, x, y);
    rect(36, 36, W - 72, H - 72);
    rect(W - 400, H - 206, 364, 170);
    for (let i = 1; i < 8; i++) segs.push(W - 400, H - 206 + i * 21, W - 36, H - 206 + i * 21);
  }
  const words: Word[] = [];
  for (const n of neighbours) {
    // Dashed match line across the corridor, and its label running along it on this sheet's side.
    for (let y = -320; y < 320; y += 30) push([n.x, y, n.x, y + 18]);
    const dir = apply(rigid(spec.angle, 0, 0), [0, 1]);
    let at = apply(worldToPage, [n.x - n.side * 12, -250]);
    for (const t of ['MATCH', 'LINE', 'STA', n.station, 'SEE', 'SHEET', n.target]) {
      const w = wordAt(t, at, dir, 10);
      words.push(w);
      at = [at[0] + dir[0] * (t.length + 1) * 6, at[1] + dir[1] * (t.length + 1) * 6];
    }
  }
  words.push(wordAt(spec.number, [2400, 1680], [1, 0], 28));
  return { page: { width: W, height: H, words, segments: new Float32Array(segs) }, worldToPage };
}

test('three rotated sheets stitch back into one road', () => {
  const specs: SheetSpec[] = [
    { number: 'C-101', x0: -100, x1: 1000, angle: 0.2 },
    { number: 'C-102', x0: 1000, x1: 2000, angle: -0.45 },
    { number: 'C-103', x0: 2000, x1: 3100, angle: Math.PI / 2 },
  ];
  const sheets = [
    sheet(specs[0]!, [{ x: 1000, station: '10+00', target: 'C-102', side: 1 }]),
    sheet(specs[1]!, [
      { x: 1000, station: '10+00', target: 'C-101', side: -1 },
      { x: 2000, station: '20+00', target: 'C-103', side: 1 },
    ]),
    sheet(specs[2]!, [{ x: 2000, station: '20+00', target: 'C-102', side: -1 }]),
  ];
  const result = stitchSet(
    sheets.map((s) => s.page),
    specs.map((s) => s.number),
  );
  assert.equal(result.matchLines.length, 4);
  assert.deepEqual(
    result.matchLines.map((m) => [m.pageIndex, m.station, m.targetPage]),
    [
      [0, '10+00', 1],
      [1, '10+00', 0],
      [1, '20+00', 2],
      [2, '20+00', 1],
    ],
  );
  assert.equal(result.groups.length, 1);
  const group = result.groups[0]!;
  assert.equal(group.placements.length, 3);
  for (const e of group.edges) assert.ok(e.alignment.votes >= 3, `edge ${e.a}-${e.b} votes ${e.alignment.votes}`);

  // Ground truth: page k → world → page 0.
  const pageToRoot = (k: number) => compose(sheets[0]!.worldToPage, invert(sheets[k]!.worldToPage));
  for (const p of group.placements) {
    const expected = pageToRoot(p.pageIndex);
    for (const pt of [
      [0, 0],
      [W, H],
      [1234, 567],
    ] as [number, number][]) {
      const got = apply(p.toWorld, pt);
      const want = apply(expected, pt);
      assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 0.5, `page ${p.pageIndex} point ${pt} off by ${Math.hypot(got[0] - want[0], got[1] - want[1]).toFixed(2)}`);
    }
  }

  // Each sheet keeps its own side of its match lines.
  const middle = group.placements.find((p) => p.pageIndex === 1)!;
  assert.equal(middle.clips.length, 2);
  const centre = apply(sheets[1]!.worldToPage, [1500, 0]);
  for (const c of middle.clips) assert.ok((centre[0] - c.point[0]) * c.normal[0] + (centre[1] - c.point[1]) * c.normal[1] > 0);
});

test('sheets without match lines are left out', () => {
  const lone: StitchPage = { width: W, height: H, words: [], segments: new Float32Array() };
  assert.deepEqual(stitchSet([lone, lone], ['C-101', 'C-102']).groups, []);
});

test('long unsplit lines and a title block beyond the match line', () => {
  // CAD exports draw each road line as one long segment, and the title block often sits just
  // past a match line: neither may pull the match line or its content side off.
  const opts = { pieces: 5000, titleBlock: true };
  const specs: SheetSpec[] = [
    { number: 'C-101', x0: -100, x1: 1000, angle: 0.2 },
    { number: 'C-102', x0: 1000, x1: 2000, angle: -0.45 },
    { number: 'C-103', x0: 2000, x1: 3100, angle: Math.PI / 2 },
  ];
  const sheets = [
    sheet(specs[0]!, [{ x: 1000, station: '10+00', target: 'C-102', side: 1 }], opts),
    sheet(specs[1]!, [{ x: 1000, station: '10+00', target: 'C-101', side: -1 }, { x: 2000, station: '20+00', target: 'C-103', side: 1 }], opts),
    sheet(specs[2]!, [{ x: 2000, station: '20+00', target: 'C-102', side: -1 }], opts),
  ];
  const [group] = stitchSet(sheets.map((s) => s.page), specs.map((s) => s.number)).groups;
  assert.equal(group?.placements.length, 3);
  for (const p of group!.placements) {
    const want = apply(compose(sheets[0]!.worldToPage, invert(sheets[p.pageIndex]!.worldToPage)), [1500, 700]);
    const got = apply(p.toWorld, [1500, 700]);
    assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 0.5, `page ${p.pageIndex} off by ${Math.hypot(got[0] - want[0], got[1] - want[1]).toFixed(1)}`);
  }
});
