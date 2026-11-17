import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalExcelTarget, localExcel, SyncStoppedError, targetFor, type SyncLink, type SyncTarget } from './targets';
import { tableKey, type TableCell } from './table';
import { buildWorkbook, uniqueNames, type SheetSpec } from './xlsx';
import type { SyncTable } from './keyed';
import type { CellChange } from './merge';
import { bookFromRead, changeId, liveOptions, planCycle, type SyncIssue } from './liveSync';

/** An error with `retryAt` is tried again by itself then; without one, only a click tries again. */
export type SyncStatus = { kind: 'idle' } | { kind: 'syncing' } | { kind: 'synced'; at: number } | { kind: 'error'; message: string; retryAt?: number };

type Table = readonly (readonly TableCell[])[];

const STORE = 'nb.sheetsync.v1';
/** Wait this long after the last change before writing, so a drag or a burst of edits is one write. */
const DEBOUNCE_MS = 1500;
/** A two-way link looks at the workbook this often, for edits typed in Excel. */
const POLL_MS = 15_000;
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

/**
 * What a two-way link needs each cycle: the document as a keyed table (the link's own columns, every
 * markup), which document it is, and how to apply edits typed in Excel to it.
 */
export interface TwoWay {
  table: SyncTable;
  docId: string;
  apply: (changes: CellChange[]) => void;
}

