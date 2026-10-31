import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polygonBox, polygonInPixels, recolourPixels } from './pictureColours.ts';

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

test('greyscale keeps the brightness of each pixel and its transparency', () => {
  const d = px(255, 0, 0, 255, 0, 0, 255, 128, 10, 20, 30, 0);
  recolourPixels(d, 'grayscale');
  assert.deepEqual([...d.slice(0, 4)], [76, 76, 76, 255]);
  assert.deepEqual([...d.slice(4, 8)], [29, 29, 29, 128]);
  assert.deepEqual([...d.slice(8, 12)], [10, 20, 30, 0], 'see-through pixels are left alone');
});

test('black on white sends everything but white to black', () => {
  const d = px(255, 255, 255, 255, 250, 250, 250, 255, 200, 200, 200, 255, 255, 0, 0, 255);
  recolourPixels(d, 'blackAndWhite');
  assert.deepEqual([...d], [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
});

test('invert swaps black and white and keeps alpha', () => {
  const d = px(0, 0, 0, 255, 255, 255, 255, 100, 10, 200, 30, 255);
  recolourPixels(d, 'invert');
  assert.deepEqual([...d], [255, 255, 255, 255, 0, 0, 0, 100, 245, 55, 225, 255]);
});

test('swapping one colour changes only pixels within the tolerance', () => {
  const d = px(255, 255, 255, 255, 250, 250, 250, 255, 200, 200, 200, 255);
  recolourPixels(d, { replace: '#ffffff', with: '#ff0000', tolerance: 0.05 });
  assert.deepEqual([...d], [255, 0, 0, 255, 255, 0, 0, 255, 200, 200, 200, 255]);
});

test('swapping a colour for see-through clears its alpha', () => {
  const d = px(255, 255, 255, 255, 0, 0, 0, 255);
  recolourPixels(d, { replace: '#ffffff', with: null, tolerance: 0 });
  assert.deepEqual([...d], [255, 255, 255, 0, 0, 0, 0, 255]);
});

test('the box round a polygon and its corners in the rendered pixels', () => {
  const poly: [number, number][] = [[100, 100], [300, 120], [250, 300]];
  assert.deepEqual(polygonBox(poly), { x: 100, y: 100, w: 200, h: 200 });
  // Rendered at 2 px per point from page pixel (200, 200).
  assert.deepEqual(polygonInPixels(poly, 2, [200, 200]), [[0, 0], [400, 40], [300, 400]]);
});
