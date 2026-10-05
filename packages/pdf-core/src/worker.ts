/// <reference lib="webworker" />
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { APP_DATA_KEY, NEEDS_PASSWORD, type DocumentInfo, type OutlineItem, type PageOp, type RedactReport, type RedactRequest, type TextObjectInfo, type PageSize, type PdfAnnotation, type TextWord, type TileRequest, type WorkerRequest, type WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const FPDFBitmap_BGRA = 4;
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;
const FPDF_THIN_LINE = 0x20;
const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_FORM = 5;
const FPDF_SEGMENT_LINETO = 0;
const FPDF_SEGMENT_BEZIERTO = 1;
const FPDF_SEGMENT_MOVETO = 2;
/** Line segments each Bézier curve is flattened into. */
const CURVE_STEPS = 8;
/** Upper bound on extracted segments per page (~32 MB); beyond this snapping is not useful anyway. */
const MAX_SEGMENTS = 2_000_000;
/** Parsed pages kept open per document; re-parsing heavy sheets dominates tile render cost. */
const PAGE_CACHE_SIZE = 6;

interface OpenDoc {
  handle: number;
  /** The file, kept in JS memory (outside the 2 GB wasm heap) and read by PDFium on demand. */
  bytes: ArrayBuffer;
  password: string;
  /** Frees what `FPDF_LoadCustomDocument` needs for as long as the document is open. */
  release: () => void;
  /** Which wasm instance `handle` belongs to; a document from an aborted one is reopened. */
  epoch: number;
  /** pageIndex -> page handle; Map insertion order doubles as LRU order. */
  pages: Map<number, number>;
  /** Pages in use while others are loaded (annotations whose links point at other pages): never closed to make room. */
  pinned: Set<number>;
  /** Annotations (by /Annots index) not to draw, applied whenever the page is loaded. */
  hidden: Map<number, Set<number>>;
  /** Form-fill environment, so form fields (widgets) are drawn; 0 when PDFium couldn't make one. */
  form: number;
  formInfo: number;
}

const ANNOT_SUBTYPES = ['Unknown', 'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment', 'Sound', 'Movie', 'Widget', 'Screen', 'PrinterMark', 'TrapNet', 'Watermark', 'ThreeD', 'RichMedia', 'XFAWidget', 'Redact'];
const ANNOT_SQUARE = 5;
const ANNOT_FLAG_HIDDEN = 2;
const PDFDEST_VIEW_FITR = 5;
const PDFACTION_GOTO = 1;
const PDFACTION_REMOTEGOTO = 2;
const PDFACTION_URI = 3;
const PDFACTION_LAUNCH = 4;
/** AutoCAD writes SHX-font text as strokes plus invisible annotations carrying the actual text. */
const SHX_AUTHOR = 'AutoCAD SHX Text';

let libPromise: Promise<WrappedPdfiumModule> | null = null;
let current: WrappedPdfiumModule | null = null;
/** Bumped each time the wasm instance is replaced after an abort. */
let epoch = 0;
const docs = new Map<number, OpenDoc>();
let nextDocId = 1;

function lib(): Promise<WrappedPdfiumModule> {
  libPromise ??= (async () => {
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    const m = await init({ wasmBinary });
    m.PDFiumExt_Init();
    current = m;
    return m;
  })();
  return libPromise;
}

/**
 * An aborted wasm instance (out of memory, a trap) is unusable for good: the next call starts a
 * fresh one, and documents are reopened in it from their bytes when next used.
 */
function isAbort(err: unknown): boolean {
  return /Aborted\(|RuntimeError|memory access out of bounds|unreachable/.test(err instanceof Error ? `${err.name} ${err.message}` : String(err));
}

function resetLib() {
  libPromise = null;
  current = null;
  epoch++;
}

function getDoc(docId: number): OpenDoc {
  const doc = docs.get(docId);
  if (!doc) throw new Error(`Unknown document ${docId}`);
  if (doc.epoch !== epoch && current) {
    // The old instance is gone with everything in it, so nothing is closed or freed there.
    const fresh = openHandle(current, doc.bytes, doc.password);
    doc.handle = fresh.handle;
    doc.release = fresh.release;
    doc.form = fresh.form;
    doc.formInfo = fresh.formInfo;
    doc.epoch = epoch;
    doc.pages = new Map();
    doc.pinned = new Set();
  }
  return doc;
}

function getPage(m: WrappedPdfiumModule, doc: OpenDoc, pageIndex: number): number {
  const cached = doc.pages.get(pageIndex);
  if (cached !== undefined) {
    doc.pages.delete(pageIndex);
    doc.pages.set(pageIndex, cached);
    return cached;
  }
  const page = m.FPDF_LoadPage(doc.handle, pageIndex);
  if (!page) throw new Error(`Failed to load page ${pageIndex}`);
  applyHidden(m, page, doc.hidden.get(pageIndex));
  if (doc.form) m.FORM_OnAfterLoadPage(page, doc.form);
  doc.pages.set(pageIndex, page);
  if (doc.pages.size > PAGE_CACHE_SIZE) {
    // The least recently used page that is not in use: closing one in use would leave its
    // annotation handles dangling, and PDFium then crashes (table index out of bounds).
    for (const [oldIndex, oldPage] of doc.pages) {
      if (oldIndex === pageIndex || doc.pinned.has(oldIndex)) continue;
      if (doc.form) m.FORM_OnBeforeClosePage(oldPage, doc.form);
      m.FPDF_ClosePage(oldPage);
      doc.pages.delete(oldIndex);
      break;
    }
  }
  return page;
}

/**
 * Opens a document that PDFium reads from `bytes` block by block. Copying a large file into the
 * wasm heap (capped at 2 GB) leaves too little room to render; a 500 MB drawing set aborts it.
 */
function openHandle(m: WrappedPdfiumModule, bytes: ArrayBuffer, password: string) {
  const { malloc, free } = m.pdfium.wasmExports;
  const view = new Uint8Array(bytes);
  // int GetBlock(void* param, unsigned long position, unsigned char* buf, unsigned long size)
  const getBlock = m.pdfium.addFunction((_param: number, position: number, buf: number, size: number) => {
    position >>>= 0;
    size >>>= 0;
    if (position + size > view.length) return 0;
    m.pdfium.HEAPU8.set(view.subarray(position, position + size), buf);
    return 1;
  }, 'iiiii');
  // FPDF_FILEACCESS: file length, block callback, caller parameter.
  const access = malloc(12);
  m.pdfium.HEAPU32.set([bytes.byteLength, getBlock, 0], access >> 2);
  const release = () => {
    m.pdfium.removeFunction(getBlock);
    free(access);
  };
  const handle = m.FPDF_LoadCustomDocument(access, password);
  if (!handle) {
    const error = m.FPDF_GetLastError();
    release();
    // FPDF_ERR_PASSWORD
    if (error === 4) throw new Error(NEEDS_PASSWORD);
    throw new Error(`PDFium failed to open document (error ${error})`);
  }
  // Form fields are only drawn through a form-fill environment (FPDF_FFLDraw).
  const formInfo = m.PDFiumExt_OpenFormFillInfo();
  const form = formInfo ? m.PDFiumExt_InitFormFillEnvironment(handle, formInfo) : 0;
  return { handle, release, form, formInfo };
}

async function open(bytes: ArrayBuffer, password = ''): Promise<{ docId: number; pages: PageSize[] }> {
  const m = await lib();
  const { malloc, free } = m.pdfium.wasmExports;
  const { handle, release, form, formInfo } = openHandle(m, bytes, password);

  const count = m.FPDF_GetPageCount(handle);
  const sizePtr = malloc(8);
  const pages: PageSize[] = [];
  for (let i = 0; i < count; i++) {
    m.FPDF_GetPageSizeByIndexF(handle, i, sizePtr);
    // Read HEAPF32 after each call: wasm memory growth replaces the typed array.
    const f32 = m.pdfium.HEAPF32;
    pages.push({ width: f32[sizePtr >> 2]!, height: f32[(sizePtr >> 2) + 1]! });
  }
  free(sizePtr);

  const docId = nextDocId++;
  docs.set(docId, { handle, bytes, password, release, epoch, pages: new Map(), pinned: new Set(), hidden: new Map(), form, formInfo });
  return { docId, pages };
}

/** Loads a document for one-off editing; the caller must close it and free `ptr`. */
function loadForEdit(m: WrappedPdfiumModule, bytes: ArrayBuffer): { handle: number; ptr: number } {
  const ptr = m.pdfium.wasmExports.malloc(bytes.byteLength);
  m.pdfium.HEAPU8.set(new Uint8Array(bytes), ptr);
  const handle = m.FPDF_LoadMemDocument(ptr, bytes.byteLength, '');
  if (!handle) {
    m.pdfium.wasmExports.free(ptr);
    throw new Error(`PDFium failed to open document (error ${m.FPDF_GetLastError()})`);
  }
  return { handle, ptr };
}

/** FPDF_SaveAsCopy flags: append to the original file; write without the document's encryption. */
const FPDF_INCREMENTAL = 1;
const FPDF_REMOVE_SECURITY = 3;

/**
 * 'auto' appends the changes to a signed file (an incremental update) so its signatures stay
 * valid, and rewrites anything else; 'rewrite' always writes a new file, for edits whose point is
 * that removed content is gone from the bytes.
 */
type SaveMode = 'auto' | 'rewrite';

function saveDocument(m: WrappedPdfiumModule, handle: number, mode: SaveMode | number = 'auto'): ArrayBuffer {
  const { malloc, free } = m.pdfium.wasmExports;
  const writer = m.PDFiumExt_OpenFileWriter();
  const flags = typeof mode === 'number' ? mode : mode === 'auto' && m.FPDF_GetSignatureCount(handle) > 0 ? FPDF_INCREMENTAL : undefined;
  try {
    const saved = flags === undefined ? m.PDFiumExt_SaveAsCopy(handle, writer) : m.FPDF_SaveAsCopy(handle, writer, flags);
    if (!saved) throw new Error('Saving the PDF failed');
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const buf = malloc(size);
    try {
      m.PDFiumExt_GetFileWriterData(writer, buf, size);
      return m.pdfium.HEAPU8.slice(buf, buf + size).buffer;
    } finally {
      free(buf);
    }
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}

function withIndices<T>(m: WrappedPdfiumModule, indices: number[], fn: (ptr: number) => T): T {
  const ptr = m.pdfium.wasmExports.malloc(Math.max(4, indices.length * 4));
  try {
    m.pdfium.HEAP32.set(indices, ptr >> 2);
    return fn(ptr);
  } finally {
    m.pdfium.wasmExports.free(ptr);
  }
}

async function editPdf(bytes: ArrayBuffer, ops: PageOp[], inserts: ArrayBuffer[], mode: SaveMode): Promise<ArrayBuffer> {
  const m = await lib();
  const doc = loadForEdit(m, bytes);
  const sources = inserts.map((b) => loadForEdit(m, b));
  try {
    for (const op of ops) {
      const count = m.FPDF_GetPageCount(doc.handle);
      const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < count;
      if ('pages' in op && !op.pages.every(valid)) throw new Error(`Page out of range in ${op.type}`);
      switch (op.type) {
        case 'rotate':
          for (const i of op.pages) {
            const page = m.FPDF_LoadPage(doc.handle, i);
            m.FPDFPage_SetRotation(page, (((m.FPDFPage_GetRotation(page) + op.quarterTurns) % 4) + 4) % 4);
            m.FPDF_ClosePage(page);
          }
          break;
        case 'delete':
          for (const i of [...new Set(op.pages)].sort((a, b) => b - a)) m.FPDFPage_Delete(doc.handle, i);
          break;
        case 'move':
          if (!withIndices(m, op.pages, (ptr) => m.FPDF_MovePages(doc.handle, ptr, op.pages.length, op.to))) throw new Error('Moving pages failed');
          break;
        case 'insert': {
          const src = sources[op.source];
          if (!src) throw new Error('Missing inserted document');
          if (!m.FPDF_ImportPagesByIndex(doc.handle, src.handle, 0, 0, Math.min(op.at, count))) throw new Error('Inserting pages failed');
          break;
        }
        case 'blank':
          addBlankPages(m, doc.handle, Math.min(op.at, count), op.count, op.width, op.height);
          break;
      }
    }
    return saveDocument(m, doc.handle, mode);
  } finally {
    for (const d of [doc, ...sources]) {
      m.FPDF_CloseDocument(d.handle);
      m.pdfium.wasmExports.free(d.ptr);
    }
  }
}

function addBlankPages(m: WrappedPdfiumModule, handle: number, at: number, count: number, width: number, height: number) {
  if (!(width > 0 && height > 0) || !Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Invalid blank page size or count');
  for (let i = 0; i < count; i++) {
    const page = m.FPDFPage_New(handle, at + i, width, height);
    if (!page) throw new Error('Adding a blank page failed');
    m.FPDF_ClosePage(page);
  }
}

/** A new PDF of blank pages. */
async function createPdf(pages: PageSize[]): Promise<ArrayBuffer> {
  const m = await lib();
  if (!pages.length) throw new Error('A new PDF needs at least one page');
  const out = m.FPDF_CreateNewDocument();
  try {
    pages.forEach((p, i) => addBlankPages(m, out, i, 1, p.width, p.height));
    return saveDocument(m, out);
  } finally {
    m.FPDF_CloseDocument(out);
  }
}

/** A document information entry (/Info), decoded from UTF-16. */
function metaText(m: WrappedPdfiumModule, handle: number, tag: string): string {
  const { malloc, free } = m.pdfium.wasmExports;
  const needed = m.FPDF_GetMetaText(handle, tag, 0, 0);
  if (needed <= 2) return '';
  const buf = malloc(needed);
  try {
    m.FPDF_GetMetaText(handle, tag, buf, needed);
    return m.pdfium.UTF16ToString(buf);
  } finally {
    free(buf);
  }
}

async function documentInfo(docId: number): Promise<DocumentInfo> {
  const m = await lib();
  const { handle } = getDoc(docId);
  const ptr = m.pdfium.wasmExports.malloc(4);
  let version = 0;
  try {
    if (m.FPDF_GetFileVersion(handle, ptr)) version = m.pdfium.HEAP32[ptr >> 2]!;
  } finally {
    m.pdfium.wasmExports.free(ptr);
  }
  return {
    title: metaText(m, handle, 'Title'),
    author: metaText(m, handle, 'Author'),
    subject: metaText(m, handle, 'Subject'),
    keywords: metaText(m, handle, 'Keywords'),
    creator: metaText(m, handle, 'Creator'),
    producer: metaText(m, handle, 'Producer'),
    creationDate: metaText(m, handle, 'CreationDate'),
    modDate: metaText(m, handle, 'ModDate'),
    version,
    securityRevision: m.FPDF_GetSecurityHandlerRevision(handle),
    permissions: m.FPDF_GetDocPermissions(handle) >>> 0,
    signatures: Math.max(0, m.FPDF_GetSignatureCount(handle)),
  };
}

/**
 * Removes a PDF's security: opened with the password (none for files with only permissions set),
 * saved again without encryption. Null when the file was not encrypted.
 */
async function unlock(bytes: ArrayBuffer, password: string): Promise<ArrayBuffer | null> {
  const m = await lib();
  const ptr = m.pdfium.wasmExports.malloc(bytes.byteLength);
  m.pdfium.HEAPU8.set(new Uint8Array(bytes), ptr);
  const handle = m.FPDF_LoadMemDocument(ptr, bytes.byteLength, password);
  if (!handle) {
    const error = m.FPDF_GetLastError();
    m.pdfium.wasmExports.free(ptr);
    // FPDF_ERR_PASSWORD
    if (error === 4) throw new Error(NEEDS_PASSWORD);
    throw new Error(`PDFium failed to open document (error ${error})`);
  }
  try {
    if (m.FPDF_GetSecurityHandlerRevision(handle) < 0) return null;
    return saveDocument(m, handle, FPDF_REMOVE_SECURITY);
  } finally {
    m.FPDF_CloseDocument(handle);
    m.pdfium.wasmExports.free(ptr);
  }
}

async function extractPages(bytes: ArrayBuffer, pages: number[]): Promise<ArrayBuffer> {
  const m = await lib();
  const src = loadForEdit(m, bytes);
  const out = m.FPDF_CreateNewDocument();
  try {
    if (!withIndices(m, pages, (ptr) => m.FPDF_ImportPagesByIndex(out, src.handle, ptr, pages.length, 0))) throw new Error('Extracting pages failed');
    return saveDocument(m, out);
  } finally {
    m.FPDF_CloseDocument(out);
    m.FPDF_CloseDocument(src.handle);
    m.pdfium.wasmExports.free(src.ptr);
  }
}

async function close(docId: number): Promise<void> {
  const m = await lib();
  const doc = docs.get(docId);
  if (!doc) return;
  if (doc.epoch !== epoch) {
    // Belonged to an aborted instance: nothing of it is left to close.
    docs.delete(docId);
    return;
  }
  for (const page of doc.pages.values()) {
    if (doc.form) m.FORM_OnBeforeClosePage(page, doc.form);
    m.FPDF_ClosePage(page);
  }
  if (doc.form) m.PDFiumExt_ExitFormFillEnvironment(doc.form);
  if (doc.formInfo) m.PDFiumExt_CloseFormFillInfo(doc.formInfo);
  m.FPDF_CloseDocument(doc.handle);
  doc.release();
  docs.delete(docId);
}

async function render(req: TileRequest): Promise<{ bitmap: ImageBitmap; ms: number }> {
  const t0 = performance.now();
  const m = await lib();
  const page = getPage(m, getDoc(req.docId), req.pageIndex);
  const { width: w, height: h } = req;

  const bitmap = m.FPDFBitmap_CreateEx(w, h, FPDFBitmap_BGRA, 0, 0);
  if (!bitmap) throw new Error('Failed to allocate bitmap');
  try {
    m.FPDFBitmap_FillRect(bitmap, 0, 0, w, h, req.transparent ? 0x00ffffff : 0xffffffff);
    // Lay the whole page out at `scale`, shifted so the tile origin lands at (0, 0); PDFium
    // clips to the bitmap. (FPDF_RenderPageBitmapWithMatrix traps in this wasm build.)
    const size = pageSizePx(m, page, req.scale);
    const flags = FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER | (req.thinLines ? FPDF_THIN_LINE : 0);
    m.FPDF_RenderPageBitmap(bitmap, page, -req.x, -req.y, size.w, size.h, 0, flags);
    // Form fields on top, as PDFium draws them only here.
    const form = getDoc(req.docId).form;
    if (form) m.FPDF_FFLDraw(form, bitmap, page, -req.x, -req.y, size.w, size.h, 0, flags);

    const stride = m.FPDFBitmap_GetStride(bitmap);
    const buf = m.FPDFBitmap_GetBuffer(bitmap);
    const heap = m.pdfium.HEAPU8;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      rgba.set(heap.subarray(buf + row * stride, buf + row * stride + w * 4), row * w * 4);
    }
    const image = await createImageBitmap(new ImageData(rgba, w, h));
    return { bitmap: image, ms: performance.now() - t0 };
  } finally {
    m.FPDFBitmap_Destroy(bitmap);
  }
}

/** Affine [a b c d e f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
type Matrix = [number, number, number, number, number, number];

/** Returns the matrix that applies `m` first, then `n`. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** PDF user space → page space (top-left origin, y down, rotation applied), derived from PDFium. */
function userToPageMatrix(m: WrappedPdfiumModule, page: number): Matrix {
  const { malloc, free } = m.pdfium.wasmExports;
  // FPDF_PageToDevice works in integer device pixels; lay the page out 1000x larger for precision.
  const K = 1000;
  const w = Math.round(m.FPDF_GetPageWidthF(page) * K);
  const h = Math.round(m.FPDF_GetPageHeightF(page) * K);
  const out = malloc(8);
  const toDevice = (x: number, y: number): [number, number] => {
    m.FPDF_PageToDevice(page, 0, 0, w, h, 0, x, y, out, out + 4);
    const i32 = m.pdfium.HEAP32;
    return [i32[out >> 2]! / K, i32[(out >> 2) + 1]! / K];
  };
  const o = toDevice(0, 0);
  const ex = toDevice(1000, 0);
  const ey = toDevice(0, 1000);
  free(out);
  return [(ex[0] - o[0]) / 1000, (ex[1] - o[1]) / 1000, (ey[0] - o[0]) / 1000, (ey[1] - o[1]) / 1000, o[0], o[1]];
}

function extractSegments(m: WrappedPdfiumModule, page: number): Float32Array {
  const { malloc, free } = m.pdfium.wasmExports;
  const matPtr = malloc(24);
  const ptPtr = malloc(8);
  const out: number[] = [];
  const f32 = () => m.pdfium.HEAPF32;

  const objMatrix = (obj: number): Matrix => {
    if (!m.FPDFPageObj_GetMatrix(obj, matPtr)) return [1, 0, 0, 1, 0, 0];
    const h = f32();
    const i = matPtr >> 2;
    return [h[i]!, h[i + 1]!, h[i + 2]!, h[i + 3]!, h[i + 4]!, h[i + 5]!];
  };

  const walkPath = (path: number, t: Matrix) => {
    const n = m.FPDFPath_CountSegments(path);
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    const bez: number[] = [];
    const push = (x1: number, y1: number, x2: number, y2: number) => {
      if (x1 !== x2 || y1 !== y2) out.push(x1, y1, x2, y2);
    };
    for (let i = 0; i < n && out.length < MAX_SEGMENTS * 4; i++) {
      const seg = m.FPDFPath_GetPathSegment(path, i);
      if (!seg || !m.FPDFPathSegment_GetPoint(seg, ptPtr, ptPtr + 4)) continue;
      const h = f32();
      const px = h[ptPtr >> 2]!;
      const py = h[(ptPtr >> 2) + 1]!;
      const x = t[0] * px + t[2] * py + t[4];
      const y = t[1] * px + t[3] * py + t[5];
      const type = m.FPDFPathSegment_GetType(seg);
      if (type === FPDF_SEGMENT_MOVETO) {
        cx = sx = x;
        cy = sy = y;
      } else if (type === FPDF_SEGMENT_LINETO) {
        push(cx, cy, x, y);
        cx = x;
        cy = y;
      } else if (type === FPDF_SEGMENT_BEZIERTO) {
        // A curve arrives as three consecutive points: two control points, then the end point.
        bez.push(x, y);
        if (bez.length === 6) {
          const [x1, y1, x2, y2, x3, y3] = bez as [number, number, number, number, number, number];
          let lx = cx;
          let ly = cy;
          for (let s = 1; s <= CURVE_STEPS; s++) {
            const u = s / CURVE_STEPS;
            const v = 1 - u;
            const bx = v * v * v * cx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3;
            const by = v * v * v * cy + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3;
            push(lx, ly, bx, by);
            lx = bx;
            ly = by;
          }
          cx = x3;
          cy = y3;
          bez.length = 0;
        }
      }
      if (m.FPDFPathSegment_GetClose(seg)) {
        push(cx, cy, sx, sy);
        cx = sx;
        cy = sy;
      }
    }
  };

  const walk = (obj: number, parent: Matrix) => {
    const type = m.FPDFPageObj_GetType(obj);
    if (type === FPDF_PAGEOBJ_PATH) {
      walkPath(obj, multiply(objMatrix(obj), parent));
    } else if (type === FPDF_PAGEOBJ_FORM) {
      // Children are positioned relative to the form, which is positioned by its own matrix.
      const t = multiply(objMatrix(obj), parent);
      const count = m.FPDFFormObj_CountObjects(obj);
      for (let i = 0; i < count; i++) walk(m.FPDFFormObj_GetObject(obj, i), t);
    }
  };

  try {
    const pageMatrix = userToPageMatrix(m, page);
    const count = m.FPDFPage_CountObjects(page);
    for (let i = 0; i < count && out.length < MAX_SEGMENTS * 4; i++) walk(m.FPDFPage_GetObject(page, i), pageMatrix);
  } finally {
    free(matPtr);
    free(ptPtr);
  }
  return new Float32Array(out);
}

function applyHidden(m: WrappedPdfiumModule, page: number, indices: Set<number> | undefined) {
  if (!indices) return;
  for (const i of indices) {
    const annot = m.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    m.FPDFAnnot_SetFlags(annot, m.FPDFAnnot_GetFlags(annot) | ANNOT_FLAG_HIDDEN);
    m.FPDFPage_CloseAnnot(annot);
  }
}

/** Reads a string key of an annotation dictionary (UTF-16 via PDFium). */
function annotString(m: WrappedPdfiumModule, annot: number, key: string): string {
  const { malloc, free } = m.pdfium.wasmExports;
  const needed = m.FPDFAnnot_GetStringValue(annot, key, 0, 0);
  if (needed <= 2) return '';
  const buf = malloc(needed);
  try {
    m.FPDFAnnot_GetStringValue(annot, key, buf, needed);
    return m.pdfium.UTF16ToString(buf);
  } finally {
    free(buf);
  }
}

/** A FileAttachment annotation's embedded file: its name and bytes. */
function annotFile(m: WrappedPdfiumModule, annot: number): { name: string; data: Uint8Array } | null {
  const att = m.FPDFAnnot_GetFileAttachment(annot);
  if (!att) return null;
  const { malloc, free } = m.pdfium.wasmExports;
  const nameLen = m.FPDFAttachment_GetName(att, 0, 0);
  let name = 'attachment';
  if (nameLen > 2) {
    const buf = malloc(nameLen);
    try {
      m.FPDFAttachment_GetName(att, buf, nameLen);
      name = m.pdfium.UTF16ToString(buf) || name;
    } finally {
      free(buf);
    }
  }
  const lenPtr = malloc(8);
  try {
    if (!m.FPDFAttachment_GetFile(att, 0, 0, lenPtr)) return { name, data: new Uint8Array() };
    const len = m.pdfium.HEAPU32[lenPtr >> 2]!;
    const buf = malloc(Math.max(1, len));
    try {
      m.FPDFAttachment_GetFile(att, buf, len, lenPtr);
      return { name, data: m.pdfium.HEAPU8.slice(buf, buf + len) };
    } finally {
      free(buf);
    }
  } finally {
    free(lenPtr);
  }
}

/**
 * An annotation's /C (type 0) or /IC (type 1) colour. PDFium's own getter gives up once an
 * appearance stream exists (and it generates one for most markups on load), so EmbedPDF's reader
 * of the dictionary entry comes first.
 */
function annotColor(m: WrappedPdfiumModule, annot: number, type: 0 | 1, ptr: number): string | null {
  const u = m.pdfium.HEAPU32;
  const i = ptr >> 2;
  const hex = () => '#' + [u[i]!, u[i + 1]!, u[i + 2]!].map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
  if (m.EPDFAnnot_GetColor(annot, type, ptr, ptr + 4, ptr + 8)) return hex();
  if (!m.FPDFAnnot_GetColor(annot, type, ptr, ptr + 4, ptr + 8, ptr + 12)) return null;
  return hex();
}

/** Constant opacity (/CA), 0..1. */
function annotOpacity(m: WrappedPdfiumModule, annot: number, ptr: number): number {
  if (m.EPDFAnnot_GetOpacity(annot, ptr)) return m.pdfium.HEAPU32[ptr >> 2]! / 255;
  return m.FPDFAnnot_GetNumberValue(annot, 'CA', ptr) ? m.pdfium.HEAPF32[ptr >> 2]! : 1;
}

/** Line width from the border style (/BS /W), else the older /Border array, else 1. */
function annotBorderWidth(m: WrappedPdfiumModule, annot: number, ptr: number): number {
  if (m.EPDFAnnot_GetBorderStyle(annot, ptr)) return m.pdfium.HEAPF32[ptr >> 2]!;
  return m.FPDFAnnot_GetBorder(annot, ptr, ptr + 4, ptr + 8) ? m.pdfium.HEAPF32[(ptr >> 2) + 2]! : 1;
}

/** EmbedPDF's blend mode code for Multiply. */
const BLEND_MULTIPLY = 1;

/** Annotation rect in page space. */
function annotRect(m: WrappedPdfiumModule, annot: number, ptr: number, t: Matrix) {
  if (!m.FPDFAnnot_GetRect(annot, ptr)) return null;
  const f = m.pdfium.HEAPF32;
  const i = ptr >> 2;
  // FS_RECTF is left, top, right, bottom in PDF user space.
  const a = applyMatrix(t, f[i]!, f[i + 1]!);
  const b = applyMatrix(t, f[i + 2]!, f[i + 3]!);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

function applyMatrix(t: Matrix, x: number, y: number): [number, number] {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

/** Reads FS_POINTF arrays through a PDFium "count, then fill" call. */
function readPoints(m: WrappedPdfiumModule, t: Matrix, get: (buf: number, count: number) => number): [number, number][] {
  const count = get(0, 0);
  if (count <= 0) return [];
  const { malloc, free } = m.pdfium.wasmExports;
  const buf = malloc(count * 8);
  try {
    get(buf, count);
    const f = m.pdfium.HEAPF32;
    const out: [number, number][] = [];
    for (let k = 0; k < count; k++) out.push(applyMatrix(t, f[(buf >> 2) + k * 2]!, f[(buf >> 2) + k * 2 + 1]!));
    return out;
  } finally {
    free(buf);
  }
}

function linkTarget(m: WrappedPdfiumModule, doc: OpenDoc, annot: number): PdfAnnotation['link'] {
  const { malloc, free } = m.pdfium.wasmExports;
  const link = m.FPDFAnnot_GetLink(annot);
  if (!link) return null;
  let dest = m.FPDFLink_GetDest(doc.handle, link);
  let uri: string | null = null;
  let file: string | null = null;
  if (!dest) {
    const action = m.FPDFLink_GetAction(link);
    const type = action ? m.FPDFAction_GetType(action) : 0;
    if (type === PDFACTION_GOTO) dest = m.FPDFAction_GetDest(doc.handle, action);
    else if (type === PDFACTION_URI) {
      const n = m.FPDFAction_GetURIPath(doc.handle, action, 0, 0);
      const buf = malloc(n + 1);
      m.FPDFAction_GetURIPath(doc.handle, action, buf, n);
      uri = m.pdfium.UTF8ToString(buf);
      free(buf);
    } else if (type === PDFACTION_REMOTEGOTO || type === PDFACTION_LAUNCH) {
      // Links to another file: drawing sets are often published sheet-per-file, then combined.
      const n = m.FPDFAction_GetFilePath(action, 0, 0);
      if (n > 1) {
        const buf = malloc(n);
        m.FPDFAction_GetFilePath(action, buf, n);
        file = m.pdfium.UTF8ToString(buf);
        free(buf);
      }
    }
  }
  if (!dest) return { targetPage: null, targetRect: null, uri, file };
  const targetPage = m.FPDFDest_GetDestPageIndex(doc.handle, dest);
  let targetRect: { x: number; y: number; w: number; h: number } | null = null;
  const nParams = malloc(4);
  const params = malloc(16);
  try {
    if (targetPage >= 0 && m.FPDFDest_GetView(dest, nParams, params) === PDFDEST_VIEW_FITR) {
      const f = m.pdfium.HEAPF32;
      const t = userToPageMatrix(m, getPage(m, doc, targetPage));
      const a = applyMatrix(t, f[params >> 2]!, f[(params >> 2) + 1]!);
      const b = applyMatrix(t, f[(params >> 2) + 2]!, f[(params >> 2) + 3]!);
      targetRect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    }
  } finally {
    free(nParams);
    free(params);
  }
  return { targetPage: targetPage >= 0 ? targetPage : null, targetRect, uri, file: null };
}

function invert(t: Matrix): Matrix {
  const det = t[0] * t[3] - t[1] * t[2];
  const a = t[3] / det;
  const b = -t[1] / det;
  const c = -t[2] / det;
  const d = t[0] / det;
  return [a, b, c, d, -(t[4] * a + t[5] * c), -(t[4] * b + t[5] * d)];
}

type Box = { l: number; b: number; r: number; t: number };
const overlaps = (x: Box, y: Box) => x.l < y.r && x.r > y.l && x.b < y.t && x.t > y.b;
const within = (x: Box, y: Box) => x.l >= y.l && x.r <= y.r && x.b >= y.b && x.t <= y.t;

const PAGEOBJ_TEXT = 1;
const PAGEOBJ_PATH = 2;
const PAGEOBJ_IMAGE = 3;
const PAGEOBJ_SHADING = 4;
const PAGEOBJ_FORM = 5;

/**
 * Redaction (and Erase Content): removes what lies inside regions from the page content itself,
 * not just covering it. Characters inside a region are removed (the rest of their text run is
 * written back in Helvetica at the same place); lines, shapes, shadings and forms wholly inside
 * are removed; picture pixels inside are painted over. With `fill`, a rectangle is drawn over
 * each region.
 */
async function redact(bytes: ArrayBuffer, req: RedactRequest): Promise<{ bytes: ArrayBuffer; report: RedactReport }> {
  const m = await lib();
  const { malloc, free } = m.pdfium.wasmExports;
  const doc = loadForEdit(m, bytes);
  const report: RedactReport = { chars: 0, paths: 0, images: 0, skipped: 0 };
  const buf = malloc(64);
  const f64 = (i: number) => m.pdfium.HEAPF64[(buf >> 3) + i]!;
  const f32 = (i: number) => m.pdfium.HEAPF32[(buf >> 2) + i]!;
  try {
    for (const { pageIndex, rects } of req.regions) {
      if (!rects.length) continue;
      const page = m.FPDF_LoadPage(doc.handle, pageIndex);
      if (!page) continue;
      try {
        // Regions in user space, where PDFium reports object and character positions.
        const toUser = invert(userToPageMatrix(m, page));
        const regions: Box[] = rects.map((r) => {
          const a = applyMatrix(toUser, r.x, r.y);
          const b = applyMatrix(toUser, r.x + r.w, r.y + r.h);
          return { l: Math.min(a[0], b[0]), r: Math.max(a[0], b[0]), b: Math.min(a[1], b[1]), t: Math.max(a[1], b[1]) };
        });
        const hit = (box: Box) => regions.some((g) => overlaps(box, g));
        const inside = (box: Box) => regions.some((g) => within(box, g));

        // 1. Characters: which text objects lose characters, and the runs of characters they keep.
        const runs: { obj: number; text: string; x: number; y: number; size: number; angle: number; color: [number, number, number, number] }[] = [];
        const textObjects = new Map<number, number>();
        const textPage = m.FPDFText_LoadPage(page);
        if (textPage) {
          try {
            const count = m.FPDFText_CountChars(textPage);
            const byObject = new Map<number, { code: number; box: Box; x: number; y: number; size: number; angle: number; gone: boolean }[]>();
            for (let i = 0; i < count; i++) {
              const obj = m.FPDFText_GetTextObject(textPage, i);
              if (!obj) continue;
              const code = m.FPDFText_GetUnicode(textPage, i);
              if (!m.FPDFText_GetCharBox(textPage, i, buf, buf + 8, buf + 16, buf + 24)) continue;
              const box = { l: f64(0), r: f64(1), b: f64(2), t: f64(3) };
              m.FPDFText_GetCharOrigin(textPage, i, buf + 32, buf + 40);
              const ch = { code, box, x: f64(4), y: f64(5), size: m.FPDFText_GetFontSize(textPage, i), angle: m.FPDFText_GetCharAngle(textPage, i), gone: hit(box) };
              const list = byObject.get(obj);
              if (list) list.push(ch);
              else byObject.set(obj, [ch]);
            }
            for (const [obj, chars] of byObject) {
              if (!chars.some((c) => c.gone)) continue;
              // Characters removed with this object (counted once it is actually removed).
              textObjects.set(obj, chars.filter((c) => c.gone && c.code > 32).length);
              const color: [number, number, number, number] = m.FPDFPageObj_GetFillColor(obj, buf, buf + 4, buf + 8, buf + 12)
                ? [m.pdfium.HEAPU32[buf >> 2]!, m.pdfium.HEAPU32[(buf >> 2) + 1]!, m.pdfium.HEAPU32[(buf >> 2) + 2]!, m.pdfium.HEAPU32[(buf >> 2) + 3]!]
                : [0, 0, 0, 255];
              // Kept characters, split into runs at removed ones.
              let run: typeof chars = [];
              const flush = () => {
                const text = String.fromCodePoint(...run.map((c) => c.code)).replace(/[\u0000-\u001f]/g, ' ');
                if (text.trim()) runs.push({ obj, text, x: run[0]!.x, y: run[0]!.y, size: run[0]!.size, angle: run[0]!.angle, color });
                run = [];
              };
              for (const c of chars) {
                if (c.gone) flush();
                else run.push(c);
              }
              flush();
            }
          } finally {
            m.FPDFText_ClosePage(textPage);
          }
        }

        // 2. Page objects: text objects that lost characters, and anything wholly inside a region.
        const remove: number[] = [];
        // Text objects inside embedded forms are removed from their form.
        const fromForms = new Set<number>();
        const clearForm = (form: number) => {
          const count = m.FPDFFormObj_CountObjects(form);
          for (let k = count - 1; k >= 0; k--) {
            const child = m.FPDFFormObj_GetObject(form, k);
            const type = m.FPDFPageObj_GetType(child);
            if (type === PAGEOBJ_TEXT && textObjects.has(child)) {
              if (m.FPDFFormObj_RemoveObject(form, child)) {
                fromForms.add(child);
                m.FPDFPageObj_Destroy(child);
              }
            } else if (type === PAGEOBJ_FORM) clearForm(child);
          }
        };
        const replaced: [number, number][] = [];
        const n = m.FPDFPage_CountObjects(page);
        for (let i = 0; i < n; i++) {
          const obj = m.FPDFPage_GetObject(page, i);
          const type = m.FPDFPageObj_GetType(obj);
          if (type === PAGEOBJ_TEXT) {
            if (textObjects.has(obj)) remove.push(obj);
            continue;
          }
          if (!m.FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12)) continue;
          const box = { l: f32(0), b: f32(1), r: f32(2), t: f32(3) };
          if (!hit(box)) continue;
          if (inside(box)) {
            remove.push(obj);
            if (type === PAGEOBJ_IMAGE) report.images++;
            else if (type === PAGEOBJ_PATH || type === PAGEOBJ_SHADING || type === PAGEOBJ_FORM) report.paths++;
          } else if (type === PAGEOBJ_IMAGE && blankImagePixels(m, obj, regions, req.imageFill, buf)) {
            report.images++;
          } else if (type === PAGEOBJ_PATH) {
            // Lines crossing the edge: the parts inside are cut away.
            const cut = clipStrokedPath(m, obj, regions, buf);
            if (cut !== null) {
              replaced.push([obj, cut]);
              report.paths++;
            }
          }
        }
        // Forms (inside a region or not) lose the characters of theirs that fall in one.
        for (let i = 0; i < n; i++) {
          const obj = m.FPDFPage_GetObject(page, i);
          if (m.FPDFPageObj_GetType(obj) === PAGEOBJ_FORM && !remove.includes(obj)) clearForm(obj);
        }
        for (const [old, cut] of replaced) {
          const at = [...Array(m.FPDFPage_CountObjects(page)).keys()].find((k) => m.FPDFPage_GetObject(page, k) === old);
          if (cut) {
            if (at !== undefined) m.FPDFPage_InsertObjectAtIndex(page, cut, at);
            else m.FPDFPage_InsertObject(page, cut);
          }
          if (m.FPDFPage_RemoveObject(page, old)) m.FPDFPageObj_Destroy(old);
        }
        // Text inside forms removed whole goes with them.
        const collect = (form: number) => {
          for (let k = 0; k < m.FPDFFormObj_CountObjects(form); k++) {
            const child = m.FPDFFormObj_GetObject(form, k);
            const type = m.FPDFPageObj_GetType(child);
            if (type === PAGEOBJ_TEXT && textObjects.has(child)) fromForms.add(child);
            else if (type === PAGEOBJ_FORM) collect(child);
          }
        };
        for (const obj of remove) if (m.FPDFPageObj_GetType(obj) === PAGEOBJ_FORM) collect(obj);
        for (const obj of remove) {
          if (m.FPDFPage_RemoveObject(page, obj)) m.FPDFPageObj_Destroy(obj);
        }
        // Text objects inside forms nothing could remove (none are expected) count as skipped.
        for (const [obj, gone] of textObjects) {
          if (remove.includes(obj) || fromForms.has(obj)) report.chars += gone;
          else report.skipped++;
        }

        // 3. The kept characters of changed text runs, written back where they were.
        // Only for text objects that were removed (ones inside forms stayed as they were).
        const rewrite = runs.filter((r) => remove.includes(r.obj) || fromForms.has(r.obj));
        if (rewrite.length) {
          const font = m.FPDFText_LoadStandardFont(doc.handle, 'Helvetica');
          for (const run of rewrite) {
            const obj = m.FPDFPageObj_CreateTextObj(doc.handle, font, run.size);
            const units = run.text.length + 1;
            const wide = malloc(units * 2);
            for (let k = 0; k < run.text.length; k++) m.pdfium.HEAPU16[(wide >> 1) + k] = run.text.charCodeAt(k);
            m.pdfium.HEAPU16[(wide >> 1) + run.text.length] = 0;
            m.FPDFText_SetText(obj, wide);
            free(wide);
            m.FPDFPageObj_SetFillColor(obj, ...run.color);
            const c = Math.cos(run.angle);
            const s = Math.sin(run.angle);
            m.FPDFPageObj_Transform(obj, c, s, -s, c, run.x, run.y);
            m.FPDFPage_InsertObject(page, obj);
          }
        }

        // 4. The overlay.
        if (req.fill) {
          const [r, g, b] = req.fill.map((v) => Math.round(v * 255)) as [number, number, number];
          for (const box of regions) {
            const rect = m.FPDFPageObj_CreateNewRect(box.l, box.b, box.r - box.l, box.t - box.b);
            m.FPDFPageObj_SetFillColor(rect, r, g, b, 255);
            m.FPDFPath_SetDrawMode(rect, 1, false);
            m.FPDFPage_InsertObject(page, rect);
          }
          const label = req.overlayText?.trim();
          if (label) {
            const font = m.FPDFText_LoadStandardFont(doc.handle, 'Helvetica-Bold');
            const [tr, tg, tb] = (req.overlayTextColor ?? [1, 1, 1]).map((v) => Math.round(v * 255)) as [number, number, number];
            for (const box of regions) {
              const w = box.r - box.l;
              const h = box.t - box.b;
              // Helvetica Bold averages about 0.6 em per character.
              const size = Math.max(4, Math.min(h * 0.6, (w * 0.9) / (label.length * 0.6)));
              const obj = m.FPDFPageObj_CreateTextObj(doc.handle, font, size);
              setWideText(m, obj, label);
              m.FPDFPageObj_SetFillColor(obj, tr, tg, tb, 255);
              m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, box.l + (w - label.length * size * 0.6) / 2, box.b + (h - size * 0.7) / 2);
              m.FPDFPage_InsertObject(page, obj);
            }
          }
        }
        if (!m.FPDFPage_GenerateContent(page)) throw new Error(`Could not rewrite page ${pageIndex + 1}`);
      } finally {
        m.FPDF_ClosePage(page);
      }
    }
    return { bytes: saveDocument(m, doc.handle, 'rewrite'), report };
  } finally {
    free(buf);
    m.FPDF_CloseDocument(doc.handle);
    free(doc.ptr);
  }
}

/** The text object under a page-space point (the smallest, if several overlap), with its text. */
async function textObjectAt(docId: number, pageIndex: number, x: number, y: number): Promise<TextObjectInfo | null> {
  const m = await lib();
  const doc = getDoc(docId);
  const page = getPage(m, doc, pageIndex);
  const { malloc, free } = m.pdfium.wasmExports;
  const t = userToPageMatrix(m, page);
  const [ux, uy] = applyMatrix(invert(t), x, y);
  const buf = malloc(16);
  let best: { index: number; area: number; box: Box } | null = null;
  try {
    const n = m.FPDFPage_CountObjects(page);
    for (let i = 0; i < n; i++) {
      const obj = m.FPDFPage_GetObject(page, i);
      if (m.FPDFPageObj_GetType(obj) !== PAGEOBJ_TEXT || !m.FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12)) continue;
      const f = m.pdfium.HEAPF32;
      const box = { l: f[buf >> 2]!, b: f[(buf >> 2) + 1]!, r: f[(buf >> 2) + 2]!, t: f[(buf >> 2) + 3]! };
      if (ux < box.l || ux > box.r || uy < box.b || uy > box.t) continue;
      const area = (box.r - box.l) * (box.t - box.b);
      if (!best || area < best.area) best = { index: i, area, box };
    }
    if (!best) return null;
    const obj = m.FPDFPage_GetObject(page, best.index);
    const textPage = m.FPDFText_LoadPage(page);
    let text = '';
    try {
      const bytes = m.FPDFTextObj_GetText(obj, textPage, 0, 0);
      if (bytes > 2) {
        const tb = malloc(bytes);
        m.FPDFTextObj_GetText(obj, textPage, tb, bytes);
        text = m.pdfium.UTF16ToString(tb);
        free(tb);
      }
    } finally {
      m.FPDFText_ClosePage(textPage);
    }
    const a = applyMatrix(t, best.box.l, best.box.b);
    const b = applyMatrix(t, best.box.r, best.box.t);
    return { index: best.index, text, rect: { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) } };
  } finally {
    free(buf);
  }
}

/** Whether a font can draw every (non-space) character of `text`: a subset font often cannot. */
function fontHasGlyphs(m: WrappedPdfiumModule, font: number, text: string, size: number): boolean {
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    const path = m.FPDFFont_GetGlyphPath(font, ch.codePointAt(0)!, size);
    if (!path || m.FPDFGlyphPath_CountGlyphSegments(path) <= 0) return false;
  }
  return true;
}