/** Whether a link is two-way: it has its own column set, and this desktop app can read the workbook. */
export const isTwoWay = (link: SyncLink | null): boolean => !!link?.columns && !!localExcel()?.read;

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
  const latestExtras = useRef<readonly SheetSpec[]>([]);
  const written = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // Two-way sync: the document as a keyed table, the cells waiting for an answer, and what has been tried or answered.
  const latestTwoWay = useRef<TwoWay | null>(null);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const attempted = useRef(new Set<string>());
  const forced = useRef(new Set<string>());
  const writtenExtras = useRef<string | null>(null);

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
    latestExtras.current = [];
    latestTwoWay.current = null;
    attempted.current = new Set();
    forced.current = new Set();
    writtenExtras.current = null;
    setIssues([]);
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
      const extras = current.quantities ? latestExtras.current : [];
      const excel = localExcel();
      const two = latestTwoWay.current;
      // A two-way link whose keyed table is not here yet waits for it: the one-way table must never be written over a two-way sheet.
      if (current.columns && excel?.read && !two) return;
      if (current.columns && two && excel?.read) {
        // Two-way: read what Excel has, apply what was typed there, then write what is left to write.
        stopRetry();
        try {
          const read = await excel.read(current.id);
          if (gen !== generation.current) return;
          const book = await bookFromRead(read);
          const plan = planCycle(book, two.table, { sheet: 'Markups', docId: two.docId, exportedAt: new Date().toISOString(), attempted: attempted.current, forced: forced.current });
          setIssues(plan.issues);
          if (plan.apply.length) {
            // The document changes first; the table that comes back from it is written by the next cycle.
            for (const c of plan.apply) attempted.current.add(changeId(c));
            two.apply(plan.apply);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
            setStatus({ kind: 'synced', at: Date.now() });
            return;
          }
          const extrasKey = tableKey([], extras);
          if (plan.upToDate && extrasKey === writtenExtras.current) {
            failures.current = 0;
            setStatus((s) => (s.kind === 'synced' ? s : { kind: 'synced', at: Date.now() }));
            return;
          }
          setStatus({ kind: 'syncing' });
          const [visible, hidden] = plan.sheets as [SheetSpec, SheetSpec];
          const all = [visible, hidden, ...extras];
          const names = uniqueNames(all.map((s) => s.name));
          const copy = (t: readonly (readonly TableCell[])[]) => t.map((row) => [...row]);
          const answer = await excel.write(
            current.id,
            buildWorkbook(all),
            copy(visible.table),
            all.slice(1).map((s, i) => ({ name: names[i + 1]!, table: copy(s.table) })),
            liveOptions(visible, read.kind === 'live' ? read.stamp : undefined),
          );
          if (gen !== generation.current) return;
          if (answer === 'changed') {
            // Someone typed in Excel between the read and the write: nothing was written, so read again.
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void flushRef.current(), 500);
            return;
          }
          forced.current = new Set();
          writtenExtras.current = extrasKey;
          failures.current = 0;
          setStatus({ kind: 'synced', at: Date.now() });
        } catch (err) {
          if (gen !== generation.current) return;
          const message = err instanceof Error ? err.message : 'Could not update the spreadsheet.';
          if (/no longer linked/i.test(message)) {
            setStatus({ kind: 'error', message });
            return;
          }
          const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]!;
          failures.current++;
          retryTimer.current = setTimeout(() => void flushRef.current(), wait);
          setStatus({ kind: 'error', message, retryAt: Date.now() + wait });
        }
        return;
      }
      const key = tableKey(table, extras);
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
        await target.current.push(table, extras);
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

  // A two-way link looks at the workbook now and then: an edit typed in Excel changes nothing here that would start a cycle.
  const twoWay = isTwoWay(link);
  useEffect(() => {
    if (!twoWay) return;
    const id = setInterval(() => {
      if (!retryTimer.current) void flushRef.current();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [twoWay, docKey]);

  /** Call with the table as it stands now (and the quantities sheet, if there is one); writes soon if it changed. A two-way link also needs `two`. */
  const update = useCallback(
    (table: Table, extras: readonly SheetSpec[] = [], two: TwoWay | null = null) => {
      latest.current = table;
      latestExtras.current = extras;
      latestTwoWay.current = two;
      if (!docKey || !savedLink(docKey)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [docKey, flush],
  );

  /** Asks where to save a workbook on this computer, then starts syncing to it (Windows desktop app). */
  const connectLocal = useCallback(
    async (title: string, table: Table, extras: readonly SheetSpec[] = [], quantities = false, columns?: string[]) => {
      const excel = localExcel();
      if (!docKey || !excel) return;
      setStatus({ kind: 'syncing' });
      try {
        if (columns && excel.read) {
          // Two-way: the link keeps its own columns, and the first cycle writes the workbook.
          const picked = await excel.pick(title);
          if (!picked) {
            setStatus({ kind: 'idle' });
            return;
          }
          const made: SyncLink = { provider: 'excel-local', id: picked.id, url: '', title: picked.name, columns, ...(quantities ? { quantities: true } : {}) };
          latest.current = table;
          latestExtras.current = extras;
          save(docKey, made);
          setLink(made);
          return;
        }
        const made = await LocalExcelTarget.create(title, table, excel, quantities ? extras : [], quantities);
        if (!made) {
          setStatus({ kind: 'idle' });
          return;
        }
        target.current = made.target;
        latest.current = table;
        latestExtras.current = extras;
        written.current = tableKey(table, quantities ? extras : []);
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

  /** Turns the Quantities sheet on or off; the workbook is brought up to date at once. */
  const setQuantities = useCallback(
    (on: boolean) => {
      const current = docKey ? savedLink(docKey) : null;
      if (!docKey || !current) return;
      const next: SyncLink = { ...current };
      if (on) next.quantities = true;
      else delete next.quantities;
      save(docKey, next);
      setLink(next);
      void flushRef.current();
    },
    [docKey],
  );

  /** Sets the columns a two-way link has: the list's columns as they are now. An older one-way link becomes two-way. */
  const setColumns = useCallback(
    (columns: string[]) => {
      const current = docKey ? savedLink(docKey) : null;
      if (!docKey || !current) return;
      const next: SyncLink = { ...current, columns };
      save(docKey, next);
      setLink(next);
    },
    [docKey],
  );

  /** Answers a cell waiting on a choice: take Excel's value into the document, or write the document's over it. */
  const resolve = useCallback((issue: SyncIssue, side: 'excel' | 'mine') => {
    if (side === 'excel' && issue.change) {
      attempted.current.add(changeId(issue.change));
      latestTwoWay.current?.apply([issue.change]);
    } else forced.current.add(issue.id);
    setIssues((list) => list.filter((i) => i.id !== issue.id));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 300);
  }, []);

  /** Write now. */
  const syncNow = useCallback(async () => {
    if (!docKey || !link) return;
    written.current = null;
    writtenExtras.current = null;
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
    setIssues([]);
    setStatus({ kind: 'idle' });
  }, [docKey]);

  return { link, status, issues, twoWay, update, connectLocal, setQuantities, setColumns, resolve, syncNow, disconnect };
}
