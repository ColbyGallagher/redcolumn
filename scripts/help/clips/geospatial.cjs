// Geospatial: lay a coordinate-system model over a sheet and line it up with the drawing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VIEWPORT } = require('../gifs-lib.cjs');

// A site outline and a pipe run, in MGA2020 zone 56 (EPSG:7856) metres.
const E = 333000;
const N = 6250000;
const line = (pts) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => [E + x, N + y]) } });
const model = {
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::7856' } },
  features: [
    line([[0, 0], [18, 0], [18, 12], [0, 12], [0, 0]]),
    line([[2, 2], [16, 2], [16, 10], [2, 10], [2, 2]]),
    line([[-8, 6], [0, 6]]),
    line([[18, 6], [26, 6]]),
  ],
};

module.exports = async function (h, rec) {
  const { page } = h;
  // A fresh private folder: nothing predictable in the shared temp directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-geo-'));
  const file = path.join(dir, 'site-model.geojson');
  fs.writeFileSync(file, JSON.stringify(model), { mode: 0o600 });
  // Feet and inches (the sample sheets are imperial): the setting is read when the app starts.
  await page.evaluate(() => localStorage.setItem('nb.settings', JSON.stringify({ unitSystem: 'imperial' })));
  await page.reload();
  await page.waitForSelector('.menubar');
  await h.open('sample-plans.pdf');
  await h.run('Window', 'Toolbar Display', 'Ribbon: Tabs and Commands');
  await page.locator('label.field.scale select').first().selectOption({ label: `1/4" = 1'-0"` });
  await h.wait(600);
  await page.locator('.sidebar-rail button, nav button', { hasText: /^Geospatial$/ }).first().click();
  await h.wait(800);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-0.png' });
  await rec.start();
  await rec.caption('Lay a CAD or survey model over a sheet');
  await rec.hold(1000);
  await rec.click(page.getByRole('button', { name: 'Open Model…' }), { after: 200 }).catch(() => {});
  await page.setInputFiles('input[type=file][accept*=geojson]', file);
  await h.wait(1500);
  fs.rmSync(dir, { recursive: true, force: true });
  await h.zoomTo(...h.plan(0, 46), ...h.plan(62, 0));
  await h.wait(600);
  await rec.hold(1800);
  await rec.caption('Drag it into line with the drawing');
  const move = page.getByRole('button', { name: 'Move', exact: true });
  await move.scrollIntoViewIfNeeded();
  await rec.click(move);
  const a = await h.at(...h.plan(34, 24));
  const b = await h.at(...h.plan(30, 22));
  await rec.drag(a, b);
  await rec.hold(1200);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-1.png' });
  await rec.caption('Georeference the sheet and save');
  const go = page.getByRole('button', { name: /^Georeference/ });
  await go.scrollIntoViewIfNeeded();
  await rec.hold(500);
  await rec.click(go);
  await rec.hold(2500);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-2.png' });
};
module.exports.viewport = { width: 1180, height: 680 };
