// Polar Array: copies round a centre point.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('polar-array', {
  async setup(d) {
    await d.rect([19, 23], [23, 27]);
  },
  async play({ rec, click, go, modify, pick, field }) {
    await pick([19, 25]);
    await modify('edit.arrayPolar');
    await rec.hold(500);
    await field('Items', '6');
    await go(21, 17);
    await rec.hold(700);
    await click(21, 17);
  },
});
