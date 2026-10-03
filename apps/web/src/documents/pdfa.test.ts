import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { archiveAsPdfA, pdfaPart, srgbProfile } from './pdfa.ts';

test('the sRGB profile is a well-formed ICC display profile', () => {
  const p = srgbProfile();
  const view = new DataView(p.buffer);
  assert.equal(view.getUint32(0), p.length);
  assert.equal(new TextDecoder().decode(p.subarray(36, 40)), 'acsp');
  assert.equal(new TextDecoder().decode(p.subarray(12, 20)), 'mntrRGB ');
  const count = view.getUint32(128);
  assert.equal(count, 9);
  for (let i = 0; i < count; i++) {
    const off = view.getUint32(132 + i * 12 + 4);
    const size = view.getUint32(132 + i * 12 + 8);
    assert.ok(off % 4 === 0 && off + size <= p.length);
  }
});

test('archiving adds the output intent, PDF/A metadata and file ID, and fixes annotations', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const annot = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], F: 2 }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: 'app.alert(1)' }));
  const { bytes, issues } = await archiveAsPdfA(await doc.save(), 'Test');
  const out = await PDFDocument.load(bytes);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 8)), '%PDF-1.7');
  assert.equal(await pdfaPart(bytes), 'PDF/A-2b');
  const intent = out.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict);
  assert.equal(intent.get(PDFName.of('S'))?.toString(), '/GTS_PDFA1');
  assert.ok(intent.lookup(PDFName.of('DestOutputProfile')) instanceof PDFRawStream);
  assert.ok(out.context.trailerInfo.ID);
  assert.equal(out.catalog.has(PDFName.of('OpenAction')), false);
  const a = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
  assert.equal(a.lookup(PDFName.of('F'), PDFNumber).asNumber(), 4);
  assert.ok(issues.some((i) => /no appearance/.test(i)));
  assert.equal(out.getTitle(), 'Test');
});
