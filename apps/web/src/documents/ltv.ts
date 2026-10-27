import { decodePDFRawStream, PDFArray, PDFContext, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObjectParser, PDFRawStream, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { highestObjectNumber, lastXref, saveIncremental, snapshot } from './incremental';

/**
 * Long-term validation (LTV, PAdES B-LT): the certificates and revocation answers a signature
 * needs to be checked are kept in the PDF, in its Document Security Store (/DSS, ISO 32000-2
 * 12.8.4.3), so it can still be checked once the CA's OCSP responder and CRLs are gone or the
 * certificate has expired. The store is added in an incremental update after signing, which
 * PAdES allows without breaking the signature (or a certification that allows no changes).
 */

export interface Dss {
  certs: Uint8Array[];
  ocsps: Uint8Array[];
  crls: Uint8Array[];
  /** Per signature (its /VRI key, see `vriKey`): the answers kept for it. */
  vri: Map<string, { ocsps: Uint8Array[]; crls: Uint8Array[] }>;
}

/** What one signature needs: its /VRI key (see `vriKey`; empty for none) and the data checked for it. */
export interface ValidationEntry {
  vri: string;
  certs: Uint8Array[];
  ocsps: Uint8Array[];
  crls: Uint8Array[];
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (b: Uint8Array) => hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b as BufferSource)));

/** A signature's key in /VRI: the SHA-1 of its /Contents (as stored, padding included), upper-case hex. */
export async function vriKey(contents: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', contents as BufferSource))).toUpperCase();
}

function streamBytes(obj: PDFObject | undefined): Uint8Array | null {
  if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode();
  return null;
}

/** The validation data in the PDF's DSS (none when it has none). */
export function readDss(doc: PDFDocument): Dss {
  const dss = doc.catalog.lookupMaybe(PDFName.of('DSS'), PDFDict);
  const streams = (arr: PDFArray | undefined) => {
    const out: Uint8Array[] = [];
    for (const r of arr?.asArray() ?? []) {
      try {
        const b = streamBytes(doc.context.lookup(r));
        if (b) out.push(b);
      } catch {
        // A stream this app cannot decode is not validation data it can use.
      }
    }
    return out;
  };
  const list = (name: string) => streams(dss?.lookupMaybe(PDFName.of(name), PDFArray));
  const vri: Dss['vri'] = new Map();
  const vriDict = dss?.lookupMaybe(PDFName.of('VRI'), PDFDict);
  for (const [key, value] of vriDict?.entries() ?? []) {
    const entry = doc.context.lookup(value);
    if (!(entry instanceof PDFDict)) continue;
    vri.set(key.decodeText().toUpperCase(), { ocsps: streams(entry.lookupMaybe(PDFName.of('OCSP'), PDFArray)), crls: streams(entry.lookupMaybe(PDFName.of('CRL'), PDFArray)) });
  }
  return { certs: list('Certs'), ocsps: list('OCSPs'), crls: list('CRLs'), vri };
}

/**
 * The PDF with the entries' validation data added to its DSS, each piece once, and a /VRI entry
 * per signature, as an incremental update. Nothing already in the file is changed: the DSS (and
 * the catalog's /Extensions) are written anew, so `onlyValidationAdded` can tell the update apart.
 */
