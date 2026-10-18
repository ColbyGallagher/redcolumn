// Chamfer: a distance, then the two lines to cut the corner between.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('chamfer', {
  async setup(d) {
    await d.line([12, 16], [26, 16]);
    await d.line([22, 12], [22, 28]);
  },
  async play({ rec, click, modify, field }) {
    await modify('edit.chamfer');
    await rec.hold(500);
    await field('Distance', '1');
    await click(15, 16);
    await click(22, 25);
    await rec.key('Escape', 'Esc');
  },
});
