// The Content-Security-Policy (vite.config.ts) leaves the app working: the built pages carry it,
// and loading the app, opening a PDF, every menu, OCR, spell check and the help pages report no
// policy violations. Runs against the production build:
//   pnpm --filter @nb/web build && pnpm --filter @nb/web preview &
//   PDF=some.pdf NODE_PATH=$(npm root -g) node apps/web/test/browser/csp.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const URL = process.env.URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Violations in pages and in the workers they start, reported back to the page.
  await ctx.addInitScript(() => {
    window.__csp = [];
    addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`), true);
  });
  const violations = [];
  ctx.on('console', (m) => /Content Security Policy/i.test(m.text()) && violations.push(m.text()));
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
  const pageViolations = async (p = page) => p.evaluate(() => window.__csp ?? []);

  await page.goto(URL);
  await page.waitForSelector('.menubar');

  await check('the app and the sign-in page carry the policy', async () => {
    assert.match(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /object-src 'none'/);
    const redirect = await (await ctx.request.get(new globalThis.URL('msal-redirect.html', URL).href)).text();
    assert.match(redirect, /http-equiv="Content-Security-Policy"[^>]*default-src (&#39;|')none/);
  });

  await check('a PDF opens', async () => {
    await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(process.env.PDF);
    await page.waitForSelector('.doc-tab.active', { timeout: 20000 });
    await page.waitForTimeout(2000);
  });

  await check('every menu opens', async () => {
    const titles = await page.locator('.menubar .menu-title').allInnerTexts();
    for (const t of titles) {
      await page.locator('.menubar .menu-title', { hasText: new RegExp(`^${t}$`) }).click();
      await page.waitForSelector('.menu-drop');
      await page.keyboard.press('Escape');
    }
  });

  await check('OCR runs (WebAssembly and its blob worker)', async () => {
    await page.keyboard.press('Control+Shift+O');
    await page.locator('.print-dialog .btn.primary').click();
    // Done when no job is left running.
    await page.waitForFunction(() => !document.querySelector('.jobs-bar .job'), null, { timeout: 120000 });
    await page.waitForTimeout(1000);
  });

  await check('the spelling dictionary loads', async () => {
    const status = await page.evaluate(async () => [(await fetch('spell/en.aff')).status, (await fetch('spell/en.dic')).status]);
    assert.deepEqual(status, [200, 200]);
  });

  await check('the help pages load and render', async () => {
    const help = await ctx.newPage();
    await help.goto(new globalThis.URL('help/index.html', URL).href);
    await help.waitForSelector('#content h1', { timeout: 10000 });
    assert.match(await help.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /script-src 'self'/);
    violations.push(...(await pageViolations(help)));
    await help.close();
  });

  violations.push(...(await pageViolations()));
  results.push(violations.length ? `FAIL no policy violations: ${[...new Set(violations)].join(' | ')}` : 'ok   no policy violations');
  console.log(results.join('\n'));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
})();
