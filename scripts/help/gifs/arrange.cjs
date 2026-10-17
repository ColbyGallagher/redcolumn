// Arrange: the bottom rectangle comes to the front, then goes back under the others.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('arrange', {
  async setup(d) {
    for (const [a, b, fill] of [
      [[12, 14], [22, 22], '#ef4444'],
      [[17, 17], [27, 25], '#3b82f6'],
      [[22, 20], [32, 28], '#22c55e'],
    ]) {
      await d.rect(a, b);
      await d.style({ fill, fillOpacity: 1 });
    }
  },
  async play({ rec, click, modify }) {
    await click(13, 16);
    await rec.hold(400);
    await modify('edit.bringToFront');
    await rec.hold(1000);
    await modify('edit.sendToBack');
  },
});
