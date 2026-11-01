// Takes the landing page's hero screenshot (apps/web/public/screenshots/wide.png): the sample
// plans with a few markups and measurements and the Markups list open, in the current theme.
//
//   pnpm dev                     (in another terminal; the scripts need the dev build's window.__nb)
//   python scripts/help/make_sample.py
//   SCRIPT=hero URL=http://localhost:5173/ sh scripts/help/run.sh
const path = require('node:path');
const { launch } = require('./lib.cjs');

const OUT = path.resolve(__dirname, '../../apps/web/public/screenshots/wide.png');

(async () => {
  const { browser, h, page } = await launch({ width: 1280, height: 800, units: 'imperial' });
  try {
    const P = h.plan;
    await h.open('sample-plans.pdf');
    await h.zoomTo(...P(5, 52), ...P(67, 4));
    await page.locator('.pagenav-side.right select').selectOption({ label: `1/4" = 1'-0"` });
    const add = async (tool, pts, how) => {
      await h.tool(tool);
      if (how === 'drag') await h.drag(pts[0], pts[1]);
      else await h.clicks(pts, how);
    };
    await add('cloud', [P(41, 40), P(61, 26)], 'drag');
    await add('rect', [P(9.5, 47.5), P(21, 30.5)], 'drag');
    await add('area', [P(38.5, 47.5), P(63.5, 47.5), P(63.5, 12.5), P(38.5, 12.5), P(38.5, 47.5)]);
    await add('length', [P(8.5, 21), P(37.5, 21)]);
    await add('count', [P(15, 43), P(30, 43), P(16, 25), P(30, 25)], 'enter');
    await page.evaluate(() => {
      const t = window.__nb.tools;
      const s = t.store;
      const all = s.all();
      const set = (i, patch) => all[i] && s.update(all[i].id, patch);
      set(0, { comment: 'Check floor finish', subject: 'Revision' });
      set(1, { comment: 'Wardrobe moved', status: 'completed', subject: 'Query' });
      set(2, { subject: 'Floor - Tiles' });
      t.setTool('select');
      t.select([]);
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+9');
    await h.wait(900);
    // Close the side panel so the drawing is the subject.
    await page.locator('.rail button.active').first().click();
    await h.wait(600);
    await h.zoomTo(...P(5, 52), ...P(67, 4));
    await page.mouse.move(640, 760);
    await page.screenshot({ path: OUT });
    console.log('saved', OUT);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
