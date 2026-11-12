import { expect, type Locator, type Page } from '@playwright/test';
import type { App } from './app.ts';

/**
 * The drawing standards setup opens in its own window. In development React opens, closes and
 * opens it again, so the one that stays open is used.
 */
export async function openSetup(app: App, command = 'document.setUpDrawingStandard'): Promise<{ win: Page; wizard: Locator }> {
  await app.cmd(command);
  const windows = () => app.page.context().pages().filter((p) => p !== app.page && !p.isClosed());
  await expect.poll(async () => (await Promise.all(windows().map((p) => p.locator('.standards-wizard').count()))).some(Boolean)).toBe(true);
  const win = windows().at(-1)!;
  return { win, wizard: win.locator('.standards-wizard') };
}

/** Starts a new standard from the setup's start screen. */
export async function startStandard(wizard: Locator, name: string): Promise<void> {
  await wizard.getByLabel('Standard name').fill(name);
  await wizard.getByRole('button', { name: 'Start', exact: true }).click();
}

/** Which page the setup's sheet shows (1-based, from its page box). */
export async function setupPage(wizard: Locator): Promise<number> {
  return Number(await wizard.locator('.pagenav').getByLabel('Page', { exact: true }).inputValue());
}

/**
 * Draws a box on the setup's sheet, in page points: the sheet is fitted whole in its pane until
 * it is zoomed, so page points map straight onto its picture.
 */
export async function boxInSetup(win: Page, wizard: Locator, page: { width: number; height: number }, b: { x: number; y: number; w: number; h: number }): Promise<void> {
  // The whole page, so page points map onto the picture (later title-block questions zoom to the title block).
  await wizard.locator('.pagenav button[title^="Fit page"]').click();
  const canvas = wizard.locator('.sheet-view-canvas');
  await expect(canvas).toBeVisible();
  // The sheet refits as its pane settles: wait until it stops moving.
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await canvas.boundingBox());
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [250] },
    )
    .toBe(true);
  const r = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => [r.x + (x / page.width) * r.width, r.y + (y / page.height) * r.height] as const;
  await win.mouse.move(...at(b.x, b.y));
  await win.mouse.down();
  await win.mouse.move(...at(b.x + b.w, b.y + b.h), { steps: 8 });
  await win.mouse.up();
}

/** Goes to a step from the setup's step bar. */
export async function setupStep(wizard: Locator, name: string): Promise<void> {
  await wizard.locator('.sw-steps').getByRole('button', { name, exact: false }).click();
}
