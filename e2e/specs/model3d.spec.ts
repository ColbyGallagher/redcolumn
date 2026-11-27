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
    await panel.getByRole('tab', { name: /^Classes/ }).click();
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
    await app.cmd('window.model3dSets');
    await panel.getByRole('textbox', { name: 'Property' }).fill('Alignment');
    await panel.getByRole('textbox', { name: 'Value contains' }).fill('MC01');
    await panel.getByRole('button', { name: 'Add set' }).click();
    const sets = panel.getByRole('list', { name: 'Search sets' });
    await sets.getByRole('button', { name: /^Isolate / }).click();
    await expect(sets.locator('.m3d-count')).toHaveText('8');
    await expect.poll(() => page.evaluate(() => (document.querySelector('.model-view') as unknown as { session: { state(): { hidden: boolean } } }).session.state().hidden)).toBe(true);

    // The view is saved with what is hidden, and comes back after Show all.
    await app.cmd('window.model3dViews');
    await panel.getByRole('textbox', { name: 'View name' }).fill('Side road');
    await panel.getByRole('button', { name: 'Save view' }).click();
    const views = panel.getByRole('list', { name: 'Saved views' });
    const saved = views.locator('button.m3d-name', { hasText: 'Side road' });
    await expect(saved).toBeVisible();
    await app.cmd('window.model3dSets');
    await panel.getByRole('button', { name: 'Show all' }).click();
    const hidden = () => page.evaluate(() => (document.querySelector('.model-view') as unknown as { session: { state(): { hidden: boolean } } }).session.state().hidden);
    await expect.poll(hidden).toBe(false);
    await app.cmd('window.model3dViews');
    await saved.click();
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

    await app.cmd('window.model3dSheets');
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

  test('view.syncModel: a model split beside a registered sheet looks down on what the sheet shows, and moving the model moves the sheet', async ({ app }) => {
    const page = app.page;
    await app.open('plan.pdf');
    await page.evaluate((region) => (window.__nb.tools.store as unknown as { setPageGeo(p: number, r: unknown[]): void }).setPageGeo(0, [region]), PLAN_REGION);
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    type Plan = { centre: [number, number]; metresPerPixel: number; up: [number, number] };
    type Session = { state(): { georeferenced: boolean; nav: string }; planView(): Plan | null; run(a: unknown): void };
    const session = <T,>(fn: (s: Session) => T) =>
      page.evaluate((src) => {
        const w = window as unknown as { __m3d?: Session };
        w.__m3d ??= (document.querySelector('.model-view') as unknown as { session: Session }).session;
        return new Function('s', `return (${src})(s)`)(w.__m3d);
      }, fn.toString()) as Promise<T>;
    await expect.poll(() => session((s) => s.state().georeferenced)).toBe(true);
    // The model in the right pane, the plan in the left.
    await page.locator('.doc-tab', { hasText: 'kestrel-road-revA.ifc' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Split View' }).click();
    await expect(page.locator('.doc-tab', { hasText: 'plan' }).first()).toBeVisible();
    type V = { pageView(): { centre: [number, number]; zoom: number }; zoomBy(k: number): void };
    const sheet = () => page.evaluate(() => (window.__nb.viewer as unknown as V).pageView());

    await app.cmd('view.syncModel');
    await expect.poll(() => session((s) => s.state().nav)).toBe('Plan');
    await expect.poll(() => session((s) => !!s.planView())).toBe(true);
    // North up, as the plan is drawn.
    const first = (await session((s) => s.planView()))!;
    expect(first.up[1]).toBeGreaterThan(0.99);

    // Zooming the sheet in zooms the model in.
    await page.evaluate(() => (window.__nb.viewer as unknown as V).zoomBy(2));
    await expect.poll(async () => (await session((s) => s.planView()))!.metresPerPixel / first.metresPerPixel).toBeCloseTo(0.5, 2);

    // Moving the model 30 m east moves the sheet's centre east (right, on a north-up plan).
    const before = await sheet();
    await session((s) => {
      const p = s.planView()!;
      s.run({ type: 'planView', view: { ...p, centre: [p.centre[0] + 30, p.centre[1]] } });
    });
    await expect.poll(async () => (await sheet()).centre[0] - before.centre[0]).toBeGreaterThan(10);
    expect(Math.abs((await sheet()).centre[1] - before.centre[1])).toBeLessThan(2);

    // Off again: the sheet no longer follows.
    await app.cmd('view.syncModel');
    const still = await sheet();
    await session((s) => {
      const p = s.planView()!;
      s.run({ type: 'planView', view: { ...p, centre: [p.centre[0] + 30, p.centre[1]] } });
    });
    await page.waitForTimeout(500);
    expect((await sheet()).centre[0]).toBeCloseTo(still.centre[0], 1);
  });

  test('an issue raised in the model shows as a cloud and callout on the plan, and its status set there comes back', async ({ app }) => {
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
    const session = <T,>(fn: (s: Session) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((document.querySelector('.model-view') as unknown as { session: Session }).session), fn.toString()) as Promise<T>;
    await expect.poll(() => session((s) => s.state().georeferenced)).toBe(true);
    await session(async (s) => {
      const pavement = (await s.classes()).find((c) => c.category === 'IFCPAVEMENT')!;
      const [modelId, ids] = Object.entries(pavement.items)[0]!;
      s.run({ type: 'selectItems', items: { [modelId]: [ids[Math.floor(ids.length / 2)]] } });
    });
    await expect.poll(() => session((s) => s.state().selected)).toBe(1);

    await app.cmd('window.model3dIssues');
    await page.getByRole('textbox', { name: 'Issue title' }).fill('Pit lid too high');
    await page.getByRole('button', { name: 'New issue' }).click();
    const issues = page.getByRole('list', { name: 'Issues' });
    await expect(issues.getByRole('button', { name: 'Pit lid too high', exact: true })).toBeVisible();
    await expect(issues.getByRole('img', { name: /Snapshot/ })).toBeVisible();

    // On the plan: a cloud and a callout with the issue's title, subject BCF.
    await page.locator('.doc-tab', { hasText: 'plan' }).click();
    type Mk = { id: string; type: string; subject?: string; text?: string; status: string; bcf?: { role: string } };
    const bcfMarkups = () => page.evaluate(() => (window.__nb.tools.store as unknown as { all(): Mk[] }).all().filter((m) => m.bcf));
    await expect.poll(async () => (await bcfMarkups()).map((m) => m.type).sort().join()).toBe('callout,cloud');
    const callout = (await bcfMarkups()).find((m) => m.type === 'callout')!;
    expect(callout.subject).toBe('BCF');
    expect(callout.text).toBe('Pit lid too high');

    // Completed on the sheet: the issue is Resolved.
    await page.evaluate((id) => (window.__nb.tools.store as unknown as { update(id: string, p: unknown): void }).update(id, { status: 'completed' }), callout.id);
    await page.locator('.doc-tab', { hasText: 'kestrel-road-revA.ifc' }).click();
    await expect(page.getByRole('list', { name: 'Issues' }).locator('.m3d-class', { hasText: 'Resolved' })).toBeVisible();
  });

  test('comparing with another revision lists what was added, removed and changed, and quantities total by class or property', async ({ app }) => {
    const page = app.page;
    await app.open('plan.pdf');
    await page.locator('input[type=file][accept*="ifc"]').first().setInputFiles(app.fixture('../../docs/demo-sets/kestrel-road-revB.ifc'));
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    await app.cmd('window.model3dReview');
    const panel = page.locator('.m3d-panel');

    // Quantities by class, from the model's quantity sets.
    await panel.getByRole('button', { name: 'Total', exact: true }).click();
    const table = panel.getByRole('table', { name: 'Quantities' });
    const course = table.locator('tbody tr', { hasText: 'IfcCourse' });
    await expect(course.locator('td').nth(1)).toHaveText('30');
    await expect(course.locator('td').nth(2)).not.toHaveText('');
    await expect(course.locator('td').nth(4)).not.toHaveText(/≈|^$/);
    // By a property: the materials.
    await panel.getByRole('combobox', { name: 'Group quantities by' }).fill('Material');
    await panel.getByRole('button', { name: 'Total', exact: true }).click();
    await expect(table.locator('thead')).toContainText('Material');
    await expect(table.locator('tbody tr', { hasText: 'DGB20 crushed rock' }).locator('td').nth(1)).toHaveText('30');
    await expect(table.locator('tbody tr', { hasText: 'AC14 asphalt on DGB20' })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Export to Excel…' }).click();
    await expect.poll(async () => (await app.saved()).map((f) => f.name), { timeout: 30_000 }).toContain('quantities.xlsx');
    expect((await app.saved()).find((f) => f.name === 'quantities.xlsx')!.bytes.subarray(0, 2).toString()).toBe('PK');

    // Revision B against revision A (scripts/roadset/ifc.mjs CHANGES).
    await panel.locator('input[type=file][aria-label="Compare with revision"]').setInputFiles(app.fixture(MODEL));
    const names = (list: string) => panel.getByRole('list', { name: list, exact: true }).locator('.m3d-name');
    await expect(names('Added')).toHaveText(['Bus bay MC00 right CH600-640', 'Kerb MC00 bus bay CH600-640'], { timeout: 90_000 });
    await expect(names('Removed')).toHaveText(['Kerb MC00 right CH360-400', 'Kerb MC00 right CH600-640']);
    await expect(names('Changed')).toHaveText(['Base course MC00 CH400-440', 'Kerb MC00 left CH200-240']);
    const changed = panel.getByRole('list', { name: 'Changed', exact: true }).locator('.m3d-row');
    await expect(changed.nth(0).locator('.m3d-class')).toHaveText('shape, properties');
    await expect(changed.nth(1).locator('.m3d-class')).toHaveText('properties');
    await expect(changed.nth(1).locator('.m3d-name')).toHaveAttribute('title', /KerbType: Barrier → Semi-mountable/);
    // The other revision stays out of the list of models; the comparison is still there on the way back.
    await app.cmd('window.model3d');
    await expect(panel.getByRole('checkbox')).toHaveCount(1);
    await app.cmd('window.model3dReview');
    await expect(names('Removed')).toHaveCount(2);
    // A removed element is selected where it was.
    await names('Removed').first().click();
    await expect.poll(() => page.evaluate(() => (document.querySelector('.model-view') as unknown as { session: { state(): { selected: number } } }).session.state().selected)).toBe(1);
    await panel.getByRole('button', { name: 'End comparison' }).click();
    await expect(names('Added')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (document.querySelector('.model-view') as unknown as { session: { state(): { comparing: string | null } } }).session.state().comparing)).toBe(null);
  });

  test.describe('walking and the mini-map', () => {
    test.use({ toolbar: 'ribbon' });
    test('the mini-map moves the camera where it is clicked, and walking keeps eye height over the road', async ({ app }) => {
      const page = app.page;
      const button = (id: string) => page.locator(`[data-ribbon-command="${id}"]`);
      await app.open('plan.pdf');
      await openModel(app);
      await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
      type Place = { position: [number, number, number]; target: [number, number, number] };
      type Session = {
        state(): { georeferenced: boolean; heights: [number, number] | null; selected: number; nav: string };
        classes(): Promise<{ category: string; items: Record<string, number[]> }[]>;
        run(a: unknown): void;
        cameraPlace(): Place | null;
        miniMapArea(): { left: number; top: number; size: number } | null;
        orientation(): { yaw: number; pitch: number };
      };
      const session = <T,>(fn: (s: Session) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((document.querySelector('.model-view') as unknown as { session: Session }).session), fn.toString()) as Promise<T>;
      await expect.poll(() => session((s) => s.state().georeferenced)).toBe(true);
      const canvas = view(app).locator('canvas').first();

      // Mini-map on: a click in its top-left quarter moves the camera over that part of the road.
      await button('model3d.miniMap').click();
      await expect(button('model3d.miniMap')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => session((s) => !!s.miniMapArea())).toBe(true);
      const area = (await session((s) => s.miniMapArea()))!;
      const box = (await canvas.boundingBox())!;
      const before = (await session((s) => s.cameraPlace()))!;
      await page.mouse.click(box.x + area.left + area.size * 0.25, box.y + area.top + area.size * 0.25);
      await expect
        .poll(async () => {
          const t = (await session((s) => s.cameraPlace()))!.target;
          return Math.hypot(t[0] - before.target[0], t[1] - before.target[1]);
        })
        .toBeGreaterThan(20);
      // The click on the map selected nothing.
      expect(await session((s) => s.state().selected)).toBe(0);

      // Walk from a pavement segment in the middle of the road: eye height over it, looking level.
      await session(async (s) => {
        const pavement = (await s.classes()).find((c) => c.category === 'IFCPAVEMENT')!;
        const [modelId, ids] = Object.entries(pavement.items)[0]!;
        s.run({ type: 'selectItems', items: { [modelId]: [ids[Math.floor(ids.length / 2)]] }, fit: true });
      });
      await page.waitForTimeout(1500);
      await session((s) => s.run({ type: 'clearSelection' }));
      await button('model3d.walk').click();
      await expect(button('model3d.walk')).toHaveAttribute('aria-pressed', 'true');
      const [lo, hi] = (await session((s) => s.state().heights))!;
      const eyeOk = (z: number) => z > lo + 1.4 && z < hi + 1.9;
      await expect.poll(async () => eyeOk((await session((s) => s.cameraPlace()))!.position[2])).toBe(true);
      expect(Math.abs((await session((s) => s.orientation())).pitch)).toBeLessThan(0.05);
      const start = (await session((s) => s.cameraPlace()))!.position;

      // W walks forward, over the road at eye height.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('w');
      await page.waitForTimeout(1200);
      await page.keyboard.up('w');
      const end = (await session((s) => s.cameraPlace()))!.position;
      expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeGreaterThan(0.5);
      expect(eyeOk(end[2])).toBe(true);
      await button('model3d.orbit').click();
      await expect(button('model3d.walk')).toHaveAttribute('aria-pressed', 'false');
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
