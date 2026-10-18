// Stamp: choose a stamp from the Tools menu, then drag a box to place it.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-stamp', {
  viewport: WIDE,
  async setup() {},
  async play({ rec, drag, menu }) {
    await menu('Tools', 'Stamp', 'Approved');
    await rec.hold(300);
    await drag([12, 16], [28, 24]);
  },
});
