// Geospatial: lay the Kestrel road LandXML design over the stitched plan, drag it into line with
// the drawing and georeference every sheet, then show the coordinates read out at the bottom right.
const { goTo, scalePlans, stitchPlans } = require('../kestrel.cjs');

// Where the design's start of works (CH 0) sits once laid over page 6, and where the drawing
// has it: the sheets are 1:500 and north up, so a move lines the whole design up.
const MODEL_START = [391.66, 701.35];
const DRAWING_START = [184.6, 759.5];

module.exports = async function (h, rec) {
  const { page } = h;
  const shot = (n) => process.env.DEBUG_CLIP && page.screenshot({ path: `scratch-${n}.png` });
  await h.open('kestrel-road-set1.pdf');
  await scalePlans(h);
  await stitchPlans(h);
  await goTo(h, 5);
  await page.keyboard.press('Control+0');
  await h.wait(800);
  await shot(0);
  await rec.start();
  await rec.caption('Four plan sheets, stitched into one plan');
  await rec.hold(1500);
  await rec.caption('Open the Geospatial panel and choose all the stitched sheets');
  await rec.click(page.locator('.rail button', { hasText: /^\s*Geospatial/ }));
  await rec.hold(700);
  await rec.click(page.locator('label', { hasText: 'All stitched sheets' }));
  await rec.hold(700);
  await rec.caption('Open the road design (a LandXML file)');
  await rec.click(page.getByRole('button', { name: 'Open Model…' }));
  await page.setInputFiles('input[type=file][accept*=xml]', h.sample('kestrel-road-alignment.xml'));
  await h.wait(3000);
  await rec.hold(1500);
  await shot(1);

  await rec.caption('Drag the design into line with the drawing');
  await h.zoomTo(100, 600, 800, 900);
  await rec.hold(1200);
  await rec.drag(await h.at(...MODEL_START, 5), await h.at(...DRAWING_START, 5), { steps: 24 });
  await rec.hold(2500);
  await shot(2);

  await rec.caption('Georeference every sheet');
  const go = page.getByRole('button', { name: /^Georeference/ });
  await go.scrollIntoViewIfNeeded();
  await rec.hold(500);
  await rec.click(go);
  await rec.hold(1500);
  await shot(3);

  await rec.caption('Hover the drawing: real-world coordinates, bottom right');
  const stops = [[250, 790], [400, 800], [560, 820], [720, 800]];
  const first = await h.at(...stops[0], 5);
  await rec.move(first.x, first.y, { steps: 18 });
  await h.wait(500);
  // The status bar's right-hand readout switches from sheet distances to latitude and longitude:
  // box whatever is at its right-hand end.
  const readout = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll('.statusbar *')].filter((e) => !e.children.length && e.textContent.trim() && e.getBoundingClientRect().left > 900);
    if (!leaves.length) return null;
    const rs = leaves.map((e) => e.getBoundingClientRect());
    const x = Math.min(...rs.map((r) => r.left));
    const y = Math.min(...rs.map((r) => r.top));
    return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
  });
  if (readout) await h.mark([readout], { numbers: false, pad: 6 });
  for (const [x, y] of stops) {
    const p = await h.at(x, y, 5);
    await rec.move(p.x, p.y, { steps: 18 });
    await rec.hold(1500);
  }
  await shot(4);
};
module.exports.viewport = { width: 1180, height: 680 };
