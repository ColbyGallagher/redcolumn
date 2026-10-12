import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { resolveStamp, stampAspect, type StampDef } from './stamp.ts';
import { artStamp, parseStampPdf, revuFields, textStamp } from './stampPdf.ts';

type Box = { text: string; rect: [number, number, number, number]; da: string; ds: string; ap: string };

/** A one-page stamp the way Revu writes them: FreeText boxes with rich text, in an art box. */
async function stampPdf(boxes: Box[], extra: { artBox?: number[]; title?: string; square?: boolean } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (extra.title) doc.setTitle(extra.title);
  if (extra.artBox) page.node.set(PDFName.of('ArtBox'), doc.context.obj(extra.artBox));
  const annots = boxes.map((b) => {
    const stream = doc.context.flateStream(b.ap, { Type: 'XObject', Subtype: 'Form', BBox: b.rect });
    return doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'FreeText',
        Rect: b.rect,
        DA: PDFString.of(b.da),
        DS: PDFString.of(b.ds),
        RC: PDFString.of(`<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" style="${b.ds}">${b.text}</body>`),
        AP: { N: doc.context.register(stream) },
      }),
    );
  });
  if (extra.square) annots.push(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] })));
  page.node.set(PDFName.of('Annots'), doc.context.obj(annots));
  return doc.save();
}

const HEAD: Box = { text: 'For Review', rect: [122, 503, 338, 545], da: '1 0 0 rg /HelvBld 40 Tf', ds: 'font: bold Helvetica 40pt; text-align:center; color:#333333', ap: 'q BT 0.54 0.69 0.18 rg /HelvBld 40 Tf 1 0 0 1 123 513 Tm (For Review) Tj ET Q' };
const DATE: Box = { text: '&amp;[Date]  &amp;[Time]', rect: [137, 491, 335, 508], da: '1 0 0 rg /Helv 14 Tf', ds: 'font: Helvetica 14pt; text-align:center; color:#000000', ap: 'q BT 0 0 0 rg /Helv 14 Tf 1 0 0 1 184 496 Tm (&[Date]  &[Time]) Tj ET Q' };
const ART_BOX = [110, 481, 348, 553];

test('Revu fields become ours, and unknown ones are left alone', () => {
  assert.equal(revuFields('&[Date] &[Time] &[File] &[Path] &[dd]/&[mm]/&[yyyy] &[Mystery]'), '{Date} {Time} {File} {Path} {dd}/{mm}/{yyyy} &[Mystery]');
});

test('a stamp of text boxes is read for its text, colour, size and place', async () => {
  const p = await parseStampPdf(await stampPdf([HEAD, DATE], { artBox: ART_BOX, title: 'For Review' }));
  assert.equal(p.name, 'For Review');
  assert.equal(p.hasArtwork, false);
  assert.deepEqual([p.width, p.height], [238, 72]);
  assert.deepEqual(
    p.texts.map((t) => [t.text, t.color, t.size, t.bold, t.align]),
    [
      ['For Review', '#8ab02e', 40, true, 'center'],
      ['{Date}  {Time}', '#000000', 14, false, 'center'],
    ],
  );
  // The headline is the upper one: a smaller y is nearer the top.
  assert.ok(p.texts[0]!.y < p.texts[1]!.y);
});

test('a text-only stamp becomes a stamp with its lines top to bottom and the headline colour', async () => {
  const p = await parseStampPdf(await stampPdf([DATE, HEAD], { artBox: ART_BOX }));
  const def = textStamp(p, 'id1');
  assert.deepEqual(def.lines, ['For Review', '{Date}  {Time}']);
  assert.equal(def.color, '#8ab02e');
  assert.equal(def.frame, 'none');
  assert.equal(def.art, undefined);
});

