import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { DEFAULT_STAMPS, fillStampFieldsNow, formStamp, isDynamicFieldName, refillStamp, removeFieldToken, renameFieldToken, resolveStamp, setStampField, stampAspect, stampFieldValues, stampFormColor, stampLayout } from './stamp.ts';

const values = { user: 'Jane Doe', file: 'A-101.pdf', page: 'A-101', now: new Date(2026, 0, 2, 9, 30) };

test('dynamic fields fill in when a stamp is placed; empty lines drop', () => {
  const c = resolveStamp({ lines: ['CHECKED', 'By {User} on {Date}', '{File} sheet {page}', ''], frame: 'box' }, values);
  assert.deepEqual(c.lines, ['CHECKED', `By Jane Doe on ${values.now.toLocaleDateString()}`, 'A-101.pdf sheet A-101']);
  assert.equal(c.frame, 'box');
});

test('stamp lettering fits inside its box, centred, headline largest', () => {
  const c = resolveStamp(DEFAULT_STAMPS.find((s) => s.name === 'Approved')!, values);
  const box = { x: 100, y: 50, w: 200, h: 200 / stampAspect(c) };
  const measure = (s: string, bold: boolean) => s.length * (bold ? 0.62 : 0.55);
  const lines = stampLayout(box, c, measure);
  assert.equal(lines.length, 2);
  assert.ok(lines[0]!.size > lines[1]!.size && lines[0]!.bold);
  for (const l of lines) {
    const w = measure(l.text, l.bold) * l.size;
    assert.ok(l.x - w / 2 >= box.x - 1e-6 && l.x + w / 2 <= box.x + box.w + 1e-6, 'fits the width');
    assert.ok(l.y - l.size / 2 >= box.y - 1e-6 && l.y + l.size / 2 <= box.y + box.h + 1e-6, 'fits the height');
  }
});

test('stamps export as PDF stamp annotations carrying their wording', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const stamp = resolveStamp(DEFAULT_STAMPS[0]!, values);
  const m: Markup = { id: 's', type: 'stamp', pageIndex: 0, points: [[20, 20], [200, 80]], style: DEFAULT_STYLES.stamp, stamp, status: 'none', author: 'Jane', createdAt: 1, modifiedAt: 1 };
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [m]));
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.equal(annot.get(PDFName.of('Subtype'))?.toString(), '/Stamp');
  assert.equal(annot.get(PDFName.of('Name'))?.toString(), '/APPROVED');
  assert.match(annot.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText(), /^APPROVED\nBy Jane Doe/);
});

const review = DEFAULT_STAMPS.find((s) => s.id === 'builtin-submittal-review')!;

test('ticking a box ticks only that one, fills in the fields it sets, and recolours the stamp', () => {
  const fields = review.fields!;
  let vals = stampFieldValues(fields);
  vals = setStampField(fields, vals, 'action', 'Revise and Resubmit');
  assert.equal(vals.action, 'Revise and Resubmit');
  assert.equal(vals.resubmit, 'Required');
  assert.equal(stampFormColor(fields, vals, review.color), '#b45309');
  vals = setStampField(fields, vals, 'action', 'No Exceptions Taken');
  assert.equal(vals.resubmit, 'Not required');
  assert.equal(stampFormColor(fields, vals, review.color), '#15803d');
  // Ticking the ticked box again unticks it; the colour goes back to the stamp's own.
  vals = setStampField(fields, vals, 'action', 'No Exceptions Taken');
  assert.equal(vals.action, '');
  assert.equal(stampFormColor(fields, vals, review.color), review.color);
});

test('a stamp with fields lists its boxes and blanks under the wording', () => {
  const vals = setStampField(review.fields!, stampFieldValues(review.fields!), 'action', 'Rejected');
  const c = resolveStamp(review, values, vals);
  assert.deepEqual(c.lines, ['SUBMITTAL REVIEW', 'No Exceptions Taken', 'Make Corrections Noted', 'Revise and Resubmit', 'Rejected', 'Resubmittal: Required', 'Reviewed by: Jane Doe', `Reviewed on: ${values.now.toLocaleDateString()}`]);
  assert.deepEqual(c.kinds, ['line', 'box', 'box', 'box', 'ticked', 'field', 'field', 'field']);
  assert.equal(c.form?.values.action, 'Rejected');
});

test('a field used in the wording is filled in there and not listed again', () => {
  const def = { lines: ['{Action}', 'By {User}'], frame: 'rounded' as const, fields: [{ id: 'a', label: 'Action', kind: 'choice' as const, options: [{ label: 'APPROVED' }, { label: 'REJECTED' }], value: 'REJECTED' }] };
  const c = resolveStamp(def, values);
  assert.deepEqual(c.lines, ['REJECTED', 'By Jane Doe']);
  assert.deepEqual(c.kinds, ['line', 'line']);
});

