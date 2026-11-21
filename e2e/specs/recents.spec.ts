import { copyFileSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../support/app.ts';

// The recent files list (File Access › Recents, File › Open Recent): cut to Preferences › Recent
// Files, cleared without removing anything from the device, and a file moved on disk since is not
// opened from it (#401).

test.describe('recent files', () => {
  test.use({ settings: { recentCount: 2 } });

  test('the list holds the preferred count, and Clear Recents keeps the files on the device', async ({ app }) => {
    const { page } = app;
    await app.open('plan.pdf');
    await app.open('marks.pdf');
    await app.open('forms.pdf');
    await app.cmd('window.files');
    const recents = page.locator('.recents');
    await expect(recents.locator('li[data-id] .name')).toHaveText(['forms.pdf', 'marks.pdf']);

    // The options button shows when the heading is pointed at.
    await recents.locator('.group-head').hover();
    await recents.getByRole('button', { name: 'Recents options' }).click();
    await page.getByRole('menuitem', { name: 'Clear Recents' }).click();
    await expect(recents.locator('li[data-id]')).toHaveCount(0);
    await expect(recents).toContainText('No recent files');

    // Still on the device: a filter finds it, and opening it puts it back on the list.
    await page.getByRole('searchbox', { name: 'Filter files' }).fill('plan');
    await expect(recents.locator('li[data-id] .name')).toHaveText(['plan.pdf']);
    await page.getByRole('searchbox', { name: 'Filter files' }).fill('');
    await app.cmd('file.close');
    await app.cmd('file.close');
    await app.cmd('file.close');
    await expect.poll(async () => (await app.documents()).length).toBe(0);
    await page.getByRole('searchbox', { name: 'Filter files' }).fill('plan');
    await recents.locator('li[data-id] button.file').first().click();
    await expect.poll(async () => (await app.documents()).map((d) => d.name)).toEqual(['plan.pdf']);
    await page.getByRole('searchbox', { name: 'Filter files' }).fill('');
    await expect(recents.locator('li[data-id] .name')).toHaveText(['plan.pdf']);
  });

  test('a file moved on disk since is not opened, and leaves the list', async ({ app }) => {
    test.skip(app.kind !== 'desktop', 'only the desktop app knows the file a document came from');
    const dir = mkdtempSync(join(tmpdir(), 'rc-recents-'));
    try {
      const file = join(dir, 'moved.pdf');
      copyFileSync(app.fixture('plan.pdf'), file);
      await app.answerOpenDialog(file);
      await app.cmd('file.open');
      await expect.poll(async () => (await app.documents()).map((d) => d.name)).toEqual(['moved.pdf']);
      await app.cmd('file.close');
      await expect.poll(async () => (await app.documents()).length).toBe(0);

      renameSync(file, join(dir, 'elsewhere.pdf'));
      await app.cmd('window.files');
      const recents = app.page.locator('.recents');
      // The test accepts every confirm: "Remove it from the recent files?"
      await recents.locator('li[data-id]', { hasText: 'moved.pdf' }).locator('button.file').click();
      await expect(recents.locator('li[data-id]', { hasText: 'moved.pdf' })).toHaveCount(0);
      expect((await app.documents()).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
