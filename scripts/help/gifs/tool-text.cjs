// Text Box: drag a box, type, and finish with Ctrl+Enter.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-text', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, drag, tool }) {
    await tool('text');
    await drag([12, 18], [30, 24]);
    await page.waitForSelector('textarea.text-editor');
    await rec.type('NEW SPLASHBACK TO MATCH', { perFrame: 3, delay: 70 });
    await rec.key('Control+Enter', 'Ctrl+Enter');
  },
});
