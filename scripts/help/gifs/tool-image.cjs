// Image: pick a picture, then drag a box to place it.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-image', {
  viewport: WIDE,
  async setup() {},
  async play({ drag, tool, chooseFile }) {
    await chooseFile(() => tool('image'), 'site-photo.png');
    await drag([14, 16], [28, 26]);
  },
});
