import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFParser, PDFRef, PDFString, PDFHexString, PDFStream, PDFWriter, type PDFContext } from 'pdf-lib';
import {
  APP_DATA_KEY,
  arr,
  colorHex,
  dict,
  nameOf,
  num,
  nums,
  pagePoints,
  PdfRefNum,
  refNum,
  str,
  userToPage,
  type PageMatrix,
  type PdfDictValue,
  type PdfExtras,
  type PdfPageExtras,
} from './bluebeam';
import type { Matrix } from './export';
import { importAnnotations, type ImportableAnnotation } from './import';
import type { Markup } from './model';
import { encodePng, imageDataUrl } from './pdfExtras';
import { toPdfValue } from './pdfValue';

/**
 * Markups as FDF, the Forms Data Format that Bluebeam Revu and Acrobat export markups to. An FDF
 * file is PDF syntax with no pages: a catalog whose /FDF dictionary lists the annotations (each
 * with the /Page it belongs to), so the annotation dictionaries are the same ones a PDF holds.
 * Import reads them as a PDF's are read (Bluebeam's measurements, replies and review states
 * included); export lifts them out of a PDF this app saved.
 */

/** Annotations that are not markups: links and form fields have their own exchange. */
const NOT_MARKUP = new Set(['Link', 'Widget']);

/** What an FDF file held, and what could not be turned into a markup. */
export interface FdfImport {
  markups: Markup[];
  /** The PDF the file was exported from, as it names it (/F). */
  fileName: string;
  /** Annotations with no markup equivalent (a stamp's drawing, a form field), named so none is dropped silently. */
  skipped: string[];
}

interface FdfAnnot {
  page: number;
  ref: number;
  raw: PdfDictValue;
}

/** The FDF's parsed annotations: each dictionary as plain values, with replies pointing at their parents by reference. */
async function parseFdf(bytes: Uint8Array): Promise<{ ctx: PDFContext; fileName: string; annots: FdfAnnot[]; images: Map<number, string> }> {
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%FDF-') throw new Error('This is not an FDF file (it does not start with %FDF).');
  // The parser reads PDF syntax; FDF differs only in its header and in having no cross-reference table.
  const patched = bytes.slice();
  patched.set([0x50, 0x44, 0x46], 1);
  const ctx = await PDFParser.forBytesWithOptions(patched, Infinity, false).parseDocument();
  const root = ctx.lookup(ctx.trailerInfo.Root);
  const fdf = root instanceof PDFDict ? ctx.lookupMaybe(root.get(PDFName.of('FDF')), PDFDict) : undefined;
  if (!fdf) throw new Error('This is not an FDF file (no /FDF dictionary).');
  const fileName = fdfFileName(ctx, fdf);

  const entries = ctx.lookupMaybe(fdf.get(PDFName.of('Annots')), PDFArray)?.asArray() ?? [];
  const annots: FdfAnnot[] = [];
  const byName = new Map<string, number>();
  const images = new Map<number, string>();
  for (const e of entries) {
    const raw = dict(toPdfValue(ctx, e));
    if (!raw) continue;
    const ref = e instanceof PDFRef ? e.objectNumber : 0;
    annots.push({ page: Math.max(0, num(raw.Page) ?? 0), ref, raw });
    const nm = str(raw.NM);
    if (nm && ref) byName.set(nm, ref);
    // An image markup's picture is an image XObject the annotation points at.
    const image = refNum(raw.Image);
    if (image !== null && !images.has(image)) {
      const url = await imageDataUrl(ctx.lookup(PDFRef.of(image)));
      if (url) images.set(image, url);
    }
  }
  // FDF names the annotation a reply belongs to by its /NM; a PDF points at it by reference.
  for (const a of annots) {
    const to = str(a.raw.IRT);
    const parent = to ? byName.get(to) : undefined;
    if (to !== null) a.raw = { ...a.raw, IRT: parent ? new PdfRefNum(parent) : null };
  }
  return { ctx, fileName, annots, images };
}

