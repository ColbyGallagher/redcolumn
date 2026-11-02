// Set-up shared by the Kestrel road clips: the plan sheets (pages 6 to 9) scaled 1:500 and
// stitched along their match lines, done without recording.
const SHEETS = [5, 6, 7, 8];
// Page points (from the top-left). The drawing area leaves out the title block strip on the right.
const REGION = [[60, 60], [1860, 1620]];
// Both ends of each match line, on the sheet that ends at it and on the one that continues from it.
const LINES = [
  [[5, [1772, 340], [1772, 1179]], [6, [130, 255], [130, 1094]]],
  [[6, [788, 1553], [1627, 1553]], [7, [416, 130], [1255, 130]]],
  [[7, [1772, 617], [1772, 1457]], [8, [130, 617], [130, 1457]]],
];

async function goTo(h, i) {
  await h.page.evaluate((i) => window.__nb.viewer.goToPage(i), i);
  await h.wait(1600);
}

/** Sets the scale of the four plan sheets to 1:500 from the scale box in the bottom bar. */
async function scalePlans(h) {
  for (const i of SHEETS) {
    await goTo(h, i);
    await h.page.locator('.pagenav-side.right select').selectOption({ label: '1:500' });
    await h.wait(400);
  }
}

/** Outlines the drawing on each plan sheet and joins them along their match lines. */
async function stitchPlans(h) {
  const { page } = h;
  await h.panel('Stitching');
  const tool = (name) => page.locator('.panel.left button', { hasText: name }).first();
  const active = async (name) => (await tool(name).getAttribute('class')).includes('active');
  for (const i of SHEETS) {
    await goTo(h, i);
    if (!(await active('Select Region'))) await tool('Select Region').click();
    const a = await h.at(...REGION[0], i);
    const b = await h.at(...REGION[1], i);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await h.wait(500);
  }
  if (!(await active('+ Match Line'))) await tool('+ Match Line').click();
  for (const pair of LINES) {
    for (const [i, a, b] of pair) {
      await goTo(h, i);
      for (const pt of [a, b]) {
        const p = await h.at(...pt, i);
        await page.mouse.move(p.x, p.y);
        await page.mouse.click(p.x, p.y);
        await h.wait(700);
      }
    }
  }
  if (await active('+ Match Line')) await tool('+ Match Line').click();
}

module.exports = { SHEETS, REGION, LINES, goTo, scalePlans, stitchPlans };
