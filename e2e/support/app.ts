// The `app` fixture: a fresh redcolumn (a Chromium page on the dev server, or the Electron app with
// its own profile folder) plus the driver in driver.ts. Specs use it the same way in both projects.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, _electron as electron, type Page } from '@playwright/test';
import { driver, type Driver } from './driver.ts';

const ROOT = resolve(import.meta.dirname, '../..');

export interface App extends Driver {
  /** 'web' or 'desktop'. */
  readonly kind: 'web' | 'desktop';
  /** Uncaught page errors and console errors since launch. */
  readonly errors: string[];
}

/** Imperial feet unless a spec asks otherwise (test.use({ settings: ... })). */
const IMPERIAL = { unitSystem: 'imperial', lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft' };

/** Same first-run state everywhere: a fixed author and known settings (apps/web/src/settings/settings.ts). */
function seed(settings: Record<string, unknown>) {
  try {
    // Once per tab, so a setting a test changes survives a reload.
    if (sessionStorage.getItem('e2e.seeded')) return;
    sessionStorage.setItem('e2e.seeded', '1');
    localStorage.setItem('nb.author', 'E2E Tester');
    localStorage.setItem('nb.settings', JSON.stringify(settings));
  } catch {}
}

function collectErrors(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('dialog', (d) => void d.accept().catch(() => {}));
}

export const test = base.extend<{ app: App; settings: Record<string, unknown> }>({
  settings: [IMPERIAL, { option: true }],
  // `page` is only used by the web project (the desktop project's is left blank).
  app: async ({ page, settings }, use, testInfo) => {
    const errors: string[] = [];
    if (testInfo.project.name === 'desktop') {
      const profile = mkdtempSync(join(tmpdir(), 'rc-e2e-'));
      const electronApp = await electron.launch({
        cwd: join(ROOT, 'apps/desktop'),
        args: ['.', `--user-data-dir=${profile}`],
        // APPDATA too: the assistant's endpoint file lives there (apps/desktop/src/assistant/endpoint.ts),
        // outside the profile, and must not touch the real app's or another test's.
        env: { ...process.env, RECOLUMN_E2E: '1', ELECTRON_DEV: '', APPDATA: profile, XDG_CONFIG_HOME: profile },
      });
      try {
        const win = await electronApp.firstWindow();
        collectErrors(win, errors);
        await win.waitForSelector('.menubar', { timeout: 30_000 });
        await win.evaluate(seed, settings);
        await win.reload();
        await win.waitForSelector('.menubar', { timeout: 30_000 });
        await win.waitForFunction(() => !!window.__nb?.commands);
        await use({ kind: 'desktop', errors, ...driver(win) });
      } finally {
        // app.exit skips the close handlers, so an unsaved document's "Save changes?" prompt
        // never opens and holds the window (close() would wait on it forever).
        const proc = electronApp.process();
        const exited = proc.exitCode !== null ? Promise.resolve() : new Promise<void>((done) => proc.once('exit', () => done()));
        await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
        await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
        if (proc.exitCode === null) proc.kill();
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
      return;
    }
    await page.addInitScript(seed, settings);
    collectErrors(page, errors);
    await page.goto('/');
    await page.waitForSelector('.menubar');
    await page.waitForFunction(() => !!window.__nb?.commands);
    await use({ kind: 'web', errors, ...driver(page) });
  },
});

export { expect };
