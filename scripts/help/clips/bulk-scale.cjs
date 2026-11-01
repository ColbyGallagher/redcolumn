// Bulk apply scale: from the Thumbnails panel, draw a box round the scale in the title block of
// page 6 once and every sheet is scaled from its own title block. Uses the Kestrel road set.
module.exports = async function (h, rec) {
  const { page } = h;
  await h.open('kestrel-road-set1.pdf');
  await h.panel('Thumbnails');
  await page.evaluate(() => window.__nb.viewer.goToPage(5));
  await h.wait(1500);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-0.png' });
  await rec.start();
  await rec.caption('Every sheet has its own scale. Set them all at once');
  await rec.hold(1800);
  await rec.caption('In the Thumbnails panel, click Bulk Scales');
  await rec.click(page.getByRole('button', { name: 'Bulk Scales' }));
  await page.waitForSelector('.label-regions');
  await rec.hold(1000);
  await rec.caption('Zoom to the scale in the title block on page 6');
  await h.zoomTo(2084, 850, 2384, 930);
  await h.wait(500);
  await rec.hold(1200);
  await rec.caption('Draw a box round it, once');
  const a = await h.at(2184, 884);
  const b = await h.at(2232, 912);
  await rec.drag(a, b);
  await rec.hold(1500);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-1.png' });
  await rec.caption('Every sheet is scaled from its own title block');
  await rec.click(page.locator('.label-regions button', { hasText: /^Apply to/ }));
  await rec.hold(1500);
  await page.keyboard.press('Control+0');
  await h.wait(600);
  for (const i of [3, 15]) {
    await page.evaluate((i) => window.__nb.viewer.goToPage(i), i);
    await h.wait(900);
    await rec.hold(1500);
  }
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-2.png' });
};
module.exports.viewport = { width: 1180, height: 680 };
