import { app, BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import type { PathAllowlist } from './allowlist';
import { pdfArguments } from './pdf-args';

export interface LaunchItem {
  token: string;
  name: string;
}

/**
 * PDF paths from a cold start (argv on Windows, open-file before ready on macOS) wait here
 * until the page registers its launch consumer. After that, new paths are sent to the window.
 */
export class LaunchQueue {
  private pending: LaunchItem[] = [];
  private listening = false;
  private window: BrowserWindow | null = null;
  private last: { path: string; at: number } | null = null;

  constructor(private allowlist: PathAllowlist) {}

  attach(window: BrowserWindow) {
    this.window = window;
    this.listening = false;
    // A reload (or a new page after a renderer crash) has not registered its consumer yet.
    // Queue until it calls take() again, so files sent while it loads are not lost.
    window.webContents.on('did-start-navigation', (details) => {
      if (this.window === window && details.isMainFrame && !details.isSameDocument) this.listening = false;
    });
  }

  /** Takes the queued files once. Later files are delivered as launch-files events. */
  take(): LaunchItem[] {
    this.listening = true;
    return this.pending.splice(0);
  }

  noteArgv(argv: readonly string[]) {
    for (const filePath of pdfArguments(argv)) this.note(filePath);
  }

  note(filePath: string) {
    const resolved = path.resolve(filePath);
    const now = Date.now();
    if (this.last && this.last.path === resolved && now - this.last.at < 1000) return;
    this.last = { path: resolved, at: now };
    const item = { token: this.allowlist.add(resolved), name: path.basename(resolved) };
    this.deliver(item);
    this.focus();
  }

  private deliver(item: LaunchItem) {
    const contents: WebContents | undefined = this.window?.webContents;
    if (!this.listening || !contents || contents.isDestroyed()) {
      this.pending.push(item);
      return;
    }
    contents.send('launch-files', [item]);
  }

  private focus() {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
}

/** open-file can arrive before ready. The caller drains this in whenReady. */
export function captureEarlyOpens(): string[] {
  const early: string[] = [];
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    early.push(filePath);
  });
  return early;
}
