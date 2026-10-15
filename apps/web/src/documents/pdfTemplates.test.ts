import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { BUILTIN_TEMPLATES } from './builtinTemplates.ts';
import { buildTemplate } from './pdfTemplates.ts';
import { readForm } from './forms.ts';

test('every built-in template builds at its own size', async () => {
  for (const t of BUILTIN_TEMPLATES) {
    const doc = await PDFDocument.load(await buildTemplate(t.id));
    assert.equal(doc.getPageCount(), 1, t.id);
    const { width, height } = doc.getPage(0).getSize();
    assert.ok(Math.abs(width - t.width) < 0.01 && Math.abs(height - t.height) < 0.01, t.id);
  }
});

test('the A3 drawing sheet is landscape with a fillable title block', async () => {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === 'sheet-a3-landscape')!;
  assert.ok(t.width > t.height);
  const { fields } = await readForm(await buildTemplate(t.id));
  const by = new Map(fields.map((f) => [f.name, f]));
  for (const name of ['Company', 'Client', 'Project', 'Title', 'DrawingNumber', 'Revision', 'Scale', 'Rev1Description']) assert.equal(by.get(name)?.type, 'text', name);
  assert.equal(by.get('SheetSize')!.value, 'A3');
  assert.equal(by.get('Sheet')!.value, '1 OF 1');
  // The title block sits in the bottom-right corner, inside the 10 mm border.
  const title = by.get('DrawingNumber')!.widgets[0]!.rect;
  assert.ok(title.x > t.width / 2 && title.y > t.height * 0.8);
  assert.ok(title.x + title.w < t.width - 10 * (72 / 25.4));
});

test('several pages each get their own title block fields', async () => {
  const bytes = await buildTemplate('sheet-a3-landscape', 3);
  const { fields } = await readForm(bytes);
  const sheets = fields.filter((f) => f.name.startsWith('Sheet_')).map((f) => [f.name, f.value, f.widgets[0]!.pageIndex]);
  assert.deepEqual(sheets.sort(), [
    ['Sheet_1', '1 OF 3', 0],
    ['Sheet_2', '2 OF 3', 1],
    ['Sheet_3', '3 OF 3', 2],
  ]);
});

test('unknown templates are refused', async () => {
  await assert.rejects(buildTemplate('nope'));
});
