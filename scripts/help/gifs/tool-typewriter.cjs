// Typewriter: click where the text starts and type.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-typewriter', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, click, tool }) {
    await tool('typewriter');
    await click(12, 20);
    await page.waitForSelector('textarea.text-editor');
    await rec.type('EXISTING SLAB', { perFrame: 2, delay: 70 });
    await rec.key('Control+Enter', 'Ctrl+Enter');
  },
});
