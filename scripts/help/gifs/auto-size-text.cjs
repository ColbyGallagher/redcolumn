// Auto-size Text Box: a roomy text box shrinks to fit its text.
const { demo } = require('../gifs-lib.cjs');

module.exports = demo('auto-size-text', {
  async setup(d) {
    await d.text([12, 20], [32, 28], 'CHECK KITCHEN LAYOUT');
    await d.style({ fill: '#fff59d', fillOpacity: 1 });
  },
  async play({ rec, click, modify }) {
    await click(22, 24);
    await rec.hold(500);
    await modify('edit.autoSize');
  },
});