function setWideText(m: WrappedPdfiumModule, obj: number, text: string) {
  const { malloc, free } = m.pdfium.wasmExports;
  const wide = malloc((text.length + 1) * 2);
  for (let k = 0; k < text.length; k++) m.pdfium.HEAPU16[(wide >> 1) + k] = text.charCodeAt(k);
  m.pdfium.HEAPU16[(wide >> 1) + text.length] = 0;
  const ok = m.FPDFText_SetText(obj, wide);
  free(wide);
  return ok;
}

/**
 * Edit Text: replaces one text object's text. It keeps its own font when that font has every
 * character (a subset font often lacks new ones); otherwise the text is set in Helvetica at the
 * same place, size, colour and angle.
 */
async function replaceText(bytes: ArrayBuffer, pageIndex: number, index: number, text: string): Promise<{ bytes: ArrayBuffer; keptFont: boolean }> {
  const m = await lib();
  const { malloc, free } = m.pdfium.wasmExports;
  const doc = loadForEdit(m, bytes);
  // Font size at +0, the text matrix (6 floats) at +4, the fill colour (4 uints) at +32.
  const buf = malloc(48);
  try {
    const page = m.FPDF_LoadPage(doc.handle, pageIndex);
    if (!page) throw new Error(`Page ${pageIndex + 1} could not be read`);
    try {
      const old = m.FPDFPage_GetObject(page, index);
      if (!old || m.FPDFPageObj_GetType(old) !== PAGEOBJ_TEXT) throw new Error('That text is no longer there');
      const size = m.FPDFTextObj_GetFontSize(old, buf) ? m.pdfium.HEAPF32[buf >> 2]! : 12;
      const ownFont = m.FPDFTextObj_GetFont(old);
      if (ownFont && fontHasGlyphs(m, ownFont, text, size) && setWideText(m, old, text)) {
        if (!m.FPDFPage_GenerateContent(page)) throw new Error('Could not rewrite the page');
        return { bytes: saveDocument(m, doc.handle), keptFont: true };
      }
      const matrixOk = m.FPDFPageObj_GetMatrix(old, buf + 4);
      const color = m.FPDFPageObj_GetFillColor(old, buf + 32, buf + 36, buf + 40, buf + 44);
      const rgba = color ? [0, 1, 2, 3].map((k) => m.pdfium.HEAPU32[((buf + 32) >> 2) + k]!) : [0, 0, 0, 255];
      const mode = m.FPDFTextObj_GetTextRenderMode(old);
      const font = m.FPDFText_LoadStandardFont(doc.handle, 'Helvetica');
      const obj = m.FPDFPageObj_CreateTextObj(doc.handle, font, size);
      const wide = malloc((text.length + 1) * 2);
      for (let k = 0; k < text.length; k++) m.pdfium.HEAPU16[(wide >> 1) + k] = text.charCodeAt(k);
      m.pdfium.HEAPU16[(wide >> 1) + text.length] = 0;
      m.FPDFText_SetText(obj, wide);
      free(wide);
      if (matrixOk) m.FPDFPageObj_SetMatrix(obj, buf + 4);
      m.FPDFPageObj_SetFillColor(obj, rgba[0]!, rgba[1]!, rgba[2]!, rgba[3]!);
      if (mode >= 0) m.FPDFTextObj_SetTextRenderMode(obj, mode);
      if (!m.FPDFPage_RemoveObject(page, old)) throw new Error('That text could not be changed');
      m.FPDFPageObj_Destroy(old);
      m.FPDFPage_InsertObjectAtIndex(page, obj, index);
      if (!m.FPDFPage_GenerateContent(page)) throw new Error('Could not rewrite the page');
    } finally {
      m.FPDF_ClosePage(page);
    }
    return { bytes: saveDocument(m, doc.handle), keptFont: false };
  } finally {
    free(buf);
    m.FPDF_CloseDocument(doc.handle);
    free(doc.ptr);
  }
}

