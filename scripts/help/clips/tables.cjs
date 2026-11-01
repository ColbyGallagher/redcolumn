// Tables: draw a table, merge the top row into a heading, type in the cells, make the heading
// larger and bold with smaller values underneath, then add a row from the right-click menu.
const { prepare, markupTool } = require('../gifs-lib.cjs');

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
  await h.zoomTo(200, 520, 740, 760);
  await page.locator('[data-ribbon-tab=markup]').click();
  const from = await h.at(250, 560);
  const to = await h.at(700, 700);
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
  await rec.hold(600);
  await shot(1);

  const size = await page.evaluate(() => window.__nb.tools.store.all().find((x) => x.type === 'table').points);
  const [tl, br] = [{ x: size[0][0], y: size[0][1] }, { x: size[1][0], y: size[1][1] }];
  const cell = (r, c) => h.at(tl.x + ((br.x - tl.x) * (c + 0.5)) / 3, tl.y + ((br.y - tl.y) * (r + 0.5)) / 4);

  await rec.caption('Drag across cells and merge them');
  await rec.drag(await cell(0, 0), await cell(0, 2));
  await rec.hold(500);
  const last = await cell(0, 2);
  await page.mouse.click(last.x, last.y, { button: 'right' });
  await rec.hold(600);
  await rec.click(page.getByText('Merge Cells', { exact: true }));
  await rec.hold(800);
  await shot(2);

  await rec.caption('Double-click a cell and type');
  const cells = [
    ['Door schedule'],
    ['D1', '12', '900'],
    ['D2', '4', '1200'],
    ['D3', '8', '1050'],
  ];
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      const px = await cell(r, r === 0 ? 1 : c);
      await rec.move(px.x, px.y);
      await page.mouse.dblclick(px.x, px.y);
      await rec.type(cells[r][c], { delay: 55 });
      await page.keyboard.press('Control+Enter');
      await rec.hold(150);
    }
  }
  await shot(3);

  const format = async (label, bold, pt) => {
    const tab = page.locator('[data-ribbon-tab]').filter({ hasText: 'Markup Format' });
    if ((await tab.getAttribute('aria-selected')) !== 'true') await rec.click(tab);
    const b = page.getByRole('button', { name: 'Bold' });
    if (bold !== ((await b.getAttribute('aria-pressed')) === 'true')) await rec.click(b);
    const input = page.locator('input.font-size');
    await rec.click(input);
    await page.keyboard.press('Control+A');
    await rec.type(String(pt), { delay: 90 });
    await page.keyboard.press('Enter');
    await rec.hold(700);
  };
  await rec.caption('Select the heading: larger and bold');
  await rec.drag(await cell(0, 0), await cell(0, 2));
  await rec.hold(300);
  await format('heading', true, 16);
  await shot(4);

  await rec.caption('Select the values: smaller, not bold');
  await rec.drag(await cell(1, 0), await cell(3, 2));
  await rec.hold(300);
  await format('values', false, 9);
  await shot(5);

  await rec.caption('Right-click to add or delete rows and columns');
  const at = await cell(3, 0);
  await rec.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await rec.hold(700);
  await rec.click(page.locator('.context-menu, [role=menu]').locator('text=Insert Row Below').first());
  await rec.hold(1200);
  await page.keyboard.press('Escape');
  await rec.hold(1800);
  await shot(6);
};
module.exports.viewport = { width: 1320, height: 700 };
