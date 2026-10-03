import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { DEFAULT_STAMPS, resolveStamp, stampAspect, stampLayout } from './stamp.ts';

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
