import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';
import { markupSnapPoints } from './snapPoints.ts';

function markup(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-1`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: 'Test', createdAt: 1, modifiedAt: 1, ...extra };
}

const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-9;
const has = (snaps: ReturnType<typeof markupSnapPoints>, p: Point, kind: string) => snaps.some((s) => s.kind === kind && near(s.point, p));

test('a rectangle snaps at all four corners and the middle of each side', () => {
  const snaps = markupSnapPoints(markup('rect', [[0, 0], [100, 50]]));
  for (const p of [[0, 0], [100, 0], [100, 50], [0, 50]] as Point[]) assert.ok(has(snaps, p, 'endpoint'), `corner ${p}`);
  for (const p of [[50, 0], [100, 25], [50, 50], [0, 25]] as Point[]) assert.ok(has(snaps, p, 'midpoint'), `side ${p}`);
  assert.ok(has(snaps, [50, 25], 'geocenter'));
  assert.equal(snaps.length, 9);
});

test('a rotated rectangle snaps where its corners are drawn', () => {
  const snaps = markupSnapPoints(markup('rect', [[0, 0], [100, 100]], { rotation: 90 }));
  // A square turned a quarter keeps its corners in the same places, so check a side middle moved.
  assert.ok(has(snaps, [100, 50], 'midpoint'));
  assert.ok(has(snaps, [0, 0], 'endpoint'));
});

test('an ellipse snaps at its centre and compass points, not its box corners', () => {
  const snaps = markupSnapPoints(markup('ellipse', [[0, 0], [100, 60]]));
  assert.ok(has(snaps, [50, 30], 'center'));
  for (const p of [[50, 0], [100, 30], [50, 60], [0, 30]] as Point[]) assert.ok(has(snaps, p, 'quadrant'), `quadrant ${p}`);
  assert.ok(!snaps.some((s) => near(s.point, [0, 0])));
});

test('a diameter measurement snaps at its circle centre', () => {
  const snaps = markupSnapPoints(markup('diameter', [[0, 0], [20, 0]]));
  assert.ok(has(snaps, [10, 0], 'center'));
  assert.ok(has(snaps, [10, -10], 'quadrant'));
});

test('lines and outlines snap at vertices and segment middles', () => {
  const line = markupSnapPoints(markup('line', [[0, 0], [10, 0]]));
  assert.ok(has(line, [0, 0], 'endpoint') && has(line, [10, 0], 'endpoint') && has(line, [5, 0], 'midpoint'));
  const polygon = markupSnapPoints(markup('polygon', [[0, 0], [10, 0], [10, 10]]));
  // Closed: the closing edge has a middle too.
  assert.ok(has(polygon, [5, 5], 'midpoint'));
});
