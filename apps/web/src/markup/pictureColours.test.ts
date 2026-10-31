import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominantColours, polygonBox, polygonInPixels, recolourPixels } from './pictureColours.ts';

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

test('the main colours are found, commonest first, ignoring see-through pixels and near duplicates', () => {
  const d = new Uint8ClampedArray(40 * 4);
  for (let i = 0; i < 40; i++) {
    const white = i < 24;
    const red = i >= 24 && i < 34;
    const nearRed = i >= 34 && i < 38;
    d.set(white ? [255, 255, 255, 255] : red ? [255, 0, 0, 255] : nearRed ? [250, 10, 5, 255] : [0, 0, 0, 0], i * 4);
  }
  const found = dominantColours(d);
  assert.deepEqual(found.map((c) => c.hex), ['#ffffff', '#ff0000']);
  assert.ok(Math.abs(found[0]!.share - 24 / 38) < 1e-9);
});

test('each main colour is swapped for its own replacement, and edges follow the nearest colour', () => {
  const d = px(255, 255, 255, 255, 0, 0, 0, 255, 250, 250, 250, 255, 20, 20, 20, 255);
  recolourPixels(d, { swaps: [{ from: '#ffffff', to: '#ff0000' }, { from: '#000000', to: '#0000ff' }] });
  assert.deepEqual([...d], [255, 0, 0, 255, 0, 0, 255, 255, 250, 0, 0, 255, 20, 20, 255, 255]);
});

test('a colour left as it is keeps the pixels nearest to it, and one made see-through loses them', () => {
  const d = px(255, 255, 255, 255, 10, 10, 10, 255);
  recolourPixels(d, { swaps: [{ from: '#ffffff', to: null }, { from: '#000000', to: '#000000' }] });
  assert.deepEqual([...d], [255, 255, 255, 0, 10, 10, 10, 255]);
  const same = px(1, 2, 3, 255);
  recolourPixels(same, { swaps: [{ from: '#010203', to: '#010203' }] });
  assert.deepEqual([...same], [1, 2, 3, 255]);
});

test('the box round a polygon and its corners in the rendered pixels', () => {
  const poly: [number, number][] = [[100, 100], [300, 120], [250, 300]];
  assert.deepEqual(polygonBox(poly), { x: 100, y: 100, w: 200, h: 200 });
  // Rendered at 2 px per point from page pixel (200, 200).
  assert.deepEqual(polygonInPixels(poly, 2, [200, 200]), [[0, 0], [400, 40], [300, 400]]);
});
