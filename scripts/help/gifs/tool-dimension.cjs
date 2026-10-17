// Dimension: drag across what is being dimensioned, then type its text.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-dimension', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, drag, tool }) {
    await tool('dimension');
    await drag([12, 14], [34, 14]);
    await page.waitForSelector('.modal');
    await rec.hold(500);
    await rec.type('20\'-0"', { perFrame: 2 });
    await rec.key('Enter');
    await rec.hold(300);
  },
});
