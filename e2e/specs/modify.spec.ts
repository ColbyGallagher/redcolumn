import { expect, test, type App } from '../support/app.ts';
import type { MarkupInfo } from '../support/driver.ts';

// Edit › Modify: the CAD-style tools (Trim, Extend, Break, Lengthen, Fillet, Chamfer, Join,
// Explode, Mirror, Rotate, Align to Points, Stretch, the arrays and Divide), driven by clicks on
// the page and the options bar, as a user would.

const select = (app: App, ids: string[]) => app.page.evaluate((ids) => window.__nb.tools.select(ids), ids);
const round = (pts: number[][]) => pts.map(([x, y]) => [Math.round(x!), Math.round(y!)]);
const ofType = async (app: App, type: string) => (await app.markups()).filter((m) => m.type === type);
const bar = (app: App) => app.page.locator('.cad-bar');

async function line(app: App, from: [number, number], to: [number, number]): Promise<MarkupInfo> {
  await app.tool('line');
  await app.drag(from, to);
  return (await app.markups()).at(-1)!;
}

async function rect(app: App): Promise<MarkupInfo> {
  await app.tool('rect');
  await app.drag([300, 450], [350, 500]);
  await app.tool('select');
  return (await app.markups()).at(-1)!;
}

test.describe('modify', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('trim cuts between crossing lines; extend reaches the next one', async ({ app }) => {
    await line(app, [300, 450], [500, 450]);
    await line(app, [350, 400], [350, 500]);
    await line(app, [450, 400], [450, 500]);
    await app.cmd('edit.trim');
    await expect(bar(app)).toContainText('Click the part of a line to cut away');
    await app.clicks([[400, 450]]);
    const flat = (await ofType(app, 'line')).filter((m) => m.points.every(([, y]) => Math.round(y!) === 450));
    expect(flat.map((m) => round(m.points)).sort((a, b) => a[0]![0]! - b[0]![0]!)).toEqual([
      [[300, 450], [350, 450]],
      [[450, 450], [500, 450]],
    ]);

    const stub = await line(app, [370, 480], [420, 480]);
    await app.cmd('edit.extend');
    await app.clicks([[415, 480]]);
    const grown = (await app.markups()).find((m) => m.id === stub.id)!;
    expect(round(grown.points)).toEqual([[370, 480], [450, 480]]);
  });

  test('break takes a gap out of a line; lengthen doubles one by percent', async ({ app }) => {
    await line(app, [300, 550], [500, 550]);
    await app.cmd('edit.break');
    await app.clicks([[350, 550], [400, 550]]);
    const pieces = await ofType(app, 'line');
    expect(pieces.map((m) => round(m.points)).sort((a, b) => a[0]![0]! - b[0]![0]!)).toEqual([
      [[300, 550], [350, 550]],
      [[400, 550], [500, 550]],
    ]);
    await app.cmd('edit.lengthen');
    await bar(app).getByLabel('Lengthen by').selectOption('percent');
    await bar(app).getByLabel('Lengthen value').fill('200');
    await app.clicks([[495, 550]]);
    const longer = (await ofType(app, 'line')).find((m) => Math.round(m.points[0]![0]!) === 400)!;
    expect(round(longer.points)).toEqual([[400, 550], [600, 550]]);
  });

  test('fillet meets two lines at a corner; chamfer cuts one', async ({ app }) => {
    const a = await line(app, [300, 450], [380, 450]);
    const b = await line(app, [400, 470], [400, 550]);
    await app.cmd('edit.fillet');
    await bar(app).getByLabel('Radius').fill('');
    await app.clicks([[340, 450], [400, 510]]);
    const after = await app.markups();
    expect(round(after.find((m) => m.id === a.id)!.points)).toEqual([[300, 450], [400, 450]]);
    expect(round(after.find((m) => m.id === b.id)!.points)).toEqual([[400, 450], [400, 550]]);

    await app.cmd('edit.chamfer');
    await bar(app).getByLabel('Distance').fill('0.1');
    await app.clicks([[340, 450], [400, 510]]);
    expect(await ofType(app, 'line')).toHaveLength(3);
    await bar(app).getByLabel('Distance').fill('');
  });

  test('join chains touching lines into a polyline; explode splits it again', async ({ app }) => {
    const a = await line(app, [300, 450], [350, 450]);
    const b = await line(app, [350, 450], [350, 500]);
    await select(app, [a.id, b.id]);
    await app.cmd('edit.join');
    const joined = await app.markups();
    expect(joined).toHaveLength(1);
    expect(joined[0]!.type).toBe('polyline');
    expect(round(joined[0]!.points)).toEqual([[300, 450], [350, 450], [350, 500]]);
    await app.cmd('edit.explode');
    expect(await ofType(app, 'line')).toHaveLength(2);
  });

  test('mirror copies across a line; rotate turns by a typed angle', async ({ app }) => {
    const r = await rect(app);
    await select(app, [r.id]);
    await app.cmd('edit.mirror');
    await app.clicks([[400, 300], [400, 650]]);
    const rects = await ofType(app, 'rect');
    expect(rects).toHaveLength(2);
    const copy = rects.find((m) => m.id !== r.id)!;
    expect(Math.round(Math.min(...copy.points.map(([x]) => x!)))).toBe(450);

    const l = await line(app, [300, 600], [350, 600]);
    await select(app, [l.id]);
    await app.cmd('edit.rotate');
    await bar(app).getByLabel('Rotate angle').fill('90');
    await app.clicks([[300, 600]]);
    // Counter-clockwise on paper: the far end turns up the page.
    const turned = (await app.markups()).find((m) => m.id === l.id)!;
    expect(round(turned.points)).toEqual([[300, 600], [300, 550]]);
  });

  test('align to points moves a markup by two point pairs; stretch drags the points in a window', async ({ app }) => {
    const l = await line(app, [300, 450], [350, 450]);
    await select(app, [l.id]);
    await app.cmd('edit.alignPoints');
    await app.clicks([
      [300, 450],
      [500, 500],
      [350, 450],
      [500, 600],
    ]);
    const aligned = (await app.markups()).find((m) => m.id === l.id)!;
    expect(round(aligned.points)).toEqual([[500, 500], [500, 550]]);

    await app.cmd('edit.stretch');
    await app.clicks([
      [490, 540],
      [510, 560],
      [500, 550],
      [500, 580],
    ]);
    const stretched = (await app.markups()).find((m) => m.id === l.id)!;
    expect(round(stretched.points)).toEqual([[500, 500], [500, 580]]);
  });

  test('polar and path arrays make copies; divide marks a line with a count', async ({ app }) => {
    const r = await rect(app);
    await select(app, [r.id]);
    await app.cmd('edit.arrayPolar');
    await bar(app).getByLabel('Items', { exact: true }).fill('4');
    await app.clicks([[325, 600]]);
    expect(await ofType(app, 'rect')).toHaveLength(4);

    const path = await line(app, [600, 300], [600, 600]);
    await select(app, [r.id]);
    await app.cmd('edit.arrayPath');
    await bar(app).getByLabel('Items', { exact: true }).fill('3');
    await app.clicks([[600, 450]]);
    expect(await ofType(app, 'rect')).toHaveLength(6);

    await app.cmd('edit.divide');
    await bar(app).getByLabel('Divide by').selectOption('count');
    await bar(app).getByLabel('Parts').fill('3');
    await app.clicks([[600, 380]]);
    const [count] = await ofType(app, 'count');
    expect(round(count!.points)).toEqual([
      [600, 400],
      [600, 500],
    ]);
    expect((await app.markups()).some((m) => m.id === path.id)).toBe(true);
  });
});
