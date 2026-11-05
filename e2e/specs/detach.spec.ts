import { expect, test } from '../support/app.ts';

// Desktop only: a document tab moves to a window of its own.
test.describe('moving a tab to a new window', () => {
  test.skip(({ app }) => app.kind !== 'desktop', 'windows belong to the desktop app');

  test('Move to New Window opens the file in a second window and closes the tab', async ({ app }) => {
    await app.answerOpenDialog(app.fixture('plan.pdf'));
    await app.cmd('file.open');
    await expect.poll(async () => (await app.documents()).length).toBe(1);
    expect(await app.windowCount()).toBe(1);

    await app.page.locator('.doc-tab').first().click({ button: 'right' });
    await app.page.getByRole('menuitem', { name: 'Move to New Window' }).click();

    await expect.poll(() => app.windowCount()).toBe(2);
    await expect.poll(async () => (await app.documents()).length).toBe(0);
  });
});
