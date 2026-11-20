import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations } from './import.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { MarkupStore } from './store.ts';
import { parseRichText, spansFromRichText } from './richText.ts';

const box = (extra: Partial<Markup> = {}): Markup => ({
  id: 't1',
  type: 'text',
  pageIndex: 0,
  points: [[20, 20], [320, 120]],
  style: { ...DEFAULT_STYLES.text, fontSize: 12 },
  text: 'plain bold italic red',
  spans: [
    { start: 6, end: 10, style: { bold: true } },
    { start: 11, end: 17, style: { italic: true, underline: true } },
    { start: 18, end: 21, style: { color: '#ff0000', strikethrough: true } },
  ],
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
  ...extra,
});

async function exported(m: Markup) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  return exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]);
}

async function appearance(bytes: Uint8Array): Promise<string> {
  const out = await PDFDocument.load(bytes);
  return out.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') ? [Buffer.from(decodePDFRawStream(o).decode()).toString('latin1')] : []))
    .join('\n');
}

const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };

async function importedFrom(bytes: Uint8Array, contents: string, appData = '') {
  const doc = await PDFDocument.load(bytes);
  const ref = doc.getPages()[0]!.node.Annots()!.get(0) as PDFRef;
  const extras = (await readPdfExtras(bytes))!;
  return importAnnotations(0, [{ ...base, appData, index: 0, objectNumber: ref.objectNumber, subtype: 'FreeText', contents }], () => null, extras).markups[0]!;
}

test('styled parts are drawn in their own fonts, colours and decorations', async () => {
  const stream = await appearance(await exported(box()));
  // Bold and italic runs use the Helvetica variants.
  const fonts = [...stream.matchAll(/\/(F\d) 12 Tf/g)].map((m) => m[1]);
  assert.ok(new Set(fonts).size >= 3, stream);
  assert.match(stream, /1 0 0 rg/);
  // Underline and strikethrough segments are stroked for the runs that have them.
  assert.equal([...stream.matchAll(/ l S/g)].length, 2);
  const shown = [...stream.matchAll(/<([0-9A-F]+)> Tj/g)].map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'));
  assert.equal(shown.join(''), 'plain bold italic red');
});

test('/RC carries the styled parts as spans, and /Contents stays the plain text', async () => {
  const bytes = await exported(box());
  const doc = await PDFDocument.load(bytes);
  const ref = doc.getPages()[0]!.node.Annots()!.get(0) as PDFRef;
  const dict = doc.context.lookup(ref, PDFDict);
  const rc = (dict.get(PDFName.of('RC')) as PDFHexString).decodeText();
  assert.match(rc, /<span style="font-weight:bold">bold<\/span>/);
  assert.match(rc, /font-style:italic; text-decoration:underline/);
  assert.match(rc, /text-decoration:line-through; color:#FF0000/);
  assert.equal((dict.get(PDFName.of('Contents')) as PDFHexString).decodeText(), 'plain bold italic red');
});

test('a foreign /RC with mixed formatting is imported as spans', async () => {
  const bytes = await exported(box({ spans: undefined, text: 'hello world' }));
  const doc = await PDFDocument.load(bytes);
  const ref = doc.getPages()[0]!.node.Annots()!.get(0) as PDFRef;
  const dict = doc.context.lookup(ref, PDFDict);
  dict.set(PDFName.of('RC'), PDFHexString.fromText('<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" style="font:Helvetica 12pt; color:#000000"><p>hello <span style="font-weight:bold; color:#0000FF">world</span></p></body>'));
  const m = await importedFrom(await doc.save(), 'hello world');
  assert.equal(m.text, 'hello world');
  assert.deepEqual(m.spans, [{ start: 6, end: 11, style: { bold: true, color: '#0000ff' } }]);
});

test('a /RC that disagrees with /Contents is ignored', () => {
  const rc = '<body><p>one <b>two</b></p></body>';
  assert.deepEqual(spansFromRichText(rc, 'one two', { color: '#000000' }), [{ start: 4, end: 7, style: { bold: true } }]);
  assert.deepEqual(spansFromRichText(rc, 'one three', { color: '#000000' }), []);
  // A style equal to the markup's own is not a span.
  assert.deepEqual(spansFromRichText(rc, 'one two', { color: '#000000', bold: true }), []);
});

test('parseRichText reads paragraphs, line breaks, entities and nesting', () => {
  const r = parseRichText('<?xml version="1.0"?><body style="x"><p>a &amp; <b>b<i>c</i></b></p><p /><p>d<br/>e</p></body>')!;
  assert.equal(r.text, 'a & bc\n\nd\ne');
  assert.deepEqual(r.spans, [{ start: 4, end: 5, style: { bold: true } }, { start: 5, end: 6, style: { bold: true, italic: true } }]);
});

test('spans survive a full export and re-import of our own file', async () => {
  const m = box();
  const bytes = await exported(m);
  // Our app data is the whole markup as JSON, as the app writes it.
  const appData = JSON.stringify(m);
  const back = await importedFrom(bytes, 'plain bold italic red', appData);
  assert.deepEqual(back.spans, m.spans);
  assert.equal(back.text, m.text);
});

test('text changed by another program drops our spans unless its /RC says better', async () => {
  const m = box();
  const doc = await PDFDocument.load(await exported(m));
  const ref = doc.getPages()[0]!.node.Annots()!.get(0) as PDFRef;
  doc.context.lookup(ref, PDFDict).set(PDFName.of('Contents'), PDFHexString.fromText('something else'));
  const back = await importedFrom(await doc.save(), 'something else', JSON.stringify(m));
  assert.equal(back.text, 'something else');
  assert.equal(back.spans, undefined);
});

test('the store keeps spans on the characters that stay when only the text is patched', async () => {
  const store = await MarkupStore.open('spans', { persist: false });
  store.add(box());
  store.update('t1', { text: 'a plain bold italic red' });
  const [m] = store.all();
  assert.equal(m!.text, 'a plain bold italic red');
  assert.deepEqual(m!.spans![0], { start: 8, end: 12, style: { bold: true } });
  store.update('t1', { text: '' });
  assert.equal(store.get('t1')!.spans, undefined);
});
