import { expect, test, type App } from '../support/app.ts';
import { unzip } from '../support/files.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// Takeoff › Reports: a catalog item and an assembly on a 20 ft x 10 ft room, then the reports as
// CSV, Excel and PDF.

const ribbon = (app: App) => app.page.locator('.ribbon');
const dialog = (app: App) => app.page.getByRole('dialog', { name: 'Takeoff Reports' });

const r = PLAN.room;
const room: Pt[] = [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
  [r.x, r.y],
];

/** Opens the dialog with only the named reports ticked, and the given file type. */
async function choose(app: App, reports: RegExp[], format: RegExp) {
  await app.cmd('takeoff.reports');
  const d = dialog(app);
  await expect(d).toBeVisible();
  for (const box of await d.getByRole('checkbox').all()) await box.uncheck();
  for (const name of reports) await d.getByRole('checkbox', { name }).check();
  await d.getByRole('radio', { name: format }).check();
  return d;
}

test.describe('takeoff reports', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
    // Drywall at 15 each with 10% waste, rounded up; an assembly of 1 sheet per 32 sf.
    await app.page.evaluate(() => {
      const store = (window.__nb.tools as unknown as { store: { setEstimating(e: unknown): void; setAssemblies(a: unknown[]): void } }).store;
      store.setEstimating({ items: [{ id: 'dw', name: 'Drywall sheet', itemNo: 'DW-1', category: 'material', unit: 'sheets', unitCost: 15, waste: 10, roundUp: true }] });
      store.setAssemblies([{ id: 'lined', name: 'Lined wall', variables: [], items: [{ id: 'i1', itemId: 'dw', name: '', unit: '', formula: '[Area] / 32' }] }]);
    });
    await app.tool('area');
    await app.clicks(room);
    const [area] = await app.markups();
    await app.page.keyboard.press('Escape');
    await app.page.evaluate((id) => window.__nb.tools.select([id]), area!.id);
    await app.panel('Measurements');
    await app.page.getByLabel('Assembly', { exact: true }).selectOption({ label: 'Lined wall' });
    await expect.poll(async () => (await app.raw())[0]!.assemblyId).toBe('lined');
  });

  test('takeoff.reports: the Output group has Reports, and CSV holds the item quantities', async ({ app }) => {
    await ribbon(app).getByRole('tab', { name: 'Takeoff' }).click();
    await expect(ribbon(app).locator('[data-ribbon-command="takeoff.reports"]')).toBeVisible();

    const d = await choose(app, [/^Quantity Summary by Item/], /^CSV/);
    await d.getByRole('button', { name: 'Export' }).click();
    await expect(d).toBeHidden();
    await expect.poll(async () => (await app.saved()).length).toBe(1);
    const [file] = await app.saved();
    expect(file!.name).toBe('plan - Quantity Summary by Item.csv');
    const text = file!.bytes.toString('utf8').replace(/^﻿/, '');
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Group,Item No,Description,Category,Unit,Net Qty,Waste %,Gross Qty,Order Qty,Unit Cost,Extended Cost');
    // 200 sf / 32 = 6.25 sheets, +10% = 6.875, ordered as 7 at 15.
    expect(lines[1]).toBe('Material,DW-1,Drywall sheet,Material,sheets,6.25,10,6.875,7,15,105');
    expect(lines[2]).toBe(',,Total,,,,,,,,105');
  });

  test('Excel: one workbook with a sheet per report; PDF: a document', async ({ app }) => {
    let d = await choose(app, [/^Quantity Summary by Item/, /^Measurement Detail/], /^Excel/);
    await d.getByRole('button', { name: 'Export' }).click();
    await expect(d).toBeHidden();
    await expect.poll(async () => (await app.saved()).length).toBe(1);
    const xlsx = (await app.saved())[0]!;
    expect(xlsx.name).toBe('plan - Takeoff Reports.xlsx');
    expect(xlsx.bytes.subarray(0, 2).toString()).toBe('PK');
    const parts = new Map(unzip(xlsx.bytes).map((e) => [e.name, Buffer.from(e.data).toString('utf8')]));
    expect(parts.get('xl/workbook.xml')).toContain('name="Quantity Summary by Item"');
    expect(parts.get('xl/workbook.xml')).toContain('name="Measurement Detail"');
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('<v>105</v>');

    d = await choose(app, [/^Quantity Summary by Item/, /^Count Schedule/], /^PDF/);
    await d.getByLabel('Paper size').selectOption('letter');
    await d.getByRole('button', { name: 'Export' }).click();
    await expect(d).toBeHidden();
    await expect.poll(async () => (await app.saved()).length).toBe(2);
    const pdf = (await app.saved())[1]!;
    expect(pdf.name).toBe('plan - Takeoff Reports.pdf');
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.bytes.length).toBeGreaterThan(1000);
  });

  test('several CSV reports come as a zip', async ({ app }) => {
    const d = await choose(app, [/^Quantity Summary by Item/, /^Measurement Detail/], /^CSV/);
    await d.getByRole('button', { name: 'Export' }).click();
    await expect.poll(async () => (await app.saved()).length).toBe(1);
    const zip = (await app.saved())[0]!;
    expect(zip.name).toBe('plan - Takeoff Reports.zip');
    expect(unzip(zip.bytes).map((e) => e.name)).toEqual(['plan - Quantity Summary by Item.csv', 'plan - Measurement Detail.csv']);
  });
});
