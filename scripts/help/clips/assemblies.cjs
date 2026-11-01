// Assemblies: load an example partition wall and see its parts, formulas and waste allowances.
const { VIEWPORT, menuPath } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  await h.open('sample-plans.pdf');
  await h.run('Window', 'Toolbar Display', 'Ribbon: Tabs and Commands');
  await h.run('Window', 'Toggle Panels');
  await h.wait(600);
  await rec.start();
  await rec.caption('Measure once, let the assembly work out the rest');
  await rec.hold(1200);
  await menuPath(h, rec, 'Tools', 'Takeoff', 'Assemblies…');
  await page.waitForSelector('.assemblies-dialog');
  await rec.hold(800);
  await rec.click(page.locator('.assemblies-dialog button', { hasText: 'Examples' }));
  await rec.hold(500);
  await rec.click(page.locator('.assemblies-dialog [role=menuitem]', { hasText: /partition/i }).first());
  await rec.hold(1200);
  await rec.caption('Studs, track, board and insulation, each with its formula and waste');
  await rec.hold(4500);
};
module.exports.viewport = VIEWPORT;
module.exports.poster = 1;
