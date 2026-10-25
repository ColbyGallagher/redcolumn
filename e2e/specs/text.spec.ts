import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

const editor = (app: App) => app.page.locator('textarea.text-editor');

/** Draws a text box and leaves its editor open. */
async function textBox(app: App) {
  await app.tool('text');
  await app.drag([300, 450], [600, 600]);
  await expect(editor(app)).toBeVisible();
}

async function commit(app: App) {
  await app.page.keyboard.press('Control+Enter');
  await expect(editor(app)).toHaveCount(0);
}

const textOf = async (app: App) => (await app.markups())[0]!.text;

test.describe('text markups', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('typing, then editing again by double-click', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('FIRST DRAFT');
    await commit(app);
    expect(await textOf(app)).toBe('FIRST DRAFT');
    const c = await app.at([450, 525]);
    await app.page.mouse.dblclick(c.x, c.y);
    await expect(editor(app)).toHaveValue('FIRST DRAFT');
    await app.page.keyboard.press('Control+A');
    await app.page.keyboard.type('SECOND DRAFT');
    await commit(app);
    expect(await textOf(app)).toBe('SECOND DRAFT');
  });

  test('Escape cancels an edit', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('KEEP');
    await commit(app);
    const c = await app.at([450, 525]);
    await app.page.mouse.dblclick(c.x, c.y);
    await app.page.keyboard.type(' AND MORE');
    await app.page.keyboard.press('Escape');
    await expect(editor(app)).toHaveCount(0);
    expect(await textOf(app)).toBe('KEEP');
  });

  test('Enter makes a new line', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('LINE ONE');
    await app.page.keyboard.press('Enter');
    await app.page.keyboard.type('LINE TWO');
    await commit(app);
    expect(await textOf(app)).toBe('LINE ONE\nLINE TWO');
  });

  test('"- " starts a bulleted list that Enter continues', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('- FIRST');
    await app.page.keyboard.press('Enter');
    await app.page.keyboard.type('SECOND');
    await commit(app);
    expect(await textOf(app)).toBe('• FIRST\n• SECOND');
  });

  test('numbered list from the list bar, Tab nests', async ({ app }) => {
    await textBox(app);
    await app.page.locator('.text-editor-bar button[aria-label^="Numbered list"]').click();
    await app.page.keyboard.type('ONE');
    await app.page.keyboard.press('Enter');
    await app.page.keyboard.type('TWO');
    await app.page.keyboard.press('Enter');
    await app.page.keyboard.press('Tab');
    await app.page.keyboard.type('NESTED');
    await commit(app);
    // Nested levels are indented four spaces, and a numbered list's style follows its level
    // (1., a., i.), as in Word. Plain text, so Bluebeam keeps it.
    expect(await textOf(app)).toBe('1. ONE\n2. TWO\n    a. NESTED');
  });

  test('checklist', async ({ app }) => {
    await textBox(app);
    await app.page.locator('.text-editor-bar button[aria-label^="Checklist"]').click();
    await app.page.keyboard.type('CHECK SIZES');
    await commit(app);
    expect(await textOf(app)).toBe('[ ] CHECK SIZES');
  });

  test('auto-size shrinks a text box to its text', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('HI');
    await commit(app);
    const [m] = await app.markups();
    await app.page.evaluate((id) => window.__nb.tools.select([id]), m!.id);
    await app.cmd('edit.autoSize');
    const [after] = await app.markups();
    const w = (p: [number, number][]) => Math.abs(p[1]![0] - p[0]![0]);
    const h = (p: [number, number][]) => Math.abs(p[1]![1] - p[0]![1]);
    // It started 300 x 150 pt; two letters need far less.
    expect(w(after!.points)).toBeLessThan(100);
    expect(h(after!.points)).toBeLessThan(60);
    // It keeps its top-left corner.
    expect(after!.points[0]![0]).toBeCloseTo(300, 1);
    expect(after!.points[0]![1]).toBeCloseTo(450, 1);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

test.describe('PDF text', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('view.nextPage');
    await app.fit();
  });

  test('Edit Text replaces words in the PDF itself', async ({ app }) => {
    await app.cmd('edit.editText');
    expect((await app.toolState()).tool).toBe('editText');
    // "DOOR 3   GLASS" on page 2, baseline y 140.
    await app.clicks([[90, 136]]);
    const dialog = app.page.locator('.modal').filter({ hasText: 'Edit text' });
    const input = dialog.locator('input, textarea').first();
    await expect(input).toHaveValue(/DOOR 3/);
    await input.fill('DOOR 3   TIMBER');
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await expect(dialog).toBeHidden();
    // The PDF's text changed: search finds the new word and not the old one.
    await app.cmd('edit.find');
    const search = app.page.locator('.search-bar input[placeholder="Search text"]');
    // The edited PDF is swapped in in the background: search again until it has.
    await expect(async () => {
      await search.fill('TIMBER');
      await search.press('Enter');
      await expect(app.page.locator('.search-hit')).toHaveCount(1, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await search.fill('GLASS');
    await search.press('Enter');
    await expect(app.page.locator('.search .empty')).toHaveText(/No matches\./);
    expect(await app.markups()).toEqual([]);
    // Everything else on the document is untouched.
    expect((await app.documents())[0]!.pageCount).toBe(PLAN.pageCount);
  });

  // "DOOR 1   HOLLOW CORE" is 146 pt wide in 12 pt Helvetica, so it ends at x 206. (Ending the
  // drag much further right, at x 215, selects nothing.)
  const selectDoor = async (app: App) => {
    await app.cmd('edit.selectText');
    expect((await app.toolState()).tool).toBe('selectText');
    await app.drag([58, 95], [210, 95]);
    const bar = app.page.getByRole('toolbar', { name: 'Selected text' });
    await expect(bar).toBeVisible();
    return bar;
  };

  test('Select Text highlights words without adding a markup, and Copy copies them', async ({ app }) => {
    const bar = await selectDoor(app);
    await expect(bar.locator('.text-selection-count')).toHaveText(/^\d+ characters?$/);
    expect(await app.markups()).toEqual([]);
    await bar.getByRole('button', { name: 'Copy' }).click();
    await expect(app.page.getByText(/^Copied \d+ characters?\.$/)).toBeVisible();
    if (app.kind === 'web') expect(await app.page.evaluate(() => navigator.clipboard.readText())).toMatch(/DOOR 1\s+HOLLOW CORE/);
    // Esc lets the words go, still without a markup.
    await app.page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    expect(await app.markups()).toEqual([]);
  });

  for (const [button, type] of [
    ['Highlight', 'textHighlight'],
    ['Underline', 'underline'],
    ['Strikethrough', 'strikeout'],
    ['Squiggly', 'squiggly'],
  ] as const) {
    test(`Select Text: ${button} on the selection bar marks the selected words`, async ({ app }) => {
      const bar = await selectDoor(app);
      await bar.getByRole('button', { name: button, exact: true }).click();
      await expect(bar).toBeHidden();
      const [m, ...rest] = await app.markups();
      expect(rest).toEqual([]);
      expect(m).toMatchObject({ type, page: 2 });
      // It covers the words selected: from the "D" just right of x 58 to past "CORE" at x 206.
      const xs = m!.points.map(([x]) => x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(57);
      expect(Math.max(...xs)).toBeGreaterThan(200);
    });
  }

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
