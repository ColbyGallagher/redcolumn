import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFields } from './fieldDetect.ts';

const box = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x + w, y, x + w, y + h, x + w, y + h, x, y + h, x, y + h, x, y];

test('fill-in lines, boxes and check boxes are found and named from their labels', () => {
  const segments = [
    // "Name ______" line at y = 100 from x 80 to 300.
    80, 100, 300, 100,
    // A text box 200 × 20 at (80, 140).
    ...box(80, 140, 200, 20),
    // A check box 10 × 10 at (80, 190).
    ...box(80, 190, 10, 10),
    // A table rule with text on it: not a field.
    20, 250, 500, 250,
  ];
  const words = [
    { text: 'Name', x0: 40, y0: 88, x1: 70, y1: 100 },
    { text: 'Address:', x0: 20, y0: 144, x1: 72, y1: 156 },
    { text: 'Approved', x0: 20, y0: 190, x1: 72, y1: 200 },
    { text: 'Total', x0: 100, y0: 238, x1: 130, y1: 249 },
  ];
  const found = detectFields(segments, words);
  assert.deepEqual(
    found.map((f) => [f.type, f.name, Math.round(f.rect.x), Math.round(f.rect.y), Math.round(f.rect.w), Math.round(f.rect.h)]),
    [
      ['text', 'Name', 80, 84, 220, 16],
      ['text', 'Address', 80, 140, 200, 20],
      ['checkbox', 'Approved', 80, 190, 10, 10],
    ],
  );
  // Areas that already have fields are left alone.
  assert.equal(detectFields(segments, words, [{ x: 80, y: 140, w: 200, h: 20 }]).length, 2);
});
