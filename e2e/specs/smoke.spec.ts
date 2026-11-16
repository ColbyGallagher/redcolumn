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

test('every menu in the redcolumn menu opens without errors', async ({ app }) => {
  await app.open('plan.pdf');
  await app.page.locator('.menubar .brand-mark').click();
  const titles = await app.page.locator('.brand-drop > .menu-sub > .menu-item .label').allInnerTexts();
  expect(titles.length).toBeGreaterThan(5);
  for (const title of titles) {
    const flyout = await app.menu(title.trim());
    await expect(flyout).toBeVisible();
    expect(await flyout.locator('.menu-item').count(), title).toBeGreaterThan(0);
  }
  await app.page.keyboard.press('Escape');
  expect(app.errors).toEqual([]);
});

test('the redcolumn mark opens and closes its menu, and the toolbar shares its row', async ({ app }) => {
  const mark = app.page.locator('.menubar .brand-mark');
  const drop = app.page.locator('.brand-drop');
  await mark.click();
  await expect(drop).toBeVisible();
  await expect(mark).toHaveAttribute('aria-expanded', 'true');
  await expect(drop.locator('.menu-search input')).toBeVisible();
  await mark.click();
  await expect(drop).toHaveCount(0);
  await expect(mark).toHaveAttribute('aria-expanded', 'false');
  // The ribbon's tabs or the simplified toolbar, whichever the profile shows.
  await expect(app.page.locator('.menubar .menubar-slot > .rb-tabs, .menubar .menubar-slot > .toolbar.tools')).toBeVisible();
  expect(app.errors).toEqual([]);
});
