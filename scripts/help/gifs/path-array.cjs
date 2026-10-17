// Path Array: copies spaced evenly along a path.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('path-array', {
  async setup(d) {
    await d.ellipse([10, 13], [13, 16]);
    await d.poly([[14, 15], [20, 25], [30, 17]]);
  },
  async play({ rec, click, go, modify, pick, field }) {
    await pick([10, 14.5]);
    await modify('edit.arrayPath');
    await rec.hold(500);
    await field('Items', '6');
    await go(17, 20);
    await rec.hold(700);
    await click(17, 20);
  },
});
