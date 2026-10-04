export interface PageSize {
  /** Width in PDF points, rotation applied. */
  width: number;
  /** Height in PDF points, rotation applied. */
  height: number;
}

/** A run of characters on one line with the same size and direction, in page space. */
export interface TextWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Font size in points. */
  size: number;
  /** Reading direction in radians, clockwise in page space: (cos, sin) points along the text. */
  angle: number;
}

/**
 * Annotation dictionary key under which this app stores a markup's full data (JSON) when it
 * exports, so re-opening an exported file restores markups exactly.
 */
export const APP_DATA_KEY = 'NBData';

/** An existing annotation in the PDF, in page space (points, top-left origin, y down). */
export interface PdfAnnotation {
  /** Position in the page's /Annots array. */
  index: number;
  /** PDF subtype name, e.g. `Line`, `Square`, `FreeText`, `Link`. */
  subtype: string;
  rect: { x: number; y: number; w: number; h: number };
  /** Stroke colour as #rrggbb, or null. */
  color: string | null;
  /** Interior (fill) colour, or null. */
  interior: string | null;
  opacity: number;
  borderWidth: number;
  contents: string;
  author: string;
  name: string;
  /** /IT intent, e.g. `LineDimension`, `PolygonCloud`. */
  intent: string;
  /** Has a cloudy border effect (/BE). */
  cloudy: boolean;
  /** /DA default appearance string (FreeText font and colour). */
  da: string;
  /** Lossless markup data this app writes into annotations it exports (JSON), if present. */
  appData: string;
  flags: number;
  vertices: [number, number][];
  ink: [number, number][][];
  line: [[number, number], [number, number]] | null;
  /** Text markup annotations: each marked line as four corners (page space), from /QuadPoints. */
  quads?: [number, number][][];
  /** FileAttachment annotations: the embedded file. */
  file?: { name: string; data: Uint8Array } | null;
  /** For Link annotations: where they go. */
  link: {
    targetPage: number | null;
    targetRect: { x: number; y: number; w: number; h: number } | null;
    uri: string | null;
    /** Another file the link opens (GoToR / Launch), e.g. `C-101.pdf`. */
    file: string | null;
  } | null;
}

/**
 * A page operation, applied in order. Page indices refer to the document as it stands when the
 * operation runs.
 */
export type PageOp =
  /** Rotate pages clockwise by quarter turns (1 = 90°). */
  | { type: 'rotate'; pages: number[]; quarterTurns: number }
  | { type: 'delete'; pages: number[] }
  /** Move pages (kept in their relative order) so the first lands at index `to` of the result. */
  | { type: 'move'; pages: number[]; to: number }
  /** Insert all pages of another PDF (`inserts[source]`) before index `at` (past the end appends). */
  | { type: 'insert'; source: number; at: number }
  /** Insert `count` blank pages of the given size (points) before index `at` (past the end appends). */
  | { type: 'blank'; at: number; count: number; width: number; height: number };

/** Document-level information (Document → Properties). */
export interface DocumentInfo {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  /** PDF date strings (D:YYYYMMDDHHmmSS...), empty when unset. */
  creationDate: string;
  modDate: string;
  /** e.g. 17 for PDF 1.7; 0 when unknown. */
  version: number;
  /** Security handler revision, or -1 when the file is not encrypted. */
  securityRevision: number;
  /** Permission bits from the encryption dictionary (all set when unencrypted). */
  permissions: number;
  /** Digital signatures in the file. */
  signatures: number;
}

export interface TileRequest {
  docId: number;
  pageIndex: number;
  /** Device pixels per PDF point. */
  scale: number;
  /** Tile origin in device pixels at `scale`. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Draws every line at hairline weight (Disable Line Weights). */
  thinLines?: boolean;
  /** Leaves unpainted page area transparent instead of white (Snapshot). */
  transparent?: boolean;
}

/** A bookmark from the PDF outline: its title, where it jumps, and its children. */
export interface OutlineItem {
  title: string;
  /** Target page, or null when the bookmark has no destination in this file. */
  pageIndex: number | null;
  /** Where on the target page, in page space: an area (FitR) or a point (XYZ, w = h = 0). */
  rect: { x: number; y: number; w: number; h: number } | null;
  children: OutlineItem[];
}

