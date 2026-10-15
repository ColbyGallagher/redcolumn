import { defineConfig } from '@playwright/test';

/** Its own port, so a dev server from another checkout (on 5173) is never tested by mistake. */
const PORT = Number(process.env.E2E_PORT ?? 5179);
const URL = `http://127.0.0.1:${PORT}/`;

/**
 * End-to-end tests. The same specs run twice:
 *  - web: Chromium against the Vite dev server (its test hook is on in development);
 *  - desktop: the Electron app, unpackaged, on a VITE_E2E build (support/build-desktop.mjs).
 * Run from the repository root with `pnpm e2e` (both), `pnpm e2e:web` or `pnpm e2e:desktop`.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL: URL,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'web', use: { browserName: 'chromium' } },
    // One Electron app per test, each with its own profile folder; fewer workers keep the machine responsive.
    { name: 'desktop', workers: 2 },
  ],
  webServer: {
    // E2E_REUSE=1 keeps a dev server you already started on the port (faster reruns).
    command: `pnpm --filter @nb/web dev --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 120_000,
    cwd: '..',
  },
});
