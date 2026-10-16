import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';
import { pdfPages, unzip } from '../support/files.ts';

// Each Bulk command (Document › Bulk) run on two library files, plan.pdf and plan-rev1.pdf: three
// 1224 x 792 pt sheets each, both open.
const W = PLAN.page.width;
const H = PLAN.page.height;
const FILES = ['plan-rev1.pdf', 'plan.pdf'];

type Result = { name: string; ok: boolean; message: string };

const dialog = (app: App) => app.page.locator('.batch-dialog');

/** Runs Bulk command `id` (batch.*) on every library file, after `setup` sets its options; returns each file's result by name. */
async function bulk(app: App, id: string, setup?: () => Promise<void>): Promise<Result[]> {
  await app.cmd(id);
  const d = dialog(app);
  await expect(d).toBeVisible();
  await d.getByLabel('Choose the files of a set or group').selectOption('all:');
  await setup?.();
  await d.locator('button[type=submit]').click();
  await expect(d.locator('p').first()).toHaveText(/^Done: /, { timeout: 60_000 });
  const rows = d.locator('.batch-results li');
  const out: Result[] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    out.push({ name: (await row.locator('.batch-file').textContent())!, ok: (await row.getAttribute('class')) === 'ok', message: (await row.locator('.print-hint').textContent())! });
  }
  await d.getByRole('button', { name: 'Close' }).click();
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The same result for both files. */
const both = (message: string | RegExp) => FILES.map((name) => ({ name, ok: true, message: typeof message === 'string' ? message : expect.stringMatching(message) }));

const sizes = async (app: App, document: string) => {
  const out: number[][] = [];
  for (const page of [1, 2, 3]) {
    const p = await app.assistant<{ width: number; height: number }>('get_page', { document, page });
    out.push([Math.round(p.width), Math.round(p.height)]);
  }
  return out;
};

const markupsOf = async (app: App, document: string) => (await app.assistant<{ markups: { type: string; page: number; points: [number, number][] }[] }>('list_markups', { document })).markups;

