// A new version waits while work is in progress and loads once it is done. Runs against the
// production build (see offline.cjs); it changes dist/sw-share.js, which the service worker
// imports, so the browser finds a new worker, and puts it back afterwards.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.env.URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHARE = path.resolve(__dirname, '../../dist/sw-share.js');

(async () => {
  const original = fs.readFileSync(SHARE, 'utf8');
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let failed = null;
  try {
    await page.goto(URL);
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {});
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 });
    await page.evaluate(() => (window.__loadedAt = Date.now()));
    // Work in progress: Preferences is open.
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.prefs-dialog');
    fs.writeFileSync(SHARE, `${original}\n// ${Date.now()}\n`);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector('.notice', { timeout: 20000 });
    const notice = await page.locator('.notice').innerText();
    assert.match(notice, /new version.*a dialog is open/i, notice);
    await page.waitForTimeout(1500);
    assert.ok(await page.evaluate(() => !!window.__loadedAt), 'the page did not reload while the dialog was open');
    // Done: closing the dialog lets the new version load.
    const reloaded = page.waitForEvent('load', { timeout: 30000 });
    await page.locator('.prefs-dialog .btn.primary', { hasText: 'Done' }).click();
    await page.mouse.click(5, 400);
    await reloaded;
    assert.ok(await page.evaluate(() => !window.__loadedAt), 'the page reloaded into the new version');
    console.log('ok   an update waits while a dialog is open and loads when it closes');
  } catch (err) {
    failed = err;
    console.log(`FAIL an update waits while a dialog is open and loads when it closes: ${err.message.split('\n')[0]}`);
  } finally {
    fs.writeFileSync(SHARE, original);
    console.log('page errors:', errors.length ? errors : 'none');
    await browser.close();
  }
  process.exit(failed || errors.length ? 1 : 0);
})();
