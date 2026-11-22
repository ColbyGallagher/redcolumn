import type { PageText } from '@nb/sheets';
import { localEncryptionOn } from '../../storage/localCrypto';
import type { Candidates, DocContent, Note, Related } from './store';
import type { IndexOp, IndexRequest, IndexResponse } from './index.worker';

export type { Candidates, Note, Related } from './store';

/**
 * The search index from the page: each call is sent to the index's worker. The index is only a
 * cache of text read from the PDFs, so every call resolves to null (or does nothing) when the
 * worker cannot start or fails; searching then reads the documents as it always did.
 */

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, (r: IndexResponse) => void>();

function indexWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./index.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<IndexResponse>) => {
    pending.get(e.data.id)?.(e.data);
    pending.delete(e.data.id);
  };
  worker.onerror = worker.onmessageerror = () => {
    // A worker that cannot load (no WebAssembly) is not tried again this session.
    broken = true;
    for (const [id, done] of pending) done({ id, error: 'The search index stopped' });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

async function call<T>(op: IndexOp, ...args: unknown[]): Promise<T | null> {
  const w = indexWorker();
  if (!w) return null;
  const id = nextId++;
  const response = await new Promise<IndexResponse>((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, op, args, persist: !localEncryptionOn() } satisfies IndexRequest);
  });
  if (response.error !== undefined) {
    console.warn(`Search index: ${op} failed`, response.error);
    return null;
  }
  return response.result as T;
}

export const searchIndex = {
  /**
   * Keeps a document's text. Without `info` and `notes` only its page text is kept: enough to
   * narrow searches, but a search that needs its properties reads the PDF again.
   */
  async put(key: string, pages: PageText[], extra?: { info: Record<string, unknown>; notes: Note[] }): Promise<void> {
    // The worker adds the body/chrome split (`DocContent.text`).
    const content: Omit<DocContent, 'text'> = { pages, info: extra?.info ?? null, notes: extra?.notes ?? null };
    await call('put', key, content);
  },
  load: (key: string) => call<{ pages: PageText[]; info: Record<string, unknown>; notes: Note[] }>('load', key),
  pages: (key: string, wanted: readonly number[]) => call<PageText[]>('pages', key, wanted),
  candidates: (keys: readonly string[], query: string, wholeWord: boolean) => call<Candidates>('candidates', keys, query, wholeWord),
  suggest: (keys: readonly string[], query: string) => call<string>('suggest', keys, query),
  drop: (key: string) => call<void>('drop', key).then(() => {}),
  fields: (key: string) => call<Note[]>('fields', key),
  setFields: (key: string, fields: readonly Note[]) => call<void>('setFields', key, fields).then(() => {}),
  clear: () => call<void>('clear').then(() => {}),
  /**
   * Whether search by meaning is available here (the desktop app ships its model), and how many
   * pages of `keys` are embedded so far. Starts embedding any that are not.
   */
  semanticStatus: (keys: readonly string[]) => call<{ available: boolean; done: number; total: number }>('semanticStatus', keys),
  /** Pages of `keys` about what `query` asks, best first; null without the model. */
  related: (keys: readonly string[], query: string, limit: number) => call<Related[]>('related', keys, query, limit),
};
