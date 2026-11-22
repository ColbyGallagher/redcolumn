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

/**
 * A stamp with form fields, as other PDF tools write dynamic stamps: text fields whose scripts fill
 * in the user, the date or a typed answer, a list to pick from, and a tick box.
 */
async function formStampPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 100]);
  page.node.set(PDFName.of('ArtBox'), doc.context.obj([0, 0, 300, 100]));
  const js = (src: string) => ({ C: { S: 'JavaScript', JS: PDFString.of(src) } });
  const widget = (rect: number[], extra: Record<string, unknown>) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: rect, DA: PDFString.of('/HeBo 12 Tf 0 0 1 rg'), Q: 1, ...extra }));
  // One field with two widgets: both show its value.
  const parent = doc.context.register(doc.context.obj({ FT: 'Tx', T: PDFString.of('Checker'), AA: js('if (event.source.forReal) event.value = app.response({ cQuestion: "Checked by:", cTitle: "Stamp", cDefault: "J. Smith" });') }));
  const annots = [
    doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [10, 70, 100, 90], DA: PDFString.of('0 0 0 rg /Helv 12 Tf'), Contents: PDFString.of('Checked by'), DS: PDFString.of('font: Helvetica 12pt; text-align:left') })),
    widget([110, 70, 290, 90], { Parent: parent }),
    widget([110, 5, 290, 20], { Parent: parent }),
    widget([10, 40, 140, 60], { FT: 'Tx', T: PDFString.of('Date'), AA: js('event.value = util.printd("dd mmm yyyy", new Date());') }),
    widget([150, 40, 290, 60], { FT: 'Tx', T: PDFString.of('Who'), AA: js('event.value = identity.name;') }),
    widget([10, 22, 140, 38], { FT: 'Ch', Ff: 1 << 17, T: PDFString.of('St'), TU: PDFString.of('Status?'), Opt: [PDFString.of('Open'), [PDFString.of('c'), PDFString.of('Closed')]], V: PDFString.of('Open') }),
    widget([150, 22, 170, 38], { FT: 'Btn', T: PDFString.of('Urgent') }),
  ];
  page.node.set(PDFName.of('Annots'), doc.context.obj(annots));
  return doc.save();
}

test('a stamp’s form fields become its own fields, or {User} and {Date} where their scripts fill those in', async () => {
  const p = await parseStampPdf(await formStampPdf(), 'Checked');
  assert.deepEqual(
    p.texts.map((t) => t.text),
    ['Checked by', '{Checked by}', '{Checked by}', '{Date}', '{User}', '{Status}'],
  );
  assert.deepEqual(p.fields, [
    { id: 'Checker', label: 'Checked by', kind: 'text', value: 'J. Smith' },
    { id: 'St', label: 'Status', kind: 'text', value: 'Open', choices: ['Open', 'Closed'] },
  ]);
  const field = p.texts[1]!;
  assert.deepEqual([field.x, field.y, field.w, field.h, field.size, field.color, field.bold, field.align], [110, 10, 180, 20, 12, '#0000ff', true, 'center']);
  // The tick box is left in the picture.
  assert.equal(p.hasArtwork, true);
});

test('a stamp with form fields places as a picture stamp asking for them, with each where it was', async () => {
  const p = await parseStampPdf(await formStampPdf(), 'Checked');
  const def = artStamp(p, 'data:image/png;base64,AAAA', 'f1');
  assert.equal(def.fields!.length, 2);
  const c = resolveStamp(def, { user: 'Jane Doe', file: 'f.pdf', page: '1', now: new Date(2026, 9, 5) }, { Checker: 'A. Smith', St: 'Closed' });
  assert.deepEqual(c.art!.texts.map((t) => t.text).slice(0, 3), ['Checked by', 'A. Smith', 'A. Smith']);
  assert.ok(c.art!.texts.some((t) => t.text === 'Jane Doe'));
  assert.ok(c.art!.texts.some((t) => t.text === 'Closed'));
  // As text alone, a label and the field beside it are one line.
  assert.equal(textStamp(p, 't1').lines[0], 'Checked by {Checked by}');
});

