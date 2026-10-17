// Polygon Cloud: click each corner, then the first corner again.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-polygon-cloud', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, click, tool }) {
    await tool('polygonCloud');
    for (const [x, y] of [[12, 14], [34, 14], [34, 28], [24, 28], [24, 21], [12, 21]]) await click(x, y);
    await rec.hold(400);
    await click(12, 14);
  },
});
