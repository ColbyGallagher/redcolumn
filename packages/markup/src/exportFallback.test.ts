import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, type StandardFonts } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';

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

async function usesFallback(text: string, extra: Partial<Markup> = {}): Promise<boolean> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  let used = 0;
  const fallbackFont = (d: PDFDocument, name: StandardFonts) => {
    used++;
    return d.embedFont(name);
  };
  await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [{ ...box(text), ...extra }], { fallbackFont });
  return used > 0;
}

test('the fallback font is used only for text the standard fonts cannot show', async () => {
  assert.equal(await usesFallback('Plain text, caf\u00e9 \u00b1 5mm, \u201cquotes\u201d \u2013 dashes \u2026'), false);
  assert.equal(await usesFallback('\u0391\u03b8\u03ae\u03bd\u03b1'), true, 'Greek');
  assert.equal(await usesFallback('\u041c\u043e\u0441\u043a\u0432\u0430'), true, 'Cyrillic');
  assert.equal(await usesFallback('x', { type: 'stamp', stamp: { lines: ['\u2713 OK'], frame: 'box' } }), true, 'a stamp line');
  assert.equal(await usesFallback('x', { type: 'table', table: { cols: [1], rows: [1], cells: [['\u2265 5']] } }), true, 'a table cell');
});
