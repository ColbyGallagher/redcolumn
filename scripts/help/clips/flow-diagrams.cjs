// Flow diagrams: flowchart shapes that add the next step and keep their connectors.
const { prepare, WIDE, ribbon } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  const shot = (n) => process.env.DEBUG_CLIP && page.screenshot({ path: `scratch-${n}.png` });
  await prepare(h);
  // A blank sheet to draw on, so the diagram stands out.
  await page.locator('[data-ribbon-tab=diagram]').click();
  await page.locator('[data-ribbon-command="document.insertBlank"]').click();
  await page.locator('.modal button', { hasText: /^Insert$/ }).click();
  await h.wait(1200);
  await page.evaluate(() => window.__nb.viewer.goToPage(1));
  await h.wait(600);
  await h.zoomTo(100, 500, 1100, 820);
  await shot(0);
  const from = await h.at(150, 560);
  const to = await h.at(330, 620);
  await rec.start();
  await rec.caption('Draw a shape, then add the next step in one click');
  await rec.hold(800);
  await ribbon(h, rec, 'diagram', 'diagram.terminator');
  await rec.drag(from, to);
  await rec.type('Start');
  await page.keyboard.press('Control+Enter');
  await rec.hold(400);
  await shot(1);
  const add = (side) => rec.click(page.locator(`[data-ribbon-command="diagram.add${side}"]`));
  const step = async (side, text) => {
    await add(side);
    await rec.type(text);
    await page.keyboard.press('Control+Enter');
    await rec.hold(300);
  };
  await step('Right', 'Check drawing');
  await step('Right', 'Approved?');
  await shot(2);
  // Make it a decision: the shape changes, its connectors stay.
  await rec.caption('Change the shape type any time, connectors stay attached');
  await rec.click(page.locator('.rb-select select').first());
  await page.locator('.rb-select select').first().selectOption({ label: 'Decision' });
  await rec.hold(900);
  await rec.caption('Branch the flow in any direction');
  await step('Right', 'Issue for construction');
  await page.evaluate(() => {
    const t = window.__nb.tools;
    const m = t.store.all().find((m) => JSON.stringify(m).includes('Approved?'));
    t.select([m.id]);
  });
  await rec.hold(500);
  await step('Below', 'Revise drawing');
  await shot(3);
  await rec.caption(null);
  await rec.hold(2500);
};
module.exports.viewport = { width: 1180, height: 680 };
