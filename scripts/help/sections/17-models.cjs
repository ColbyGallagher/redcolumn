// 3D Models: opening an IFC model, moving around it, the 3D panels, sheets on the map, issues,
// comparing revisions and quantities. The model is the synthetic Kestrel Road IFC (docs/demo-sets);
// the sheet is the e2e plan, registered to the same map as the e2e tests register it.
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const REV_A = path.join(ROOT, 'docs/demo-sets/kestrel-road-revA.ifc');
const REV_B = path.join(ROOT, 'docs/demo-sets/kestrel-road-revB.ifc');
const PLAN = path.join(ROOT, 'e2e/fixtures/plan.pdf');
// plan.pdf's first page registered to MGA zone 56 around the model (as in e2e/specs/model3d.spec.ts).
const PLAN_REGION = {"id":"geo-help","pageIndex":0,"name":"Plan","bounds":[[40,60],[572,60],[572,732],[40,732]],"points":[{"at":[40,60],"lat":-33.89454238322232,"lon":151.03445250976299},{"at":[40,396],"lat":-33.90004896332057,"lon":151.03432611648154},{"at":[40,732],"lat":-33.905555538072605,"lon":151.03419968886823},{"at":[306,60],"lat":-33.894625704223095,"lon":151.039680094709},{"at":[306,396],"lat":-33.900132301522234,"lon":151.0395540370585},{"at":[306,732],"lat":-33.90563889347734,"lon":151.0394279451672},{"at":[572,60],"lat":-33.89470880359133,"lon":151.04490770110934},{"at":[572,396],"lat":-33.90021541804564,"lon":151.04478197909535},{"at":[572,732],"lat":-33.90572202715807,"lon":151.04465622293165}],"projection":{"kind":"transverseMercator","lon0":153,"ellipsoid":{"a":6378137,"f":0.003352810681182319}},"crs":"GDA2020 / MGA zone 56","epsg":7856};

