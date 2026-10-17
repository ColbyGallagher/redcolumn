// Text Highlight: drag across words in the PDF text.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-text-highlight', {
  viewport: WIDE,
  zoom: () => [130, 160, 560, 250],
  async setup() {},
  async play({ tool, dragPt }) {
    await tool('textHighlight');
    await dragPt([146, 206], [420, 206]);
  },
});
