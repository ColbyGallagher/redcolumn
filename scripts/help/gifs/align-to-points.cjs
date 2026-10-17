// Align to Points: two points on the shape land on two target points.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('align-to-points', {
  async setup(d) {
    await d.rect([12, 14], [18, 18]);
    await d.line([22, 12], [34, 22]);
  },
  async play({ rec, click, go, modify, pick }) {
    await pick([12, 16]);
    await modify('edit.alignPoints');
    await rec.hold(500);
    await click(12, 14);
    await click(22, 12);
    await click(18, 14);
    await go(34, 22);
    await rec.hold(700);
    await click(34, 22);
  },
});
