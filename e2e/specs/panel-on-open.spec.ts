import { expect, test } from '../support/app.ts';

// Opening a document leaves the side panel as the user had it, unless "Show Thumbnails When Opening a File" is on.
test.describe('side panel when opening a file', () => {
  test('a closed panel stays closed when another file is opened', async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('document.thumbnails');
    await expect(app.page.locator('.thumbs')).toBeVisible();
    await app.page.locator('.rail button[data-panel="pages"]').click();
    await expect(app.page.locator('.thumbs')).toHaveCount(0);
    await app.open('paper.pdf');
    await expect.poll(async () => (await app.documents()).length).toBe(2);
    await expect(app.page.locator('.thumbs')).toHaveCount(0);
    expect((await app.command('window.pages')).checked).toBe(false);
  });

  test('the panel layout is remembered after a reload', async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('document.thumbnails');
    await app.page.locator('.rail button[data-panel="pages"]').click();
    await expect(app.page.locator('.thumbs')).toHaveCount(0);
    await app.page.reload();
    await app.open('plan.pdf');
    await expect(app.page.locator('.thumbs')).toHaveCount(0);
    await expect(app.page.locator('.panel-edge')).toHaveCount(1);
  });

  test.describe('with the setting on', () => {
    test.use({ settings: { unitSystem: 'imperial', lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft', showThumbnailsOnOpen: true } });

    test('opening a file turns the panel to Thumbnails', async ({ app }) => {
      await app.open('plan.pdf');
      await app.cmd('window.files');
      await app.page.locator('.rail button[data-panel="files"]').click();
      await app.open('paper.pdf');
      await expect(app.page.locator('.thumbs')).toBeVisible();
      expect((await app.command('window.pages')).checked).toBe(true);
    });
  });
});
