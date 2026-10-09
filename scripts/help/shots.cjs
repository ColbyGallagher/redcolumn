// Takes the help screenshots into apps/web/public/help/img.
//
//   pnpm dev                     (in another terminal; the scripts need the dev build's window.__nb)
//   python scripts/help/make_sample.py
//   NODE_PATH=<folder holding playwright> node scripts/help/shots.cjs [section ...]
//
// Each section is a file in scripts/help/sections and runs in a fresh browser profile, so the
// shots never show anyone's own files. CHROME may point at a Chromium to use; URL at the dev server.
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./lib.cjs');

const dir = path.join(__dirname, 'sections');
const all = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.cjs'))
  .map((f) => f.replace(/\.cjs$/, ''))
  .sort();
const wanted = process.argv.slice(2);
const run = wanted.length ? all.filter((s) => wanted.some((w) => s.includes(w))) : all;

(async () => {
  let failed = 0;
  for (const name of run) {
    console.log(`section ${name}`);
    const section = require(path.join(dir, `${name}.cjs`));
    const { browser, h } = await launch(section.viewport);
    try {
      await section(h);
    } catch (err) {
      failed++;
      console.error(`  FAILED ${name}:`, err.message);
      await h.page.screenshot({ path: path.join(__dirname, `failed-${name}.png`) }).catch(() => {});
    } finally {
      await browser.close();
    }
  }
  if (failed) process.exitCode = 1;
})();
