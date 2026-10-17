// Break: click where the gap starts, then where it ends.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('break', {
  async setup(d) {
    await d.line([12, 20], [32, 20]);
  },
  async play({ rec, click, go, modify }) {
    await modify('edit.break');
    await rec.hold(500);
    await click(18, 20);
    await go(26, 20);
    await rec.hold(700);
    await click(26, 20);
    await rec.key('Escape', 'Esc');
  },
});
