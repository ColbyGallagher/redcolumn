// Takes the README screenshot of the Sync to Excel window into docs/media/sync.
//
// Same setup as scripts/readme/takeoff-shots.cjs: a running dev server (URL), and the
// sample drawings from scripts/help/make_sample.py.
const fs = require('node:fs');
const path = require('node:path');

process.env.URL = process.env.URL || 'http://localhost:5173/';
const { launch, ROOT } = require('../help/lib.cjs');

// Sync to Excel only works in the Windows desktop app: stand in for its Excel bridge so the window
// shows what desktop users see (the web version shows a download prompt instead).
const stubDesktopExcel = (page) =>
  page.evaluate(() => {
    window.redcolumn = { excel: { pick: async () => null, write: async () => 'live', open: async () => {}, show: async () => {} } };
  });

const OUT = path.join(ROOT, 'docs/media/sync');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { browser, page, h } = await launch({ width: 1440, height: 860 });
  try {
    await h.open('sample-plans.pdf');
    // The sync button is off until there is something to write, so draw one line first.
    const P = h.plan;
    await h.tool('line');
    await h.drag(P(10, 27), P(28, 20));
    await h.wait(400);
    await h.tool('select');
    await h.wait(300);
    await stubDesktopExcel(page);
    await page.locator('button', { hasText: /^Sync to Excel/ }).first().click();
    await page.locator('.modal').first().waitFor();
    await h.wait(400);
    await page.locator('.modal').first().screenshot({ path: path.join(OUT, 'sync-to-excel.png') });
    console.log('saved sync-to-excel');
  } catch (err) {
    console.error('FAILED:', err.message);
    await page.screenshot({ path: path.join(OUT, 'failed.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
