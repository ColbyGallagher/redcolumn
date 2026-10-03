import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, rgb } from 'pdf-lib';
import { exportWithAnnotations } from '@nb/markup/export';
import { DEFAULT_STYLES, type Markup } from '@nb/markup';
import { canUnflatten, flattenAnnotations, recolourContent, recolourPages, reduceFileSize, unflatten } from './process.ts';

test('colour operators turn grey or black; strings, patterns and inline images are left alone', () => {
  const src = '1 0 0 rg 0 0 1 RG 0 0 0 1 k (keep 1 0 0 rg) Tj /P0 scn 1 1 1 rg\nBI /W 1 ID \x01 1 0 0 rg EI Q';
  const grey = recolourContent(src, 'grayscale');
  assert.match(grey, /^0\.299 g 0\.114 G 0 g \(keep 1 0 0 rg\) Tj \/P0 scn 1 g/);
  assert.match(grey, /BI \/W 1 ID \x01 1 0 0 rg EI Q$/);
  const black = recolourContent('0.5 0.2 0.9 rg 1 1 1 rg 0.3 SC', 'black');
  assert.equal(black, '0 g 1 g 0 SC');
});

async function withMarkup() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(1, 0, 0) });
  const m: Markup = { id: 'r', type: 'rect', pageIndex: 0, points: [[100, 100], [200, 150]], style: { ...DEFAULT_STYLES.rect }, status: 'none', author: 'A', createdAt: 1, modifiedAt: 1 };
  return { bytes: await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]), m };
}

const contentText = (doc: PDFDocument) => {
  const c = doc.getPage(0).node.Contents()!;
  const list = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return list.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
};

test('flatten burns markups into the page, keeping them for unflatten', async () => {
  const { bytes, m } = await withMarkup();
  const flat = await flattenAnnotations(bytes, JSON.stringify([m]));
  assert.equal(flat.count, 1);
  const doc = await PDFDocument.load(flat.bytes);
  assert.equal(doc.getPage(0).node.Annots()?.size() ?? 0, 0);
  assert.match(contentText(doc), /\/NBF0 Do/);
  assert.equal(await canUnflatten(flat.bytes), true);

  const back = await unflatten(flat.bytes);
  assert.deepEqual(JSON.parse(back.recovery!), [m]);
  const restored = await PDFDocument.load(back.bytes);
  assert.doesNotMatch(contentText(restored), /NBF0/);
  assert.equal(restored.getPage(0).node.Resources()!.lookupMaybe(PDFName.of('XObject'), (await import('pdf-lib')).PDFDict)?.has(PDFName.of('NBF0')) ?? false, false);
  assert.equal(await canUnflatten(back.bytes), false);
});

test('reduce file size drops objects nothing uses', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]).drawText('hello', { x: 10, y: 50 });
  // A large orphan object, as left by incremental saves.
  let seed = 1;
  const noise = Uint8Array.from({ length: 50000 }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
  doc.context.register(doc.context.stream(noise));
  doc.setTitle('Kept');
  const before = await doc.save();
  const after = await reduceFileSize(before);
  assert.ok(after.bytes.length < before.length / 2, `${after.bytes.length} vs ${before.length}`);
  const out = await PDFDocument.load(after.bytes);
  assert.equal(out.getPageCount(), 1);
  assert.equal(out.getTitle(), 'Kept');
});

test('colour processing rewrites page content', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]).drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(1, 0, 0) });
  const out = await PDFDocument.load(await recolourPages(await doc.save(), [0], 'black'));
  const text = contentText(out);
  assert.doesNotMatch(text, /1 0 0 rg/);
  assert.match(text, /0 g/);
});

test('Colour Processing replaces one colour and turns pictures grey', async () => {
  const src = '1 0 0 rg 0 0 10 10 re f 0 0 1 RG 0.98 0.02 0 rg 0 0 1 rg';
  assert.equal(recolourContent(src, { replace: '#ff0000', with: '#00ff00', tolerance: 0.05 }), '0 1 0 rg 0 0 10 10 re f 0 0 1 RG 0 1 0 rg 0 0 1 rg');
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  // A 2 × 1 RGB picture: red and blue.
  const img = doc.context.flateStream(new Uint8Array([255, 0, 0, 0, 0, 255]), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  const ref = doc.context.register(img);
  page.node.setXObject(PDFName.of('Im0'), ref);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q 100 0 0 100 0 0 cm /Im0 Do Q')));
  const out = await PDFDocument.load(await recolourPages(await doc.save(), [0], 'grayscale'));
  const pic = out.context.lookup(ref) as PDFRawStream;
  assert.equal(pic.dict.get(PDFName.of('ColorSpace'))?.toString(), '/DeviceGray');
  assert.deepEqual([...decodePDFRawStream(pic).decode()], [76, 29]);
});
