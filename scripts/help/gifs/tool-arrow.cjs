// Arrow: drag from the tail to the thing it points at.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-arrow', {
  viewport: WIDE,
  async setup() {},
  async play({ drag, tool }) {
    await tool('arrow');
    await drag([12, 16], [32, 24]);
  },
});