test('a placed stamp can be filled in again, keeping when and by whom it was placed', () => {
  const c = resolveStamp(review, values);
  const later = refillStamp(c, setStampField(review.fields!, c.form!.values, 'action', 'Make Corrections Noted'))!;
  assert.equal(later.color, '#15803d');
  assert.ok(later.stamp.lines.includes('Reviewed by: Jane Doe'));
  assert.ok(later.stamp.lines.includes(`Reviewed on: ${values.now.toLocaleDateString()}`));
  assert.equal(later.stamp.kinds![2], 'ticked');
  assert.equal(refillStamp(resolveStamp(DEFAULT_STAMPS[0]!, values), {}), null);
});

test('boxes and fields fit inside the stamp, left-aligned together', () => {
  const c = resolveStamp(review, values, setStampField(review.fields!, stampFieldValues(review.fields!), 'action', 'Rejected'));
  const box = { x: 10, y: 20, w: 200, h: 200 / stampAspect(c) };
  const measure = (s: string, bold: boolean) => s.length * (bold ? 0.62 : 0.55);
  const lines = stampLayout(box, c, measure);
  const left = lines.filter((l) => l.align === 'left');
  assert.equal(left.length, 7);
  assert.equal(lines.filter((l) => l.box?.ticked).length, 1);
  const starts = new Set(left.map((l) => (l.box ? l.box.x : l.x).toFixed(6)));
  assert.equal(starts.size, 1, 'one left edge');
  for (const l of left) {
    assert.ok(l.x + measure(l.text, false) * l.size <= box.x + box.w + 1e-6, 'fits the width');
    assert.ok(l.y + l.size / 2 <= box.y + box.h + 1e-6 && l.y - l.size / 2 >= box.y - 1e-6, 'fits the height');
  }
});

test('stamps with fields export their tick boxes', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const stamp = resolveStamp(review, values, { action: 'Rejected' });
  const m: Markup = { id: 's', type: 'stamp', pageIndex: 0, points: [[20, 20], [220, 180]], style: DEFAULT_STYLES.stamp, stamp, status: 'none', author: 'Jane', createdAt: 1, modifiedAt: 1 };
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [m]));
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.match(annot.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText(), /Rejected\nResubmittal/);
});

test('before placing, a text field shows its user and date filled in, its file and page still to come', () => {
  const fields = [{ id: 't', label: 'By', kind: 'text' as const, value: '{User} {Date} {File} {Page}' }];
  const out = fillStampFieldsNow(fields, stampFieldValues(fields), 'Jane Doe', values.now);
  assert.equal(out.t, `Jane Doe ${values.now.toLocaleDateString()} {File} {Page}`);
});

