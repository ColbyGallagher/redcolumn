import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject, type PDFPage } from 'pdf-lib';
import { addTagged, keepContentAsIs, removeTagged } from './taggedContent';
import { openForEdit } from './incremental';

// --- Flatten and Unflatten -------------------------------------------------------------------

const FLAT_TAG = 'NBFlatten';
/** Markups flattened one selection at a time: kept by Unflatten, which brings back only a whole-document flatten. */
const KEPT_TAG = 'NBFlattenKept';
/** Catalog key holding the flattened markups' data, for Unflatten (Allow Markup Recovery). */
const RECOVERY_KEY = 'NBFlattened';
/** Annotation flags: Hidden, NoView. */
const NOT_SHOWN = 2 | 32;
/** Annotations that stay interactive rather than being burned in. */
const KEEP = new Set(['Link', 'Widget', 'Popup']);

const num = (v: number) => (Math.round(v * 10000) / 10000).toString();

function numbers(arr: PDFArray | undefined, fallback: number[]): number[] {
  if (!arr) return fallback;
  return arr.asArray().map((o) => (o instanceof PDFNumber ? o.asNumber() : 0));
}

/** The appearance stream an annotation shows now (its /N, picking /AS among states). */
function normalAppearance(doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict);
  if (!ap) return null;
  const n = ap.get(PDFName.of('N'));
  const resolved = n instanceof PDFRef ? doc.context.lookup(n) : n;
  if (resolved instanceof PDFStream) return n instanceof PDFRef ? n : doc.context.register(resolved);
  if (resolved instanceof PDFDict) {
    const as = annot.get(PDFName.of('AS'));
    const state = as instanceof PDFName ? resolved.get(as) : undefined;
    return state instanceof PDFRef ? state : null;
  }
  return null;
}

/** What flattening does with one annotation: draws it into the page, removes it undrawn, or leaves it. */
export type FlattenChoice = 'flatten' | 'drop' | 'keep';

/**
 * Flatten: every markup annotation's appearance is drawn into its page (in a tagged content layer)
 * and the annotation removed; links and form fields stay interactive. With `recovery`, the markups'
 * data is kept in the file so Unflatten can bring them back. With `choose`, only some annotations
 * are flattened (or removed undrawn), the rest left as they are; Unflatten does not undo that.
 * Returns how many were flattened.
 */
export async function flattenAnnotations(
  bytes: ArrayBuffer | Uint8Array,
  recovery: string | null,
  choose?: (pageIndex: number, annot: PDFDict, index: number) => FlattenChoice,
): Promise<{ bytes: Uint8Array; count: number }> {
  const { doc, save } = await openForEdit(bytes);
  let count = 0;
  let serial = 0;
  for (const [pageIndex, page] of doc.getPages().entries()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    keepContentAsIs(page);
    const ops: string[] = [];
    const xobjects: [string, PDFRef][] = [];
    // XObject names not used on the page yet (it may have been flattened before).
    const existing = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    const freshName = () => {
      let name: string;
      do name = `${choose ? 'NBK' : 'NBF'}${serial++}`;
      while (existing?.has(PDFName.of(name)));
      return name;
    };
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookupMaybe(i, PDFDict);
      if (!annot) continue;
      const subtype = annot.get(PDFName.of('Subtype'));
      if (subtype instanceof PDFName && KEEP.has(subtype.decodeText())) continue;
      const choice = choose ? choose(pageIndex, annot, i) : 'flatten';
      if (choice === 'keep') continue;
      // Replies and pop-up notes have no appearance on the page; they go with their markup.
      const flags = annot.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
      const ref = normalAppearance(doc, annot);
      annots.remove(i);
      if (choice === 'drop') continue;
      count++;
      if (!ref || flags & NOT_SHOWN) continue;
      const stream = doc.context.lookup(ref) as PDFStream;
      stream.dict.set(PDFName.of('Type'), PDFName.of('XObject'));
      stream.dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
      const [bx0, by0, bx1, by1] = numbers(stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray), [0, 0, 1, 1]);
      const [a, b, c, d, e, f] = numbers(stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray), [1, 0, 0, 1, 0, 0]);
      const pts = [
        [bx0!, by0!],
        [bx1!, by0!],
        [bx1!, by1!],
        [bx0!, by1!],
      ].map(([x, y]) => [a! * x! + c! * y! + e!, b! * x! + d! * y! + f!]);
      const tx0 = Math.min(...pts.map((p) => p[0]!));
      const ty0 = Math.min(...pts.map((p) => p[1]!));
      const tx1 = Math.max(...pts.map((p) => p[0]!));
      const ty1 = Math.max(...pts.map((p) => p[1]!));
      const [rx0, ry0, rx1, ry1] = numbers(annot.lookupMaybe(PDFName.of('Rect'), PDFArray), [0, 0, 0, 0]);
      // The appearance's transformed box is mapped onto the annotation's rectangle (PDF 12.5.5).
      const sx = tx1 > tx0 ? (Math.max(rx0!, rx1!) - Math.min(rx0!, rx1!)) / (tx1 - tx0) : 1;
      const sy = ty1 > ty0 ? (Math.max(ry0!, ry1!) - Math.min(ry0!, ry1!)) / (ty1 - ty0) : 1;
      const name = freshName();
      xobjects.push([name, ref]);
      ops.unshift(`q ${num(sx)} 0 0 ${num(sy)} ${num(Math.min(rx0!, rx1!) - tx0 * sx)} ${num(Math.min(ry0!, ry1!) - ty0 * sy)} cm /${name} Do Q`);
    }
    if (!xobjects.length) continue;
    const resources = page.node.normalizedEntries().Resources;
    const xo = resources.lookupMaybe(PDFName.of('XObject'), PDFDict) ?? doc.context.obj({});
    for (const [name, ref] of xobjects) xo.set(PDFName.of(name), ref);
    resources.set(PDFName.of('XObject'), xo);
    addTagged(doc, page, choose ? KEPT_TAG : FLAT_TAG, ops.join('\n'));
  }
  if (recovery !== null) doc.catalog.set(PDFName.of(RECOVERY_KEY), PDFHexString.fromText(recovery));
  return { bytes: await save(), count };
}

