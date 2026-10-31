// Cutouts: draw an area, cut a hole out of it, and the net area updates.
const { prepare, at } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  await prepare(h, { zoom: (P) => [...P(4, 42), ...P(46, 4)] });
  const pt = at(h);
  await rec.start();
  await rec.caption('Measure an area...');
  await rec.hold(700);
  await h.tool('area');
  for (const [x, y] of [[7, 38], [43, 38], [43, 8], [7, 8]]) await rec.click(await pt(x, y));
  await page.keyboard.press('Enter');
  await rec.hold(1200);
  await rec.caption('...then cut out the parts you do not want counted');
  await page.evaluate(() => {
    const t = window.__nb.tools;
    t.select([t.store.all().at(-1).id]);
  });
  await rec.click(page.locator('.rail, nav, aside').locator('text=Properties').first());
  await h.wait(500);
  await h.zoomTo(...h.plan(2, 44), ...h.plan(48, 2));
  await h.wait(500);
  await rec.hold(500);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-1.png' });
  const add = page.getByRole('button', { name: 'Add cutout' });
  await add.scrollIntoViewIfNeeded();
  await rec.hold(600);
  await rec.click(add);
  for (const [x, y] of [[14, 30], [26, 30], [26, 18], [14, 18]]) await rec.click(await pt(x, y));
  await page.keyboard.press('Enter');
  await rec.caption('The net area updates straight away');
  await rec.hold(500);
  if (process.env.DEBUG_CLIP) console.log(JSON.stringify(await page.evaluate(() => window.__nb.tools.store.all().map((m) => [m.type, m.holes && m.holes.length, window.__nb.tools.getState().tool]))));
  await rec.hold(2500);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-2.png' });
};
module.exports.viewport = { width: 1180, height: 680 };
