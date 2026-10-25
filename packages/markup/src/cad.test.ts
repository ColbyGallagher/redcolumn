import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignment,
  applyAffine,
  breakPath,
  canCut,
  canExplode,
  closesOnItself,
  cornerClosing,
  cornerCut,
  cornerVertex,
  divisionPoints,
  edgesOf,
  explodeSegments,
  extendPath,
  joinPaths,
  lengthenPath,
  mirrorAcross,
  pathArray,
  pathOf,
  polarArray,
  rotationAbout,
  stretchMarkup,
  transformMarkup,
  trimPath,
  trimmedPart,
  bulgeMidpoint,
  canReverse,
  reversedMarkup,
  scalingAbout,
} from './cad.ts';
import { bulgeThrough } from '@nb/measure';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';

function markup(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: type, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: 0, modifiedAt: 0, ...extra };
}

const near = (a: readonly number[], b: readonly number[], eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < eps);
const nearPts = (a: readonly (readonly number[])[], b: readonly (readonly number[])[], eps = 1e-6) => a.length === b.length && a.every((p, i) => near(p, b[i]!, eps));

// A horizontal line from 0 to 100 crossed by verticals at x 30 and x 70.
const line: Point[] = [[0, 50], [100, 50]];
const cutters: Point[][] = [
  [[30, 0], [30, 100]],
  [[70, 0], [70, 100]],
];

test('trim cuts out the piece clicked between the nearest crossings', () => {
  assert.ok(nearPts(trimPath(line, cutters, [50, 52])!.flat(), [[0, 50], [30, 50], [70, 50], [100, 50]]));
  // An end piece leaves only the rest.
  const end = trimPath(line, cutters, [90, 50])!;
  assert.equal(end.length, 1);
  assert.ok(nearPts(end[0]!, [[0, 50], [70, 50]]));
  assert.equal(trimPath(line, [], [50, 50]), null, 'nothing crosses it');
  // Polylines trim across their corners.
  const l = trimPath([[0, 0], [50, 0], [50, 50]], [[[25, -10], [25, 10]]], [50, 20])!;
  assert.ok(nearPts(l[0]!, [[0, 0], [25, 0]]));
});

test('the part trim would remove is the piece clicked, to the crossings either side', () => {
  assert.ok(nearPts(trimmedPart(line, cutters, [50, 52])!, [[30, 50], [70, 50]]));
  assert.ok(nearPts(trimmedPart(line, cutters, [90, 50])!, [[70, 50], [100, 50]]));
  assert.equal(trimmedPart(line, [], [50, 50]), null);
});

test('extend reaches the nearest edge ahead of the end clicked', () => {
  const short: Point[] = [[40, 50], [60, 50]];
  assert.ok(nearPts(extendPath(short, cutters, [58, 50])!, [[40, 50], [70, 50]]));
  assert.ok(nearPts(extendPath(short, cutters, [42, 50])!, [[30, 50], [60, 50]]));
  assert.equal(extendPath(short, [[[0, 0], [0, 10]]], [58, 50]), null, 'nothing ahead');
});

test('break takes out the part between two points, or splits at one', () => {
  const two = breakPath(line, [20, 49], [60, 51]);
  assert.ok(nearPts(two[0]!, [[0, 50], [20, 50]]) && nearPts(two[1]!, [[60, 50], [100, 50]]));
  const split = breakPath(line, [40, 50], [40, 50]);
  assert.equal(split.length, 2);
  assert.ok(near(split[0]!.at(-1)!, [40, 50]) && near(split[1]![0]!, [40, 50]));
});

test('lengthen grows or cuts back the end nearer the click', () => {
  assert.ok(nearPts(lengthenPath(line, [90, 50], 'delta', 20)!, [[0, 50], [120, 50]]));
  assert.ok(nearPts(lengthenPath(line, [10, 50], 'total', 60)!, [[40, 50], [100, 50]]));
  assert.ok(nearPts(lengthenPath([[0, 0], [10, 0], [10, 10]], [10, 9], 'percent', 50)!, [[0, 0], [10, 0]]));
  assert.equal(lengthenPath(line, [90, 50], 'delta', -100), null);
});

test('fillet and chamfer meet two lines at their corner', () => {
  // Two lines heading toward a corner at (100, 0), both short of it.
  const p = { a: [0, 0] as Point, b: [80, 0] as Point, click: [40, 0] as Point };
  const q = { a: [100, 100] as Point, b: [100, 20] as Point, click: [100, 50] as Point };
  const sharp = cornerCut(p, q, 0)!;
  assert.ok(near(sharp.corner, [100, 0]) && near(sharp.endP, [100, 0]) && near(sharp.endQ, [100, 0]));
  const round = cornerCut(p, q, 10)!;
  assert.ok(near(round.endP, [90, 0]) && near(round.endQ, [100, 10]));
  // The arc's middle sits on the circle about (90, 10).
  assert.ok(Math.abs(Math.hypot(round.mid![0] - 90, round.mid![1] - 10) - 10) < 1e-6);
  const cham = cornerCut(p, q, 5, true)!;
  assert.ok(near(cham.endP, [95, 0]) && near(cham.endQ, [100, 5]));
  assert.equal(cornerCut(p, { ...q, a: [0, 10], b: [80, 10], click: [40, 10] }, 5), null, 'parallel');
  assert.equal(cornerCut(p, q, 500), null, 'too big for the arms');
});

