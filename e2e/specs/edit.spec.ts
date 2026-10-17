import { expect, test, type App } from '../support/app.ts';
import type { MarkupInfo } from '../support/driver.ts';

// Edit menu commands on three markups with known bounds:
//   r1 rect    x 300-350, y 450-500
//   r2 rect    x 420-500, y 470-520
//   e  ellipse x 560-600, y 400-430
// Together they span x 300-600 (centre 450) and y 400-520 (middle 460).
async function three(app: App) {
  await app.tool('rect');
  await app.drag([300, 450], [350, 500]);
  await app.tool('rect');
  await app.drag([420, 470], [500, 520]);
  await app.tool('ellipse');
  await app.drag([560, 400], [600, 430]);
  await app.tool('select');
  const ms = await app.markups();
  expect(ms.map((m) => m.type)).toEqual(['rect', 'rect', 'ellipse']);
  return ms;
}

const select = (app: App, ids: string[]) => app.page.evaluate((ids) => window.__nb.tools.select(ids), ids);
const selectAll = async (app: App, ms: MarkupInfo[]) => select(app, ms.map((m) => m.id));

/** [x0, y0, x1, y1] of a markup, rounded to the point. */
const box = (m: MarkupInfo) => {
  const xs = m.points.map(([x]) => x);
  const ys = m.points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
};
const boxes = async (app: App) => (await app.markups()).map(box);

