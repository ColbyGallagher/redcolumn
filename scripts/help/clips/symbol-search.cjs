// Symbol search: box one symbol and every copy of it is found and counted.
const { prepare, menuPath } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  await prepare(h, { zoom: (P) => [...P(8, 46), ...P(46, 12)] });
  await rec.start();
  await rec.caption('Count every light fitting without clicking each one');
  await rec.hold(1500);
  await rec.click(page.locator('[data-ribbon-tab=measure]'));
  await rec.click(page.locator('.rb-body [data-toolbar-tool="visualSearch"]'));
  await rec.hold(500);
  await rec.caption('Box one copy of the symbol');
  await rec.drag({ x: 497, y: 221 }, { x: 521, y: 245 });
  await rec.hold(2000);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-1.png' });
  await rec.caption('Every copy is found and counted');
  await rec.hold(1800);
  await rec.caption('Mark them all as a count in one click');
  await rec.click(page.getByRole('button', { name: 'Count', exact: true }));
  await rec.hold(2800);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-2.png' });
};
module.exports.viewport = { width: 1180, height: 680 };
