// Records short, scripted demos of the app as animated GIFs.
//
// A recorder takes one screenshot per step of the script (not real-time video), so the pointer,
// clicks and key presses are drawn exactly where and when the script says, the timing never
// depends on how fast the machine is, and the file stays small: only the pixels that changed
// between frames are stored.
//
//   const rec = recorder(page, { clip, scale });
//   await rec.start();                          // adds the pointer overlay
//   await rec.click(locatorOrPoint);            // glide to it, press, show a ring
//   await rec.key('O');                         // press a key and show it on screen
//   await rec.type('600');                      // type into the focused field
//   await rec.move(x, y); await rec.hold(800);  // glide, pause
//   await rec.save('offset');                   // encode to apps/web/public/help/gif/offset.gif
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.GIF_OUT || path.join(ROOT, 'apps/web/public/help/gif');
// A second copy in a plain folder, to reuse the GIFs outside the app (slides, chat, docs).
const COPY = process.env.GIF_COPY || path.join(ROOT, 'media/tool-gifs');

/** Drawn over the page for the recording: the pointer, the click ring and the key pill. */
const OVERLAY_CSS = `
.rec-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 28px; height: 28px; margin: -2px 0 0 -2px; transform-origin: 2px 2px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
.rec-ring { position: fixed; z-index: 2147483646; pointer-events: none; border-radius: 50%; border: 5px solid #ff5a1f; box-sizing: border-box; box-shadow: 0 0 0 2px #fff, inset 0 0 0 2px #fff; display: none; }
.rec-key { position: fixed; z-index: 2147483647; pointer-events: none; display: none; min-width: 44px; padding: 6px 14px; border-radius: 10px; background: #ffd33d; color: #111; font: 700 22px/28px system-ui, sans-serif; text-align: center; box-shadow: 0 3px 0 rgba(0,0,0,.45), 0 0 0 2px rgba(0,0,0,.35); }
.rec-caption { position: fixed; z-index: 2147483647; pointer-events: none; display: none; max-width: 70%; padding: 7px 16px; border-radius: 8px; background: rgba(8,12,24,.88); color: #fff; font: 600 17px/24px system-ui, sans-serif; box-shadow: 0 0 0 1.5px rgba(255,255,255,.35); }
`;