module.exports = async function (h) {
  const { page } = h;
  const cmd = (id) =>
    page.evaluate((id) => {
      const c = window.__nb.commands().get(id);
      if (!c?.enabled) throw new Error(`Command ${id} is not available`);
      c.run();
    }, id);
  const session = (fn, arg) =>
    page.evaluate(
      ([src, arg]) => {
        window.__m3d ??= document.querySelector('.model-view').session;
        return new Function('s', 'arg', `return (${src})(s, arg)`)(window.__m3d, arg);
      },
      [fn.toString(), arg],
    );
  const ready = () => page.waitForSelector('.model-view[data-state="ready"]', { timeout: 120_000 });
  // The ribbon, by command (the launcher's menu steps are skipped: see the viewport below).
  await page.waitForFunction(() => window.__nb?.commands);
  if (!(await page.evaluate(() => window.__nb.commands().get('window.ribbon')?.checked))) await cmd('window.ribbon');

  // A clean screen: no left or bottom panel.
  for (const id of ['window.leftPanel', 'window.bottomPanel'])
    if (await page.evaluate((id) => window.__nb.commands().get(id)?.checked, id)) await cmd(id);
  // The plan, registered to the map, then the model.
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(PLAN);
  await page.waitForFunction(() => window.__nb?.tools?.store);
  await page.evaluate((region) => window.__nb.tools.store.setPageGeo(0, [region]), PLAN_REGION);
  await page.locator('input[type=file][accept*="ifc"]').first().setInputFiles(REV_B);
  await ready();
  await page.waitForFunction(() => document.querySelector('.model-view')?.session?.state().georeferenced, null, { timeout: 30_000 });
  await h.wait(1500);
  await session((s) => s.run({ type: 'direction', direction: 'iso' }));
  await h.wait(1200);

  // The model in its tab, with the 3D ribbon tab.
  await h.mark(['.doc-tab.active', { t: '.rb-tab[aria-selected="true"]', at: 'tr' }, '.view-cube']);
  await h.shot('model-open');
  await h.shot('model-ribbon', { around: ['.ribbon'], pad: 0 });

  // Mini-map.
  await cmd('model3d.miniMap');
  await h.wait(800);
  const area = await session((s) => s.miniMapArea());
  const box = await page.locator('.model-view canvas').first().boundingBox();
  if (area) await h.mark({ x: box.x + area.left, y: box.y + area.top, width: area.size, height: area.size }, { numbers: false });
  await h.shot('model-minimap', { around: ['.model-stage'], pad: 0 });
  await cmd('model3d.miniMap');

  // The 3D Model panel: models, the spatial tree and classes.
  await cmd('window.model3d');
  await h.wait(800);
  await h.shot('model-panel', { around: ['.m3d-panel'], pad: 0 });

  // Select an element (a pavement segment mid-road) and show its properties.
  await session(async (s) => {
    const pavement = (await s.classes()).find((c) => c.category === 'IFCPAVEMENT');
    const [modelId, ids] = Object.entries(pavement.items)[0];
    s.run({ type: 'selectItems', items: { [modelId]: [ids[Math.floor(ids.length / 2)]] }, fit: true });
  });
  await h.wait(1500);
  await cmd('window.model3dProps');
  await h.wait(800);
  await h.shot('model-properties', { around: ['.m3d-props'], pad: 8 });

  // Section box around the selection.
  await cmd('model3d.sectionBox');
  await h.wait(1200);
  await h.shot('model-section-box', { around: ['.model-stage'], pad: 0 });
  await cmd('model3d.sectionBox');
  await session((s) => s.run({ type: 'clearSelection' }));

  // The model's linework on the plan.
  await page.locator('.doc-tab', { hasText: 'plan' }).first().click();
  await h.wait(1500);
  if (await page.evaluate(() => window.__nb.commands().get('window.rightPanel')?.checked)) await cmd('window.rightPanel');
  await h.wait(600);
  await page.evaluate(() => window.__nb.viewer.zoomToRect({ x: 20, y: 20, w: 580, h: 420 }, 1, 0));
  await h.wait(1200);
  await h.shot('model-on-sheet', { around: [page.locator('main.stage').first()], pad: 0 });

  // Sync view: the model beside the plan, looking down on what the plan shows.
  await page.locator('.doc-tab', { hasText: 'kestrel-road-revB.ifc' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in Split View' }).click();
  await h.wait(1500);
  // The plan zoomed to the road, where it is registered to the map; the model follows.
  await page.evaluate(() => window.__nb.viewer.zoomToRect({ x: 40, y: 60, w: 300, h: 260 }, 1, 0));
  await h.wait(600);
  await cmd('view.syncModel');
  await h.wait(1500);
  await h.shot('model-sync', { around: [page.locator('main.stage').first(), '.model-stage'], pad: 0 });
  await cmd('view.syncModel');
  await cmd('view.unsplit');
  await h.wait(800);

  // Issues: one raised at an element.
  await page.locator('.doc-tab', { hasText: 'kestrel-road-revB.ifc' }).click();
  await h.wait(800);
  await session(async (s) => {
    const kerbs = (await s.classes()).find((c) => c.category === 'IFCKERB');
    const [modelId, ids] = Object.entries(kerbs.items)[0];
    s.run({ type: 'selectItems', items: { [modelId]: [ids[3]] }, fit: true });
  });
  await h.wait(1500);
  await cmd('window.model3d');
  await h.wait(500);
  const issues = page.locator('.m3d-section', { has: page.locator('summary', { hasText: /^\s*Issues/ }) });
  await issues.getByRole('textbox', { name: 'Issue title' }).fill('Kerb height to match the bus bay');
  await issues.getByRole('button', { name: 'New issue' }).click();
  await h.wait(1200);
  await issues.scrollIntoViewIfNeeded();
  await h.shot('model-issues', { around: [issues.locator('summary'), issues.getByText('Kerb height to match the bus bay')], pad: 12 });
  await session((s) => s.run({ type: 'clearSelection' }));

  // Quantities by class.
  const qty = page.locator('.m3d-section', { has: page.locator('summary', { hasText: /^\s*Quantities/ }) });
  await qty.getByRole('button', { name: 'Total', exact: true }).click();
  await h.wait(1500);
  await qty.scrollIntoViewIfNeeded();
  await h.shot('model-quantities', { around: [qty], pad: 8 });

  // Compare with the next revision.
  const compare = page.locator('.m3d-section', { has: page.locator('summary', { hasText: /^\s*Compare/ }) });
  await compare.locator('input[type=file]').setInputFiles(REV_A);
  await compare.getByRole('button', { name: 'End comparison' }).waitFor({ timeout: 120_000 });
  await h.wait(1500);
  await compare.scrollIntoViewIfNeeded();
  await h.shot('model-compare-list', { around: [compare], pad: 8 });
  // Looking down on the bus bay: the changed base course and the kerbs added and removed.
  await compare.getByRole('list', { name: 'Changed', exact: true }).getByRole('button', { name: 'Base course MC00 CH400-440' }).click();
  await h.wait(1500);
  await session((s) => s.run({ type: 'clearSelection' }));
  await session((s) => s.run({ type: 'direction', direction: 'top' }));
  await h.wait(1500);
  // Zoomed out to three times as much ground (the view is still the parallel plan from Sync View).
  await session((s) => {
    const c = s.world.camera;
    if (c.three.isOrthographicCamera) return c.controls.zoomTo(c.three.zoom / 3, false);
    const p = s.cameraPlace();
    s.run({ type: 'lookAtPlace', camera: { ...p, position: p.position.map((v, i) => p.target[i] + (v - p.target[i]) * 3) } });
  });
  await h.wait(1500);
  await h.shot('model-compare', { around: ['.model-stage'], pad: 0 });
};

// No toolbar step in the launcher (it goes through the menus); the section turns the ribbon on itself.
module.exports.viewport = { toolbar: 'none' };