/** Adds text in Helvetica, one object per line, its first line's top-left at page point (x, y). */
async function addText(req: { bytes: ArrayBuffer; pageIndex: number; x: number; y: number; text: string; size: number; color: [number, number, number] }): Promise<ArrayBuffer> {
  const m = await lib();
  const doc = loadForEdit(m, req.bytes);
  try {
    const page = m.FPDF_LoadPage(doc.handle, req.pageIndex);
    if (!page) throw new Error(`Page ${req.pageIndex + 1} could not be read`);
    try {
      const toUser = invert(userToPageMatrix(m, page));
      const font = m.FPDFText_LoadStandardFont(doc.handle, 'Helvetica');
      // Upright in the page as displayed: the page's rotation turns the text too.
      const [ox, oy] = applyMatrix(toUser, 0, 0);
      const [ex, ey] = applyMatrix(toUser, 1, 0);
      const len = Math.hypot(ex - ox, ey - oy) || 1;
      const c = (ex - ox) / len;
      const s = (ey - oy) / len;
      req.text.split('\n').forEach((line, i) => {
        if (!line) return;
        const obj = m.FPDFPageObj_CreateTextObj(doc.handle, font, req.size);
        setWideText(m, obj, line);
        m.FPDFPageObj_SetFillColor(obj, ...req.color.map((v) => Math.round(v * 255)) as [number, number, number], 255);
        const [ux, uy] = applyMatrix(toUser, req.x, req.y + req.size * (0.8 + i * 1.2));
        m.FPDFPageObj_Transform(obj, c, s, -s, c, ux, uy);
        m.FPDFPage_InsertObject(page, obj);
      });
      if (!m.FPDFPage_GenerateContent(page)) throw new Error('Could not rewrite the page');
    } finally {
      m.FPDF_ClosePage(page);
    }
    return saveDocument(m, doc.handle);
  } finally {
    m.FPDF_CloseDocument(doc.handle);
    m.pdfium.wasmExports.free(doc.ptr);
  }
}

