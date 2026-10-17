// Join: three lines whose ends meet become one polyline.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('join', {
  async setup(d) {
    await d.line([12, 14], [20, 14]);
    await d.line([20, 14], [20, 22]);
    await d.line([20, 22], [30, 22]);
  },
  async play({ rec, modify, pick }) {
    await pick([16, 14], [20, 18], [25, 22]);
    await rec.hold(400);
    await modify('edit.join');
    await rec.hold(900);
  },
});
