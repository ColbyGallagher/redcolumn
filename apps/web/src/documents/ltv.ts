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
  // New objects numbered as `onlyValidationAdded` expects them.
  ctx.largestObjectNumber = Math.max(ctx.largestObjectNumber, (await firstNewObjectNumber(bytes)) - 1);
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
  /** 0 free, 1 at an offset, 2 in an object stream (offset: the stream's number, gen: the index in it). */
  type: number;
  offset: number;
  gen: number;
}

interface XrefSection {
  /** Where it starts and where it ends (after the trailer, or after the stream's endobj). */
  at: number;
  end: number;
  entries: Map<number, XrefEntry>;
  trailer: PDFDict;
  prev: number | null;
  /** A hybrid file's cross-reference stream, read after this table's own entries. */
  xrefStm: number | null;
}

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
/** PDF white-space characters (ISO 32000-2 7.2.3). */
const isWhite = (c: number | undefined) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;

/** Where `word` next appears in `bytes` from `from`, or -1. */
function indexOfWord(bytes: Uint8Array, word: string, from: number): number {
  const w = new TextEncoder().encode(word);
  outer: for (let i = from; i + w.length <= bytes.length; i++) {
    for (let k = 0; k < w.length; k++) if (bytes[i + k] !== w[k]) continue outer;
    return i;
  }
  return -1;
}
const startsWith = (bytes: Uint8Array, at: number, word: string) => indexOfWord(bytes.subarray(at, at + word.length), word, 0) === 0;

/** Past white space and comments from `at`. */
function skipBlank(bytes: Uint8Array, at: number): number {
  for (;;) {
    if (isWhite(bytes[at])) at++;
    else if (bytes[at] === 0x25) while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at++;
    else return at;
  }
}

/** Undoes a PNG predictor (DecodeParms /Predictor 10-15) on rows of `columns` bytes, as cross-reference streams use. */
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

/**
 * pdf-lib's object parser, but a dictionary that names a key twice is refused: readers differ on
 * which value wins, so two readers could see two different documents. One pass, like pdf-lib's own.
 */
class StrictParser extends PDFObjectParser {
  static of(bytes: Uint8Array, ctx: PDFContext) {
    // pdf-lib does not export its byte stream; its own parser makes one.
    return new StrictParser((PDFObjectParser.forBytes(bytes, ctx) as unknown as { bytes: ConstructorParameters<typeof PDFObjectParser>[0] }).bytes, ctx);
  }
  /** Where parsing has got to, from the start of the bytes given. */
  at(): number {
    return this.bytes.offset();
  }
  protected override parseDict(): PDFDict {
    this.bytes.assertNext(0x3c);
    this.bytes.assertNext(0x3c);
    this.skipWhitespaceAndComments();
    const dict = new Map<PDFName, PDFObject>();
    while (!this.bytes.done() && this.bytes.peek() !== 0x3e && this.bytes.peekAhead(1) !== 0x3e) {
      const key = this.parseName();
      if (dict.has(key)) throw new Error(`The key ${key.toString()} is given twice`);
      dict.set(key, this.parseObject());
      this.skipWhitespaceAndComments();
    }
    this.skipWhitespaceAndComments();
    this.bytes.assertNext(0x3e);
    this.bytes.assertNext(0x3e);
    return PDFDict.fromMapWithContext(dict, this.context);
  }
}

/**
 * The indirect object defined at `offset` ("n g obj ... endobj", nothing but white space between),
 * checked to be object `n` `g` when given, and where its "endobj" ends. `lenient` reads a version
 * already signed as readers do: white space before the header, and no "endobj", are let pass.
 */