/** Whether the file was flattened here with its markups kept for recovery. */
export async function canUnflatten(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.catalog.has(PDFName.of(RECOVERY_KEY));
}

/**
 * Unflatten: removes the flattened layer and returns the markups' data kept when flattening
 * (null when the file has none).
 */
export async function unflatten(bytes: ArrayBuffer | Uint8Array): Promise<{ bytes: Uint8Array; recovery: string | null }> {
  const { doc, save } = await openForEdit(bytes);
  const kept = doc.catalog.lookupMaybe(PDFName.of(RECOVERY_KEY), PDFString, PDFHexString);
  removeTagged(doc, FLAT_TAG);
  for (const page of doc.getPages()) {
    const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xo) continue;
    for (const key of xo.keys()) if (key.decodeText().startsWith('NBF')) xo.delete(key);
  }
  doc.catalog.delete(PDFName.of(RECOVERY_KEY));
  return { bytes: await save(), recovery: kept ? kept.decodeText() : null };
}

// --- Reduce File Size --------------------------------------------------------------------------

/**
 * Rebuilds the file from its pages alone: objects nothing uses any more (old revisions, deleted
 * pages, unused fonts and images, thumbnails) are left behind, and objects are packed into
 * compressed object streams. Document-level structure (outline, page labels, named
 * destinations) is rewritten from the app's own data when the file is saved.
 *
 * `recompress`, if given, re-encodes JPEG images (e.g. at a lower quality through a canvas); it
 * returns the new JPEG bytes, or null to keep an image as it is.
 */
export async function reduceFileSize(
  bytes: ArrayBuffer | Uint8Array,
  recompress?: (jpeg: Uint8Array, width: number, height: number) => Promise<Uint8Array | null>,
): Promise<{ bytes: Uint8Array; images: number }> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  // Keep the document information.
  const title = src.getTitle();
  const author = src.getAuthor();
  const subject = src.getSubject();
  const keywords = src.getKeywords();
  const creator = src.getCreator();
  const producer = src.getProducer();
  const created = src.getCreationDate();
  const modified = src.getModificationDate();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
  if (subject) out.setSubject(subject);
  if (keywords) out.setKeywords(keywords.split(/\s+/));
  if (creator) out.setCreator(creator);
  if (producer) out.setProducer(producer);
  if (created) out.setCreationDate(created);
  if (modified) out.setModificationDate(modified);
  let images = 0;
  if (recompress) {
    for (const [, obj] of out.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = obj.dict;
      if (d.get(PDFName.of('Subtype')) !== PDFName.of('Image') || d.get(PDFName.of('Filter')) !== PDFName.of('DCTDecode')) continue;
      // CMYK JPEGs and images with decode arrays or masks are left alone.
      const cs = d.get(PDFName.of('ColorSpace'));
      if (cs !== PDFName.of('DeviceRGB') && cs !== PDFName.of('DeviceGray')) continue;
      if (d.has(PDFName.of('Decode')) || d.has(PDFName.of('SMask')) || d.has(PDFName.of('Mask'))) continue;
      const w = d.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
      const h = d.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
      const smaller = await recompress(obj.contents, w, h);
      if (!smaller || smaller.length >= obj.contents.length) continue;
      (obj as unknown as { contents: Uint8Array }).contents = smaller;
      d.set(PDFName.of('Length'), PDFNumber.of(smaller.length));
      // A re-encoded JPEG is always RGB (a canvas has no greyscale output).
      d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      d.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      images++;
    }
  }
  return { bytes: await out.save({ useObjectStreams: true }), images };
}

