import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { freeTextStyle } from './bluebeam.ts';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { readPdfExtras } from './pdfExtras.ts';
import type { Markup } from './model.ts';

const text = (s: string) => PDFHexString.fromText(s);
const rc = (body: string, paragraphs: string) =>
  `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="BluebeamPDFRevu:2018" style="${body}">${paragraphs}</body>`;

function annot(partial: Partial<ImportableAnnotation>): ImportableAnnotation {
  return {
    index: 0,
    subtype: 'FreeText',
    rect: { x: 100, y: 100, w: 160, h: 48 },
    color: null,
    interior: null,
    opacity: 1,
    borderWidth: 0,
    contents: 'TEXTBOX textox textbox textbox',
    author: 'Jane',
    intent: '',
    cloudy: false,
    da: '1 0 0 rg /Helv 13.15 Tf',
    appData: '',
    flags: 4,
    vertices: [],
    ink: [],
    line: null,
    link: null,
    ...partial,
  };
}

test('a FreeText style: /DS first, then /RC body and paragraph styles, then /Q', () => {
  const ds = 'font: Helvetica 13.15pt; text-align:center; text-valign:middle; margin:3pt; line-height:15.1225pt; color:#FF0000';
  assert.deepEqual(
    [freeTextStyle(ds, null, null).textAlign, freeTextStyle(ds, null, null).verticalAlign, freeTextStyle(ds, null, null).textMargin],
    ['center', 'middle', 4],
  );
  // /DS without an alignment: Revu's paragraph style says it.
  const noAlign = 'font: Helvetica 12pt; margin:3pt; color:#FF0000';
  assert.equal(freeTextStyle(noAlign, rc('font:Helvetica 12pt', '<p style="text-align:right">A</p>'), null).textAlign, 'right');
  // Or the body's, with its vertical alignment and line height.
  const body = freeTextStyle(noAlign, rc('font:Helvetica 12pt; text-align:center; text-valign:bottom; line-height:27.6pt', '<p>A</p>'), null);
  assert.deepEqual([body.textAlign, body.verticalAlign, body.lineHeight], ['center', 'bottom', 2.3]);
  // Single-quoted attributes and a paragraph line height.
  assert.equal(freeTextStyle(null, `<body><p style='text-align:center; line-height:30.245pt'>A</p></body>`, null, 13.15).lineHeight, 2.3);
  // Only /Q.
  assert.equal(freeTextStyle(null, null, 1).textAlign, 'center');
  assert.equal(freeTextStyle(null, null, 2).textAlign, 'right');
  assert.equal(freeTextStyle(null, null, 0).textAlign, undefined);
  // /DS outranks the others.
  assert.equal(freeTextStyle('text-align:left', rc('text-align:right', '<p style="text-align:center">A</p>'), 2).textAlign, 'left');
  // The paragraph lends only its alignment and line height, not a stray colour.
  assert.equal(freeTextStyle(null, '<body><p style="color:#00FF00">A</p></body>', null).textColor, undefined);
});

test('text boxes, call-outs, Cloud+ and typewriter text keep their alignment without the raw dictionaries', () => {
  const ds = (align: string, extra = '') => `font: Helvetica 13.15pt; text-align:${align};${extra} margin:3pt; line-height:15.1225pt; color:#FF0000`;
  const { markups } = importAnnotations(0, [
    annot({ index: 0, ds: ds('center'), rc: rc(ds('center'), '<p style="text-align:center">TEXTBOX textox textbox textbox</p>') }),
    annot({ index: 1, ds: ds('right') }),
    annot({ index: 2, ds: ds('center', ' text-valign:middle;') }),
    annot({ index: 3, ds: ds('left', ' text-valign:bottom;') }),
    annot({ index: 4, intent: 'FreeTextCallout', contents: 'CALLOUT', ds: ds('right') }),
    annot({ index: 5, intent: 'FreeTextCallout', contents: 'CLOUD PLUS', quadding: 1 }),
    annot({ index: 6, intent: 'FreeTextTypeWriter', contents: 'TYPED', da: '0 0 0 rg /Cour 12 Tf', rc: '<body><p style="text-align:right">TYPED</p></body>' }),
    annot({ index: 7, ds: 'font: Helvetica 13.15pt; text-align:center; text-valign:middle; margin:0pt; line-height:30.245pt; color:#FF0000' }),
  ]);
  const got = markups.map((m) => [m.style.textAlign ?? 'left', m.style.verticalAlign ?? 'top']);
  assert.deepEqual(got, [
    ['center', 'top'],
    ['right', 'top'],
    ['center', 'middle'],
    ['left', 'bottom'],
    ['right', 'top'],
    ['center', 'top'],
    ['right', 'top'],
    ['center', 'middle'],
  ]);
  // The margin and line height Revu sets the box's size against, so the text fits as it did there.
  assert.equal(markups[0]!.style.textMargin, 4);
  assert.equal(markups[0]!.style.lineHeight, 1.15);
  assert.equal(markups[0]!.style.fontSize, 13.15);
  assert.equal(markups[7]!.style.textMargin, 1);
  assert.equal(markups[7]!.style.lineHeight, 2.3);
});

