import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dilate, findOffset, inkCount, inkMask, measureMaskOverlap, shiftMask, shrink, warpMask, type Mask } from './mask.ts';

function blank(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

function rect(m: Mask, x: number, y: number, w: number, h: number) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m.data[j * m.width + i] = 1;
}

function drawing(dx = 0, dy = 0): Mask {
  const m = blank(300, 200);
  rect(m, 10 + dx, 10 + dy, 250, 2);
  rect(m, 10 + dx, 10 + dy, 2, 150);
  rect(m, 40 + dx, 60 + dy, 60, 30);
  rect(m, 150 + dx, 100 + dy, 3, 70);
  rect(m, 200 + dx, 40 + dy, 20, 20);
  return m;
}

test('inkMask picks dark, opaque pixels', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 120, 120, 120, 255]);
  assert.deepEqual([...inkMask(rgba, 4, 1).data], [1, 0, 0, 1]);
});

test('dilate grows ink by r in every direction', () => {
  const m = blank(7, 7);
  m.data[3 * 7 + 3] = 1;
  const d = dilate(m, 1);
  assert.equal(inkCount(d), 9);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      if (d.data[y * 7 + x]) assert.ok(Math.abs(x - 3) <= 1 && Math.abs(y - 3) <= 1);
    }
  }
});

test('shrink downsamples preserving ink', () => {
  const m = blank(8, 8);
  m.data[5 * 8 + 7] = 1;
  const s = shrink(m, 2);
  assert.equal(s.width, 4);
  assert.equal(s.height, 4);
  assert.equal(s.data[2 * 4 + 3], 1);
  assert.equal(inkCount(s), 1);
});

test('findOffset lines up a shifted drawing', () => {
  assert.deepEqual(findOffset(drawing(), drawing(13, -7), 40), [13, -7]);
  assert.deepEqual(findOffset(drawing(), drawing(), 40), [0, 0]);
});

test('warpMask scales a thin line without dropping ink', () => {
  const oldMask = blank(200, 100);
  rect(oldMask, 20, 40, 100, 1);
  const scaled = warpMask(oldMask, 1, [0.5, 0, 0, 0.5, 0, 0], 1, 100, 50);
  assert.ok(inkCount(scaled) >= 45);
  assert.equal(scaled.data[20 * 100 + 30], 1);
});

test('measureMaskOverlap scores aligned vs misaligned masks', () => {
  const a = drawing();
  const b = drawing(12, -5);
  const aligned = measureMaskOverlap(a, b, 12, -5, 1);
  const misaligned = measureMaskOverlap(a, b, -40, 35, 1);
  assert.equal(aligned.f1, 1);
  assert.ok(misaligned.f1 < 0.25, `expected low overlap, got ${misaligned.f1}`);
  const shifted = shiftMask(a, 12, -5, b.width, b.height);
  assert.equal(measureMaskOverlap(shifted, b, 0, 0, 0).f1, 1);
});