function objectAt(bytes: Uint8Array, offset: number, ctx: PDFContext, expect?: { n: number; g: number }, lenient = false): { obj: PDFObject; end: number } {
  const head = (lenient ? /^[\0\t\n\f\r ]*(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj/ : /^(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj/).exec(latin1(bytes.subarray(offset, offset + 64)));
  if (!head) throw new Error('No object there');
  if (expect && (Number(head[1]) !== expect.n || Number(head[2]) !== expect.g)) throw new Error('Another object there');
  const start = offset + head[0].length;
  const parser = StrictParser.of(bytes.subarray(start), ctx);
  const obj = parser.parseObject();
  const after = skipBlank(bytes, start + parser.at());
  if (!startsWith(bytes, after, 'endobj')) {
    if (lenient) return { obj, end: after };
    throw new Error('No endobj');
  }
  return { obj, end: after + 6 };
}

/** The cross-reference section (table or stream) at `offset`, read as a reader would. */
function xrefAt(bytes: Uint8Array, offset: number, ctx: PDFContext): XrefSection {
  const entries = new Map<number, XrefEntry>();
  if (startsWith(bytes, offset, 'xref')) {
    const end = indexOfWord(bytes, 'trailer', offset);
    if (end < 0) throw new Error('No trailer');
    const tokens = latin1(bytes.subarray(offset + 4, end)).trim().split(/[\0\t\n\f\r ]+/);
    for (let i = 0; i < tokens.length; ) {
      const start = Number(tokens[i++]);
      const count = Number(tokens[i++]);
      if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0) throw new Error('Unreadable cross-reference table');
      for (let k = 0; k < count; k++, i += 3) {
        const [o, g, t] = [tokens[i], tokens[i + 1], tokens[i + 2]];
        // Entries are exactly 10 and 5 digits (ISO 32000-2 7.5.4).
        if (!o || !g || !/^\d{10}$/.test(o) || !/^\d{5}$/.test(g) || (t !== 'n' && t !== 'f')) throw new Error('Unreadable cross-reference table');
        if (!entries.has(start + k)) entries.set(start + k, { type: t === 'n' ? 1 : 0, offset: Number(o), gen: Number(g) });
      }
    }
    const parser = StrictParser.of(bytes.subarray(end + 7), ctx);
    const trailer = parser.parseObject();
    if (!(trailer instanceof PDFDict)) throw new Error('Unreadable trailer');
    return { at: offset, end: end + 7 + parser.at(), entries, trailer, prev: num(trailer.get(PDFName.of('Prev'))), xrefStm: num(trailer.get(PDFName.of('XRefStm'))) };
  }
  const { obj: stream, end } = objectAt(bytes, offset, ctx);
  if (!(stream instanceof PDFRawStream) || stream.dict.get(PDFName.of('Type')) !== PDFName.of('XRef')) throw new Error('No cross-reference there');
  const dict = stream.dict;
  const w = dict.lookup(PDFName.of('W'), PDFArray).asArray().map(num);
  if (w.length !== 3 || w.some((x) => x === null || x < 0 || x > 8)) throw new Error('Unreadable cross-reference stream');
  const [w0, w1, w2] = w as [number, number, number];
  const rowSize = w0 + w1 + w2;
  let data = decodePDFRawStream(stream).decode();
  const parms = dict.lookupMaybe(PDFName.of('DecodeParms'), PDFDict);
  const predictor = num(parms?.get(PDFName.of('Predictor'))) ?? 1;
  if (predictor >= 10) {
    // Rows of whole entries, one byte a sample: anything else a reader would read otherwise.
    if ((num(parms?.get(PDFName.of('Colors'))) ?? 1) !== 1 || (num(parms?.get(PDFName.of('BitsPerComponent'))) ?? 8) !== 8 || (num(parms?.get(PDFName.of('Columns'))) ?? 1) !== rowSize) throw new Error('Unreadable cross-reference stream');
    data = unpredict(data, rowSize);
  } else if (predictor !== 1) throw new Error('Unreadable cross-reference stream');
  const size = num(dict.get(PDFName.of('Size'))) ?? 0;
  const index = dict.lookupMaybe(PDFName.of('Index'), PDFArray)?.asArray().map(num) ?? [0, size];
  const field = (at: number, width: number) => {
    let v = 0;
    for (let k = 0; k < width; k++) v = v * 256 + data[at + k]!;
    return v;
  };
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
  return { at: offset, end, entries, trailer: dict, prev: num(dict.get(PDFName.of('Prev'))), xrefStm: null };
}

/**
 * The cross-reference sections from `start` back along /Prev, newest first, while they start at or
 * after `from` (a hybrid table's stream right after it). `end` is where the walk stopped: the
 * first /Prev before `from`, or null when the chain ended.
 */
function xrefChain(bytes: Uint8Array, start: number, from: number, ctx: PDFContext): { sections: XrefSection[]; end: number | null } {
  const sections: XrefSection[] = [];
  const visited = new Set<number>();
  for (let at: number | null = start; at !== null; ) {
    if (at < from) return { sections, end: at };
    if (visited.has(at) || sections.length > 256) throw new Error('A cross-reference loop');
    visited.add(at);
    const section = xrefAt(bytes, at, ctx);
    sections.push(section);
    if (section.xrefStm !== null) sections.push(xrefAt(bytes, section.xrefStm, ctx));
    at = section.prev;
  }
  return { sections, end: null };
}

/** The newest entry for each object number, from sections newest first. */
function latestEntries(sections: readonly XrefSection[]): Map<number, XrefEntry> {
  const latest = new Map<number, XrefEntry>();
  for (const s of sections) for (const [n, e] of s.entries) if (!latest.has(n)) latest.set(n, e);
  return latest;
}

/**
 * Object `n` `g` of a version already checked (or signed), found as a reader would through its
 * cross-reference (object streams too), and read as leniently.
 */
function resolve(bytes: Uint8Array, latest: Map<number, XrefEntry>, n: number, g: number, ctx: PDFContext): PDFObject {
  const e = latest.get(n);
  if (e?.type === 1 && e.gen === g) return objectAt(bytes, e.offset, ctx, { n, g }, true).obj;
  if (e?.type !== 2 || g !== 0) throw new Error(`Object ${n} ${g} is not in the file`);
  const holder = latest.get(e.offset);
  if (holder?.type !== 1) throw new Error(`Object ${n} ${g} is not in the file`);
  const { obj: stream } = objectAt(bytes, holder.offset, ctx, { n: e.offset, g: holder.gen }, true);
  if (!(stream instanceof PDFRawStream) || stream.dict.get(PDFName.of('Type')) !== PDFName.of('ObjStm')) throw new Error('Not an object stream');
  const data = decodePDFRawStream(stream).decode();
  const first = num(stream.dict.get(PDFName.of('First')));
  const count = num(stream.dict.get(PDFName.of('N')));
  if (first === null || count === null) throw new Error('Unreadable object stream');
  const header = latin1(data.subarray(0, first)).trim().split(/[\0\t\n\f\r ]+/).map(Number);
  // The index in the cross-reference says which; the number there must agree.
  if (e.gen >= count || header[e.gen * 2] !== n) throw new Error(`Object ${n} ${g} is not in its object stream`);
  return StrictParser.of(data.subarray(first + header[e.gen * 2 + 1]!), ctx).parseObject();
}

const LOAD = { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false } as const;
/** "n g R" anywhere in a file. */
const REFERENCE = /(?<![0-9])(\d{1,9})[\0\t\n\f\r ]+\d{1,5}[\0\t\n\f\r ]+R(?![A-Za-z0-9])/g;
/**
 * An object header as readers find one, comments between its parts included. Each separator is
 * one white-space character or a whole comment up to its line end, so there is one way to match
 * (no backtracking blow-up on runs of "%").
 */
const HEADER = /(?<![0-9])\d{1,9}(?:[\0\t\n\f\r ]|%[^\r\n]*[\r\n])+\d{1,5}(?:[\0\t\n\f\r ]|%[^\r\n]*[\r\n])+obj/g;

/**
 * The first object number an update to `bytes` may define: above every number the file defines,
 * lists (in a cross-reference or a /Size) or refers to ("n g R", inside object streams too). Add
 * LTV numbers its objects from here and `onlyValidationAdded` holds each update to it, so the two
 * agree. An update defining a number the file referred to but left out would fill something in.
 */
export async function firstNewObjectNumber(bytes: Uint8Array): Promise<number> {
  let max = highestObjectNumber(bytes);
  for (const m of latin1(bytes).matchAll(REFERENCE)) max = Math.max(max, Number(m[1]));
  try {
    for (const s of xrefChain(bytes, lastXref(bytes).offset, 0, PDFContext.create()).sections) for (const n of s.entries.keys()) max = Math.max(max, n);
  } catch {
    // A cross-reference this cannot read lists nothing more than the headers and /Size above.
  }
  // Object streams are compressed: pdf-lib reads them.
  const doc = await PDFDocument.load(bytes, LOAD);
  max = Math.max(max, doc.context.largestObjectNumber);
  const stack: PDFObject[] = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) stack.push(o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) max = Math.max(max, o.objectNumber);
    else if (o instanceof PDFDict) for (const v of o.values()) stack.push(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) stack.push(v);
    else if (o instanceof PDFRawStream) stack.push(o.dict);
  }
  return max + 1;
}

