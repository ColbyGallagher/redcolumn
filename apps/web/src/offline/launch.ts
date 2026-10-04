import { bindHandle } from '../storage/diskHandles.ts';
import type { LaunchAction } from './manifest.ts';

/**
 * How the installed app is launched with something to do: a launcher shortcut (?action=open or
 * new), PDFs opened from the operating system's file manager (the manifest's file_handlers, read
 * with the launchQueue API), and PDFs shared from other apps (share_target, stored for us by the
 * service worker in public/sw-share.js).
 */

export interface Launch {
  action: LaunchAction | null;
  /** A link shared on its own (no file), when it may point at a PDF. */
  url: string | null;
  error: boolean;
}

/** Reads the launch query; `strip` then removes it so a reload does not repeat it. */
export function parseLaunch(search: string): Launch {
  const q = new URLSearchParams(search);
  const a = q.get('action');
  return { action: a === 'open' || a === 'new' || a === 'shared' ? a : null, url: q.get('url'), error: q.get('error') === '1' };
}

export function stripLaunchQuery() {
  const url = new URL(window.location.href);
  for (const k of ['action', 'url', 'error']) url.searchParams.delete(k);
  window.history.replaceState(window.history.state, '', url.href);
}

interface LaunchParams {
  files: readonly FileSystemFileHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** Whether this browser can hand files from the operating system to the installed app. */
export const canHandleFiles = () => typeof window !== 'undefined' && 'launchQueue' in window;

/**
 * Calls `onFiles` with the PDFs the app was launched with, now and each time another is opened
 * from the file manager while it runs (the manifest asks for the open window to be reused).
 */
export function consumeLaunchFiles(onFiles: (files: File[]) => void) {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(async (params) => {
    const files: File[] = [];
    for (const handle of params.files ?? []) {
      try {
        const file = await handle.getFile();
        bindHandle(file, handle);
        files.push(file);
      } catch {
        // A file that went away before we read it.
      }
    }
    const pdfs = files.filter(isPdf);
    if (pdfs.length) onFiles(pdfs);
  });
}

export const isPdf = (f: { name: string; type: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

const SHARE_CACHE = 'nb-share';

/** Takes the files shared to the app (and removes them from where the service worker kept them). */
export async function takeSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) {
      const name = decodeURIComponent(res.headers.get('x-name') ?? 'Shared.pdf');
      files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') ?? 'application/pdf' }));
    }
    await cache.delete(req);
  }
  return files.filter(isPdf);
}
