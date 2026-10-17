// Cloud: drag from one corner to the opposite one.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-cloud', {
  viewport: WIDE,
  async setup() {},
  async play({ drag, tool }) {
    await tool('cloud');
    await drag([12, 14], [30, 26]);
  },
});
