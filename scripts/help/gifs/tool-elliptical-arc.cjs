// Elliptical Arc: drag the box the oval fits in.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-elliptical-arc', {
  viewport: WIDE,
  async setup() {},
  async play({ drag, tool }) {
    await tool('ellipticalArc');
    await drag([12, 14], [32, 26]);
  },
});