function recorder(page, { clip, scale = 1, glide = 7, frameMs = 55 } = {}) {
  const frames = []; // { rgba, w, h, delay }
  const pos = { x: 40, y: 40 };
  const vp = () => page.viewportSize();

  /** Takes a frame now; it stays up for `delay` ms. */
  async function shot(delay = frameMs) {
    const buf = await page.screenshot({ clip, type: 'png' });
    const png = PNG.sync.read(buf);
    let { data, width, height } = png;
    if (scale !== 1) ({ data, width, height } = resize(data, width, height, scale));
    frames.push({ rgba: data, w: width, h: height, delay });
  }

  const rec = {
    frames,
    pos,
    shot,

    /** Adds the overlay and shows the pointer at its starting spot. */
    async start() {
      await page.evaluate((css) => {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'rec-cursor');
        svg.setAttribute('viewBox', '0 0 24 24');
        const arrow = document.createElementNS(NS, 'path');
        arrow.setAttribute('d', 'M3 2 L3 19.5 L7.6 15.6 L10.6 22 L13.4 20.7 L10.5 14.4 L16.6 14 Z');
        arrow.setAttribute('fill', '#fff');
        arrow.setAttribute('stroke', '#000');
        arrow.setAttribute('stroke-width', '1.4');
        arrow.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(arrow);
        const ring = document.createElement('div');
        ring.className = 'rec-ring';
        const key = document.createElement('div');
        key.className = 'rec-key';
        const cap = document.createElement('div');
        cap.className = 'rec-caption';
        document.body.append(ring, key, cap, svg);
      }, OVERLAY_CSS);
      await rec.pointer(pos.x, pos.y);
    },

    /** Puts the drawn pointer at (x, y), pressed in a little if `down`. */
    async pointer(x, y, down = false) {
      pos.x = x;
      pos.y = y;
      await page.evaluate(
        ([x, y, down]) => {
          const c = document.querySelector('.rec-cursor');
          if (!c) return;
          c.style.transform = `translate(${x}px, ${y}px) scale(${down ? 0.82 : 1})`;
        },
        [x, y, down],
      );
    },

    /** Glides the pointer to (x, y) in `steps` frames, easing in and out. */
    async move(x, y, { steps = glide, dwell = frameMs } = {}) {
      const x0 = pos.x;
      const y0 = pos.y;
      const dist = Math.hypot(x - x0, y - y0);
      const n = Math.max(2, Math.min(steps * 2, Math.round(steps * Math.min(1.6, 0.5 + dist / 400))));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const e = t * t * (3 - 2 * t);
        const px = x0 + (x - x0) * e;
        const py = y0 + (y - y0) * e;
        await page.mouse.move(px, py);
        await rec.pointer(px, py);
        await shot(i === n ? dwell : frameMs);
      }
    },

    /** Where a locator or { x, y } is on screen: its middle. */
    async centre(target) {
      if (target && typeof target.x === 'number' && typeof target.y === 'number' && !target.boundingBox) return { x: target.x, y: target.y };
      const box = await (target.first ? target.first() : target).boundingBox();
      if (!box) throw new Error('rec: no box for ' + String(target));
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },

    /** Glides to a locator or point, presses and releases, and shows a ring spreading from it. */
    async click(target, { button = 'left', double = false, after = 120 } = {}) {
      const { x, y } = await rec.centre(target);
      await rec.move(x, y);
      await rec.pointer(x, y, true);
      await rec.ring(x, y, 0);
      await shot(70);
      if (double) await page.mouse.dblclick(x, y, { button });
      else await page.mouse.click(x, y, { button });
      await rec.pointer(x, y, false);
      for (const t of [0.35, 0.7, 1]) {
        await rec.ring(x, y, t);
        await shot(65);
      }
      await rec.ring(x, y, null);
      await page.waitForTimeout(after);
      await shot(frameMs);
    },

    /** Presses at `from`, glides to `to` holding the button down, and releases. Points are on screen. */
    async drag(from, to, { steps = 10, every = 1 } = {}) {
      await rec.move(from.x, from.y);
      await rec.pointer(from.x, from.y, true);
      await rec.ring(from.x, from.y, 0);
      await page.mouse.down();
      await shot(80);
      await rec.ring(from.x, from.y, null);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const e = t * t * (3 - 2 * t);
        const px = from.x + (to.x - from.x) * e;
        const py = from.y + (to.y - from.y) * e;
        await page.mouse.move(px, py);
        await rec.pointer(px, py, true);
        if (i % every === 0 || i === steps) await shot(frameMs);
      }
      await page.mouse.up();
      await rec.pointer(to.x, to.y, false);
      await rec.ring(to.x, to.y, 0.4);
      await shot(80);
      await rec.ring(to.x, to.y, null);
      await page.waitForTimeout(120);
      await shot(frameMs);
    },

    /** Presses at the first point, glides through the rest holding the button down, and releases (freehand). */
    async path(points, { every = 2 } = {}) {
      await rec.move(points[0].x, points[0].y);
      await rec.pointer(points[0].x, points[0].y, true);
      await page.mouse.down();
      await shot(70);
      for (let i = 1; i < points.length; i++) {
        await page.mouse.move(points[i].x, points[i].y);
        await rec.pointer(points[i].x, points[i].y, true);
        if (i % every === 0 || i === points.length - 1) await shot(frameMs);
      }
      await page.mouse.up();
      const last = points[points.length - 1];
      await rec.pointer(last.x, last.y, false);
      await page.waitForTimeout(120);
      await shot(frameMs);
    },

    /** Clicks each point in turn (a point or locator). */
    async clicks(points, opts) {
      for (const p of points) await rec.click(p, opts);
    },

    /** The click ring at progress t (0 to 1), or hidden for null. */
    async ring(x, y, t) {
      await page.evaluate(
        ([x, y, t]) => {
          const r = document.querySelector('.rec-ring');
          if (!r) return;
          if (t === null) {
            r.style.display = 'none';
            return;
          }
          const d = 24 + 48 * t;
          Object.assign(r.style, { display: 'block', left: `${x - d / 2}px`, top: `${y - d / 2}px`, width: `${d}px`, height: `${d}px`, opacity: String(1 - 0.5 * t), background: t < 0.2 ? 'rgba(255,90,31,.45)' : 'transparent' });
        },
        [x, y, t],
      );
    },

    /** Presses a key (Playwright name) and shows `label` on screen for a moment. */
    async key(name, label = name, { hold = 700, at = 'bl' } = {}) {
      await page.evaluate(
        ([label, at, x0, x1]) => {
          const k = document.querySelector('.rec-key');
          k.textContent = label;
          Object.assign(k.style, { display: 'block', left: at.includes('r') ? 'auto' : `${x0 + 24}px`, right: at.includes('r') ? `${innerWidth - x1 + 24}px` : 'auto', top: at.includes('t') ? '24px' : 'auto', bottom: at.includes('b') ? '60px' : 'auto' });
        },
        [label, at, clip?.x ?? 0, clip ? clip.x + clip.width : 0],
      );
      await page.keyboard.press(name);
      await page.waitForTimeout(150);
      await shot(hold);
      await page.evaluate(() => (document.querySelector('.rec-key').style.display = 'none'));
    },

    /** Types into the focused field, a few characters per frame. */
    async type(text, { perFrame = 1, delay = 90 } = {}) {
      for (let i = 0; i < text.length; i += perFrame) {
        await page.keyboard.type(text.slice(i, i + perFrame));
        await shot(delay);
      }
    },

    /** A short line of text at the top or bottom of the view, until `caption(null)`. */
    async caption(text, at = 'top') {
      await page.evaluate(
        ([text, at, cx]) => {
          const c = document.querySelector('.rec-caption');
          if (!text) {
            c.style.display = 'none';
            return;
          }
          c.textContent = text;
          Object.assign(c.style, { display: 'block', left: `${cx}px`, transform: 'translateX(-50%)', top: at === 'top' ? '14px' : 'auto', bottom: at === 'top' ? 'auto' : '14px' });
        },
        [text, at, clip ? clip.x + clip.width / 2 : innerWidth / 2],
      );
    },

    /** Holds the current picture for `ms`. */
    async hold(ms = 800) {
      await shot(ms);
    },

    /** Encodes the frames to <OUT>/<name>.gif (and the copy folder). Returns the file's size in bytes. */
    async save(name, { maxColors = 255, fps = 0 } = {}) {
      const merged = dedupe(frames);
      const gif = encode(merged, maxColors);
      // GIF_DUMP=<folder> also saves each distinct frame as a PNG, to look over while tuning.
      if (process.env.GIF_DUMP) {
        fs.mkdirSync(process.env.GIF_DUMP, { recursive: true });
        merged.forEach((f, i) => {
          const png = new PNG({ width: f.w, height: f.h });
          png.data = Buffer.from(f.rgba);
          fs.writeFileSync(path.join(process.env.GIF_DUMP, `${name}-${String(i).padStart(3, '0')}.png`), PNG.sync.write(png));
        });
      }
      for (const dir of [OUT, COPY].filter(Boolean)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${name}.gif`), gif);
      }
      const kb = (gif.length / 1024).toFixed(0);
      const secs = merged.reduce((s, f) => s + f.delay, 0) / 1000;
      console.log(`  gif ${name}: ${merged.length} frames (${frames.length} taken), ${secs.toFixed(1)} s, ${merged[0].w}x${merged[0].h}, ${kb} KB`);
      void fps;
      return gif.length;
    },
  };
  void vp;
  return rec;
}

/** Joins runs of identical frames into one frame that stays up for their total time. */
function dedupe(frames) {
  const out = [];
  for (const f of frames) {
    const prev = out[out.length - 1];
    if (prev && same(prev.rgba, f.rgba)) prev.delay += f.delay;
    else out.push({ ...f });
  }
  return out;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
  return true;
}

/**
 * One palette for the whole GIF, built from pixels of every frame (a UI uses few colours, so
 * 255 look clean) with the last entry kept as "unchanged since the previous frame": later frames
 * only store the pixels that moved, which is most of the saving.
 */
function encode(frames, maxColors) {
  const w = frames[0].w;
  const h = frames[0].h;
  // Sample pixels from every frame, weighting ones that differ from their neighbour so small
  // overlays (the ring, the pointer, the key) get palette entries too.
  const sample = [];
  frames.forEach((f, i) => {
    const prev = frames[i - 1];
    for (let p = 0; p < f.rgba.length; p += 4) {
      const changed = !prev || prev.rgba[p] !== f.rgba[p] || prev.rgba[p + 1] !== f.rgba[p + 1] || prev.rgba[p + 2] !== f.rgba[p + 2];
      if (changed || ((p >> 2) & 15) === 0) sample.push(f.rgba[p], f.rgba[p + 1], f.rgba[p + 2], 255);
    }
  });
  const palette = quantize(new Uint8Array(sample), Math.min(255, maxColors), { format: 'rgb565' });
  const TRANSPARENT = palette.length;
  palette.push([0, 0, 0]);

  const gif = GIFEncoder();
  let prevIndex = null;
  frames.forEach((f, i) => {
    const index = applyPalette(f.rgba, palette, 'rgb565');
    let out = index;
    if (prevIndex) {
      out = new Uint8Array(index.length);
      for (let p = 0; p < index.length; p++) out[p] = index[p] === prevIndex[p] ? TRANSPARENT : index[p];
    }
    gif.writeFrame(out, w, h, {
      palette: i === 0 ? palette : undefined,
      delay: Math.max(20, Math.round(f.delay / 10) * 10),
      transparent: i > 0,
      dispose: 1, // leave each frame in place so the next one only has to draw what changed
      transparentIndex: TRANSPARENT,
      repeat: 0,
    });
    prevIndex = index;
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** Box-filter shrink: averaging keeps thin lines and small text readable. */
function resize(data, w, h, scale) {
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * w + xx) * 4;
          r += data[p];
          g += data[p + 1];
          b += data[p + 2];
          n++;
        }
      const o = (y * nw + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: nw, height: nh };
}

module.exports = { recorder, OUT, COPY };
