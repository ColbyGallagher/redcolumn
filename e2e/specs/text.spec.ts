import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

const editor = (app: App) => app.page.locator('div.text-editor');

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
    await expect(editor(app)).toHaveText('FIRST DRAFT');
    await app.page.keyboard.press('Control+A');
    await app.page.keyboard.type('SECOND DRAFT');
    await commit(app);
    expect(await textOf(app)).toBe('SECOND DRAFT');
  });

  test('Ctrl+B, Ctrl+I and Ctrl+U style the text being typed', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('STYLED');
    await app.page.keyboard.press('Control+B');
    await app.page.keyboard.press('Control+I');
    await app.page.keyboard.press('Control+U');
    await commit(app);
    const style = (await app.raw())[0]!.style as { bold?: boolean; italic?: boolean; underline?: boolean };
    expect(style.bold).toBe(true);
    expect(style.italic).toBe(true);
    expect(style.underline).toBe(true);
    expect(await textOf(app)).toBe('STYLED');
  });

  /** Types "plain bold plain" and selects "bold". */
  async function selectMiddleWord(app: App) {
    await textBox(app);
    await app.page.keyboard.type('plain bold plain');
    await app.page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await app.page.keyboard.press('ArrowRight');
    for (let i = 0; i < 4; i++) await app.page.keyboard.press('Shift+ArrowRight');
  }

  test('Ctrl+B on selected words bolds only those words', async ({ app }) => {
    await selectMiddleWord(app);
    await app.page.keyboard.press('Control+B');
    await commit(app);
    const m = (await app.raw())[0]! as { text: string; spans?: unknown; style: { bold?: boolean } };
    expect(m.text).toBe('plain bold plain');
    expect(m.style.bold).toBeFalsy();
    expect(m.spans).toEqual([{ start: 6, end: 10, style: { bold: true } }]);
  });

  test('italic, underline and strikethrough on selected words, from the bar', async ({ app }) => {
    await selectMiddleWord(app);
    await app.page.keyboard.press('Control+I');
    await app.page.keyboard.press('Control+U');
    await app.page.locator('.text-editor-bar button[aria-label^="Strikethrough"]').click();
    await commit(app);
    const m = (await app.raw())[0]! as { spans?: unknown };
    expect(m.spans).toEqual([{ start: 6, end: 10, style: { italic: true, underline: true, strikethrough: true } }]);
  });

  test('a colour from the bar applies to the selected words', async ({ app }) => {
    await selectMiddleWord(app);
    await app.page.locator('.text-editor-bar button[aria-label="Text colour #d92d20"]').click();
    await commit(app);
    const m = (await app.raw())[0]! as { spans?: unknown; style: { textColor?: string } };
    expect(m.spans).toEqual([{ start: 6, end: 10, style: { color: '#d92d20' } }]);
    expect(m.style.textColor).toBeUndefined();
  });

  test('with all the text selected, Ctrl+B bolds the whole markup as before', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('everything');
    await app.page.keyboard.press('Control+A');
    await app.page.keyboard.press('Control+B');
    await commit(app);
    const m = (await app.raw())[0]! as { spans?: unknown; style: { bold?: boolean } };
    expect(m.style.bold).toBe(true);
    expect(m.spans).toBeUndefined();
  });

  test('Ctrl+Z undoes the styling, then Ctrl+Y brings it back', async ({ app }) => {
    await selectMiddleWord(app);
    await app.page.keyboard.press('Control+B');
    await expect(editor(app).locator('span[data-b="1"]')).toHaveText('bold');
    await app.page.keyboard.press('Control+Z');
    await expect(editor(app).locator('span[data-b="1"]')).toHaveCount(0);
    await app.page.keyboard.press('Control+Y');
    await expect(editor(app).locator('span[data-b="1"]')).toHaveText('bold');
    await commit(app);
    expect(((await app.raw())[0]! as { spans?: unknown[] }).spans).toHaveLength(1);
  });

  test('styled words survive editing again, and typing before them keeps them on the right words', async ({ app }) => {
    await selectMiddleWord(app);
    await app.page.keyboard.press('Control+B');
    await commit(app);
    const c = await app.at([450, 525]);
    await app.page.mouse.dblclick(c.x, c.y);
    await expect(editor(app).locator('span[data-b="1"]')).toHaveText('bold');
    await app.page.keyboard.press('Control+Home');
    await app.page.keyboard.type('>> ');
    await commit(app);
    const m = (await app.raw())[0]! as { text: string; spans?: unknown };
    expect(m.text).toBe('>> plain bold plain');
    expect(m.spans).toEqual([{ start: 9, end: 13, style: { bold: true } }]);
  });

  test('Escape keeps the text being typed and ends the command', async ({ app }) => {
    await app.tool('typewriter');
    await app.clicks([[350, 480]]);
    await expect(editor(app)).toBeVisible();
    await app.page.keyboard.type('HELLO');
    await app.page.keyboard.press('Escape');
    await expect(editor(app)).toHaveCount(0);
    expect(await textOf(app)).toBe('HELLO');
    expect((await app.toolState()).tool).toBe('select');

    const c = await app.at([365, 488]);
    await app.page.mouse.dblclick(c.x, c.y);
    await expect(editor(app)).toBeVisible();
    await app.page.keyboard.press('End');
    await app.page.keyboard.type(' WORLD');
    await app.page.keyboard.press('Escape');
    await expect(editor(app)).toHaveCount(0);
    expect(await textOf(app)).toBe('HELLO WORLD');
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

  test('line spacing from the properties panel grows an auto-sized box', async ({ app }) => {
    await textBox(app);
    await app.page.keyboard.type('ONE');
    await app.page.keyboard.press('Enter');
    await app.page.keyboard.type('TWO');
    await app.page.keyboard.press('Enter');
    await app.page.keyboard.type('THREE');
    await commit(app);
    const [m] = await app.markups();
    await app.page.evaluate((id) => window.__nb.tools.select([id]), m!.id);
    const height = async () => {
      await app.cmd('edit.autoSize');
      const [after] = await app.markups();
      return Math.abs(after!.points[1]![1] - after!.points[0]![1]);
    };
    const normal = await height();
    await app.page.getByRole('button', { name: 'Properties', exact: true }).click();
    // The ribbon has a Line spacing field too; use the Properties panel's.
    await app.page.locator('.props-panel').getByLabel('Line spacing', { exact: true }).selectOption('2');
    expect(((await app.raw())[0]!.style as { lineHeight?: number }).lineHeight).toBe(2);
    // Three 12 pt lines: 3 x 12 x 2 + padding, against 3 x 12 x 1.2 + padding.
    expect(await height()).toBeGreaterThan(normal + 25);
  });

  test('a middle-aligned box edits with its text centred, as it renders', async ({ app }) => {
    await app.tool('text');
    await app.page.getByRole('button', { name: 'Align middle' }).click();
    await app.drag([300, 450], [600, 600]);
    await expect(editor(app)).toBeVisible();
    await app.page.keyboard.type('CENTRED');
    // One line: its box (a line high) should sit in the middle of the editor, not at the top.
    const m = await editor(app).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { h: el.clientHeight, padTop: parseFloat(cs.paddingTop), padBottom: parseFloat(cs.paddingBottom), font: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) };
    });
    expect(m.padBottom).toBe(0);
    expect(Math.abs(m.padTop - (m.h - m.lh) / 2)).toBeLessThan(Math.max(2, m.font * 0.25));
    await commit(app);
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
    // The words selected, on web and desktop alike (the clipboard is only read back on web).
    const text = await app.page.evaluate(() => window.__nb.tools.getState().textSelection?.text ?? '');
    expect(text).toMatch(/^DOOR 1\s+HOLLOW CORE$/);
    return { bar, text };
  };

  test('Select Text highlights words without adding a markup, and Copy copies them', async ({ app }) => {
    const { bar, text } = await selectDoor(app);
    const count = `${text.length} character${text.length === 1 ? '' : 's'}`;
    await expect(bar.locator('.text-selection-count')).toHaveText(count);
    expect(await app.markups()).toEqual([]);
    await bar.getByRole('button', { name: 'Copy' }).click();
    await expect(app.page.getByText(`Copied ${count}.`, { exact: true })).toBeVisible();
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
      const { bar } = await selectDoor(app);
      await bar.getByRole('button', { name: button, exact: true }).click();
      await expect(bar).toBeHidden();
      const [m, ...rest] = await app.markups();
      expect(rest).toEqual([]);
      expect(m).toMatchObject({ type, page: 2 });
      // It covers the words selected and no more: from the "D" just right of x 58 to the end of
      // "CORE" at x 206, on the 12 pt line at y 95.
      const xs = m!.points.map(([x]) => x);
      const ys = m!.points.map(([, y]) => y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(57);
      expect(Math.min(...xs)).toBeLessThan(65);
      expect(Math.max(...xs)).toBeGreaterThan(200);
      expect(Math.max(...xs)).toBeLessThan(212);
      expect(Math.min(...ys)).toBeGreaterThan(80);
      expect(Math.max(...ys)).toBeLessThan(110);
    });
  }

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
