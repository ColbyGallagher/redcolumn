import { expect, test } from '../support/app.ts';

interface Viewport {
  id: string;
  name: string;
  page: number;
  rect: { x: number; y: number; w: number; h: number };
  scale: string;
}

test.describe('viewports with the assistant tools', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('a viewport can be scaled separately up and down, and Create Viewport is a command', async ({ app }) => {
    expect((await app.command('edit.createViewport')).enabled).toBe(true);
    const placed = await app.assistant<{ viewport: Viewport }>('place_viewport', { page: 1, points: [[400, 300], [100, 100]], scale: '1:100' });
    await app.cmd('window.measurements');
    const row = app.page.locator('.ms-vp-row').first();
    await expect(row.getByLabel('Viewport scale')).toBeVisible();
    await row.getByLabel('Separate Y scale').check();
    await expect(row.getByLabel('Viewport X scale')).toBeVisible();
    await row.getByLabel('Viewport Y scale').selectOption({ label: `1" = 20'` });
    const scale = async () =>
      (await app.page.evaluate(() => (window.__nb.tools.store as unknown as { allViewports(): { scale: { metersPerPoint: number; yMetersPerPoint?: number } }[] }).allViewports()))[0]!.scale;
    await expect.poll(async () => (await scale()).yMetersPerPoint).toBeGreaterThan(0);
    expect((await scale()).yMetersPerPoint).not.toBeCloseTo((await scale()).metersPerPoint, 6);
    // Unticking it puts Y back to X.
    await row.getByLabel('Separate Y scale').uncheck();
    await expect.poll(async () => (await scale()).yMetersPerPoint).toBeUndefined();
    expect(placed.viewport.name).toBeTruthy();
  });

  test('a viewport placed by the assistant sets the scale of the markups inside it', async ({ app }) => {
    const placed = await app.assistant<{ viewport: Viewport }>('place_viewport', { page: 1, points: [[400, 300], [100, 100]], scale: '1:100' });
    expect(placed.viewport.rect).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect((await app.assistant<{ viewports: number }>('get_page', { page: 1 })).viewports).toBe(1);

    // The assistant measures only where there is a scale: the page gets one from the page bar.
    await app.scaleSelect().selectOption({ label: `1" = 20'` });
    // The same 100-point line, one inside the viewport and one outside it.
    await app.assistant('place_markups', {
      page: 1,
      markups: [
        { type: 'length', points: [[150, 150], [250, 150]] },
        { type: 'length', points: [[150, 500], [250, 500]] },
      ],
    });
    const measure = async () => (await app.markups()).map((m) => m.measurement);
    const [inside, outside] = await measure();
    expect(inside).toBeTruthy();
    expect(inside).not.toBe(outside);

    // A new scale on the viewport changes the line inside it, and only that one.
    await app.assistant('set_viewport_scale', { id: placed.viewport.id, scale: '1:200' });
    const [after, outsideAfter] = await measure();
    expect(after).not.toBe(inside);
    expect(outsideAfter).toBe(outside);

    const listed = await app.assistant<{ viewports: Viewport[] }>('list_viewports', { page: 1 });
    expect(listed.viewports.map((v) => [v.id, v.scale])).toEqual([[placed.viewport.id, '1 mm = 200 mm']]);
  });
});
