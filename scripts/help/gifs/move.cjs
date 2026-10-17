// Move: pick a rectangle, then a base point and where it goes.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('move', {
  async setup(d) {
    await d.rect([12, 15], [20, 23]);
  },
  async play({ rec, click, go, modify, pick }) {
    await pick([12, 19]);
    await modify('edit.move');
    await rec.hold(500);
    await click(12, 15);
    await go(26, 17);
    await rec.hold(700);
    await click(26, 17);
  },
});
