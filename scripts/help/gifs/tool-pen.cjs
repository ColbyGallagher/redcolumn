// Pen: draw freehand.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-pen', {
  viewport: WIDE,
  async setup() {},
  async play({ tool, stroke }) {
    await tool('pen');
    await stroke(Array.from({ length: 41 }, (_, i) => [12 + i * 0.5, 20 + Math.sin(i / 4) * 3]));
  },
});
