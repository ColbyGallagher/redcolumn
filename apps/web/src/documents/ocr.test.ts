import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { addTextLayer } from './ocr.ts';

const streams = (doc: PDFDocument) => {
  const c = doc.getPage(0).node.Contents();
  const list = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return list.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode()));
};

test('OCR text goes in as an invisible, replaceable layer, stretched to each word', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]).drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  const words = new Map([[0, [{ text: 'HELLO', x0: 50, y0: 40, x1: 150, y1: 60 }, { text: 'wörld→', x0: 160, y0: 40, x1: 220, y1: 60 }]]]);
  const once = await PDFDocument.load(await addTextLayer(await doc.save(), words));
  const layer = streams(once).at(-1)!;
  assert.match(layer, /^BT 3 Tr/);
  assert.equal((layer.match(/ Tj/g) ?? []).length, 2);
  assert.match(layer, / Tz /);
  // The top of the 300-high page is y = 300: a word 40–60 from the top sits near y = 244.
  assert.match(layer, /1 0 0 1 50 244 Tm/);
  // Running it again replaces the layer.
  const twice = await PDFDocument.load(await addTextLayer(await once.save(), words));
  assert.equal(streams(twice).length, streams(once).length);
});