test.describe('bulk commands', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf', 'plan-rev1.pdf');
  });

  test('need a file in the library', async ({ app }) => {
    expect((await app.command('batch.flatten')).enabled).toBe(true);
  });

  test('batch.flatten and batch.unflatten', async ({ app }) => {
    // A markup on plan-rev1.pdf only (the active document).
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    expect(await bulk(app, 'batch.flatten')).toEqual([
      { name: 'plan-rev1.pdf', ok: true, message: 'Flattened 1 markup; Document › Unflatten brings them back.' },
      { name: 'plan.pdf', ok: true, message: 'No markups to flatten' },
    ]);
    await expect.poll(() => markupsOf(app, 'plan-rev1.pdf')).toEqual([]);
    expect(await bulk(app, 'batch.unflatten')).toEqual([
      { name: 'plan-rev1.pdf', ok: true, message: 'Recovered 1 markup.' },
      { name: 'plan.pdf', ok: true, message: 'This file has no flattened markups to recover.' },
    ]);
    await expect.poll(async () => (await markupsOf(app, 'plan-rev1.pdf')).map((m) => m.type)).toEqual(['rect']);
  });

  test('batch.reduce', async ({ app }) => {
    expect(await bulk(app, 'batch.reduce')).toEqual(both(/^Reduced from [\d.]+ MB to [\d.]+ MB\.$/));
  });

  test('batch.repair', async ({ app }) => {
    expect(await bulk(app, 'batch.repair')).toEqual(both('Repaired: the file was read and written again as a clean copy.'));
    expect(await sizes(app, 'plan.pdf')).toEqual([[W, H], [W, H], [W, H]]);
  });

  test('batch.colour', async ({ app }) => {
    expect(await bulk(app, 'batch.colour')).toEqual(both('Changed the colours of 3 pages.'));
  });

  test('batch.ocr skips pages that have text', async ({ app }) => {
    expect(await bulk(app, 'batch.ocr')).toEqual(both('Every page already has text'));
  });

  test('batch.headerFooter and batch.removeHeaderFooter', async ({ app }) => {
    expect(await bulk(app, 'batch.removeHeaderFooter')).toEqual(both('No headers or footers added here'));
    const results = await bulk(app, 'batch.headerFooter', async () => {
      await dialog(app).getByRole('button', { name: 'Set up…' }).click();
      const hf = app.page.locator('.modal.header-footer');
      await hf.getByLabel('Header left').fill('BULK HEADER');
      await hf.getByLabel('Footer right').fill('');
      await hf.locator('button[type=submit]').click();
      await expect(dialog(app).locator('.print-hint').last()).toBeVisible();
    });
    expect(results).toEqual(both('3 pages'));
    await expect.poll(() => app.search('BULK HEADER')).toEqual([1, 2, 3]);
    expect(await bulk(app, 'batch.removeHeaderFooter')).toEqual(both('Headers and footers removed'));
    await expect.poll(() => app.search('BULK HEADER')).toEqual([]);
  });

  test('batch.stamp puts a stamp at the top right of the first page', async ({ app }) => {
    let name = '';
    const results = await bulk(app, 'batch.stamp', async () => {
      name = (await dialog(app).locator('label', { hasText: /^Stamp/ }).locator('select option:checked').textContent())!;
    });
    expect(results).toEqual(both(`${name} on 1 page`));
    // 180 pt wide, 36 pt in from the top and right edges: x 1224 - 36 - 180 = 1008 to 1188.
    for (const doc of FILES) {
      const [m, ...rest] = await markupsOf(app, doc);
      expect(rest).toEqual([]);
      expect(m).toMatchObject({ type: 'stamp', page: 1 });
      const xs = m!.points.map(([x]) => Math.round(x));
      const ys = m!.points.map(([, y]) => Math.round(y));
      expect([Math.min(...xs), Math.max(...xs), Math.min(...ys)]).toEqual([1008, 1188, 36]);
    }
  });

  test('batch.crop crops half an inch off every side', async ({ app }) => {
    expect(await bulk(app, 'batch.crop')).toEqual(both('3 pages cropped'));
    // 36 pt off each side.
    for (const doc of FILES) await expect.poll(() => sizes(app, doc)).toEqual([[W - 72, H - 72], [W - 72, H - 72], [W - 72, H - 72]]);
  });

  test('batch.pageSetup resizes to Arch D, landscape pages staying landscape', async ({ app }) => {
    const results = await bulk(app, 'batch.pageSetup', async () => {
      await dialog(app).locator('label', { hasText: 'Paper' }).locator('select').selectOption('arch-d');
    });
    expect(results).toEqual(both('3 pages resized'));
    // Arch D is 24 x 36 in.
    for (const doc of FILES) await expect.poll(() => sizes(app, doc)).toEqual([[2592, 1728], [2592, 1728], [2592, 1728]]);
  });

  test('batch.split zips every part of every file', async ({ app }) => {
    expect(await bulk(app, 'batch.split')).toEqual(both('3 parts'));
    const zip = (await app.saved()).at(-1)!;
    expect(zip.name).toBe('Split files.zip');
    const entries = unzip(zip.bytes);
    expect(entries.map((e) => e.name).sort()).toEqual(['plan Part-1.pdf', 'plan Part-2.pdf', 'plan Part-3.pdf'].flatMap((p) => [`plan/${p}`, `plan-rev1/${p.replace('plan', 'plan-rev1')}`]).sort());
    for (const e of entries) expect(await pdfPages(e.data)).toEqual([{ width: W, height: H, rotation: 0 }]);
  });

  test('batch.sign signs both files with one Digital ID', async ({ app }) => {
    await app.cmd('tools.digitalIds');
    const ids = app.page.locator('.modal.digital-ids');
    await ids.getByLabel('Name').fill('E2E Signer');
    await ids.getByLabel('Password').fill('e2e-password');
    await ids.getByLabel('Again').fill('e2e-password');
    await ids.getByRole('button', { name: 'Create' }).click();
    await expect(ids.locator('.id-list li')).toHaveCount(1, { timeout: 30_000 });
    await ids.getByRole('button', { name: 'Close' }).click();
    const results = await bulk(app, 'batch.sign', async () => {
      await dialog(app).locator('input[type=password]').fill('e2e-password');
    });
    expect(results).toEqual(both('Signed'));
    await app.cmd('window.signatures');
    await expect(app.page.locator('.dsig-list .dsig b')).toHaveText(['E2E Signer'], { timeout: 30_000 });
  });

  test('batch.link finds no references between these files', async ({ app }) => {
    expect(await bulk(app, 'batch.link')).toEqual(both('No references to the other files'));
  });

  test('batch.print prints both files as one job', async ({ app }) => {
    expect(await bulk(app, 'batch.print')).toEqual(both('3 pages'));
    await expect.poll(() => app.printed(), { timeout: 30_000 }).toEqual([{ pages: 6 }]);
  });

  test('batch.summary exports the markups of the files', async ({ app }) => {
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    await app.cmd('batch.summary');
    const summary = app.page.locator('.modal').filter({ has: app.page.locator('h3', { hasText: 'Markup Summary' }) });
    await expect(summary).toBeVisible();
    await summary.getByRole('tab', { name: 'Output' }).click();
    await summary.getByLabel('Export as').selectOption({ label: 'CSV' });
    await summary.getByLabel('File name').fill('E2E summary');
    await summary.getByRole('button', { name: 'OK' }).click();
    await expect.poll(async () => (await app.saved()).map((f) => f.name), { timeout: 30_000 }).toEqual(['E2E summary.csv']);
    const csv = (await app.saved())[0]!.bytes.toString('utf8');
    expect(csv).toContain('Rectangle');
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

test('batch.pageLabels writes sheet numbers found in title blocks', async ({ app }) => {
  // stitch.pdf's title blocks carry C-101 to C-103; plan.pdf has no sheet numbers.
  await app.open('plan.pdf', 'stitch.pdf');
  const results = await bulk(app, 'batch.pageLabels');
  expect(results).toEqual([
    { name: 'plan.pdf', ok: true, message: 'No sheet numbers found' },
    { name: 'stitch.pdf', ok: true, message: `3 of 3 pages labelled (${PLAN.stitch.sheets.map((s) => s.number).join(', ')})` },
  ]);
  expect(app.errors).toEqual([]);
});