function fdfFileName(ctx: PDFContext, fdf: PDFDict): string {
  const f = ctx.lookup(fdf.get(PDFName.of('F')));
  if (f instanceof PDFString || f instanceof PDFHexString) return f.decodeText();
  const spec = f instanceof PDFDict ? ctx.lookup(f.get(PDFName.of('F'))) : null;
  return spec instanceof PDFString || spec instanceof PDFHexString ? spec.decodeText() : '';
}

/** One FDF annotation as the importer's view of a PDF annotation (page space, y down). */
function importable(index: number, a: FdfAnnot, toPage: (x: number, y: number) => [number, number]): ImportableAnnotation {
  const r = a.raw;
  const box = nums(r.Rect);
  const corners = box.length >= 4 ? [toPage(box[0]!, box[1]!), toPage(box[2]!, box[3]!)] : null;
  const rect = corners
    ? { x: Math.min(corners[0]![0], corners[1]![0]), y: Math.min(corners[0]![1], corners[1]![1]), w: Math.abs(corners[1]![0] - corners[0]![0]), h: Math.abs(corners[1]![1] - corners[0]![1]) }
    : { x: 0, y: 0, w: 0, h: 0 };
  const subtype = nameOf(r.Subtype) ?? 'Unknown';
  const line = nums(r.L);
  const quadPoints = nums(r.QuadPoints);
  const quads: [number, number][][] = [];
  for (let i = 0; i + 7 < quadPoints.length; i += 8) quads.push(pagePoints(quadPoints.slice(i, i + 8), toPage) as [number, number][]);
  const border = dict(r.BS);
  return {
    index,
    subtype,
    rect,
    color: colorHex(r.C),
    interior: colorHex(r.IC),
    opacity: num(r.CA) ?? 1,
    borderWidth: num(border?.W) ?? nums(r.Border)[2] ?? 1,
    contents: str(r.Contents) ?? '',
    author: str(r.T) ?? '',
    intent: nameOf(r.IT) ?? '',
    cloudy: dict(r.BE) !== null,
    multiply: nameOf(r.BM) === 'Multiply',
    objectNumber: a.ref,
    da: str(r.DA) ?? '',
    appData: str(r[APP_DATA_KEY]) ?? '',
    flags: num(r.F) ?? 0,
    vertices: subtype === 'Polygon' || subtype === 'PolyLine' ? (pagePoints(nums(r.Vertices), toPage) as [number, number][]) : [],
    ink: subtype === 'Ink' ? arr(r.InkList).map((g) => pagePoints(nums(g), toPage) as [number, number][]) : [],
    line: subtype === 'Line' && line.length >= 4 ? [toPage(line[0]!, line[1]!), toPage(line[2]!, line[3]!)] : null,
    ...(quads.length ? { quads } : {}),
    link: null,
  };
}

/** A PDF opened by a renderer (PDFium), as far as drawing annotations needs. */
export interface FdfRenderedPdf {
  pageCount: number;
  annotations(pageIndex: number): Promise<readonly { index: number; subtype: string; flags: number; appData: string }[]>;
  /** The annotation's own appearance as straight RGBA pixels, or null when it has none. */
  annotationImage(pageIndex: number, index: number, scale: number): Promise<{ width: number; height: number; rgba: Uint8Array } | null>;
  close(): void | Promise<void>;
}

export interface FdfOptions {
  /** Each page's size in PDF user space; with `open` it lets stamps and attachments be drawn. */
  pageSize?: (pageIndex: number) => { width: number; height: number } | null;
  /** Opens a PDF in a renderer. An FDF holds a stamp's appearance stream but cannot draw it, so it is drawn from a PDF built around it. */
  open?: (pdf: Uint8Array) => Promise<FdfRenderedPdf>;
}

const DRAWN = new Set(['Stamp', 'FileAttachment']);

