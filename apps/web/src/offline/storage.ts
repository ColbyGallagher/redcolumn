/**
 * Preferences › Offline: how much this device stores for redcolumn (the document library, markups,
 * the app itself and OCR data) and whether the browser may evict it under storage pressure.
 */

export interface StorageState {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  /** Chromium splits the usage by kind (IndexedDB, caches, file system…). */
  details: Record<string, number>;
}

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${Math.round(v)} ${v === 1 ? 'byte' : 'bytes'}` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[i]}`;
}

const DETAIL_LABELS: Record<string, string> = { indexedDB: 'Markups and settings (IndexedDB)', caches: 'The app and OCR data (caches)', fileSystem: 'Documents (file system)', serviceWorkerRegistrations: 'Service worker' };

/** One line per part of the storage, largest first, for the ones that use anything. */
export function describeStorage(s: StorageState): { summary: string; percent: number | null; parts: { label: string; size: string }[] } {
  const percent = s.usage !== null && s.quota ? Math.min(100, (s.usage / s.quota) * 100) : null;
  const summary =
    s.usage === null
      ? 'This browser does not report how much it stores.'
      : s.quota
        ? `${formatBytes(s.usage)} used of ${formatBytes(s.quota)} available (${percent! < 1 ? '<1' : Math.round(percent!)}%)`
        : `${formatBytes(s.usage)} used`;
  const parts = Object.entries(s.details)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: DETAIL_LABELS[k] ?? k, size: formatBytes(v) }));
  return { summary, percent, parts };
}

export async function readStorage(): Promise<StorageState> {
  const sm = typeof navigator === 'undefined' ? undefined : navigator.storage;
  const est = (await sm?.estimate?.().catch(() => undefined)) as (StorageEstimate & { usageDetails?: Record<string, number> }) | undefined;
  const persisted = (await sm?.persisted?.().catch(() => null)) ?? null;
  return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted, details: est?.usageDetails ?? {} };
}

/** Asks the browser to keep our storage; browsers may grant it silently, ask, or refuse. */
export async function requestPersistence(): Promise<boolean> {
  return (await navigator.storage?.persist?.().catch(() => false)) ?? false;
}
