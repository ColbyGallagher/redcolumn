import { expect, test, type App } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// The Markup Format tab follows the selection: selecting markups switches the ribbon to it, clearing
// the selection goes back, and edits apply to everything selected as one undo step.

const r = PLAN.room;
const roomAt = (dy: number): Pt[] => {
  const pts: Pt[] = [[r.x, r.y + dy], [r.x + r.w, r.y + dy], [r.x + r.w, r.y + r.h + dy], [r.x, r.y + r.h + dy]];
  return [...pts, pts[0]!];
};

// The ribbon's commands, and its tabs, which sit in the menu bar's row.
const ribbon = (app: App) => app.page.locator('.ribbon, .rb-tabs');
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

  test('the Subject field shows the name the Markups list gives a markup with no subject of its own', async ({ app }) => {
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    await app.tool('select');
    const rect = (await app.markups()).at(-1)!;
    await select(app, [rect.id]);
    const subject = ribbon(app).getByLabel('Subject', { exact: true });
    await expect(subject).toHaveValue('Rectangle');
    await subject.fill('Slab edge');
    await subject.press('Enter');
    await expect.poll(() => app.page.evaluate((id) => (window.__nb.tools.store as unknown as { get(id: string): { subject?: string } }).get(id)?.subject, rect.id)).toBe('Slab edge');
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

  test('selected volumes take one Depth in one undo step; Mixed left blank changes nothing', async ({ app }) => {
    const ids: string[] = [];
    for (const dy of [0, 120]) ids.push((await draw(app, 'volume', roomAt(dy))).id);
    const depths = () =>
      app.page.evaluate((ids) => {
        const store = window.__nb.tools.store as unknown as { get(id: string): { depth?: number } };
        return ids.map((id) => Math.round((store.get(id).depth ?? 0) * 1e4) / 1e4);
      }, ids);
    const field = ribbon(app).getByRole('textbox', { name: 'Depth', exact: true });

    await select(app, [ids[0]!]);
    await field.fill(`2'-0"`);
    await field.press('Enter');
    await expect.poll(depths).toEqual([0.6096, 0]);

    await select(app, ids);
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Mixed');
    await field.focus();
    await field.blur();
    expect(await depths()).toEqual([0.6096, 0]);

    await field.fill('3');
    await field.press('Enter');
    await expect.poll(depths).toEqual([0.9144, 0.9144]);
    await expect(field).toHaveValue(`3'-0"`);
    await app.cmd('edit.undo');
    await expect.poll(depths).toEqual([0.6096, 0]);

    // Only volumes get the field.
    const area = await draw(app, 'area', roomAt(240));
    await select(app, [ids[0]!, area.id]);
    await expect(ribbon(app).getByLabel('Subject', { exact: true })).toBeVisible();
    await expect(field).toHaveCount(0);
  });
});

// The Units & Scale group sits in the Markup Format tab while measuring: the units (Preferences ›
// Units, one setting) and the page's scale, without going to the bottom of the window.
test.describe('markup format tab: units and scale', () => {
  test.use({ toolbar: 'ribbon' });

  const pageScale = (app: App) =>
    app.page.evaluate(() => {
      const store = window.__nb.tools.store as unknown as { scaleFor(page: number): { unit: string; label: string; metersPerPoint: number } };
      const s = store.scaleFor(0);
      return { unit: s.unit, label: s.label, metersPerPoint: s.metersPerPoint };
    });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await setScale(app);
  });

  test('a measure tool shows the group with the page scale, a plain markup tool does not', async ({ app }) => {
    await app.tool('rect');
    await expect(ribbon(app).getByRole('tab', { name: 'Markup Format' })).toHaveAttribute('aria-selected', 'true');
    await expect(ribbon(app).getByRole('group', { name: 'Units & Scale' })).toHaveCount(0);
    await app.tool('length');
    const group = ribbon(app).getByRole('group', { name: 'Units & Scale' });
    await expect(group).toBeVisible();
    // The page's own (calibrated) scale is the one shown.
    await expect(group.getByLabel('Scale', { exact: true })).toContainText('Calibrated');
  });

  test('switching the units rewords the page scale and keeps its size', async ({ app }) => {
    const line = await draw(app, 'length', [[r.x, r.y], [r.x + 100, r.y]]);
    await select(app, [line.id]);
    const group = ribbon(app).getByRole('group', { name: 'Units & Scale' });
    await expect(group).toBeVisible();
    await expect(group.getByLabel('Units', { exact: true })).toHaveValue('imperial');
    expect((await pageScale(app)).unit).toBe('ft');

    await group.getByLabel('Units', { exact: true }).selectOption('metric');
    await expect.poll(async () => (await pageScale(app)).unit).toBe('m');
    // Same size: 100 pt was 10 feet (3.048 m).
    expect((await pageScale(app)).metersPerPoint).toBeCloseTo(3.048 / 100, 6);
    await expect(group.getByLabel('Length unit')).toHaveValue('m');

    await group.getByLabel('Length unit').selectOption('mm');
    await expect.poll(async () => (await pageScale(app)).unit).toBe('mm');

    await group.getByLabel('Units', { exact: true }).selectOption('imperial');
    await expect.poll(async () => (await pageScale(app)).unit).toBe('ft');
  });
});
