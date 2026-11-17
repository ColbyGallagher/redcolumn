import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { imageStamp, imageStampName, MAX_STAMP_IMAGE_SIDE, stampImageSize } from './stampImage.ts';
import { resolveStamp, stampAspect } from './stamp.ts';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** An RGBA PNG of `w` x `h`: left half opaque red, right half fully transparent. */
function rgbaPng(w: number, h: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) row.set(x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 0], 1 + x * 4);
    rows.push(row);
  }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

test('an image stamp is a picture with no text, sized to the picture', () => {
  const def = imageStamp('data:image/png;base64,AAAA', 300, 100, 'Seal', 'x');
  assert.equal(def.art?.texts.length, 0);
  assert.equal(def.name, 'Seal');
  const content = resolveStamp(def, { user: 'J', file: 'a.pdf', page: '1', now: new Date() });
  assert.equal(stampAspect(content), 3);
});

test('an image stamp refuses what is not a PNG or JPEG data URL', () => {
  assert.throws(() => imageStamp('data:image/svg+xml;base64,AAAA', 1, 1, 'a', 'x'), /PNG or JPEG/);
  assert.throws(() => imageStamp('data:image/png;base64,AAAA', 0, 1, 'a', 'x'), /no size/);
});

test('large pictures are scaled down, small ones are kept', () => {
  assert.deepEqual(stampImageSize(200, 100), { width: 200, height: 100 });
  assert.deepEqual(stampImageSize(MAX_STAMP_IMAGE_SIDE * 2, MAX_STAMP_IMAGE_SIDE), { width: MAX_STAMP_IMAGE_SIDE, height: MAX_STAMP_IMAGE_SIDE / 2 });
});

test('the name defaults to the file name without its extension', () => {
  assert.equal(imageStampName('Company_Seal.png'), 'Company Seal');
  assert.equal(imageStampName('.png'), 'Image Stamp');
});

test('a transparent PNG stamp is exported with a soft mask', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const def = imageStamp(rgbaPng(8, 4), 8, 4, 'Seal', 'x');
  const stamp = resolveStamp(def, { user: 'J', file: 'a.pdf', page: '1', now: new Date() });
  const m: Markup = { id: 's', type: 'stamp', pageIndex: 0, points: [[20, 20], [220, 120]], style: DEFAULT_STYLES.stamp, stamp, status: 'none', author: 'J', createdAt: 1, modifiedAt: 1 };
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [m]));
  let masked = 0;
  for (const [, obj] of out.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict: PDFDict = obj.dict;
    if (dict.get(PDFName.of('Subtype')) === PDFName.of('Image') && dict.get(PDFName.of('SMask'))) masked++;
  }
  assert.equal(masked, 1);
});
