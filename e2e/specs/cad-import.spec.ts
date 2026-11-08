// DWG/DXF drawings open as vector PDFs (issue #230): converted in a worker, with a report over the
// document and Convert Again. The drawings are the converter's own fixtures (apps/web/test/fixtures/cad).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '../support/app.ts';
import type { App } from '../support/app.ts';

const CAD = resolve(import.meta.dirname, '../../apps/web/test/fixtures/cad');
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Opens a drawing through the Open file input and waits for its PDF to be the active document. */
async function openDrawing(app: App, relative: string) {
  const file = resolve(CAD, relative);
  await app.page.locator('input[type=file][accept*=".dwg"][multiple]').first().setInputFiles(file);
  const pdfName = relative.replace(/^.*\//, '').replace(/\.(dwg|dxf)$/i, '.pdf');
  await expect
    .poll(async () => (await app.documents().catch(() => [])).find((d) => d.active && d.name === pdfName)?.pageCount ?? 0, { message: `${relative} did not open`, timeout: 60_000 })
    .toBeGreaterThan(0);
  return file;
}

interface ViewportInfo {
  name: string;
  page: number;
  scale: string;
}

test('a DWG opens as a PDF with its layouts as pages and its viewport scales', async ({ app }) => {
  const file = await openDrawing(app, 'dwg/kestrel-plan.R2018.dwg');
  const before = sha(file);
  const [doc] = (await app.documents()).filter((d) => d.active);
  expect(doc).toMatchObject({ name: 'kestrel-plan.R2018.pdf', pageCount: 2 });
  // A1 then A3, in points.
  expect(await app.pageInfo(1)).toMatchObject({ width: expect.closeTo(2383.94, 0), height: expect.closeTo(1683.78, 0) });
  expect(await app.pageInfo(2)).toMatchObject({ width: expect.closeTo(1190.55, 0), height: expect.closeTo(841.89, 0) });
  // The viewer reads the PDF's viewports just after it opens.
  await expect
    .poll(async () => (await app.assistant<{ viewports: ViewportInfo[] }>('list_viewports')).viewports.map((v) => [v.page, v.scale]), { timeout: 15_000 })
    .toEqual([
      [1, '1 mm = 500 mm'],
      [1, '1 mm = 2000 mm'],
      [2, '1 mm = 100 mm'],
    ]);
  await expect(app.page.locator('.cad-report')).toContainText('Converted from kestrel-plan.R2018.dwg: 2 pages');

  // Save writes a new PDF; the drawing is never written.
  await app.cmd('file.save');
  await expect.poll(async () => (await app.saved()).map((f) => f.name), { timeout: 30_000 }).toContain('kestrel-plan.R2018.pdf');
  expect(sha(file)).toBe(before);
  expect(app.errors).toEqual([]);
});

test('a DXF with a missing reference reports it, and Convert Again draws a supplied one', async ({ app }) => {
  await openDrawing(app, 'missing-refs.dxf');
  const report = app.page.locator('.cad-report');
  await report.getByRole('button', { name: 'Details' }).click();
  await expect(report).toContainText('Reference survey-base.dwg was not found');

  await app.cmd('document.convertDrawingAgain');
  const dialog = app.page.locator('.cad-convert-dialog');
  await expect(dialog).toContainText('Not found: survey-base.dwg');
  // Any drawing will do as the reference, under the reference's file name.
  await dialog.locator('input[type=file]').setInputFiles({ name: 'survey-base.dxf', mimeType: 'image/vnd.dxf', buffer: readFileSync(resolve(CAD, 'blocks.dxf')) });
  await expect(dialog.locator('.cad-ref-list')).toContainText('survey-base.dxf');
  await dialog.getByRole('button', { name: 'Convert' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  // The new PDF is active and its report no longer mentions the reference.
  const docs = await app.documents();
  expect(docs.filter((d) => d.name === 'missing-refs.pdf')).toHaveLength(2);
  await app.page.locator('.cad-report').getByRole('button', { name: 'Details' }).click();
  await expect(app.page.locator('.cad-report')).not.toContainText('was not found');
  expect(app.errors).toEqual([]);
});

test('Convert Again with one layout makes a one-page PDF', async ({ app }) => {
  await openDrawing(app, 'kestrel-plan.dxf');
  await app.page.locator('.cad-report').getByRole('button', { name: 'Convert Again…' }).click();
  const dialog = app.page.locator('.cad-convert-dialog');
  await dialog.getByLabel('C-101 PLAN').uncheck();
  await dialog.getByRole('button', { name: 'Convert' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  const active = (await app.documents()).find((d) => d.active)!;
  expect(active).toMatchObject({ name: 'kestrel-plan.pdf', pageCount: 1 });
  expect(app.errors).toEqual([]);
});

test('a drawing that does not say its units asks for them, and Convert Again keeps the choice', async ({ app }) => {
  // No header at all: $INSUNITS is unset. Lines at survey grid coordinates suggest metres.
  const lines = Array.from({ length: 12 }, (_, k) => ['0', 'LINE', '8', '0', '10', `${500000 + k * 10}`, '20', '6000000', '11', `${500005 + k * 10}`, '21', '6000010']).flat();
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', ...lines, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
  await app.page.locator('input[type=file][accept*=".dwg"][multiple]').first().setInputFiles({ name: 'site.dxf', mimeType: 'image/vnd.dxf', buffer: Buffer.from(dxf) });
  const ask = app.page.getByRole('dialog', { name: 'Drawing Units' });
  await expect(ask).toContainText('site.dxf does not say what units it is drawn in', { timeout: 30_000 });
  await expect(ask.getByRole('radio', { name: /^Metres/ })).toBeChecked();
  await ask.getByRole('radio', { name: /^Feet/ }).check();
  await ask.getByRole('button', { name: 'Convert' }).click();
  await expect.poll(async () => (await app.documents().catch(() => [])).find((d) => d.active && d.name === 'site.pdf')?.pageCount ?? 0, { timeout: 60_000 }).toBe(1);
  // Units chosen: nothing left to warn about, so the report has no details to show.
  await expect(app.page.locator('.cad-report')).toContainText('Converted from site.dxf');
  await expect(app.page.locator('.cad-report').getByRole('button', { name: 'Details' })).toHaveCount(0);

  await app.cmd('document.convertDrawingAgain');
  const dialog = app.page.locator('.cad-convert-dialog');
  await expect(dialog.getByLabel('Drawing units')).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(app.errors).toEqual([]);
});

test('a file that is not a drawing fails with a clear message', async ({ app }) => {
  await app.page.locator('input[type=file][accept*=".dwg"][multiple]').first().setInputFiles({ name: 'broken.dwg', mimeType: 'image/vnd.dwg', buffer: Buffer.from('AC1032 this is not really a drawing') });
  await expect(app.page.locator('.error')).toContainText('damaged', { timeout: 30_000 });
});
