import { expect, test, type App } from '../support/app.ts';

// Adjust Image (Edit › Modify › Picture): greyscale, invert and the other adjustments on a picture
// placed on the plan, with a preview, applied to the pictures selected, and one undo step.

type Picture = { id: string; image: string; points: [number, number][] };

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

/** How many pixels of a picture are not grey (red, green and blue differ), and how many are see-through. */
async function colourStats(app: App, image: string) {
  return app.page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let coloured = 0;
    let clear = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) clear++;
      else if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) coloured++;
    }
    return { coloured, clear };
  }, image);
}

test.describe('adjust image', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('Greyscale turns the picture grey, and one undo puts it back', async ({ app }) => {
    const placed = await placePicture(app);
    expect((await colourStats(app, placed.image)).coloured, 'the fixture picture has colour').toBeGreaterThan(0);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), placed.id);
    expect((await app.command('edit.adjustImage')).enabled).toBe(true);

    await app.cmd('edit.adjustImage');
    const dialog = app.page.locator('form.adjust-image');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await dialog.getByLabel('Greyscale').check();
    await dialog.getByRole('button', { name: 'Reset' }).click();
    await expect(dialog.getByLabel('Greyscale')).not.toBeChecked();
    await dialog.getByLabel('Greyscale').check();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();

    const grey = await picture(app);
    expect(grey.image).not.toBe(placed.image);
    expect((await colourStats(app, grey.image)).coloured).toBe(0);

    await app.cmd('edit.undo');
    expect((await picture(app)).image).toBe(placed.image);
    expect(app.errors).toEqual([]);
  });

  test('the right-click menu opens the same dialog, and Make white see-through clears only the light half', async ({ app }) => {
    // The fixture is a red half and a blue half. Greyscale then Invert makes them light grey (179) and
    // near white (226); a cut-off of 204 clears the blue half and keeps the red one.
    const placed = await placePicture(app);
    const before = await colourStats(app, placed.image);
    expect(before.clear).toBe(0);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), placed.id);
    const [[x0, y0], [x1, y1]] = placed.points as [[number, number], [number, number]];
    const c = await app.at([(x0 + x1) / 2, (y0 + y1) / 2]);
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
    await app.page.getByText('Adjust Image…', { exact: true }).click();
    const dialog = app.page.locator('form.adjust-image');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Greyscale').check();
    await dialog.getByLabel('Invert').check();
    await dialog.getByLabel('Make white see-through').fill('20');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    const after = await colourStats(app, (await picture(app)).image);
    expect(after.clear, 'the blue half (20 x 20 pixels) is see-through').toBe(400);
    expect(after.coloured).toBe(0);
    expect(app.errors).toEqual([]);
  });

  test('an adjusted picture survives Save and reopening', async ({ app }) => {
    const placed = await placePicture(app);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), placed.id);
    await app.cmd('edit.adjustImage');
    const dialog = app.page.locator('form.adjust-image');
    await dialog.getByLabel('Greyscale').check();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();

    await app.cmd('file.saveAs');
    await expect.poll(async () => (await app.saved()).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const saved = (await app.saved()).at(-1)!;
    await app.page.locator('input[type=file][accept*="pdf"]').first().setInputFiles({ name: 'adjusted-reopened.pdf', mimeType: 'application/pdf', buffer: saved.bytes });
    await expect.poll(async () => (await app.documents()).some((d) => d.active && d.name.startsWith('adjusted-reopened')), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await app.raw()).some((m) => m.type === 'image'), { timeout: 30_000 }).toBe(true);
    const back = await picture(app);
    expect((await colourStats(app, back.image)).coloured, 'still grey after reopening').toBe(0);
    expect(app.errors).toEqual([]);
  });

  test('the Modify tab fits at the smallest window width, with nothing scrolling', async ({ app }) => {
    await app.page.setViewportSize({ width: 800, height: 700 });
    const ribbon = app.page.locator('.ribbon');
    await ribbon.getByRole('tab', { name: 'Modify' }).click();
    await expect(ribbon.getByRole('group', { name: 'Picture', exact: true })).toBeVisible();
    const clipped = await ribbon.locator('.rb-group').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length);
    expect(clipped).toBe(0);
  });

  test('Adjust Image needs a picture selected', async ({ app }) => {
    expect((await app.command('edit.adjustImage')).enabled).toBe(false);
    await app.tool('rect');
    await app.drag([100, 100], [200, 200]);
    const [rect] = await app.raw();
    await app.page.evaluate((id) => window.__nb.tools.select([id]), rect!.id as string);
    expect((await app.command('edit.adjustImage')).enabled, 'not for a rectangle').toBe(false);
    expect((await app.command('edit.pictureColours')).enabled).toBe(false);
  });
});
