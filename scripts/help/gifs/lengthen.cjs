// Lengthen: change a line's length by a typed amount, at the end you click.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('lengthen', {
  async setup(d) {
    await d.line([12, 20], [22, 20]);
  },
  async play({ rec, click, go, modify, field }) {
    await modify('edit.lengthen');
    await rec.hold(500);
    await field('Length', '2.5');
    await go(21, 20);
    await rec.hold(700);
    await click(21, 20);
    await rec.key('Escape', 'Esc');
  },
});
