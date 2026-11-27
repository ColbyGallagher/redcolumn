import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import { parsePageRange, printablePdf } from './printPdf.ts';

test('page ranges: lists, spans and open ends, in order without repeats', () => {
  assert.deepEqual(parsePageRange('', 3), [0, 1, 2]);
  assert.deepEqual(parsePageRange('3, 1-2, 2', 5), [0, 1, 2]);
  assert.deepEqual(parsePageRange('4-', 5), [3, 4]);
  assert.deepEqual(parsePageRange('-2', 5), [0, 1]);
  assert.equal(parsePageRange('0', 5), null);
  assert.equal(parsePageRange('6', 5), null);
  assert.equal(parsePageRange('3-1', 5), null);
  assert.equal(parsePageRange('a', 5), null);
});

async function sample() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([200, 100]);
    p.drawText(`page ${i}`, { x: 10, y: 50 });
    const square = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }));
    const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 10, 10] }));
    p.node.set(PDFName.of('Annots'), doc.context.obj([square, widget]));
  }
  return doc.save();
}

const contentLength = (doc: PDFDocument, i: number) => {
  const c = doc.getPage(i).node.Contents();
  const s = c instanceof PDFArray ? c.lookup(0) : c;
  return s instanceof PDFRawStream ? s.contents.length : s instanceof PDFStream ? s.getContentsSize() : -1;
};

test('printing keeps the chosen pages and content', async () => {
  const bytes = await sample();
  const all = await PDFDocument.load(await printablePdf(bytes, 'all', [0, 2]));
  assert.equal(all.getPageCount(), 2);
  assert.equal(all.getPage(0).node.Annots()!.size(), 2);

  const docOnly = await PDFDocument.load(await printablePdf(bytes, 'document', [1]));
  assert.equal(docOnly.getPageCount(), 1);
  const annots = docOnly.getPage(0).node.Annots()!;
  assert.equal(annots.size(), 1, 'form fields stay, markups go');
  assert.ok(contentLength(docOnly, 0) > 0);

  const markupsOnly = await PDFDocument.load(await printablePdf(bytes, 'markups', [0]));
  assert.equal(markupsOnly.getPage(0).node.Annots()!.size(), 2);
  assert.ok(contentLength(markupsOnly, 0) < contentLength(all, 0), 'the drawing is blanked');
});

test('large pages tile onto paper, and pages can print last first', async () => {
  const src = await PDFDocument.create();
  src.addPage([2592, 1728]); // 36 × 24 in
  src.addPage([612, 792]);
  const bytes = await src.save();
  const tiled = await PDFDocument.load(await printablePdf(bytes, 'all', [0, 1], { tile: { width: 792, height: 1224, overlap: 18 } }));
  // 36 × 24 in on tabloid turned landscape (17 × 11 in, overlapping ¼ in): 3 columns by 3 rows, then the letter page as it is.
  assert.equal(tiled.getPageCount(), 10);
  assert.deepEqual(tiled.getPage(0).getSize(), { width: 1224, height: 792 });
  assert.deepEqual(tiled.getPage(9).getSize(), { width: 612, height: 792 });
  const reversed = await PDFDocument.load(await printablePdf(bytes, 'all', [0, 1], { reverse: true }));
  assert.deepEqual(reversed.getPages().map((p) => p.getWidth()), [612, 2592]);
});

test('Disable Line Weights prints content lines thin and solid, forms and graphics states too', async () => {
  const src = await PDFDocument.create();
  const page = src.addPage([200, 100]);
  const ctx = src.context;
  const form = ctx.register(ctx.flateStream('8 w [4 4] 0 d 0 0 m 9 9 l S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }));
  const state = ctx.register(ctx.obj({ Type: 'ExtGState', LW: 5, D: [[2], 0] }));
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { F: form }, ExtGState: { G: state } }));
  // An operand and its operator in different streams.
  page.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.flateStream('q /G gs 3')), ctx.register(ctx.flateStream('w [6] 1 d (3 w) Tj /F Do Q'))]));
  const bytes = await src.save();

  const out = await PDFDocument.load(await printablePdf(bytes, 'all', [0], { thinLines: true }));
  const text = (s: unknown) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1');
  assert.equal(text(out.getPage(0).node.Contents()).replace(/\s+/g, ' ').trim(),'0 w q /G gs 0 w [] 0 d (3 w) Tj /F Do Q');
  const resources = out.getPage(0).node.Resources()!;
  assert.equal(text(resources.lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('F'))), '0 w [] 0 d 0 0 m 9 9 l S');
  const gs = resources.lookup(PDFName.of('ExtGState'), PDFDict).lookup(PDFName.of('G'), PDFDict);
  assert.equal(String(gs.lookup(PDFName.of('LW'))), '0');
  assert.equal(String(gs.lookup(PDFName.of('D'))).replace(/\s+/g, ''), '[[]0]');
});
