import { expect, test, type App } from '../support/app.ts';

// The window layout is kept between launches: panels and the Markups list stay as they were left.

type Saved = { leftWidth: number; rightWidth: number; showBottom: boolean; dockOpen: boolean; bottomTab: string; dockHeight: number };

/** The saved layout, once it has been written (it is saved a moment after it changes). */
const saved = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('nb.layout') ?? 'null') as Saved | null);

/** Drags a divider by the given offset. */
async function drag(app: App, selector: string, dx: number, dy: number) {
  const handle = app.page.locator(selector).first();
  await handle.waitFor();
  await expect.poll(async () => (await handle.boundingBox())?.width ?? 0).toBeGreaterThan(0);
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await app.page.mouse.move(x + dx, y + dy, { steps: 4 });
  await app.page.mouse.up();
}

test.describe('layout between launches', () => {
  test('a collapsed Markups list and a closed side panel stay that way after a reload', async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('document.thumbnails');
    await expect(app.page.locator('.thumbs')).toBeVisible();
    await expect(app.page.locator('.dock-edge')).toHaveCount(0);
    await app.page.locator('.dock-split').click();
    await expect(app.page.locator('.dock-edge')).toHaveCount(1);
    await app.page.locator('.rail button[data-panel="pages"]').click();
    await expect(app.page.locator('.panel-edge')).toHaveCount(1);
    await expect.poll(async () => (await saved(app))?.dockOpen).toBe(false);
    await app.page.reload();
    await app.open('plan.pdf');
    await expect(app.page.locator('.dock-edge')).toHaveCount(1);
    await expect(app.page.locator('.panel-edge')).toHaveCount(1);
    // Opening another document leaves them as they were.
    await app.open('paper.pdf');
    await expect.poll(async () => (await app.documents()).length).toBe(2);
    await expect(app.page.locator('.dock-edge')).toHaveCount(1);
    await expect(app.page.locator('.panel-edge')).toHaveCount(1);
    // Reset Layout puts both back.
    await app.cmd('window.resetLayout');
    await expect(app.page.locator('.dock-edge')).toHaveCount(0);
    await expect(app.page.locator('.panel-edge')).toHaveCount(0);
    await expect.poll(() => saved(app)).toBeNull();
  });

  test('panel width, list height and the list tab are kept', async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('document.thumbnails');
    await drag(app, '.panel-split', -60, 0);
    await drag(app, '.dock-split', 0, -50);
    await app.page.getByRole('tab', { name: /^Links/ }).click();
    await expect.poll(async () => (await saved(app))?.bottomTab).toBe('links');
    const s = (await saved(app))!;
    expect(s.leftWidth).not.toBe(440);
    expect(s.dockHeight).toBeGreaterThan(180);
    await app.page.reload();
    await app.open('plan.pdf');
    await expect(app.page.getByRole('tab', { name: /^Links/ })).toHaveAttribute('aria-selected', 'true');
    // The panel is drawn at the saved width (retrying: it lays out after the reload).
    await expect.poll(async () => Math.round((await app.page.locator('aside.panel.side.left').boundingBox())?.width ?? 0)).toBe(s.leftWidth);
    expect((await saved(app))?.dockHeight).toBe(s.dockHeight);
  });

  test('File Access keeps Recents collapsed, and Reset Layout opens it', async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('window.files');
    const recents = app.page.locator('.recents .group-toggle');
    await expect(recents).toHaveAttribute('aria-expanded', 'true');
    await recents.click();
    await expect(recents).toHaveAttribute('aria-expanded', 'false');
    await app.page.reload();
    await app.open('plan.pdf');
    await app.cmd('window.files');
    await expect(app.page.locator('.recents .group-toggle')).toHaveAttribute('aria-expanded', 'false');
    await app.cmd('window.resetLayout');
    await app.cmd('window.files');
    await expect(app.page.locator('.recents .group-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('a profile that docks the Markups list does not overwrite the saved layout', async ({ app }) => {
    await app.page.evaluate(() => {
      localStorage.setItem('nb.layout', JSON.stringify({ leftWidth: 440, rightWidth: 360, showBottom: true, dockOpen: true, bottomTab: 'markups', dockHeight: 180 }));
      localStorage.setItem('nb.profiles', JSON.stringify({ profiles: [{ id: 'docked', name: 'Docked', state: { toolbarStyle: 'simplified', markupsDocked: true } }], activeId: 'docked' }));
    });
    await app.page.reload();
    await app.open('plan.pdf');
    await expect(app.page.locator('.dock-edge')).toHaveCount(0);
    // Something else changes, so a save happens; the list's visibility must stay as the user left it.
    await app.cmd('document.thumbnails');
    await drag(app, '.panel-split', -40, 0);
    await expect.poll(async () => (await saved(app))?.leftWidth).not.toBe(440);
    expect((await saved(app))?.showBottom).toBe(true);
  });
});
