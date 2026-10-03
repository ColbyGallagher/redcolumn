import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrees, PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { addHeaderFooter, fillTokens, hasHeaderFooter, removeHeaderFooter, type HeaderFooterSpec } from './headerFooter.ts';

const spec: HeaderFooterSpec = {
  text: { headerLeft: '<<file>>', footerRight: 'Page <<page>> of <<pages>>', footerCenter: '<<bates>> → <<label>>' },
  fontSize: 10,
  color: '#000000',
  font: 'Helvetica',
  margin: { top: 36, bottom: 36, left: 36, right: 36 },
  bates: { start: 7, digits: 5, prefix: 'ABC', suffix: '' },
  startPage: 1,
};

test('tokens fill per page', () => {
  const v = { index: 2, count: 10, label: 'A-103', file: 'set.pdf', date: '1/2/2026' };
  assert.equal(fillTokens('<<bates>> p<<page>>/<<pages>> <<label>> <<file>> <<date>>', spec, v), 'ABC00009 p3/10 A-103 set.pdf 1/2/2026');
});

async function sample() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]).drawText('body', { x: 50, y: 150 });
  const turned = doc.addPage([400, 300]);
  turned.setRotation(degrees(90));
  turned.drawText('body', { x: 50, y: 150 });
  return doc.save();
}

const streams = (doc: PDFDocument, i: number) => {
  const c = doc.getPage(i).node.Contents();
  const list = c instanceof PDFArray ? c.asArray() : [c];
  return list.map((r) => {
    const s = (r instanceof PDFRawStream ? r : doc.context.lookup(r)) as PDFRawStream;
    return new TextDecoder().decode(decodePDFRawStream(s).decode());
  });
};

test('headers and footers go in tagged streams, wrapped so the page is untouched, and come off again', async () => {
  const original = await sample();
  const added = await addHeaderFooter(original, [0, 1], spec, (i) => ({ label: `A-10${i + 1}`, file: 'set.pdf', date: 'today' }));
  const doc = await PDFDocument.load(added);
  const s0 = streams(doc, 0);
  assert.equal(s0[0], 'q');
  assert.equal(s0.at(-2), 'Q');
  const ops = s0.at(-1)!;
  assert.match(ops, /BDC/);
  assert.equal((ops.match(/ Tj/g) ?? []).length, 3);
  // The arrow is not in WinAnsi: it is replaced rather than failing.
  // Unrotated page: text runs along +x (Tm starts "1 0 0 1").
  assert.match(ops, /\n1 0 0 1 /);
  // Rotated page: the text matrix turns with the page.
  assert.match(streams(doc, 1).at(-1)!, /\n0 1 -1 0 /);
  assert.equal(await hasHeaderFooter(added), true);

  // Adding again replaces rather than stacks.
  const twice = await PDFDocument.load(await addHeaderFooter(added, [0], spec, () => ({ label: '', file: 'f', date: 'd' })));
  const before = streams(await PDFDocument.load(original), 0).length;
  assert.equal(streams(twice, 0).length, before + 3);

  const removed = await removeHeaderFooter(added);
  assert.equal(await hasHeaderFooter(removed), false);
  const back = await PDFDocument.load(removed);
  assert.deepEqual(streams(back, 0), streams(await PDFDocument.load(original), 0));
});
