// Redaction: mark an area, then apply the redaction from the Tools menu.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-redaction', {
  viewport: WIDE,
  zoom: () => [130, 160, 560, 250],
  async setup() {},
  async play({ rec, page, tool, menu, dragPt }) {
    await tool('redaction');
    await dragPt([146, 200], [420, 213]);
    await rec.hold(700);
    await menu('Tools', 'Redaction', 'Apply Redactions…');
    await page.waitForSelector('.modal');
    await rec.hold(700);
    await rec.click(page.getByRole('button', { name: 'Apply', exact: true }));
    await rec.hold(300);
  },
});
