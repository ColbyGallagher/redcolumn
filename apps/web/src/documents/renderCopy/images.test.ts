import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { KEEP_DPI, rescalable, rescaledSize } from './images.ts';

test('pictures far sharper than they are placed are scaled to the resolution kept', () => {
  // 8000 x 6000 placed 4 x 3 inches: 2000 dpi.
  assert.deepEqual(rescaledSize({ width: 8000, height: 6000 }, { w: 288, h: 216 }), { width: 4 * KEEP_DPI, height: 3 * KEEP_DPI });
  // A 300 dpi scan of a whole A1 sheet is already what the page needs.
  assert.equal(rescaledSize({ width: 9933, height: 7016 }, { w: 2384, h: 1684 }), null);
  // A little sharper than needed is not worth rescaling.
  assert.equal(rescaledSize({ width: 4 * 400, height: 3 * 400 * 2 }, { w: 288, h: 216 * 2 }), null);
  // Small pictures are left alone however small they are placed.
  assert.equal(rescaledSize({ width: 1000, height: 1000 }, { w: 10, h: 10 }), null);
});

test('only 8-bit RGB or grey JPEG and deflated pictures without masks are rescaled', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const image = (dict: Record<string, unknown>) => ctx.stream(new Uint8Array(4), { Type: 'XObject', Subtype: 'Image', Width: 4000, Height: 3000, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode', ...dict });
  assert.deepEqual(rescalable(image({})), { format: 'jpeg', channels: 3, width: 4000, height: 3000 });
  assert.deepEqual(rescalable(image({ ColorSpace: 'DeviceGray', Filter: 'FlateDecode' })), { format: 'raw', channels: 1, width: 4000, height: 3000 });
  assert.equal(rescalable(image({ ColorSpace: 'DeviceCMYK' })), null, 'CMYK');
  assert.equal(rescalable(image({ Filter: 'JPXDecode' })), null, 'JPEG 2000');
  assert.equal(rescalable(image({ BitsPerComponent: 1, Filter: 'CCITTFaxDecode' })), null, 'a 1-bit scan');
  assert.equal(rescalable(image({ Decode: [1, 0, 1, 0, 1, 0] })), null, 'a decode range');
  const masked = image({});
  masked.dict.set(PDFName.of('SMask'), ctx.obj(1));
  assert.equal(rescalable(masked), null, 'a soft mask');
});
