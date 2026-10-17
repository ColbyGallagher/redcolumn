// Convert to Cloud: a rectangle becomes a revision cloud.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('convert-to-cloud', {
  async setup(d) {
    await d.rect([12, 14], [28, 24]);
  },
  async play({ rec, modify, pick }) {
    await pick([12, 19]);
    await rec.hold(400);
    await modify('edit.toCloud');
    await rec.hold(900);
  },
});
