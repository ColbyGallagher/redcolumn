// Bullet and numbered lists in text markups: type "- " or "1. ", Enter for the next item, Tab to nest.
const { prepare, markupTool, WIDE } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  const shot = (n) => process.env.DEBUG_CLIP && page.screenshot({ path: `scratch-${n}.png` });
  await prepare(h);
  // A blank sheet to type on, so the lists stand out.
  await page.locator('[data-ribbon-tab=diagram]').click();
  await page.locator('[data-ribbon-command="document.insertBlank"]').click();
  await page.locator('.modal button', { hasText: /^Insert$/ }).click();
  await h.wait(1200);
  await page.evaluate(() => window.__nb.viewer.goToPage(1));
  await h.wait(600);
  await h.zoomTo(120, 440, 900, 720);
  await page.locator('[data-ribbon-tab=markup]').click();
  const commit = async () => {
    await page.keyboard.press('Control+Enter');
    await rec.hold(600);
  };
  const box = async (a, b) => rec.drag(await h.at(...a), await h.at(...b));
  await rec.start();
  await rec.caption('Type "- " and a bullet list starts');
  await rec.hold(600);
  await markupTool(h, rec, 'text');
  await box([160, 480], [480, 700]);
  await rec.type('Site checks\n- Confirm setting out\nCheck levels\n', { delay: 55 });
  await page.keyboard.press('Tab');
  await rec.type('Datum on grid A\n', { delay: 55 });
  await page.keyboard.press('Shift+Tab');
  await rec.type('Photograph the slab', { delay: 55 });
  await rec.hold(500);
  await shot(1);
  await commit();
  await rec.caption('"1. " starts a numbered list that renumbers itself');
  await markupTool(h, rec, 'text');
  await box([560, 480], [880, 700]);
  await rec.type('Pour sequence\n1. Pump to bay 1\nPour and screed\nCure for seven days', { delay: 55 });
  await rec.hold(500);
  await shot(2);
  await commit();
  await rec.caption(null);
  await rec.hold(2200);
};
module.exports.viewport = { width: 1180, height: 680 };
