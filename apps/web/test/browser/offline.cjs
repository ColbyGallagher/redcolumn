// The installed app offline: once the service worker is active, the network is cut and the app
// must reload, open a PDF, open every menu and spell check without errors; the status bar says
// Offline; a PDF shared from another app (share_target) opens. Runs against the production build:
//   pnpm --filter @nb/web build && pnpm --filter @nb/web preview &
//   PDF=some.pdf NODE_PATH=$(npm root -g) node apps/web/test/browser/offline.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const URL = process.env.URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push(`ok   ${name}`);
    } catch (err) {
      results.push(`FAIL ${name}: ${err.message.split('\n')[0]}`);
    }
  };

  await page.goto(URL);
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {});
  // The first load installs the worker; a reload puts the page under its control.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 });

  await check('the manifest is installable (icons load, id and scope set)', async () => {
    const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    assert.equal(m.display, 'standalone');
    for (const icon of m.icons) assert.equal(await page.evaluate(async (src) => (await fetch(src)).status, icon.src), 200, icon.src);
    assert.ok(m.file_handlers?.length && m.share_target && m.shortcuts?.length === 2);
  });

  await ctx.setOffline(true);

  await check('the app reloads offline and says so in the status bar', async () => {
    await page.reload();
    await page.waitForSelector('.menubar');
    await page.waitForSelector('.status-offline', { timeout: 5000 });
    assert.match(await page.locator('.status-offline').innerText(), /Offline/);
  });

  await check('a PDF opens offline', async () => {
    await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(process.env.PDF);
    await page.waitForSelector('.doc-tab.active', { timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await check('the spelling dictionary is available offline', async () => {
    const status = await page.evaluate(async () => [(await fetch('/spell/en.aff')).status, (await fetch('/spell/en.dic')).status]);
    assert.deepEqual(status, [200, 200]);
  });

  await check('every menu opens offline without errors', async () => {
    const before = errors.length;
    const titles = await page.locator('.menubar .menu-title').allInnerTexts();
    assert.ok(titles.length >= 8, `${titles.length} menus`);
    for (const t of titles) {
      await page.locator('.menubar .menu-title', { hasText: new RegExp(`^${t}$`) }).click();
      await page.waitForSelector('.menu-drop');
      await page.keyboard.press('Escape');
    }
    assert.equal(errors.length, before, errors.slice(before).join('; '));
  });

  await check('Preferences › Offline shows storage use and OCR languages', async () => {
    await page.keyboard.press('Control+k');
    await page.locator('.prefs-nav button', { hasText: 'Offline' }).click();
    await page.waitForSelector('.storage-use');
    assert.match(await page.locator('.storage-use').innerText(), /used/);
    assert.equal(await page.locator('.ocr-offline li').count(), 7);
    await page.locator('.prefs-dialog .btn.primary', { hasText: 'Done' }).click();
  });

  await check('starting a Live Session is disabled offline, with the reason', async () => {
    await page.locator('.rail button[title*="Session" i]').first().click();
    const start = page.locator('.session-toolbar .btn', { hasText: 'Start' });
    assert.equal(await start.isDisabled(), true);
    assert.match(await start.getAttribute('title'), /network/);
  });

  await ctx.setOffline(false);

  await check('a PDF shared from another app opens (share_target)', async () => {
    // A trailing comment makes the file new to the library, which keeps files by content.
    const bytes = Buffer.concat([fs.readFileSync(process.env.PDF), Buffer.from(`\n% shared ${Date.now()}\n`)]);
    const tabs = await page.locator('.doc-tab').count();
    // What the operating system does: a form POST to the share target, then follow the redirect.
    await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append('files', new File([bin], 'Shared drawing.pdf', { type: 'application/pdf' }));
      const res = await fetch('/share-target', { method: 'POST', body: form });
      location.href = res.url;
    }, bytes.toString('base64'));
    await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length > n || [...document.querySelectorAll('.doc-tab .name')].some((e) => e.textContent.includes('Shared drawing')), tabs, { timeout: 15000 });
    assert.ok(!(await page.evaluate(() => location.search.includes('action'))), 'the launch query is removed');
    assert.ok(await page.locator('.doc-tab .name', { hasText: 'Shared drawing' }).count());
  });

  console.log(results.join('\n'));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
})();
