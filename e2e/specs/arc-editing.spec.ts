import { expect, test, type App } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// Editing a selected polylength: Ctrl-click smooths or corners a vertex, Shift-click adds or removes one.
const A: Pt = [300, 450];
const P: Pt = [400, 500];
const B: Pt = [500, 450];

/** The one measurement's id, points and bulges, read straight from the store. */
async function shape(app: App) {
  const [m] = (await app.raw()) as unknown as { id: string; points: [number, number][]; bulges?: number[] }[];
  return m!;
}

/** Clicks a page point with a modifier held. */
async function modClick(app: App, p: Pt, key: 'Control' | 'Shift' | 'Alt') {
  const c = await app.at(p);
  await app.page.keyboard.down(key);
  await app.page.mouse.click(c.x, c.y);
  await app.page.keyboard.up(key);
  await app.page.waitForTimeout(150);
}

test.describe('arc editing keys', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
    await app.tool('polylength');
    await app.clicks([A, P, B], 'enter');
    const id = (await shape(app)).id;
    await app.tool('select');
    await app.page.evaluate((i) => (window.__nb.tools as unknown as { select(ids: string[]): void }).select([i]), id);
  });

  test('Ctrl-click smooths a vertex and makes it a corner again', async ({ app }) => {
    await modClick(app, P, 'Control');
    const smooth = await shape(app);
    expect(smooth.points).toHaveLength(3);
    expect(smooth.bulges?.[0]).toBeTruthy();
    expect(smooth.bulges?.[1]).toBeTruthy();
    await modClick(app, P, 'Control');
    expect((await shape(app)).bulges ?? []).toEqual([]);
  });

  test('Shift-click adds a vertex on a segment and removes one at a vertex', async ({ app }) => {
    await modClick(app, [350, 475], 'Shift');
    expect((await shape(app)).points).toHaveLength(4);
    await modClick(app, [350, 475], 'Shift');
    expect((await shape(app)).points).toHaveLength(3);
  });

  test('Alt-click still removes a vertex', async ({ app }) => {
    await modClick(app, P, 'Alt');
    expect((await shape(app)).points).toHaveLength(2);
  });
});
