// Underline, Strikethrough and Squiggly: each marks words in the PDF text.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-underline', {
  viewport: WIDE,
  zoom: () => [130, 160, 560, 250],
  async setup() {},
  async play({ tool, dragPt }) {
    await tool('underline');
    await dragPt([146, 193], [420, 193]);
    await tool('strikeout');
    await dragPt([146, 219], [420, 219]);
    await tool('squiggly');
    await dragPt([146, 232], [335, 232]);
  },
});
