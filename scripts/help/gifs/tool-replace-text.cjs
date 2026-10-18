// Replace Text: drag across the words, then type what replaces them.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-replace-text', {
  viewport: WIDE,
  zoom: () => [130, 160, 560, 250],
  async setup() {},
  async play({ rec, page, tool, dragPt }) {
    await tool('replaceText');
    await dragPt([300, 206], [345, 206]);
    await page.waitForSelector('.modal');
    await rec.hold(500);
    await rec.type('MEASURE', { perFrame: 2, delay: 80 });
    await rec.key('Enter');
    await rec.hold(300);
  },
});
