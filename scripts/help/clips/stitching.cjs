// Plan stitching: outline the drawing on each plan sheet, click both ends of each match line,
// then join the four Kestrel road plan sheets (pages 6 to 9) into one continuous plan.
const SHEETS = [5, 6, 7, 8];
// Page points (from the top-left). The drawing area leaves out the title block strip on the right.
const REGION = [[60, 60], [1860, 1620]];
// Both ends of each match line, on the sheet that ends at it and on the one that continues from it.
const LINES = [
  [[5, [1772, 340], [1772, 1179]], [6, [130, 255], [130, 1094]]],
  [[6, [788, 1553], [1627, 1553]], [7, [416, 130], [1255, 130]]],
  [[7, [1772, 617], [1772, 1457]], [8, [130, 617], [130, 1457]]],
];

module.exports = async function (h, rec) {
  const { page } = h;
  const shot = (n) => process.env.DEBUG_CLIP && page.screenshot({ path: `scratch-${n}.png` });
  await h.open('kestrel-road-set1.pdf');
  await h.panel('Stitching');
  await page.keyboard.press('Control+9');
  await page.evaluate(() => window.__nb.viewer.goToPage(5));
  await h.wait(1500);
  const go = async (i) => {
    await page.evaluate((i) => window.__nb.viewer.goToPage(i), i);
    await h.wait(1600);
  };
  const tool = (name) => page.locator('.panel.left button', { hasText: name }).first();
  await shot(0);
  await rec.start();
  await rec.caption('Four plan sheets, each cut off at a match line');
  await rec.hold(2000);

  await rec.caption('Outline the drawing on each sheet, leaving out the title block');
  for (const i of SHEETS) {
    await go(i);
    // The tool stays on from the last sheet: only click it when it is off.
    if (!(await tool('Select Region').getAttribute('class')).includes('active')) await rec.click(tool('Select Region'));
    await rec.drag(await h.at(...REGION[0], i), await h.at(...REGION[1], i));
    await rec.hold(500);
  }
  await shot(1);

  await rec.caption('Click both ends of each match line, on both sheets');
  if (!(await tool('+ Match Line').getAttribute('class')).includes('active')) await rec.click(tool('+ Match Line'));
  for (const pair of LINES) {
    for (const [i, a, b] of pair) {
      await go(i);
      await rec.click(await h.at(...a, i).then((p) => ({ x: p.x, y: p.y })));
      await rec.click(await h.at(...b, i).then((p) => ({ x: p.x, y: p.y })));
      await rec.hold(700);
    }
  }
  await page.locator('.panel.left').evaluate((el) => el.querySelectorAll('*').forEach((e) => (e.scrollTop = 1e5)));
  await h.wait(300);
  await shot(2);

  await rec.caption('See the sheets joined in the Stitched View');
  await rec.click(tool('Stitched View'));
  await h.wait(1500);
  await page.keyboard.press('Control+0');
  await h.wait(800);
  await rec.hold(2500);
  await shot(3);

  await rec.caption('Or create the stitched plan as a new page');
  await rec.click(tool('Stitch to New Page'));
  await h.wait(3000);
  await page.keyboard.press('Control+0');
  await h.wait(1000);
  await rec.hold(4000);
  await shot(4);
};
module.exports.viewport = { width: 1180, height: 680 };
module.exports.poster = 1;
