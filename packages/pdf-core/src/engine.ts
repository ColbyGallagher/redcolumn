import type { AnnotImage, DocumentInfo, OutlineItem, RedactReport, RedactRequest, TextObjectInfo, PageOp, PageSize, PdfAnnotation, TextWord, TileRequest, WorkerRequest, WorkerResponse } from './protocol';

type Success = Extract<WorkerResponse, { ok: true }>;
type Pending = { resolve: (v: Success) => void; reject: (e: Error) => void };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Promise-based client for the PDFium render worker. */
export class PdfEngine {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private failure: Error | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(msg.error));
    };
    // A worker that crashed (or ran out of memory) never answers: every waiting call fails instead.
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.fail(new Error(`The PDF engine stopped: ${e.message || 'worker error'}`));
    };
    this.worker.onmessageerror = () => this.fail(new Error('The PDF engine sent a message that could not be read'));
  }

  /** False once the worker has failed or been terminated; a dead engine rejects every call. */
  get alive(): boolean {
    return !this.failure;
  }

  private fail(err: Error) {
    if (this.failure) return;
    this.failure = err;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private call(req: WithoutId<WorkerRequest>, transfer: Transferable[] = []): Promise<Success> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }

  /** Opens a PDF. `bytes` is transferred to the worker and unusable afterwards. */
  async open(bytes: ArrayBuffer, password?: string): Promise<PdfDocument> {
    const res = await this.call({ type: 'open', bytes, password }, [bytes]);
    if (res.type !== 'open') throw new Error('Unexpected response');
    return new PdfDocument(this, res.docId, res.pages);
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
   * is transferred.
   */
  async redact(bytes: ArrayBuffer, request: RedactRequest): Promise<{ bytes: ArrayBuffer; report: RedactReport }> {
    const res = await this.call({ type: 'redact', bytes, ...request }, [bytes]);
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

  /** @internal */
  async renderTile(req: TileRequest): Promise<{ bitmap: ImageBitmap; ms: number }> {
    const res = await this.call({ type: 'render', ...req });
    if (res.type !== 'render') throw new Error('Unexpected response');
    return { bitmap: res.bitmap, ms: res.ms };
  }

  /** @internal */
  async pageGeometry(docId: number, pageIndex: number): Promise<{ segments: Float32Array; ms: number }> {
    const res = await this.call({ type: 'geometry', docId, pageIndex });
    if (res.type !== 'geometry') throw new Error('Unexpected response');
    return { segments: res.segments, ms: res.ms };
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
    await this.call({ type: 'close', docId });
  }

  terminate() {
    this.fail(new Error('The PDF engine was shut down'));
  }
}

export class PdfDocument {
  constructor(
    private engine: PdfEngine,
    readonly id: number,
    readonly pages: readonly PageSize[],
  ) {}

  /** Renders a device-pixel region of a page at `scale` device pixels per PDF point. */
  renderTile(pageIndex: number, scale: number, x: number, y: number, width: number, height: number, options: { thinLines?: boolean; transparent?: boolean } = {}) {
    return this.engine.renderTile({ docId: this.id, pageIndex, scale, x, y, width, height, ...options });
  }

  /**
   * Vector line work on a page as flat [x1, y1, x2, y2, ...] segments in page space (points,
   * top-left origin, rotation applied). Curves are flattened. Used for snapping and vector compare.
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
