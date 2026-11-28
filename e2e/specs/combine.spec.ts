import { readFileSync } from 'node:fs';
import { expect, test } from '../support/app.ts';
import { join } from 'node:path';

// File › Combine: reading long file names, and reordering several documents at once.
const LONG = 'Riverside Community Centre - Stage 2 - Architectural General Arrangement - Ground Floor - Issued for Construction';

test('file.combine shows long names and reorders several files together', async ({ app }) => {
  await app.open('plan.pdf');
  await app.cmd('file.combine');
  const dialog = app.page.locator('.combine-dialog');
  const list = dialog.getByRole('listbox');
  const rows = list.getByRole('option');
  const names = () => list.locator('.name').allTextContents();
  const picked = () => list.locator('[aria-selected="true"] .name').allTextContents();
  const buffer = readFileSync(join(import.meta.dirname, '../fixtures/plan.pdf'));
  const files = Array.from({ length: 15 }, (_, i) => `${LONG} ${String(i + 1).padStart(2, '0')}.pdf`);
  await dialog.locator('input[type=file]').setInputFiles(files.map((name) => ({ name, mimeType: 'application/pdf', buffer })));
  await expect(rows).toHaveCount(16);

  // The whole name is laid out, and the list scrolls sideways to reach the end of it.
  const name = rows.nth(1).locator('.name');
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // Dragging the corner makes the window, and the list in it, wider and taller.
  const before = (await dialog.boundingBox())!;
  const listBefore = (await list.boundingBox())!;
  await app.page.mouse.move(before.x + before.width - 4, before.y + before.height - 4);
  await app.page.mouse.down();
  await app.page.mouse.move(before.x + before.width + 150, before.y + before.height + 60, { steps: 10 });
  await app.page.mouse.up();
  const after = (await dialog.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 100);
  expect((await list.boundingBox())!.height).toBeGreaterThan(listBefore.height + 40);

  // Shift+click takes a range, Ctrl+click one more; they move down together.
  await rows.nth(1).click();
  await rows.nth(2).click({ modifiers: ['Shift'] });
  await rows.nth(4).click({ modifiers: ['ControlOrMeta'] });
  expect(await picked()).toEqual([files[0], files[1], files[3]]);
  await dialog.getByTitle('Move down').click();
  expect((await names()).slice(0, 6)).toEqual(['plan.pdf', files[2], files[0], files[1], files[4], files[3]]);
  expect(await picked()).toEqual([files[0], files[1], files[3]]);

  // The list follows the moved files down, past what was in view, without losing the sideways position.
  await list.evaluate((el) => void (el.scrollLeft = 40));
  for (let i = 0; i < 10; i++) await dialog.getByTitle('Move down').click();
  const inView = () =>
    list.evaluate((el) => {
      const view = el.getBoundingClientRect();
      return [...el.querySelectorAll('[aria-selected="true"]')].every((li) => li.getBoundingClientRect().top >= view.top - 1 && li.getBoundingClientRect().bottom <= view.bottom + 1);
    });
  expect(await inView()).toBe(true);
  expect(await list.evaluate((el) => [el.scrollTop > 0, el.scrollLeft])).toEqual([true, 40]);
  for (let i = 0; i < 15; i++) await dialog.getByTitle('Move up').click();
  expect(await inView()).toBe(true);
  expect((await names()).slice(0, 3)).toEqual([files[0], files[1], files[3]]);

  // Remove takes out every selected file.
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(rows).toHaveCount(13);
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
  expect(app.errors).toEqual([]);
});

test('file.combine reorders files by dragging them', async ({ app }) => {
  await app.open('plan.pdf');
  await app.cmd('file.combine');
  const { page } = app;
  const dialog = page.locator('.combine-dialog');
  const list = dialog.getByRole('listbox');
  const rows = list.getByRole('option');
  const ghost = page.locator('.reorder-ghost');
  const names = () => list.locator('.name').allTextContents();
  const picked = () => list.locator('[aria-selected="true"] .name').allTextContents();
  const buffer = readFileSync(join(import.meta.dirname, '../fixtures/plan.pdf'));
  const files = Array.from({ length: 20 }, (_, i) => `Sheet ${String(i + 1).padStart(2, '0')}.pdf`);
  await dialog.locator('input[type=file]').setInputFiles(files.map((name) => ({ name, mimeType: 'application/pdf', buffer })));
  await expect(rows).toHaveCount(21);
  const all = ['plan.pdf', ...files];
  const middle = async (i: number) => {
    const box = (await rows.nth(i).boundingBox())!;
    return { x: box.x + 120, y: box.y + box.height / 2 };
  };
  const press = async (i: number) => {
    const at = await middle(i);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
  };
  const settle = () => expect.poll(() => list.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  const over = async (i: number) => {
    // Rows may still be sliding from the press (carried rows close up), so measure row i again once
    // they stop, and follow it if it moved: the pointer must end on row i as it is drawn.
    let at = await middle(i);
    await page.mouse.move(at.x, at.y, { steps: 8 });
    await settle();
    for (let tries = 0; tries < 3; tries++) {
      const now = await middle(i);
      if (Math.abs(now.y - at.y) < 1) break;
      at = now;
      await page.mouse.move(at.x, at.y, { steps: 4 });
      await settle();
    }
  };

  // The list reorders under the pointer, before the button is let go.
  await press(1);
  await over(4);
  await expect(ghost).toHaveText(files[0]!);
  expect((await names()).slice(0, 5)).toEqual(['plan.pdf', files[1], files[2], files[3], files[0]]);
  await over(0);
  expect((await names()).slice(0, 2)).toEqual([files[0], 'plan.pdf']);
  await over(2);
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  expect((await names()).slice(0, 4)).toEqual(['plan.pdf', files[1], files[0], files[2]]);
  expect(await picked()).toEqual([files[0]]);

  // Escape puts the files back and leaves the dialog open.
  const settled = await names();
  await press(0);
  await over(5);
  expect(await names()).not.toEqual(settled);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(await names()).toEqual(settled);

  // Dragging one of several selected files carries them all, and they stay selected.
  await rows.nth(1).click();
  await rows.nth(3).click({ modifiers: ['ControlOrMeta'] });
  const chosen = await picked();
  await press(3);
  await over(6);
  await expect(ghost.locator('.count')).toHaveText('2');
  await page.mouse.up();
  expect((await names()).slice(5, 7)).toEqual(chosen);
  expect(await picked()).toEqual(chosen);

  // Holding near the bottom edge scrolls, so a file can be carried to the end of a long list.
  const first = (await names())[0]!;
  await press(0);
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + box.height + 30, { steps: 8 });
  await expect.poll(async () => (await names()).at(-1)).toBe(first);
  await page.mouse.up();
  expect([...(await names())].sort()).toEqual([...all].sort());
  expect(app.errors).toEqual([]);
});
