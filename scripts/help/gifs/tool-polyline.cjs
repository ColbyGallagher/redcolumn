// Polyline: click each corner, then Enter to finish.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-polyline', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, click, tool }) {
    await tool('polyline');
    for (const [x, y] of [[12, 15], [20, 15], [20, 23], [30, 23]]) await click(x, y);
    await rec.hold(400);
    await rec.key('Enter');
  },
});
