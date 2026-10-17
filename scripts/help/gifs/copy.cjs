// Copy by base point: a copy at each click, from the same base point; Esc to finish.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('copy', {
  async setup(d) {
    await d.rect([10, 15], [16, 21]);
  },
  async play({ rec, click, modify, pick }) {
    await pick([10, 18]);
    await modify('edit.copyBase');
    await rec.hold(500);
    await click(10, 15);
    await click(20, 15);
    await click(30, 15);
    await rec.key('Escape', 'Esc');
  },
});
