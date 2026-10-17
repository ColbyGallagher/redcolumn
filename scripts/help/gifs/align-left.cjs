// Align Left: three rectangles line up along their left edges.
const { demo } = require('../gifs-lib.cjs');

// The Align group sits at the right end of the ribbon, so this one needs a wider window.
module.exports = demo('align-left', {
  viewport: { width: 1560, height: 760 },
  async setup(d) {
    await d.rect([12, 14], [18, 18]);
    await d.rect([18, 20], [28, 24]);
    await d.rect([14, 26], [22, 29]);
  },
  async play({ rec, modify, pick }) {
    await pick([12, 16], [18, 22], [14, 27.5]);
    await rec.hold(400);
    await modify('edit.alignLeft');
  },
});