const ser = (o: PDFObject | undefined) => {
  if (o === undefined) return '';
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
/** Past white space only (Add LTV writes no comments) from `at`. */
const skipWhite = (bytes: Uint8Array, at: number) => {
  while (isWhite(bytes[at])) at++;
  return at;
};

/** The DSS's lists, with what a /VRI entry calls each. */
const LISTS = { Certs: 'Cert', OCSPs: 'OCSP', CRLs: 'CRL' } as const;
/** What a trailer of Add LTV's update holds: a cross-reference table's, and a stream's besides. */
const TRAILER_KEYS = ['Size', 'Root', 'Info', 'ID', 'Prev'];
const XREF_STREAM_KEYS = [...TRAILER_KEYS, 'Type', 'Index', 'W', 'Length'];

/** A stream as Add LTV keeps a certificate or an answer: compressed, and nothing else said of it. */
const isDataStream = (o: PDFObject | undefined) => o instanceof PDFRawStream && o.dict.keys().length === 2 && o.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode') && o.dict.get(PDFName.of('Length')) instanceof PDFNumber;

/**
 * Whether everything `full` adds after its first `signedLength` bytes (a signed version of it)
 * is validation data, written as `addDss` writes it: one incremental update at a time, each
 * holding a new DSS, the streams it keeps, and the catalog again with /DSS (and the ESIC extension)
 * changed, nothing else. Updates made any other way, even only validation data, count as changes:
 * proving an arbitrary update harmless is harder than recognizing this app's own. Both versions
 * are read as a reader would, through their cross-references, never by what pdf-lib makes of the file.
 */
export async function onlyValidationAdded(full: Uint8Array, signedLength: number): Promise<boolean> {
  try {
    const ctx = PDFContext.create();
    const signed = full.subarray(0, signedLength);
    const signedStart = lastXref(signed).offset;
    const before = xrefChain(signed, signedStart, 0, ctx).sections;
    const signedTrailer = before[0]!.trailer;
    if (!(signedTrailer.get(PDFName.of('Root')) instanceof PDFRef) || signedTrailer.get(PDFName.of('Encrypt'))) return false;
    const { sections, end } = xrefChain(full, lastXref(full).offset, signedLength, ctx);
    // The chain must lead back to the signed version itself.
    if (!sections.length || end !== signedStart) return false;
    // Each update in turn, oldest first, against the version before it.
    const known = latestEntries(before);
    let from = signedLength;
    let prev = { xref: signedStart, trailer: signedTrailer };
    for (const s of sections.reverse()) {
      const next = await oneValidationUpdate(full, from, prev, s, known, ctx);
      if (next === null) return false;
      for (const [n, e] of s.entries) known.set(n, e);
      from = next;
      prev = { xref: s.at, trailer: s.trailer };
    }
    // Nothing after the last %%EOF but white space.
    return skipWhite(full, from) === full.length;
  } catch {
    return false;
  }
}

/**
 * Whether the update from `from` to the end of section `s` is one `addDss` wrote over the version
 * before it (whose cross-reference is at `prev.xref`, its objects in `known`): where it ends if so.
 */
async function oneValidationUpdate(full: Uint8Array, from: number, prev: { xref: number; trailer: PDFDict }, s: XrefSection, known: Map<number, XrefEntry>, ctx: PDFContext): Promise<number | null> {
  if (s.prev !== prev.xref || s.xrefStm !== null || s.at < from) return null;
  const table = startsWith(full, s.at, 'xref');
  // The section, then a startxref naming it, then %%EOF.
  const tail = /^[\0\t\n\f\r ]*startxref[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+%%EOF/.exec(latin1(full.subarray(s.end, s.end + 64)));
  if (!tail || Number(tail[1]) !== s.at) return null;

  // The trailer: the same catalog and document information, nothing encrypted, nothing more.
  const t = s.trailer;
  const root = prev.trailer.get(PDFName.of('Root'));
  if (!(root instanceof PDFRef)) return null;
  if (t.keys().some((k) => !(table ? TRAILER_KEYS : XREF_STREAM_KEYS).includes(k.decodeText()))) return null;
  if (refText(t.get(PDFName.of('Root'))) !== root.toString() || refText(t.get(PDFName.of('Info'))) !== refText(prev.trailer.get(PDFName.of('Info'))) || refText(t.get(PDFName.of('Info'))) === 'direct') return null;

  // What the section lists: the catalog, objects numbered from the first new number, and (for a
  // cross-reference stream) the stream itself, each at its own place in this update.
  const first = await firstNewObjectNumber(full.subarray(0, from));
  const listed = new Map<number, { n: number; g: number }>();
  const fresh = new Set<number>();
  let self = false;
  for (const [n, e] of s.entries) {
    if (e.type !== 1) return null;
    if (e.offset === s.at) {
      if (table || self || n < first || e.gen !== 0) return null;
      objectAt(full, s.at, ctx, { n, g: 0 });
      self = true;
      continue;
    }
    if (e.offset < from || e.offset >= s.at || listed.has(e.offset)) return null;
    if (n === root.objectNumber) {
      if (e.gen !== root.generationNumber) return null;
    } else if (n < first || e.gen !== 0) return null;
    else fresh.add(n);
    listed.set(e.offset, { n, g: e.gen });
  }
  if (!table && !self) return null;
  // No header anywhere but where the section lists one, stream data included: a reader
  // rebuilding the cross-reference would find it.
  for (const m of latin1(full.subarray(from, s.at)).matchAll(HEADER)) if (!listed.has(from + m.index)) return null;
  // The update's bytes, end to end: those objects and white space.
  const objects = new Map<number, PDFObject>();
  for (let p = skipWhite(full, from); p < s.at; p = skipWhite(full, p)) {
    const l = listed.get(p);
    if (!l) return null;
    const { obj, end } = objectAt(full, p, ctx, l);
    objects.set(l.n, obj);
    p = end;
  }
  if (objects.size !== listed.size) return null;

  // Objects of the version before, as it has them.
  const old = (v: PDFObject | undefined): PDFObject | undefined => (v instanceof PDFRef ? resolve(full, known, v.objectNumber, v.generationNumber, ctx) : v);
  const newCatalog = objects.get(root.objectNumber);
  const oldCatalog = old(root);
  if (!(newCatalog instanceof PDFDict) || !(oldCatalog instanceof PDFDict) || entriesBut(newCatalog, ['DSS', 'Extensions']) !== entriesBut(oldCatalog, ['DSS', 'Extensions'])) return null;

  // Extensions: unchanged, or the ones before, direct, with Add LTV's ESIC entry added.
  const oldExt = oldCatalog.get(PDFName.of('Extensions'));
  const newExt = newCatalog.get(PDFName.of('Extensions'));
  if (ser(oldExt) !== ser(newExt)) {
    const o = old(oldExt);
    if (!(newExt instanceof PDFDict) || (o !== undefined && !(o instanceof PDFDict)) || o?.get(PDFName.of('ESIC'))) return null;
    if (entriesBut(newExt, ['ESIC']) !== (o ? entriesBut(o, ['ESIC']) : '')) return null;
    if (ser(newExt.get(PDFName.of('ESIC'))) !== ser(ctx.obj({ BaseVersion: PDFName.of('1.7'), ExtensionLevel: 5 }))) return null;
  }

  // The DSS: new, keeping all the one before kept, adding only streams of this update.
  const dssRef = newCatalog.get(PDFName.of('DSS'));
  if (!(dssRef instanceof PDFRef) || !fresh.has(dssRef.objectNumber)) return null;
  const dss = objects.get(dssRef.objectNumber);
  if (!(dss instanceof PDFDict) || dss.get(PDFName.of('Type')) !== PDFName.of('DSS')) return null;
  const was = old(oldCatalog.get(PDFName.of('DSS')));
  const oldDss = was instanceof PDFDict ? was : undefined;
  if (was !== undefined && !oldDss) return null;
  const kept = new Set<number>();
  const inLists = new Map<string, Set<string>>();
  for (const [name] of Object.entries(LISTS)) {
    const before = old(oldDss?.get(PDFName.of(name)));
    const oldItems = before instanceof PDFArray ? before.asArray() : [];
    const now = dss.get(PDFName.of(name));
    if (now === undefined && !oldItems.length) continue;
    if (!(now instanceof PDFArray) || now.size() < oldItems.length) return null;
    const items = now.asArray();
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (i < oldItems.length) {
        if (ser(item) !== ser(oldItems[i])) return null;
        continue;
      }
      if (!(item instanceof PDFRef) || !fresh.has(item.objectNumber) || !isDataStream(objects.get(item.objectNumber))) return null;
      kept.add(item.objectNumber);
    }
    inLists.set(name, new Set(items.map((i) => ser(i))));
  }
  const vri = dss.get(PDFName.of('VRI'));
  const oldVriObj = old(oldDss?.get(PDFName.of('VRI')));
  const oldVri = oldVriObj instanceof PDFDict ? oldVriObj : undefined;
  if (vri !== undefined && !(vri instanceof PDFDict)) return null;
  // Every entry the one before had, and each new one naming what the DSS keeps.
  for (const k of oldVri?.keys() ?? []) if (!vri?.has(k)) return null;
  for (const [k, v] of vri?.entries() ?? []) {
    if (oldVri?.has(k) && ser(oldVri.get(k)) === ser(v)) continue;
    if (!/^[0-9A-F]{40}$/.test(k.decodeText()) || !(v instanceof PDFDict)) return null;
    for (const [kind, list] of v.entries()) {
      const name = Object.entries(LISTS).find(([, n]) => n === kind.decodeText())?.[0];
      if (!name || !(list instanceof PDFArray)) return null;
      for (const r of list.asArray()) if (!(r instanceof PDFRef) || !inLists.get(name)?.has(ser(r))) return null;
    }
  }
  // Anything else the DSS says, it said before.
  for (const [k, v] of dss.entries()) if (!['Type', 'VRI', ...Object.keys(LISTS)].includes(k.decodeText()) && (!oldDss?.has(k) || ser(oldDss.get(k)) !== ser(v))) return null;
  for (const [k, v] of oldDss?.entries() ?? []) if (!['Type', 'VRI', ...Object.keys(LISTS)].includes(k.decodeText()) && ser(dss.get(k)) !== ser(v)) return null;
  // And nothing new that the DSS does not keep.
  for (const n of fresh) if (n !== dssRef.objectNumber && !kept.has(n)) return null;
  return s.end + tail[0].length;
}
