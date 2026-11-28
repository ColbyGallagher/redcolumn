import { expect, test } from '../support/app.ts';

// Closing a document tab, and bringing the last closed one back (File › Reopen Closed Tab, Ctrl+Shift+T).

test('a closed tab reopens on the page it was left on, once', async ({ app }) => {
  await app.open('plan.pdf', 'sheets.pdf');
  expect((await app.command('tab.reopenClosed')).enabled, 'nothing has been closed yet').toBe(false);

  // sheets.pdf has three pages: leave it on the second.
  await app.cmd('view.nextPage');
  await expect.poll(async () => (await app.documents()).find((d) => d.active)?.page).toBe(2);

  await app.cmd('file.close');
  await expect.poll(async () => (await app.documents()).map((d) => d.name)).toEqual(['plan.pdf']);

  await app.cmd('tab.reopenClosed');
  // Where the tab goes in the tab bar is not part of this: compare by name.
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  await expect
    .poll(async () => (await app.documents()).map(({ name, active, page }) => ({ name, active, page })).sort(byName))
    .toEqual([
      { name: 'plan.pdf', active: false, page: 1 },
      { name: 'sheets.pdf', active: true, page: 2 },
    ]);
  // The closed-tab list had one entry, and reopening took it.
  await expect.poll(async () => (await app.command('tab.reopenClosed')).enabled).toBe(false);
});
