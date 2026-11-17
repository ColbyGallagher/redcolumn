// The Layers panel resizes from its inner edge like the other side panels, and its columns resize
// from their header edges, keeping their widths.
import { expect, test } from '../support/app.ts';

test('the Layers panel narrows and widens from its edge, below the old 380px floor', async ({ app }) => {
  const { page } = app;
  await app.panel('Layers');
  const aside = page.locator('aside.panel.side').filter({ has: page.locator('.layers') });
  await expect(aside).toBeVisible();
  const handle = aside.getByRole('separator', { name: 'Resize side panel' });
  const before = (await aside.boundingBox())!;
  const h = (await handle.boundingBox())!;
  // The inner edge: for a left panel dragging left narrows it, for a right panel dragging right does.
  const left = before.x < (page.viewportSize()?.width ?? 1280) / 2;
  const drag = async (dx: number) => {
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + dx / 2, h.y + h.height / 2, { steps: 4 });
    await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2, { steps: 4 });
    await page.mouse.up();
  };
  await drag(left ? -400 : 400);
  await expect.poll(async () => (await aside.boundingBox())!.width).toBeLessThan(Math.min(before.width, 300));
  // Narrow, the table scrolls sideways rather than squeezing the columns.
  const grid = aside.locator('.layers-grid');
  await expect.poll(() => grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('Layers columns resize from their header edges and keep the width', async ({ app }) => {
  const { page } = app;
  await app.panel('Layers');
  const lockHeader = page.locator('.layers-grid th').filter({ hasText: /^Lock$/ });
  const before = (await lockHeader.boundingBox())!;
  const handle = page.getByRole('separator', { name: 'Resize the Lock column' });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await lockHeader.boundingBox())!.width)).toBe(Math.round(before.width) + 40);

  // Kept when the panel is closed and opened again.
  await app.panel('Bookmarks');
  await app.panel('Layers');
  await expect.poll(async () => Math.round((await page.locator('.layers-grid th').filter({ hasText: /^Lock$/ }).boundingBox())!.width)).toBe(Math.round(before.width) + 40);

  // Double-clicking the edge puts the default width back.
  await page.getByRole('separator', { name: 'Resize the Lock column' }).dblclick();
  await expect.poll(async () => Math.round((await page.locator('.layers-grid th').filter({ hasText: /^Lock$/ }).boundingBox())!.width)).toBe(Math.round(before.width));
});