/** A one-page PDF with FreeText annotations as Revu writes them, imported from its raw dictionaries. */
async function revuPdf(annots: Record<string, unknown>[]): Promise<{ bytes: Uint8Array; markups: Markup[] }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.2756, 841.8895]);
  const refs = annots.map((a) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'FreeText', DA: text('1 0 0 rg /Helv 12 Tf'), BS: { W: 0, S: 'S' }, C: [], ...a })));
  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = annot({});
  const { markups } = importAnnotations(0, refs.map((r, index) => ({ ...base, index, objectNumber: r.objectNumber, contents: '' })), () => null, extras);
  return { bytes, markups };
}

test('every FreeText kind reads its alignment from /DS, /RC or /Q', async () => {
  const noAlign = 'font: Helvetica 12pt; margin:3pt; line-height:13.8pt; color:#FF0000';
  const { markups } = await revuPdf([
    { Contents: text('A'), Rect: [100, 600, 260, 650], DS: text(noAlign), RC: text(rc(noAlign, '<p style="text-align:center">A</p>')) },
    { Contents: text('B'), Rect: [100, 500, 260, 550], Q: 2 },
    {
      Contents: text('CLOUD PLUS'), Subj: text('Cloud+'), IT: PDFName.of('FreeTextCallout'), Rect: [149.4, 671, 337.3, 715.8], RD: [56.41, 5.5, 5.5, 5.5],
      CL: [154.9, 700.4, 186, 693.4, 205.8, 693.4], DS: text(noAlign), RC: text(rc(`${noAlign}; text-align:right`, '<p>CLOUD PLUS</p><p />')),
    },
    { Contents: text('CALLOUT'), IT: PDFName.of('FreeTextCallout'), Rect: [108.3, 574.9, 323.2, 605.9], RD: [83.48, 5.5, 5.5, 5.5], CL: [113.8, 590.5, 171.9, 590.4, 191.7, 590.4], Q: 1 },
    { Contents: text('FLAG'), Subj: text('Flag'), Rect: [356.7, 504, 520.7, 533], RD: [14.5, 5.5, 5.5, 5.5], DS: text('font: Helvetica 8pt; text-align:right; text-valign:middle; line-height:9.2pt; color:#FFFFFF') },
  ]);
  assert.deepEqual(
    markups.map((m) => [m.type, m.style.textAlign]),
    [
      ['text', 'center'],
      ['text', 'right'],
      ['callout', 'right'],
      ['callout', 'center'],
      ['flagLabel', 'right'],
    ],
  );
});

test('saved text writes its alignment on each paragraph, as Revu does, and reads back the same', async () => {
  const bytes = await (await PDFDocument.create()).save();
  const doc = await PDFDocument.load(bytes);
  doc.addPage([595, 842]);
  const blank = await doc.save();
  const now = Date.now();
  const markup = (id: string, type: Markup['type'], points: [number, number][], textAlign: 'center' | 'right' | 'left'): Markup => ({
    id,
    type,
    pageIndex: 0,
    points,
    text: 'TEXTBOX textox\n\ntextbox textbox',
    style: { stroke: '#ff0000', fill: null, width: 1, opacity: 1, fontSize: 13.15, textAlign, verticalAlign: 'middle' },
    status: 'none',
    author: 'Jane',
    createdAt: now,
    modifiedAt: now,
  });
  const saved = await exportWithAnnotations(blank.slice().buffer as ArrayBuffer, [
    markup('box', 'text', [[100, 100], [260, 150]], 'center'),
    markup('callout', 'callout', [[50, 300], [90, 300], [100, 280], [260, 330]], 'right'),
    markup('left', 'text', [[100, 400], [260, 450]], 'left'),
  ], {});
  const out = await PDFDocument.load(saved);
  const dicts = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
  const rcOf = (nm: string) => dicts.find((d) => d.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText() === nm)!.lookup(PDFName.of('RC'), PDFString, PDFHexString).decodeText();
  assert.match(rcOf('box'), /<p style="text-align:center">TEXTBOX textox<\/p><p style="text-align:center" \/><p style="text-align:center">textbox textbox<\/p>/);
  assert.match(rcOf('callout'), /<p style="text-align:right">TEXTBOX textox<\/p>/);
  assert.match(rcOf('left'), /<p>TEXTBOX textox<\/p>/);

  // Read back as another tool's markup (its own data left out): the same alignment.
  const extras = (await readPdfExtras(saved))!;
  const refs = out.getPage(0).node.Annots()!.asArray();
  const back = importAnnotations(0, refs.map((r, index) => ({ ...annot({}), index, objectNumber: (r as unknown as { objectNumber: number }).objectNumber, contents: '' })), () => null, extras).markups;
  assert.deepEqual(back.map((m) => [m.type, m.style.textAlign, m.style.verticalAlign]), [
    ['text', 'center', 'middle'],
    ['callout', 'right', 'middle'],
    ['text', 'left', 'middle'],
  ]);
});