// --- Colour Processing ---------------------------------------------------------------------------

/**
 * Grey, black (everything but white), or one colour replaced with another (colours within
 * `tolerance`, 0–1 per channel, of `replace` become `with`; #rrggbb).
 */
export type ColourMode = 'grayscale' | 'black' | { replace: string; with: string; tolerance: number };

const rgbOfHex = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** A colour turned grey (luminance) or, for `black`, to black unless it is (near) white. */
function convert(mode: 'grayscale' | 'black', gray: number): number {
  if (mode === 'grayscale') return gray;
  return gray > 0.95 ? 1 : 0;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Rewrites colour operators in a content stream: RGB, CMYK and grey fill and stroke colours become
 * grey (or black). Colours set with sc/scn in other colour spaces are converted by their number of
 * components (1 grey, 3 RGB, 4 CMYK); patterns are left alone. Strings, inline images and
 * comments are copied through untouched.
 */
export function recolourContent(src: string, mode: ColourMode): string {
  let out = '';
  let i = 0;
  const operands: string[] = [];
  // Text since the last operator, and where its first operand starts in it.
  let pending = '';
  let opStart = -1;
  const flush = () => {
    out += pending;
    pending = '';
    opStart = -1;
    operands.length = 0;
  };
  const operand = (text: string, token: string) => {
    if (opStart < 0) opStart = pending.length;
    pending += text;
    operands.push(token);
  };
  const isNum = (t: string) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t);
  const replaceColour = (op: string): string | null => {
    const stroke = op === op.toUpperCase();
    const nums = operands.map(Number);
    let gray: number | null = null;
    const low = op.toLowerCase();
    if (typeof mode === 'object') {
      // Replace one colour: RGB and grey colours near it (sc/scn only with three components).
      let rgb: [number, number, number] | null = null;
      if (low === 'g' && nums.length >= 1) rgb = [nums.at(-1)!, nums.at(-1)!, nums.at(-1)!];
      else if (low === 'rg' && nums.length >= 3) rgb = [nums.at(-3)!, nums.at(-2)!, nums.at(-1)!];
      else if (low === 'k' && nums.length >= 4) {
        const [c, m, y, k] = nums.slice(-4) as [number, number, number, number];
        rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
      } else if ((low === 'sc' || low === 'scn') && nums.length === 3 && operands.every(isNum)) rgb = [nums[0]!, nums[1]!, nums[2]!];
      if (!rgb) return null;
      const from = rgbOfHex(mode.replace);
      if (rgb.some((v, i) => Math.abs(v - from[i]!) > mode.tolerance + 1e-6)) return null;
      const to = rgbOfHex(mode.with).map(num).join(' ');
      if (low === 'sc' || low === 'scn') return `${to} ${op}`;
      return `${to} ${stroke ? 'RG' : 'rg'}`;
    }
    if (low === 'g' && nums.length >= 1) gray = nums.at(-1)!;
    else if (low === 'rg' && nums.length >= 3) gray = lum(nums.at(-3)!, nums.at(-2)!, nums.at(-1)!);
    else if (low === 'k' && nums.length >= 4) {
      const [c, m, y, k] = nums.slice(-4) as [number, number, number, number];
      gray = lum((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
    } else if ((low === 'sc' || low === 'scn') && operands.every(isNum)) {
      if (nums.length === 1) gray = nums[0]!;
      else if (nums.length === 3) gray = lum(nums[0]!, nums[1]!, nums[2]!);
      else if (nums.length === 4) gray = lum((1 - nums[0]!) * (1 - nums[3]!), (1 - nums[1]!) * (1 - nums[3]!), (1 - nums[2]!) * (1 - nums[3]!));
    }
    if (gray === null) return null;
    const v = num(convert(mode, Math.max(0, Math.min(1, gray))));
    // sc/scn keep their colour space, so write the grey in it; the others become plain grey.
    if (low === 'sc' || low === 'scn') {
      const k = nums.length;
      const vals = k === 4 ? ['0', '0', '0', num(1 - Number(v))] : Array(k).fill(v);
      return `${vals.join(' ')} ${op}`;
    }
    return `${v} ${stroke ? 'G' : 'g'}`;
  };

  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      pending += ch;
      i++;
      continue;
    }
    if (ch === '%') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      pending += src.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '(') {
      // Literal string with nesting and escapes.
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        const c = src[j]!;
        if (c === '\\') {
          j++;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) break;
      }
      operand(src.slice(i, j + 1), '(');
      i = j + 1;
      continue;
    }
    if (ch === '<' && src[i + 1] !== '<') {
      const j = src.indexOf('>', i);
      operand(src.slice(i, j + 1), '<');
      i = j + 1;
      continue;
    }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}' || (ch === '<' && src[i + 1] === '<') || (ch === '>' && src[i + 1] === '>')) {
      const t = ch === '<' || ch === '>' ? src.slice(i, i + 2) : ch;
      operand(t, t);
      i += t.length;
      continue;
    }
    // A token: number, name, or operator.
    let j = i + 1;
    while (j < src.length && !/[\s()<>[\]{}/%]/.test(src[j]!)) j++;
    const tok = src.slice(i, j);
    i = j;
    if (tok.startsWith('/') || isNum(tok) || tok === 'true' || tok === 'false' || tok === 'null') {
      operand(tok, tok);
      continue;
    }
    // Operator.
    if (tok === 'BI') {
      // Inline image: copy everything to the end of its data (EI after whitespace).
      const m = /\sEI(?=[\s]|$)/g;
      m.lastIndex = src.indexOf('ID', i);
      const hit = m.exec(src);
      const stop = hit ? hit.index + hit[0].length : src.length;
      pending += tok + src.slice(i, stop);
      i = stop;
      flush();
      continue;
    }
    if (['g', 'G', 'rg', 'RG', 'k', 'K', 'sc', 'SC', 'scn', 'SCN'].includes(tok)) {
      const nums = operands.filter((o) => isNum(o));
      const opsCount = operands.length;
      // Only rewrite when the operands are the numbers themselves (no pattern names).
      const replacement = nums.length === opsCount && opsCount ? replaceColour(tok) : null;
      if (replacement !== null) {
        // The new colour replaces the operands and the operator.
        pending = pending.slice(0, opStart) + replacement;
        flush();
        continue;
      }
    }
    pending += tok;
    flush();
  }
  flush();
  return out;
}

