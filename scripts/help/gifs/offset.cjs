// Offset: pick a polyline, start Offset, type a distance and copies, move to the side the copies
// go, and click to place them.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('offset', {
  async setup(d) {
    await d.poly([[10, 15], [30, 15], [30, 24]]);
  },
  async play({ rec, page, click, go, bar, modify, pick, field }) {
    await pick([20, 15]);
    await modify('edit.offset');
    await rec.hold(500);
    await field('Distance', '0.6');
    await rec.click(bar.getByLabel('Copies'));
    await page.keyboard.press('Control+a');
    await rec.type('3');
    await rec.hold(300);
    await go(24, 19);
    await rec.hold(900);
    await click(24, 19);
  },
});
