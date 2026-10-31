// Page labels: box the sheet number once and every page is labelled from its own title block.
const { menuPath } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  await h.open('sample-plans.pdf');
  await h.run('Window', 'Toolbar Display', 'Ribbon: Tabs and Commands');
  await page.keyboard.press('Control+0');
  await h.wait(800);
  await rec.start();
  await rec.caption('Pages are just numbers until they are labelled');
  await rec.hold(1500);
  await menuPath(h, rec, 'Document', 'Page Labels', 'From Page Region…');
  await page.waitForSelector('.label-regions');
  await h.zoomTo(1280, 1100, 1700, 1280);
  await h.wait(500);
  await rec.caption('Draw a box round the sheet number, once');
  await rec.hold(800);
  const a = await h.at(1440, 1196);
  const b = await h.at(1525, 1232);
  await rec.drag(a, b);
  await rec.hold(1200);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-1.png' });
  await rec.caption('Every sheet is labelled from its own title block');
  await rec.click(page.locator('.label-regions button', { hasText: /^Apply to/ }));
  await rec.hold(3200);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-2.png' });
};
module.exports.viewport = { width: 1180, height: 680 };