/** Decoded content of a stream (Flate or none); null for filters we cannot rewrite. */
function streamText(obj: PDFObject): string | null {
  if (!(obj instanceof PDFRawStream)) return null;
  const filter = obj.dict.get(PDFName.of('Filter'));
  if (filter && filter !== PDFName.of('FlateDecode')) return null;
  try {
    // One character per byte, so writing it back gives the same bytes.
    const data = decodePDFRawStream(obj).decode();
    let text = '';
    for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
    return text;
  } catch {
    return null;
  }
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Colour Processing: turns the vector content of pages (and forms they use) grey, or black where it
 * is not white. Pictures are left as they are.
 */
export async function recolourPages(
  bytes: ArrayBuffer | Uint8Array,
  pages: readonly number[],
  mode: ColourMode,
  /** Re-encodes a JPEG picture grey (or black and white); null to keep it. Without it JPEGs keep their colours. */
  recolourJpeg?: (jpeg: Uint8Array, mode: 'grayscale' | 'black') => Promise<Uint8Array | null>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const done = new Set<PDFRef | PDFObject>();
  const pictures: PDFRawStream[] = [];
  const rewrite = (ref: PDFRef | PDFObject | undefined) => {
    if (!ref || done.has(ref)) return;
    done.add(ref);
    const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    const text = obj ? streamText(obj) : null;
    if (text === null || !(obj instanceof PDFRawStream)) return;
    const next = doc.context.flateStream(latin1(recolourContent(text, mode)));
    for (const [k, v] of obj.dict.entries()) if (k !== PDFName.of('Filter') && k !== PDFName.of('Length') && k !== PDFName.of('DecodeParms')) next.dict.set(k, v);
    if (ref instanceof PDFRef) doc.context.assign(ref, next);
    // Forms drawn by this stream.
    const xo = next.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, v] of xo?.entries() ?? []) rewriteForm(v);
  };
  const rewriteForm = (ref: PDFObject) => {
    const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) rewrite(ref);
    else if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') && !pictures.includes(obj)) pictures.push(obj);
  };
  const all = doc.getPages();
  for (const i of pages) {
    const page: PDFPage | undefined = all[i];
    if (!page) continue;
    const contents = page.node.get(PDFName.of('Contents'));
    const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
    const list = resolved instanceof PDFArray ? resolved.asArray() : contents ? [contents] : [];
    for (const c of list) rewrite(c);
    const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, v] of xo?.entries() ?? []) rewriteForm(v);
  }
  // Pictures turn grey (or black and white) too; replacing one colour leaves them.
  if (typeof mode === 'string') for (const img of pictures) await recolourPicture(doc, img, mode, recolourJpeg);
  return doc.save();
}

