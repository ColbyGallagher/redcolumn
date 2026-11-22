import { expect, test, type App } from '../support/app.ts';

// The 3D viewer (issue #191): an IFC file opens in a document tab and draws in 3D. The model is the
// synthetic Kestrel Road IFC (scripts/roadset/ifc.mjs), kept with the demo sets.
const MODEL = '../../docs/demo-sets/kestrel-road-revA.ifc';

const openModel = (app: App) => app.page.locator('input[type=file][accept*="ifc"]').first().setInputFiles(app.fixture(MODEL));
const view = (app: App) => app.page.locator('.model-view');

/** Requests for the 3D viewer's code, worker or wasm (built: model3d/; development: packages/model3d). */
function watch3d(app: App): string[] {
  const seen: string[] = [];
  app.page.on('request', (r) => {
    if (/\/model3d\//.test(new URL(r.url()).pathname)) seen.push(r.url());
  });
  return seen;
}

test.describe('3D models', () => {
  test('an IFC file opens in a tab of its own, draws in 3D and frees the view when closed', async ({ app }) => {
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    await expect(app.page.locator('.doc-tab.active')).toContainText('kestrel-road-revA.ifc');
    const canvas = view(app).locator('canvas');
    await expect(canvas).toHaveCount(1);
    const size = await canvas.boundingBox();
    expect(size!.width).toBeGreaterThan(100);
    expect(size!.height).toBeGreaterThan(100);
    // A model is not a PDF: the start screen stays away while it is in front.
    await expect(app.page.locator('.start-screen')).toHaveCount(0);

    await app.page.locator('.doc-tab.active .close').click();
    await expect(view(app)).toHaveCount(0);
    await expect(app.page.locator('.doc-tab:not(.empty)')).toHaveCount(0);

    // Opened again, the conversion kept from the first time is used.
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  });

  test('a model and a PDF share the tab strip, each shown when its tab is in front', async ({ app }) => {
    await app.open('plan.pdf');
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    await app.page.locator('.doc-tab', { hasText: 'plan' }).click();
    await expect(view(app)).toHaveCount(0);
    expect((await app.documents()).find((d) => d.active)?.name).toMatch(/^plan/);
    await app.page.locator('.doc-tab', { hasText: 'kestrel-road-revA.ifc' }).click();
    await expect(view(app)).toHaveAttribute('data-state', 'ready');
  });

  test.describe('from the ribbon', () => {
    test.use({ toolbar: 'ribbon' });
    test('the 3D ribbon tab comes forward with a model and drives the view', async ({ app }) => {
      const page = app.page;
      const tab3d = page.locator('[data-ribbon-tab="3d"]');
      const button = (id: string) => page.locator(`[data-ribbon-command="${id}"]`);
      await app.open('plan.pdf');
      await expect(tab3d).toHaveCount(0);
      await openModel(app);
      await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
      await expect(tab3d).toHaveAttribute('aria-selected', 'true');
      await expect(button('model3d.orbit')).toHaveAttribute('aria-pressed', 'true');

      // Plan: looks straight down with a parallel projection, and the view cube shows its top.
      await button('model3d.plan').click();
      await expect(button('model3d.plan')).toHaveAttribute('aria-pressed', 'true');
      await expect(button('model3d.orthographic')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.view-cube-body')).toHaveAttribute('style', /rotateX\(-(8[5-9]|90)/);

      // A section box around everything, then removed.
      await button('model3d.sectionBox').click();
      await expect(button('model3d.sectionBox')).toHaveAttribute('aria-pressed', 'true');
      await expect(button('model3d.clearClips')).toBeEnabled();
      await button('model3d.clearClips').click();
      await expect(button('model3d.sectionBox')).toHaveAttribute('aria-pressed', 'false');

      // Commands that need a selection wait for one.
      await expect(button('model3d.isolate')).toBeDisabled();
      await button('model3d.grid').click();
      await expect(button('model3d.grid')).toHaveAttribute('aria-pressed', 'true');

      // Back on the PDF the 3D tab goes away, and returns with the model.
      await page.locator('.doc-tab', { hasText: 'plan' }).click();
      await expect(tab3d).toHaveCount(0);
      await page.locator('.doc-tab', { hasText: 'kestrel-road-revA.ifc' }).click();
      await expect(tab3d).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('working with PDFs never loads the 3D viewer', async ({ app }) => {
    const seen = watch3d(app);
    await app.open('plan.pdf');
    await app.tool('rect');
    await app.drag([100, 100], [200, 160]);
    expect((await app.markups()).length).toBe(1);
    expect(seen).toEqual([]);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
