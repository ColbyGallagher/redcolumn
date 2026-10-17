// Ellipse: drag the box the oval fills.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-ellipse', {
  viewport: WIDE,
  async setup() {},
  async play({ drag, tool }) {
    await tool('ellipse');
    await drag([12, 15], [30, 25]);
  },
});
