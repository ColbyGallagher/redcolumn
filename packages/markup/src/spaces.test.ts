import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';
import { spaceOf, spacePath, spaceTree } from './spaces.ts';

const sq = (x: number, y: number, s: number): Point[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const mk = (id: string, type: MarkupType, points: Point[], subject?: string, pageIndex = 0): Markup => ({
  id, type, pageIndex, points, subject, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: 0, modifiedAt: 0,
});

const level = mk('L1', 'space', sq(0, 0, 100), 'Level 1');
const room = mk('R1', 'space', sq(10, 10, 30), 'Room 101');
const room2 = mk('R2', 'space', sq(50, 10, 30), 'Room 102');
const spaces = [room, level, room2];

test('markups belong to the innermost Space around them, and name the whole chain', () => {
  const cloud = mk('c', 'cloud', [[15, 15], [25, 25]]);
  assert.equal(spaceOf(cloud, spaces)?.id, 'R1');
  assert.equal(spacePath(cloud, spaces), 'Level 1 › Room 101');
  assert.equal(spacePath(mk('x', 'count', [[45, 80]]), spaces), 'Level 1');
  assert.equal(spaceOf(mk('y', 'line', [[200, 200], [210, 210]]), spaces), null);
  // Other pages' Spaces do not count.
  assert.equal(spaceOf(mk('z', 'cloud', [[15, 15], [25, 25]], undefined, 1), spaces), null);
});

test('Spaces nest by containment', () => {
  assert.deepEqual(spaceTree(spaces).map((r) => `${'.'.repeat(r.depth)}${r.space.subject}`), ['Level 1', '.Room 101', '.Room 102']);
});
