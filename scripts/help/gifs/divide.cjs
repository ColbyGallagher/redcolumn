// Divide: mark a path into equal parts with Count markups.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('divide', {
  async setup(d) {
    await d.poly([[12, 14], [20, 25], [30, 16]]);
  },
  async play({ rec, click, go, modify, field }) {
    await modify('edit.divide');
    await rec.hold(500);
    await field('Parts', '5');
    await go(16, 19.5);
    await rec.hold(700);
    await click(16, 19.5);
  },
});
