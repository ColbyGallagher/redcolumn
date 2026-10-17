// Rectangle: drag from one corner to the opposite one.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-rect', {
  viewport: WIDE,
  async setup() {},
  async play({ drag, tool }) {
    await tool('rect');
    await drag([12, 15], [28, 25]);
  },
});
