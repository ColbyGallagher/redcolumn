import { expect, test } from '../support/app.ts';

// The window layout is kept between launches: panels and the Markups list stay as they were left.
test.describe('layout between launches', () => {
  test('a collapsed Markups list and a closed side panel stay that way after a reload', async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('document.thumbnails');
    await expect(app.page.locator('.thumbs')).toBeVisible();
    await expect(app.page.locator('.dock-edge')).toHaveCount(0);
    // Collapse the Markups list to its strip, and close the side panel.
    await app.page.locator('.dock-split').click();
    await expect(app.page.locator('.dock-edge')).toHaveCount(1);
    await app.page.locator('.rail button[data-panel="pages"]').click();
    await expect(app.page.locator('.panel-edge')).toHaveCount(1);
    // The layout is written a moment after it settles.
    await app.page.waitForTimeout(600);
    await app.page.reload();
    await app.open('plan.pdf');
    await expect(app.page.locator('.dock-edge')).toHaveCount(1);
    await expect(app.page.locator('.panel-edge')).toHaveCount(1);
    // Reset Layout puts both back.
    await app.cmd('window.resetLayout');
    await expect(app.page.locator('.dock-edge')).toHaveCount(0);
    await expect(app.page.locator('.panel-edge')).toHaveCount(0);
  });
});
