// Arc: click the start, a point it passes through, and the end.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-arc', {
  viewport: WIDE,
  async setup() {},
  async play({ click, tool }) {
    await tool('arc');
    for (const [x, y] of [[12, 15], [22, 25], [32, 15]]) await click(x, y);
  },
});
