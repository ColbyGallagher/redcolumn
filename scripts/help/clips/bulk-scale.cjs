// Bulk apply scale: draw a box round the scale note once and every sheet is scaled from its own title block.
const { menuPath } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  await h.open('sample-plans.pdf');
  await h.run('Window', 'Toolbar Display', 'Ribbon: Tabs and Commands');
  await h.run('Window', 'Toggle Panels');
  await page.keyboard.press('Control+0');
  await h.wait(800);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-0.png' });
  await rec.start();
  await rec.caption('Every sheet has its own scale. Set them all at once');
  await rec.hold(1500);
  await menuPath(h, rec, 'Document', 'Bulk Apply Page Scale…');
  await page.waitForSelector('.label-regions');
  await h.zoomTo(40, 1090, 640, 1250);
  await h.wait(500);
  await rec.hold(800);
  await rec.caption('Draw a box round the scale note, once');
  const a = await h.at(137, 1191);
  const b = await h.at(228, 1210);
  await rec.drag(a, b);
  await rec.hold(1200);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-1.png' });
  await rec.caption('Every sheet is scaled from its own title block');
  await rec.click(page.locator('.label-regions button', { hasText: /^Apply to/ }));
  await rec.hold(1200);
  await page.evaluate(() => window.__nb.viewer.goToPage(1));
  await h.wait(700);
  await rec.hold(1300);
  await page.evaluate(() => window.__nb.viewer.goToPage(2));
  await h.wait(700);
  await rec.hold(1800);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-2.png' });
};
module.exports.viewport = { width: 1180, height: 680 };
