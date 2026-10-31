// Tables: draw a table, type in its cells, then add a row from the right-click menu.
const { prepare, markupTool, WIDE } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  const shot = (n) => process.env.DEBUG_CLIP && page.screenshot({ path: `scratch-${n}.png` });
  await prepare(h);
  // A blank sheet to draw on, so the table stands out.
  await page.locator('[data-ribbon-tab=diagram]').click();
  await page.locator('[data-ribbon-command="document.insertBlank"]').click();
  await page.locator('.modal button', { hasText: /^Insert$/ }).click();
  await h.wait(1200);
  await page.evaluate(() => window.__nb.viewer.goToPage(1));
  await h.wait(600);
  await h.zoomTo(100, 400, 1500, 880);
  await page.locator('[data-ribbon-tab=markup]').click();
  const from = await h.at(300, 560);
  const to = await h.at(800, 720);
  await rec.start();
  await rec.caption('Draw a table, pick its size');
  await rec.hold(700);
  await markupTool(h, rec, 'table');
  await rec.drag(from, to);
  await rec.hold(500);
  await page.locator('#table-rows').fill('4');
  await page.locator('#table-cols').fill('3');
  await rec.hold(500);
  await rec.click(page.locator('.modal button[type=submit]'));
  await rec.hold(500);
  await shot(1);
  await rec.caption('Double-click a cell and type');
  const cells = [
    ['Door', 'Qty', 'Size'],
    ['D1', '12', '900'],
    ['D2', '4', '1200'],
  ];
  const size = await page.evaluate(() => {
    const m = window.__nb.tools.store.all().find((x) => x.type === 'table');
    return m.points;
  });
  const [tl, br] = [{ x: size[0][0], y: size[0][1] }, { x: size[1][0], y: size[1][1] }];
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < 3; c++) {
      const px = await h.at(tl.x + ((br.x - tl.x) * (c + 0.5)) / 3, tl.y + ((br.y - tl.y) * (r + 0.5)) / 4);
      await rec.move(px.x, px.y);
      await page.mouse.dblclick(px.x, px.y);
      await rec.type(cells[r][c], { delay: 60 });
      await page.keyboard.press('Control+Enter');
      await rec.hold(150);
    }
  }
  await shot(2);
  await rec.caption('Right-click to add or delete rows and columns');
  const last = await h.at(tl.x + ((br.x - tl.x) * 0.5) / 3, tl.y + ((br.y - tl.y) * 2.5) / 4);
  await rec.move(last.x, last.y);
  await page.mouse.click(last.x, last.y, { button: 'right' });
  await rec.hold(700);
  await rec.click(page.locator('.context-menu, [role=menu]').locator('text=Insert Row Below').first());
  await rec.hold(1800);
  await shot(3);
};
module.exports.viewport = WIDE;
