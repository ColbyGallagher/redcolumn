import { expect, test, type App } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// The Takeoff ribbon tab: an estimator's workspace made of commands that exist elsewhere, plus
// Cutout (which needs an area selected) and Sync to Excel.

// The ribbon's commands, and its tabs, which sit in the menu bar's row.
const ribbon = (app: App) => app.page.locator('.ribbon, .rb-tabs');
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
    for (const group of ['Setup', 'Measure', 'Assembly', 'Manual', 'Slope', 'Estimating', 'Auto Count', 'Output']) await expect(ribbon(app).getByRole('group', { name: group, exact: true })).toBeVisible();
    for (const id of ['calibrate', 'length', 'polylength', 'area', 'count', 'visualSearch']) await expect(tool(app, id)).toBeVisible();
    for (const id of ['document.scaleRegions', 'document.scaleReview', 'document.labelRegions', 'batch.pageLabels', 'tool.cutout', 'tools.nextMeasure', 'takeoff.manual', 'takeoff.hip', 'takeoff.valley', 'tools.assemblies', 'tools.quantities', 'tools.takeoffReview', 'takeoff.items', 'takeoff.productLists', 'takeoff.templates', 'takeoff.saveTemplate', 'takeoff.syncExcel', 'tools.columns'])
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

  test('the Assembly group picks the assembly and sets its variables, for the next markups then the selected one', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => {
      const store = (window.__nb.tools as unknown as { store: { setAssemblies(a: unknown[]): void } }).store;
      store.setAssemblies([
        {
          id: 'ftg',
          name: 'Strip footing',
          variables: [
            { name: 'Width', value: 2, unit: 'ft' },
            { name: 'Thickness', value: 1, unit: 'ft' },
          ],
          items: [{ id: 'conc', name: 'Concrete', unit: 'cf', formula: '[Length] * [Width] * [Thickness]' }],
        },
        { id: 'curb', name: 'Curb', variables: [], items: [{ id: 'c', name: 'Curb', unit: 'lf', formula: '[Length]' }] },
      ]);
    });
    await app.tool('length');
    await openTab(app);
    const group = ribbon(app).getByRole('group', { name: 'Assembly', exact: true });
    const variables = group.getByRole('button', { name: 'Variables ▾' });
    const applies = group.getByTestId('assembly-applies');
    // No assembly yet: no variables to set.
    await expect(variables).toBeDisabled();
    await group.getByLabel('Takeoff assembly').selectOption({ label: 'Strip footing' });
    await expect(applies).toHaveText('Next markups');

    // Before drawing: the values the next markups take.
    await variables.click();
    const pop = page.getByRole('dialog', { name: 'Assembly variables' });
    await expect(pop).toContainText('Applies to: Next markups');
    await expect(pop.getByLabel('Input Width')).toHaveValue('2');
    await pop.getByLabel('Input Thickness').fill('1.5');
    await variables.click();
    await expect(pop).toBeHidden();
    expect((await app.toolState()).tool).toBe('length');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    const [run] = await app.raw();
    expect(run).toMatchObject({ assemblyId: 'ftg', subject: 'Strip footing', assemblyInputs: { Thickness: 1.5 } });

    // Selected: the change goes to that measurement, keeping its other input.
    await app.tool('select');
    await page.evaluate((id) => window.__nb.tools.select([id]), String(run!.id));
    await openTab(app);
    await expect(applies).toHaveText('1 measurement selected');
    await variables.click();
    await expect(pop).toContainText('Applies to: 1 measurement selected');
    await expect(pop.getByLabel('Input Thickness')).toHaveValue('1.5');
    const inputs = async () => (await app.raw()).find((m) => m.id === run!.id)!.assemblyInputs;
    // Typed slowly, one key at a time: applied once, on Enter, as one undo step.
    const width = pop.getByLabel('Input Width');
    await width.fill('');
    await width.pressSequentially('3.5', { delay: 400 });
    expect(await inputs()).toEqual({ Thickness: 1.5 });
    await width.press('Enter');
    await expect.poll(inputs).toEqual({ Width: 3.5, Thickness: 1.5 });
    await app.cmd('edit.undo');
    await expect.poll(inputs).toEqual({ Thickness: 1.5 });
    await expect(width).toHaveValue('2');
    await width.fill('3');
    await width.press('Enter');
    await expect.poll(inputs).toEqual({ Width: 3, Thickness: 1.5 });
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();

    // Takeoff Quantities follows: 20 ft x 3 ft x 1.5 ft = 90 cf.
    await app.cmd('tools.quantities');
    const totals = page.getByRole('dialog', { name: 'Takeoff quantities' });
    await expect(totals.locator('tbody tr', { has: page.locator('td', { hasText: /^Concrete/ }) }).locator('td').nth(5)).toHaveText('90.00');
    await totals.getByRole('button', { name: 'Close', exact: true }).click();

    // A second run taken off as Curb; with both selected the assemblies differ, so there are no variables to set.
    await page.evaluate(() => window.__nb.tools.select([]));
    await openTab(app);
    await group.getByLabel('Takeoff assembly').selectOption({ label: 'Curb' });
    await app.tool('length');
    await app.clicks([
      [300, 500],
      [500, 500],
    ]);
    const curb = (await app.raw()).find((m) => m.id !== run!.id)!;
    expect(curb).toMatchObject({ assemblyId: 'curb' });
    await app.tool('select');
    await page.evaluate((ids) => window.__nb.tools.select(ids), [String(run!.id), String(curb.id)]);
    await openTab(app);
    await expect(applies).toHaveText('2 measurements selected');
    await expect(group.getByLabel('Takeoff assembly')).toHaveValue('*');
    await expect(variables).toBeDisabled();
    await expect(variables).toHaveAttribute('title', /different assemblies/);

    // Nothing in the ribbon scrolls at the window's minimum width, with an assembly picked and a selection.
    if (test.info().project.name === 'web') {
      await page.setViewportSize({ width: 800, height: 700 });
      const clipped = await ribbon(app).locator('.rb-group').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length);
      expect(clipped).toBe(0);
    }

    // The inputs are saved in the PDF and read back.
    await app.cmd('file.saveAs');
    await expect.poll(async () => (await app.saved()).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const bytes = (await app.saved()).at(-1)!.bytes;
    await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles({ name: 'footing-reopened.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await expect.poll(async () => (await app.documents()).some((d) => d.active && d.name.startsWith('footing-reopened')), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await app.raw()).find((m) => m.assemblyId === 'ftg')?.assemblyInputs).toEqual({ Width: 3, Thickness: 1.5 });
  });

  test('takeoff.syncExcel opens the Excel sync dialog', async ({ app }) => {
    await openTab(app);
    await button(app, 'takeoff.syncExcel').click();
    await expect(app.page.getByRole('dialog', { name: 'Sync markups to Excel' })).toBeVisible();
  });
});
