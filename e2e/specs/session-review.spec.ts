import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { driver } from '../support/driver';

const ROOT = resolve(import.meta.dirname, '../..');

// Two real desktop processes and independent profiles. This checks the app workflow,
// not transport through OneDrive, a network share, or a guest organisation's policies.
test('review recovers pending activity after termination and archives safely before removal', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Folder Sessions need the desktop app.');
  test.setTimeout(240_000);
  const temp = mkdtempSync(join(tmpdir(), 'redcolumn-review-'));
  const shared = join(temp, 'shared');
  mkdirSync(shared);
  const exports = join(temp, 'exports');
  mkdirSync(exports);
  const apps = new Map<ElectronApplication, ChildProcess>();
  const launch = async (name: string) => {
    const profile = join(temp, name);
    mkdirSync(profile, { recursive: true });
    const app = await electron.launch({
      cwd: join(ROOT, 'apps/desktop'),
      args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, RECOLUMN_E2E: '1', ELECTRON_DEV: '', APPDATA: profile, XDG_CONFIG_HOME: profile },
    });
    apps.set(app, app.process());
    const page = await app.firstWindow();
    page.on('dialog', (dialog) => void dialog.accept());
    await page.waitForFunction(() => !!window.__nb?.commands);
    await page.evaluate((name) => localStorage.setItem('nb.author', name), name);
    await page.reload();
    await page.waitForFunction(() => !!window.__nb?.commands);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setBackgroundThrottling(false));
    return { app, page, d: driver(page) };
  };
  const pickFolder = async (app: ElectronApplication, folder: string) => {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
    }, folder);
  };
  const stop = async (app: ElectronApplication) => {
    const proc = apps.get(app)!;
    const exited = proc.exitCode !== null ? Promise.resolve() : new Promise<void>((done) => proc.once('exit', () => done()));
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
    if (proc.exitCode === null) proc.kill();
    apps.delete(app);
  };
  try {
    const host = await launch('Host');
    await host.d.open('plan.pdf');
    await host.d.cmd('window.sessions');
    await host.page.getByRole('button', { name: 'New session', exact: true }).click();
    await host.page.getByRole('menuitem', { name: 'Start session', exact: true }).click();
    await host.page.getByLabel('Session name', { exact: true }).fill('Consultant review');
    await pickFolder(host.app, shared);
    await host.page.getByRole('button', { name: 'Choose folder and start', exact: true }).click();
    await expect(host.page.locator('.rc-doc-main')).toHaveText('plan.pdf');
    await expect.poll(() => readdirSync(shared, { withFileTypes: true }).filter((f) => f.isDirectory()).length).toBe(1);
    const folder = join(shared, readdirSync(shared, { withFileTypes: true }).find((f) => f.isDirectory())!.name);
    const guest = await launch('Consultant');
    await guest.d.cmd('window.sessions');
    await guest.page.getByRole('button', { name: 'New session', exact: true }).click();
    await guest.page.getByRole('menuitem', { name: 'Join session…', exact: true }).click();
    await pickFolder(guest.app, folder);
    await guest.page.getByRole('button', { name: 'Open the session folder on this computer…', exact: true }).click();
    await expect(guest.page.locator('.rc-doc-main')).toHaveText('plan.pdf');
    await host.page.locator('.rc-doc-main').click();
    await guest.page.locator('.rc-doc-main').click();
    for (const client of [host, guest]) {
      await expect.poll(async () => (await client.d.documents()).some((d) => d.active && d.id.startsWith('studio:'))).toBe(true);
      await client.d.fit();
    }
    await host.d.tool('rect');
    await host.d.drag([300, 450], [350, 500]);
    await expect.poll(async () => (await guest.d.raw()).length, { timeout: 20_000 }).toBe(1);
    await guest.d.tool('rect');
    await guest.d.drag([400, 450], [450, 500]);
    await expect.poll(async () => (await host.d.raw()).length, { timeout: 20_000 }).toBe(2);
    expect((await host.d.raw()).map((m) => m.author).sort()).toEqual(['Consultant', 'Host']);
    await guest.page.getByRole('textbox', { name: 'Chat', exact: true }).fill('Please check this clearance.');
    await guest.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(host.page.locator('.rc-log li').filter({ hasText: 'Please check this clearance.' })).toBeVisible({ timeout: 20_000 });
    // Fail the storage writes, while leaving local IndexedDB available. app.exit below
    // bypasses renderer close handlers: recovery must come from the durable journal.
    await guest.app.evaluate(({ ipcMain }) => {
      for (const channel of ['folder:create-file', 'folder:update']) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => { throw new Error('Simulated unavailable shared storage'); });
      }
    });
    await guest.d.tool('rect');
    await guest.d.drag([500, 450], [550, 500]);
    await guest.page.getByRole('textbox', { name: 'Chat', exact: true }).fill('Recover this unsent question.');
    await guest.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(guest.page.getByRole('status', { name: 'Session sync status' })).toContainText(/Saved on this device.*waiting to sync/);
    expect(await host.d.raw()).toHaveLength(2);
    await guest.app.evaluate(({ session }) => session.defaultSession.flushStorageData());
    await stop(guest.app);
    const returned = await launch('Consultant');
    await returned.d.cmd('window.sessions');
    await expect(returned.page.locator('.rc-doc-main')).toHaveText('plan.pdf', { timeout: 20_000 });
    await returned.page.locator('.rc-doc-main').click();
    await expect.poll(async () => (await returned.d.documents()).some((d) => d.active && d.id.startsWith('studio:'))).toBe(true);
    await expect.poll(async () => (await returned.d.raw()).length, { timeout: 20_000 }).toBe(3);
    await expect.poll(async () => (await host.d.raw()).length, { timeout: 20_000 }).toBe(3);
    await expect(host.page.locator('.rc-log li').filter({ hasText: 'Recover this unsent question.' })).toHaveCount(1, { timeout: 20_000 });
    await expect(returned.page.getByRole('status', { name: 'Session sync status' })).toContainText('No pending changes', { timeout: 20_000 });
    await expect(returned.page.locator('.rc-log li').filter({ hasText: 'Please check this clearance.' })).toBeVisible();
    await host.app.evaluate(({ session, dialog }, dir) => {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const opts = args[args.length - 1] as { defaultPath?: string };
        return { canceled: false, filePath: process.getBuiltinModule('node:path').join(dir, process.getBuiltinModule('node:path').basename(opts.defaultPath ?? 'record.csv')) };
      }) as typeof dialog.showSaveDialog;
      session.defaultSession.on('will-download', (_event, item) => {
        item.setSavePath(process.getBuiltinModule('node:path').join(dir, process.getBuiltinModule('node:path').basename(item.getFilename())));
      });
    }, exports);
    await host.page.getByRole('button', { name: 'Session commands', exact: true }).click();
    await host.page.getByRole('menuitem', { name: 'Record as CSV', exact: true }).click();
    await expect.poll(() => readdirSync(exports).filter((name) => name.endsWith('.csv')).length).toBe(1);
    const record = readFileSync(join(exports, readdirSync(exports).find((name) => name.endsWith('.csv'))!), 'utf8');
    expect(record).toContain('Please check this clearance.');
    expect(record).toContain('Consultant');
    expect(record).toContain('Host');
    expect(record).toContain('Recover this unsent question.');
    await returned.page.screenshot({ path: testInfo.outputPath('consultant-rejoined.png') });
    // Exercise the native file-save fallback, whose old fire-and-forget downloads
    // could delete the Session while its save dialog was still open.
    await host.page.evaluate(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
    await host.page.getByRole('button', { name: 'Session commands', exact: true }).click();
    await host.page.getByRole('menuitem', { name: 'End session…', exact: true }).click();
    const ending = host.page.getByRole('dialog', { name: 'End “Consultant review”', exact: true });
    await ending.getByRole('textbox', { name: 'Type the session name to confirm' }).fill('Consultant review');
    const finish = ending.getByRole('button', { name: 'Save, then end session and remove files', exact: true });
    await host.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog;
    });
    await finish.click();
    await expect(ending.locator('.session-error')).toContainText('cancelled', { timeout: 20_000 });
    expect(existsSync(folder)).toBe(true);
    await host.app.evaluate(({ dialog }, dir) => {
      let saves = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const opts = args[args.length - 1] as { defaultPath?: string };
        // The first PDF saves; the second target is a directory and cannot be written as a file.
        return { canceled: false, filePath: ++saves === 2 ? dir : process.getBuiltinModule('node:path').join(dir, process.getBuiltinModule('node:path').basename(opts.defaultPath!)) };
      }) as typeof dialog.showSaveDialog;
    }, exports);
    await finish.click();
    await expect(ending.locator('.session-error')).toContainText('The session was not ended.', { timeout: 20_000 });
    expect(existsSync(folder)).toBe(true);
    expect(readdirSync(exports).some((n) => n.endsWith('.pdf'))).toBe(true);
    await host.app.evaluate(({ dialog }, dir) => {
      let first = true;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const opts = args[args.length - 1] as { defaultPath?: string };
        if (first) {
          first = false;
          await new Promise<void>((resolve) => { (globalThis as unknown as { resumeArchiveSave: () => void }).resumeArchiveSave = resolve; });
        }
        return { canceled: false, filePath: process.getBuiltinModule('node:path').join(dir, process.getBuiltinModule('node:path').basename(opts.defaultPath!)) };
      }) as typeof dialog.showSaveDialog;
    }, exports);
    await finish.click();
    await expect.poll(() => host.app.evaluate(() => typeof (globalThis as unknown as { resumeArchiveSave?: () => void }).resumeArchiveSave)).toBe('function');
    await returned.page.getByRole('textbox', { name: 'Chat', exact: true }).fill('One more review change while saving.');
    await returned.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(host.page.locator('.rc-log li').filter({ hasText: 'One more review change while saving.' })).toHaveCount(1, { timeout: 20_000 });
    await host.app.evaluate(() => (globalThis as unknown as { resumeArchiveSave: () => void }).resumeArchiveSave());
    await expect(ending.locator('.session-error')).toContainText('review changed', { timeout: 20_000 });
    expect(existsSync(folder)).toBe(true);
    await finish.click();
    await expect(ending).not.toBeVisible({ timeout: 30_000 });
    expect(existsSync(folder)).toBe(false);
    const archive = join(exports, 'plan (Consultant review).pdf');
    expect(existsSync(archive)).toBe(true);
    const archivedRecord = readFileSync(join(exports, 'Consultant review session record.csv'), 'utf8');
    expect(archivedRecord).toContain('Recover this unsent question.');
    expect(archivedRecord).toContain('One more review change while saving.');
    await host.page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(archive);
    await expect.poll(async () => (await host.d.documents()).some((d) => d.active && d.name === 'plan (Consultant review).pdf')).toBe(true);
    await expect.poll(async () => (await host.d.raw()).length).toBe(3);
  } finally {
    for (const app of [...apps.keys()]) await stop(app);
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
