// Helpers for the help screenshots: start a clean browser on the dev server, open the sample
// drawings, mark up the UI with numbered boxes, and save cropped screenshots.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = path.join(ROOT, 'apps/web/public/help/img');
const SAMPLES = path.join(__dirname, 'samples');
const CHROME = process.env.CHROME || undefined;

const sample = (name) => path.join(SAMPLES, name);

/** CSS added to every page: hides the development overlay and makes the marks. */
const CSS = `
.stats { display: none !important; }
.help-mark { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid #e11d48; border-radius: 6px; box-shadow: 0 0 0 2px rgba(255,255,255,.85); }
.help-badge { position: fixed; z-index: 2147483647; pointer-events: none; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px; background: #e11d48; color: #fff; font: 700 14px/24px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; box-sizing: border-box; }
.help-cursor { position: fixed; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px; }
`;

async function launch({ width = 1440, height = 860 } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark', acceptDownloads: true });
  await ctx.addInitScript((css) => {
    // A fixed author for markups, and no first-run notices.
    try {
      localStorage.setItem('nb.author', 'Alex Smith');
    } catch {}
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    });
  }, CSS);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('  page error:', String(e).slice(0, 200)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(URL);
  await page.waitForSelector('.menubar');
  return { browser, ctx, page, h: helpers(page) };
}

