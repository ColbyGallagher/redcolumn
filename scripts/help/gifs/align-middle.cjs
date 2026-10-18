// Align Middle: three rectangles line up along their vertical centres.
const { demo } = require('../gifs-lib.cjs');

// The Align group sits at the right end of the ribbon, so this one needs a wider window.
module.exports = demo('align-middle', {
  viewport: { width: 1560, height: 760 },
  async setup(d) {
    await d.rect([12, 14], [16, 18]);
    await d.rect([20, 18], [27, 26]);
    await d.rect([31, 12], [34, 16]);
  },
  async play({ rec, modify, pick }) {
    await pick([12, 16], [20, 22], [31, 14]);
    await rec.hold(400);
    await modify('edit.alignMiddle');
  },
});
