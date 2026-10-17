// Extend: click near the end of a line to carry it on to the next markup.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('extend', {
  async setup(d) {
    await d.line([30, 12], [30, 27]);
    await d.line([12, 17], [24, 17]);
    await d.line([12, 23], [21, 23]);
  },
  async play({ rec, click, go, modify }) {
    await modify('edit.extend');
    await rec.hold(500);
    await go(23, 17);
    await rec.hold(600);
    await click(23, 17);
    await go(20, 23);
    await rec.hold(600);
    await click(20, 23);
    await rec.key('Escape', 'Esc');
  },
});
