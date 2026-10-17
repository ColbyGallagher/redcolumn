// Mirror: pick a shape, then two points on the mirror line.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('mirror', {
  async setup(d) {
    await d.poly([[12, 14], [12, 25], [21, 25], [21, 21], [16, 21]]);
  },
  async play({ rec, click, go, modify, pick }) {
    await pick([12, 19]);
    await modify('edit.mirror');
    await rec.hold(500);
    await click(25, 12);
    await go(25, 28);
    await rec.hold(700);
    await click(25, 28);
  },
});
