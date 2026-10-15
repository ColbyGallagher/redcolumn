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
