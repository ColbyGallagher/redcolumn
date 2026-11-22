/// <reference lib="webworker" />
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import { splitChrome } from './chrome';
import { chunks, Embedder } from './semantic';
import { bitSet, SearchStore, type DocContent } from './store';

/**
 * The search index's own worker: SQLite runs here so building and querying the index never holds
 * up the page. The database lives in the origin private file system (the "opfs-sahpool" VFS needs
 * no special headers); when that is not available (another tab holds it, or a private window) the
 * index is kept in memory for this session only.
 */

export type IndexOp = 'put' | 'load' | 'pages' | 'candidates' | 'suggest' | 'drop' | 'fields' | 'setFields' | 'clear' | 'status' | 'semanticStatus' | 'related';

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

/**
 * Search by meaning's model, from the app's /semantic/ folder (the desktop app ships it; see
 * semantic.ts). Loaded the first time it is needed; null where there is none.
 */
let embedder: Promise<Embedder | null> | null = null;
function semantic(): Promise<Embedder | null> {
  embedder ??= (async () => {
    // Next to the app: the worker's script is in assets/.
    const base = new URL('../semantic/', self.location.href).href;
    const read = async (name: string) => {
      const res = await fetch(new URL(name, base));
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    };
    try {
      return await Embedder.load(base, read, (url) => import(/* @vite-ignore */ url));
    } catch (err) {
      console.warn('Search by meaning is not available', err);
      return null;
    }
  })();
  return embedder;
}

const modelId = (e: Embedder) => `${e.manifest.model}@${e.manifest.revision}`;

/** Lowest cosine a page needs to count as related (unrelated text scores about 0.15 to 0.35). */
export const MIN_RELATED = 0.4;
/** Pages embedded per batch: small, so a query waits at most one batch for the model. */
const BATCH_PAGES = 4;

let embedding = false;
/**
 * Embeds every page that has no vectors yet, a few at a time, letting other requests in between.
 * Runs once at a time; started after a document is stored and when the panel asks.
 */
async function embedPending(store: SearchStore): Promise<void> {
  if (embedding) return;
  embedding = true;
  try {
    const e = await semantic();
    if (!e) return;
    const model = modelId(e);
    for (;;) {
      const pages = store.unembedded(model, BATCH_PAGES);
      if (!pages.length) break;
      const work = pages.map((p) => ({ id: p.id, passages: chunks(p.words, (i) => bitSet(p.chrome, i)) }));
      const vecs = await e.embed(
        work.flatMap((w) => w.passages.map((c) => c.text)),
        'document',
      );
      let k = 0;
      for (const w of work) store.setVectors(model, w.id, w.passages.map((c) => ({ first: c.first, last: c.last, vec: vecs[k++]! })));
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (err) {
    console.warn('Search by meaning: embedding stopped', err);
  } finally {
    embedding = false;
  }
}

async function handle(store: SearchStore, persistent: boolean, op: IndexOp, args: unknown[]): Promise<unknown> {
  switch (op) {
    case 'status':
      return { persistent };
    case 'semanticStatus': {
      const e = await semantic();
      if (!e) return { available: false, done: 0, total: 0 };
      void embedPending(store);
      return { available: true, ...store.embedded(args[0] as string[], modelId(e)) };
    }
    case 'related': {
      const e = await semantic();
      if (!e) return null;
      const [keys, query, limit] = args as [string[], string, number];
      const [vec] = await e.embed([query], 'query');
      return store.related(keys, modelId(e), vec!, limit, MIN_RELATED);
    }
    case 'put': {
      // The body/chrome split is worked out here, off the page.
      const content = args[1] as Omit<DocContent, 'text'>;
      store.put(args[0] as string, { ...content, text: splitChrome(content.pages) });
      void embedPending(store);
      return undefined;
    }
    default:
      return (store as unknown as Record<string, (...a: unknown[]) => unknown>)[op]!.apply(store, args);
  }
}

self.onmessage = async (e: MessageEvent<IndexRequest>) => {
  // Only the page that started this worker can post to it, and its messages carry no origin: one
  // from any other origin is ignored.
  if (e.origin && e.origin !== self.location.origin) return;
  const { id, op, args, persist } = e.data;
  try {
    ready ??= open(persist);
    const { store, persistent } = await ready;
    const result = await handle(store, persistent, op, args);
    (self as unknown as Worker).postMessage({ id, result } satisfies IndexResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies IndexResponse);
  }
};