/** A picture stamp with fields placed on it as {Checked by} and {Status}, and the date. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const checkedArt = {
  lines: ['Checked by {Checked by}', '{Status}', '{Date}'],
  frame: 'none' as const,
  color: '#1d4ed8',
  art: {
    image: PNG,
    aspect: 2,
    texts: [
      { text: 'Checked by {Checked by}', x: 0.05, y: 0.1, w: 0.9, h: 0.25, size: 0.18, color: '#000000', bold: true, italic: false, align: 'left' as const },
      { text: '{Status}', x: 0.05, y: 0.4, w: 0.9, h: 0.25, size: 0.18, color: '#b91c1c', bold: false, italic: false, align: 'center' as const },
      { text: '{Date}', x: 0.05, y: 0.7, w: 0.9, h: 0.25, size: 0.14, color: '#000000', bold: false, italic: false, align: 'right' as const },
    ],
  },
  fields: [
    { id: 'by', label: 'Checked by', kind: 'text' as const, value: '{User}' },
    { id: 'status', label: 'Status', kind: 'text' as const, value: 'For review', choices: ['For review', 'Approved', 'Rejected'] },
  ],
};

test('a picture stamp fills its fields in where its texts name them, and keeps what is needed to fill them in again', () => {
  const c = resolveStamp(checkedArt, values, { status: 'Approved' });
  assert.deepEqual(
    c.art!.texts.map((t) => t.text),
    ['Checked by Jane Doe', 'Approved', values.now.toLocaleDateString()],
  );
  assert.equal(c.art!.image, PNG);
  assert.equal(c.form!.values.status, 'Approved');
  assert.equal(c.form!.artTexts![0]!.text, 'Checked by {Checked by}');
  assert.deepEqual(c.form!.fields[1]!.choices, ['For review', 'Approved', 'Rejected']);
  // Positions stay as they were drawn.
  assert.deepEqual(c.art!.texts.map((t) => t.y), [0.1, 0.4, 0.7]);
  // An emptied field drops its text; the others stay.
  const blank = resolveStamp(checkedArt, values, { status: '' });
  assert.deepEqual(blank.art!.texts.map((t) => t.text), ['Checked by Jane Doe', values.now.toLocaleDateString()]);
});

test('a placed picture stamp is filled in again with its picture, places and placing date kept', () => {
  const c = resolveStamp(checkedArt, values);
  const later = refillStamp(c, { ...c.form!.values, status: 'Rejected', by: 'A. Smith' })!;
  assert.deepEqual(later.stamp.art!.texts.map((t) => t.text), ['Checked by A. Smith', 'Rejected', values.now.toLocaleDateString()]);
  assert.equal(later.stamp.art!.image, PNG);
  assert.equal(later.stamp.art!.aspect, 2);
  assert.equal(later.stamp.form!.artTexts!.length, 3, 'still fillable again');
  const def = formStamp(c)!;
  assert.equal(def.art!.texts[1]!.text, '{Status}');
  assert.equal(formStamp(resolveStamp(DEFAULT_STAMPS[0]!, values)), null);
});

test('renaming a field renames its {Label} in the wording, whatever its case', () => {
  assert.equal(renameFieldToken('By {checked BY} on {Date}', 'Checked by', 'Reviewer'), 'By {Reviewer} on {Date}');
  assert.equal(renameFieldToken('{A.b}', 'A.b', 'C'), '{C}');
  assert.equal(renameFieldToken('{Axb}', 'A.b', 'C'), '{Axb}', 'the name is matched as text, not a pattern');
});

test('a picture stamp with fields saves its filled-in text in its appearance and comes back with its fields', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const stamp = resolveStamp(checkedArt, values, { status: 'Approved' });
  const m: Markup = { id: 's1', type: 'stamp', pageIndex: 0, points: [[20, 20], [220, 120]], style: DEFAULT_STYLES.stamp, stamp, subject: 'Checked', status: 'none', author: 'Jane', createdAt: 1, modifiedAt: 1 };
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]);
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPage(0).node.Annots()!.size(), 1, 'one annotation: no form fields of its own');
  assert.equal(out.catalog.get(PDFName.of('AcroForm')), undefined);
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.equal(annot.get(PDFName.of('Subtype'))?.toString(), '/Stamp');
  // Other viewers draw its appearance: the text in it is the filled-in text.
  const ap = out.context.lookup(annot.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as PDFRawStream;
  const ops = new TextDecoder('latin1').decode(decodePDFRawStream(ap).decode());
  const shown = [...ops.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((x) => Buffer.from(x[1]!, 'hex').toString('latin1'));
  assert.deepEqual(shown, ['Checked by Jane Doe', 'Approved', values.now.toLocaleDateString()]);
  assert.match(annot.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText(), /^Checked by Jane Doe\nApproved/);

  // Our own data comes back as it was: fields, values and the texts to fill in again.
  const appData = annot.lookup(PDFName.of('NBData'), PDFString, PDFHexString).decodeText();
  const found: ImportableAnnotation[] = [{ index: 0, subtype: 'Stamp', rect: { x: 20, y: 280, w: 200, h: 100 }, color: null, interior: null, opacity: 1, borderWidth: 1, contents: '', author: 'Jane', intent: '', cloudy: false, da: '', appData, flags: 4, vertices: [], ink: [], line: null, link: null }];
  const [back] = importAnnotations(0, found, undefined, await readPdfExtras(bytes)).markups;
  assert.deepEqual(back!.stamp!.form, stamp.form);
  const again = refillStamp(back!.stamp!, { ...back!.stamp!.form!.values, status: 'Rejected' })!;
  assert.equal(again.stamp.art!.texts[1]!.text, 'Rejected');
});

test('a field named like a dynamic field is its own value, not the dynamic one, and is not listed again', () => {
  const field = { id: 'd', label: 'Date', kind: 'text' as const, value: '15/03/2025' };
  const text = resolveStamp({ lines: ['ISSUED', 'On {Date}'], frame: 'box', fields: [field] }, values);
  assert.deepEqual(text.lines, ['ISSUED', 'On 15/03/2025']);
  const art = resolveStamp({ ...checkedArt, fields: [field], art: { ...checkedArt.art, texts: [{ ...checkedArt.art.texts[2]!, text: '{date}' }] } }, values);
  assert.deepEqual(art.art!.texts.map((t) => t.text), ['15/03/2025']);
  // A value is not read for names again: a typed "{Status}" stays as typed.
  const two = resolveStamp({ lines: ['{A} {B}'], frame: 'box', fields: [{ id: 'a', label: 'A', kind: 'text', value: '{B}' }, { id: 'b', label: 'B', kind: 'text', value: 'x' }] }, values);
  assert.deepEqual(two.lines, ['{B} x']);
  assert.ok(isDynamicFieldName(' date ') && isDynamicFieldName('YYYY') && !isDynamicFieldName('Date 2'));
});

test('removing a field takes its {Label} out of the wording, closing up the spaces', () => {
  assert.equal(removeFieldToken('Checked by {Checked by} today', 'checked by'), 'Checked by today');
  assert.equal(removeFieldToken('{Status}', 'Status'), '');
  assert.equal(removeFieldToken('{Other}  spaced', 'Status'), '{Other}  spaced', 'left alone when not used');
});

test('a text field with choices is filled in like any other, and its choices are kept', () => {
  const def = { lines: ['CHECKED', 'Status: {Status}'], frame: 'box' as const, fields: [{ id: 's', label: 'Status', kind: 'text' as const, value: 'Open', choices: ['Open', 'Closed'] }] };
  const c = resolveStamp(def, values, { s: 'Closed' });
  assert.deepEqual(c.lines, ['CHECKED', 'Status: Closed']);
  assert.deepEqual(c.form!.fields[0]!.choices, ['Open', 'Closed']);
});
