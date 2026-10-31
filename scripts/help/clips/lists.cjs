// Bullet and numbered lists in text markups: type "- " or "1. ", Enter for the next item, Tab to nest.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('lists', {
  viewport: WIDE,
  zoom: (P) => [...P(4, 46), ...P(62, 8)],
  async setup() {},
  async play({ rec, page, tool, drag, h }) {
    const shot = (n) => process.env.DEBUG_CLIP && page.screenshot({ path: `scratch-${n}.png` });
    const commit = async () => {
      await page.keyboard.press('Control+Enter');
      await rec.hold(500);
    };
    await rec.caption('Type "- " for a bullet list');
    await tool('text');
    await drag([6, 45], [28, 33]);
    await rec.type('Site checks\n- Confirm setting out\n- Check levels\n');
    await page.keyboard.press('Tab');
    await rec.type('Datum on grid A\n');
    await page.keyboard.press('Shift+Tab');
    await rec.type('Photograph the slab');
    await shot(1);
    await commit();
    await rec.caption('Or "1. " for a numbered list');
    await tool('text');
    await drag([32, 45], [58, 33]);
    await rec.type('Pour sequence\n1. Pump to bay 1\nPour and screed\nCure for seven days');
    await shot(2);
    await commit();
    await rec.caption(null);
    await rec.hold(2000);
  },
});
