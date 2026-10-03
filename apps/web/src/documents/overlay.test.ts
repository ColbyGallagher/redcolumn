import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, decodePDFRawStream, rgb, degrees } from 'pdf-lib';
import { overlayPages, rgbOf } from './overlay.ts';

async function source(color: [number, number, number], rotate = 0) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 300]);
  p.drawRectangle({ x: 50, y: 50, width: 100, height: 80, borderColor: rgb(...color), borderWidth: 2 });
  if (rotate) p.setRotation(degrees(rotate));
  doc.addPage([400, 300]); // blank
  return doc.save();
}

const text = (s: PDFRawStream) => new TextDecoder().decode(decodePDFRawStream(s).decode());

test('rgbOf reads hex colours', () => {
  assert.deepEqual(rgbOf('#ff0000'), [1, 0, 0]);
  assert.deepEqual(rgbOf('00ff00'), [0, 1, 0]);
});

test('overlay stacks tinted, greyed pages multiplied together', async () => {
  const bytes = await overlayPages(
    [
      { bytes: await source([1, 0, 0]), color: [1, 0, 0] },
      { bytes: await source([0, 0, 1]), color: [0, 0, 1] },
    ],
    [
      {
        size: { width: 400, height: 300 },
        layers: [
          { source: 0, page: 0, offset: [10, -5] },
          { source: 1, page: 0, offset: [0, 0] },
        ],
      },
      // Blank pages have nothing to draw but still give a page.
      { size: { width: 400, height: 300 }, layers: [{ source: 0, page: 1, offset: [0, 0] }] },
    ],
  );
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  const page = doc.getPage(0);
  const res = page.node.Resources()!;
  const xo = res.lookup(PDFName.of('XObject'), PDFDict);
  assert.equal(xo.keys().length, 2);
  const gs = res.lookup(PDFName.of('ExtGState'), PDFDict).lookup(PDFName.of('M'), PDFDict);
  assert.equal(gs.get(PDFName.of('BM')), PDFName.of('Multiply'));
  const layer = xo.lookup(xo.keys()[0]!) as PDFRawStream;
  const group = layer.dict.lookup(PDFName.of('Group'), PDFDict);
  assert.equal(group.get(PDFName.of('I'))?.toString(), 'true');
  const content = text(layer);
  // Moved by (10, -5) in page space: +10 in x, +5 in PDF y.
  assert.match(content, /q 1 0 0 1 10 5 cm \/P Do Q/);
  assert.match(content, /\/L gs 1 0 0 rg/);
  // The embedded page was made grey: no red stroke left in it.
  const embedded = layer.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('P')) as PDFRawStream;
  assert.doesNotMatch(text(embedded), /1 0 0 RG/);
  assert.equal(doc.getPage(1).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0, 0);
});

test('a rotated source page is turned upright on the overlay', async () => {
  const bytes = await overlayPages([{ bytes: await source([0, 0, 0], 90), color: [0, 0, 0] }], [{ size: { width: 300, height: 400 }, layers: [{ source: 0, page: 0, offset: [0, 0] }] }]);
  const doc = await PDFDocument.load(bytes);
  const xo = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  const content = text(xo.lookup(xo.keys()[0]!) as PDFRawStream);
  // /Rotate 90: user (x, y) → page (y, x) → overlay user (y, 400 - x).
  assert.match(content, /q 0 -1 1 0 0 400 cm \/P Do Q/);
});