/**
 * A picture turned grey (DeviceGray), or black and white: 8-bit RGB and grey pictures stored
 * uncompressed or with Flate are converted here; JPEGs through `recolourJpeg`.
 */
async function recolourPicture(doc: PDFDocument, img: PDFRawStream, mode: 'grayscale' | 'black', recolourJpeg?: (jpeg: Uint8Array, mode: 'grayscale' | 'black') => Promise<Uint8Array | null>) {
  const d = img.dict;
  const filter = d.get(PDFName.of('Filter'));
  const cs = d.get(PDFName.of('ColorSpace'));
  const bpc = d.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber() ?? 8;
  if (d.has(PDFName.of('Decode')) || d.get(PDFName.of('ImageMask'))?.toString() === 'true') return;
  if (filter === PDFName.of('DCTDecode')) {
    if (!recolourJpeg || (cs !== PDFName.of('DeviceRGB') && cs !== PDFName.of('DeviceGray'))) return;
    const out = await recolourJpeg(img.contents, mode);
    if (!out) return;
    (img as unknown as { contents: Uint8Array }).contents = out;
    d.set(PDFName.of('Length'), PDFNumber.of(out.length));
    // A canvas writes three-channel JPEGs (grey pixels, RGB data).
    d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    return;
  }
  if ((filter && filter !== PDFName.of('FlateDecode')) || d.has(PDFName.of('DecodeParms')) || bpc !== 8) return;
  const channels = cs === PDFName.of('DeviceRGB') ? 3 : cs === PDFName.of('DeviceGray') ? 1 : 0;
  if (!channels) return;
  let data: Uint8Array;
  try {
    data = decodePDFRawStream(img).decode();
  } catch {
    return;
  }
  const w = d.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
  const h = d.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
  if (data.length < w * h * channels) return;
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = channels === 3 ? 0.299 * data[i * 3]! + 0.587 * data[i * 3 + 1]! + 0.114 * data[i * 3 + 2]! : data[i]!;
    grey[i] = mode === 'black' ? (v > 242 ? 255 : 0) : Math.round(v);
  }
  const next = doc.context.flateStream(grey);
  for (const [k, v] of d.entries()) if (k !== PDFName.of('Filter') && k !== PDFName.of('Length') && k !== PDFName.of('DecodeParms')) next.dict.set(k, v);
  next.dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
  const ref = doc.context.getObjectRef(img);
  if (ref) doc.context.assign(ref, next);
}

// --- Metadata -------------------------------------------------------------------------------------

/** The document without its metadata: the information dictionary's fields, XMP and PieceInfo. */
export async function stripMetadata(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  doc.catalog.delete(PDFName.of('Metadata'));
  doc.catalog.delete(PDFName.of('PieceInfo'));
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of('Metadata'));
    page.node.delete(PDFName.of('PieceInfo'));
  }
  const info = doc.context.trailerInfo.Info;
  if (info) {
    const dict = doc.context.lookup(info, PDFDict);
    for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) dict.delete(PDFName.of(key));
  }
  return doc.save({ useObjectStreams: true });
}

/**
 * Flattens some markups: `bytes` has them written as annotations whose /NM is the markup id
 * (`ids`), which are drawn into their pages; the PDF's own annotations they stood for (`drop`, by
 * page and /Annots position, with their replies and states) are removed undrawn. Everything else
 * stays as it was.
 */
export function flattenSelection(bytes: ArrayBuffer | Uint8Array, ids: ReadonlySet<string>, drop: Record<number, readonly number[]>) {
  return flattenAnnotations(bytes, null, (page, annot, index) => {
    if (drop[page]?.includes(index)) return 'drop';
    const nm = annot.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText();
    return nm && ids.has(nm) ? 'flatten' : 'keep';
  });
}
