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

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
