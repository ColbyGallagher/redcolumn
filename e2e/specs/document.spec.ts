import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';
import { pdfInfo, pdfPages, unzip } from '../support/files.ts';

// Document menu commands on fixtures/plan.pdf: three 1224 x 792 pt sheets (17 x 11 in, landscape).
//   page 1  LEVEL 1 PLAN (DOOR 1, DOOR 2)
//   page 2  DOOR SCHEDULE
//   page 3  GENERAL NOTES
// plan-rev1.pdf is the same three sheets with REVISION 1 written on the first.
const W = PLAN.page.width;
const H = PLAN.page.height;

const pageCount = async (app: App) => (await app.documents()).find((d) => d.active)?.pageCount;
const size = async (app: App, page: number) => {
  const p = await app.pageInfo(page);
  return [Math.round(p.width), Math.round(p.height)];
};
const sizes = async (app: App) => {
  const n = (await pageCount(app)) ?? 0;
  const out: number[][] = [];
  for (let i = 1; i <= n; i++) out.push(await size(app, i));
  return out;
};
/** Edited PDFs swap in asynchronously: wait for the page count, then for the sizes. */
const expectPages = async (app: App, expected: number[][]) => {
  await expect.poll(() => pageCount(app), { timeout: 20_000 }).toBe(expected.length);
  await expect.poll(() => sizes(app), { timeout: 20_000 }).toEqual(expected);
};
const goTo = (app: App, page: number) => app.page.evaluate((i) => window.__nb.viewer.goToPage(i), page - 1);

/** The PDF Save As writes, read back. */
async function saveAs(app: App) {
  const before = (await app.saved()).length;
  await app.cmd('file.saveAs');
  await expect.poll(async () => (await app.saved()).length, { timeout: 20_000 }).toBe(before + 1);
  return (await app.saved()).at(-1)!;
}

const modal = (app: App, title: string) => app.page.locator('.modal').filter({ has: app.page.locator('h3', { hasText: title }) });

/** Picks Pages › range in a page-choice fieldset (PageToolsDialog's usePageChoice). */
async function range(app: App, dialog: ReturnType<typeof modal>, pages: string) {
  await dialog.getByLabel('Page range').fill(pages);
}

const bookmarks = (app: App) =>
  app.page.evaluate(() =>
    (window.__nb.tools.store as unknown as { bookmarks(): { title: string; pageIndex: number }[] }).bookmarks().map((b) => ({ title: b.title, pageIndex: b.pageIndex })),
  );
const sheetNumbers = (app: App, count: number) =>
  app.page.evaluate((n) => {
    const sheets = (window.__nb.tools.store as unknown as { allSheets(): Record<number, { number?: string }> }).allSheets();
    return Array.from({ length: n }, (_, i) => sheets[i]?.number ?? null);
  }, count);

