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
