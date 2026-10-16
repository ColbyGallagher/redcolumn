/// <reference lib="webworker" />
import { RenderCopyBuilder, type PagePlan } from './renderCopy';

export type RenderCopyRequest =
  | { id: number; type: 'load'; bytes: ArrayBuffer }
  | { id: number; type: 'plan'; pages: number[] }
  | { id: number; type: 'build'; pages: number[] | null };

export type RenderCopyResponse =
  | { id: number; type: 'load'; pageCount: number }
  | { id: number; type: 'plan'; plans: PagePlan[] }
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'build'; bytes: ArrayBuffer | null; pages: PagePlan[] }
  | { id: number; type: 'error'; error: string };

/** Builds a document's optimised render copy off the main thread (and off the render worker). */
let builder: RenderCopyBuilder | null = null;

const post = (msg: RenderCopyResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<RenderCopyRequest>) => {
  // Only the page that started this worker can post to it, and its messages carry no origin: one
  // from any other origin is ignored.
  if (e.origin && e.origin !== self.location.origin) return;
  const req = e.data;
  try {
    if (req.type === 'load') {
      builder = await RenderCopyBuilder.load(new Uint8Array(req.bytes));
      post({ id: req.id, type: 'load', pageCount: builder.pageCount });
      return;
    }
    if (!builder) throw new Error('No document loaded');
    if (req.type === 'plan') {
      const plans: PagePlan[] = [];
      for (const i of req.pages) plans.push(await builder.plan(i));
      post({ id: req.id, type: 'plan', plans });
      return;
    }
    const { bytes, pages } = await builder.build(req.pages, (_, done, total) => post({ id: req.id, type: 'progress', done, total }));
    // saveIncremental writes a fresh buffer the size of the file: transferred as it is.
    const out = bytes ? (bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer : null;
    post({ id: req.id, type: 'build', bytes: out, pages }, out ? [out] : []);
  } catch (err) {
    post({ id: req.id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
