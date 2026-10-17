// Hyperlink: drag a box, then choose where the link goes.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-hyperlink', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, drag, tool }) {
    await tool('hyperlink');
    await drag([12, 18], [30, 24]);
    await page.waitForSelector('.modal');
    await rec.hold(500);
    await rec.click(page.getByLabel('Web address'));
    await rec.type('https://example.com', { perFrame: 3, delay: 70 });
    await rec.click(page.locator('.modal button[type=submit]'));
  },
});
