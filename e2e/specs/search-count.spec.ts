import { expect, test } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

test.describe('text search to count', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('edit.find');
    const input = app.page.locator('.search-bar input[placeholder="Search text"]');
    await input.fill('DOOR');
    await input.press('Enter');
    await expect(app.page.locator('.search-hit')).toHaveCount(PLAN.search.DOOR!.hits);
  });

  const apply = (app: import('../support/app.ts').App) => app.page.getByRole('button', { name: /Apply Count to Checked/ });

  test('turns checked results into one count per page', async ({ app }) => {
    const total = PLAN.search.DOOR!.hits;
    // Nothing checked: the action is off.
    await expect(apply(app)).toBeDisabled();
    await app.page.getByRole('button', { name: 'Select All' }).click();
    await expect(app.page.locator('.search-check:checked')).toHaveCount(total);
    await apply(app).click();
    const dialog = app.page.getByRole('dialog', { name: 'Apply Count to Checked' });
    await expect(dialog.getByLabel('Default count')).toBeChecked();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(async () => (await app.markups()).filter((m) => m.type === 'count').reduce((n, m) => n + m.points.length, 0)).toBe(total);
    const counts = (await app.markups()).filter((m) => m.type === 'count');
    expect(counts.length).toBeGreaterThan(1);
    expect(new Set(counts.map((m) => m.page)).size).toBe(counts.length);
  });

  test('Select None clears the checks and the page filter limits Select All', async ({ app }) => {
    await app.page.getByRole('button', { name: 'Select All' }).click();
    await app.page.getByRole('button', { name: 'Select None' }).click();
    await expect(app.page.locator('.search-check:checked')).toHaveCount(0);
    await app.page.getByLabel('Show results on page').selectOption({ index: 1 });
    await app.page.getByRole('button', { name: 'Select All' }).click();
    const first = await app.page.locator('.search-check:checked').count();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(PLAN.search.DOOR!.hits);
  });

  test('checks reset when the query changes', async ({ app }) => {
    await app.page.getByRole('button', { name: 'Select All' }).click();
    await app.page.locator('.search-bar input[placeholder="Search text"]').fill('DOORS');
    await expect(app.page.locator('.search-check')).toHaveCount(0);
  });
});
