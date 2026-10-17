// Trim: click the parts of a line between the lines that cross it.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('trim', {
  async setup(d) {
    await d.line([10, 16], [34, 16]);
    await d.line([10, 24], [34, 24]);
    await d.line([18, 12], [18, 28]);
    await d.line([26, 12], [26, 28]);
  },
  async play({ rec, click, go, modify }) {
    await modify('edit.trim');
    await rec.hold(500);
    await go(22, 24);
    await rec.hold(700);
    await click(22, 24);
    await go(22, 16);
    await rec.hold(500);
    await click(22, 16);
    await rec.key('Escape', 'Esc');
  },
});
