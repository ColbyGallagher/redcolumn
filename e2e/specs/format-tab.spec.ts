import { expect, test, type App } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// The Markup Format tab follows the selection: selecting markups switches the ribbon to it, clearing
// the selection goes back, and edits apply to everything selected as one undo step.

const r = PLAN.room;
const roomAt = (dy: number): Pt[] => {
  const pts: Pt[] = [[r.x, r.y + dy], [r.x + r.w, r.y + dy], [r.x + r.w, r.y + r.h + dy], [r.x, r.y + r.h + dy]];
  return [...pts, pts[0]!];
};

const ribbon = (app: App) => app.page.locator('.ribbon');
/** A 10'-0" per 100 pt scale on page 1, set directly: the calibrate clicks can land outside the canvas in the
 * smaller desktop window under the full ribbon, and these tests only need a scale, not the calibrate flow. */
const setScale = (app: App) =>
  app.page.evaluate(() =>
    (window.__nb.tools.store as unknown as { setScale(pages: number[], s: object): void }).setScale([0], { metersPerPoint: 3.048 / 100, unit: 'ft', feetInches: true, precision: 2, label: 'Calibrated' }),
  );

const select = (app: App, ids: string[]) => app.page.evaluate((ids) => window.__nb.tools.select(ids), ids);
const clear = (app: App) => select(app, []);
const fillOpacities = (app: App, ids: string[]) =>
  app.page.evaluate((ids) => {
    const store = window.__nb.tools.store as unknown as { get(id: string): { style: { fillOpacity?: number } } | undefined };
    return ids.map((id) => store.get(id)!.style.fillOpacity);
  }, ids);

async function draw(app: App, tool: string, points: readonly Pt[], finish?: 'enter' | 'dbl') {
  await app.tool(tool);
  await app.clicks(points, finish);
  await app.tool('select');
  return (await app.markups()).at(-1)!;
}

test.describe('markup format tab follows the selection', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await setScale(app);
  });

  test('selecting a markup shows the tab, clearing returns to the tab before, a manual pick is respected', async ({ app }) => {
    const rect = await (async () => {
      await app.tool('rect');
      await app.drag([300, 450], [350, 500]);
      await app.tool('select');
      return (await app.markups()).at(-1)!;
    })();
    await clear(app);
    await ribbon(app).getByRole('tab', { name: 'View' }).click();
    await expect(ribbon(app).getByRole('tab', { name: 'View' })).toHaveAttribute('aria-selected', 'true');

    await select(app, [rect.id]);
    await expect(ribbon(app).getByRole('tab', { name: 'Markup Format' })).toHaveAttribute('aria-selected', 'true');
    await clear(app);
    await expect(ribbon(app).getByRole('tab', { name: 'View' })).toHaveAttribute('aria-selected', 'true');

    // A tab picked while the markup stays selected is kept.
    await select(app, [rect.id]);
    await expect(ribbon(app).getByRole('tab', { name: 'Markup Format' })).toHaveAttribute('aria-selected', 'true');
    await ribbon(app).getByRole('tab', { name: 'Home' }).click();
    await expect(ribbon(app).getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    await clear(app);
    await expect(ribbon(app).getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
  });

  test('three areas change together in one undo step', async ({ app }) => {
    const ids: string[] = [];
    for (const dy of [0, 120, 240]) ids.push((await draw(app, 'area', roomAt(dy))).id);
    const before = await fillOpacities(app, ids);
    await select(app, ids);
    const tab = ribbon(app).getByRole('tab', { name: 'Markup Format' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    const field = ribbon(app).getByRole('textbox', { name: 'Fill opacity', exact: true });
    await field.fill('40');
    await field.press('Enter');
    await expect.poll(() => fillOpacities(app, ids)).toEqual([0.4, 0.4, 0.4]);

    await app.cmd('edit.undo');
    await expect.poll(() => fillOpacities(app, ids)).toEqual(before);
  });

  test('a mixed selection shows the tab with only the fields its types share', async ({ app }) => {
    const area = await draw(app, 'area', roomAt(0));
    const count = await draw(app, 'count', PLAN.symbols, 'enter');
    await select(app, [area.id, count.id]);
    await expect(ribbon(app).getByRole('tab', { name: 'Markup Format' })).toHaveAttribute('aria-selected', 'true');
    await expect(ribbon(app).getByRole('button', { name: 'Line color' })).toBeVisible();
    await expect(ribbon(app).getByRole('button', { name: 'Fill color' })).toBeVisible();
    await expect(ribbon(app).getByRole('textbox', { name: 'Opacity', exact: true })).toBeVisible();
    // An area hatches and dashes; a count does neither.
    await expect(ribbon(app).getByRole('button', { name: /Hatch/ })).toHaveCount(0);
    await expect(ribbon(app).getByTitle('Line style')).toHaveCount(0);
    // Their line colors differ.
    await expect(ribbon(app).getByRole('button', { name: 'Line color' })).toHaveAttribute('data-mixed', 'true');
  });
});
