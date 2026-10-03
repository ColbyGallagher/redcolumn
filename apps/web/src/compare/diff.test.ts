import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffMasks, diffWords, dilate, findOffset, inkMask, mergeBoxes, type Mask } from './diff.ts';

function blank(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

function rect(m: Mask, x: number, y: number, w: number, h: number) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m.data[j * m.width + i] = 1;
}

/** A small "drawing": a frame, a few lines and boxes. */
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
  let n = 0;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (d.data[y * 7 + x]) n++, assert.ok(Math.abs(x - 3) <= 1 && Math.abs(y - 3) <= 1);
  assert.equal(n, 9);
});

test('identical pages have no differences', () => {
  assert.deepEqual(diffMasks(drawing(), drawing()), []);
});

test('findOffset lines up a shifted drawing', () => {
  assert.deepEqual(findOffset(drawing(), drawing(13, -7), 40), [13, -7]);
  assert.deepEqual(findOffset(drawing(), drawing(), 40), [0, 0]);
});

test('a shifted page compares clean once aligned', () => {
  const a = drawing();
  const b = drawing(13, -7);
  assert.ok(diffMasks(a, b).length > 0);
  assert.deepEqual(diffMasks(a, b, { offset: findOffset(a, b, 40) }), []);
});

test('additions, removals and changes are boxed and named', () => {
  const a = drawing();
  const b = drawing();
  rect(b, 250, 150, 20, 20); // new box
  rect(a, 60, 150, 30, 4); // a line taken out of the new page
  // Moved: the small square goes from (200,40) to (205,40)… partially overlapping, so "changed".
  for (let j = 40; j < 60; j++) for (let i = 200; i < 220; i++) b.data[j * 300 + i] = 0;
  rect(b, 212, 44, 20, 20);
  const diffs = diffMasks(a, b, { proximity: 1, cell: 8, minPixels: 4, pad: 2 });
  const at = (x: number, y: number) => diffs.find((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
  assert.equal(at(260, 160)?.kind, 'added');
  assert.equal(at(75, 152)?.kind, 'removed');
  assert.equal(at(215, 50)?.kind, 'changed');
  assert.equal(diffs.length, 3);
});

test('specks under the threshold are ignored; a region limits the compare', () => {
  const a = drawing();
  const b = drawing();
  rect(b, 280, 5, 1, 1);
  assert.deepEqual(diffMasks(a, b, { minPixels: 4 }), []);
  rect(b, 250, 150, 20, 20);
  assert.equal(diffMasks(a, b, { region: { x: 0, y: 0, w: 150, h: 200 } }).length, 0);
  assert.equal(diffMasks(a, b, { region: { x: 150, y: 100, w: 150, h: 100 } }).length, 1);
});

test('mergeBoxes joins overlapping boxes', () => {
  const d = (x: number, y: number, kind: 'added' | 'removed') => ({ x, y, w: 10, h: 10, kind, added: kind === 'added' ? 5 : 0, removed: kind === 'removed' ? 5 : 0 });
  const merged = mergeBoxes([d(0, 0, 'added'), d(5, 5, 'removed'), d(50, 50, 'added')]);
  assert.equal(merged.length, 2);
  assert.deepEqual({ ...merged[0] }, { x: 0, y: 0, w: 15, h: 15, kind: 'changed', added: 5, removed: 5 });
});

test('diffWords finds changed text, allowing for the page offset', () => {
  const w = (text: string, x: number, y: number) => ({ text, x0: x, y0: y, x1: x + 20, y1: y + 8 });
  const old = [w('DOOR', 10, 10), w('D01', 40, 10), w('WALL', 10, 40)];
  const cur = [w('DOOR', 15, 12), w('D02', 45, 12), w('WALL', 15, 42)];
  const diffs = diffWords(old, cur, [5, 2]);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]!.kind, 'changed');
  assert.deepEqual(diffWords(old, old), []);
  assert.equal(diffWords(old, [...old, w('NEW', 10, 80)])[0]!.kind, 'added');
});

test('pairPages matches sheet numbers, else page order', async () => {
  const { pairPages } = await import('./compare.ts');
  assert.deepEqual(pairPages(['A101', 'A102', 'A103'], ['A101', 'A101a', 'A103'], true), [
    { oldPage: 0, newPage: 0 },
    { oldPage: 2, newPage: 2 },
  ]);
  assert.deepEqual(pairPages([null, null], [null, null, null], true), [
    { oldPage: 0, newPage: 0 },
    { oldPage: 1, newPage: 1 },
  ]);
  assert.deepEqual(pairPages(['a 1'], ['A1'], true), [{ oldPage: 0, newPage: 0 }]);
});

test('a word swapped for another is a change even when its pixels only grew', () => {
  const graphics = { x: 10, y: 10, w: 20, h: 10, kind: 'added' as const, added: 30, removed: 0 };
  const words = diffWords([{ text: 'D01', x0: 12, y0: 12, x1: 28, y1: 18 }], [{ text: 'D02', x0: 12, y0: 12, x1: 28, y1: 18 }]);
  const merged = mergeBoxes([graphics, ...words]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.kind, 'changed');
});
