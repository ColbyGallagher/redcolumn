import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crop, rasterSearch, turn, type GrayImage } from './rasterSearch.ts';

/** A white page with an "L and dot" mark stamped at the given spots (and turned ones). */
function page(w: number, h: number, marks: { x: number; y: number; turned?: boolean }[], noise = 0): GrayImage {
  const data = new Uint8Array(w * h).fill(250);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noise;
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, 250 + rnd()));
  for (const m of marks) {
    const mark: GrayImage = { width: 30, height: 20, data: new Uint8Array(600).fill(250) };
    for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) if (x < 4 || y > 15 || (x > 20 && x < 26 && y > 3 && y < 9)) mark.data[y * 30 + x] = 20;
    const img = m.turned ? turn(mark) : mark;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) data[(m.y + y) * w + m.x + x] = Math.min(data[(m.y + y) * w + m.x + x]!, img.data[y * img.width + x]!);
  }
  return { width: w, height: h, data };
}

test('scanned copies of a symbol are found, noise and all; turned ones on request', () => {
  const p = page(400, 300, [{ x: 20, y: 30 }, { x: 200, y: 50 }, { x: 310, y: 240 }, { x: 120, y: 180, turned: true }], 30);
  const template = crop(p, 20, 30, 30, 20);
  const plain = rasterSearch(p, template);
  assert.deepEqual(plain.map((m) => [m.x, m.y]), [[20, 30], [200, 50], [310, 240]]);
  const all = rasterSearch(p, template, { rotations: true });
  assert.equal(all.length, 4);
  assert.deepEqual(all.find((m) => m.turns !== 0) && [all.find((m) => m.turns !== 0)!.x, all.find((m) => m.turns !== 0)!.y], [120, 180]);
});
