// Snapshot: drag a box round the area to copy as a picture.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-snapshot', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, drag, tool }) {
    await tool('snapshot');
    await drag([10, 12], [36, 30]);
    await rec.hold(1200);
  },
});
