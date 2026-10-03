// Touch and pen on the drawing: pinch zoom, two-finger pan, long press for the menu, a pinch that
// starts while drawing, and palm rejection. Runs against the dev server (it needs window.__nb):
//   pnpm --filter @nb/web dev &
//   PDF=some.pdf NODE_PATH=$(npm root -g) node apps/web/test/browser/touch.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const URL = process.env.URL || 'http://localhost:5173/';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(process.env.PDF);
  await page.waitForFunction(() => window.__nb?.tools?.store);
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const box = await page.locator('main.stage canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const zoom = () => page.evaluate(() => window.__nb.viewer.zoomFor(window.__nb.viewer.currentPageIndex));
  const pageAt = (x, y) => page.evaluate(([x, y]) => window.__nb.viewer.clientToPage(x, y, window.__nb.viewer.currentPageIndex), [x, y]);
  const count = () => page.evaluate(() => window.__nb.tools.store.all().length);
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push(`ok   ${name}`);
    } catch (err) {
      results.push(`FAIL ${name}: ${err.message}`);
    }
  };

  await check('two fingers spreading zoom in about their midpoint', async () => {
    const z0 = await zoom();
    const under = await pageAt(cx, cy);
    await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 40 - i * 5, cy], [cx + 40 + i * 5, cy]]);
    await touch('touchEnd', []);
    const z1 = await zoom();
    assert.ok(Math.abs(z1 / z0 - 2) < 0.05, `zoom ${z0} → ${z1}, expected ×2`);
    const after = await pageAt(cx, cy);
    assert.ok(Math.hypot(after[0] - under[0], after[1] - under[1]) < 2, `page point moved from ${under} to ${after}`);
  });

  await check('two fingers moving together pan', async () => {
    const z0 = await zoom();
    const before = await pageAt(cx, cy);
    await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 40 + i * 10, cy + i * 5], [cx + 40 + i * 10, cy + i * 5]]);
    await touch('touchEnd', []);
    assert.ok(Math.abs((await zoom()) - z0) < 1e-6, 'zoom unchanged');
    const after = await pageAt(cx + 60, cy + 30);
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 2, 'the page followed the fingers');
  });

  await check('a finger draws with a markup tool', async () => {
    await page.evaluate(() => window.__nb.tools.setTool('rect'));
    const n = await count();
    await touch('touchStart', [[cx - 50, cy - 50]]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[cx - 50 + i * 20, cy - 50 + i * 20]]);
    await touch('touchEnd', []);
    assert.equal(await count(), n + 1);
  });

  await check('a second finger turns a drawing press into a pinch, drawing nothing', async () => {
    const n = await count();
    const z0 = await zoom();
    await touch('touchStart', [[cx - 30, cy]]);
    await touch('touchMove', [[cx - 34, cy]]);
    await touch('touchStart', [[cx - 34, cy], [cx + 30, cy]]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[cx - 34 + i * 4, cy], [cx + 30 - i * 4, cy]]);
    await touch('touchEnd', []);
    assert.equal(await count(), n, 'no markup');
    assert.ok((await zoom()) < z0, 'zoomed out');
  });

  await check('a long press opens the context menu', async () => {
    await page.evaluate(() => window.__nb.tools.setTool('select'));
    await touch('touchStart', [[cx, cy + 80]]);
    await page.waitForTimeout(700);
    const during = await page.locator('.ctx-root').count();
    if (process.env.DEBUG) await page.evaluate(() => { window.__ev = []; for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'contextmenu', 'click', 'mousedown', 'mouseup', 'resize', 'blur', 'wheel', 'keydown', 'touchend']) window.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.target?.className ?? '')), true); });
    await touch('touchEnd', []);
    await page.waitForTimeout(100);
    if (process.env.DEBUG) console.log(await page.evaluate(() => window.__ev));
    assert.equal(during, 1, 'one menu while pressed');
    assert.equal(await page.locator('.ctx-root').count(), 1, 'still open after lifting');
    await page.keyboard.press('Escape');
  });

  await check('after a pen is used, a finger pans instead of drawing, and touches with the pen down are ignored', async () => {
    await page.evaluate(() => window.__nb.tools.setTool('rect'));
    const n = await count();
    const pen = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'pen' });
    await pen('mousePressed', cx - 60, cy + 40, 1);
    await pen('mouseMoved', cx - 20, cy + 80, 1);
    // A palm lands while the pen is down.
    await touch('touchStart', [[cx + 100, cy + 150]]);
    await touch('touchMove', [[cx + 140, cy + 190]]);
    await touch('touchEnd', []);
    await pen('mouseMoved', cx + 20, cy + 120, 1);
    await pen('mouseReleased', cx + 20, cy + 120, 0);
    assert.equal(await count(), n + 1, 'the pen drew one markup, the palm none');
    await page.waitForTimeout(400);
    const before = await pageAt(cx, cy);
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[cx + i * 10, cy]]);
    await touch('touchEnd', []);
    assert.equal(await count(), n + 1, 'the finger drew nothing');
    const after = await pageAt(cx + 50, cy);
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 2, 'the finger panned');
  });

  console.log(results.join('\n'));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
})();
