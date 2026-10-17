import { expect, test } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// Each measuring tool on plan.pdf calibrated at 100 pt = 10 ft. Every expected value is worked out
// from the geometry by hand, not copied from the app's output.
const r = PLAN.room;
const room: Pt[] = [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
];
const closed = [...room, room[0]!];

const CASES: { tool: string; points: readonly Pt[]; finish?: 'enter' | 'dbl'; expected: string; why: string }[] = [
  { tool: 'length', points: [[300, 450], [500, 450]], expected: `20'-0"`, why: '200 pt' },
  { tool: 'polylength', points: [[300, 450], [500, 450], [500, 550]], finish: 'enter', expected: `30'-0"`, why: '200 + 100 pt' },
  { tool: 'area', points: closed, expected: '200.00 sf', why: '20 ft x 10 ft room' },
  { tool: 'perimeter', points: closed, finish: 'enter', expected: `60'-0"`, why: '2 x (20 + 10) ft' },
  { tool: 'diameter', points: [[300, 450], [400, 450]], expected: `10'-0"`, why: '100 pt across' },
  { tool: 'radius', points: [[300, 450], [350, 450]], expected: `5'-0"`, why: '50 pt from the centre' },
  { tool: 'angle', points: [[300, 450], [400, 450], [300, 350]], expected: '45.0°', why: 'vertex at the middle point' },
  { tool: 'arcLength', points: [[300, 450], [400, 350], [500, 450]], expected: `31'-5"`, why: 'half circle, radius 10 ft: 31.42 ft' },
  { tool: 'count', points: PLAN.symbols, finish: 'enter', expected: '5 ea', why: 'five symbols' },
  { tool: 'volume', points: closed, expected: '0.00 cf', why: 'no depth set yet' },
];

