import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { formatPdfDate, setDocumentInfo } from './docInfo.ts';
import { imageDpi, imagePageSize } from './imagePdf.ts';
import { PAGE_SIZES, presetFor } from './pageSizes.ts';

test('page size presets are portrait and recognised in either orientation', () => {
  for (const p of PAGE_SIZES) assert.ok(p.width <= p.height, p.id);
  assert.equal(presetFor(36 * 72, 24 * 72)?.id, 'arch-d');
  assert.equal(presetFor(595.28, 841.89)?.id, 'a4');
  assert.equal(presetFor(100, 100), undefined);
});

test('picture resolution is read from PNG pHYs and JPEG JFIF headers', () => {
  // PNG signature, then a pHYs chunk: 11811 px/m (300 dpi) both ways, unit 1.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1, 0, 0, 0, 0]);
  const [x, y] = imageDpi(png)!;
  assert.ok(Math.abs(x - 300) < 0.1 && Math.abs(y - 300) < 0.1);
  // JPEG SOI, APP0 JFIF with density 200 × 200 dots per inch.
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 200, 0, 200, 0, 0]);
  assert.deepEqual(imageDpi(jpg), [200, 200]);
  assert.equal(imageDpi(new Uint8Array([1, 2, 3])), null);
  // 300 dpi, 3000 px wide: 10 inches = 720 points; unknown resolution assumes 96 dpi.
  assert.deepEqual(imagePageSize(3000, 1500, [300, 300]), { width: 720, height: 360 });
  assert.deepEqual(imagePageSize(96, 192, null), { width: 72, height: 144 });
});

test('document properties are written to the file', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = await doc.save();
  const out = await setDocumentInfo(bytes.buffer as ArrayBuffer, { title: 'Level 2 Plan', author: 'Jane', subject: '', keywords: 'arch, plan' });
  const back = await PDFDocument.load(out);
  assert.equal(back.getTitle(), 'Level 2 Plan');
  assert.equal(back.getAuthor(), 'Jane');
  assert.equal(back.getKeywords(), 'arch plan');
});

test('PDF dates read as local dates', () => {
  assert.equal(formatPdfDate(''), '');
  assert.equal(formatPdfDate("D:20240102030405Z"), new Date('2024-01-02T03:04:05Z').toLocaleString());
  assert.equal(formatPdfDate("D:20240102030405+10'00'"), new Date('2024-01-02T03:04:05+10:00').toLocaleString());
});
