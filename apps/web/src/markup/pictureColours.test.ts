import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustPixels, adjustsPicture, dominantColours, NO_ADJUST, polygonBox, polygonInPixels, recolourPixels } from './pictureColours.ts';

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

test('the rest adjustment changes nothing', () => {
  const d = px(10, 20, 30, 255);
  assert.equal(adjustsPicture(NO_ADJUST), false);
  adjustPixels(d, NO_ADJUST);
  assert.deepEqual([...d], [10, 20, 30, 255]);
});

test('greyscale makes red, green and blue equal by luminance and keeps transparency', () => {
  const d = px(255, 0, 0, 255, 0, 255, 0, 128, 9, 9, 9, 0);
  adjustPixels(d, { ...NO_ADJUST, greyscale: true });
  assert.deepEqual([...d], [76, 76, 76, 255, 150, 150, 150, 128, 9, 9, 9, 0]);
});

test('invert flips each channel, and twice gives the picture back', () => {
  const d = px(0, 100, 255, 255);
  adjustPixels(d, { ...NO_ADJUST, invert: true });
  assert.deepEqual([...d], [255, 155, 0, 255]);
  adjustPixels(d, { ...NO_ADJUST, invert: true });
  assert.deepEqual([...d], [0, 100, 255, 255]);
});

test('brightness shifts and clamps; contrast leaves mid grey and pushes the rest apart', () => {
  const b = px(100, 100, 100, 255, 250, 250, 250, 255);
  adjustPixels(b, { ...NO_ADJUST, brightness: 20 });
  assert.deepEqual([...b], [151, 151, 151, 255, 255, 255, 255, 255]);
  const c = px(128, 128, 128, 255, 100, 100, 100, 255, 160, 160, 160, 255);
  adjustPixels(c, { ...NO_ADJUST, contrast: 50 });
  assert.equal(c[0], 128);
  assert.ok(c[4]! < 100 && c[8]! > 160);
  const flat = px(0, 0, 0, 255);
  adjustPixels(flat, { ...NO_ADJUST, contrast: -100 });
  assert.ok(flat[0]! > 100);
});

test('whiting out makes near-white pixels see-through and keeps the rest', () => {
  const d = px(255, 255, 255, 255, 250, 250, 250, 255, 200, 200, 200, 255);
  adjustPixels(d, { ...NO_ADJUST, whiteOut: 5 });
  assert.deepEqual([d[3], d[7], d[11]], [0, 0, 255]);
});

test('a pixel just short of the white cut-off fades instead of leaving a pale halo', () => {
  // whiteOut 5 cuts at 242.25: 234 is 8.25 levels under, so about half its alpha stays; 242 is nearly at the cut.
  const d = px(234, 234, 234, 255, 242, 242, 242, 200);
  adjustPixels(d, { ...NO_ADJUST, whiteOut: 5 });
  assert.deepEqual([d[3], d[7]], [131, 3]);
});