function helpers(page) {
  const h = {
    page,
    /** Opens a sample PDF (by file name) and waits for it to draw. */
    async open(name = 'sample-plans.pdf') {
      await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(Array.isArray(name) ? name.map(sample) : sample(name));
      await page.waitForFunction(() => window.__nb?.tools?.store);
      await page.waitForTimeout(1800);
    },
    sample,
    /** Runs `action` (which opens a file picker) and picks sample files in it. */
    async choose(action, names) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), action()]);
      await chooser.setFiles([].concat(names).map(sample));
      await page.waitForTimeout(1500);
    },
    /** Like choose, but carries on if no file picker opens within `ms`. */
    async maybeChoose(action, names, ms = 2500) {
      const picker = page.waitForEvent('filechooser', { timeout: ms }).catch(() => null);
      await action();
      const chooser = await picker;
      if (chooser) {
        await chooser.setFiles([].concat(names).map(sample));
        await page.waitForTimeout(1500);
      }
      return !!chooser;
    },
    async wait(ms = 400) {
      await page.waitForTimeout(ms);
    },
    /** Opens a top menu and, optionally, hovers through submenus. Returns the drop-down locator. */
    async menu(title, ...subs) {
      await page.keyboard.press('Escape');
      await page.locator('.menubar .menu-title', { hasText: new RegExp(`^${title}$`) }).click();
      for (const s of subs) {
        await page
          .locator('.menu-sub > .menu-item')
          .filter({ has: page.locator('.label', { hasText: new RegExp(`^${escape(s)}$`) }) })
          .last()
          .hover();
        await page.waitForTimeout(250);
      }
      return page.locator('.menu-drop');
    },
    /** A menu item by its label (in the open menu or flyout). */
    item(label) {
      return page.locator('.menu-drop .menu-item, .menu-flyout .menu-item').filter({ has: page.locator('.label', { hasText: new RegExp(`^${escape(label)}$`) }) }).last();
    },
    async run(title, ...pathLabels) {
      const last = pathLabels.pop();
      await h.menu(title, ...pathLabels);
      await h.item(last).click();
      await page.waitForTimeout(500);
    },
    /** Closes any open dialog: its Cancel or Close button, else a click on the backdrop. */
    async closeModal() {
      for (let i = 0; i < 4 && (await page.locator('.modal-backdrop').count()); i++) {
        const btn = page.locator('.modal .actions button, .modal button').filter({ hasText: /^(Cancel|Close)$/ }).last();
        if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => {});
        else await page.mouse.click(4, page.viewportSize().height - 4);
        await page.waitForTimeout(250);
      }
    },
    async closeMenus() {
      await page.keyboard.press('Escape');
      await page.mouse.click(5, page.viewportSize().height - 5);
    },
    /** Opens a left panel by its title on the panel rail. */
    async panel(title) {
      const btn = page.locator('.rail button').filter({ hasText: new RegExp(`^\\s*${escape(title)}`) }).first();
      // The rail toggles: clicking the open panel's button would close it.
      const open = (await btn.getAttribute('class'))?.includes('active') && (await page.locator('.panel.left').count()) > 0;
      if (!open) await btn.click();
      await page.waitForTimeout(500);
    },
    async tool(tool) {
      await page.evaluate((t) => window.__nb.tools.setTool(t), tool);
      await page.waitForTimeout(150);
    },
    /** Screen point of a page point (pt from the page's top-left). */
    async at(x, y, pageIndex) {
      return page.evaluate(([x, y, i]) => {
        const v = window.__nb.viewer;
        const [cx, cy] = v.pageToClient([x, y], i ?? v.currentPageIndex);
        return { x: cx, y: cy };
      }, [x, y, pageIndex]);
    },
    /** Drags on the drawing between page points. */
    async drag(from, to, steps = 12) {
      const a = await h.at(...from);
      const b = await h.at(...to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps });
      await page.mouse.up();
      await page.waitForTimeout(250);
    },
    /** Clicks page points in turn; `finish` presses Enter or double-clicks the last. */
    async clicks(points, finish) {
      for (const p of points) {
        const c = await h.at(...p);
        await page.mouse.click(c.x, c.y);
        await page.waitForTimeout(120);
      }
      if (finish === 'enter') await page.keyboard.press('Enter');
      if (finish === 'dbl') {
        const c = await h.at(...points[points.length - 1]);
        await page.mouse.dblclick(c.x, c.y);
      }
      await page.waitForTimeout(250);
    },
    async clickAt(x, y) {
      const c = await h.at(x, y);
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(250);
    },
    /** Zooms so page rectangle [x0, y0, x1, y1] (pt) fills the view. */
    async zoomTo(x0, y0, x1, y1) {
      await page.evaluate(([x0, y0, x1, y1]) => {
        const v = window.__nb.viewer;
        v.zoomToRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 1.05);
      }, [x0, y0, x1, y1]);
      await page.waitForTimeout(900);
    },
    /**
     * Draws numbered boxes around elements. `targets` is a list of locators, selectors or
     * {x, y, width, height} rectangles; numbers are shown unless `numbers` is false.
     */
    async mark(targets, { numbers = true, pad = 3, start = 1, at = 'tl' } = {}) {
      // A target is a locator, selector or rectangle, or { t, at } to put its number elsewhere:
      // 'tl' (default), 'tr', 'bl', 'br', 'l' or 'r' (outside the box, at its middle).
      const items = [];
      for (const t of [].concat(targets)) {
        const spec = t && typeof t === 'object' && 't' in t ? t : { t };
        items.push({ r: await rectOf(page, spec.t), at: spec.at || at });
      }
      await page.evaluate(
        ({ items, numbers, pad, start }) => {
          const W = innerWidth;
          const H = innerHeight;
          items.forEach(({ r, at }, i) => {
            if (!r) return;
            const box = document.createElement('div');
            box.className = 'help-mark';
            Object.assign(box.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
            document.body.appendChild(box);
            if (!numbers) return;
            const b = document.createElement('div');
            b.className = 'help-badge';
            b.textContent = String(start + i);
            const x0 = r.x - pad;
            const y0 = r.y - pad;
            const x1 = r.x + r.width + pad;
            const y1 = r.y + r.height + pad;
            let left = at.includes('r') ? x1 - 10 : x0 - 14;
            let top = at.includes('b') ? y1 - 10 : y0 - 14;
            if (at === 'l') [left, top] = [x0 - 30, (y0 + y1) / 2 - 12];
            if (at === 'r') [left, top] = [x1 + 6, (y0 + y1) / 2 - 12];
            // Kept on screen: a box at the window's edge gets its number just inside.
            left = Math.min(Math.max(2, left), W - 28);
            top = Math.min(Math.max(2, top), H - 26);
            Object.assign(b.style, { left: `${left}px`, top: `${top}px` });
            document.body.appendChild(b);
          });
        },
        { items, numbers, pad, start },
      );
    },
    /** Sample plan coordinates in feet from the sheet's bottom-left, as page points (sheet 1 and 2). */
    plan(x, y) {
      return [x * 18, 1296 - y * 18];
    },
    /** Adds a cloud, a text box and a rectangle to sheet 1, then goes back to Select. */
    async sampleMarkups() {
      const P = h.plan;
      await h.tool('cloud');
      await h.drag(P(41, 40), P(61, 26));
      await h.tool('text');
      await h.drag(P(66, 36), P(84, 32));
      await h.typeText('CHECK KITCHEN LAYOUT WITH CLIENT');
      await h.tool('rect');
      await h.drag(P(9, 47), P(21, 31));
      await h.tool('select');
      await page.keyboard.press('Escape');
      await h.wait(400);
    },
    /** Types into the open text editor and commits it (Ctrl+Enter). */
    async typeText(text) {
      await page.waitForSelector('textarea.text-editor');
      await page.keyboard.type(text);
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(250);
    },
    async unmark() {
      await page.evaluate(() => document.querySelectorAll('.help-mark,.help-badge,.help-cursor').forEach((e) => e.remove()));
    },
    /**
     * Saves a screenshot as img/<name>.png. `around` crops to the union of locators/rects plus
     * `pad`; without it the whole window is saved. Marks are removed afterwards.
     */
    async shot(name, { around, pad = 24, keepMarks = false, minWidth = 0, minHeight = 0 } = {}) {
      await page.waitForTimeout(250);
      let clip;
      if (around) {
        const rs = [];
        for (const t of [].concat(around)) {
          const r = await rectOf(page, t);
          if (r) rs.push(r);
        }
        if (rs.length) {
          const vp = page.viewportSize();
          let x0 = Math.min(...rs.map((r) => r.x)) - pad;
          let y0 = Math.min(...rs.map((r) => r.y)) - pad;
          let x1 = Math.max(...rs.map((r) => r.x + r.width)) + pad;
          let y1 = Math.max(...rs.map((r) => r.y + r.height)) + pad;
          if (x1 - x0 < minWidth) {
            const c = (x0 + x1) / 2;
            x0 = c - minWidth / 2;
            x1 = c + minWidth / 2;
          }
          if (y1 - y0 < minHeight) {
            const c = (y0 + y1) / 2;
            y0 = c - minHeight / 2;
            y1 = c + minHeight / 2;
          }
          x0 = Math.max(0, x0);
          y0 = Math.max(0, y0);
          x1 = Math.min(vp.width, x1);
          y1 = Math.min(vp.height, y1);
          clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        }
      }
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
      if (!keepMarks) await h.unmark();
      console.log('  shot', name);
    },
  };
  return h;
}

async function rectOf(page, t) {
  if (!t) return null;
  if (typeof t === 'object' && 'x' in t && 'width' in t) return t;
  // A selector stands for every visible element it matches (a menu and its open submenus).
  if (typeof t === 'string') {
    const boxes = [];
    for (const el of await page.locator(t).all()) {
      const b = await el.boundingBox().catch(() => null);
      if (b && b.width && b.height) boxes.push(b);
    }
    if (!boxes.length) {
      console.warn('  no box for', t);
      return null;
    }
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.width));
    const y1 = Math.max(...boxes.map((b) => b.y + b.height));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  const loc = t.first ? t.first() : t;
  try {
    return await loc.boundingBox({ timeout: 2000 });
  } catch {
    console.warn('  no box for', String(t));
    return null;
  }
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { launch, sample, OUT, ROOT };