/** A PDF whose pages carry the FDF's annotations as they are, so a renderer can draw their appearances. */
async function pdfAround(ctx: PDFContext, lists: readonly FdfAnnot[][], size: (i: number) => { width: number; height: number }): Promise<Uint8Array> {
  const refs = new Map<number, PDFRef>();
  const pages = lists.map((list, i) => {
    const { width, height } = size(i);
    const page = ctx.obj({
      Type: 'Page',
      MediaBox: [0, 0, width, height],
      Resources: {},
      Annots: list.map((a) => PDFRef.of(a.ref)),
    });
    const ref = ctx.register(page);
    refs.set(i, ref);
    return { page, ref };
  });
  const tree = ctx.obj({ Type: 'Pages', Kids: pages.map((p) => p.ref), Count: pages.length });
  const treeRef = ctx.register(tree);
  for (const { page } of pages) page.set(PDFName.of('Parent'), treeRef);
  ctx.trailerInfo.Root = ctx.register(ctx.obj({ Type: 'Catalog', Pages: treeRef }));
  return PDFWriter.forContext(ctx, 0).serializeToBuffer();
}

/** Pictures of the stamps and attachments, by `pageIndex:index`, drawn by the renderer. */
async function drawnPictures(ctx: PDFContext, lists: readonly FdfAnnot[][], options: FdfOptions): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!options.open || !options.pageSize) return out;
  const wanted = lists.some((l) => l.some((a) => DRAWN.has(nameOf(a.raw.Subtype) ?? '') && !str(a.raw[APP_DATA_KEY])));
  if (!wanted || lists.some((l) => l.some((a) => !a.ref))) return out;
  const size = (i: number) => options.pageSize!(i) ?? { width: 612, height: 792 };
  const doc = await options.open(await pdfAround(ctx, lists, size));
  try {
    for (let i = 0; i < Math.min(doc.pageCount, lists.length); i++) {
      for (const a of await doc.annotations(i)) {
        if (!DRAWN.has(a.subtype) || a.appData || a.flags & (1 | 2 | 32)) continue;
        const image = await doc.annotationImage(i, a.index, 3).catch(() => null);
        if (image) out.set(`${i}:${a.index}`, `data:image/png;base64,${base64(await encodePng(image.width, image.height, image.rgba))}`);
      }
    }
  } finally {
    await doc.close();
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The markups in an FDF file. `matrixFor` maps each page's space to PDF user space, as
 * `pageMatrix` does (pages the document does not have are dropped). Markups this app exported
 * come back exactly; Bluebeam's become the nearest markup type, their replies and review
 * states attached.
 */
export async function markupsFromFdf(bytes: Uint8Array | ArrayBuffer, matrixFor: (pageIndex: number) => Matrix | null, options: FdfOptions = {}): Promise<FdfImport> {
  const { ctx, fileName, annots, images } = await parseFdf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const pageCount = annots.reduce((n, a) => Math.max(n, a.page + 1), 0);
  const pages: PdfPageExtras[] = [];
  const lists: FdfAnnot[][] = [];
  for (let i = 0; i < pageCount; i++) {
    const list = annots.filter((a) => a.page === i);
    lists.push(list);
    pages.push({ matrix: (matrixFor(i) ?? [1, 0, 0, 1, 0, 0]) as PageMatrix, width: 0, height: 0, annots: list.map((a) => a.raw), objectNumbers: list.map((a) => a.ref), viewports: [], spaces: [] });
  }
  const extras: PdfExtras = { pages, ocgNames: new Map(), columns: [], images, appearances: await drawnPictures(ctx, lists, options).catch(() => new Map<string, string>()) };

  const markups: Markup[] = [];
  const skipped: string[] = [];
  lists.forEach((list, pageIndex) => {
    const matrix = matrixFor(pageIndex);
    if (!matrix) {
      if (list.length) skipped.push(`page ${pageIndex + 1}: the document has no such page (${list.length} annotation${list.length === 1 ? '' : 's'})`);
      return;
    }
    const toPage = userToPage(matrix as PageMatrix) as (x: number, y: number) => [number, number];
    const result = importAnnotations(pageIndex, list.map((a, i) => importable(i, a, toPage)), () => null, extras);
    for (const { pdfAnnot: _link, ...m } of result.markups) markups.push(m as Markup);
    const handled = new Set(result.imported);
    const owned = ownedByAnother(list);
    list.forEach((a, i) => {
      const subtype = nameOf(a.raw.Subtype) ?? 'Unknown';
      if (handled.has(i) || owned.has(i)) return;
      skipped.push(`page ${pageIndex + 1}: ${subtype}${str(a.raw.Subj) ? ` "${str(a.raw.Subj)}"` : ''} has no markup equivalent`);
    });
  });
  return { markups, fileName, skipped };
}

/** The annotations that belong to another (popups, replies, review states), which import folds into it. */
function ownedByAnother(list: readonly FdfAnnot[]): Set<number> {
  const at = new Map(list.map((a, i) => [a.ref, i]));
  const out = new Set<number>();
  list.forEach((a, i) => {
    const subtype = nameOf(a.raw.Subtype);
    if (subtype === 'Popup' || (refNum(a.raw.IRT) !== null && at.has(refNum(a.raw.IRT)!))) out.add(i);
  });
  return out;
}

// ---- Export -------------------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * An FDF file with the markups of a PDF (as this app saved them, with `exportWithAnnotations`):
 * every annotation but links and form fields, each tagged with its page, and replies naming the
 * annotation they answer by /NM as the format asks. Appearance streams go along, so another tool
 * draws each annotation as the PDF does.
 */
export async function fdfFromPdf(pdf: Uint8Array | ArrayBuffer, fileName = ''): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  const ctx = doc.context;
  const annots: PDFRef[] = [];
  doc.getPages().forEach((page, pageIndex) => {
    for (const entry of page.node.Annots()?.asArray() ?? []) {
      const a = ctx.lookupMaybe(entry, PDFDict);
      if (!(entry instanceof PDFRef) || !a) continue;
      const subtype = a.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? '';
      if (NOT_MARKUP.has(subtype)) continue;
      a.set(PDFName.of('Page'), PDFNumber.of(pageIndex));
      a.delete(PDFName.of('P'));
      a.delete(PDFName.of('StructParent'));
      annots.push(entry);
    }
  });

  // A reply points at its parent by /NM; give a parent without one a name.
  const nameOfAnnot = (ref: PDFRef): string | null => {
    const target = ctx.lookupMaybe(ref, PDFDict);
    if (!target) return null;
    const nm = target.get(PDFName.of('NM'));
    if (nm instanceof PDFString || nm instanceof PDFHexString) return nm.decodeText();
    const made = `annot-${ref.objectNumber}`;
    target.set(PDFName.of('NM'), PDFString.of(made));
    return made;
  };
  for (const ref of annots) {
    const a = ctx.lookup(ref, PDFDict);
    const irt = a.get(PDFName.of('IRT'));
    if (irt instanceof PDFRef) {
      const nm = nameOfAnnot(irt);
      if (nm) a.set(PDFName.of('IRT'), PDFString.of(nm));
      else a.delete(PDFName.of('IRT'));
    }
  }

  // Everything the annotations reach (appearances, fonts, popups), under its own object number.
  const reach = new Map<number, PDFRef>();
  const visit = (obj: PDFObject | undefined) => {
    if (obj instanceof PDFRef) {
      if (reach.has(obj.objectNumber)) return;
      reach.set(obj.objectNumber, obj);
      visit(ctx.lookup(obj));
    } else if (obj instanceof PDFArray) for (const x of obj.asArray()) visit(x);
    else if (obj instanceof PDFDict) for (const [, v] of obj.entries()) visit(v);
    else if (obj instanceof PDFStream) visit(obj.dict);
  };
  for (const ref of annots) visit(ref);

  const root = PDFRef.of(Math.max(0, ...reach.keys()) + 1);
  const catalog = ctx.obj({
    Version: PDFName.of('1.5'),
    FDF: { ...(fileName ? { F: PDFString.of(fileName) } : {}), Annots: annots },
  });
  const chunks: Uint8Array[] = [encoder.encode('%FDF-1.2\n%âãÏÓ\n')];
  const write = (ref: PDFRef, obj: PDFObject) => {
    const body = new Uint8Array(obj.sizeInBytes());
    obj.copyBytesInto(body, 0);
    chunks.push(encoder.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`), body, encoder.encode('\nendobj\n'));
  };
  for (const [, ref] of [...reach].sort((a, b) => a[0] - b[0])) {
    const obj = ctx.lookup(ref);
    if (obj) write(ref, obj);
  }
  write(root, catalog);
  chunks.push(encoder.encode(`trailer\n<</Root ${root.objectNumber} ${root.generationNumber} R>>\n%%EOF\n`));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
