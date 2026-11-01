// Records the landing page's demo clips (apps/web/public/home/media/<name>.webm plus a poster
// <name>.png). Same set-up as the tool GIFs, with video out.
//
//   pnpm dev                     (in another terminal; the scripts need the dev build's window.__nb)
//   python scripts/help/make_sample.py
//   SCRIPT=clips sh scripts/help/run.sh [name ...]     (URL=http://localhost:5173/ by default)
//
// Each clip is a file in scripts/help/clips: an async (h, rec) function with `.viewport` and
// optional `.poster` (0 to 1, which frame is the poster).
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./lib.cjs');
const { recorder } = require('./gif.cjs');

const OUT = process.env.CLIP_OUT || path.resolve(__dirname, '../../apps/web/public/home/media');
const dir = path.join(__dirname, 'clips');
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).map((f) => f.replace(/\.cjs$/, '')).sort();
const wanted = process.argv.slice(2);
const run = wanted.length ? all.filter((s) => wanted.some((w) => s.includes(w))) : all;

(async () => {
  let failed = 0;
  for (const name of run) {
    console.log(`clip ${name}`);
    const clip = require(path.join(dir, `${name}.cjs`));
    const { browser, h } = await launch({ ...clip.viewport, toolbar: 'ribbon' });
    try {
      const rec = recorder(h.page, clip.options);
      await clip(h, rec);
      await rec.saveVideo(clip.clipName || name, OUT, { poster: clip.poster ?? 1, width: clip.width });
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
