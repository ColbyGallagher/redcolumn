// Takes the README screenshots of the takeoff tools into docs/media/takeoff.
//
// Same setup as the help screenshots (scripts/help/shots.cjs):
//   pnpm dev                       (in another terminal, or set URL to a running server)
//   python scripts/help/make_sample.py
//   NODE_PATH=<folder holding playwright> node scripts/readme/takeoff-shots.cjs
//
// Calibrates the sample sheet, measures a wall run, applies the Partition wall assembly to it,
// then saves the Assemblies window and the Takeoff Quantities totals.
const fs = require('node:fs');
const path = require('node:path');

process.env.URL = process.env.URL || 'http://localhost:5173/';
const { launch, ROOT } = require('../help/lib.cjs');

const OUT = path.join(ROOT, 'docs/media/takeoff');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { browser, page, h } = await launch({ width: 1440, height: 860 });
  const P = h.plan;
  const shot = async (name, locator) => {
    const target = locator ? page.locator(locator).first() : page;
    await target.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('saved', name);
  };
  try {
    await h.open('sample-plans.pdf');

    // Calibrate between grid lines 1 and 2 (30 feet apart), as the measure help does.
    await h.tool('calibrate');
    await h.clicks([P(8, 7), P(38, 7)]);
    await h.wait(500);
    await page.locator('.modal input').first().fill('30');
    await page.locator('.modal button[type=submit], .modal .btn.primary').first().click();
    await h.wait(500);
    await h.tool('select');

    // Measure a run of wall as a length.
    await h.tool('length');
    await h.clicks([P(8, 22), P(38, 22)], 'dbl');
    await h.wait(400);
    await page.evaluate(() => {
      const s = window.__nb.tools.store.all().filter((m) => m.tool === 'length' || /length/i.test(m.kind ?? m.type ?? ''));
      window.__nb.tools.select(s.slice(-1).map((m) => m.id));
    });
    await h.wait(300);

    // Assemblies window, with the Partition wall example.
    await h.run('Tools', 'Takeoff', 'Assemblies…');
    await page.locator('.modal').first().waitFor();
    await page.locator('.modal button', { hasText: /Examples/ }).first().click();
    await h.wait(300);
    await page.getByText(/Interior partition/i).first().click();
    await h.wait(400);
    await shot('assemblies-window', '.modal');
    await page.locator('.modal button', { hasText: /^Save$/ }).first().click();
    await h.wait(400);

    // Give the selected measurement the assembly, from the Measurements panel.
    await h.panel('Measurements');
    // The Assembly box is the select that lists the saved assembly as an option.
    const assemblySelect = page
      .locator('.panel.left select')
      .filter({ has: page.locator('option', { hasText: 'Interior partition' }) });
    const value = await assemblySelect.locator('option', { hasText: 'Interior partition' }).first().getAttribute('value');
    await assemblySelect.selectOption(value);
    await h.wait(400);

    // Totals for everything measured.
    await h.run('Tools', 'Takeoff', 'Takeoff Quantities…');
    await page.locator('.modal').first().waitFor();
    await h.wait(400);
    await shot('takeoff-quantities', '.modal');
    await h.closeModal();
  } catch (err) {
    console.error('FAILED:', err.message);
    await page.screenshot({ path: path.join(OUT, 'failed.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