/** The parts of the segment a→b outside every region (parameter intervals along it). */
function outsideParts(a: [number, number], b: [number, number], regions: Box[]): [number, number][] {
  const inside: [number, number][] = [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const g of regions) {
    // Liang–Barsky: where the segment runs through the box.
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, q] of [
      [-dx, a[0] - g.l],
      [dx, g.r - a[0]],
      [-dy, a[1] - g.b],
      [dy, g.t - a[1]],
    ] as [number, number][]) {
      if (p === 0) {
        if (q < 0) ok = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (ok && t0 < t1) inside.push([t0, t1]);
  }
  inside.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let from = 0;
  for (const [s, e] of inside) {
    if (s > from) out.push([from, s]);
    from = Math.max(from, e);
  }
  if (from < 1) out.push([from, 1]);
  return out;
}

/**
 * A stroked (unfilled) path that crosses a region, redrawn without the parts inside it; null to
 * leave it (filled paths, which cannot be cut this way), or 0 when nothing of it is left.
 */
function clipStrokedPath(m: WrappedPdfiumModule, obj: number, regions: Box[], buf: number): number | null {
  if (!m.FPDFPath_GetDrawMode(obj, buf, buf + 4)) return null;
  const fillMode = m.pdfium.HEAP32[buf >> 2]!;
  const stroke = m.pdfium.HEAP32[(buf >> 2) + 1]!;
  if (fillMode !== 0 || !stroke) return null;
  if (!m.FPDFPageObj_GetMatrix(obj, buf)) return null;
  const f = m.pdfium.HEAPF32;
  const t: Matrix = [f[buf >> 2]!, f[(buf >> 2) + 1]!, f[(buf >> 2) + 2]!, f[(buf >> 2) + 3]!, f[(buf >> 2) + 4]!, f[(buf >> 2) + 5]!];
  // The path in user space, curves flattened, as polylines.
  const lines: [number, number][][] = [];
  let cur: [number, number][] = [];
  let start: [number, number] | null = null;
  const count = m.FPDFPath_CountSegments(obj);
  const pts: { type: number; p: [number, number]; close: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const seg = m.FPDFPath_GetPathSegment(obj, i);
    if (!seg || !m.FPDFPathSegment_GetPoint(seg, buf + 32, buf + 36)) continue;
    pts.push({ type: m.FPDFPathSegment_GetType(seg), p: applyMatrix(t, f[(buf + 32) >> 2]!, f[(buf + 36) >> 2]!), close: m.FPDFPathSegment_GetClose(seg) });
  }
  for (let i = 0; i < pts.length; i++) {
    const s = pts[i]!;
    if (s.type === FPDF_SEGMENT_MOVETO) {
      if (cur.length > 1) lines.push(cur);
      cur = [s.p];
      start = s.p;
    } else if (s.type === FPDF_SEGMENT_BEZIERTO && i + 2 < pts.length) {
      const p0 = cur[cur.length - 1] ?? s.p;
      const [c1, c2, p3] = [s.p, pts[i + 1]!.p, pts[i + 2]!.p];
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const u = k / CURVE_STEPS;
        const v = 1 - u;
        cur.push([v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p3[1]]);
      }
      i += 2;
      if (pts[i]!.close && start) cur.push(start);
      continue;
    } else cur.push(s.p);
    if (s.close && start) cur.push(start);
  }
  if (cur.length > 1) lines.push(cur);
  // Keep what lies outside the regions.
  const pieces: [number, number][][] = [];
  for (const line of lines) {
    let piece: [number, number][] = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      const at = (u: number): [number, number] => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      for (const [u0, u1] of outsideParts(a, b, regions)) {
        const p = at(u0);
        const last = piece[piece.length - 1];
        if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) {
          if (piece.length > 1) pieces.push(piece);
          piece = [p];
        }
        piece.push(at(u1));
      }
    }
    if (piece.length > 1) pieces.push(piece);
  }
  if (!pieces.length) return 0;
  const out = m.FPDFPageObj_CreateNewPath(pieces[0]![0]![0], pieces[0]![0]![1]);
  pieces.forEach((piece, k) => {
    if (k) m.FPDFPath_MoveTo(out, piece[0]![0], piece[0]![1]);
    for (const p of piece.slice(1)) m.FPDFPath_LineTo(out, p[0], p[1]);
  });
  // The same look: colour, width (in user space now), caps and joins.
  if (m.FPDFPageObj_GetStrokeColor(obj, buf, buf + 4, buf + 8, buf + 12)) {
    const u = m.pdfium.HEAPU32;
    m.FPDFPageObj_SetStrokeColor(out, u[buf >> 2]!, u[(buf >> 2) + 1]!, u[(buf >> 2) + 2]!, u[(buf >> 2) + 3]!);
  }
  if (m.FPDFPageObj_GetStrokeWidth(obj, buf)) m.FPDFPageObj_SetStrokeWidth(out, f[buf >> 2]! * Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])));
  m.FPDFPageObj_SetLineCap(out, m.FPDFPageObj_GetLineCap(obj));
  m.FPDFPageObj_SetLineJoin(out, m.FPDFPageObj_GetLineJoin(obj));
  m.FPDFPath_SetDrawMode(out, 0, true);
  return out;
}

