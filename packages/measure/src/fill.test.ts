import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dynamicFill } from './fill.ts';
import { polygonArea } from './measure.ts';

// A 200 × 100 room at (100, 100), and a wall dividing it at x = 200 with a 4-point door gap.
const room = [100, 100, 300, 100, 300, 100, 300, 200, 300, 200, 100, 200, 100, 200, 100, 100];
const wall = [200, 100, 200, 148, 200, 152, 200, 200];

test('fills the room around the click, following the inside of its walls', () => {
  const poly = dynamicFill(room, [150, 150], { width: 400, height: 300, cell: 1 })!;
  assert.ok(poly, 'enclosed');
  const area = polygonArea(poly);
  // Walls take up to a couple of points on each side.
  assert.ok(area > 190 * 90 && area <= 200 * 100, `area ${area}`);
  assert.ok(poly.length <= 8, `simplified to ${poly.length} points`);
});

test('small gaps close; large ones and open regions do not fill', () => {
  const half = dynamicFill([...room, ...wall], [150, 150], { width: 400, height: 300, cell: 1, gap: 6 })!;
  assert.ok(polygonArea(half) < 100 * 100, 'the door gap is bridged: only the left half fills');
  const whole = dynamicFill([...room, ...wall], [150, 150], { width: 400, height: 300, cell: 1, gap: 1 })!;
  assert.ok(polygonArea(whole) > 150 * 90, 'with a small gap tolerance the fill runs through the door');
  // Outside the room: leaks to the page edge.
  assert.equal(dynamicFill(room, [50, 50], { width: 400, height: 300, cell: 1 }), null);
  // On a wall.
  assert.equal(dynamicFill(room, [100, 150], { width: 400, height: 300, cell: 1 }), null);
});