test.describe('document pages', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('document.rotatePages and document.rotateCounterclockwise turn the current page', async ({ app }) => {
    await app.cmd('document.rotatePages');
    // A quarter turn swaps the page's width and height; only page 1 turns.
    await expectPages(app, [[H, W], [W, H], [W, H]]);
    const turned = await saveAs(app);
    expect((await pdfPages(turned.bytes)).map((p) => p.rotation)).toEqual([90, 0, 0]);
    await app.cmd('document.rotateCounterclockwise');
    await expectPages(app, [[W, H], [W, H], [W, H]]);
    await app.cmd('document.rotateCounterclockwise');
    await expectPages(app, [[H, W], [W, H], [W, H]]);
    expect((await pdfPages((await saveAs(app)).bytes)).map((p) => p.rotation)).toEqual([270, 0, 0]);
  });

  test('document.deletePages deletes the current page', async ({ app }) => {
    await goTo(app, 2);
    await app.cmd('document.deletePages');
    await expectPages(app, [[W, H], [W, H]]);
    await expect.poll(() => app.search('DOOR SCHEDULE')).toEqual([]);
    expect(await app.search('GENERAL NOTES')).toEqual([2]);
  });

  test('document.deletePages needs two pages or more', async ({ app }) => {
    await app.cmd('document.deletePages');
    await expectPages(app, [[W, H], [W, H]]);
    // Page operations are off while one runs.
    await expect.poll(async () => (await app.command('document.deletePages')).enabled).toBe(true);
    await app.cmd('document.deletePages');
    await expectPages(app, [[W, H]]);
    expect((await app.command('document.deletePages')).enabled).toBe(false);
  });

  test('document.insertPages puts another PDF after the current page', async ({ app }) => {
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('document.insertPages');
    await (await chooser).setFiles(app.fixture('plan-rev1.pdf'));
    // 3 + 3 pages; rev 1's sheets are pages 2 to 4.
    await expectPages(app, Array.from({ length: 6 }, () => [W, H]));
    await expect.poll(() => app.search('REVISION 1')).toEqual([2]);
    expect(await app.search('DOOR SCHEDULE')).toEqual([3, 5]);
  });

  test('document.bulkInsertPages puts several PDFs after the current page', async ({ app }) => {
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('document.bulkInsertPages');
    await (await chooser).setFiles([app.fixture('plan-rev1.pdf'), app.fixture('plan-rev1.pdf')]);
    const dialog = modal(app, 'Bulk Insert PDFs');
    await dialog.locator('button[type=submit]').click();
    // 3 + 3 + 3 pages.
    await expectPages(app, Array.from({ length: 9 }, () => [W, H]));
  });

  test('document.insertBlank adds pages the size of the current one', async ({ app }) => {
    await app.cmd('document.insertBlank');
    const dialog = modal(app, 'Insert Blank Pages');
    await dialog.locator('#np-count').fill('2');
    await dialog.locator('button[type=submit]').click();
    await expectPages(app, Array.from({ length: 5 }, () => [W, H]));
    // After page 1: the schedule moves from page 2 to page 4.
    await expect.poll(() => app.search('DOOR SCHEDULE')).toEqual([4]);
  });

  test('document.insertBlank: a Letter page at the end', async ({ app }) => {
    await app.cmd('document.insertBlank');
    const dialog = modal(app, 'Insert Blank Pages');
    await dialog.locator('#np-size').selectOption('letter');
    await dialog.locator('#np-where').selectOption('end');
    await dialog.locator('button[type=submit]').click();
    // Letter portrait: 8.5 x 11 in.
    await expectPages(app, [[W, H], [W, H], [W, H], [612, 792]]);
  });

  test('document.extractPages saves the chosen pages as a new PDF', async ({ app }) => {
    await app.cmd('document.extractPages');
    const dialog = modal(app, 'Extract Pages');
    await range(app, dialog, '2-3');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(async () => (await app.saved()).length, { timeout: 20_000 }).toBe(1);
    const [file] = await app.saved();
    expect(file!.name).toBe('plan (2 pages).pdf');
    expect(await pdfPages(file!.bytes)).toEqual([
      { width: W, height: H, rotation: 0 },
      { width: W, height: H, rotation: 0 },
    ]);
    // The document keeps its pages.
    expect(await pageCount(app)).toBe(3);
  });

  test('document.extractPages: one file per page, then delete them', async ({ app }) => {
    await app.cmd('document.extractPages');
    const dialog = modal(app, 'Extract Pages');
    await range(app, dialog, '1, 3');
    await dialog.getByLabel('One file per page (downloaded as a zip)').check();
    await dialog.getByLabel('Delete the pages from this document afterwards').check();
    await dialog.locator('button[type=submit]').click();
    await expect.poll(async () => (await app.saved()).length, { timeout: 20_000 }).toBe(1);
    const [zip] = await app.saved();
    expect(zip!.name).toBe('plan (pages).zip');
    const entries = unzip(zip!.bytes);
    expect(entries.map((e) => e.name)).toEqual(['plan p1.pdf', 'plan p3.pdf']);
    for (const e of entries) expect((await pdfPages(e.data)).length).toBe(1);
    // Only the schedule is left.
    await expectPages(app, [[W, H]]);
    await expect.poll(() => app.search('DOOR SCHEDULE')).toEqual([1]);
  });

  test('document.splitDocument: one file per page by default', async ({ app }) => {
    await app.cmd('document.splitDocument');
    await modal(app, 'Split Document').locator('button[type=submit]').click();
    await expect.poll(async () => (await app.saved()).length, { timeout: 20_000 }).toBe(1);
    const [zip] = await app.saved();
    expect(zip!.name).toBe('plan (split).zip');
    const entries = unzip(zip!.bytes);
    expect(entries.map((e) => e.name)).toEqual(['plan Part-1.pdf', 'plan Part-2.pdf', 'plan Part-3.pdf']);
    for (const e of entries) expect((await pdfPages(e.data)).length).toBe(1);
    expect(await pageCount(app)).toBe(3);
  });

  test('document.replacePages puts another PDF\'s page in place of the current one', async ({ app }) => {
    await app.cmd('document.replacePages');
    const dialog = modal(app, 'Replace Pages');
    await dialog.locator('input[type=file]').setInputFiles(app.fixture('plan-rev1.pdf'));
    // Its pages default to 1-1 (as many as are being replaced).
    await expect(dialog.getByLabel('Pages of the new PDF')).toHaveValue('1-1');
    await dialog.locator('button[type=submit]').click();
    await expectPages(app, [[W, H], [W, H], [W, H]]);
    await expect.poll(() => app.search('REVISION 1')).toEqual([1]);
  });

  test('document.cropPages crops margins off the current page', async ({ app }) => {
    await app.cmd('document.cropPages');
    const dialog = modal(app, 'Crop Pages');
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) await dialog.getByLabel(side, { exact: true }).fill('1');
    await dialog.locator('button[type=submit]').click();
    // 1 in (72 pt) off each side of page 1: 1224 - 144 by 792 - 144.
    await expectPages(app, [[1080, 648], [W, H], [W, H]]);
  });

  test('document.pageSetup resizes every page to Arch D landscape', async ({ app }) => {
    await app.cmd('document.pageSetup');
    const dialog = modal(app, 'Page Setup');
    // The defaults: all pages, Arch D (24 x 36 in), landscape, content scaled to fit.
    await expect(dialog.getByLabel('Paper size')).toHaveValue('arch-d');
    await dialog.locator('button[type=submit]').click();
    await expectPages(app, [[2592, 1728], [2592, 1728], [2592, 1728]]);
  });

  test('document.headerFooter writes text on every page, and removes it again', async ({ app }) => {
    await app.cmd('document.headerFooter');
    const dialog = modal(app, 'Headers & Footers');
    await dialog.getByLabel('Footer right').fill('SHEET <<page>> OF <<pages>>');
    await dialog.getByLabel('Header left').fill('E2E HEADER');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => app.search('E2E HEADER')).toEqual([1, 2, 3]);
    expect(await app.search('SHEET 2 OF 3')).toEqual([2]);
    await app.cmd('document.headerFooter');
    await modal(app, 'Headers & Footers').getByRole('button', { name: 'Remove existing' }).click();
    await expect(modal(app, 'Headers & Footers')).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => app.search('E2E HEADER')).toEqual([]);
  });

  test('document.numberPages numbers the pages from a chosen start', async ({ app }) => {
    await app.cmd('document.numberPages');
    const dialog = modal(app, 'Number Pages');
    await expect(dialog.getByLabel('Footer right')).toHaveValue('Page <<page>> of <<pages>>');
    await dialog.getByLabel('First page no.').fill('5');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    // Numbered 5, 6, 7.
    await expect.poll(() => app.search('Page 7 of')).toEqual([3]);
    expect(await app.search('Page 5 of')).toEqual([1]);
  });

  test('document.addBookmark bookmarks the page in view; window.bookmarks shows them', async ({ app }) => {
    await app.cmd('document.addBookmark');
    await goTo(app, 3);
    await app.cmd('document.addBookmark');
    // Pages without a sheet number are titled by page.
    await expect.poll(() => bookmarks(app)).toEqual([
      { title: 'Page 1', pageIndex: 0 },
      { title: 'Page 3', pageIndex: 2 },
    ]);
    await app.cmd('window.files');
    expect((await app.command('window.bookmarks')).checked).toBe(false);
    await app.cmd('window.bookmarks');
    expect((await app.command('window.bookmarks')).checked).toBe(true);
    await expect(app.page.getByText('Page 3', { exact: true }).first()).toBeVisible();
  });

  test('document.flatten burns markups into the page; document.unflatten brings them back', async ({ app }) => {
    await app.tool('text');
    await app.drag([300, 450], [600, 520]);
    await app.page.keyboard.type('FLATTENED WORDS');
    await app.page.keyboard.press('Control+Enter');
    await expect.poll(async () => (await app.markups()).map((m) => m.text)).toEqual(['FLATTENED WORDS']);
    // A markup is not page text.
    expect(await app.search('FLATTENED')).toEqual([]);

    await app.cmd('document.flatten');
    const dialog = modal(app, 'Flatten');
    await expect(dialog).toContainText('Burns 1 markup into the page content');
    await dialog.locator('button[type=submit]').click();
    await expect(app.notice()).toHaveText(/^Flattened 1 markup; Document › Unflatten brings them back\./, { timeout: 20_000 });
    expect(await app.markups()).toEqual([]);
    await expect.poll(() => app.search('FLATTENED')).toEqual([1]);

    await app.cmd('document.unflatten');
    await expect(app.notice()).toHaveText('Recovered 1 markup.', { timeout: 20_000 });
    await expect.poll(async () => (await app.markups()).map((m) => m.text)).toEqual(['FLATTENED WORDS']);
    await expect.poll(() => app.search('FLATTENED')).toEqual([]);
  });

  test('document.reduceSize repacks the file and keeps its pages', async ({ app }) => {
    await app.cmd('document.reduceSize');
    await modal(app, 'Reduce File Size').locator('button[type=submit]').click();
    // plan.pdf is written without object streams, so packing it again makes it smaller.
    await expect(app.notice()).toHaveText(/^Reduced from [\d.]+ MB to [\d.]+ MB\./, { timeout: 20_000 });
    await expectPages(app, [[W, H], [W, H], [W, H]]);
    await expect.poll(() => app.search('DOOR SCHEDULE')).toEqual([2]);
  });

  test('document.repair writes a clean copy', async ({ app }) => {
    await app.cmd('document.repair');
    await expect(app.notice()).toHaveText(/^Repaired: the file was read and written again as a clean copy\./, { timeout: 20_000 });
    await expectPages(app, [[W, H], [W, H], [W, H]]);
    await expect.poll(() => app.search('GENERAL NOTES')).toEqual([3]);
  });

  test('document.properties shows the file and saves a new title', async ({ app }) => {
    await app.cmd('document.properties');
    const dialog = modal(app, 'Document Properties');
    await expect(dialog.getByLabel('Title')).toHaveValue('E2E plan');
    await expect(dialog.locator('dl.facts')).toContainText('Pages3');
    await expect(dialog.locator('dl.facts')).toContainText('17.00 × 11.00 in');
    await expect(dialog.locator('dl.facts')).toContainText('redcolumn e2e fixtures');
    await expect(async () => {
      await dialog.getByLabel('Title').fill('Renamed plan');
      await dialog.getByLabel('Author').fill('E2E Author');
      await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => {
        const info = await pdfInfo((await saveAs(app)).bytes);
        return [info.title, info.author];
      }, { timeout: 30_000 })
      .toEqual(['Renamed plan', 'E2E Author']);
    await app.cmd('document.properties');
    await expect(modal(app, 'Document Properties').getByLabel('Title')).toHaveValue('Renamed plan');
  });

  test('document.thumbnails opens the page thumbnails', async ({ app }) => {
    await app.cmd('window.files');
    expect((await app.command('window.pages')).checked).toBe(false);
    await app.cmd('document.thumbnails');
    expect((await app.command('window.pages')).checked).toBe(true);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

// fixtures/sheets.pdf: each sheet has a room name and a scale note in the same boxes of its title block.
test.describe('page labels and scales from regions', () => {
  const S = PLAN.sheets;
  test.beforeEach(async ({ app }) => {
    await app.open('sheets.pdf');
  });

  /** Draws a region box; the tool stays armed after the first, else + Draw box arms it. */
  const drawBox = async (app: App, box: { x: number; y: number; w: number; h: number }) => {
    const arm = app.page.locator('.label-regions').getByRole('button', { name: '+ Draw box' });
    if (await arm.isVisible()) await arm.click();
    await app.drag([box.x, box.y], [box.x + box.w, box.y + box.h]);
  };

  test('document.labelRegions labels every page from the text in a box', async ({ app }) => {
    expect(await sheetNumbers(app, 3)).toEqual([null, null, null]);
    await app.cmd('document.labelRegions');
    const panel = app.page.locator('.label-regions');
    await expect(panel).toBeVisible();
    await drawBox(app, S.labelBox);
    await expect(panel.locator('.lr-text').first()).toHaveText(S.labels[0]!);
    await panel.getByRole('button', { name: 'Apply to 3 pages' }).click();
    await expect.poll(() => sheetNumbers(app, 3)).toEqual(S.labels);
  });

  test('document.labelRegions: typed labels, numbered on', async ({ app }) => {
    await app.cmd('document.labelRegions');
    const panel = app.page.locator('.label-regions');
    await panel.getByLabel('Type it').check();
    await panel.getByRole('textbox', { name: 'Page label' }).fill('E-201');
    await expect(panel.locator('.lr-preview')).toHaveText('Pages 1-3: E-201, E-202, E-203');
    await panel.getByRole('textbox', { name: 'Page label' }).press('Enter');
    await expect.poll(() => sheetNumbers(app, 3)).toEqual(['E-201', 'E-202', 'E-203']);
  });

  test('document.scaleRegions reads each page\'s scale note', async ({ app }) => {
    for (const p of [1, 2, 3]) expect((await app.pageInfo(p)).scale).toBeUndefined();
    await app.cmd('document.scaleRegions');
    const panel = app.page.locator('.label-regions');
    await expect(panel).toBeVisible();
    await drawBox(app, S.scaleBox);
    await expect(panel.locator('.lr-text').first()).toHaveText(`SCALE: ${S.scales[0]}`);
    await panel.getByRole('button', { name: 'Apply to 3 pages' }).click();
    // The equations as the scale control writes them: feet without the 0".
    await expect.poll(async () => [(await app.pageInfo(1)).scale, (await app.pageInfo(2)).scale, (await app.pageInfo(3)).scale]).toEqual([`1/4" = 1'`, `1/8" = 1'`, `1" = 20'`]);
  });

  test('document.labelRegions joins the text of two boxes', async ({ app }) => {
    await app.cmd('document.labelRegions');
    await drawBox(app, S.labelBox);
    await drawBox(app, S.scaleBox);
    const panel = app.page.locator('.label-regions');
    await expect(panel.locator('.lr-text')).toHaveText([S.labels[0]!, `SCALE: ${S.scales[0]}`]);
    await panel.locator('select').selectOption(' - ');
    await panel.getByRole('button', { name: 'Apply to 3 pages' }).click();
    await expect.poll(() => sheetNumbers(app, 3)).toEqual(S.labels.map((l, i) => `${l} - SCALE: ${S.scales[i]}`));
  });

  // Each sheet repeats "SHEET n OF 3" at the top and its room name and scale note at the bottom.
  test('tools.bulkRedact finds the repeated header and removes it from every page', async ({ app }) => {
    expect(await app.search('SHEET')).toEqual([1, 2, 3]);
    await app.cmd('tools.bulkRedact');
    const panel = app.page.locator('.label-regions');
    await expect(panel.locator('.lr-text')).toHaveText(['Header: SHEET 1 OF 3', `Footer 1: ${S.labels[0]}`, `Footer 2: SCALE: ${S.scales[0]}`]);
    await expect(panel.locator('.lr-count')).toHaveText(['3/3', '3/3', '3/3']);
    // Keep the header only.
    await panel.getByRole('button', { name: 'Remove box' }).nth(2).click();
    await panel.getByRole('button', { name: 'Remove box' }).nth(1).click();
    await panel.getByRole('button', { name: 'Redact 3 pages' }).click();
    await expect(app.notice()).toHaveText(/^Redacted: removed .* on 3 pages\. Checked: no text is left/, { timeout: 30_000 });
    expect(await app.search('SHEET')).toEqual([]);
    expect(await app.search(S.labels[1]!)).toEqual([2]);
  });

  test('tools.bulkRedact removes a drawn box on even pages only', async ({ app }) => {
    await app.cmd('tools.bulkRedact');
    const panel = app.page.locator('.label-regions');
    await expect(panel.locator('.lr-count')).toHaveCount(3);
    for (let i = 0; i < 3; i++) await panel.getByRole('button', { name: 'Remove box' }).first().click();
    await drawBox(app, S.labelBox);
    await expect(panel.locator('.lr-text')).toHaveText([S.labels[0]!]);
    await panel.getByLabel('Even').check();
    await panel.getByRole('button', { name: 'Redact 1 page' }).click();
    await expect(app.notice()).toHaveText(/^Redacted: removed .* on 1 page\./, { timeout: 30_000 });
    expect(await app.search('ROOM')).toEqual([1, 3]);
  });

  test.describe('from the ribbon', () => {
    test.use({ toolbar: 'ribbon' });

    test('tools.bulkRedact on the Bulk tab covers the boxes', async ({ app }) => {
      const ribbon = app.page.locator('.ribbon');
      await ribbon.getByRole('tab', { name: 'Bulk' }).click();
      await ribbon.locator('[data-ribbon-command="tools.bulkRedact"]').click();
      const panel = app.page.locator('.label-regions');
      await expect(panel.locator('.lr-count')).toHaveCount(3);
      await panel.getByLabel('Cover with').check();
      await panel.getByRole('button', { name: 'Redact 3 pages' }).click();
      await expect(app.notice()).toHaveText(/^Redacted: removed .* on 3 pages\./, { timeout: 30_000 });
      expect(await app.search('ROOM')).toEqual([]);
      expect(await app.search('SCALE')).toEqual([]);
    });
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
