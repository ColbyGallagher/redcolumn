import { expect, test, type App } from '../support/app.ts';

// The 3D viewer (issue #191): an IFC file opens in a document tab and draws in 3D. The model is the
// synthetic Kestrel Road IFC (scripts/roadset/ifc.mjs), kept with the demo sets.
const MODEL = '../../docs/demo-sets/kestrel-road-revA.ifc';

/** plan.pdf's first page registered to MGA zone 56 around the Kestrel Road model (about 1:1300, north up). */
const PLAN_REGION = {"id":"geo-e2e","pageIndex":0,"name":"Plan","bounds":[[40,60],[572,60],[572,732],[40,732]],"points":[{"at":[40,60],"lat":-33.89454238322232,"lon":151.03445250976299},{"at":[40,396],"lat":-33.90004896332057,"lon":151.03432611648154},{"at":[40,732],"lat":-33.905555538072605,"lon":151.03419968886823},{"at":[306,60],"lat":-33.894625704223095,"lon":151.039680094709},{"at":[306,396],"lat":-33.900132301522234,"lon":151.0395540370585},{"at":[306,732],"lat":-33.90563889347734,"lon":151.0394279451672},{"at":[572,60],"lat":-33.89470880359133,"lon":151.04490770110934},{"at":[572,396],"lat":-33.90021541804564,"lon":151.04478197909535},{"at":[572,732],"lat":-33.90572202715807,"lon":151.04465622293165}],"projection":{"kind":"transverseMercator","lon0":153,"ellipsoid":{"a":6378137,"f":0.003352810681182319}},"crs":"GDA2020 / MGA zone 56","epsg":7856};

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

  test('the 3D panels list the model, select by class, show properties, find by search set and save views', async ({ app }) => {
    const page = app.page;
    await app.open('plan.pdf');
    // The 3D panels join the rail only while a model is open.
    await expect(page.locator('[data-panel="model3d"]')).toHaveCount(0);
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    // 3D Properties starts on the right, opposite the 3D Model panel.
    await expect(page.locator('nav.rail.right [data-panel="model3dProps"]')).toHaveCount(1);
    await expect(page.locator('nav.rail.left [data-panel="model3d"]')).toHaveCount(1);
    // The first model brings its properties up, waiting for a pick.
    await expect(page.getByText('Click an element in the model to see its properties.')).toBeVisible();

    await app.cmd('window.model3d');
    const panel = page.locator('.m3d-panel');
    await expect(panel.getByRole('checkbox', { name: /kestrel-road-revA\.ifc/ })).toBeChecked();
    await expect(panel.locator('.m3d-tree')).toContainText('Kestrel Road site');
    const classes = panel.getByRole('list', { name: 'Classes' });
    await expect(classes.locator('.m3d-row', { hasText: 'IfcCourse' })).toContainText('30');

    // Picking a class selects its elements; the Properties panel shows the first.
    await classes.getByRole('button', { name: 'IfcCourse', exact: true }).click();
    await app.cmd('window.model3dProps');
    const props = page.locator('.m3d-props');
    await expect(props.locator('.m3d-props-head')).toContainText('1 of 30 selected');
    await expect(props.locator('.m3d-props-head')).toContainText('IfcCourse');
    await props.getByRole('searchbox', { name: 'Filter properties' }).fill('alignment');
    await expect(props.locator('tbody tr')).toHaveCount(1);
    await expect(props.locator('tbody tr')).toContainText(/MC0[01]/);

    // A search set finds the side road's elements by a property value, and isolates them.
    await app.cmd('window.model3d');
    await panel.getByRole('textbox', { name: 'Property' }).fill('Alignment');
    await panel.getByRole('textbox', { name: 'Value contains' }).fill('MC01');
    await panel.getByRole('button', { name: 'Add set' }).click();
    const sets = panel.getByRole('list', { name: 'Search sets' });
    await sets.getByRole('button', { name: /^Isolate / }).click();
    await expect(sets.locator('.m3d-count')).toHaveText('8');
    await expect.poll(() => page.evaluate(() => (document.querySelector('.model-view') as unknown as { session: { state(): { hidden: boolean } } }).session.state().hidden)).toBe(true);

    // The view is saved with what is hidden, and comes back after Show all.
    await panel.getByRole('textbox', { name: 'View name' }).fill('Side road');
    await panel.getByRole('button', { name: 'Save view' }).click();
    const views = panel.getByRole('list', { name: 'Saved views' });
    await expect(views.getByRole('button', { name: 'Side road', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Show all' }).click();
    const hidden = () => page.evaluate(() => (document.querySelector('.model-view') as unknown as { session: { state(): { hidden: boolean } } }).session.state().hidden);
    await expect.poll(hidden).toBe(false);
    await views.getByRole('button', { name: 'Side road', exact: true }).click();
    await expect.poll(hidden).toBe(true);
  });

  test('an open model is drawn on sheets registered to the same map, and view.modelOnDrawings turns it off', async ({ app }) => {
    const page = app.page;
    await app.open('plan.pdf');
    expect((await app.command('view.modelOnDrawings')).enabled).toBe(false);
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    await page.locator('.doc-tab', { hasText: 'plan' }).click();
    // Register the plan to MGA zone 56 where the model lies (as the Geospatial panel would, or a geospatial PDF).
    await page.evaluate((region) => (window.__nb.tools.store as unknown as { setPageGeo(p: number, r: unknown[]): void }).setPageGeo(0, [region]), PLAN_REGION);
    const lines = () =>
      page.evaluate(() => {
        const overlay = (window.__nb.tools as unknown as { modelOverlay: ((p: number) => { paths: unknown[] }[]) | null }).modelOverlay;
        return overlay ? overlay(0).reduce((n, l) => n + l.paths.length, 0) : 0;
      });
    await expect.poll(lines).toBeGreaterThan(100);
    expect((await app.command('view.modelOnDrawings')).checked).toBe(true);
    await app.cmd('view.modelOnDrawings');
    await expect.poll(lines).toBe(0);
    expect((await app.command('view.modelOnDrawings')).checked).toBe(false);
  });

  test('a sheet registered to the map shows in the model on a plane or draped, and the view keeps drawing after a tab switch', async ({ app }) => {
    const page = app.page;
    await app.open('plan.pdf');
    await page.evaluate((region) => {
      const store = window.__nb.tools.store as unknown as { setPageGeo(p: number, r: unknown[]): void; add(m: unknown): void };
      store.setPageGeo(0, [region]);
      // A line across the road, to drape over it.
      store.add({ id: 'across', type: 'polyline', pageIndex: 0, points: [[60, 300], [560, 500]], style: { stroke: '#e03131', fill: null, width: 2, opacity: 1 } });
    }, PLAN_REGION);
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    type Session = {
      state(): { georeferenced: boolean; heights: [number, number] | null; draping: number };
      sheetGroup: { children: { type: string; children: unknown[] }[] };
      world: { renderer: { three: { info: { render: { frame: number } } } } };
      run(a: unknown): void;
    };
    const session = <T,>(fn: (s: Session) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((document.querySelector('.model-view') as unknown as { session: Session }).session), fn.toString()) as Promise<T>;
    await expect.poll(() => session((s) => s.state().georeferenced)).toBe(true);
    // The road's levels, about 10 to 16 m AHD.
    const [lo, hi] = (await session((s) => s.state().heights))!;
    expect(lo).toBeGreaterThan(9);
    expect(hi).toBeLessThan(17);

    await app.cmd('window.model3d');
    const sheets = page.getByRole('list', { name: 'Sheets in the model' });
    await sheets.getByRole('checkbox').check();
    await expect.poll(() => session((s) => s.sheetGroup.children.map((c) => c.type).join())).toBe('Mesh');
    await sheets.getByRole('combobox').selectOption('drape');
    await expect.poll(() => session((s) => s.sheetGroup.children[0]?.type === 'Group' && s.state().draping === 0 && s.sheetGroup.children[0].children.length), { timeout: 60_000 }).toBeGreaterThan(0);

    // Back from the PDF, the view still draws when the camera moves.
    await page.locator('.doc-tab', { hasText: 'plan' }).click();
    await page.locator('.doc-tab', { hasText: 'kestrel-road-revA.ifc' }).click();
    const frame = () => session((s) => s.world.renderer.three.info.render.frame);
    const before = await frame();
    await session((s) => s.run({ type: 'direction', direction: 'iso' }));
    await expect.poll(frame).toBeGreaterThan(before + 2);
  });

  test('a selected element opens the sheet showing it, and Find in 3D on that sheet selects it in the model', async ({ app }) => {
    const page = app.page;
    await app.open('plan.pdf');
    await page.evaluate((region) => (window.__nb.tools.store as unknown as { setPageGeo(p: number, r: unknown[]): void }).setPageGeo(0, [region]), PLAN_REGION);
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    type Session = {
      state(): { georeferenced: boolean; selected: number };
      classes(): Promise<{ category: string; items: Record<string, number[]> }[]>;
      run(a: unknown): void;
    };
    // Kept from the first call: the view leaves the page while a PDF is in front.
    const session = <T,>(fn: (s: Session) => T) =>
      page.evaluate((src) => {
        const w = window as unknown as { __m3d?: Session };
        w.__m3d ??= (document.querySelector('.model-view') as unknown as { session: Session }).session;
        return new Function('s', `return (${src})(s)`)(w.__m3d);
      }, fn.toString()) as Promise<T>;
    await expect.poll(() => session((s) => s.state().georeferenced)).toBe(true);

    // Model to drawing: a pavement segment in the middle of the road lies on the plan.
    await session(async (s) => {
      const pavement = (await s.classes()).find((c) => c.category === 'IFCPAVEMENT')!;
      const [modelId, ids] = Object.entries(pavement.items)[0]!;
      s.run({ type: 'selectItems', items: { [modelId]: [ids[Math.floor(ids.length / 2)]] } });
    });
    await expect.poll(() => session((s) => s.state().selected)).toBe(1);
    await app.cmd('window.model3dProps');
    const onDrawings = page.getByRole('list', { name: 'On drawings' });
    await onDrawings.getByRole('button', { name: /plan/ }).click();
    await expect(page.locator('.doc-tab.active')).toContainText('plan');
    // The sheet opens where the element is, with a ring around it.
    const ring = () => page.evaluate(() => (window.__nb.tools as unknown as { flashing: { pageIndex: number; rect: { x: number; y: number; w: number; h: number } } | null }).flashing);
    await expect.poll(async () => (await ring())?.pageIndex).toBe(0);
    const { rect } = (await ring())!;

    // Drawing to model: right-click there, Find in 3D brings the model forward with the element selected.
    await session((s) => s.run({ type: 'clearSelection' }));
    await expect.poll(() => session((s) => s.state().selected)).toBe(0);
    // Where the ring is on screen once the viewer has finished moving there.
    const centre: [number, number] = [rect.x + rect.w / 2, rect.y + rect.h / 2];
    let at = await app.at(centre, 0);
    await expect
      .poll(async () => {
        await page.waitForTimeout(150);
        const next = await app.at(centre, 0);
        const still = Math.abs(next.x - at.x) < 0.5 && Math.abs(next.y - at.y) < 0.5;
        at = next;
        return still;
      })
      .toBe(true);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Find in 3D' }).click();
    await expect(page.locator('.doc-tab.active')).toContainText('kestrel-road-revA.ifc');
    await expect.poll(() => session((s) => s.state().selected), { timeout: 30_000 }).toBe(1);
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
