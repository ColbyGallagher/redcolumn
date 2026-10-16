// The `app` fixture: a fresh redcolumn (a Chromium page on the dev server, or the Electron app with
// its own profile folder) plus the driver in driver.ts. Specs use it the same way in both projects.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { test as base, expect, _electron as electron, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { driver, type Driver } from './driver.ts';

const ROOT = resolve(import.meta.dirname, '../..');

export interface App extends Driver {
  /** 'web' or 'desktop'. */
  readonly kind: 'web' | 'desktop';
  /** Uncaught page errors and console errors since launch. */
  readonly errors: string[];
  /** Files the app has saved (Save As, Extract, Split...), oldest first. */
  saved(): Promise<Saved[]>;
  /** Print jobs the app has sent, oldest first, with their page counts. Nothing reaches a printer. */
  printed(): Promise<{ pages: number }[]>;
}

const pdfPageCount = async (b64: string) => (await PDFDocument.load(Buffer.from(b64, 'base64'), { ignoreEncryption: true })).getPageCount();
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** A file the app saved: where a person would have picked a place for it, the test takes it. */
export interface Saved {
  name: string;
  bytes: Buffer;
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

/**
 * Stands in for the browser's Save As picker (File System Access API): every file the app writes is
 * kept in window.__e2eSaved instead of opening a dialog the test cannot answer.
 */
function stubSavePicker() {
  const saved: { name: string; b64: string }[] = [];
  Object.assign(window, { __e2eSaved: saved });
  Object.assign(window, {
    showSaveFilePicker: async (opts?: { suggestedName?: string }) => {
      const name = opts?.suggestedName ?? 'untitled';
      const parts: BlobPart[] = [];
      const writable = {
        write: async (data: BlobPart) => void parts.push(data),
        close: async () => {
          const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          saved.push({ name, b64: btoa(bin) });
        },
      };
      return { kind: 'file', name, createWritable: async () => writable, getFile: async () => new File(parts, name) };
    },
  });
}

/**
 * Stands in for printing in the browser: the hidden frame printInFrame (apps/web/src/documents/printPdf.ts)
 * adds to print a PDF is kept in window.__e2ePrinted and never added, so no print dialog opens.
 */
function stubPrintFrame() {
  const printed: string[] = [];
  Object.assign(window, { __e2ePrinted: printed });
  const append = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    if (node instanceof HTMLIFrameElement && node.src.startsWith('blob:') && node.style.visibility === 'hidden') {
      void fetch(node.src)
        .then((r) => r.arrayBuffer())
        .then((b) => {
          const bytes = new Uint8Array(b);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          printed.push(btoa(bin));
        });
      return node;
    }
    return append.call(this, node) as T;
  };
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
        // Save dialogs answer themselves: each file goes into `saves`, under the name the app suggested.
        const saves = join(profile, 'saved');
        mkdirSync(saves);
        await electronApp.evaluate(({ dialog }, dir) => {
          let n = 0;
          dialog.showSaveDialog = (async (...args: unknown[]) => {
            const opts = args[args.length - 1] as { defaultPath?: string };
            // A numbered folder each, so two saves under one name are both kept.
            const name = String(opts.defaultPath ?? 'untitled').split(/[\\/]/).pop();
            const sub = `${dir}/${String(++n).padStart(3, '0')}`;
            process.getBuiltinModule('node:fs').mkdirSync(sub);
            return { canceled: false, filePath: `${sub}/${name}` };
          }) as typeof dialog.showSaveDialog;
        }, saves);
        const saved = async () =>
          readdirSync(saves)
            .sort()
            .flatMap((sub) => readdirSync(join(saves, sub)).map((name) => join(saves, sub, name)))
            .filter((f) => statSync(f).size > 0)
            .map((f) => ({ name: basename(f), bytes: readFileSync(f) }));
        const win = await electronApp.firstWindow();
        // Printing answers itself too: the print channels (apps/desktop/src/main.ts) would send the
        // PDF to the system's printer or open a print dialog. Each job is kept with its page count.
        await electronApp.evaluate(({ ipcMain }) => {
          const jobs: { pdf?: Uint8Array; pages: number; done: boolean }[] = [];
          const pending = new Map<string, { pages: number; done: boolean }>();
          Object.assign(globalThis, { __e2ePrinted: jobs });
          for (const c of ['print:pdf', 'print:begin', 'print:page', 'print:finish', 'print:cancel']) ipcMain.removeHandler(c);
          ipcMain.handle('print:pdf', (_e, bytes: Uint8Array) => void jobs.push({ pdf: bytes, pages: 0, done: true }));
          ipcMain.handle('print:begin', () => {
            const id = `e2e-${pending.size + 1}`;
            const job = { pages: 0, done: false };
            pending.set(id, job);
            jobs.push(job);
            return id;
          });
          ipcMain.handle('print:page', (_e, id: string) => void (pending.get(id)!.pages += 1));
          ipcMain.handle('print:finish', (_e, id: string) => void (pending.get(id)!.done = true));
          ipcMain.handle('print:cancel', (_e, id: string) => void jobs.splice(jobs.indexOf(pending.get(id)!), 1));
        });
        const printed = async () => {
          const jobs = await electronApp.evaluate(() => (globalThis as unknown as { __e2ePrinted: { pdf?: Uint8Array; pages: number; done: boolean }[] }).__e2ePrinted.filter((j) => j.done).map((j) => ({ pdf: j.pdf ? Array.from(j.pdf) : null, pages: j.pages })));
          return Promise.all(jobs.map(async (j) => ({ pages: j.pdf ? await pdfPageCount(toBase64(Uint8Array.from(j.pdf))) : j.pages })));
        };
        collectErrors(win, errors);
        await win.waitForSelector('.menubar', { timeout: 30_000 });
        await win.evaluate(seed, settings);
        await win.reload();
        await win.waitForSelector('.menubar', { timeout: 30_000 });
        await win.waitForFunction(() => !!window.__nb?.commands);
        await use({ kind: 'desktop', errors, saved, printed, ...driver(win) });
      } finally {
        // app.exit skips the close handlers, so an unsaved document's "Save changes?" prompt
        // never opens and holds the window (close() would wait on it forever).
        const proc = electronApp.process();
        const exited = proc.exitCode !== null ? Promise.resolve() : new Promise<void>((done) => proc.once('exit', () => done()));
        await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
        await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
        if (proc.exitCode === null) proc.kill();
        // Windows can hold the profile's files a few seconds after the app has gone (its helper
        // processes exit last). A temp folder left behind must not fail the test.
        try {
          rmSync(profile, { recursive: true, force: true, maxRetries: 25, retryDelay: 400 });
        } catch (err) {
          console.warn(`Could not remove ${profile}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return;
    }
    // Select Text and Copy write to the clipboard; the tests read it back.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(seed, settings);
    await page.addInitScript(stubSavePicker);
    await page.addInitScript(stubPrintFrame);
    collectErrors(page, errors);
    await page.goto('/');
    await page.waitForSelector('.menubar');
    await page.waitForFunction(() => !!window.__nb?.commands);
    const saved = async () =>
      (await page.evaluate(() => (window as unknown as { __e2eSaved: { name: string; b64: string }[] }).__e2eSaved)).map((f) => ({ name: f.name, bytes: Buffer.from(f.b64, 'base64') }));
    const printed = async () => Promise.all((await page.evaluate(() => (window as unknown as { __e2ePrinted: string[] }).__e2ePrinted)).map(async (b64) => ({ pages: await pdfPageCount(b64) })));
    await use({ kind: 'web', errors, saved, printed, ...driver(page) });
  },
});

export { expect };
