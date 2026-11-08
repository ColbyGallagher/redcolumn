import { expect, test, type App } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// Window versus crossing selection on plan.pdf. The room is x 300-500, y 200-300 (an area
// measurement, drawn from its corners); the polyline is long and thin, up at y 100.
const ROOM: Pt[] = [[300, 200], [500, 200], [500, 300], [300, 300]];
const LONG: Pt[] = [[600, 100], [800, 100], [800, 160], [1000, 160]];

async function seed(app: App) {
  await app.calibrate();
  await app.tool('area');
  await app.clicks([...ROOM, ROOM[0]!]);
  await app.tool('polyline');
  await app.clicks(LONG, 'enter');
  await app.tool('select');
  const ms = await app.markups();
  const area = ms.find((m) => m.type === 'area')!;
  const line = ms.find((m) => m.type === 'polyline')!;
  expect(area && line).toBeTruthy();
  return { area: area.id, line: line.id };
}

const selected = async (app: App) => (await app.toolState()).selected.sort();

test.describe('window and crossing selection', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('right to left across one edge of an area selects it, left to right over the same part does not', async ({ app }) => {
    const { area } = await seed(app);
    // The box covers the room's right edge and a bit beyond: x 460-540, y 150-250.
    await app.drag([460, 150], [540, 250]);
    expect(await selected(app)).toEqual([]);
    await app.drag([540, 150], [460, 250]);
    expect(await selected(app)).toEqual([area]);
  });

  test('left to right takes what the box encloses', async ({ app }) => {
    const { area, line } = await seed(app);
    await app.drag([280, 180], [520, 320]);
    expect(await selected(app)).toEqual([area]);
    await app.drag([580, 80], [1020, 180]);
    expect(await selected(app)).toEqual([line]);
  });

  test('a lasso that crosses part of a polyline selects it', async ({ app }) => {
    const { line } = await seed(app);
    await app.tool('lasso');
    const loop: Pt[] = [[780, 120], [840, 120], [840, 200], [780, 200], [780, 120]];
    const start = await app.at(loop[0]!);
    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    for (const p of loop) {
      const c = await app.at(p);
      await app.page.mouse.move(c.x, c.y, { steps: 4 });
    }
    await app.page.mouse.up();
    expect(await selected(app)).toEqual([line]);
  });

  test('Shift+click toggles, Ctrl+A selects all, Esc and empty space clear', async ({ app }) => {
    const { area, line } = await seed(app);
    // The view can shift when the selection changes, so each point is found just before its click.
    const click = async (p: Pt) => {
      const c = await app.at(p);
      await app.page.mouse.click(c.x, c.y);
    };
    await click([400, 250]);
    expect(await selected(app)).toEqual([area]);
    await app.page.keyboard.down('Shift');
    await click([700, 100]);
    expect(await selected(app)).toEqual([area, line].sort());
    await click([400, 250]);
    await app.page.keyboard.up('Shift');
    expect(await selected(app)).toEqual([line]);
    await app.page.keyboard.press('Escape');
    expect(await selected(app)).toEqual([]);
    await app.page.keyboard.press('Control+a');
    expect(await selected(app)).toEqual([area, line].sort());
    await click([700, 500]);
    expect(await selected(app)).toEqual([]);
  });
});