/** Paints the pixels of a picture that fall inside any region; true if any did. */
function blankImagePixels(m: WrappedPdfiumModule, obj: number, regions: Box[], fill: [number, number, number], buf: number): boolean {
  if (!m.FPDFPageObj_GetMatrix(obj, buf)) return false;
  const f = m.pdfium.HEAPF32;
  const t: Matrix = [f[buf >> 2]!, f[(buf >> 2) + 1]!, f[(buf >> 2) + 2]!, f[(buf >> 2) + 3]!, f[(buf >> 2) + 4]!, f[(buf >> 2) + 5]!];
  const bitmap = m.FPDFImageObj_GetBitmap(obj);
  if (!bitmap) return false;
  try {
    const w = m.FPDFBitmap_GetWidth(bitmap);
    const h = m.FPDFBitmap_GetHeight(bitmap);
    const stride = m.FPDFBitmap_GetStride(bitmap);
    const format = m.FPDFBitmap_GetFormat(bitmap);
    // 1 grey, 2 BGR, 3 BGRx, 4 BGRA.
    const bpp = format === 1 ? 1 : format === 2 ? 3 : 4;
    const data = m.FPDFBitmap_GetBuffer(bitmap);
    const heap = m.pdfium.HEAPU8;
    const [r, g, b] = fill.map((v) => Math.round(v * 255)) as [number, number, number];
    const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    let changed = false;
    for (let y = 0; y < h; y++) {
      // Image space is the unit square, rows from the top.
      const v = 1 - (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const [px, py] = applyMatrix(t, u, v);
        if (!regions.some((g2) => px >= g2.l && px <= g2.r && py >= g2.b && py <= g2.t)) continue;
        const at = data + y * stride + x * bpp;
        if (bpp === 1) heap[at] = grey;
        else {
          heap[at] = b;
          heap[at + 1] = g;
          heap[at + 2] = r;
          if (bpp === 4) heap[at + 3] = 255;
        }
        changed = true;
      }
    }
    if (changed) m.FPDFImageObj_SetBitmap(0, 0, obj, bitmap);
    return changed;
  } finally {
    m.FPDFBitmap_Destroy(bitmap);
  }
}

