import { BrowserWindow, session } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeHtmlPrint, probeViewerPrint } from './print';
import { registerAppProtocol } from './protocol';
import { harden, installPermissions } from './security';

interface SpikePage {
  ready?: boolean;
  origin?: string;
  secure?: boolean;
  showOpenFilePicker?: string;
  showSaveFilePicker?: string;
  showDirectoryPicker?: string;
  launchQueue?: boolean;
  dropHandle?: boolean;
  persist?: boolean;
  persistError?: string;
}

/** Probes the File System Access API and hidden-window PDF printing, then exits. */
export async function runSpike() {
  registerAppProtocol();
  installPermissions(session.defaultSession);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  harden(win.webContents);
  await win.loadURL('app://redcolumn/spike.html');
  const fsa = await waitForSpike(win);
  const printed = await probeViewerPrint();
  const html = await probeHtmlPrint();
  const result = {
    fsa,
    printed,
    html,
    note: 'Picker dialogs were not opened. webUtils.getPathForFile does not return a path for File System Access files, so Open and Save As use native dialogs. launchQueue exists but is not fed by the operating system.',
  };
  const out = path.join(os.tmpdir(), 'redcolumn-spike.json');
  await fs.writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${out}`);
  win.destroy();
}

async function waitForSpike(win: BrowserWindow): Promise<SpikePage> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const page = await win.webContents.executeJavaScript('window.__spike || null') as SpikePage | null;
    if (page?.ready) return page;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { ready: false };
}
