/// <reference lib="webworker" />
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import { splitChrome } from './chrome';
import { SearchStore, type DocContent } from './store';

/**
 * The search index's own worker: SQLite runs here so building and querying the index never holds
 * up the page. The database lives in the origin private file system (the "opfs-sahpool" VFS needs
 * no special headers); when that is not available (another tab holds it, or a private window) the
 * index is kept in memory for this session only.
 */

export type IndexOp = 'put' | 'load' | 'pages' | 'candidates' | 'suggest' | 'drop' | 'fields' | 'setFields' | 'clear' | 'status';

export interface IndexRequest {
  id: number;
  op: IndexOp;
  args: unknown[];
  /**
   * Whether the index may be kept on this device's storage. Off while "Encrypt local data" is on:
   * the index holds the documents' text, so it is then kept in memory and any stored copy is wiped.
   * Read from the first request.
   */
  persist: boolean;
}

export interface IndexResponse {
  id: number;
  result?: unknown;
  error?: string;
}

let ready: Promise<{ store: SearchStore; persistent: boolean }> | null = null;

async function open(persist: boolean): Promise<{ store: SearchStore; persistent: boolean }> {
  const sqlite3 = await sqlite3InitModule();
  const inMemory = () => ({ store: new SearchStore(new sqlite3.oo1.DB(':memory:')), persistent: false });
  let pool: Awaited<ReturnType<typeof sqlite3.installOpfsSAHPoolVfs>>;
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'redcolumn-search', directory: '/redcolumn-search' });
  } catch {
    return inMemory();
  }
  if (!persist) {
    await pool.wipeFiles();
    return inMemory();
  }
  let db: Database = new pool.OpfsSAHPoolDb('/search.db');
  try {
    return { store: new SearchStore(db), persistent: true };
  } catch {
    // An index that cannot be read (damaged) is only a cache of the PDFs' text: start it again.
    db.close();
    await pool.wipeFiles();
    db = new pool.OpfsSAHPoolDb('/search.db');
    return { store: new SearchStore(db), persistent: true };
  }
}

self.onmessage = async (e: MessageEvent<IndexRequest>) => {
  const { id, op, args, persist } = e.data;
  try {
    ready ??= open(persist);
    const { store, persistent } = await ready;
    const call = (store as unknown as Record<string, (...a: unknown[]) => unknown>)[op];
    if (op === 'put') {
      // The body/chrome split is worked out here, off the page.
      const content = args[1] as Omit<DocContent, 'text'>;
      args[1] = { ...content, text: splitChrome(content.pages) } satisfies DocContent;
    }
    const result = op === 'status' ? { persistent } : call!.apply(store, args);
    (self as unknown as Worker).postMessage({ id, result } satisfies IndexResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies IndexResponse);
  }
};
