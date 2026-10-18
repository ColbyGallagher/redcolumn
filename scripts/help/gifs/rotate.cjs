// Rotate: type an angle, then click the base point.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('rotate', {
  async setup(d) {
    await d.rect([14, 14], [24, 20]);
  },
  async play({ rec, click, modify, pick, field }) {
    await pick([14, 17]);
    await modify('edit.rotate');
    await rec.hold(500);
    await field('Rotate angle', '30');
    await click(14, 14);
  },
});
