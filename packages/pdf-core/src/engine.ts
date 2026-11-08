import { StallTracker, STALL_CHECK_MS, stallLimit } from './stall';
import { RENDER_CANCELLED, type AnnotImage, type CopyCheck, type DocumentInfo, type OutlineItem, type RedactReport, type RedactRequest, type RenderResult, type TextObjectInfo, type PageOp, type PageSize, type PdfAnnotation, type TextWord, type TileRequest, type WorkerRequest, type WorkerResponse } from './protocol';

type Success = Extract<WorkerResponse, { ok: true }>;
type Pending = { resolve: (v: Success) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Handle of a document that has no place in the current worker (it is being reopened, or could not be). */
const STALE_DOC = -1;
const STALE_MESSAGE = 'The document is being reopened after the PDF renderer restarted';

/** Promise-based client for the PDFium render worker. */
export class PdfEngine {
  private worker!: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private failure: Error | null = null;
  private shutDown = false;
  private stall = new StallTracker();
  private stallTimer: ReturnType<typeof setInterval> | null = null;
  private docs = new Set<PdfDocument>();
  private failureListeners = new Set<(err: Error) => void>();

  constructor() {
    this.spawn();
  }

  private spawn() {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    // Events from a worker that has since been replaced are ignored.
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (worker !== this.worker) return;
      this.stall.activity(performance.now());
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.ok && msg.type === 'progress') {
        p.onProgress?.(msg.done, msg.total);
        return;
      }
      this.pending.delete(msg.id);
      this.stall.end(msg.id);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(msg.error));
    };
    // A worker that crashed (or ran out of memory) never answers: every waiting call fails instead.
    worker.onerror = (e) => {
      e.preventDefault();
      if (worker === this.worker) this.fail(new Error(`The PDF engine stopped: ${e.message || 'worker error'}`));
    };
    worker.onmessageerror = () => {
      if (worker === this.worker) this.fail(new Error('The PDF engine sent a message that could not be read'));
    };
  }

  /** False once the worker has failed or been terminated; a dead engine rejects every call. */
  get alive(): boolean {
    return !this.failure;
  }

  /** Documents opened in this engine and not yet closed. */
  get openDocuments(): PdfDocument[] {
    return [...this.docs];
  }

  /** Hears of the engine failing (a crash, or a worker silent for too long), but not of terminate(). Returns a function that stops listening. */
  onFailure(listener: (err: Error) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  private fail(err: Error, notify = true) {
    if (this.failure) return;
    this.failure = err;
    this.worker.terminate();
    if (this.stallTimer) clearInterval(this.stallTimer);
    this.stallTimer = null;
    this.stall.clear();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) p.reject(err);
    if (notify) for (const l of [...this.failureListeners]) l(err);
  }

  /**
   * Replaces the worker with a new one (stopping the old one first if it is still running).
   * Every open document is left without a handle, as the new worker has none of them: reopen
   * each with `reopen` or give it up with `abandon`. False after terminate().
   */
  restart(): boolean {
    if (this.shutDown) return false;
    this.fail(new Error('The PDF engine was restarted'), false);
    this.failure = null;
    for (const doc of this.docs) doc.rebind(STALE_DOC);
    this.spawn();
    return true;
  }

  /** Opens `bytes` again in the current worker and points `doc` at the result. `bytes` is transferred. */
  async reopen(doc: PdfDocument, bytes: ArrayBuffer): Promise<void> {
    const res = await this.call({ type: 'open', bytes }, [bytes]);
    if (res.type !== 'open') throw new Error('Unexpected response');
    if (res.pages.length !== doc.pages.length) {
      await this.closeDoc(res.docId).catch(() => {});
      throw new Error('The file no longer has the same pages');
    }
    doc.rebind(res.docId);
    for (const [pageIndex, indices] of doc.hiddenAnnotations) await this.hideAnnotations(res.docId, pageIndex, indices);
  }

  /** Gives up a document that could not be reopened: it stops being tracked and every call on it fails. */
  abandon(doc: PdfDocument) {
    this.docs.delete(doc);
    doc.rebind(STALE_DOC);
  }

  private watch(id: number, type: string) {
    this.stall.begin(id, stallLimit(type), performance.now());
    if (this.stallTimer) return;
    this.stallTimer = setInterval(() => {
      const silent = this.stall.stalledFor(performance.now());
      if (silent !== null) this.fail(new Error(`The PDF engine stopped responding for ${Math.round(silent / 1000)} s`));
      else if (!this.stall.waiting && this.stallTimer) {
        clearInterval(this.stallTimer);
        this.stallTimer = null;
      }
    }, STALL_CHECK_MS);
  }

  private call(req: WithoutId<WorkerRequest>, transfer: Transferable[] = []): Promise<Success> {
    if (this.failure) return Promise.reject(this.failure);
    if ('docId' in req && req.docId === STALE_DOC) return Promise.reject(new Error(STALE_MESSAGE));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.watch(id, req.type);
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }

  /** Opens a PDF. `bytes` is transferred to the worker and unusable afterwards. */
  async open(bytes: ArrayBuffer, password?: string): Promise<PdfDocument> {
    const res = await this.call({ type: 'open', bytes, password }, [bytes]);
    if (res.type !== 'open') throw new Error('Unexpected response');
    const doc = new PdfDocument(this, res.docId, res.pages);
    this.docs.add(doc);
    return doc;
  }

  /**
   * Applies page operations to a PDF and returns the new file. `bytes` and `inserts` are
   * transferred to the worker and unusable afterwards. A signed file is appended to, so its
   * signatures stay valid, unless `rewrite` asks for a clean copy.
   */
  async editPdf(bytes: ArrayBuffer, ops: PageOp[], inserts: ArrayBuffer[] = [], { rewrite = false } = {}): Promise<ArrayBuffer> {
    const res = await this.call({ type: 'edit', bytes, ops, inserts, rewrite }, [bytes, ...inserts]);
    if (res.type !== 'edit') throw new Error('Unexpected response');
    return res.bytes;
  }

  /** A new PDF of blank pages with the given sizes (points). */
  async createPdf(pages: PageSize[]): Promise<ArrayBuffer> {
    const res = await this.call({ type: 'create', pages });
    if (res.type !== 'create') throw new Error('Unexpected response');
    return res.bytes;
  }

  /** @internal */
  async documentInfo(docId: number): Promise<DocumentInfo> {
    const res = await this.call({ type: 'info', docId });
    if (res.type !== 'info') throw new Error('Unexpected response');
    return res.info;
  }

  /**
   * Removes what lies inside regions from the pages' content (Redaction, Erase Content). `bytes`
   * is transferred. `onProgress` hears of each page as it starts; aborting `signal` stops it
   * between pages and rejects with an AbortError.
   */
  async redact(bytes: ArrayBuffer, request: RedactRequest, { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<{ bytes: ArrayBuffer; report: RedactReport }> {
    if (this.failure) return Promise.reject(this.failure);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const id = this.nextId++;
    const done = new Promise<Success>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.watch(id, 'redact');
      this.worker.postMessage({ type: 'redact', bytes, ...request, id }, [bytes]);
    });
    const onAbort = () => this.worker.postMessage({ type: 'cancel', id: 0, ids: [id] });
    signal?.addEventListener('abort', onAbort, { once: true });
    let res: Success;
    try {
      res = await done;
    } catch (err) {
      if (signal?.aborted && err instanceof Error && err.message === RENDER_CANCELLED) throw new DOMException('Cancelled', 'AbortError');
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    if (res.type !== 'redact') throw new Error('Unexpected response');
    return { bytes: res.bytes, report: res.report };
  }

  /** @internal */
  async textObjectAt(docId: number, pageIndex: number, x: number, y: number): Promise<TextObjectInfo | null> {
    const res = await this.call({ type: 'textObjectAt', docId, pageIndex, x, y });
    if (res.type !== 'textObjectAt') throw new Error('Unexpected response');
    return res.object;
  }

  /** Edit Text: a copy of the PDF with one text object's text replaced. `bytes` is transferred. */
  /**
   * Edit Text: replaces one text object's text. `keptFont` says whether the original font had
   * every character (else the text is set in Helvetica).
   */
  async replaceText(bytes: ArrayBuffer, pageIndex: number, index: number, text: string): Promise<{ bytes: ArrayBuffer; keptFont: boolean }> {
    const res = await this.call({ type: 'replaceText', bytes, pageIndex, index, text }, [bytes]);
    if (res.type !== 'replaceText') throw new Error('Unexpected response');
    return { bytes: res.bytes, keptFont: res.keptFont };
  }

  /** Adds new text (Helvetica, one object per line) with its top-left at a page-space point. */
  async addText(bytes: ArrayBuffer, pageIndex: number, x: number, y: number, text: string, size = 10, color: [number, number, number] = [0, 0, 0]): Promise<ArrayBuffer> {
    const res = await this.call({ type: 'addText', bytes, pageIndex, x, y, text, size, color }, [bytes]);
    if (res.type !== 'addText') throw new Error('Unexpected response');
    return res.bytes;
  }

  /** @internal */
  async outline(docId: number): Promise<OutlineItem[]> {
    const res = await this.call({ type: 'outline', docId });
    if (res.type !== 'outline') throw new Error('Unexpected response');
    return res.outline;
  }

  /**
   * The PDF without its security (encryption and permissions), opened with `password` ('' when it
   * has only a permissions password). Null if it was not encrypted. Rejects with NEEDS_PASSWORD when
   * the password is missing or wrong. `bytes` is transferred.
   */
  async unlock(bytes: ArrayBuffer, password = ''): Promise<ArrayBuffer | null> {
    const res = await this.call({ type: 'unlock', bytes, password }, [bytes]);
    if (res.type !== 'unlock') throw new Error('Unexpected response');
    return res.bytes;
  }

  /** A new PDF containing the given pages, in order. `bytes` is transferred. */
  async extractPages(bytes: ArrayBuffer, pages: number[]): Promise<ArrayBuffer> {
    const res = await this.call({ type: 'extract', bytes, pages }, [bytes]);
    if (res.type !== 'extract') throw new Error('Unexpected response');
    return res.bytes;
  }

  /** Starts a call whose id the caller needs (to cancel it); no transfer. */
  private start(req: WithoutId<WorkerRequest>): { id: number; done: Promise<Success> } {
    const id = this.nextId++;
    if (this.failure) return { id, done: Promise.reject(this.failure) };
    if ('docId' in req && req.docId === STALE_DOC) return { id, done: Promise.reject(new Error(STALE_MESSAGE)) };
    const done = new Promise<Success>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.watch(id, req.type);
      this.worker.postMessage({ ...req, id });
    });
    return { id, done };
  }

  /** Runs a cancellable call: aborting `signal` stops it in the worker and rejects with RENDER_CANCELLED. */
  private cancellable(req: WithoutId<WorkerRequest>, signal?: AbortSignal): Promise<Success> {
    if (signal?.aborted) return Promise.reject(new Error(RENDER_CANCELLED));
    const { id, done } = this.start(req);
    if (!signal) return done;
    const onAbort = () => this.worker.postMessage({ type: 'cancel', id: 0, ids: [id] });
    signal.addEventListener('abort', onAbort, { once: true });
    return done.finally(() => signal.removeEventListener('abort', onAbort));
  }

  /** @internal */
  async renderTile(req: TileRequest, signal?: AbortSignal): Promise<RenderResult> {
    const res = await this.cancellable({ type: 'render', ...req }, signal);
    if (res.type !== 'render') throw new Error('Unexpected response');
    const { id: _, ok: __, type: ___, ...result } = res;
    return result;
  }

  /** @internal */
  async documentBytes(docId: number): Promise<ArrayBuffer> {
    const res = await this.call({ type: 'bytes', docId });
    if (res.type !== 'bytes') throw new Error('Unexpected response');
    return res.bytes;
  }

  /** @internal */
  async setRenderCopy(docId: number, bytes: ArrayBuffer | null, keepChecked = false): Promise<void> {
    await this.call({ type: 'setRenderCopy', docId, bytes, keepChecked }, bytes ? [bytes] : []);
  }

  /** @internal */
  async checkCopy(docId: number, pageIndex: number, signal?: AbortSignal): Promise<CopyCheck> {
    const res = await this.cancellable({ type: 'checkCopy', docId, pageIndex }, signal);
    if (res.type !== 'checkCopy') throw new Error('Unexpected response');
    return res.check;
  }

  /** @internal */
  async pageGeometry(docId: number, pageIndex: number): Promise<{ segments: Float32Array; curves: Uint8Array; paper: Uint8Array; ms: number }> {
    const res = await this.call({ type: 'geometry', docId, pageIndex });
    if (res.type !== 'geometry') throw new Error('Unexpected response');
    return { segments: res.segments, curves: res.curves, paper: res.paper, ms: res.ms };
  }

  /** @internal */
  async pageText(docId: number, pageIndex: number): Promise<TextWord[]> {
    const res = await this.call({ type: 'text', docId, pageIndex });
    if (res.type !== 'text') throw new Error('Unexpected response');
    return res.words;
  }

  /** @internal */
  async pageAnnotations(docId: number, pageIndex: number): Promise<PdfAnnotation[]> {
    const res = await this.call({ type: 'annotations', docId, pageIndex });
    if (res.type !== 'annotations') throw new Error('Unexpected response');
    return res.annotations;
  }

  /** @internal */
  async pageLabels(docId: number): Promise<(string | null)[]> {
    const res = await this.call({ type: 'pageLabels', docId });
    if (res.type !== 'pageLabels') throw new Error('Unexpected response');
    return res.labels;
  }

  /** @internal */
  async annotImage(docId: number, pageIndex: number, index: number, scale: number): Promise<AnnotImage | null> {
    const res = await this.call({ type: 'annotImage', docId, pageIndex, index, scale });
    if (res.type !== 'annotImage') throw new Error('Unexpected response');
    return res.image;
  }

  /** @internal */
  async hideAnnotations(docId: number, pageIndex: number, indices: number[]): Promise<void> {
    await this.call({ type: 'hideAnnots', docId, pageIndex, indices });
  }

  /** @internal */
  async closeDoc(docId: number): Promise<void> {
    for (const d of this.docs) if (d.id === docId) this.docs.delete(d);
    await this.call({ type: 'close', docId });
  }

  terminate() {
    this.shutDown = true;
    this.fail(new Error('The PDF engine was shut down'), false);
  }
}