test.describe('edit', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  const ALIGN: [string, number[][]][] = [
    ['edit.alignLeft', [[300, 450, 350, 500], [300, 470, 380, 520], [300, 400, 340, 430]]],
    ['edit.alignCenter', [[425, 450, 475, 500], [410, 470, 490, 520], [430, 400, 470, 430]]],
    ['edit.alignRight', [[550, 450, 600, 500], [520, 470, 600, 520], [560, 400, 600, 430]]],
    ['edit.alignTop', [[300, 400, 350, 450], [420, 400, 500, 450], [560, 400, 600, 430]]],
    ['edit.alignMiddle', [[300, 435, 350, 485], [420, 435, 500, 485], [560, 445, 600, 475]]],
    ['edit.alignBottom', [[300, 470, 350, 520], [420, 470, 500, 520], [560, 490, 600, 520]]],
    // Flips mirror each markup across the selection's centre line (x 450, or y 460).
    ['edit.flipHorizontal', [[550, 450, 600, 500], [400, 470, 480, 520], [300, 400, 340, 430]]],
    ['edit.flipVertical', [[300, 420, 350, 470], [420, 400, 500, 450], [560, 490, 600, 520]]],
  ];
  for (const [id, expected] of ALIGN) {
    test(id, async ({ app }) => {
      await selectAll(app, await three(app));
      await app.cmd(id);
      expect(await boxes(app)).toEqual(expected);
      await app.cmd('edit.undo');
      expect(await boxes(app)).toEqual([
        [300, 450, 350, 500],
        [420, 470, 500, 520],
        [560, 400, 600, 430],
      ]);
    });
  }

  test('align needs two or more markups', async ({ app }) => {
    const [r1] = await three(app);
    await select(app, [r1!.id]);
    expect((await app.command('edit.alignLeft')).enabled).toBe(false);
  });

  test('undo and redo', async ({ app }) => {
    await three(app);
    await app.cmd('edit.undo');
    expect((await app.markups()).map((m) => m.type)).toEqual(['rect', 'rect']);
    await app.cmd('edit.redo');
    expect((await app.markups()).map((m) => m.type)).toEqual(['rect', 'rect', 'ellipse']);
  });

  test('undo history jumps back several steps', async ({ app }) => {
    await three(app);
    await app.cmd('edit.undoHistory');
    const dialog = app.page.locator('.modal').filter({ hasText: 'Undo History' });
    await expect(dialog).toBeVisible();
    // Newest first: Add Ellipse, Add Rectangle, Add Rectangle. Undo back to (and including) the second rectangle.
    await dialog.getByText('Add Rectangle').first().click();
    await app.closeModal();
    expect((await app.markups()).map((m) => m.type)).toEqual(['rect']);
  });

  test('select all, then delete', async ({ app }) => {
    const ms = await three(app);
    await app.cmd('edit.selectAll');
    expect((await app.toolState()).selected.sort()).toEqual(ms.map((m) => m.id).sort());
    await app.cmd('edit.delete');
    expect(await app.markups()).toEqual([]);
  });

  test('copy and paste: offset copies, then copies in place', async ({ app }) => {
    await selectAll(app, await three(app));
    await app.cmd('edit.copy');
    await app.cmd('edit.paste');
    await app.cmd('edit.pasteInPlace');
    const b = await boxes(app);
    expect(b).toHaveLength(9);
    // Paste moves the copies by the same amount; paste in place keeps their positions.
    const [dx, dy] = [b[3]![0]! - 300, b[3]![1]! - 450];
    expect(dx).toBeGreaterThan(0);
    expect(b.slice(3, 6)).toEqual([
      [300 + dx, 450 + dy, 350 + dx, 500 + dy],
      [420 + dx, 470 + dy, 500 + dx, 520 + dy],
      [560 + dx, 400 + dy, 600 + dx, 430 + dy],
    ]);
    expect(b.slice(6)).toEqual(b.slice(0, 3));
  });

  test('cut removes, paste puts back', async ({ app }) => {
    await selectAll(app, await three(app));
    await app.cmd('edit.cut');
    expect(await app.markups()).toEqual([]);
    expect((await app.command('edit.paste')).enabled).toBe(true);
    await app.cmd('edit.pasteInPlace');
    expect(await boxes(app)).toEqual([
      [300, 450, 350, 500],
      [420, 470, 500, 520],
      [560, 400, 600, 430],
    ]);
  });

  test('group and ungroup', async ({ app }) => {
    const ms = await three(app);
    await selectAll(app, ms);
    await app.cmd('edit.group');
    const grouped = await app.raw();
    expect(new Set(grouped.map((m) => m.groupId)).size).toBe(1);
    expect(grouped[0]!.groupId).toBeTruthy();
    // Clicking one member selects the whole group.
    await select(app, []);
    await app.clicks([[300, 475]]);
    expect((await app.toolState()).selected).toHaveLength(3);
    await app.cmd('edit.ungroup');
    expect((await app.raw()).every((m) => !m.groupId)).toBe(true);
  });

  test('lock stops a markup moving', async ({ app }) => {
    const [r1] = await three(app);
    await select(app, [r1!.id]);
    await app.cmd('edit.lock');
    expect((await app.markups())[0]!.locked).toBe(true);
    expect((await app.command('edit.lock')).checked).toBe(true);
    await app.drag([325, 475], [425, 575]);
    expect(box((await app.markups())[0]!)).toEqual([300, 450, 350, 500]);
    // Nor can it be deleted.
    await select(app, [r1!.id]);
    await app.cmd('edit.delete');
    expect((await app.markups()).map((m) => m.id)).toContain(r1!.id);
    // The same command unlocks.
    await select(app, [r1!.id]);
    await app.cmd('edit.lock');
    expect((await app.markups())[0]!.locked).toBeUndefined();
  });

  test('hide and show hidden', async ({ app }) => {
    const [r1] = await three(app);
    await select(app, [r1!.id]);
    await app.cmd('edit.hide');
    expect((await app.markups()).filter((m) => m.hidden).map((m) => m.id)).toEqual([r1!.id]);
    expect((await app.command('edit.showHidden')).enabled).toBe(true);
    await app.cmd('edit.showHidden');
    expect((await app.markups()).some((m) => m.hidden)).toBe(false);
  });

  test('stacking order', async ({ app }) => {
    const [r1, r2, e] = await three(app);
    // Markups stack in creation order (createdAt): later ones draw on top.
    const order = async () => (await app.raw()).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).map((m) => m.id);
    expect(await order()).toEqual([r1!.id, r2!.id, e!.id]);
    await select(app, [r1!.id]);
    await app.cmd('edit.bringToFront');
    expect(await order()).toEqual([r2!.id, e!.id, r1!.id]);
    await app.cmd('edit.sendToBack');
    expect(await order()).toEqual([r1!.id, r2!.id, e!.id]);
    await app.cmd('edit.bringForward');
    expect(await order()).toEqual([r2!.id, r1!.id, e!.id]);
    await app.cmd('edit.sendBackward');
    expect(await order()).toEqual([r1!.id, r2!.id, e!.id]);
  });

  test('format painter copies a style', async ({ app }) => {
    const [r1, r2] = await three(app);
    await app.assistant('update_markup', { id: r1!.id, style: { stroke: '#0000ff', width: 4 } });
    await select(app, [r1!.id]);
    await app.cmd('edit.formatPainter');
    expect((await app.toolState()).tool).toBe('painter');
    await app.clicks([[460, 470]]);
    const after = (await app.raw()).find((m) => m.id === r2!.id)!;
    expect(after.style).toMatchObject({ stroke: '#0000ff', width: 4 });
  });

  test('multiply copies into a grid', async ({ app }) => {
    await app.calibrate();
    const [r1] = await three(app);
    await select(app, [r1!.id]);
    await app.cmd('edit.multiply');
    const dialog = app.page.locator('.modal').filter({ hasText: 'Multiply' });
    await dialog.locator('#mult-cols').fill('3');
    await dialog.locator('#mult-gapx').fill('5');
    await dialog.locator('#mult-rows').fill('2');
    await dialog.locator('#mult-gapy').fill('10');
    await dialog.locator('button[type=submit]').click();
    // A 50 x 50 pt rect; gaps of 5 ft (50 pt) across and 10 ft (100 pt) down at 100 pt = 10 ft.
    const rects = (await app.markups()).filter((m) => m.type === 'rect').map(box);
    for (const [x, y] of [
      [300, 450],
      [400, 450],
      [500, 450],
      [300, 600],
      [400, 600],
      [500, 600],
    ])
      expect(rects, `copy at ${x},${y}`).toContainEqual([x!, y!, x! + 50, y! + 50]);
    expect(rects).toHaveLength(7); // six in the grid plus r2
  });

  test('offset draws a parallel copy through the click', async ({ app }) => {
    const [r1] = await three(app);
    await select(app, [r1!.id]);
    await app.cmd('edit.offset');
    expect((await app.toolState()).tool).toBe('offset');
    // 10 pt outside the right edge (x 350): the copy is 10 pt bigger all round.
    await app.clicks([[360, 475]]);
    const b = await boxes(app);
    expect(b).toHaveLength(4);
    expect(b[3]).toEqual([290, 440, 360, 510]);
  });

  test('offset picks a shape and makes copies at a typed distance', async ({ app }) => {
    await three(app);
    await select(app, []);
    await app.cmd('edit.offset');
    const bar = app.page.locator('.cad-bar');
    await expect(bar).toContainText('Click a line or shape to offset');
    await bar.getByLabel('Distance').fill('0.005');
    await bar.getByLabel('Copies').fill('2');
    // The first click picks r1, the second puts two copies outside it, each the distance further.
    await app.clicks([[300, 475]]);
    await expect(bar).toContainText('Click the side for the copies');
    await app.clicks([[380, 475]]);
    const b = await boxes(app);
    expect(b).toHaveLength(5);
    const step = 300 - b[3]![0]!;
    expect(step).toBeGreaterThan(0);
    expect(300 - b[4]![0]!).toBeCloseTo(2 * step, -0.5);
    expect((await app.toolState()).tool).toBe('offset');
    await bar.getByLabel('Distance').fill('');
    await bar.getByLabel('Copies').fill('1');
  });

  test('Scale to Length resizes from two reference points', async ({ app }) => {
    await app.calibrate();
    await app.tool('line');
    await app.drag([300, 450], [400, 450]);
    const [line] = await app.markups();
    await select(app, [line!.id]);
    await app.cmd('edit.scaleToLength');
    expect((await app.toolState()).tool).toBe('scaleLength');
    await app.clicks([
      [300, 450],
      [400, 450],
    ]);
    const dialog = app.page.locator('.modal').filter({ hasText: 'Scale to length' });
    // 100 pt at 100 pt = 10 ft.
    await expect(dialog).toContainText(`10'-0" apart`);
    await dialog.getByLabel('New length').fill('20');
    await expect(dialog).toContainText('Scales by ×2.');
    await dialog.locator('button[type=submit]').click();
    // The first point stays put; the line doubles.
    expect(box((await app.markups())[0]!)).toEqual([300, 450, 500, 450]);
  });

  test('check spelling finds a typo in a markup', async ({ app }) => {
    await app.tool('text');
    await app.drag([300, 450], [500, 500]);
    await app.page.keyboard.type('Check teh layout');
    await app.page.keyboard.press('Control+Enter');
    await app.cmd('edit.checkSpelling');
    const dialog = app.page.locator('.modal').filter({ hasText: 'Check Spelling' });
    await expect(dialog).toContainText('teh');
    await expect(dialog).not.toContainText('No spelling mistakes found.');
  });

  test('check spelling with nothing wrong', async ({ app }) => {
    await app.tool('text');
    await app.drag([300, 450], [500, 500]);
    await app.page.keyboard.type('Check the layout');
    await app.page.keyboard.press('Control+Enter');
    await app.cmd('edit.checkSpelling');
    await expect(app.page.locator('.modal').filter({ hasText: 'Check Spelling' })).toContainText('No spelling mistakes found.');
  });

  test('edit action opens the link dialog for one markup', async ({ app }) => {
    const [r1] = await three(app);
    await select(app, [r1!.id]);
    await app.cmd('edit.editAction');
    const dialog = app.page.locator('.modal.hyperlink-dialog');
    await dialog.locator('select[aria-label=Page]').selectOption({ label: 'Page 2' });
    await dialog.locator('button[type=submit]').click();
    expect((await app.raw()).find((m) => m.id === r1!.id)!.link).toMatchObject({ kind: 'page', pageIndex: 1 });
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
