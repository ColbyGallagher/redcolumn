import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeG4, encodeTiff } from './tiff.ts';

test('a white Group 4 line is one vertical code, then the end of the block', () => {
  assert.deepEqual([...encodeG4(new Uint8Array(8), 8, 1)], [0x80, 0x08, 0x00, 0x80]);
});

test('pages are chained IFDs with their size, compression and resolution', () => {
  const page = (width: number, height: number) => ({ width, height, rgba: new Uint8ClampedArray(width * height * 4).fill(255) });
  const tiff = encodeTiff([page(10, 4), page(3, 7)], { compression: 'lzw', colour: 'grey', dpi: 200 });
  const v = new DataView(tiff.buffer);
  assert.equal(String.fromCharCode(tiff[0]!, tiff[1]!), 'II');
  assert.equal(v.getUint16(2, true), 42);
  const pages: Record<number, number>[] = [];
  for (let ifd = v.getUint32(4, true); ifd; ) {
    const n = v.getUint16(ifd, true);
    const tags: Record<number, number> = {};
    for (let i = 0; i < n; i++) {
      const at = ifd + 2 + i * 12;
      const type = v.getUint16(at + 2, true);
      tags[v.getUint16(at, true)] = type === 3 ? v.getUint16(at + 8, true) : v.getUint32(at + 8, true);
    }
    pages.push(tags);
    ifd = v.getUint32(ifd + 2 + n * 12, true);
  }
  assert.equal(pages.length, 2);
  assert.deepEqual([pages[0]![256], pages[0]![257], pages[1]![256], pages[1]![257]], [10, 4, 3, 7]);
  assert.equal(pages[0]![259], 5);
  assert.equal(pages[0]![262], 1);
  assert.equal(v.getUint32(pages[0]![282]!, true), 200);
});
