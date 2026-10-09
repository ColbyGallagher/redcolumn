import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';

/** One optional-content group (a PDF layer). */
export interface PdfLayer {
  /** The group's object reference ("12 0"), stable for the file. */
  id: string;
  name: string;
  /** Shown when the file opens (the default configuration). */
  on: boolean;
  /** The file asks for it not to be switched. */
  locked: boolean;
  /** Nesting depth in the file's layer order (0 at the top). */
  depth: number;
}

const key = (ref: PDFRef) => `${ref.objectNumber} ${ref.generationNumber}`;

function text(v: unknown): string {
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';
}

/** The PDF's layers, in its own display order (then any the order leaves out). */
export async function readLayers(bytes: ArrayBuffer | Uint8Array): Promise<PdfLayer[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  if (!props) return [];
  const ocgs = props.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  const d = props.lookupMaybe(PDFName.of('D'), PDFDict);
  const refs = (arr: PDFArray | undefined) => new Set((arr?.asArray() ?? []).filter((x): x is PDFRef => x instanceof PDFRef).map(key));
  const off = refs(d?.lookupMaybe(PDFName.of('OFF'), PDFArray));
  const locked = refs(d?.lookupMaybe(PDFName.of('Locked'), PDFArray));
  const baseOff = d?.get(PDFName.of('BaseState')) === PDFName.of('OFF');
  const on = refs(d?.lookupMaybe(PDFName.of('ON'), PDFArray));
  const all = new Map<string, PDFRef>();
  for (const x of ocgs?.asArray() ?? []) if (x instanceof PDFRef) all.set(key(x), x);
  const layer = (ref: PDFRef, depth: number): PdfLayer => {
    const dict = doc.context.lookup(ref, PDFDict);
    const id = key(ref);
    return { id, name: text(dict.get(PDFName.of('Name'))) || `Layer ${id}`, on: baseOff ? on.has(id) : !off.has(id), locked: locked.has(id), depth };
  };
  const out: PdfLayer[] = [];
  const seen = new Set<string>();
  // /Order nests arrays under the layer before them; a string first in an array is a group label.
  const walk = (arr: PDFArray, depth: number) => {
    for (const x of arr.asArray()) {
      if (x instanceof PDFRef && all.has(key(x)) && !seen.has(key(x))) {
        seen.add(key(x));
        out.push(layer(x, depth));
      } else {
        const inner = x instanceof PDFArray ? x : x instanceof PDFRef ? doc.context.lookupMaybe(x, PDFArray) : undefined;
        if (inner) walk(inner, depth + 1);
      }
    }
  };
  const order = d?.lookupMaybe(PDFName.of('Order'), PDFArray);
  if (order) walk(order, 0);
  for (const [id, ref] of all) if (!seen.has(id)) out.push(layer(ref, 0));
  return out;
}

/**
 * A copy of the file whose default layer states hide `hidden` (and show every other layer), for
 * viewing: renderers draw the default configuration.
 */
export async function withLayersShown(bytes: ArrayBuffer | Uint8Array, hidden: ReadonlySet<string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  const ocgs = props?.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (!props || !ocgs) return new Uint8Array(bytes);
  let d = props.lookupMaybe(PDFName.of('D'), PDFDict);
  if (!d) {
    d = doc.context.obj({});
    props.set(PDFName.of('D'), d);
  }
  const refs = ocgs.asArray().filter((x): x is PDFRef => x instanceof PDFRef);
  d.set(PDFName.of('BaseState'), PDFName.of('ON'));
  d.set(PDFName.of('ON'), doc.context.obj(refs.filter((r) => !hidden.has(key(r)))));
  d.set(PDFName.of('OFF'), doc.context.obj(refs.filter((r) => hidden.has(key(r)))));
  // Visibility set here wins over any automatic states (by zoom or print) the file asks for.
  d.delete(PDFName.of('AS'));
  return doc.save({ useObjectStreams: false });
}

/**
 * The layers each page draws with, by id: the optional content its resources (and the forms they
 * draw) refer to, directly or through a membership dictionary.
 */
export async function layersOnPages(bytes: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ocgs = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)?.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  const all = new Set((ocgs?.asArray() ?? []).filter((x): x is PDFRef => x instanceof PDFRef).map(key));
  if (!all.size) return doc.getPages().map(() => []);
  const ocgsOf = (x: unknown, out: Set<string>) => {
    if (x instanceof PDFRef && all.has(key(x))) return void out.add(key(x));
    const dict = x instanceof PDFRef ? doc.context.lookupMaybe(x, PDFDict) : x instanceof PDFDict ? x : undefined;
    const members = dict?.get(PDFName.of('OCGs'));
    const list = members instanceof PDFRef ? (doc.context.lookup(members) instanceof PDFArray ? doc.context.lookup(members, PDFArray).asArray() : [members]) : members instanceof PDFArray ? members.asArray() : [];
    for (const m of list) if (m instanceof PDFRef && all.has(key(m))) out.add(key(m));
  };
  const scan = (res: PDFDict | undefined, out: Set<string>, seen: Set<PDFDict>) => {
    if (!res || seen.has(res)) return;
    seen.add(res);
    const props = res.lookupMaybe(PDFName.of('Properties'), PDFDict);
    for (const [, v] of props?.entries() ?? []) ocgsOf(v, out);
    const xobjects = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, v] of xobjects?.entries() ?? []) {
      const xo = doc.context.lookup(v);
      const dict = xo && 'dict' in xo ? (xo as { dict: PDFDict }).dict : undefined;
      if (!dict) continue;
      ocgsOf(dict.get(PDFName.of('OC')), out);
      scan(dict.lookupMaybe(PDFName.of('Resources'), PDFDict), out, seen);
    }
  };
  return doc.getPages().map((page) => {
    const out = new Set<string>();
    const res = page.node.getInheritableAttribute(PDFName.of('Resources'));
    scan(res instanceof PDFRef ? doc.context.lookupMaybe(res, PDFDict) : res instanceof PDFDict ? res : undefined, out, new Set());
    for (const a of page.node.Annots()?.asArray() ?? []) {
      const annot = doc.context.lookupMaybe(a, PDFDict);
      ocgsOf(annot?.get(PDFName.of('OC')), out);
    }
    return [...out];
  });
}
