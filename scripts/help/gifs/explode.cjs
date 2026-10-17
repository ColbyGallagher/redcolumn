// Explode: a rectangle splits into four lines; one can then be picked on its own.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('explode', {
  async setup(d) {
    await d.rect([12, 14], [26, 24]);
  },
  async play({ rec, click, modify, pick }) {
    await pick([12, 19]);
    await modify('edit.explode');
    await rec.hold(500);
    await click(19, 24);
  },
});
