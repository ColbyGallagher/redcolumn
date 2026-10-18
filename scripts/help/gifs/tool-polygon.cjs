// Polygon: click each corner, then the first corner again to close it.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-polygon', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, click, tool }) {
    await tool('polygon');
    for (const [x, y] of [[12, 15], [30, 15], [30, 27], [21, 22], [12, 27]]) await click(x, y);
    await rec.hold(400);
    await click(12, 15);
  },
});
