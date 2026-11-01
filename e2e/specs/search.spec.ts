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