/** Page and place a destination points at, in page space. */
function destTarget(m: WrappedPdfiumModule, doc: OpenDoc, dest: number): { pageIndex: number | null; rect: OutlineItem['rect']; zoom?: number } {
  const { malloc, free } = m.pdfium.wasmExports;
  const pageIndex = m.FPDFDest_GetDestPageIndex(doc.handle, dest);
  if (pageIndex < 0) return { pageIndex: null, rect: null };
  let rect: OutlineItem['rect'] = null;
  let zoom: number | undefined;
  const buf = malloc(48);
  try {
    const f = m.pdfium.HEAPF32;
    const t = userToPageMatrix(m, getPage(m, doc, pageIndex));
    if (m.FPDFDest_GetView(dest, buf, buf + 4) === PDFDEST_VIEW_FITR) {
      const p = (buf + 4) >> 2;
      const a = applyMatrix(t, f[p]!, f[p + 1]!);
      const b = applyMatrix(t, f[p + 2]!, f[p + 3]!);
      rect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    } else if (m.FPDFDest_GetLocationInPage(dest, buf, buf + 4, buf + 8, buf + 12, buf + 16, buf + 20)) {
      // XYZ: a top-left point (either coordinate may be unset).
      const h = m.pdfium.HEAP32;
      const hasX = h[buf >> 2]!, hasY = h[(buf + 4) >> 2]!, hasZoom = h[(buf + 8) >> 2]!;
      if (hasX || hasY) {
        const [x, y] = applyMatrix(t, hasX ? f[(buf + 12) >> 2]! : 0, hasY ? f[(buf + 16) >> 2]! : 0);
        rect = { x: hasX ? x : 0, y: hasY ? y : 0, w: 0, h: 0 };
      }
      if (hasZoom && f[(buf + 20) >> 2]! > 0) zoom = f[(buf + 20) >> 2]!;
    }
  } finally {
    free(buf);
  }
  return { pageIndex, rect, ...(zoom ? { zoom } : {}) };
}

