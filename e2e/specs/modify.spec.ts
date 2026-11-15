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

/** Picks picture.png with the Image tool, places it beside the mirror line at x = 400 and goes back to Select. */
async function placePicture(app: App) {
  if (app.kind === 'desktop') await app.answerOpenDialog(app.fixture('picture.png'));
  const chooser = app.kind === 'desktop' ? null : app.page.waitForEvent('filechooser');
  await app.cmd('tool.image');
  if (chooser) await (await chooser).setFiles(app.fixture('picture.png'));
  await expect.poll(async () => (await app.toolState()).tool).toBe('image');
  await app.drag([300, 450], [380, 500]);
  await app.tool('select');
  return (await app.raw()).find((m) => m.type === 'image')!;
}

type Raw = Awaited<ReturnType<App['raw']>>[number] | undefined;
const xs = (m: Raw) => (m!.points as number[][]).map(([x]) => x!);
/** Upright, give or take how square the clicked mirror line was. */
const upright = (m: Raw) => Math.abs((m!.rotation as number | undefined) ?? 0) < 0.01;

/** True if each row of picture `b` is the same row of picture `a` read right to left. */
function reversedRows(app: App, a: string, b: string): Promise<boolean> {
  return app.page.evaluate(async ([a, b]) => {
    const rows = async (src: string) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
    };
    const [x, y] = [await rows(a), await rows(b)];
    if (x.w !== y.w || x.h !== y.h) return false;
    for (let r = 0; r < x.h; r++) for (let c = 0; c < x.w; c++) for (let k = 0; k < 4; k++) if (x.d[(r * x.w + c) * 4 + k] !== y.d[(r * x.w + (x.w - 1 - c)) * 4 + k]) return false;
    return true;
  }, [a, b] as [string, string]);
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

  test('mirror keeps a picture upright; with Mirror pictures ticked it reverses it', async ({ app }) => {
    const before = await placePicture(app);
    const id = before.id as string;

    // Unticked: moved across x = 400 and kept upright, its pixels as they were.
    await select(app, [id]);
    await app.cmd('edit.mirror');
    await bar(app).getByLabel('Keep original', { exact: true }).setChecked(false);
    await expect(bar(app).getByLabel('Mirror pictures')).not.toBeChecked();
    await app.clicks([[400, 300], [400, 650]]);
    await expect.poll(async () => Math.round(Math.min(...xs((await app.raw())[0])))).toBe(Math.round(800 - Math.max(...xs(before))));
    const [moved] = await app.raw();
    expect(upright(moved)).toBe(true);
    expect(moved!.image).toBe(before.image);

    // Ticked: mirrored back, and each row of the picture now reads right to left.
    await select(app, [id]);
    await app.cmd('edit.mirror');
    await bar(app).getByLabel('Mirror pictures').setChecked(true);
    await app.clicks([[400, 300], [400, 650]]);
    await expect.poll(async () => (await app.raw())[0]!.image).not.toBe(before.image);
    const [after] = await app.raw();
    expect(upright(after)).toBe(true);
    expect(Math.round(Math.min(...xs(after)))).toBe(Math.round(Math.min(...xs(before))));
    expect(await reversedRows(app, String(before.image), String(after!.image))).toBe(true);

    // One undo puts back both where it was and its pixels.
    await app.cmd('edit.undo');
    const [undone] = await app.raw();
    expect(undone!.image).toBe(before.image);
    expect(undone!.points).toEqual(moved!.points);
  });

  test('Mirror pictures with Keep original reverses the copy and its crop, and leaves the original alone', async ({ app }) => {
    const placed = await placePicture(app);
    const id = placed.id as string;
    // Crop it to about its left half.
    const [[x0, y0], [x1, y1]] = placed.points as [[number, number], [number, number]];
    const w = x1 - x0;
    const h = y1 - y0;
    await select(app, [id]);
    await app.cmd('edit.cropImage');
    await expect.poll(async () => (await app.toolState()).tool).toBe('cropImage');
    await app.drag([x0 + 0.05 * w, y0 + 0.1 * h], [x0 + 0.55 * w, y0 + 0.9 * h]);
    const [original] = await app.raw();
    const crop = original!.crop as { x: number; y: number; w: number; h: number };
    expect(crop).toBeTruthy();

    await select(app, [id]);
    await app.cmd('edit.mirror');
    await bar(app).getByLabel('Keep original', { exact: true }).setChecked(true);
    await bar(app).getByLabel('Mirror pictures').setChecked(true);
    await app.clicks([[400, 300], [400, 650]]);
    await expect.poll(async () => (await app.raw()).filter((m) => m.type === 'image').length).toBe(2);
    const pictures = (await app.raw()).filter((m) => m.type === 'image');
    const kept = pictures.find((m) => m.id === id)!;
    const copy = pictures.find((m) => m.id !== id)!;
    expect(kept.image, 'the original keeps its pixels').toBe(original!.image);
    expect(kept.crop).toEqual(crop);
    expect(await reversedRows(app, String(original!.image), String(copy.image))).toBe(true);
    // The copy shows the same part of the picture, now on the other side of the reversed pixels.
    const turned = copy.crop as typeof crop;
    expect(turned.x).toBeCloseTo(1 - crop.x - crop.w, 6);
    expect([turned.y, turned.w, turned.h]).toEqual([crop.y, crop.w, crop.h]);
    expect(upright(copy)).toBe(true);

    // One undo takes the copy away.
    await app.cmd('edit.undo');
    const left = (await app.raw()).filter((m) => m.type === 'image');
    expect(left.map((m) => m.id)).toEqual([id]);
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

  test('move and copy by base point, scale by a factor', async ({ app }) => {
    const l = await line(app, [300, 450], [350, 450]);
    await select(app, [l.id]);
    await app.cmd('edit.move');
    await app.clicks([
      [300, 450],
      [320, 470],
    ]);
    expect(round((await app.markups()).find((m) => m.id === l.id)!.points)).toEqual([
      [320, 470],
      [370, 470],
    ]);
    await select(app, [l.id]);
    await app.cmd('edit.copyBase');
    await app.clicks([
      [320, 470],
      [320, 520],
      [320, 570],
    ]);
    expect(await ofType(app, 'line')).toHaveLength(3);
    await app.page.keyboard.press('Escape');
    await select(app, [l.id]);
    await app.cmd('edit.scale');
    await bar(app).getByLabel('Scale factor').fill('2');
    await app.clicks([[320, 470]]);
    expect(round((await app.markups()).find((m) => m.id === l.id)!.points)).toEqual([
      [320, 470],
      [420, 470],
    ]);
  });

  test('select similar, reverse and convert to cloud', async ({ app }) => {
    const a = await line(app, [300, 450], [350, 450]);
    await line(app, [300, 500], [350, 500]);
    await app.tool('rect');
    await app.drag([450, 450], [500, 500]);
    await select(app, [a.id]);
    await app.cmd('edit.selectSimilar');
    expect((await app.toolState()).selected).toHaveLength(2);
    await select(app, [a.id]);
    await app.cmd('edit.reverse');
    expect(round((await app.markups()).find((m) => m.id === a.id)!.points)).toEqual([
      [350, 450],
      [300, 450],
    ]);
    const [box] = await ofType(app, 'rect');
    await select(app, [box!.id]);
    await app.cmd('edit.toCloud');
    expect((await app.markups()).find((m) => m.id === box!.id)!.type).toBe('cloud');
  });
});
