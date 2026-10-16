import { DEFAULT_KEYS } from '../../apps/web/src/commands/keys.ts';
import { expect, test, type App } from '../support/app.ts';

// Every default shortcut (apps/web/src/commands/keys.ts) runs its command: the one app.cmd(id)
// runs, so it has the same effect. Keys are pressed for real; the command table is watched so the
// commands are not actually run (Ctrl+W would close the document, Ctrl+P print...).

/** A combo such as Ctrl+Shift+Plus as Playwright keys: Control+Shift+Equal. */
function keys(combo: string) {
  const parts = combo.split('+');
  // "Ctrl+Shift++" is never written: the key is named Plus.
  const key = parts.pop()!;
  const mods = parts.map((m) => ({ Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift' })[m] ?? m);
  const named: Record<string, string> = { Plus: 'Equal', Minus: 'Minus', '[': 'BracketLeft', ']': 'BracketRight', Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' };
  const name = named[key] ?? (/^[A-Z]$/.test(key) ? `Key${key}` : /^\d$/.test(key) ? `Digit${key}` : key);
  return [...mods, name].join('+');
}

/**
 * Records the commands keys run instead of running them. The table is rebuilt on every render (a
 * modifier going down can cause one), so each command's run is replaced (and the command enabled)
 * as the key goes down: a capture listener on window runs before the app's own.
 */
const watch = (app: App) =>
  app.page.evaluate(() => {
    const w = window as unknown as { __ran: string[]; __watching?: boolean };
    w.__ran = [];
    if (w.__watching) return;
    w.__watching = true;
    const patch = () => {
      for (const c of window.__nb.commands().values()) {
        c.run = () => void w.__ran.push(c.id);
        c.enabled = true;
      }
    };
    window.addEventListener('keydown', patch, true);
    window.addEventListener('paste', patch, true);
  });
const ran = (app: App) => app.page.evaluate(() => (window as unknown as { __ran?: string[] }).__ran ?? []);

const CATEGORIES = ['file', 'edit', 'view', 'document', 'tool', 'tools', 'window', 'help'];

test.describe('keyboard shortcuts', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  for (const category of CATEGORIES) {
    const entries = Object.entries(DEFAULT_KEYS).filter(([id]) => id.split('.')[0] === category);
    test(`${category}.* shortcuts run their commands`, async ({ app }) => {
      const live = new Set((await app.commands()).map((c) => c.id));
      const wrong: string[] = [];
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (const [id, combos] of entries) {
        // Install App is a web command only.
        if (!live.has(id)) {
          if (!(id === 'help.install' && app.kind === 'desktop')) wrong.push(`${id}: no such command`);
          continue;
        }
        for (const combo of combos) {
          // A picture on the clipboard is pasted as an image instead (the desktop app shares the
          // system clipboard, where another test may have left a snapshot): put text there.
          if (id === 'edit.paste') await app.page.evaluate(() => navigator.clipboard.writeText('e2e shortcut test'));
          await watch(app);
          await app.page.keyboard.press(keys(combo));
          // Paste waits for the browser's paste event first.
          await expect
            .poll(() => ran(app), { timeout: id === 'edit.paste' ? 2000 : 1000 })
            .toEqual([id])
            .catch(async () => wrong.push(`${combo} ran ${JSON.stringify(await ran(app))}, not ${id}`));
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  // The same effect, for real: tool letters pick the tool their command picks.
  test('tool shortcuts pick the same tool as their commands', async ({ app }) => {
    // Image and Attachment ask for a file first; the file chooser is answered with nothing.
    app.page.on('filechooser', (chooser) => void chooser.setFiles([]).catch(() => {}));
    const wrong: string[] = [];
    for (const [id, combos] of Object.entries(DEFAULT_KEYS).filter(([id]) => id.startsWith('tool.'))) {
      await app.cmd('tool.select');
      await app.page.keyboard.press('Escape');
      await app.cmd(id);
      const expected = (await app.toolState()).tool;
      for (const combo of combos) {
        await app.cmd('tool.select');
        await app.page.keyboard.press('Escape');
        await app.page.keyboard.press(keys(combo));
        await expect
          .poll(async () => (await app.toolState()).tool, { timeout: 1000 })
          .toBe(expected)
          .catch(async () => wrong.push(`${combo}: ${(await app.toolState()).tool}, not ${expected}`));
      }
    }
    expect(wrong).toEqual([]);
  });

  test('Ctrl+Shift+R rotates the page like document.rotatePages', async ({ app }) => {
    await app.page.keyboard.press(keys('Ctrl+Shift+R'));
    await expect.poll(async () => [(await app.pageInfo(1)).width, (await app.pageInfo(1)).height], { timeout: 20_000 }).toEqual([792, 1224]);
    await expect.poll(async () => (await app.command('document.rotatePages')).enabled).toBe(true);
    await app.cmd('document.rotatePages');
    await expect.poll(async () => [(await app.pageInfo(1)).width, (await app.pageInfo(1)).height], { timeout: 20_000 }).toEqual([1224, 792]);
  });

  test('page keys move like the page commands', async ({ app }) => {
    await app.page.keyboard.press('PageDown');
    await expect.poll(async () => (await app.view()).pageIndex).toBe(1);
    await app.page.keyboard.press('End');
    await expect.poll(async () => (await app.view()).pageIndex).toBe(2);
    await app.cmd('view.firstPage');
    await expect.poll(async () => (await app.view()).pageIndex).toBe(0);
    await app.page.keyboard.press(keys('Ctrl+Right'));
    await expect.poll(async () => (await app.view()).pageIndex).toBe(1);
  });

  test('zoom keys zoom like the zoom commands', async ({ app }) => {
    const zoom = async () => (await app.view()).zoom;
    const start = await zoom();
    await app.cmd('view.zoomIn');
    const byCommand = await zoom();
    expect(byCommand).toBeGreaterThan(start);
    await app.cmd('view.fitPage');
    await expect.poll(zoom).toBeCloseTo(start, 5);
    await app.page.keyboard.press(keys('Plus'));
    await expect.poll(zoom).toBeCloseTo(byCommand, 5);
    await app.page.keyboard.press(keys('Ctrl+9'));
    await expect.poll(zoom).toBeCloseTo(start, 5);
  });

  test('shortcuts are ignored while typing in a field', async ({ app }) => {
    await app.cmd('edit.find');
    const input = app.page.locator('.search-bar input[placeholder="Search text"]');
    await input.click();
    await app.page.keyboard.type('RM');
    await expect(input).toHaveValue('RM');
    expect((await app.toolState()).tool).toBe('select');
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
