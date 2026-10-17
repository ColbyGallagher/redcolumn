// Note: click where the note goes and type its comment.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-note', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, click, tool }) {
    await tool('note');
    await click(20, 20);
    await page.waitForSelector('.modal');
    await rec.hold(500);
    await rec.type('Check the extract fan position with the electrician.', { perFrame: 4, delay: 70 });
    await rec.key('Control+Enter', 'Ctrl+Enter');
  },
});
