// Cloud+: drag a cloud, then type the note that comes with it.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-cloud-plus', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, page, drag, tool }) {
    await tool('cloudPlus');
    await drag([12, 14], [26, 24]);
    await page.waitForSelector('textarea.text-editor');
    await rec.hold(400);
    await rec.type('CONFIRM BENCH LENGTH', { perFrame: 3, delay: 70 });
    await rec.key('Control+Enter', 'Ctrl+Enter');
  },
});