/** The document outline (bookmarks), as a tree. */
async function readOutline(docId: number): Promise<OutlineItem[]> {
  const m = await lib();
  const doc = getDoc(docId);
  const { malloc, free } = m.pdfium.wasmExports;
  const seen = new Set<number>();
  const walk = (parent: number, depth: number): OutlineItem[] => {
    const out: OutlineItem[] = [];
    // Malformed outlines can loop; stop at anything already visited.
    for (let b = m.FPDFBookmark_GetFirstChild(doc.handle, parent); b && !seen.has(b) && depth < 64; b = m.FPDFBookmark_GetNextSibling(doc.handle, b)) {
      seen.add(b);
      const n = m.FPDFBookmark_GetTitle(b, 0, 0);
      let title = '';
      if (n > 2) {
        const buf = malloc(n);
        m.FPDFBookmark_GetTitle(b, buf, n);
        title = m.pdfium.UTF16ToString(buf);
        free(buf);
      }
      let dest = m.FPDFBookmark_GetDest(doc.handle, b);
      if (!dest) {
        const action = m.FPDFBookmark_GetAction(b);
        if (action && m.FPDFAction_GetType(action) === PDFACTION_GOTO) dest = m.FPDFAction_GetDest(doc.handle, action);
      }
      out.push({ title, ...(dest ? destTarget(m, doc, dest) : { pageIndex: null, rect: null }), children: walk(b, depth + 1) });
    }
    return out;
  };
  return walk(0, 0);
}

function readAnnotations(m: WrappedPdfiumModule, doc: OpenDoc, pageIndex: number): PdfAnnotation[] {
  const page = getPage(m, doc, pageIndex);
  const t = userToPageMatrix(m, page);
  const { malloc, free } = m.pdfium.wasmExports;
  const tmp = malloc(32);
  const out: PdfAnnotation[] = [];
  // Links load the pages they point at; this one stays open meanwhile.
  const wasPinned = doc.pinned.has(pageIndex);
  doc.pinned.add(pageIndex);
  try {
    const count = m.FPDFPage_GetAnnotCount(page);
    for (let index = 0; index < count; index++) {
      const annot = m.FPDFPage_GetAnnot(page, index);
      if (!annot) continue;
      try {
        const subtype = ANNOT_SUBTYPES[m.FPDFAnnot_GetSubtype(annot)] ?? 'Unknown';
        const rect = annotRect(m, annot, tmp, t);
        if (!rect) continue;
        const opacity = annotOpacity(m, annot, tmp);
        const borderWidth = annotBorderWidth(m, annot, tmp);
        let line: PdfAnnotation['line'] = null;
        if (subtype === 'Line' && m.FPDFAnnot_GetLine(annot, tmp, tmp + 8)) {
          const g = m.pdfium.HEAPF32;
          line = [applyMatrix(t, g[tmp >> 2]!, g[(tmp >> 2) + 1]!), applyMatrix(t, g[(tmp >> 2) + 2]!, g[(tmp >> 2) + 3]!)];
        }
        const ink: [number, number][][] = [];
        if (subtype === 'Ink') {
          const n = m.FPDFAnnot_GetInkListCount(annot);
          for (let k = 0; k < n; k++) ink.push(readPoints(m, t, (buf, len) => m.FPDFAnnot_GetInkListPath(annot, k, buf, len)));
        }
        const quads: [number, number][][] = [];
        if (subtype === 'Highlight' || subtype === 'Underline' || subtype === 'StrikeOut' || subtype === 'Squiggly') {
          const n = m.FPDFAnnot_CountAttachmentPoints(annot);
          const q = malloc(32);
          try {
            for (let k = 0; k < n; k++) {
              if (!m.FPDFAnnot_GetAttachmentPoints(annot, k, q)) continue;
              const g = m.pdfium.HEAPF32;
              const pts: [number, number][] = [];
              for (let j = 0; j < 4; j++) pts.push(applyMatrix(t, g[(q >> 2) + j * 2]!, g[(q >> 2) + j * 2 + 1]!));
              quads.push(pts);
            }
          } finally {
            free(q);
          }
        }
        out.push({
          index,
          subtype,
          rect,
          ...(quads.length ? { quads } : {}),
          ...(subtype === 'FileAttachment' ? { file: annotFile(m, annot) } : {}),
          color: annotColor(m, annot, 0, tmp),
          interior: annotColor(m, annot, 1, tmp),
          opacity,
          borderWidth,
          contents: annotString(m, annot, 'Contents'),
          author: annotString(m, annot, 'T'),
          name: annotString(m, annot, 'NM'),
          intent: annotString(m, annot, 'IT'),
          cloudy: m.FPDFAnnot_HasKey(annot, 'BE'),
          multiply: m.EPDFAnnot_GetBlendMode(annot) === BLEND_MULTIPLY,
          objectNumber: m.EPDFAnnot_GetObjectNumber(annot),
          da: annotString(m, annot, 'DA'),
          appData: annotString(m, annot, APP_DATA_KEY),
          flags: m.FPDFAnnot_GetFlags(annot),
          vertices: subtype === 'Polygon' || subtype === 'PolyLine' ? readPoints(m, t, (buf, len) => m.FPDFAnnot_GetVertices(annot, buf, len)) : [],
          ink,
          line,
          link: subtype === 'Link' ? linkTarget(m, doc, annot) : null,
        });
      } finally {
        m.FPDFPage_CloseAnnot(annot);
      }
    }
  } finally {
    free(tmp);
    if (!wasPinned) doc.pinned.delete(pageIndex);
  }
  return out;
}

