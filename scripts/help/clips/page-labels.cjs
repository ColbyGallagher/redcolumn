// Page labels: from the Thumbnails panel, box the drawing number in the title block once and
// every sheet is labelled from its own title block. Uses the Kestrel road set.
module.exports = async function (h, rec) {
  const { page } = h;
  await h.open('kestrel-road-set1.pdf');
  await h.panel('Thumbnails');
  // The set's labels are read on open; clear them so the clip shows them being made.
  await page.mouse.click(5, 5);
  await page.locator('.panel.left canvas, .panel.left img').first().click({ button: 'right' });
  await h.wait(400);
  await page.getByText('Reset All Page Labels', { exact: true }).click();
  await h.wait(800);
  await page.evaluate(() => window.__nb.viewer.goToPage(5));
  await h.wait(1500);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-0.png' });
  await rec.start();
  await rec.caption('Pages are just numbers until they are labelled');
  await rec.hold(1800);
  await rec.caption('In the Thumbnails panel, click Page Label');
  await rec.click(page.getByRole('button', { name: 'Page Label' }));
  await page.waitForSelector('.label-regions');
  await rec.hold(800);
  await rec.click(page.locator('.label-regions label', { hasText: 'From boxes' }));
  await rec.hold(500);
  await rec.caption('Fold the panel away and zoom to the drawing number on page 6');
  await rec.click(page.locator('.rail button.active').first());
  await h.wait(500);
  await h.zoomTo(1782, 690, 2582, 800);
  await h.wait(500);
  await rec.hold(1200);
  await rec.caption('Draw a box round the drawing number, once');
  const a = await h.at(1876, 736);
  const b = await h.at(2243, 776);
  await rec.drag(a, b);
  await rec.hold(1800);
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-1.png' });
  await rec.caption('Apply it to every page');
  await rec.click(page.locator('.label-regions label', { hasText: 'All (20)' }));
  await rec.hold(800);
  await rec.caption('Every sheet is labelled from its own title block');
  await rec.click(page.locator('.label-regions button', { hasText: /^Apply to/ }));
  await rec.hold(1200);
  await rec.click(page.locator('.rail button').filter({ hasText: /Thumbnails/ }).first());
  await h.wait(600);
  // Scroll through the thumbnails: each one now carries its drawing number.
  await rec.caption('Scroll the thumbnails: every page now has its label');
  const box = await page.locator('.panel.left').boundingBox();
  await rec.move(box.x + 140, box.y + 350);
  await page.mouse.wheel(0, -6000);
  await h.wait(500);
  await rec.hold(900);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 420);
    await h.wait(250);
    await rec.hold(600);
  }
  if (process.env.DEBUG_CLIP) await page.screenshot({ path: 'scratch-2.png' });
};
module.exports.viewport = { width: 1180, height: 680 };