test('a polygon corner rounds with traced points, an area corner with a curve', () => {
  const square: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const poly = cornerVertex(markup('polygon', square), 1, 10, false)!;
  assert.ok(poly.points.length > 5 && near(poly.points[1]!, [90, 0]) && near(poly.points.at(-3)!, [100, 10]));
  const area = cornerVertex(markup('area', square), 1, 10, false)!;
  assert.equal(area.points.length, 5);
  assert.ok(area.bulges && Math.abs(area.bulges[1]!) > 0);
  const cham = cornerVertex(markup('polygon', square), 0, 10, true)!;
  assert.ok(nearPts(cham.points, [[0, 10], [10, 0], [100, 0], [100, 100], [0, 100]]));
  assert.equal(cornerVertex(markup('polyline', [[0, 0], [10, 0], [10, 10]]), 0, 2, false), null, 'an open end is no corner');
});

test('a polyline that ends where it starts has a corner there to chamfer or round', () => {
  const loop: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
  const m = markup('polyline', loop);
  assert.ok(closesOnItself(m));
  assert.ok(!closesOnItself(markup('polyline', [[0, 0], [100, 0], [100, 100]])));
  const cham = cornerClosing(m, 10, true)!;
  assert.ok(nearPts(cham.points, [[10, 0], [100, 0], [100, 100], [0, 100], [0, 10], [10, 0]]));
  const round = cornerClosing(m, 10, false)!;
  assert.ok(near(round.points[0]!, round.points.at(-1)!), 'still closes');
  assert.ok(round.points.length > 6);
});

test('join chains touching paths in order, reversing as needed, and closes loops', () => {
  const chains = joinPaths(
    [
      { points: [[0, 0], [10, 0]] },
      { points: [[10, 10], [10, 0]] },
      { points: [[50, 50], [60, 60]] },
    ],
    0.5,
  );
  assert.equal(chains.length, 2);
  assert.deepEqual(chains[0]!.members, [0, 1]);
  assert.ok(nearPts(chains[0]!.points, [[0, 0], [10, 0], [10, 10]]));
  const loop = joinPaths(
    [
      { points: [[0, 0], [10, 0], [10, 10]] },
      { points: [[10, 10], [0, 10], [0, 0]] },
    ],
    0.5,
  );
  assert.equal(loop[0]!.closed, true);
  assert.equal(loop[0]!.points.length, 4);
  // A reversed curve turns the other way.
  const curved = joinPaths([{ points: [[0, 0], [10, 0]] }, { points: [[20, 0], [10, 0]], bulges: [0.5] }], 0.1);
  assert.deepEqual(curved[0]!.bulges, [0, -0.5]);
});

test('explode gives the segments of paths, outlines and turned rectangles', () => {
  assert.equal(explodeSegments(markup('polyline', [[0, 0], [10, 0], [10, 10]])).length, 2);
  assert.equal(explodeSegments(markup('polygon', [[0, 0], [10, 0], [10, 10]])).length, 3);
  const rect = explodeSegments(markup('rect', [[0, 0], [10, 20]], { rotation: 90 }));
  assert.equal(rect.length, 4);
  assert.ok(near(rect[0]!.a, [15, 5]), 'top-left corner turned a quarter about the centre');
  assert.ok(canExplode(markup('rect', [[0, 0], [1, 1]])) && !canExplode(markup('line', [[0, 0], [1, 1]])));
  // A curve's midpoint gives back the same bulge.
  const mid = bulgeMidpoint([0, 0], [10, 0], 1);
  assert.ok(Math.abs(bulgeThrough([0, 0], [10, 0], mid) - 1) < 1e-9);
});

test('mirror, rotate and align move points and turn boxes', () => {
  const m = mirrorAcross([0, 0], [0, 10]);
  assert.ok(near(applyAffine(m, [3, 4]), [-3, 4]));
  const diag = mirrorAcross([0, 0], [10, 10]);
  assert.ok(near(applyAffine(diag, [3, 0]), [0, 3]));
  const r = rotationAbout([0, 0], 90);
  assert.ok(near(applyAffine(r, [10, 0]), [0, 10]), 'clockwise on screen');
  const al = alignment([0, 0], [100, 100], [10, 0], [100, 120], true)!;
  assert.ok(near(applyAffine(al, [10, 0]), [100, 120]) && near(applyAffine(al, [5, 0]), [100, 110]));

  // A rectangle rotated 90° about a far point: its centre goes round, its box turns.
  const rect = markup('rect', [[0, 0], [20, 10]]);
  const turned = transformMarkup(rect, rotationAbout([100, 0], 90));
  assert.ok(nearPts(turned.points!, [[85, -95], [105, -85]]));
  assert.equal(turned.rotation, 90);
  // Mirrored polylines flip their points and curves.
  const pl = transformMarkup(markup('polylength', [[0, 0], [10, 0]], { bulges: [0.3] }), m);
  assert.ok(nearPts(pl.points!, [[0, 0], [-10, 0]]));
  assert.deepEqual(pl.bulges, [-0.3]);
  // Text grows with an aligning scale.
  const text = transformMarkup(markup('text', [[0, 0], [10, 10]], { style: { ...DEFAULT_STYLES.text, fontSize: 10 } }), al);
  assert.equal(text.style?.fontSize, 20);
});

