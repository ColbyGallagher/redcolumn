import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateSegments, visualSearch } from './visualSearch.ts';

// A symbol: a 10 × 6 box with a diagonal and a short tick, drawn at (x, y), optionally turned 90°.
function symbol(x: number, y: number, turned = false): number[] {
  const local = [
    [0, 0, 10, 0], [10, 0, 10, 6], [10, 6, 0, 6], [0, 6, 0, 0], [0, 0, 10, 6], [10, 3, 13, 3],
  ];
  return local.flatMap(([a, b, c, d]) => (turned ? [x - b!, y + a!, x - d!, y + c!] : [x + a!, y + b!, x + c!, y + d!]));
}

// Noise: a grid of lines and a look-alike box without the diagonal.
const noise = [
  ...Array.from({ length: 20 }, (_, i) => [0, i * 25, 500, i * 25]).flat(),
  ...[300, 300, 310, 300, 310, 300, 310, 306, 310, 306, 300, 306, 300, 306, 300, 300],
];
const page = [...noise, ...symbol(50, 60), ...symbol(200, 110), ...symbol(400, 410), ...symbol(120, 300, true)];
const box = { x: 48, y: 58, w: 17, h: 10 };

test('finds every copy of the symbol as drawn, and not look-alikes', () => {
  const template = templateSegments(page, box);
  assert.equal(template.length, 6);
  const found = visualSearch(page, template);
  assert.deepEqual(found.map((m) => m.center.map(Math.round)), [[57, 63], [207, 113], [407, 413]]);
  assert.ok(found.every((m) => m.angle === 0 && m.score === 1));
});

test('with rotations on, turned copies are found too', () => {
  const template = templateSegments(page, box);
  const found = visualSearch(page, template, { rotations: true });
  assert.equal(found.length, 4);
  const turned = found.find((m) => Math.abs(m.angle) > 45)!;
  assert.ok(Math.abs(Math.abs(turned.angle) - 90) < 1e-6);
});

test('with scales on, larger and smaller copies are found', () => {
  const scaled = (x: number, y: number, k: number) => symbol(0, 0).map((v, i) => (i % 2 ? y + v * k : x + v * k));
  const page2 = [...noise, ...symbol(50, 60), ...scaled(200, 150, 2), ...scaled(400, 350, 0.6)];
  const template = templateSegments(page2, box);
  assert.equal(visualSearch(page2, template).length, 1);
  const found = visualSearch(page2, template, { scales: true });
  assert.deepEqual(found.map((m) => Math.round(m.scale * 10) / 10), [1, 2, 0.6]);
});
