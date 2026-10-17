// Stretch: a crossing window round one edge, then a base point and where it goes.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('stretch', {
  async setup(d) {
    await d.rect([12, 14], [24, 24]);
  },
  async play({ rec, click, go, modify }) {
    await modify('edit.stretch');
    await rec.hold(500);
    await click(21, 27);
    await go(27, 11);
    await rec.hold(500);
    await click(27, 11);
    await click(24, 19);
    await go(32, 19);
    await rec.hold(700);
    await click(32, 19);
  },
});
