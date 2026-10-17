// Legend: drag a box and it lists the markups on the page.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-legend', {
  viewport: WIDE,
  async setup(d) {
    await d.shape('cloud', [12, 14], [24, 24]);
    await d.shape('rect', [26, 14], [34, 22]);
    await d.shape('cloud', [14, 26], [32, 30]);
  },
  async play({ drag, tool }) {
    await tool('legend');
    await drag([38, 28], [52, 19]);
  },
});
