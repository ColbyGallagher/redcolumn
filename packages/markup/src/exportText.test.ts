import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';

async function appearanceText(m: Markup): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [m]));
  return out.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') ? [Buffer.from(decodePDFRawStream(o).decode()).toString('latin1')] : []))
    .join('\n');
}

const box = (text: string): Markup => ({
  id: 't1',
  type: 'text',
  pageIndex: 0,
  points: [[20, 20], [220, 120]],
  style: { ...DEFAULT_STYLES.text },
  text,
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
});

// Hex-encoded Tj strings in an appearance stream, decoded.
const shown = (stream: string): string[] => [...stream.matchAll(/<([0-9A-F]+)> Tj/g)].map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'));

test('a text box with line breaks is drawn as separate lines, not one line with question marks', async () => {
  const lines = shown(await appearanceText(box('first\nsecond\n\nfourth')));
  assert.deepEqual(lines.filter((l) => l.trim()), ['first', 'second', 'fourth']);
  assert.ok(lines.every((l) => !l.includes('?')));
});

test('CRLF and CR breaks are line breaks too, and a tab becomes spaces', async () => {
  const lines = shown(await appearanceText(box('a\r\nb\rc\td')));
  assert.deepEqual(lines, ['a', 'b', 'c    d']);
});
