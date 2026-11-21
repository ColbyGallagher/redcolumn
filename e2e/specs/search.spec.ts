import { expect, test } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

test.describe('text search', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('edit.find');
  });

  const search = async (app: import('../support/app.ts').App, query: string) => {
    const input = app.page.locator('.search-bar input[placeholder="Search text"]');
    await input.fill(query);
    await input.press('Enter');
  };

  for (const [query, { hits, firstPage }] of Object.entries(PLAN.search)) {
    test(`finds "${query}"`, async ({ app }) => {
      await search(app, query);
      await expect(app.page.locator('.search-results-head .count')).toHaveText(String(hits));
      await expect(app.page.locator('.search-hit')).toHaveCount(hits);
      const first = app.page.locator('.search-hit').first();
      await expect(first.locator('mark')).toHaveText(new RegExp(`^${query}$`, 'i'));
      await expect(first.locator('.num')).toHaveText(`Page ${firstPage + 1}`);
      await first.click();
      await expect.poll(async () => (await app.documents())[0]!.page).toBe(firstPage + 1);
    });
  }

  test('steps through results with Enter', async ({ app }) => {
    await search(app, 'DOOR');
    await expect(app.page.locator('.search-hit')).toHaveCount(PLAN.search.DOOR!.hits);
    const input = app.page.locator('.search-bar input[placeholder="Search text"]');
    // Enter again moves to the next match: the 2 on page 1, then the 4 on page 2.
    for (let i = 0; i < 3; i++) await input.press('Enter');
    await expect(app.page.locator('.search-hit.active .num')).toHaveText('Page 2');
    await expect.poll(async () => (await app.documents())[0]!.page).toBe(2);
  });

  test('steps through results with Up and Down, wrapping at either end', async ({ app }) => {
    await search(app, 'DOOR');
    const hits = PLAN.search.DOOR!.hits;
    await expect(app.page.locator('.search-hit')).toHaveCount(hits);
    const input = app.page.locator('.search-bar input[placeholder="Search text"]');
    const active = app.page.locator('.search-hit.active');
    const index = () => app.page.locator('.search-hit').evaluateAll((els) => els.findIndex((el) => el.classList.contains('active')));
    expect(await index()).toBe(0);
    await input.press('ArrowDown');
    expect(await index()).toBe(1);
    await input.press('ArrowUp');
    await input.press('ArrowUp');
    // Up from the first result wraps to the last, Down from the last back to the first.
    expect(await index()).toBe(hits - 1);
    await input.press('ArrowDown');
    expect(await index()).toBe(0);
    await expect(active).toHaveCount(1);
    await expect.poll(async () => (await app.documents())[0]!.page).toBe(PLAN.search.DOOR!.firstPage + 1);
    // Still works after a click puts the focus on a result.
    await app.page.locator('.search-hit').nth(1).click();
    await app.page.keyboard.press('ArrowDown');
    expect(await index()).toBe(2);
  });

  test('finds the same matches through the search index', async ({ app }) => {
    // The first search reads the document and keeps its text in the search index; after that a
    // search reads only the pages that can match. Every count must stay the same.
    await search(app, 'DOOR');
    await expect(app.page.locator('.search-hit')).toHaveCount(PLAN.search.DOOR!.hits);
    await expect
      .poll(() => app.page.evaluate(async () => (await navigator.storage.getDirectory().then((d) => d.getDirectoryHandle('redcolumn-search')).then(() => true, () => false))))
      .toBe(true);
    for (const [query, { hits, firstPage }] of Object.entries(PLAN.search)) {
      await search(app, query);
      await expect(app.page.locator('.search-results-head .count')).toHaveText(String(hits));
      await expect(app.page.locator('.search-hit').first().locator('.num')).toHaveText(`Page ${firstPage + 1}`);
    }
    // Inside a word, and a word cut short.
    await search(app, 'OLLOW COR');
    await expect(app.page.locator('.search-hit')).toHaveCount(1);
    await expect(app.page.locator('.search-hit mark')).toHaveText('OLLOW COR');
  });

  test('corrects a misspelt word from the words in the document', async ({ app }) => {
    // The index is filled in the background after the document opens, so try until it has it.
    await expect(async () => {
      await search(app, 'SCHEDUEL');
      await expect(app.page.locator('.search-respelt')).toHaveText('No matches for “SCHEDUEL”. Showing matches for “schedule”.', { timeout: 1000 });
    }).toPass();
    await expect(app.page.locator('.search-hit')).toHaveCount(1);
    await expect(app.page.locator('.search-hit .num')).toHaveText('Page 2');
    // Numbers are never respelt: DOOR 9 is not a misspelling of DOOR 1.
    await search(app, 'DOOR 9');
    await expect(app.page.locator('.search .empty')).toHaveText(/^No matches\./);
    await expect(app.page.locator('.search-respelt')).toHaveCount(0);
  });

  test('reports no matches', async ({ app }) => {
    await search(app, 'WINDOW');
    await expect(app.page.locator('.search .empty')).toHaveText(/No matches\./);
    await expect(app.page.locator('.search-hit')).toHaveCount(0);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

// fixtures/rotated.pdf: sheets turned by /Rotate 180 and 90 whose text reads normally on screen.
test.describe('text on rotated sheets', () => {
  type Words = { words: { text: string; x0: number; y0: number; x1: number; y1: number }[] };

  test('reads as shown: whole words, in reading order, where they appear', async ({ app }) => {
    await app.open('rotated.pdf');
    for (const [i, { text, x, y }] of PLAN.rotated.pages.entries()) {
      const { words } = await app.assistant<Words>('get_page_text', { page: i + 1 });
      expect(words.map((w) => w.text)).toEqual(text.split(' '));
      // The first word starts where it was drawn on the page as shown, on the baseline there.
      expect(Math.abs(words[0]!.x0 - x)).toBeLessThan(2);
      expect(Math.abs(words[0]!.y1 - y)).toBeLessThan(6);
    }
  });

  test('search finds whole words on sheets turned by /Rotate', async ({ app }) => {
    await app.open('rotated.pdf');
    // The upside-down sheet's number now reads as a whole word, so it is also its sheet number.
    expect(await app.search('C-101')).toHaveLength(1);
    expect(await app.search('SECTIONS')).toHaveLength(1);
  });
});
