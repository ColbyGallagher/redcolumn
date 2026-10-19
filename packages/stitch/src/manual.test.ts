import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, compose, invert, rigid, similarityFromSegments, type Affine, type Vec } from './affine.ts';
import { defaultContentSide, pairFrame, polygonArea, stitchManual, visiblePolygon, type ManualMatchLine } from './manual.ts';

const W = 2592;
const H = 1728;

const near = (a: Vec, b: Vec, tol = 0.01) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
const scaled = (k: number, m: Affine): Affine => compose([k, 0, 0, k, 0, 0], m);

/** A sheet showing world x in [x0, x1], centred on the page, turned and scaled. */
function sheet(x0: number, x1: number, angle: number, scale = 1): Affine {
  return compose(rigid(angle, W / 2, H / 2), scaled(scale, rigid(0, -(x0 + x1) / 2, 0)));
}

/** The match line at world x, drawn on a sheet, with the user's clicks in either order. */
function line(id: string, pageIndex: number, worldToPage: Affine, x: number, matchTo: string | null, reversed = false): ManualMatchLine {
  let p0 = apply(worldToPage, [x, -300]);
  let p1 = apply(worldToPage, [x, 300]);
  if (reversed) [p0, p1] = [p1, p0];
  return { id, pageIndex, p0, p1, contentSide: defaultContentSide(W, H, p0, p1), name: '', matchTo };
}

function assertPlacedLike(toWorld: Affine, expected: Affine) {
  for (const pt of [
    [0, 0],
    [W, H],
    [1234, 567],
  ] as Vec[]) {
    const got = apply(toWorld, pt);
    const want = apply(expected, pt);
    assert.ok(near(got, want, 0.05), `off by ${Math.hypot(got[0] - want[0], got[1] - want[1]).toFixed(3)}`);
  }
}

test('similarityFromSegments maps both ends', () => {
  const m = similarityFromSegments([10, 20], [110, 20], [0, 0], [0, 50]);
  assert.ok(near(apply(m, [0, 0]), [10, 20]));
  assert.ok(near(apply(m, [0, 50]), [110, 20]));
  // Scale 2, rotated -90°: no reflection, so a point left of the segment stays left of it.
  assert.ok(near(apply(m, [-10, 0]), [10, 40]));
});

test('three sheets at different turns and scales chain from clicked ends', () => {
  const pages = [sheet(0, 1000, 0.2), sheet(1000, 2000, -0.45, 2), sheet(2000, 3000, Math.PI / 2, 0.5)];
  const lines = [
    line('a', 0, pages[0]!, 1000, 'b1'),
    line('b1', 1, pages[1]!, 1000, 'a', true),
    line('b2', 1, pages[1]!, 2000, 'c'),
    line('c', 2, pages[2]!, 2000, 'b2', true),
  ];
  const groups = stitchManual({ lines });
  assert.equal(groups.length, 1);
  const group = groups[0]!;
  assert.deepEqual(group.placements.map((p) => p.pageIndex), [0, 1, 2]);
  for (const p of group.placements) assertPlacedLike(p.toWorld, compose(pages[0]!, invert(pages[p.pageIndex]!)));

  // The middle sheet keeps the part between its two lines.
  const middle = group.placements[1]!;
  assert.equal(middle.clips.length, 2);
  const centre = apply(pages[1]!, [1500, 0]);
  for (const c of middle.clips) assert.ok((centre[0] - c.point[0]) * c.normal[0] + (centre[1] - c.point[1]) * c.normal[1] > 0);
});

test('an L-shaped join turns the second sheet a quarter turn', () => {
  // Sheet B is drawn upright though its road runs north from the end of A's.
  const a = sheet(0, 1000, 0);
  const b: Affine = compose(rigid(-Math.PI / 2, W / 2, H / 2), rigid(0, -1500, 0));
  const groups = stitchManual({ lines: [line('a', 0, a, 1000, 'b'), line('b', 1, b, 1000, 'a')] });
  assertPlacedLike(groups[0]!.placements[1]!.toWorld, compose(a, invert(b)));
});

test('unpaired lines and lines paired on the same sheet stitch nothing', () => {
  const a = sheet(0, 1000, 0);
  assert.deepEqual(stitchManual({ lines: [line('a', 0, a, 1000, null)] }), []);
  assert.deepEqual(stitchManual({ lines: [line('a', 0, a, 1000, 'b'), line('b', 0, a, 200, 'a')] }), []);
});

test('the region cuts the title block off and the match line cuts the far side', () => {
  const region: [number, number][] = [
    [36, 36],
    [2000, 36],
    [2000, 1692],
    [36, 1692],
  ];
  const poly = visiblePolygon({ region, clips: [{ point: [1000, 0], normal: [-1, 0] }] }, W, H);
  assert.equal(polygonArea(poly), (1000 - 36) * (1692 - 36));
  const groups = stitchManual({
    lines: [line('a', 0, sheet(0, 1000, 0), 1000, 'b'), line('b', 1, sheet(1000, 2000, 0), 1000, 'a')],
    regions: new Map([[1, region]]),
  });
  assert.equal(groups[0]!.placements[0]!.region, undefined);
  assert.deepEqual(groups[0]!.placements[1]!.region, region);
});

test('content side follows the bigger part of the sheet or region', () => {
  assert.equal(defaultContentSide(W, H, [2400, 0], [2400, H]), 1);
  assert.equal(defaultContentSide(W, H, [2400, H], [2400, 0]), -1);
  // A region that lies mostly right of the line flips it.
  const region: Vec[] = [
    [2000, 0],
    [W, 0],
    [W, H],
    [2000, H],
  ];
  assert.equal(defaultContentSide(W, H, [2100, 0], [2100, H], region), -1);
});

test('a hand adjustment slides the second sheet along and across the pair frame', () => {
  const a = sheet(0, 1000, 0.3);
  const b = sheet(1000, 2000, -0.2);
  const la = line('a', 0, a, 1000, 'b');
  const lb = line('b', 1, b, 1000, 'a');
  const base = stitchManual({ lines: [la, lb] })[0]!.placements[1]!.toWorld;
  const { along, across } = pairFrame(la);
  const moved = stitchManual({ lines: [la, { ...lb, offset: [5, -2] }] })[0]!.placements[1]!.toWorld;
  const p: Vec = [100, 200];
  const d: Vec = [apply(moved, p)[0] - apply(base, p)[0], apply(moved, p)[1] - apply(base, p)[1]];
  assert.ok(near(d, [along[0] * 5 + across[0] * -2, along[1] * 5 + across[1] * -2]));
  // The same adjustment on the first sheet's line moves the second the other way.
  const back = stitchManual({ lines: [{ ...la, offset: [5, -2] }, lb] })[0]!.placements[1]!.toWorld;
  assert.ok(near(apply(back, p), [2 * apply(base, p)[0] - apply(moved, p)[0], 2 * apply(base, p)[1] - apply(moved, p)[1]]));
  // `across` points out of the first sheet's drawing.
  const inside = apply(a, [500, 0]);
  assert.ok((inside[0] - la.p0[0]) * across[0] + (inside[1] - la.p0[1]) * across[1] < 0);
});
