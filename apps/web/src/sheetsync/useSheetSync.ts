import { useCallback, useEffect, useRef, useState } from 'react';
import { DriveAuthError } from '../studio/drive/DriveApi';
import { signInWithGoogle } from '../studio/drive/google';
import { signInWithMicrosoft } from '../studio/drive/onedrive';
import { GoogleSheetTarget, OneDriveWorkbookTarget, targetFor, type SheetProvider, type SyncLink, type SyncTarget } from './targets';
import { tableKey, type TableCell } from './table';

export type SyncStatus = { kind: 'idle' } | { kind: 'syncing' } | { kind: 'synced'; at: number } | { kind: 'error'; message: string; reconnect: boolean };

type Table = readonly (readonly TableCell[])[];

const STORE = 'nb.sheetsync.v1';
/** Wait this long after the last change before writing, so a drag or a burst of edits is one write. */
const DEBOUNCE_MS = 1500;

function load(): Record<string, SyncLink> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, SyncLink>;
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

  // Another document: its own link (or none), and nothing carried over.
  useEffect(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    target.current = null;
    written.current = null;
    latest.current = null;
    setLink(docKey ? savedLink(docKey) : null);
    setStatus({ kind: 'idle' });
  }, [docKey]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const flush = useCallback((): Promise<void> => {
    const gen = generation.current;
    running.current = running.current.then(async () => {
      const table = latest.current;
      if (gen !== generation.current || !table || !docKey) return;
      const current = savedLink(docKey);
      if (!current) return;
      const key = tableKey(table);
      if (key === written.current) return;
      setStatus({ kind: 'syncing' });
      try {
        target.current ??= targetFor(current);
        await target.current.push(table);
        if (gen !== generation.current) return;
        written.current = key;
        setStatus({ kind: 'synced', at: Date.now() });
      } catch (err) {
        if (gen !== generation.current) return;
        target.current = null;
        const reconnect = err instanceof DriveAuthError;
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not update the spreadsheet.', reconnect });
      }
    });
    return running.current;
  }, [docKey]);

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

  /** Creates the spreadsheet and starts syncing. Call from a click: it may open a sign-in popup. */
  const connect = useCallback(
    async (provider: SheetProvider, title: string, table: Table) => {
      if (!docKey) return;
      setStatus({ kind: 'syncing' });
      try {
        if (provider === 'google') await signInWithGoogle();
        else await signInWithMicrosoft();
        const made = provider === 'google' ? await GoogleSheetTarget.create(title, table) : await OneDriveWorkbookTarget.create(title, table);
        target.current = made.target;
        latest.current = table;
        written.current = tableKey(table);
        save(docKey, made.link);
        setLink(made.link);
        setStatus({ kind: 'synced', at: Date.now() });
      } catch (err) {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not create the spreadsheet.', reconnect: false });
      }
    },
    [docKey],
  );

  /** Write now, signing in again first if the last write needed it. Call from a click. */
  const syncNow = useCallback(async () => {
    if (!docKey || !link) return;
    try {
      if (link.provider === 'google') await signInWithGoogle();
      else await signInWithMicrosoft();
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Sign-in failed.', reconnect: true });
      return;
    }
    written.current = null;
    await flush();
  }, [docKey, link, flush]);

  /** Stops syncing. The spreadsheet stays where it is, with the last markups written to it. */
  const disconnect = useCallback(() => {
    if (!docKey) return;
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    target.current = null;
    written.current = null;
    save(docKey, null);
    setLink(null);
    setStatus({ kind: 'idle' });
  }, [docKey]);

  return { link, status, update, connect, syncNow, disconnect };
}
