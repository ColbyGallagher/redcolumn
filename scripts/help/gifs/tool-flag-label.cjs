// Flag Label: drag a box for the flag and type its label.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-flag-label', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, drag, tool }) {
    await tool('flagLabel');
    await drag([12, 19], [22, 23]);
    await page.waitForSelector('textarea.text-editor');
    await rec.type('RFI 012', { perFrame: 2, delay: 80 });
    await rec.key('Control+Enter', 'Ctrl+Enter');
  },
});