/** A rectangle in page space: points, top-left origin, y down, rotation applied. */
export interface PageRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactRequest {
  /** Regions to clear, per page. */
  regions: { pageIndex: number; rects: PageRegion[] }[];
  /** Overlay drawn over each region (0–1 RGB), or null to leave it empty (Erase Content). */
  fill: [number, number, number] | null;
  /** Colour picture pixels inside a region become (0–1 RGB). */
  imageFill: [number, number, number];
  /** Text written on each overlay box (e.g. "REDACTED"), in `overlayTextColor`. */
  overlayText?: string;
  overlayTextColor?: [number, number, number];
}

export interface RedactReport {
  /** Characters removed. */
  chars: number;
  /** Lines, shapes and forms removed (those wholly inside a region). */
  paths: number;
  /** Pictures removed or blanked in part. */
  images: number;
  /**
   * Things inside a region that could not be removed: text inside embedded forms, and forms only
   * partly inside. They stay in the file (under the overlay, if any).
   */
  skipped: number;
}

/** A text object on a page (Edit Text). */
export interface TextObjectInfo {
  /** Index among the page's objects, for replacing it. */
  index: number;
  text: string;
  /** Bounds in page space. */
  rect: PageRegion;
}

export type WorkerRequest =
  | { id: number; type: 'open'; bytes: ArrayBuffer; password?: string }
  | { id: number; type: 'close'; docId: number }
  | ({ id: number; type: 'render' } & TileRequest)
  | { id: number; type: 'geometry'; docId: number; pageIndex: number }
  | { id: number; type: 'text'; docId: number; pageIndex: number }
  | { id: number; type: 'annotations'; docId: number; pageIndex: number }
  | { id: number; type: 'hideAnnots'; docId: number; pageIndex: number; indices: number[] }
  | { id: number; type: 'edit'; bytes: ArrayBuffer; ops: PageOp[]; inserts: ArrayBuffer[]; rewrite?: boolean }
  | { id: number; type: 'extract'; bytes: ArrayBuffer; pages: number[] }
  | { id: number; type: 'unlock'; bytes: ArrayBuffer; password: string }
  | { id: number; type: 'create'; pages: PageSize[] }
  | { id: number; type: 'info'; docId: number }
  | { id: number; type: 'outline'; docId: number }
  | ({ id: number; type: 'redact'; bytes: ArrayBuffer } & RedactRequest)
  | { id: number; type: 'textObjectAt'; docId: number; pageIndex: number; x: number; y: number }
  | { id: number; type: 'replaceText'; bytes: ArrayBuffer; pageIndex: number; index: number; text: string }
  | { id: number; type: 'addText'; bytes: ArrayBuffer; pageIndex: number; x: number; y: number; text: string; size: number; color: [number, number, number] };

export type WorkerResponse =
  | { id: number; ok: true; type: 'open'; docId: number; pages: PageSize[] }
  | { id: number; ok: true; type: 'close' }
  | { id: number; ok: true; type: 'render'; bitmap: ImageBitmap; ms: number }
  | { id: number; ok: true; type: 'geometry'; segments: Float32Array; ms: number }
  | { id: number; ok: true; type: 'text'; words: TextWord[] }
  | { id: number; ok: true; type: 'annotations'; annotations: PdfAnnotation[] }
  | { id: number; ok: true; type: 'hideAnnots' }
  | { id: number; ok: true; type: 'edit' | 'extract' | 'create'; bytes: ArrayBuffer }
  | { id: number; ok: true; type: 'unlock'; bytes: ArrayBuffer | null }
  | { id: number; ok: true; type: 'info'; info: DocumentInfo }
  | { id: number; ok: true; type: 'outline'; outline: OutlineItem[] }
  | { id: number; ok: true; type: 'redact'; bytes: ArrayBuffer; report: RedactReport }
  | { id: number; ok: true; type: 'textObjectAt'; object: TextObjectInfo | null }
  | { id: number; ok: true; type: 'replaceText'; bytes: ArrayBuffer; keptFont: boolean }
  | { id: number; ok: true; type: 'addText'; bytes: ArrayBuffer }
  | { id: number; ok: false; error: string };

/** The error message when a PDF needs a (different) password to open. */
export const NEEDS_PASSWORD = 'This PDF needs a password to open';
