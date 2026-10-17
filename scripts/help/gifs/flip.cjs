// Flip: a shape turned over horizontally, then vertically, in place.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('flip', {
  async setup(d) {
    await d.poly([[12, 14], [12, 25], [21, 25], [21, 21], [16, 21]]);
  },
  async play({ rec, modify, pick }) {
    await pick([12, 19]);
    await rec.hold(400);
    await modify('edit.flipHorizontal');
    await rec.hold(900);
    await modify('edit.flipVertical');
  },
});
