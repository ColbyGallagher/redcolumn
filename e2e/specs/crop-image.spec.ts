import { expect, test, type App } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// Crop Image and Reset Crop (Edit › Modify): a picture placed on the plan, cropped by dragging a box
// over it, then shown whole again. The whole picture is kept; only the part shown changes.

type Crop = { x: number; y: number; w: number; h: number };
type Picture = { id: string; points: [number, number][]; crop?: Crop; image: string };

/** Picks picture.png with the Image tool and places it over the plan. */
async function placePicture(app: App): Promise<Picture> {
  if (app.kind === 'desktop') {
    await app.answerOpenDialog(app.fixture('picture.png'));
    await app.cmd('tool.image');
  } else {
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('tool.image');
    await (await chooser).setFiles(app.fixture('picture.png'));
  }
  await expect.poll(async () => (await app.toolState()).tool).toBe('image');
  await app.drag([300, 400], [500, 600]);
  return picture(app);
}

async function picture(app: App): Promise<Picture> {
  const m = (await app.raw()).find((x) => x.type === 'image');
  expect(m, 'a picture on the page').toBeTruthy();
  return m as unknown as Picture;
}

/** The box a picture occupies, from its two points. */
function box(p: Picture) {
  const [[x0, y0], [x1, y1]] = p.points as [[number, number], [number, number]];
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** A point inside a box, at fractions of its width and height. */
const inside = (b: ReturnType<typeof box>, fx: number, fy: number): Pt => [b.x + fx * b.w, b.y + fy * b.h];

function expectClose(actual: number, expected: number, what: string) {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThan(0.5);
}

test.describe('crop image', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('Crop Image keeps the part dragged over, and Reset Crop shows the whole picture again', async ({ app }) => {
    const placed = await placePicture(app);
    const whole = box(placed);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), placed.id);
    expect((await app.command('edit.resetCrop')).enabled, 'nothing to reset yet').toBe(false);

    await app.cmd('edit.cropImage');
    await expect.poll(async () => (await app.toolState()).tool).toBe('cropImage');
    await app.drag(inside(whole, 0.25, 0.25), inside(whole, 0.75, 0.75));

    const cropped = await picture(app);
    expect(cropped.image, 'the whole picture is kept').toBe(placed.image);
    const kept = box(cropped);
    expectClose(kept.x, whole.x + whole.w * 0.25, 'left');
    expectClose(kept.y, whole.y + whole.h * 0.25, 'top');
    expectClose(kept.w, whole.w * 0.5, 'width');
    expectClose(kept.h, whole.h * 0.5, 'height');
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(cropped.crop![k], `crop ${k}`).toBeCloseTo(k === 'x' || k === 'y' ? 0.25 : 0.5, 2);
    // The tool hands back to Select with the cropped picture selected, ready for Reset Crop.
    expect(await app.toolState()).toMatchObject({ tool: 'select', selected: [placed.id] });

    await app.cmd('edit.resetCrop');
    const reset = await picture(app);
    expect(reset.crop).toBeUndefined();
    const again = box(reset);
    for (const k of ['x', 'y', 'w', 'h'] as const) expectClose(again[k], whole[k], `reset ${k}`);
    expect(app.errors).toEqual([]);
  });

  test('a crop is one undo step', async ({ app }) => {
    const placed = await placePicture(app);
    const whole = box(placed);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), placed.id);
    await app.cmd('edit.cropImage');
    await app.drag(inside(whole, 0.1, 0.1), inside(whole, 0.6, 0.6));
    expect((await picture(app)).crop).toBeTruthy();
    await app.cmd('edit.undo');
    const undone = await picture(app);
    expect(undone.crop).toBeUndefined();
    expect(undone.points).toEqual(placed.points);
  });

  test('the right-click menu crops the picture under the pointer', async ({ app }) => {
    const placed = await placePicture(app);
    const whole = box(placed);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), placed.id);
    const c = await app.at(inside(whole, 0.5, 0.5));
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
    await app.page.getByText('Crop Image', { exact: true }).click();
    await expect.poll(async () => (await app.toolState()).tool).toBe('cropImage');
    await app.drag(inside(whole, 0, 0.5), inside(whole, 1, 1));
    const kept = box(await picture(app));
    expectClose(kept.y, whole.y + whole.h * 0.5, 'top');
    expectClose(kept.h, whole.h * 0.5, 'height');
    expectClose(kept.w, whole.w, 'width');
  });

  test('Crop Image needs one picture selected', async ({ app }) => {
    expect((await app.command('edit.cropImage')).enabled).toBe(false);
    await app.tool('rect');
    await app.drag([100, 100], [200, 200]);
    const [rect] = await app.raw();
    await app.page.evaluate((id) => window.__nb.tools.select([id]), rect!.id as string);
    expect((await app.command('edit.cropImage')).enabled, 'not for a rectangle').toBe(false);
  });
});
