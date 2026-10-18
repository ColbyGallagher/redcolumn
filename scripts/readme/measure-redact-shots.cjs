// Takes the README screenshots of Smart Fill, Symbol Search, the grouped Markups list and
// Apply Redactions into docs/media/readme. Uses the same steps as scripts/help/sections
// (05-measure, 06-markups-list, 03-markup-tools), without the steps that no longer match the UI.
//
//   pnpm dev (or set URL to a running server), python scripts/help/make_sample.py
//   NODE_PATH=<folder holding playwright> node scripts/readme/measure-redact-shots.cjs
const fs = require('node:fs');
const path = require('node:path');

process.env.URL = process.env.URL || 'http://localhost:5173/';
const { launch, ROOT } = require('../help/lib.cjs');

const OUT = path.join(ROOT, 'docs/media/readme');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { browser, page, h } = await launch({ width: 1440, height: 860 });
  const P = h.plan;
  const stage = (name) => page.locator('main.stage').first().screenshot({ path: path.join(OUT, `${name}.png`) }).then(() => console.log('saved', name));
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`FAILED ${name}: ${err.message.split('\n')[0]}`);
      process.exitCode = 1;
      await page.screenshot({ path: path.join(OUT, `failed-${name}.png`) }).catch(() => {});
    }
  };
  try {
    await h.open('sample-plans.pdf');

    // Calibrate (sets the scale that Smart Fill and Symbol Search need).
    await step('calibrate', async () => {
      await h.tool('calibrate');
      await h.clicks([P(8, 7), P(38, 7)]);
      await h.wait(500);
      await page.locator('.modal input').first().fill('30');
      await page.locator('.modal button[type=submit], .modal .btn.primary').first().click();
      await h.wait(500);
    });
    await h.tool('select');

    // A few markups, so the list has something to group.
    await step('markups', async () => {
      await h.tool('rect');
      await h.drag(P(8, 22), P(20, 14));
      await h.tool('line');
      await h.drag(P(22, 30), P(34, 30));
      await h.tool('select');
      await h.wait(300);
    });

    // Grouped Markups list.
    await step('list-grouped', async () => {
      // The Group box is the select whose first option is "None".
      const groupSelect = page
        .locator('.bottom-dock select')
        .filter({ has: page.locator('option', { hasText: /^None$/ }) })
        .first();
      await groupSelect.selectOption({ label: 'Subject' });
      await h.wait(400);
      await page.locator('.bottom-dock').first().screenshot({ path: path.join(OUT, 'list-grouped.png') });
      console.log('saved list-grouped');
    });

    // Each feature shot starts from a clean page.
    const clear = () => page.evaluate(() => window.__nb.tools.store.remove(window.__nb.tools.store.all().map((m) => m.id)));

    // Smart Fill: click inside the living room.
    await step('smart-fill-result', async () => {
      await clear();
      await h.tool('dynamicFill');
      await h.clickAt(...P(15, 38));
      await h.wait(1500);
      await h.clickAt(...P(50, 30));
      await h.wait(1500);
      await h.tool('select');
      await stage('smart-fill-result');
    });

    // Symbol Search: box one light fitting, then count one per page.
    await step('symbol-search-counted', async () => {
      await clear();
      await h.tool('visualSearch');
      await h.drag(P(14.3, 43.7), P(15.7, 42.3));
      await h.wait(3000);
      await page.locator('button[title="One count per page, a point on each copy"]').click().catch(() => {});
      await h.wait(500);
      await h.tool('select');
      await stage('symbol-search-counted');
    });

    // Apply Redactions: mark an area, then open the Apply Redactions window.
    await step('apply-redactions', async () => {
      await h.tool('redaction');
      await h.drag(P(66, 50), P(84, 46));
      await h.run('Tools', 'Redaction', 'Apply Redactions…');
      await h.wait(400);
      await page.locator('.modal').first().screenshot({ path: path.join(OUT, 'apply-redactions.png') });
      console.log('saved apply-redactions');
      await h.closeModal();
    });
  } finally {
    await browser.close();
  }
})();
