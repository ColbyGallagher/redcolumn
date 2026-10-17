// Multiply: a grid of copies from the Multiply window.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('multiply', {
  async setup(d) {
    await d.rect([12, 22], [16, 26]);
  },
  async play({ rec, page, modify, pick }) {
    await pick([12, 24]);
    await modify('edit.multiply');
    await page.waitForSelector('.modal');
    await rec.hold(600);
    for (const [id, v] of [['#mult-cols', '4'], ['#mult-rows', '2'], ['#mult-gapx', '3'], ['#mult-gapy', '3']]) {
      await rec.click(page.locator(id));
      await page.keyboard.press('Control+a');
      await rec.type(v);
    }
    await rec.hold(400);
    await rec.click(page.locator('.modal button[type=submit]'));
  },
});
