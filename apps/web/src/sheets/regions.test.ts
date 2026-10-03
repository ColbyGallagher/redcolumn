import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Word } from '@nb/sheets';
import { labelFromRegions, parsePageRange, textInRegion } from './regions.ts';

const word = (text: string, x0: number, y0: number, w = 30, h = 10, angle = 0): Word => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, size: h, angle });

test('text in a box reads in lines, left to right', () => {
  const words = [word('PLAN', 140, 100), word('FLOOR', 100, 101), word('LEVEL', 100, 120), word('2', 140, 120), word('outside', 400, 100)];
  assert.equal(textInRegion(words, { x: 90, y: 90, w: 100, h: 50 }), 'FLOOR PLAN LEVEL 2');
});

test('sideways title blocks read along the text', () => {
  // Rotated a quarter turn clockwise: reading runs down the page, lines stack right to left.
  const down = Math.PI / 2;
  const words = [word('A-101', 500, 40, 10, 40, down), word('SHEET', 500, 90, 10, 40, down), word('NO.', 515, 40, 10, 30, down)];
  assert.equal(textInRegion(words, { x: 490, y: 30, w: 40, h: 120 }), 'NO. A-101 SHEET');
});

test('several boxes combine into one label', () => {
  const words = [word('A-101', 10, 10), word('Ground', 10, 50), word('Floor', 45, 50)];
  const regions = [
    { x: 0, y: 0, w: 60, h: 30 },
    { x: 0, y: 200, w: 60, h: 30 },
    { x: 0, y: 40, w: 100, h: 30 },
  ];
  assert.equal(labelFromRegions(words, regions, ' - '), 'A-101 - Ground Floor');
});

test('page ranges', () => {
  assert.deepEqual(parsePageRange('1-3, 5, 9-', 10), [0, 1, 2, 4, 8, 9]);
  assert.deepEqual(parsePageRange('0, 12', 10), []);
});
