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
 * checked to be object `n` `g` when given, and where its "endobj" ends.
 */
function objectAt(bytes: Uint8Array, offset: number, ctx: PDFContext, expect?: { n: number; g: number }): { obj: PDFObject; end: number } {
  const head = /^(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj/.exec(latin1(bytes.subarray(offset, offset + 64)));
  if (!head) throw new Error('No object there');
  if (expect && (Number(head[1]) !== expect.n || Number(head[2]) !== expect.g)) throw new Error('Another object there');
  const start = offset + head[0].length;
  const parser = StrictParser.of(bytes.subarray(start), ctx);
  const obj = parser.parseObject();
  const after = skipBlank(bytes, start + parser.at());
  if (!startsWith(bytes, after, 'endobj')) throw new Error('No endobj');
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

/** Object `n` `g` of a file, found as a reader would through its cross-reference (object streams too). */
function resolve(bytes: Uint8Array, latest: Map<number, XrefEntry>, n: number, g: number, ctx: PDFContext): PDFObject {
  const e = latest.get(n);
  if (e?.type === 1 && e.gen === g) return objectAt(bytes, e.offset, ctx, { n, g }).obj;
  if (e?.type !== 2 || g !== 0) throw new Error(`Object ${n} ${g} is not in the file`);
  const holder = latest.get(e.offset);
  if (holder?.type !== 1) throw new Error(`Object ${n} ${g} is not in the file`);
  const { obj: stream } = objectAt(bytes, holder.offset, ctx, { n: e.offset, g: holder.gen });
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

/**
 * The highest object number the file refers to anywhere ("n g R", including inside object
 * streams), whether or not it defines it: a later update defining such a number would fill in
 * something the signed version left out.
 */
async function highestReferenced(bytes: Uint8Array): Promise<number> {
  let max = 0;
  for (const m of latin1(bytes).matchAll(/(?<![0-9])(\d{1,9})[\0\t\n\f\r ]+\d{1,5}[\0\t\n\f\r ]+R(?![A-Za-z0-9])/g)) max = Math.max(max, Number(m[1]));
  // Object streams are compressed: pdf-lib reads them.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const stack: PDFObject[] = doc.context.enumerateIndirectObjects().map(([, o]) => o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) max = Math.max(max, o.objectNumber);
    else if (o instanceof PDFDict) stack.push(...o.values());
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFRawStream) stack.push(o.dict);
  }
  return max;
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
 * the document shows or holds. Both versions are read as a reader would, through their
 * cross-references, never by what pdf-lib makes of the file:
 *
 * - the sections appended after the signed version lead back to it, and may define new objects
 *   and the catalog anew, nothing else, and outside an object stream;
 * - a new object's number is above any the signed version uses or refers to;
 * - the appended bytes are, end to end, those objects where the sections list them, the sections,
 *   startxref lines, white space and comments: nothing a reader rebuilding the table could find;
 * - the catalog differs from the signed version's only in /DSS and the ESIC extension, and no
 *   dictionary read names a key twice;
 * - the trailer names the same catalog and document information, and neither is encrypted.
 */
export async function onlyValidationAdded(full: Uint8Array, signedLength: number): Promise<boolean> {
  try {
    const signed = full.subarray(0, signedLength);
    const ctx = PDFContext.create();
    const signedStart = lastXref(signed).offset;
    const before = xrefChain(signed, signedStart, 0, ctx).sections;
    const signedTrailer = before[0]!.trailer;
    const signedLatest = latestEntries(before);
    const root = signedTrailer.get(PDFName.of('Root'));
    if (!(root instanceof PDFRef) || signedTrailer.get(PDFName.of('Encrypt'))) return false;

    const { sections, end } = xrefChain(full, lastXref(full).offset, signedLength, ctx);
    // The chain must lead back to the signed version itself.
    if (!sections.length || end !== signedStart) return false;
    for (const s of sections) {
      const t = s.trailer;
      if (t.get(PDFName.of('Encrypt')) || refText(t.get(PDFName.of('Root'))) !== root.toString() || refText(t.get(PDFName.of('Info'))) !== refText(signedTrailer.get(PDFName.of('Info'))) || refText(t.get(PDFName.of('Info'))) === 'direct') return false;
    }

    // Object numbers below this are the signed version's, defined or referred to: an update may
    // define only the catalog among them.
    const oldSize = Math.max(highestObjectNumber(signed) + 1, num(signedTrailer.get(PDFName.of('Size'))) ?? 0, ...[...signedLatest.keys()].map((n) => n + 1), (await highestReferenced(signed)) + 1);

    // What the appended sections define, by where.
    const listed = new Map<number, { n: number; g: number }>();
    for (const s of sections)
      for (const [n, e] of s.entries) {
        if (e.type === 2) return false;
        if (e.type !== 1) continue;
        if (e.offset < signedLength) {
          if (n >= oldSize) return false;
          continue;
        }
        const other = listed.get(e.offset);
        if (other && (other.n !== n || other.g !== e.gen)) return false;
        listed.set(e.offset, { n, g: e.gen });
      }
    // The appended bytes, end to end: each piece must be one of those, a section, or a startxref line.
    const sectionEnds = new Map(sections.map((s) => [s.at, s.end]));
    const found = new Set<number>();
    for (let p = signedLength; ; ) {
      p = skipBlank(full, p);
      if (p >= full.length) break;
      const sectionEnd = sectionEnds.get(p);
      if (sectionEnd !== undefined) {
        found.add(p);
        p = sectionEnd;
      } else if (startsWith(full, p, 'startxref')) {
        const m = /^startxref[\0\t\n\f\r ]+\d+/.exec(latin1(full.subarray(p, p + 40)));
        if (!m) return false;
        p += m[0].length;
      } else {
        const l = listed.get(p);
        if (!l) return false;
        const { obj, end: after } = objectAt(full, p, ctx, l);
        if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Type')) === PDFName.of('ObjStm')) return false;
        found.add(p);
        p = after;
      }
    }
    for (const at of [...listed.keys(), ...sectionEnds.keys()]) if (!found.has(at)) return false;

    // The newest definition of each object number the updates touch: new ones, or the catalog.
    const latest = latestEntries(sections);
    let catalogAt: number | null = null;
    for (const [n, e] of latest) {
      if (n >= oldSize || (n === 0 && e.type === 0)) continue;
      if (n === root.objectNumber && e.type === 1 && e.gen === root.generationNumber) catalogAt = e.offset;
      else return false;
    }
    if (catalogAt === null) return true;

    const newCatalog = objectAt(full, catalogAt, ctx, { n: root.objectNumber, g: root.generationNumber }).obj;
    const oldCatalog = resolve(signed, signedLatest, root.objectNumber, root.generationNumber, ctx);
    if (!(newCatalog instanceof PDFDict) || !(oldCatalog instanceof PDFDict) || entriesBut(newCatalog, ['DSS', 'Extensions']) !== entriesBut(oldCatalog, ['DSS', 'Extensions'])) return false;
    // Extensions: the same, but for an ESIC entry.
    const oldExt = oldCatalog.get(PDFName.of('Extensions'));
    const newExt = newCatalog.get(PDFName.of('Extensions'));
    if (refText(oldExt) !== refText(newExt) || refText(newExt) === 'direct') {
      const lookup = (v: PDFObject | undefined): PDFObject | undefined => {
        if (!(v instanceof PDFRef)) return v;
        if (v.objectNumber < oldSize) return resolve(signed, signedLatest, v.objectNumber, v.generationNumber, ctx);
        const e = latest.get(v.objectNumber);
        if (!e || e.type !== 1) throw new Error('Unreadable extensions');
        return objectAt(full, e.offset, ctx, { n: v.objectNumber, g: v.generationNumber }).obj;
      };
      const [o, n] = [lookup(oldExt), lookup(newExt)];
      if (o !== undefined && !(o instanceof PDFDict)) return false;
      if (!(n instanceof PDFDict) || entriesBut(n, ['ESIC']) !== (o ? entriesBut(o, ['ESIC']) : '')) return false;
      if (o?.get(PDFName.of('ESIC')) && ser(o.get(PDFName.of('ESIC'))!) !== ser(n.get(PDFName.of('ESIC')) ?? PDFString.of(''))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
