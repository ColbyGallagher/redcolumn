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
    for (const group of ['Setup', 'Measure', 'Manual', 'Slope', 'Estimating', 'Auto Count', 'Output']) await expect(ribbon(app).getByRole('group', { name: group, exact: true })).toBeVisible();
    for (const id of ['calibrate', 'length', 'polylength', 'area', 'count', 'visualSearch']) await expect(tool(app, id)).toBeVisible();
    for (const id of ['document.scaleRegions', 'document.scaleReview', 'document.labelRegions', 'batch.pageLabels', 'tool.cutout', 'tools.nextMeasure', 'takeoff.manual', 'takeoff.hip', 'takeoff.valley', 'tools.assemblies', 'tools.quantities', 'tools.takeoffReview', 'takeoff.syncExcel', 'tools.columns'])
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

  test('takeoff.hip and takeoff.valley arm Polylength at the Slope group pitch', async ({ app }) => {
    await openTab(app);
    const slope = ribbon(app).getByRole('group', { name: 'Slope', exact: true });
    await slope.getByLabel('Takeoff slope kind').selectOption('pitch');
    await slope.getByLabel('Takeoff slope', { exact: true }).fill('6');
    await slope.getByLabel('Takeoff slope', { exact: true }).press('Enter');
    await button(app, 'takeoff.hip').click();
    expect((await app.toolState()).tool).toBe('polylength');
    expect((await app.command('takeoff.hip')).checked).toBe(true);
    // 200 pt is 20 ft on plan; a hip between two 6:12 planes is sqrt(1 + 0.25 / 2) longer: 21.213 ft.
    await app.clicks([[300, 450], [500, 450]], 'enter');
    const [hip] = await app.raw();
    expect(hip).toMatchObject({ type: 'polylength', subject: 'Hip', slope: { kind: 'hip', a: { kind: 'pitch', value: 6 } } });
    expect((await app.markups())[0]!.measurement).toBe(`21'-2 9/16"`);

    await openTab(app);
    await button(app, 'takeoff.valley').click();
    expect((await app.command('takeoff.valley')).checked).toBe(true);
    await app.clicks([[300, 500], [500, 500]], 'enter');
    expect((await app.raw()).find((m) => m.subject === 'Valley')).toMatchObject({ type: 'polylength', slope: { kind: 'valley', a: { kind: 'pitch', value: 6 } } });
  });

  test('the Slope group applies to the selected measurement and to the running tool', async ({ app }) => {
    await app.tool('area');
    await app.clicks(room);
    const [area] = await app.markups();
    await app.tool('select');
    await app.page.evaluate((id) => window.__nb.tools.select([id]), area!.id);
    await openTab(app);
    const slope = ribbon(app).getByRole('group', { name: 'Slope', exact: true });
    await slope.getByLabel('Takeoff slope kind').selectOption('degrees');
    await slope.getByLabel('Takeoff slope', { exact: true }).fill('45');
    await slope.getByLabel('Takeoff slope', { exact: true }).press('Enter');
    // 200 sf on plan at 45°: 200 x sqrt(2).
    await expect.poll(async () => (await app.markups())[0]!.measurement).toBe('282.84 sf');

    // With a measure tool running, the next measurement takes it too.
    await app.page.evaluate(() => window.__nb.tools.select([]));
    await app.tool('length');
    await openTab(app);
    await slope.getByLabel('Takeoff slope kind').selectOption('ratio');
    await slope.getByLabel('Rise').fill('1');
    await slope.getByLabel('Rise').press('Enter');
    await slope.getByLabel('Run').fill('4');
    await slope.getByLabel('Run').press('Enter');
    expect((await app.toolState()).tool).toBe('length');
    await app.clicks([[300, 450], [500, 450]]);
    const line = (await app.raw()).find((m) => m.type === 'length');
    expect(line!.slope).toEqual({ kind: 'ratio', rise: 1, run: 4 });
  });

  test('takeoff.syncExcel opens the Excel sync dialog', async ({ app }) => {
    await openTab(app);
    await button(app, 'takeoff.syncExcel').click();
    await expect(app.page.getByRole('dialog', { name: 'Sync markups to Excel' })).toBeVisible();
  });
});