test('polar and path arrays place copies round a centre and along a path', () => {
  const four = polarArray([0, 0], 4, 360, true, [10, 0]);
  assert.equal(four.length, 3);
  // Counter-clockwise on paper: up the page first (negative y).
  assert.ok(near(applyAffine(four[0]!, [10, 0]), [0, -10]));
  const half = polarArray([0, 0], 3, 180, false, [10, 0]);
  assert.ok(near(applyAffine(half[1]!, [10, 0]), [-10, 0]));
  // Unrotated items only move: a point beside the reference keeps its offset.
  assert.ok(near(applyAffine(half[0]!, [11, 0]), [1, -10]));
  const along = pathArray([[0, 0], [100, 0], [100, 100]], false, 3, true, [0, 0]);
  assert.equal(along.length, 3);
  assert.ok(near(applyAffine(along[1]!, [0, 0]), [100, 0]) && near(applyAffine(along[2]!, [0, 0]), [100, 100]));
  // Aligned with the path: on the second leg (heading down) the item turned a quarter.
  assert.ok(near(applyAffine(along[2]!, [1, 0]), [100, 101]));
});

test('divide and measure mark points along open and closed paths', () => {
  const pts = divisionPoints([[0, 0], [100, 0]], false, { count: 4 });
  assert.deepEqual(pts.map((p) => p.point[0]), [25, 50, 75]);
  const sq = divisionPoints([[0, 0], [10, 0], [10, 10], [0, 10]], true, { count: 4 });
  assert.ok(nearPts(sq.map((p) => p.point), [[0, 0], [10, 0], [10, 10], [0, 10]]));
  assert.deepEqual(divisionPoints([[0, 0], [100, 0]], false, { spacing: 30 }).map((p) => p.point[0]), [30, 60, 90]);
});

test('stretch moves the points inside the window, and boxes by their corners', () => {
  const window = { x: 90, y: -10, w: 30, h: 30 };
  assert.ok(nearPts(stretchMarkup(markup('polyline', [[0, 0], [100, 0], [100, 10]]), window, 20, 0)!.points!, [[0, 0], [120, 0], [120, 10]]));
  assert.ok(nearPts(stretchMarkup(markup('rect', [[0, 0], [100, 10]]), window, 20, 5)!.points!, [[0, 5], [120, 15]]));
  assert.equal(stretchMarkup(markup('rect', [[0, 0], [50, 10]]), window, 20, 0), null);
  // Wholly inside: moves.
  assert.ok(nearPts(stretchMarkup(markup('line', [[95, 0], [100, 5]]), window, 1, 1)!.points!, [[96, 1], [101, 6]]));
});

test('edges and paths come from what is drawn', () => {
  const rectEdges = edgesOf(markup('rect', [[0, 0], [10, 10]]));
  assert.equal(rectEdges.length, 1);
  assert.equal(edgesOf(markup('text', [[0, 0], [10, 10]], { text: 'x' })).length, 0);
  const p = pathOf(markup('rect', [[0, 0], [10, 10]]))!;
  assert.equal(p.closed, true);
  assert.equal(p.points.length, 4);
  assert.equal(pathOf(markup('line', [[0, 0], [10, 0]]))!.closed, false);
  assert.ok(canCut(markup('polyline', [[0, 0], [1, 1]])) && !canCut(markup('polylength', [[0, 0], [1, 1]], { bulges: [0.2] })));
});

test('scale grows about a base point; reverse turns a path round with its endings', () => {
  const t = scalingAbout([10, 10], 2);
  assert.ok(near(applyAffine(t, [20, 10]), [30, 10]) && near(applyAffine(t, [10, 10]), [10, 10]));
  const arrow = markup('arrow', [[0, 0], [10, 0]]);
  const r = reversedMarkup(arrow);
  assert.deepEqual(r.points, [[10, 0], [0, 0]]);
  assert.equal(r.style!.startCap, 'filledArrow');
  assert.equal(r.style!.endCap, 'none');
  const pl = reversedMarkup(markup('polylength', [[0, 0], [10, 0], [20, 0]], { bulges: [0.2, 0] }));
  assert.deepEqual(pl.bulges, [0, -0.2]);
  assert.ok(canReverse(markup('line', [[0, 0], [1, 1]])) && !canReverse(markup('rect', [[0, 0], [1, 1]])));
});