/**
 * Text that AutoCAD drew as SHX strokes lives only in invisible annotations; turn it into words
 * so search, sheet detection and link detection see it. Positions are spread across the box.
 */
function shxWords(m: WrappedPdfiumModule, page: number, t: Matrix): TextWord[] {
  const { malloc, free } = m.pdfium.wasmExports;
  const tmp = malloc(16);
  const out: TextWord[] = [];
  try {
    const count = m.FPDFPage_GetAnnotCount(page);
    for (let i = 0; i < count; i++) {
      const annot = m.FPDFPage_GetAnnot(page, i);
      if (!annot) continue;
      try {
        if (m.FPDFAnnot_GetSubtype(annot) !== ANNOT_SQUARE || annotString(m, annot, 'T') !== SHX_AUTHOR) continue;
        const text = annotString(m, annot, 'Contents').trim();
        const r = annotRect(m, annot, tmp, t);
        if (!text || !r) continue;
        const vertical = r.h > r.w * 1.5 && text.length > 2;
        const along = vertical ? r.h : r.w;
        const size = (vertical ? r.w : r.h) * 0.8;
        let pos = 0;
        for (const part of text.split(/\s+/)) {
          const start = pos / text.length;
          const end = (pos + part.length) / text.length;
          pos += part.length + 1;
          out.push(
            vertical
              ? { text: part, x0: r.x, x1: r.x + r.w, y0: r.y + r.h - end * along, y1: r.y + r.h - start * along, size, angle: -Math.PI / 2 }
              : { text: part, x0: r.x + start * along, x1: r.x + end * along, y0: r.y, y1: r.y + r.h, size, angle: 0 },
          );
        }
      } finally {
        m.FPDFPage_CloseAnnot(annot);
      }
    }
  } finally {
    free(tmp);
  }
  return out;
}

function extractWords(m: WrappedPdfiumModule, page: number): TextWord[] {
  const textPage = m.FPDFText_LoadPage(page);
  if (!textPage) return [];
  const { malloc, free } = m.pdfium.wasmExports;
  const box = malloc(32);
  const mat = malloc(24);
  const t = userToPageMatrix(m, page);
  const words: TextWord[] = [];
  let cur: TextWord | null = null;
  let last: { cx: number; cy: number; half: number } | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) words.push({ ...cur, text: cur.text.trim() });
    cur = null;
  };
  try {
    const n = m.FPDFText_CountChars(textPage);
    for (let i = 0; i < n; i++) {
      const code = m.FPDFText_GetUnicode(textPage, i);
      // Whitespace and line breaks (including PDFium's generated ones) end the current word.
      if (code === 32 || code === 10 || code === 13 || code === 9 || code === 0xfffe) {
        flush();
        continue;
      }
      if (!m.FPDFText_GetCharBox(textPage, i, box, box + 8, box + 16, box + 24)) continue;
      const f64 = m.pdfium.HEAPF64;
      const [left, right, bottom, top] = [f64[box >> 3]!, f64[(box >> 3) + 1]!, f64[(box >> 3) + 2]!, f64[(box >> 3) + 3]!];
      const ax = t[0] * left + t[2] * bottom + t[4];
      const ay = t[1] * left + t[3] * bottom + t[5];
      const bx = t[0] * right + t[2] * top + t[4];
      const by = t[1] * right + t[3] * top + t[5];
      const x0 = Math.min(ax, bx);
      const x1 = Math.max(ax, bx);
      const y0 = Math.min(ay, by);
      const y1 = Math.max(ay, by);
      // CAD exports often set text as `1 Tf` and size it through the text matrix, so the nominal
      // font size is scaled by the character's matrix to get the size on the page.
      let size = m.FPDFText_GetFontSize(textPage, i);
      if (m.FPDFText_GetMatrix(textPage, i, mat)) {
        const f = m.pdfium.HEAPF32;
        const k = mat >> 2;
        const det = Math.abs(f[k]! * f[k + 3]! - f[k + 1]! * f[k + 2]!);
        if (det > 1e-9) size *= Math.sqrt(det);
      }
      const angle = m.FPDFText_GetCharAngle(textPage, i);
      const ch = String.fromCodePoint(code);
      // Character centre and half-extent along the reading direction. Text can run at any angle
      // (labels along a road), so adjacency is measured along that direction, not along x.
      // PDFium reports the angle clockwise, i.e. already in y-down page space.
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const half = (Math.abs(dx) * (x1 - x0) + Math.abs(dy) * (y1 - y0)) / 2;
      if (cur && last) {
        // Continue the word only for the next character along the same line, size and direction.
        const along = (cx - last.cx) * dx + (cy - last.cy) * dy;
        const across = Math.abs((cx - last.cx) * -dy + (cy - last.cy) * dx);
        const gap = along - last.half - half;
        if (Math.abs(size - cur.size) > 0.5 || Math.abs(angle - cur.angle) > 0.1 || across > size * 0.5 || gap > size * 0.6 || along < -size * 0.2) flush();
      }
      last = { cx, cy, half };
      if (!cur) cur = { text: ch, x0, y0, x1, y1, size, angle };
      else {
        cur.text += ch;
        cur.x0 = Math.min(cur.x0, x0);
        cur.y0 = Math.min(cur.y0, y0);
        cur.x1 = Math.max(cur.x1, x1);
        cur.y1 = Math.max(cur.y1, y1);
      }
    }
    flush();
  } finally {
    free(box);
    free(mat);
    m.FPDFText_ClosePage(textPage);
  }
  return [...words, ...shxWords(m, page, t)];
}

async function geometry(docId: number, pageIndex: number): Promise<{ segments: Float32Array; ms: number }> {
  const t0 = performance.now();
  const m = await lib();
  const segments = extractSegments(m, getPage(m, getDoc(docId), pageIndex));
  return { segments, ms: performance.now() - t0 };
}

/** Full page size in device pixels at `scale`; must match the viewer's `ceil(points * scale)`. */
function pageSizePx(m: WrappedPdfiumModule, page: number, scale: number) {
  return {
    w: Math.ceil(m.FPDF_GetPageWidthF(page) * scale),
    h: Math.ceil(m.FPDF_GetPageHeightF(page) * scale),
  };
}

function reply(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case 'open': {
        const res = await open(req.bytes, req.password);
        reply({ id: req.id, ok: true, type: 'open', ...res });
        break;
      }
      case 'close':
        await close(req.docId);
        reply({ id: req.id, ok: true, type: 'close' });
        break;
      case 'render': {
        const res = await render(req);
        reply({ id: req.id, ok: true, type: 'render', ...res }, [res.bitmap]);
        break;
      }
      case 'text': {
        const m = await lib();
        const words = extractWords(m, getPage(m, getDoc(req.docId), req.pageIndex));
        reply({ id: req.id, ok: true, type: 'text', words });
        break;
      }
      case 'unlock': {
        const out = await unlock(req.bytes, req.password);
        reply({ id: req.id, ok: true, type: 'unlock', bytes: out }, out ? [out] : []);
        break;
      }
      case 'edit':
      case 'extract':
      case 'create': {
        const out = req.type === 'edit' ? await editPdf(req.bytes, req.ops, req.inserts, req.rewrite ? 'rewrite' : 'auto') : req.type === 'extract' ? await extractPages(req.bytes, req.pages) : await createPdf(req.pages);
        reply({ id: req.id, ok: true, type: req.type, bytes: out }, [out]);
        break;
      }
      case 'info':
        reply({ id: req.id, ok: true, type: 'info', info: await documentInfo(req.docId) });
        break;
      case 'outline':
        reply({ id: req.id, ok: true, type: 'outline', outline: await readOutline(req.docId) });
        break;
      case 'textObjectAt':
        reply({ id: req.id, ok: true, type: 'textObjectAt', object: await textObjectAt(req.docId, req.pageIndex, req.x, req.y) });
        break;
      case 'replaceText': {
        const out = await replaceText(req.bytes, req.pageIndex, req.index, req.text);
        reply({ id: req.id, ok: true, type: 'replaceText', bytes: out.bytes, keptFont: out.keptFont }, [out.bytes]);
        break;
      }
      case 'addText': {
        const out = await addText(req);
        reply({ id: req.id, ok: true, type: 'addText', bytes: out }, [out]);
        break;
      }
      case 'redact': {
        const res = await redact(req.bytes, req);
        reply({ id: req.id, ok: true, type: 'redact', ...res }, [res.bytes]);
        break;
      }
      case 'annotations': {
        const m = await lib();
        reply({ id: req.id, ok: true, type: 'annotations', annotations: readAnnotations(m, getDoc(req.docId), req.pageIndex) });
        break;
      }
      case 'hideAnnots': {
        const m = await lib();
        const doc = getDoc(req.docId);
        const set = doc.hidden.get(req.pageIndex) ?? new Set<number>();
        for (const i of req.indices) set.add(i);
        doc.hidden.set(req.pageIndex, set);
        const loaded = doc.pages.get(req.pageIndex);
        if (loaded) applyHidden(m, loaded, set);
        reply({ id: req.id, ok: true, type: 'hideAnnots' });
        break;
      }
      case 'geometry': {
        const res = await geometry(req.docId, req.pageIndex);
        reply({ id: req.id, ok: true, type: 'geometry', ...res }, [res.segments.buffer]);
        break;
      }
    }
  } catch (err) {
    if (isAbort(err)) resetLib();
    reply({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
