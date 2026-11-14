import { expect, test } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

test('starts with no errors', async ({ app }) => {
  await expect(app.page.locator('.menubar')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('opens a PDF', async ({ app }) => {
  await app.open('plan.pdf');
  const [doc] = await app.documents();
  expect(doc).toMatchObject({ pageCount: PLAN.pageCount, page: 1, active: true });
  expect(await app.pageInfo(1)).toMatchObject({ width: PLAN.page.width, height: PLAN.page.height });
  expect(await app.markups()).toEqual([]);
  expect(app.errors).toEqual([]);
});

test('every top menu opens without errors', async ({ app }) => {
  await app.open('plan.pdf');
  const titles = await app.page.locator('.menubar .menu-title').allInnerTexts();
  expect(titles.length).toBeGreaterThan(5);
  for (const title of titles) {
    const drop = await app.menu(title.trim());
    await expect(drop).toBeVisible();
    expect(await drop.locator('.menu-item').count(), title).toBeGreaterThan(0);
  }
  await app.page.keyboard.press('Escape');
  expect(app.errors).toEqual([]);
});

test('clicking an open menu title closes it, and another title switches to that menu', async ({ app }) => {
  const title = (name: string) => app.page.locator('.menubar .menu-title', { hasText: new RegExp(`^${name}$`) });
  const drop = app.page.locator('.menu-drop');
  await title('File').click();
  await expect(drop).toBeVisible();
  await title('Edit').click();
  await expect(title('Edit')).toHaveAttribute('aria-expanded', 'true');
  await expect(title('File')).toHaveAttribute('aria-expanded', 'false');
  await title('Edit').click();
  await expect(drop).toHaveCount(0);
  await expect(title('Edit')).toHaveAttribute('aria-expanded', 'false');
  expect(app.errors).toEqual([]);
});