test('a stamp with a shape beside its text has artwork, and its text sits over the picture by fractions', async () => {
  const p = await parseStampPdf(await stampPdf([HEAD, DATE], { artBox: ART_BOX, square: true }));
  assert.equal(p.hasArtwork, true);
  const def = artStamp(p, 'data:image/png;base64,AAAA', 'id2');
  assert.equal(def.art!.aspect, 238 / 72);
  const [head, date] = def.art!.texts;
  assert.ok(head!.y < date!.y && head!.y >= 0);
  assert.ok(Math.abs(head!.size - 40 / 72) < 1e-9);
  assert.deepEqual(def.lines, ['For Review', '{Date}  {Time}']);
});

test('fields in a stamp are filled in when it is placed', async () => {
  const def = artStamp(await parseStampPdf(await stampPdf([HEAD, DATE], { artBox: ART_BOX, square: true })), 'data:image/png;base64,AAAA', 'id3');
  const content = resolveStamp(def, { user: 'A', file: 'f.pdf', page: '1', now: new Date(2026, 9, 5, 14, 30) });
  assert.equal(content.art!.texts[0]!.text, 'For Review');
  assert.ok(!content.art!.texts[1]!.text.includes('{'));
  assert.equal(stampAspect(content), 238 / 72);
  const dated = resolveStamp({ lines: ['{dd}/{mm}/{yyyy}'], frame: 'none' }, { user: '', file: '', page: '', now: new Date(2026, 9, 5) });
  assert.deepEqual(dated.lines, ['05/10/2026']);
});

test('rich text keeps its paragraphs and breaks, and text that looks like a tag stays text', async () => {
  const box: Box = { ...HEAD, text: '<p>One</p><p>Two &lt;b&gt;</p><br/>Three' };
  const p = await parseStampPdf(await stampPdf([box], { artBox: ART_BOX }));
  assert.deepEqual(textStamp(p, 'x').lines, ['One', 'Two <b>', 'Three']);
});

test('a PDF with nothing to use is refused', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  await assert.rejects(parseStampPdf(await doc.save()), /nothing on its page/);
});

test('an artwork stamp is saved as its picture with its text over it', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const def: StampDef = { id: 's', name: 'Seal', lines: ['{Date}'], color: '#000000', frame: 'none', art: { image: png, aspect: 2, texts: [{ text: '{Date}', x: 0.1, y: 0.4, w: 0.8, h: 0.2, size: 0.2, color: '#ff0000', bold: true, italic: false, align: 'center' }] } };
  const content = resolveStamp(def, { user: '', file: '', page: '', now: new Date(2026, 9, 5) });
  const m: Markup = { id: 'm1', type: 'stamp', pageIndex: 0, points: [[50, 50], [250, 150]], style: { ...DEFAULT_STYLES.stamp }, stamp: content, status: 'none', author: 'T', createdAt: 1, modifiedAt: 1 };
  const base = await PDFDocument.create();
  base.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await base.save()).buffer as ArrayBuffer, [m]));
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.asArray()[0]!, PDFDict);
  assert.ok(annot.lookup(PDFName.of('Rect'), PDFArray));
  const text = Buffer.from(await out.save({ useObjectStreams: false })).toString('latin1');
  assert.match(text, /\/Subtype\s*\/Image/, 'the picture is embedded');
  assert.match(text, /\/Helvetica-Bold\b/, 'and the bold font for its text');
});

// Run with REVU_SETTINGS_DIR pointing at a Revu settings folder to read every stamp it has.
const dir = process.env.REVU_SETTINGS_DIR;
test("Revu's own stamps all read", { skip: !dir }, async () => {
  const files = readdirSync(`${dir}/Stamps`).filter((f) => f.endsWith('.pdf'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const p = await parseStampPdf(readFileSync(`${dir}/Stamps/${f}`), f);
    assert.ok(p.texts.length || p.hasArtwork, f);
    assert.ok(p.width > 0 && p.height > 0, f);
  }
  const approved = await parseStampPdf(readFileSync(`${dir}/Stamps/Approved.pdf`));
  assert.deepEqual(textStamp(approved, 'a').lines, ['APPROVED']);
  const seal = await parseStampPdf(readFileSync(`${dir}/Stamps/Seal.pdf`));
  assert.equal(seal.hasArtwork, true);
});
