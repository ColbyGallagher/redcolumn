// Callout: press on the thing, drag to where the text goes, and type.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-callout', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, drag, tool }) {
    await tool('callout');
    await drag([14, 15], [28, 25]);
    await page.waitForSelector('textarea.text-editor');
    await rec.type('WINDOW SIZE TBC', { perFrame: 3, delay: 70 });
    await rec.key('Control+Enter', 'Ctrl+Enter');
  },
});
