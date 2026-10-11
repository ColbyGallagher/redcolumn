import { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRINT_MODE, type PrintMode } from './capabilities';

/** Hidden print windows show only images this process wrote, so scripts are off. */

async function writeTemp(bytes: Uint8Array, ext: string): Promise<string> {
  const file = path.join(os.tmpdir(), `redcolumn-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  await fs.writeFile(file, bytes);
  return file;
}

/** The system print verb hands the file to another program, which may take a while to open it. */
function forget(file: string) {
  setTimeout(() => void fs.unlink(file).catch(() => undefined), 10 * 60_000);
}

/** Prints a PDF the Chromium viewer loaded. Often blank: the plugin does not paint headless. */
export async function printViewer(file: string): Promise<void> {
  // The PDF viewer is a built-in extension and needs scripts.
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  try {
    await win.loadURL(pathToFileURL(file).href);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await printContents(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export interface PrintPage {
  file: string;
  /** Page size in points, which decides the paper orientation. */
  width: number;
  height: number;
}

/** The print document for drawn pages. Each page keeps its own orientation. */
export function imagesHtml(pages: PrintPage[]): string {
  const landscape = (p: PrintPage) => p.width > p.height;
  const all = pages.every(landscape) ? 'landscape' : pages.some(landscape) ? null : 'portrait';
  const pageRules = all
    ? `@page{size:${all};margin:0}`
    : '@page{margin:0}@page land{size:landscape;margin:0}@page port{size:portrait;margin:0}.land{page:land}.port{page:port}';
  const body = pages
    .map((p) => `<div class="page ${landscape(p) ? 'land' : 'port'}"><img src="${encodeURI(path.basename(p.file))}"></div>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>redcolumn</title><style>${pageRules}html,body{margin:0}.page{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;break-after:page;overflow:hidden}.page:last-child{break-after:auto}img{max-width:100%;max-height:100%;object-fit:contain}</style>${body}`;
}

interface PrintJob {
  dir: string;
  pages: PrintPage[];
  timer: NodeJS.Timeout;
}

const jobs = new Map<string, PrintJob>();
const MAX_PAGE_BYTES = 256 * 1024 * 1024;

/** Starts a print of drawn pages. Pages arrive one at a time so the window never holds them all. */
export async function beginImagePrint(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-print-'));
  const id = path.basename(dir);
  // A job the window never finishes is cleaned up anyway.
  const timer = setTimeout(() => void endJob(id), 30 * 60_000);
  jobs.set(id, { dir, pages: [], timer });
  return id;
}

export async function addImagePage(id: string, bytes: Uint8Array, type: string, width: number, height: number): Promise<void> {
  const job = jobs.get(id);
  if (!job) throw new Error('That print job has ended.');
  if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error('A page is too large to print.');
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('A page has no size.');
  const ext = type === 'image/jpeg' ? 'jpg' : 'png';
  const file = path.join(job.dir, `page-${String(job.pages.length + 1).padStart(5, '0')}.${ext}`);
  await fs.writeFile(file, bytes);
  job.pages.push({ file, width, height });
}

export async function finishImagePrint(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) throw new Error('That print job has ended.');
  try {
    if (!job.pages.length) return;
    const file = path.join(job.dir, 'print.html');
    await fs.writeFile(file, imagesHtml(job.pages));
    // Spelled out here, not in a shared constant, so the CI scan (Electronegativity) can see it.
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: false } });
    try {
      await win.loadFile(file);
      await printContents(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  } finally {
    await endJob(id);
  }
}

export async function cancelImagePrint(id: string): Promise<void> {
  await endJob(id);
}

async function endJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  clearTimeout(job.timer);
  await fs.rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
}

function printContents(win: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    win.webContents.print({ silent: false }, (success, reason) => {
      if (success || /cancel/i.test(reason ?? '')) resolve();
      else reject(new Error(reason || 'Print failed'));
    });
  });
}

/** Asks the operating system to print the file with whatever handles PDFs. */
export function printVerb(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (code: number | null) => (code === 0 ? resolve() : reject(new Error('The system print command failed')));
    if (process.platform === 'win32') {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:RECOLUMN_PRINT -Verb Print'], {
        windowsHide: true,
        env: { ...process.env, RECOLUMN_PRINT: file },
      });
      child.on('error', reject);
      child.on('exit', done);
      return;
    }
    const child = spawn('lp', [file], { windowsHide: true });
    child.on('error', reject);
    child.on('exit', done);
  });
}

export async function printBytes(bytes: Uint8Array, mode: PrintMode = PRINT_MODE): Promise<void> {
  const file = await writeTemp(bytes, 'pdf');
  try {
    if (mode === 'viewer') await printViewer(file);
    else if (mode === 'verb') await printVerb(file);
    else throw new Error('Image printing is drawn in the window');
  } finally {
    forget(file);
  }
}
