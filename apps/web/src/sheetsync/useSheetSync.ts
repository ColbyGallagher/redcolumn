import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalExcelTarget, localExcel, SyncStoppedError, targetFor, type SyncLink, type SyncTarget } from './targets';
import { tableKey, type TableCell } from './table';

/** An error with `retryAt` is tried again by itself then; without one, only a click tries again. */
export type SyncStatus = { kind: 'idle' } | { kind: 'syncing' } | { kind: 'synced'; at: number } | { kind: 'error'; message: string; retryAt?: number };

type Table = readonly (readonly TableCell[])[];

const STORE = 'nb.sheetsync.v1';
/** Wait this long after the last change before writing, so a drag or a burst of edits is one write. */
const DEBOUNCE_MS = 1500;
/** After a failed write, try again after these waits (the last one repeats) until one succeeds. */
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];

function load(): Record<string, SyncLink> {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, SyncLink>;
    // Older builds could also sync to Google Sheets and OneDrive; those links are no longer followed.
    return Object.fromEntries(Object.entries(all).filter(([, l]) => l?.provider === 'excel-local'));
  } catch {
    return {};
  }
}

function save(docKey: string, link: SyncLink | null) {
  try {
    const all = load();
    if (link) all[docKey] = link;
    else delete all[docKey];
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // The link is lost on reload; the person can connect again.
  }
}

/** A saved link per document (by name), read straight from storage. */
export const savedLink = (docKey: string): SyncLink | null => load()[docKey] ?? null;

/**
 * Keeps one document's Markups list in a spreadsheet: connect once, then pass the current table to
 * `update` whenever it may have changed. Writes are debounced, one at a time, and skipped when the
 * table is the same as the last one written.
 */
export function useSheetSync(docKey: string | null) {
  const [link, setLink] = useState<SyncLink | null>(() => (docKey ? savedLink(docKey) : null));
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  const target = useRef<SyncTarget | null>(null);
  const latest = useRef<Table | null>(null);
  const written = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const stopRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  // Another document: its own link (or none), and nothing carried over.
  useEffect(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    stopRetry();
    failures.current = 0;
    target.current = null;
    written.current = null;
    latest.current = null;
    setLink(docKey ? savedLink(docKey) : null);
    setStatus({ kind: 'idle' });
  }, [docKey]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      stopRetry();
    },
    [],
  );

  const flush = useCallback((): Promise<void> => {
    const gen = generation.current;
    running.current = running.current.then(async () => {
      const table = latest.current;
      if (gen !== generation.current || !table || !docKey) return;
      const current = savedLink(docKey);
      if (!current) return;
      const key = tableKey(table);
      if (key === written.current) {
        // Back to what the sheet already holds (an undo after a failed write): nothing left to retry.
        stopRetry();
        failures.current = 0;
        setStatus((s) => (s.kind === 'error' ? { kind: 'synced', at: Date.now() } : s));
        return;
      }
      stopRetry();
      setStatus({ kind: 'syncing' });
      try {
        target.current ??= targetFor(current);
        await target.current.push(table);
        if (gen !== generation.current) return;
        written.current = key;
        failures.current = 0;
        setStatus({ kind: 'synced', at: Date.now() });
      } catch (err) {
        if (gen !== generation.current) return;
        target.current = null;
        const message = err instanceof Error ? err.message : 'Could not update the spreadsheet.';
        // A link this app cannot follow: retrying would only repeat the same answer.
        if (err instanceof SyncStoppedError) {
          setStatus({ kind: 'error', message });
          return;
        }
        const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]!;
        failures.current++;
        retryTimer.current = setTimeout(() => void flushRef.current(), wait);
        setStatus({ kind: 'error', message, retryAt: Date.now() + wait });
      }
    });
    return running.current;
  }, [docKey]);
  flushRef.current = flush;

  // Back online, or back to this tab: a failed write is tried again at once rather than at its next retry.
  useEffect(() => {
    const retry = () => {
      if (retryTimer.current && document.visibilityState === 'visible') void flush();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [flush]);

  /** Call with the table as it stands now; writes soon if it changed. */
  const update = useCallback(
    (table: Table) => {
      latest.current = table;
      if (!docKey || !savedLink(docKey)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [docKey, flush],
  );

  /** Asks where to save a workbook on this computer, then starts syncing to it (Windows desktop app). */
  const connectLocal = useCallback(
    async (title: string, table: Table) => {
      const excel = localExcel();
      if (!docKey || !excel) return;
      setStatus({ kind: 'syncing' });
      try {
        const made = await LocalExcelTarget.create(title, table, excel);
        if (!made) {
          setStatus({ kind: 'idle' });
          return;
        }
        target.current = made.target;
        latest.current = table;
        written.current = tableKey(table);
        failures.current = 0;
        save(docKey, made.link);
        setLink(made.link);
        setStatus({ kind: 'synced', at: Date.now() });
      } catch (err) {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not create the workbook.' });
      }
    },
    [docKey],
  );

  /** Write now. */
  const syncNow = useCallback(async () => {
    if (!docKey || !link) return;
    written.current = null;
    failures.current = 0;
    await flush();
  }, [docKey, link, flush]);

  /** Stops syncing. The spreadsheet stays where it is, with the last markups written to it. */
  const disconnect = useCallback(() => {
    if (!docKey) return;
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    stopRetry();
    failures.current = 0;
    target.current = null;
    written.current = null;
    save(docKey, null);
    setLink(null);
    setStatus({ kind: 'idle' });
  }, [docKey]);

  return { link, status, update, connectLocal, syncNow, disconnect };
}
