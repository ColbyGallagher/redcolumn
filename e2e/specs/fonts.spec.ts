import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { expect, test, type App } from '../support/app.ts';

// The font picker for text markups, and installed fonts embedded into saved PDFs. The browser's Local
// Font Access API is stubbed in the page with a Liberation Serif font served by the app, standing in
// for an installed one ("E2E Serif"), so the spec does not depend on the machine's fonts or on a
// permission prompt. The desktop app lists the machine's real fonts, so those parts run on the web build only.
test.skip(({ app }) => app.kind !== 'web', 'the stubbed Local Font Access API is a browser feature');

const editor = (app: App) => app.page.locator('textarea.text-editor');
const picker = (app: App) => app.page.locator('.font-picker-button').first();
const options = (app: App) => app.page.locator('.font-picker-pop [role="option"]');

type Store = { all(): { id: string; type: string; style: { fontFamily?: string } }[] };
const textMarkup = (app: App) => app.page.evaluate(() => (window.__nb.tools.store as unknown as Store).all().find((m) => m.type === 'text')?.style.fontFamily ?? null);

/** A text box with some words, left selected. */
async function selectedTextBox(app: App) {
  await app.tool('text');
  await app.drag([300, 450], [600, 600]);
  await expect(editor(app)).toBeVisible();
  await app.page.keyboard.type('Fonts');
  await app.page.keyboard.press('Control+Enter');
  await expect(editor(app)).toHaveCount(0);
  await app.page.evaluate(() => window.__nb.tools.select((window.__nb.tools.store as unknown as Store).all().filter((m) => m.type === 'text').map((m) => m.id)));
  await expect(picker(app)).toBeVisible();
}

/** Makes this page behave as Chrome with one installed font. */
async function installFakeFont(app: App) {
  await app.page.evaluate(() => {
    const font = { family: 'E2E Serif', style: 'Regular', postscriptName: 'E2ESerif-Regular', blob: async () => (await fetch('/fonts/LiberationSerif-Regular.ttf')).blob() };
    (window as unknown as { queryLocalFonts: () => Promise<unknown[]> }).queryLocalFonts = async () => [font];
  });
}

test.describe('font picker', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('lists the standard fonts, filters by typing, and sets the standard font', async ({ app }) => {
    await selectedTextBox(app);
    await picker(app).click();
    await expect(options(app)).toHaveText(['Helvetica / Arial', 'Times New Roman', 'Courier New']);
    await app.page.getByLabel('Filter fonts').fill('cour');
    await expect(options(app)).toHaveText(['Courier New']);
    await app.page.keyboard.press('Enter');
    await expect(options(app)).toHaveCount(0);
    expect(await textMarkup(app)).toBe('mono');
    await expect(picker(app)).toContainText('Courier New');
  });

  test('a browser that cannot list fonts says so and keeps working', async ({ app }) => {
    await selectedTextBox(app);
    await app.page.evaluate(() => delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts);
    await picker(app).click();
    await expect(app.page.getByText('This browser can’t list installed fonts')).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Show installed fonts…' })).toHaveCount(0);
    await app.page.keyboard.press('Escape');
    expect(app.errors).toEqual([]);
  });

  test('a declined permission leaves the standard fonts and no error', async ({ app }) => {
    await selectedTextBox(app);
    await app.page.evaluate(() => {
      (window as unknown as { queryLocalFonts: () => Promise<unknown[]> }).queryLocalFonts = async () => {
        throw new DOMException('denied', 'NotAllowedError');
      };
    });
    await picker(app).click();
    await app.page.getByRole('button', { name: 'Show installed fonts…' }).click();
    await expect(options(app)).toHaveCount(3);
    expect(app.errors).toEqual([]);
  });

  test('an installed font is chosen, remembered, and embedded in the saved PDF', async ({ app }) => {
    await selectedTextBox(app);
    await installFakeFont(app);
    await picker(app).click();
    await app.page.getByRole('button', { name: 'Show installed fonts…' }).click();
    await expect(options(app).filter({ hasText: 'E2E Serif' })).toHaveCount(1);
    await options(app).filter({ hasText: 'E2E Serif' }).click();
    expect(await textMarkup(app)).toBe('E2E Serif');
    await expect(picker(app)).toContainText('E2E Serif');

    // Next time it is listed under Recent (and not again under Installed).
    await picker(app).click();
    await expect(app.page.locator('.font-picker-group')).toHaveText(['Standard', 'Recent']);
    await app.page.keyboard.press('Escape');

    const before = (await app.saved()).length;
    await app.cmd('file.saveAs');
    await expect.poll(async () => (await app.saved()).length, { timeout: 30_000 }).toBe(before + 1);
    // The file's font descriptors, read back: one carries an embedded TrueType file.
    const doc = await PDFDocument.load((await app.saved()).at(-1)!.bytes);
    const embedded = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.has(PDFName.of('FontFile2')));
    expect(embedded.length).toBeGreaterThan(0);
  });

  test('a font that cannot be embedded is replaced on export, with a notice saying why', async ({ app }) => {
    await selectedTextBox(app);
    await app.page.evaluate(() => {
      const font = { family: 'E2E Locked', style: 'Regular', postscriptName: 'E2ELocked-Regular', blob: async () => new Blob([new Uint8Array(64)]) };
      (window as unknown as { queryLocalFonts: () => Promise<unknown[]> }).queryLocalFonts = async () => [font];
    });
    await picker(app).click();
    await app.page.getByRole('button', { name: 'Show installed fonts…' }).click();
    await options(app).filter({ hasText: 'E2E Locked' }).click();
    expect(await textMarkup(app)).toBe('E2E Locked');
    await app.cmd('file.saveAs');
    await expect(app.page.getByText(/E2E Locked .*so Helvetica was used in the PDF\./)).toBeVisible({ timeout: 30_000 });
    expect(await app.saved()).toHaveLength(1);
  });

  test('a document that uses a font this machine lacks says so once', async ({ app }) => {
    await selectedTextBox(app);
    await app.page.evaluate(() => {
      const store = window.__nb.tools.store as unknown as Store & { update(id: string, patch: object): void };
      const m = store.all().find((x) => x.type === 'text')!;
      store.update(m.id, { style: { ...m.style, fontFamily: 'Nonexistent Face 9000' } });
    });
    await expect(app.page.getByText('This document uses fonts not installed here: Nonexistent Face 9000.')).toBeVisible({ timeout: 10_000 });
  });
});
