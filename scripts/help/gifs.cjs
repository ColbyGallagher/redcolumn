// Records the tool demo GIFs into apps/web/public/help/gif (and media/tool-gifs).
//
//   pnpm dev                     (in another terminal; the scripts need the dev build's window.__nb)
//   SCRIPT=gifs sh scripts/help/run.sh [name ...]     (or node scripts/help/gifs.cjs [name ...])
//
// Each demo is a file in scripts/help/gifs: it exports an async (h, rec) function plus
// `.gif` (the file name), and optionally `.viewport` and `.options` (see gif.cjs recorder).
// Like the help screenshots, each runs in a fresh browser profile on the sample drawings.
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./lib.cjs');
const { recorder } = require('./gif.cjs');

const dir = path.join(__dirname, 'gifs');
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
    console.log(`demo ${name}`);
    const demo = require(path.join(dir, `${name}.cjs`));
    const { browser, h } = await launch({ ...demo.viewport, toolbar: 'ribbon' });
    try {
      const rec = recorder(h.page, demo.options);
      await demo(h, rec);
      await rec.save(demo.gif || name);
    } catch (err) {
      failed++;
      console.error(`  FAILED ${name}:`, err.stack || err.message);
      await h.page.screenshot({ path: path.join(__dirname, `failed-${name}.png`) }).catch(() => {});
    } finally {
      await browser.close();
    }
  }
  if (failed) process.exitCode = 1;
})();
