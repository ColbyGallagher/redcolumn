// Eraser: rub out part of a pen stroke.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-eraser', {
  viewport: WIDE,
  async setup(d) {
    await d.pen(Array.from({ length: 41 }, (_, i) => [12 + i * 0.5, 20 + Math.sin(i / 4) * 3]));
  },
  async play({ drag, tool }) {
    await tool('eraser');
    await drag([21, 26], [21, 15], { steps: 44, every: 4 });
  },
});
