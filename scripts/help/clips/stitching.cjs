// Plan stitching: three road sheets joined along their match lines into one continuous plan.
const { VIEWPORT, ribbon } = require('../gifs-lib.cjs');

module.exports = async function (h, rec) {
  const { page } = h;
  await h.open('sample-stitch.pdf');
  await h.run('Window', 'Toolbar Display', 'Ribbon: Tabs and Commands');
  await h.run('Window', 'Toggle Panels');
  await page.keyboard.press('Control+9');
  // redcolumn reads the sheets and finds the match lines in the background.
  await h.wait(6500);
  await rec.start();
  await rec.caption('Three separate sheets, joined at their match lines');
  await rec.hold(2200);
  await ribbon(h, rec, 'view', 'view.stitched');
  await h.wait(1200);
  await page.keyboard.press('Control+9');
  await h.wait(1200);
  await ribbon(h, rec, 'view', 'view.fitPage');
  await h.wait(900);
  await rec.caption('One continuous plan to view, mark up and measure');
  await rec.hold(3500);
};
module.exports.viewport = { width: 1180, height: 680 };
module.exports.poster = 1;
