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
  await mark.click();
  await expect(drop).toHaveCount(0);
  await expect(mark).toHaveAttribute('aria-expanded', 'false');
  // The ribbon's tabs or the simplified toolbar, whichever the profile shows.
  await expect(app.page.locator('.menubar .menubar-slot > .rb-tabs, .menubar .menubar-slot > .toolbar.tools')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('search, Feedback and Autosave stay in the top bar', async ({ app }) => {
  await expect(app.page.locator('.menubar .menu-search input')).toBeVisible();
  const feedback = app.page.locator('.menubar .feedback-btn');
  await feedback.click();
  const items = app.page.locator('.feedback-drop .menu-item .label');
  await expect(items).toHaveText(['Report a Bug / Get Support', 'Suggest a Feature', 'Sponsor redcolumn']);
  await app.page.keyboard.press('Escape');
  await expect(app.page.locator('.feedback-drop')).toHaveCount(0);
  const autosave = app.page.locator('.menubar .autosave-btn');
  const before = await autosave.getAttribute('aria-checked');
  await autosave.click();
  await expect(autosave).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  expect(app.errors).toEqual([]);
});

test('Preferences › Show Menu Bar toggles between the classic menu bar and the redcolumn menu', async ({ app }) => {
  // Default: menus live under the redcolumn button, not across the top bar.
  await expect(app.page.locator('.menubar .menu-title')).toHaveCount(0);
  await expect(app.page.locator('.menubar button.brand-mark')).toBeVisible();

  // Enable Show Menu Bar in Preferences › Interface › Display.
  await app.cmd('file.preferences');
  await app.page.getByRole('tab', { name: 'Interface' }).click();
  await app.page.getByRole('tab', { name: 'Display' }).click();
  const toggle = app.page.getByLabel('Show Menu Bar');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await app.page.getByRole('button', { name: 'Save', exact: true }).click();

  // Menus now sit across the top bar and the ribbon's tabs sit below it.
  await expect(app.page.locator('.menubar button.brand-mark')).toHaveCount(0);
  const titles = app.page.locator('.menubar .menu-title');
  await expect(titles).toHaveText(['File', 'Edit', 'View', 'Document', 'Bulk', 'Tools', 'Window', 'Help']);
  await expect(app.page.locator('.menubar .menubar-slot')).toHaveCount(0);
  await expect(app.page.locator('.ribbon > .rb-tabs, .app > .toolbar.tools')).toBeVisible();
  await expect(app.page.locator('.menubar .menu-search input')).toBeVisible();

  // Clicking a top menu opens it, hovering switches to the next, Escape closes it.
  await titles.filter({ hasText: /^File$/ }).click();
  await expect(app.page.locator('.menubar .menu-drop')).toBeVisible();
  await titles.filter({ hasText: /^Edit$/ }).hover();
  await expect(app.page.locator('.menubar .menu.open .menu-title')).toHaveText('Edit');
  await app.page.keyboard.press('Escape');
  await expect(app.page.locator('.menubar .menu-drop')).toHaveCount(0);

  // Turn Show Menu Bar back off and verify the one-row bar returns.
  await app.cmd('file.preferences');
  await app.page.getByRole('tab', { name: 'Interface' }).click();
  await app.page.getByRole('tab', { name: 'Display' }).click();
  await app.page.getByLabel('Show Menu Bar').uncheck();
  await app.page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(app.page.locator('.menubar .menu-title')).toHaveCount(0);
  await expect(app.page.locator('.menubar button.brand-mark')).toBeVisible();
  await expect(app.page.locator('.menubar .menubar-slot > .rb-tabs, .menubar .menubar-slot > .toolbar.tools')).toBeVisible();
  expect(app.errors).toEqual([]);
});
