import { chromium, type FullConfig } from '@playwright/test';
import { join } from 'node:path';

/**
 * Global setup: loads the dev server once and opens plan.pdf before any test starts.
 *
 * On a cold start Vite pre-bundles dependencies as the first page asks for them, and reloads that
 * page when it finds more. On a fresh CI machine that took longer than a test's 30 s wait for its
 * first document ("plan did not open"), so the first tests of every worker failed. Doing it here,
 * once, leaves the tests a warm server. The desktop project loads a build, not the dev server, but
 * the server is started for every run, so warming it costs the desktop run only these seconds.
 */
export default async function warmUp(config: FullConfig) {
  const url = config.webServer?.url;
  if (!url) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Two rounds: the first may be cut short by a dependency reload.
    for (let round = 0; round < 2; round++) {
      await page.goto(url);
      await page.waitForFunction(() => !!window.__nb?.commands, null, { timeout: 180_000 });
      await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(join(import.meta.dirname, '..', 'fixtures', 'plan.pdf'));
      const opened = await page
        .waitForFunction(
          async () => {
            const r = (await window.__nb.assistant('list_open_documents', {})) as { documents: { pageCount: number }[] };
            return r.documents.some((d) => d.pageCount > 0);
          },
          null,
          { timeout: 180_000, polling: 500 },
        )
        .then(() => true)
        .catch(() => false);
      if (opened) break;
    }
    // The 3D viewer's libraries load only when a model opens: open one too, so their bundling (and
    // the reload it can cause) happens here rather than in a model test.
    await page
      .locator('input[type=file][accept*="ifc"]')
      .first()
      .setInputFiles(join(import.meta.dirname, '..', '..', 'docs', 'demo-sets', 'kestrel-road-revA.ifc'));
    await page.locator('.model-view[data-state="ready"]').waitFor({ timeout: 180_000 }).catch(() => {});
  } finally {
    await browser.close();
  }
}
