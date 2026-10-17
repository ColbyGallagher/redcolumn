// Line: drag from where it starts to where it ends.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-line', {
  viewport: WIDE,
  async setup() {},
  async play({ drag, tool }) {
    await tool('line');
    await drag([12, 16], [32, 24]);
  },
});
