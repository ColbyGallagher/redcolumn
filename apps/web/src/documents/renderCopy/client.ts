import type { PagePlan } from './renderCopy';
import type { RenderCopyRequest, RenderCopyResponse } from './renderCopy.worker';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** One document's render-copy builder, in its own worker; `dispose` when done with it. */
export class RenderCopyJob {
  private worker = new Worker(new URL('./renderCopy.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: RenderCopyResponse) => void; reject: (e: Error) => void; progress?: (done: number, total: number) => void }>();
  private loaded: Promise<number>;

  /** Starts reading the file (`bytes` is transferred). */
  constructor(bytes: ArrayBuffer) {
    this.worker.onmessage = (e: MessageEvent<RenderCopyResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') return p.progress?.(msg.done, msg.total);
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.error));
      else p.resolve(msg);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'The optimiser stopped'));
      this.pending.clear();
    };
    this.loaded = this.call({ type: 'load', bytes }, [bytes]).then((r) => (r.type === 'load' ? r.pageCount : 0));
  }

  private call(req: WithoutId<RenderCopyRequest>, transfer: Transferable[] = [], progress?: (done: number, total: number) => void): Promise<RenderCopyResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }

  /** Page count, once the file is read; rejects for files that cannot be optimised (encrypted). */
  get ready(): Promise<number> {
    return this.loaded;
  }

  /** What optimising these pages would do (nothing is built yet). */
  async plan(pages: number[]): Promise<PagePlan[]> {
    await this.loaded;
    const r = await this.call({ type: 'plan', pages });
    return r.type === 'plan' ? r.plans : [];
  }

  /** The render copy with these pages (all when null) optimised, plus those built before. */
  async build(pages: number[] | null, progress?: (done: number, total: number) => void): Promise<{ bytes: ArrayBuffer | null; pages: PagePlan[] }> {
    await this.loaded;
    const r = await this.call({ type: 'build', pages }, [], progress);
    return r.type === 'build' ? { bytes: r.bytes, pages: r.pages } : { bytes: null, pages: [] };
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Cancelled'));
    this.pending.clear();
  }
}