export async function addDss(bytes: Uint8Array, entries: readonly ValidationEntry[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const before = snapshot(doc, bytes);
  const ctx = doc.context;
  const old = doc.catalog.lookupMaybe(PDFName.of('DSS'), PDFDict);
  const dss = ctx.obj({});
  for (const [k, v] of old?.entries() ?? []) dss.set(k, v);
  dss.set(PDFName.of('Type'), PDFName.of('DSS'));
  const kinds = { certs: 'Certs', ocsps: 'OCSPs', crls: 'CRLs' } as const;
  // What is already there, by content, so nothing is stored twice.
  const known = new Map<string, PDFRef>();
  const arrays = {} as Record<keyof typeof kinds, PDFArray>;
  for (const [kind, name] of Object.entries(kinds) as [keyof typeof kinds, string][]) {
    const arr = ctx.obj([]);
    for (const r of old?.lookupMaybe(PDFName.of(name), PDFArray)?.asArray() ?? []) {
      arr.push(r);
      if (!(r instanceof PDFRef)) continue;
      try {
        const b = streamBytes(ctx.lookup(r));
        if (b) known.set(`${kind}:${await sha256Hex(b)}`, r);
      } catch {
        // Kept as it is.
      }
    }
    arrays[kind] = arr;
  }
  const put = async (kind: keyof typeof kinds, data: Uint8Array): Promise<PDFRef> => {
    const k = `${kind}:${await sha256Hex(data)}`;
    let ref = known.get(k);
    if (!ref) {
      ref = ctx.register(ctx.flateStream(data));
      arrays[kind].push(ref);
      known.set(k, ref);
    }
    return ref;
  };
  const vri = ctx.obj({});
  for (const [k, v] of old?.lookupMaybe(PDFName.of('VRI'), PDFDict)?.entries() ?? []) vri.set(k, v);
  for (const e of entries) {
    const entry = ctx.obj({});
    for (const [kind, name] of [['certs', 'Cert'], ['ocsps', 'OCSP'], ['crls', 'CRL']] as const) {
      const refs = new Set<PDFRef>();
      for (const d of e[kind]) refs.add(await put(kind, d));
      if (refs.size) entry.set(PDFName.of(name), ctx.obj([...refs]));
    }
    if (e.vri) vri.set(PDFName.of(e.vri), entry);
  }
  for (const [kind, name] of Object.entries(kinds) as [keyof typeof kinds, string][]) {
    if (arrays[kind].size()) dss.set(PDFName.of(name), arrays[kind]);
    else dss.delete(PDFName.of(name));
  }
  if (vri.keys().length) dss.set(PDFName.of('VRI'), vri);
  doc.catalog.set(PDFName.of('DSS'), ctx.register(dss));
  // A DSS in a PDF 1.x file is the ESIC extension; PDF 2.0 has it built in.
  const version = doc.catalog.get(PDFName.of('Version'));
  const pdf2 = /%PDF-2\./.test(ctx.header.toString()) || (version instanceof PDFName && version.decodeText().startsWith('2'));
  const oldExt = doc.catalog.lookupMaybe(PDFName.of('Extensions'), PDFDict);
  if (!pdf2 && !oldExt?.get(PDFName.of('ESIC'))) {
    const ext = ctx.obj({});
    for (const [k, v] of oldExt?.entries() ?? []) ext.set(k, v);
    ext.set(PDFName.of('ESIC'), ctx.obj({ BaseVersion: PDFName.of('1.7'), ExtensionLevel: 5 }));
    doc.catalog.set(PDFName.of('Extensions'), ext);
  }
  return saveIncremental(bytes, doc, before);
}

// --- What a later update changed -----------------------------------------------------------------

interface XrefEntry {
  /** 0 free, 1 at an offset, 2 in an object stream. */
  type: number;
  offset: number;
  gen: number;
}

interface XrefSection {
  entries: Map<number, XrefEntry>;
  trailer: PDFDict;
  prev: number | null;
}

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** Undoes a PNG predictor (DecodeParms /Predictor 10-15), as cross-reference streams use. */
function unpredict(data: Uint8Array, columns: number): Uint8Array {
  const row = columns + 1;
  if (data.length % row) throw new Error('Unreadable cross-reference stream');
  const out = new Uint8Array((data.length / row) * columns);
  for (let r = 0; r < data.length / row; r++) {
    const kind = data[r * row]!;
    for (let c = 0; c < columns; c++) {
      const x = data[r * row + 1 + c]!;
      const left = c ? out[r * columns + c - 1]! : 0;
      const up = r ? out[(r - 1) * columns + c]! : 0;
      const upLeft = r && c ? out[(r - 1) * columns + c - 1]! : 0;
      let v: number;
      if (kind === 0) v = x;
      else if (kind === 1) v = x + left;
      else if (kind === 2) v = x + up;
      else if (kind === 3) v = x + ((left + up) >> 1);
      else if (kind === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        v = x + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else throw new Error('Unreadable cross-reference stream');
      out[r * columns + c] = v & 0xff;
    }
  }
  return out;
}

const num = (v: PDFObject | undefined) => (v instanceof PDFNumber ? v.asNumber() : null);

/** The indirect object defined at `offset` ("n g obj ..."), checked to be object `n` `g` when given. */
function objectAt(bytes: Uint8Array, offset: number, ctx: PDFContext, expect?: { n: number; g: number }): PDFObject {
  const head = /^\s*(\d+)\s+(\d+)\s+obj\b/.exec(latin1(bytes.subarray(offset, offset + 64)));
  if (!head) throw new Error('No object there');
  if (expect && (Number(head[1]) !== expect.n || Number(head[2]) !== expect.g)) throw new Error('Another object there');
  return PDFObjectParser.forBytes(bytes.subarray(offset + head[0].length), ctx).parseObject();
}

/** The cross-reference section (table or stream) at `offset`, read as a reader would. */
function xrefAt(bytes: Uint8Array, offset: number, ctx: PDFContext): XrefSection {
  const entries = new Map<number, XrefEntry>();
  if (latin1(bytes.subarray(offset, offset + 4)) === 'xref') {
    const text = latin1(bytes.subarray(offset));
    const end = text.indexOf('trailer');
    if (end < 0) throw new Error('No trailer');
    const tokens = text.slice(4, end).trim().split(/\s+/);
    for (let i = 0; i < tokens.length; ) {
      const start = Number(tokens[i++]);
      const count = Number(tokens[i++]);
      if (!Number.isInteger(start) || !Number.isInteger(count)) throw new Error('Unreadable cross-reference table');
      for (let k = 0; k < count; k++, i += 3) {
        const [o, g, t] = [tokens[i], tokens[i + 1], tokens[i + 2]];
        if (!o || !g || (t !== 'n' && t !== 'f')) throw new Error('Unreadable cross-reference table');
        if (!entries.has(start + k)) entries.set(start + k, { type: t === 'n' ? 1 : 0, offset: Number(o), gen: Number(g) });
      }
    }
    const trailer = PDFObjectParser.forBytes(bytes.subarray(offset + end + 7), ctx).parseObject();
    if (!(trailer instanceof PDFDict)) throw new Error('Unreadable trailer');
    // A hybrid file's extra stream section: not something validation data needs.
    if (trailer.get(PDFName.of('XRefStm'))) throw new Error('Hybrid cross-reference');
    return { entries, trailer, prev: num(trailer.get(PDFName.of('Prev'))) };
  }
  const stream = objectAt(bytes, offset, ctx);
  if (!(stream instanceof PDFRawStream) || stream.dict.get(PDFName.of('Type')) !== PDFName.of('XRef')) throw new Error('No cross-reference there');
  const dict = stream.dict;
  const w = dict.lookup(PDFName.of('W'), PDFArray).asArray().map(num);
  if (w.length !== 3 || w.some((x) => x === null || x < 0 || x > 8)) throw new Error('Unreadable cross-reference stream');
  const [w0, w1, w2] = w as [number, number, number];
  let data = decodePDFRawStream(stream).decode();
  const parms = dict.lookupMaybe(PDFName.of('DecodeParms'), PDFDict);
  const predictor = num(parms?.get(PDFName.of('Predictor'))) ?? 1;
  if (predictor >= 10) data = unpredict(data, num(parms?.get(PDFName.of('Columns'))) ?? 1);
  else if (predictor !== 1) throw new Error('Unreadable cross-reference stream');
  const size = num(dict.get(PDFName.of('Size'))) ?? 0;
  const index = dict.lookupMaybe(PDFName.of('Index'), PDFArray)?.asArray().map(num) ?? [0, size];
  const field = (at: number, width: number) => {
    let v = 0;
    for (let k = 0; k < width; k++) v = v * 256 + data[at + k]!;
    return v;
  };
  const rowSize = w0 + w1 + w2;
  let at = 0;
  for (let i = 0; i + 1 < index.length; i += 2) {
    const [start, count] = [index[i], index[i + 1]];
    if (start === null || start === undefined || count === null || count === undefined) throw new Error('Unreadable cross-reference stream');
    for (let k = 0; k < count; k++, at += rowSize) {
      if (at + rowSize > data.length) throw new Error('Unreadable cross-reference stream');
      const type = w0 ? field(at, w0) : 1;
      if (!entries.has(start + k)) entries.set(start + k, { type, offset: field(at + w0, w1), gen: w2 ? field(at + w0 + w1, w2) : 0 });
    }
  }
  return { entries, trailer: dict, prev: num(dict.get(PDFName.of('Prev'))) };
}

const ser = (o: PDFObject) => {
  const b = new Uint8Array(o.sizeInBytes());
  o.copyBytesInto(b, 0);
  return latin1(b);
};
/** A dictionary's entries, serialized, except those named. */
const entriesBut = (d: PDFDict, skip: string[]) =>
  d
    .entries()
    .filter(([k]) => !skip.includes(k.decodeText()))
    .map(([k, v]) => `${k.toString()} ${ser(v)}`)
    .sort()
    .join('\n');
const refText = (v: PDFObject | undefined) => (v === undefined ? '' : v instanceof PDFRef ? v.toString() : 'direct');

/**
 * Whether everything `full` adds after its first `signedLength` bytes (a signed version of it)
 * is validation data: a new DSS and the ESIC extension entry, and nothing that could change what
 * the document shows or holds. Read as a reader would, from the cross-reference sections appended
 * after the signed version: they may define new objects and the catalog anew, and nothing else.
 * The catalog may differ only in /DSS and the ESIC extension; the trailer must name the same
 * catalog and document information, and neither version may be encrypted.
 */
export async function onlyValidationAdded(full: Uint8Array, signedLength: number): Promise<boolean> {
  try {
    const signed = full.subarray(0, signedLength);
    const ctx = PDFContext.create();
    const signedXref = lastXref(signed);
    const signedTrailer = xrefAt(signed, signedXref.offset, ctx).trailer;
    const root = signedTrailer.get(PDFName.of('Root'));
    if (!(root instanceof PDFRef) || signedTrailer.get(PDFName.of('Encrypt'))) return false;
    // Object numbers below this are the signed version's: an update may not redefine or free them.
    const oldSize = Math.max(highestObjectNumber(signed) + 1, num(signedTrailer.get(PDFName.of('Size'))) ?? 0);

    const sections: XrefSection[] = [];
    for (let at = lastXref(full).offset; ; ) {
      if (at < signedLength) {
        // The chain must lead back to the signed version itself.
        if (at !== signedXref.offset || !sections.length) return false;
        break;
      }
      if (sections.length > 64) return false;
      const section = xrefAt(full, at, ctx);
      sections.push(section);
      if (section.prev === null) return false;
      at = section.prev;
    }
    for (const s of sections) {
      const t = s.trailer;
      if (t.get(PDFName.of('Encrypt')) || refText(t.get(PDFName.of('Root'))) !== root.toString() || refText(t.get(PDFName.of('Info'))) !== refText(signedTrailer.get(PDFName.of('Info'))) || refText(t.get(PDFName.of('Info'))) === 'direct') return false;
    }
    // The newest definition of each object number the updates touch.
    const latest = new Map<number, XrefEntry>();
    for (const s of sections) for (const [n, e] of s.entries) if (!latest.has(n)) latest.set(n, e);
    let catalogAt: number | null = null;
    for (const [n, e] of latest) {
      if (n >= oldSize || (n === 0 && e.type === 0)) continue;
      if (n === root.objectNumber && e.type === 1 && e.gen === root.generationNumber) catalogAt = e.offset;
      else return false;
    }
    if (catalogAt === null) return true;

    const newCatalog = objectAt(full, catalogAt, ctx, { n: root.objectNumber, g: root.generationNumber });
    const before = await PDFDocument.load(signed, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const oldCatalog = before.catalog;
    if (!(newCatalog instanceof PDFDict) || entriesBut(newCatalog, ['DSS', 'Extensions']) !== entriesBut(oldCatalog, ['DSS', 'Extensions'])) return false;
    // Extensions: the same, but for an ESIC entry.
    const oldExt = oldCatalog.get(PDFName.of('Extensions'));
    const newExt = newCatalog.get(PDFName.of('Extensions'));
    if (refText(oldExt) !== refText(newExt) || refText(newExt) === 'direct') {
      const resolve = (v: PDFObject | undefined): PDFObject | undefined => {
        if (!(v instanceof PDFRef)) return v;
        if (v.objectNumber < oldSize) return before.context.lookup(v);
        const e = latest.get(v.objectNumber);
        if (!e || e.type !== 1) throw new Error('Unreadable extensions');
        return objectAt(full, e.offset, ctx, { n: v.objectNumber, g: v.generationNumber });
      };
      const [o, n] = [resolve(oldExt), resolve(newExt)];
      if (o !== undefined && !(o instanceof PDFDict)) return false;
      if (!(n instanceof PDFDict) || entriesBut(n, ['ESIC']) !== (o ? entriesBut(o, ['ESIC']) : '')) return false;
      if (o?.get(PDFName.of('ESIC')) && ser(o.get(PDFName.of('ESIC'))!) !== ser(n.get(PDFName.of('ESIC')) ?? PDFString.of(''))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
