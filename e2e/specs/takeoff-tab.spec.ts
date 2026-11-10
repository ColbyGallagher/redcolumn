import { expect, test, type App } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// The Takeoff ribbon tab: an estimator's workspace made of commands that exist elsewhere, plus
// Cutout (which needs an area selected) and Sync to Excel.

const ribbon = (app: App) => app.page.locator('.ribbon');
const button = (app: App, id: string) => ribbon(app).locator(`[data-ribbon-command="${id}"]`);
const tool = (app: App, id: string) => ribbon(app).locator(`[data-toolbar-tool="${id}"]`);
const openTab = (app: App) => ribbon(app).getByRole('tab', { name: 'Takeoff' }).click();

const r = PLAN.room;
const room: Pt[] = [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
  [r.x, r.y],
];
// A 5 ft x 5 ft hole (50 pt at 100 pt = 10 ft) inside the 20 ft x 10 ft room.
const hole: Pt[] = [
  [r.x + 20, r.y + 20],
  [r.x + 70, r.y + 20],
  [r.x + 70, r.y + 70],
  [r.x + 20, r.y + 70],
  [r.x + 20, r.y + 20],
];

test.describe('takeoff tab', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('has its groups and buttons, after the Measure tab', async ({ app }) => {
    const tabs = await ribbon(app).getByRole('tab').allTextContents();
    expect(tabs.indexOf('Takeoff')).toBe(tabs.indexOf('Measure') + 1);
    await openTab(app);
    for (const group of ['Setup', 'Measure', 'Estimating', 'Auto Count', 'Output']) await expect(ribbon(app).getByRole('group', { name: group, exact: true })).toBeVisible();
    for (const id of ['calibrate', 'length', 'polylength', 'area', 'count', 'visualSearch']) await expect(tool(app, id)).toBeVisible();
    for (const id of ['document.scaleRegions', 'document.scaleReview', 'document.labelRegions', 'batch.pageLabels', 'tool.cutout', 'tools.nextMeasure', 'tools.assemblies', 'tools.quantities', 'tools.takeoffReview', 'takeoff.syncExcel', 'tools.columns'])
      await expect(button(app, id)).toBeVisible();

    // Nothing in the group scrolls: it spreads out instead.
    const clipped = await ribbon(app).locator('.rb-group').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length);
    expect(clipped).toBe(0);

    // The Measure tab no longer carries the takeoff group.
    await ribbon(app).getByRole('tab', { name: 'Measure' }).click();
    await expect(ribbon(app).getByRole('group', { name: 'Takeoff', exact: true })).toHaveCount(0);
  });

  test('a measure tool picked on the tab arms the tool', async ({ app }) => {
    await openTab(app);
    await tool(app, 'length').click();
    expect((await app.toolState()).tool).toBe('length');
  });

  test('tool.cutout: needs an area selected, then cuts a hole and the net area drops', async ({ app }) => {
    await app.tool('area');
    await app.clicks(room);
    const [area] = await app.markups();
    expect(area).toMatchObject({ type: 'area', measurement: '200.00 sf' });

    // Nothing selected: the button is disabled and says why.
    await app.page.evaluate(() => window.__nb.tools.select([]));
    await openTab(app);
    await expect(button(app, 'tool.cutout')).toBeDisabled();
    await expect(button(app, 'tool.cutout')).toHaveAttribute('title', 'Select one unlocked area or volume first');

    // With the area selected the button works, and the cutout is drawn inside it.
    await app.page.evaluate((id) => window.__nb.tools.select([id]), area!.id);
    await openTab(app);
    await expect(button(app, 'tool.cutout')).toBeEnabled();
    await button(app, 'tool.cutout').click();
    expect((await app.toolState()).tool).toBe('cutout');
    expect((await app.command('tool.cutout')).checked).toBe(true);
    await app.clicks(hole);

    const raw = (await app.raw()).filter((m) => m.type === 'area');
    expect(raw).toHaveLength(1);
    expect(raw[0]!.holes).toHaveLength(1);
    expect((await app.markups())[0]!.measurement).toBe('175.00 sf');
  });

  test('takeoff.syncExcel opens the Excel sync dialog', async ({ app }) => {
    await openTab(app);
    await button(app, 'takeoff.syncExcel').click();
    await expect(app.page.getByRole('dialog', { name: 'Sync markups to Excel' })).toBeVisible();
  });
});
