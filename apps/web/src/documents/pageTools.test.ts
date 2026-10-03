import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrees, PDFDocument } from 'pdf-lib';
import { chunkPages, cropPages, marginRect, rangesFromStarts, replacePages, resizePages, splitPdf } from './pageTools.ts';
import { crc32, zipFiles } from './zip.ts';

async function pdf(sizes: [number, number][], rotate = 0) {
  const doc = await PDFDocument.create();
  for (const s of sizes) {
    const page = doc.addPage(s);
    page.setRotation(degrees(rotate));
    page.drawLine({ start: { x: 0, y: 0 }, end: { x: 5, y: 5 } });
  }
  return doc.save();
}

test('replace swaps pages one for one', async () => {
  const out = await PDFDocument.load(await replacePages(await pdf([[100, 100], [200, 200], [300, 300]]), await pdf([[10, 10], [20, 20]]), [1], [1]));
  assert.deepEqual(out.getPages().map((p) => p.getWidth()), [100, 20, 300]);
  await assert.rejects(replacePages(await pdf([[100, 100]]), await pdf([[10, 10]]), [0], [0, 0]));
});

test('crop sets the crop box from a page-space rectangle, rotated pages included', async () => {
  const { bytes, transforms } = await cropPages(await pdf([[200, 100]]), new Map([[0, { x: 10, y: 20, w: 50, h: 30 }]]));
  const box = (await PDFDocument.load(bytes)).getPage(0).getCropBox();
  // Page space is y-down from the top: 20 from the top of a 100-high page is y = 80 in user space.
  assert.deepEqual([box.x, box.y, box.width, box.height], [10, 50, 50, 30]);
  assert.deepEqual(transforms.get(0), { scale: 1, dx: -10, dy: -20 });
  // A page turned 90°: displayed 100 wide × 200 high.
  const turned = await cropPages(await pdf([[200, 100]], 90), new Map([[0, { x: 0, y: 0, w: 100, h: 50 }]]));
  const tb = (await PDFDocument.load(turned.bytes)).getPage(0).getCropBox();
  assert.deepEqual([tb.width, tb.height], [50, 100]);
  assert.deepEqual(marginRect({ width: 100, height: 50 }, { top: 5, right: 10, bottom: 5, left: 10 }), { x: 10, y: 5, w: 80, h: 40 });
  assert.equal(marginRect({ width: 10, height: 10 }, { top: 5, right: 5, bottom: 5, left: 5 }), null);
});

test('page setup puts pages on a new size, centred and scaled to fit', async () => {
  const { bytes, transforms } = await resizePages(await pdf([[100, 50], [100, 50]]), [1], { width: 200, height: 200 }, true);
  const out = await PDFDocument.load(bytes);
  assert.deepEqual(out.getPages().map((p) => [p.getWidth(), p.getHeight()]), [[100, 50], [200, 200]]);
  assert.deepEqual(transforms.get(1), { scale: 2, dx: 0, dy: 50 });
  const actual = await resizePages(await pdf([[100, 50]]), [0], { width: 200, height: 200 }, false);
  assert.deepEqual(actual.transforms.get(0), { scale: 1, dx: 50, dy: 75 });
  // Blank pages (no content) are resized too.
  const blank = await PDFDocument.create();
  blank.addPage([100, 50]);
  const resized = await resizePages(await blank.save(), [0], { width: 300, height: 300 }, true);
  assert.equal((await PDFDocument.load(resized.bytes)).getPage(0).getWidth(), 300);
});

test('split into chunks or at bookmarks; zip archives them', async () => {
  assert.deepEqual(chunkPages(5, 2), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(rangesFromStarts(5, [3, 1]), [[0], [1, 2], [3, 4]]);
  assert.deepEqual(rangesFromStarts(3, [0]), [[0, 1, 2]]);
  const parts = await splitPdf(await pdf([[10, 10], [20, 20], [30, 30]]), [[0, 2], [1]]);
  assert.deepEqual(await Promise.all(parts.map(async (b) => (await PDFDocument.load(b)).getPageCount())), [2, 1]);
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const zip = zipFiles([{ name: 'a.pdf', data: parts[0]! }, { name: 'b.pdf', data: parts[1]! }]);
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 3, 4]);
  // End of central directory lists two entries.
  const end = zip.length - 22;
  assert.equal(zip[end + 10], 2);
});
