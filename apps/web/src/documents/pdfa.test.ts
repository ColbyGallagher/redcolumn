import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from 'pdf-lib';
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

/** A square annotation with an (empty) appearance, so it is drawn the same everywhere. */
function square(doc: PDFDocument, f: number) {
  const ap = doc.context.register(doc.context.flateStream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 40, 40] }));
  return doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], F: f, AP: { N: ap } }));
}

test('archiving adds the output intent, PDF/A metadata and file ID, and fixes annotations', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const attachment = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [0, 0, 10, 10], F: 4 }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([square(doc, 0), square(doc, 2), attachment]));
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: 'app.alert(1)' }));
  const { bytes, changes, blocking } = await archiveAsPdfA(await doc.save(), 'Test');
  const out = await PDFDocument.load(bytes);
  assert.deepEqual(blocking, []);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 8)), '%PDF-1.7');
  assert.equal(await pdfaPart(bytes), 'PDF/A-2b');
  const intent = out.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict);
  assert.equal(intent.get(PDFName.of('S'))?.toString(), '/GTS_PDFA1');
  assert.ok(intent.lookup(PDFName.of('DestOutputProfile')) instanceof PDFRawStream);
  assert.ok(out.context.trailerInfo.ID);
  assert.equal(out.catalog.has(PDFName.of('OpenAction')), false);
  // The screen-only one now prints; the hidden one and the attachment are gone.
  const annots = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  assert.equal(annots.size(), 1);
  assert.equal(annots.lookup(0, PDFDict).lookup(PDFName.of('F'), PDFNumber).asNumber(), 4);
  assert.ok(changes.some((c) => /Left out 1 hidden/.test(c)));
  assert.ok(changes.some((c) => /Set 1 annotation .*print/.test(c)));
  assert.ok(changes.some((c) => /Removed 1 attached file/.test(c)));
  assert.equal(out.getTitle(), 'Test');
});

test('a file with fonts it does not embed, or annotations without appearances, is not marked PDF/A', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText('Hello', { font: await doc.embedFont(StandardFonts.Helvetica) });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], F: 4 })]));
  const { bytes, blocking } = await archiveAsPdfA(await doc.save(), 'Test');
  assert.ok(blocking.some((b) => /does not embed: Helvetica/.test(b)));
  assert.ok(blocking.some((b) => /no appearance/.test(b)));
  assert.equal(await pdfaPart(bytes), null);
});

test('fonts only used by the OCR text layer, and embedded fonts, pass', async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([200, 200]);
  const ocr = await doc.embedFont(StandardFonts.Helvetica);
  page.node.newFontDictionary('NBOCR', ocr.ref);
  const sans = await doc.embedFont(await readFile(new URL('../../public/fonts/LiberationSans-Regular.ttf', import.meta.url)));
  page.drawText('Hello', { font: sans });
  const { bytes, blocking } = await archiveAsPdfA(await doc.save(), 'Test');
  assert.deepEqual(blocking, []);
  assert.equal(await pdfaPart(bytes), 'PDF/A-2b');
});

test('markups exported with their fonts embedded archive as valid PDF/A, without the hidden ones', async () => {
  const { exportWithAnnotations } = await import('@nb/markup/export');
  const { DEFAULT_STYLES } = await import('@nb/markup');
  type M = import('@nb/markup').Markup;
  const mk = (m: Partial<M> & Pick<M, 'id' | 'type' | 'points'>): M => ({ pageIndex: 0, style: { ...DEFAULT_STYLES[m.type] }, status: 'none', author: 'Ann', createdAt: 1000, modifiedAt: 2000, ...m });
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  const markups = [mk({ id: 't', type: 'text', points: [[50, 50], [150, 90]], text: 'Hello' }), mk({ id: 'l', type: 'length', points: [[50, 150], [250, 150]] })];
  const files: Record<string, string> = { Helvetica: 'LiberationSans-Regular.ttf', 'Helvetica-Bold': 'LiberationSans-Bold.ttf' };
  const embedFont = async (d: PDFDocument, name: StandardFonts) => {
    d.registerFontkit(fontkit);
    return d.embedFont(await readFile(new URL(`../../public/fonts/${files[name]}`, import.meta.url)));
  };
  const exported = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, markups, { embedFont });
  const { bytes, blocking } = await archiveAsPdfA(exported, 'Test');
  assert.deepEqual(blocking, []);
  assert.equal(await pdfaPart(bytes), 'PDF/A-2b');
  // With the standard fonts instead, the same markups are blocked.
  const plain = await archiveAsPdfA(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, markups), 'Test');
  assert.ok(plain.blocking.some((b) => /Helvetica/.test(b)));
});
