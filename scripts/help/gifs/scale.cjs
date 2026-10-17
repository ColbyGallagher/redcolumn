// Scale: type a factor, then click the base point that stays put.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('scale', {
  async setup(d) {
    await d.rect([14, 14], [20, 19]);
  },
  async play({ rec, click, modify, pick, field }) {
    await pick([14, 16]);
    await modify('edit.scale');
    await rec.hold(500);
    await field('Scale factor', '1.5');
    await click(14, 14);
  },
});
