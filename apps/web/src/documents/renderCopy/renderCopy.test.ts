import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { RenderCopyBuilder } from './renderCopy.ts';

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** A PDF whose first page is hatched with `dashes` separate stroke objects; the second is plain. */
async function hatchedPdf(dashes: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const hatched = doc.addPage([1000, 800]);
  let content = 'BT /F1 12 Tf 10 10 Td (Sheet) Tj ET\n';
  for (let i = 0; i < dashes; i++) content += `q 0.5 0.5 0.5 RG 0.1 w ${(i % 500) * 2} ${Math.floor(i / 500) * 2} m ${(i % 500) * 2 + 1} ${Math.floor(i / 500) * 2} l S 0 G 0 w Q\n`;
  hatched.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(enc(content))));
  const plain = doc.addPage([1000, 800]);
  plain.drawRectangle({ x: 10, y: 10, width: 100, height: 50 });
  return doc.save();
}

const contentOf = (doc: PDFDocument, page: number) => {
  const s = doc.context.lookup(doc.getPage(page).node.get(PDFName.of('Contents')) as PDFRef) as PDFRawStream;
  return new TextDecoder('latin1').decode(decodePDFRawStream(s).decode());
};

test('the copy is the original with heavy pages rewritten, appended', async () => {
  const original = await hatchedPdf(2000);
  const b = await RenderCopyBuilder.load(original.slice());
  const plan = await b.plan(0);
  assert.equal(plan.objectsBefore, 2000);
  assert.ok(plan.objectsAfter < 300, `merged into ${plan.objectsAfter}`);
  assert.equal(plan.worthwhile, true);
  assert.equal((await b.plan(1)).worthwhile, false, 'a plain page is left alone');

  const { bytes, pages } = await b.build(null);
  assert.ok(bytes);
  assert.equal(pages.length, 2);
  assert.deepEqual(bytes.subarray(0, original.length), original, 'the original bytes come first, untouched');
  const copy = await PDFDocument.load(bytes);
  assert.equal(copy.getPageCount(), 2);
  assert.deepEqual(copy.getPage(0).getSize(), { width: 1000, height: 800 });
  const text = contentOf(copy, 0);
  assert.match(text, /^BT \/F1 12 Tf 10 10 Td \(Sheet\) Tj ET\n/, 'text kept as it was');
  assert.equal(text.match(/ m\b/g)!.length, 2000, 'every dash is still drawn');
  assert.equal(text.match(/\bS\n/g)!.length, plan.objectsAfter);
  // The plain page still uses its original content stream.
  const before = await PDFDocument.load(original);
  assert.equal(copy.getPage(1).node.get(PDFName.of('Contents'))!.toString(), before.getPage(1).node.get(PDFName.of('Contents'))!.toString());
});

test('pages built first are kept when the rest follow', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (let p = 0; p < 3; p++) {
    let content = '';
    for (let i = 0; i < 800; i++) content += `q 0 0 0 RG ${i} ${p} m ${i + 1} ${p} l S Q\n`;
    doc.addPage([900, 300]).node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(enc(content))));
  }
  const b = await RenderCopyBuilder.load(await doc.save());
  const first = await b.build([1]);
  assert.ok(first.bytes);
  assert.deepEqual(first.pages.map((p) => p.pageIndex), [1]);
  const firstCopy = await PDFDocument.load(first.bytes);
  assert.equal(contentOf(firstCopy, 0).match(/\bS\b/g)!.length, 800, 'page 1 not yet optimised');
  assert.ok(contentOf(firstCopy, 1).match(/\bS\b/g)!.length < 50);
  const all = await b.build(null);
  const copy = await PDFDocument.load(all.bytes!);
  for (let p = 0; p < 3; p++) assert.ok(contentOf(copy, p).match(/\bS\b/g)!.length < 50, `page ${p + 1}`);
});

test('nothing worth changing gives no copy', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]).drawText('Hello');
  const b = await RenderCopyBuilder.load(await doc.save());
  assert.equal((await b.build(null)).bytes, null);
});
