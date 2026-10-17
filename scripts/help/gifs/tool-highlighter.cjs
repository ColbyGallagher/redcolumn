// Highlighter: drag across words to highlight them.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-highlighter', {
  viewport: WIDE,
  zoom: () => [130, 160, 560, 250],
  async setup() {},
  async play({ tool, dragPt }) {
    await tool('highlighter');
    await dragPt([146, 206], [420, 206]);
  },
});