test.describe('measure tools', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  for (const c of CASES) {
    test(`${c.tool}: ${c.expected} (${c.why})`, async ({ app }) => {
      await app.tool(c.tool);
      await app.clicks(c.points, c.finish);
      const markups = await app.markups();
      expect(markups).toHaveLength(1);
      expect(markups[0]).toMatchObject({ type: c.tool, page: 1, measurement: c.expected });
      expect(markups[0]!.points).toHaveLength(c.tool === 'area' || c.tool === 'perimeter' || c.tool === 'volume' ? 4 : c.points.length);
      // The value shows in the Measurements panel too.
      await app.panel('Measurements');
      await expect(app.page.locator('.panel', { hasText: c.expected }).first()).toBeVisible();
    });
  }

  test('measurements follow a change of scale', async ({ app }) => {
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    expect((await app.markups())[0]!.measurement).toBe(`20'-0"`);
    await app.scaleSelect().selectOption({ label: `1/4" = 1'-0"` });
    // 200 pt at 18 pt per foot: 11.11 ft, 1.33" to the nearest 1/16".
    expect((await app.markups())[0]!.measurement).toBe(`11'-1 5/16"`);
  });

  test('Escape cancels a measurement in progress', async ({ app }) => {
    await app.tool('polylength');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    await app.page.keyboard.press('Escape');
    expect(await app.markups()).toEqual([]);
  });

  test('undo removes the last measurement', async ({ app }) => {
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    expect(await app.markups()).toHaveLength(1);
    await app.cmd('edit.undo');
    expect(await app.markups()).toEqual([]);
  });

  test('the select tool picks a measurement', async ({ app }) => {
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    const [m] = await app.markups();
    await app.tool('select');
    await app.clicks([[400, 450]]);
    expect((await app.toolState()).selected).toEqual([m!.id]);
  });

  test('Smart Fill measures the room around a click', async ({ app }) => {
    await app.tool('dynamicFill');
    expect((await app.command('tool.dynamicFill')).checked).toBe(true);
    await app.clicks([[r.x + r.w / 2, r.y + r.h / 2]]);
    await expect.poll(async () => (await app.markups()).length).toBe(1);
    const [m] = await app.markups();
    expect(m).toMatchObject({ type: 'area', page: 1 });
    // The fill stops at the inside faces of the 2 pt walls: within 2 grid cells (1224 / 1600 pt
    // each, 1.53 pt in all) inside the walls' centre lines.
    const xs = m!.points.map(([x]) => x);
    const ys = m!.points.map(([, y]) => y);
    const inside = 2 * (PLAN.page.width / 1600);
    for (const [v, edge, dir] of [
      [Math.min(...xs), r.x, 1],
      [Math.max(...xs), r.x + r.w, -1],
      [Math.min(...ys), r.y, 1],
      [Math.max(...ys), r.y + r.h, -1],
    ] as const) {
      expect((v - edge) * dir).toBeGreaterThan(0);
      expect((v - edge) * dir).toBeLessThanOrEqual(inside);
    }
    // So its area is under 20 x 10 ft, by at most that band: (200 - 3.06) x (100 - 3.06) pt.
    const sf = Number(/^([\d.]+) sf$/.exec(m!.measurement ?? '')?.[1]);
    expect(sf).toBeLessThan(200);
    expect(sf).toBeGreaterThan(((r.w - 2 * inside) * (r.h - 2 * inside)) / 100);
  });

  test('Symbol Search finds every copy of a boxed symbol', async ({ app }) => {
    await app.tool('visualSearch');
    expect((await app.command('tool.visualSearch')).checked).toBe(true);
    const [x, y] = PLAN.symbols[0]!;
    const k = PLAN.symbolRadius + 4;
    await app.drag([x - k, y - k], [x + k, y + k]);
    const panel = app.page.locator('.visual-search').filter({ hasText: 'Symbol Search' });
    await expect(panel.locator('.vs-result')).toHaveText(/^5 found/, { timeout: 30_000 });
    // Mark them all as one count: five points, one on each symbol.
    await panel.getByRole('button', { name: 'Count' }).click();
    await expect.poll(async () => (await app.markups()).map((m) => [m.type, m.measurement])).toEqual([['count', '5 ea']]);
    const points = (await app.markups())[0]!.points;
    for (const [sx, sy] of PLAN.symbols) expect(points.some(([px, py]) => Math.hypot(px - sx, py - sy) < 2), `a point on the symbol at ${sx}, ${sy}`).toBe(true);
  });

  test('tools.nextMeasure steps through the measure tools in toolbar order', async ({ app }) => {
    // The Measure toolbar (MEASURE_GROUPS in apps/web/src/components/ToolBar.tsx), then round again.
    const order = ['calibrate', 'length', 'polylength', 'perimeter', 'arcLength', 'diameter', 'radius', 'angle', 'area', 'volume', 'dynamicFill', 'count', 'visualSearch', 'calibrate'];
    const seen: string[] = [];
    for (let i = 0; i < order.length; i++) {
      await app.cmd('tools.nextMeasure');
      seen.push((await app.toolState()).tool);
    }
    expect(seen).toEqual(order);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

// Draw to Scale on plan.pdf calibrated at 100 pt = 10 ft: typed sizes become exact page lengths.
test.describe('draw to scale', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('tools.sketchToScale toggles, and lines take a typed length and angle', async ({ app }) => {
    expect((await app.command('tools.sketchToScale')).checked).toBe(false);
    await app.cmd('tools.sketchToScale');
    expect((await app.command('tools.sketchToScale')).checked).toBe(true);
    await app.tool('line');
    await app.clicks([[300, 450]]);
    const bar = app.page.locator('form.sketch-bar');
    await expect(bar).toBeVisible();
    // 15 ft is 150 pt; 90° is straight up the page (counterclockwise from east, as on paper).
    await bar.getByLabel('Length').fill(`15'`);
    await bar.getByLabel('Angle').fill('90');
    await bar.getByRole('button', { name: 'Place' }).click();
    await expect.poll(async () => (await app.markups()).map((m) => [m.type, m.points.map(([x, y]) => [Math.round(x), Math.round(y)])])).toEqual([
      [
        'line',
        [
          [300, 450],
          [300, 300],
        ],
      ],
    ]);
  });

  test('rectangles take a typed width and height', async ({ app }) => {
    await app.cmd('tools.sketchToScale');
    await app.tool('rect');
    await app.clicks([[300, 450]]);
    const bar = app.page.locator('form.sketch-bar');
    // 20 x 10 ft is 200 x 100 pt, right and down from the corner clicked.
    await bar.getByLabel('Width').fill(`20'`);
    await bar.getByLabel('Height').fill(`10'`);
    await bar.getByRole('button', { name: 'Place' }).click();
    await expect.poll(async () => {
      const [m] = await app.markups();
      if (!m) return null;
      const xs = m.points.map(([x]) => Math.round(x));
      const ys = m.points.map(([, y]) => Math.round(y));
      return [m.type, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }).toEqual(['rect', 300, 450, 500, 550]);
    await app.cmd('tools.sketchToScale');
    expect((await app.command('tools.sketchToScale')).checked).toBe(false);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

test.describe('assemblies', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('tools.assemblies and tools.quantities: a wall taken off as studs and board', async ({ app }) => {
    const { page } = app;
    await app.cmd('tools.assemblies');
    const dialog = page.getByRole('dialog', { name: 'Assemblies' });
    await dialog.getByRole('button', { name: 'Examples ▾' }).click();
    // The page is in feet, so the examples are too: studs at 16" (1.333 ft), 9 ft walls, 4 x 8 sheets.
    await dialog.getByRole('menuitem', { name: 'Interior partition, studs and board both sides' }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    // With nothing selected, the assembly applies to the next measurement.
    await app.panel('Measurements');
    await page.getByLabel('Assembly', { exact: true }).selectOption({ label: 'Interior partition, studs and board both sides' });
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    const [wall] = await app.raw();
    expect(wall).toMatchObject({ type: 'length', subject: 'Interior partition, studs and board both sides' });
    expect(wall!.assemblyId).toBeTruthy();

    await app.cmd('tools.quantities');
    const totals = page.getByRole('dialog', { name: 'Takeoff quantities' });
    const row = (item: string) => totals.locator('tbody tr', { has: page.locator('td', { hasText: new RegExp(`^${item}`) }) });
    // 20 ft / 1.333 + 1 = 16 studs, +10% = 17.6: 18.
    await expect(row('Studs').locator('td').nth(5)).toHaveText('18');
    // 20 ft x 9 ft x 2 sides / 32 sf = 11.25 sheets, +10% = 12.375: 13.
    await expect(row('Gypsum board').locator('td').nth(5)).toHaveText('13');
    // 2 x 20 ft of track, +5% = 42 lf (not rounded).
    await expect(row('Track, top and bottom').locator('td').nth(5)).toHaveText('42.00');
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