/** A one-page stamp PDF whose annotations are the given dicts (built by `make`). */
async function widgetsPdf(make: (doc: PDFDocument) => unknown[], page: [number, number] = [300, 100]) {
  const doc = await PDFDocument.create();
  const p = doc.addPage(page);
  p.node.set(PDFName.of('ArtBox'), doc.context.obj([0, 0, page[0], page[1]]));
  p.node.set(PDFName.of('Annots'), doc.context.obj(make(doc).map((a) => doc.context.register(doc.context.obj(a as Record<string, never>)))));
  return doc.save();
}
const tx = (rect: number[], extra: Record<string, unknown>) => ({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', Rect: rect, DA: PDFString.of('/Helv 10 Tf 0 g'), ...extra });

test('a field named like a dynamic field keeps its own value under another name', async () => {
  const p = await parseStampPdf(await widgetsPdf(() => [tx([10, 60, 290, 90], { T: PDFString.of('Date'), V: PDFString.of('15/03/2025') })]));
  assert.deepEqual(p.fields, [{ id: 'Date', label: 'Date 2', kind: 'text', value: '15/03/2025' }]);
  assert.deepEqual(p.texts.map((t) => t.text), ['{Date 2}']);
  const def = textStamp(p, 'd');
  const c = resolveStamp(def, { user: 'A', file: 'f.pdf', page: '1', now: new Date(2026, 9, 5) });
  assert.deepEqual(c.lines, ['15/03/2025'], 'its value, not today, and no extra "Date:" line');
});

test('a widget that cannot be read stays part of the picture instead of failing the import', async () => {
  const p = await parseStampPdf(await widgetsPdf(() => [tx([10, 60, 290, 90], { T: PDFString.of('Odd'), Parent: 5 }), tx([10, 10, 290, 40], { T: PDFString.of('Fine') })]));
  // The malformed /Parent is ignored, so this field still reads.
  assert.deepEqual(p.fields.map((f) => f.label), ['Odd', 'Fine']);
  const broken = await parseStampPdf(await widgetsPdf((doc) => [tx([10, 60, 290, 90], { T: PDFString.of('Bad'), AA: { C: { S: 'JavaScript', JS: doc.context.register(doc.context.obj({ Filter: 'FlateDecode' })) } } })]));
  assert.ok(broken);
});

test('a hidden field is not a field, and is left out of the picture', async () => {
  const p = await parseStampPdf(await widgetsPdf(() => [tx([10, 60, 290, 90], { T: PDFString.of('Secret'), F: 2 }), tx([10, 30, 290, 55], { T: PDFString.of('Off screen'), F: 32 }), tx([10, 5, 290, 25], { T: PDFString.of('Shown'), F: 4 })]));
  assert.deepEqual(p.fields.map((f) => f.label), ['Shown']);
  assert.deepEqual(p.hidden, [0, 1]);
});

test('a list’s [export, shown] pairs give the shown text, and a list you can type in stays editable', async () => {
  const p = await parseStampPdf(
    await widgetsPdf(() => [
      { ...tx([10, 60, 290, 90], { T: PDFString.of('St'), V: PDFString.of('c'), DV: PDFString.of('o') }), FT: 'Ch', Ff: 1 << 17, Opt: [[PDFString.of('o'), PDFString.of('Open')], [PDFString.of('c'), PDFString.of('Closed')]] },
      { ...tx([10, 10, 290, 40], { T: PDFString.of('Who') }), FT: 'Ch', Ff: (1 << 17) | (1 << 18), Opt: [PDFString.of('Ann'), PDFString.of('Bo')] },
    ]),
  );
  assert.deepEqual(p.fields, [
    { id: 'St', label: 'St', kind: 'text', value: 'Closed', choices: ['Open', 'Closed'] },
    { id: 'Who', label: 'Who', kind: 'text', value: '', choices: ['Ann', 'Bo'], editable: true },
  ]);
});

test('script strings with \\u and \\x escapes are read', async () => {
  const p = await parseStampPdf(await widgetsPdf(() => [tx([10, 60, 290, 90], { T: PDFString.of('Q'), AA: { C: { S: 'JavaScript', JS: PDFString.of('event.value = app.response("Gepr\\\\u00fcft von\\\\x3a");') } } })]));
  assert.equal(p.fields[0]!.label, 'Geprüft von');
});

test('long labels and appearance strings are read quickly', async () => {
  const spaces = ' '.repeat(200_000);
  const started = Date.now();
  const p = await parseStampPdf(await widgetsPdf(() => [tx([10, 60, 290, 90], { T: PDFString.of('x'), TU: PDFString.of(`a${spaces}b${spaces}:`), DA: PDFString.of(`/${'F'.repeat(100_000)}${spaces}`) })]));
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(p.fields.length, 1);
  assert.ok(p.fields[0]!.label.length <= 256);
});

test('a field shared down a deep chain of parents with very long strings is read quickly', async () => {
  const long = 'x'.repeat(60_000);
  const bytes = await widgetsPdf((doc) => {
      // 15 parents deep, each with long /T, /TU and /DA; 250 widgets share the chain.
      let parent: unknown = undefined;
      for (let i = 0; i < 15; i++) parent = doc.context.register(doc.context.obj({ FT: 'Tx', T: PDFString.of(long), TU: PDFString.of(long), DA: PDFString.of(long), V: PDFString.of(long), ...(parent ? { Parent: parent } : {}) } as unknown as Record<string, never>));
      return Array.from({ length: 250 }, (_, i) => ({ Type: 'Annot', Subtype: 'Widget', Rect: [(i % 25) * 10, Math.floor(i / 25) * 9, (i % 25) * 10 + 9, Math.floor(i / 25) * 9 + 8], T: PDFString.of(`w${i}`), Parent: parent }));
  });
  const started = Date.now();
  const p = await parseStampPdf(bytes);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  assert.equal(p.fields.length, 200, 'at most 200 widgets are read as fields');
  assert.ok(p.fields.every((f) => f.label.length <= 256 && (f.value ?? '').length <= 256));
});

test('labels and fields on one level make one line, in order: By [who] on [when]', async () => {
  const label = (text: string, rect: number[]) => ({ Type: 'Annot', Subtype: 'FreeText', Rect: rect, DA: PDFString.of('/Helv 10 Tf 0 g'), Contents: PDFString.of(text) });
  const p = await parseStampPdf(
    await widgetsPdf(() => [label('By', [10, 40, 30, 55]), tx([35, 40, 120, 55], { T: PDFString.of('Who') }), label('on', [125, 40, 145, 55]), tx([150, 40, 290, 55], { T: PDFString.of('When') }), label('CHECKED', [10, 70, 290, 95])]),
  );
  assert.deepEqual(textStamp(p, 'x').lines, ['CHECKED', 'By {Who} on {When}']);
});

test('a text box that is hidden or not shown is left out', async () => {
  const label = (text: string, f: number) => ({ Type: 'Annot', Subtype: 'FreeText', Rect: [10, 40, 290, 60], F: f, DA: PDFString.of('/Helv 10 Tf 0 g'), Contents: PDFString.of(text) });
  const p = await parseStampPdf(await widgetsPdf(() => [label('Shown', 4), label('Hidden', 2), label('Off screen', 32)]));
  assert.deepEqual(p.texts.map((t) => t.text), ['Shown']);
  assert.deepEqual(p.hidden, [1, 2]);
});

test('thousands of text boxes are read quickly', async () => {
  const bytes = await widgetsPdf(() => Array.from({ length: 20_000 }, (_, i) => ({ Type: 'Annot', Subtype: 'FreeText', Rect: [i % 100, i % 90, (i % 100) + 5, (i % 90) + 5], Contents: PDFString.of('t') })));
  // Loading the file itself (pdf-lib) takes what it takes: what is timed is the reading after it.
  let started = Date.now();
  await PDFDocument.load(bytes);
  const load = Date.now() - started;
  started = Date.now();
  const p = await parseStampPdf(bytes);
  const parse = Date.now() - started;
  assert.ok(parse - load < 1500, `took ${parse} ms, ${load} ms of it loading`);
  started = Date.now();
  textStamp(p, 'x');
  assert.ok(Date.now() - started < 500, `lines took ${Date.now() - started} ms`);
  assert.equal(p.texts.length, 2000);
});

test('a tall headline beside a small date stays two lines; only a field joins the label beside it', async () => {
  const head: Box = { ...HEAD, rect: [10, 40, 200, 90], text: 'APPROVED' };
  const date: Box = { ...DATE, rect: [210, 55, 330, 70], text: '&amp;[Date]' };
  const p = await parseStampPdf(await stampPdf([head, date], { artBox: [0, 0, 340, 100] }));
  assert.deepEqual(textStamp(p, 'x').lines, ['APPROVED', '{Date}']);
});

// Run with REVU_SETTINGS_DIR pointing at a Revu settings folder to read every stamp it has.
const dir = process.env.REVU_SETTINGS_DIR;
test("Revu's own stamps all read", { skip: dir ? false : 'REVU_SETTINGS_DIR is not set' }, async () => {
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
