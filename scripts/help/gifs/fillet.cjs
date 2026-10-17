// Fillet: a radius, then the two lines to round together.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('fillet', {
  async setup(d) {
    await d.line([12, 16], [26, 16]);
    await d.line([22, 12], [22, 28]);
  },
  async play({ rec, click, modify, field }) {
    await modify('edit.fillet');
    await rec.hold(500);
    await field('Radius', '1');
    await click(15, 16);
    await click(22, 25);
    await rec.key('Escape', 'Esc');
  },
});
