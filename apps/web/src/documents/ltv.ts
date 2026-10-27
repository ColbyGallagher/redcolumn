import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';
import { saveIncremental, snapshot } from './incremental';

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
}

/** What one signature needs: its /VRI key (see `vriKey`) and the data checked for it. */
export interface ValidationEntry {
  vri: string;
  certs: Uint8Array[];
  ocsps: Uint8Array[];
  crls: Uint8Array[];
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

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
  const list = (name: string) => {
    const arr = dss?.lookupMaybe(PDFName.of(name), PDFArray);
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
  return { certs: list('Certs'), ocsps: list('OCSPs'), crls: list('CRLs') };
}

/**
 * The PDF with the entries' validation data added to its DSS (made if missing), each piece once,
 * and a /VRI entry per signature, as an incremental update.
 */
export async function addDss(bytes: Uint8Array, entries: readonly ValidationEntry[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const before = snapshot(doc, bytes);
  const ctx = doc.context;
  let dss = doc.catalog.lookupMaybe(PDFName.of('DSS'), PDFDict);
  if (!dss) {
    dss = ctx.obj({ Type: 'DSS' });
    doc.catalog.set(PDFName.of('DSS'), ctx.register(dss));
  }
  const store = dss;
  const kinds = { certs: 'Certs', ocsps: 'OCSPs', crls: 'CRLs' } as const;
  // What is already there, by content, so nothing is stored twice.
  const known = new Map<string, PDFRef>();
  const arrays = {} as Record<keyof typeof kinds, PDFArray>;
  for (const [kind, name] of Object.entries(kinds) as [keyof typeof kinds, string][]) {
    let arr = store.lookupMaybe(PDFName.of(name), PDFArray);
    if (!arr) {
      arr = ctx.obj([]);
      store.set(PDFName.of(name), arr);
    }
    arrays[kind] = arr;
    for (const r of arr.asArray()) {
      if (!(r instanceof PDFRef)) continue;
      try {
        const b = streamBytes(ctx.lookup(r));
        if (b) known.set(`${kind}:${hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b as BufferSource)))}`, r);
      } catch {
        // Left as it is.
      }
    }
  }
  const put = async (kind: keyof typeof kinds, data: Uint8Array): Promise<PDFRef> => {
    const k = `${kind}:${hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource)))}`;
    let ref = known.get(k);
    if (!ref) {
      ref = ctx.register(ctx.flateStream(data));
      arrays[kind].push(ref);
      known.set(k, ref);
    }
    return ref;
  };
  let vri = store.lookupMaybe(PDFName.of('VRI'), PDFDict);
  if (!vri) {
    vri = ctx.obj({});
    store.set(PDFName.of('VRI'), vri);
  }
  for (const e of entries) {
    const entry = ctx.obj({});
    for (const [kind, name] of [['certs', 'Cert'], ['ocsps', 'OCSP'], ['crls', 'CRL']] as const) {
      const refs: PDFRef[] = [];
      for (const d of e[kind]) refs.push(await put(kind, d));
      if (refs.length) entry.set(PDFName.of(name), ctx.obj(refs));
    }
    vri.set(PDFName.of(e.vri), entry);
  }
  for (const [kind, name] of Object.entries(kinds) as [keyof typeof kinds, string][]) if (!arrays[kind].size()) store.delete(PDFName.of(name));
  // A DSS in a PDF 1.7 file is the ESIC extension (PDF 2.0 has it built in).
  if (!doc.catalog.lookupMaybe(PDFName.of('Extensions'), PDFDict)?.get(PDFName.of('ESIC'))) {
    const ext = doc.catalog.lookupMaybe(PDFName.of('Extensions'), PDFDict) ?? ctx.obj({});
    ext.set(PDFName.of('ESIC'), ctx.obj({ BaseVersion: PDFName.of('1.7'), ExtensionLevel: 5 }));
    doc.catalog.set(PDFName.of('Extensions'), ext);
  }
  return saveIncremental(bytes, doc, before);
}

function serialize(obj: PDFObject): Uint8Array {
  const b = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(b, 0);
  return b;
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The catalog's entries other than the DSS and extensions, serialized (what validation data may not change). */
function catalogRest(cat: PDFDict): string {
  const parts: string[] = [];
  for (const [k, v] of cat.entries()) if (k !== PDFName.of('DSS') && k !== PDFName.of('Extensions')) parts.push(`${k.toString()} ${new TextDecoder('latin1').decode(serialize(v))}`);
  return parts.sort().join('\n');
}

/**
 * Whether everything `full` adds to `signed` (an earlier version of it) is validation data: a DSS
 * and its extension entry, and nothing else that could change what the document shows or holds.
 * Objects reachable from the document other than through the DSS must be as they were.
 */
export async function onlyValidationAdded(signed: Uint8Array, full: Uint8Array): Promise<boolean> {
  const opts = { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false } as const;
  const [a, b] = await Promise.all([PDFDocument.load(signed, opts), PDFDocument.load(full, opts)]);
  const root = b.context.trailerInfo.Root;
  if (!(root instanceof PDFRef) || root !== a.context.trailerInfo.Root) return false;
  if (catalogRest(a.catalog) !== catalogRest(b.catalog)) return false;
  // Everything the document reaches other than through the DSS.
  const reached = new Set<PDFRef>();
  let lost = false;
  const walk = (obj: PDFObject | undefined, skipDss = false) => {
    const stack: (PDFObject | undefined)[] = [obj];
    while (stack.length) {
      const o = stack.pop();
      if (o instanceof PDFRef) {
        if (reached.has(o)) continue;
        reached.add(o);
        const target = b.context.lookup(o);
        // Something the signed version had and this one dropped.
        if (target === undefined && a.context.lookup(o) !== undefined) lost = true;
        stack.push(target);
      } else if (o instanceof PDFDict) {
        for (const [k, v] of o.entries()) if (!(skipDss && o === b.catalog && (k === PDFName.of('DSS') || k === PDFName.of('Extensions')))) stack.push(v);
      } else if (o instanceof PDFArray) stack.push(...o.asArray());
      else if (o instanceof PDFStream) stack.push(o.dict);
    }
  };
  reached.add(root);
  walk(b.catalog, true);
  const info = b.context.trailerInfo.Info;
  if (info) walk(info);
  if (lost) return false;
  for (const [ref, obj] of b.context.enumerateIndirectObjects()) {
    if (ref === root || !reached.has(ref)) continue;
    const was = a.context.lookup(ref);
    if (was === undefined || !same(serialize(was), serialize(obj))) return false;
  }
  return true;
}
