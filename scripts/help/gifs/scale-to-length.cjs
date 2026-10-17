// Scale to Length: two points on a shape whose real distance is known, then the length it should be.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('scale-to-length', {
  async setup(d) {
    await d.rect([14, 14], [20, 19]);
  },
  async play({ rec, page, click, modify, pick }) {
    await pick([14, 16]);
    await modify('edit.scaleToLength');
    await rec.hold(500);
    await click(14, 14);
    await click(20, 14);
    await page.waitForSelector('.modal');
    await rec.hold(500);
    await rec.click(page.getByLabel('New length'));
    await rec.type('3.66', { perFrame: 2 });
    await rec.hold(400);
    await rec.click(page.locator('.modal button[type=submit]'));
  },
});