export class PdfDocument {
  /** Annotations hidden from drawing, by page, to hide again when the document is reopened. */
  readonly hiddenAnnotations = new Map<number, number[]>();

  constructor(
    private engine: PdfEngine,
    private docId: number,
    readonly pages: readonly PageSize[],
  ) {}

  /** The document's handle in the worker; it changes if the engine restarts. */
  get id(): number {
    return this.docId;
  }

  /** @internal */
  rebind(docId: number) {
    this.docId = docId;
  }

  /**
   * Renders a device-pixel region of a page at `scale` device pixels per PDF point. Aborting
   * `signal` stops it (it then rejects with RENDER_CANCELLED).
   */
  renderTile(pageIndex: number, scale: number, x: number, y: number, width: number, height: number, options: { thinLines?: boolean; transparent?: boolean; copy?: boolean; priority?: number; signal?: AbortSignal } = {}) {
    const { signal, ...rest } = options;
    return this.engine.renderTile({ docId: this.id, pageIndex, scale, x, y, width, height, ...rest }, signal);
  }

  /** A copy of the file as this document was opened from it. */
  bytes() {
    return this.engine.documentBytes(this.id);
  }

  /**
   * Draws pages from `bytes`, an optimised copy of this file with the same pages, once
   * `checkCopy` passed for them and only for renders that ask (`copy`); null stops using any copy.
   * `bytes` is transferred. Everything else (text, geometry, annotations, saving) uses the original.
   * `keepChecked`: `bytes` extends the copy in use, so pages already checked stay checked.
   */
  setRenderCopy(bytes: ArrayBuffer | null, keepChecked = false) {
    return this.engine.setRenderCopy(this.id, bytes, keepChecked);
  }

