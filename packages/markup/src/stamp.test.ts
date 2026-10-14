import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { DEFAULT_STAMPS, fillStampFieldsNow, refillStamp, resolveStamp, setStampField, stampAspect, stampFieldValues, stampFormColor, stampLayout } from './stamp.ts';

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
