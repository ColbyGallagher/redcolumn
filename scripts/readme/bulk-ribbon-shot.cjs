// Takes the README screenshot of the Bulk ribbon tab into docs/media/readme/bulk-ribbon.png.
//
// Same setup as scripts/readme/takeoff-shots.cjs: a running dev server (URL), and the
// sample drawings from scripts/help/make_sample.py.
const fs = require('node:fs');
const path = require('node:path');

process.env.URL = process.env.URL || 'http://localhost:5173/';
const { launch, ROOT } = require('../help/lib.cjs');

const OUT = path.join(ROOT, 'docs/media/readme');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { browser, page, h } = await launch({ width: 1440, height: 860 });
  try {
    await h.open('sample-plans.pdf');
    // The app opens in its toolbar layout; switch to the full ribbon first.
    await page.locator('[aria-label="Toolbar display options"]').first().click();
    await page.locator('.rb-display-menu').getByText('Show Tabs and Commands').first().click();
    await h.wait(300);
    await page.locator('[data-ribbon-tab="bulk"]').first().click();
    await h.wait(400);
    await page.locator('.ribbon').first().screenshot({ path: path.join(OUT, 'bulk-ribbon.png') });
    console.log('saved bulk-ribbon');
  } catch (err) {
    console.error('FAILED:', err.message);
    await page.screenshot({ path: path.join(OUT, 'failed-bulk.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