  /** Compares a page drawn from the render copy with the original; one that matches is drawn from the copy. */
  checkCopy(pageIndex: number, signal?: AbortSignal) {
    return this.engine.checkCopy(this.id, pageIndex, signal);
  }

  /**
   * Vector line work on a page as flat [x1, y1, x2, y2, ...] segments in page space (points,
   * top-left origin, rotation applied). Curves are flattened; `curves` flags (1 per segment) the
   * segments that came from one, and `paper` those of paths that paint nothing on white paper (white
   * masks under labels, clipping outlines). Used for snapping and vector compare.
   */
  geometry(pageIndex: number) {
    return this.engine.pageGeometry(this.id, pageIndex);
  }

  /** Words on a page with positions in page space. Empty for scanned pages without a text layer. */
  text(pageIndex: number) {
    return this.engine.pageText(this.id, pageIndex);
  }

  /** Existing annotations on a page (markups, links, form widgets, ...). */
  annotations(pageIndex: number) {
    return this.engine.pageAnnotations(this.id, pageIndex);
  }

  /**
   * Stops PDFium drawing these annotations (by /Annots index), in memory only: used once they are
   * imported as editable markups, which draw themselves. Applies to tiles rendered afterwards.
   */
  hideAnnotations(pageIndex: number, indices: number[]) {
    this.hiddenAnnotations.set(pageIndex, [...new Set([...(this.hiddenAnnotations.get(pageIndex) ?? []), ...indices])]);
    return this.engine.hideAnnotations(this.id, pageIndex, indices);
  }

  /** Title, author and other /Info entries, PDF version and security. */
  info() {
    return this.engine.documentInfo(this.id);
  }

  /** The text object under a page-space point, for Edit Text. */
  textObjectAt(pageIndex: number, x: number, y: number) {
    return this.engine.textObjectAt(this.id, pageIndex, x, y);
  }

  /** Each page's label from the PDF's /PageLabels, or null where it has none. */
  pageLabels() {
    return this.engine.pageLabels(this.id);
  }

  /** One annotation's own appearance as pixels, at `scale` pixels per point. */
  annotationImage(pageIndex: number, index: number, scale = 3) {
    return this.engine.annotImage(this.id, pageIndex, index, scale);
  }

  /** The PDF's bookmarks (outline) as a tree. */
  outline() {
    return this.engine.outline(this.id);
  }

  close() {
    return this.engine.closeDoc(this.id);
  }
}
