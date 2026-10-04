import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, type LoadOptions, type PDFObject, type SaveOptions } from 'pdf-lib';

/**
 * Incremental updates: changes are appended to the end of a PDF instead of rewriting it, so the
 * bytes that are already there stay exactly as they were. Digital signatures need this: they
 * cover the file's bytes, and a rewrite would break every earlier signature.
 */

/** Whether the PDF is signed (AcroForm /SigFlags SignaturesExist): rewriting it would break the signatures. */
export function isSigned(doc: PDFDocument): boolean {
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const flags = acro?.lookup(PDFName.of('SigFlags'));
  return flags instanceof PDFNumber && (flags.asNumber() & 1) === 1;
}

/**
 * Loads a PDF for editing. `save` appends the changes as an incremental update when the PDF is
 * signed, so its signatures stay valid, and rewrites it otherwise.
 */
export async function openForEdit(bytes: ArrayBuffer | Uint8Array, load: LoadOptions = {}): Promise<{ doc: PDFDocument; signed: boolean; save: (options?: SaveOptions) => Promise<Uint8Array> }> {
  const original = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(original, { updateMetadata: false, ...load });
  const snap = isSigned(doc) ? snapshot(doc, original) : null;
  return { doc, signed: !!snap, save: (options) => (snap ? saveIncremental(original, doc, snap) : doc.save(options)) };
}

/**
 * Each indirect object's serialization before changes. Streams are kept by identity plus their
 * dictionary's serialization (cheaper than their contents), so a dictionary edited in place counts.
 */
export interface Snapshot {
  objects: Map<string, string | { stream: PDFStream; dict: string }>;
}

function serialize(obj: PDFObject): string {
  const bytes = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(bytes, 0);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

const key = (ref: PDFRef) => `${ref.objectNumber} ${ref.generationNumber}`;

/**
 * The highest object number the file uses, including objects pdf-lib drops after parsing (object
 * streams and cross-reference streams), from the object headers and every trailer's /Size.
 */
function highestObjectNumber(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes);
  let max = 0;
  for (const m of text.matchAll(/(?:^|[^\d])(\d{1,9})\s+\d{1,5}\s+obj\b/g)) max = Math.max(max, Number(m[1]));
  for (const m of text.matchAll(/\/Size\s+(\d{1,9})/g)) max = Math.max(max, Number(m[1]) - 1);
  return max;
}

/** Takes the snapshot right after loading `doc` from `original`; new objects then get unused numbers. */
export function snapshot(doc: PDFDocument, original: Uint8Array): Snapshot {
  doc.context.largestObjectNumber = Math.max(doc.context.largestObjectNumber, highestObjectNumber(original));
  const objects: Snapshot['objects'] = new Map();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) objects.set(key(ref), obj instanceof PDFStream ? { stream: obj, dict: serialize(obj.dict) } : serialize(obj));
  return { objects };
}

/** Objects that are new or different from the snapshot. */
function changedObjects(doc: PDFDocument, before: Snapshot): [PDFRef, PDFObject][] {
  const out: [PDFRef, PDFObject][] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const was = before.objects.get(key(ref));
    if (was === undefined) out.push([ref, obj]);
    else if (obj instanceof PDFStream ? typeof was === 'string' || was.stream !== obj || was.dict !== serialize(obj.dict) : typeof was !== 'string' || was !== serialize(obj)) out.push([ref, obj]);
  }
  return out.sort((a, b) => a[0].objectNumber - b[0].objectNumber);
}

/** Where the last cross-reference section starts, and whether it is a table (else a stream). */
function lastXref(bytes: Uint8Array): { offset: number; table: boolean } {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail) ?? [...tail.matchAll(/startxref\s+(\d+)/g)].at(-1);
  if (!m) throw new Error('The PDF has no cross-reference position (startxref)');
  const offset = Number(m[1]);
  const head = new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 4));
  return { offset, table: head === 'xref' };
}

const enc = new TextEncoder();

/**
 * The original bytes with the document's changes appended as an incremental update. `doc` must
 * have been loaded from `original` and `before` taken right after loading.
 */
export async function saveIncremental(original: Uint8Array, doc: PDFDocument, before: Snapshot): Promise<Uint8Array> {
  // Fonts and pictures added since loading become objects now.
  await doc.flush();
  const changed = changedObjects(doc, before);
  const { offset: prev, table } = lastXref(original);
  const parts: Uint8Array[] = [original];
  let at = original.length;
  const push = (b: Uint8Array) => {
    parts.push(b);
    at += b.length;
  };
  // Start on a new line.
  if (original[original.length - 1] !== 0x0a) push(enc.encode('\n'));
  const offsets = new Map<number, { offset: number; gen: number }>();
  for (const [ref, obj] of changed) {
    offsets.set(ref.objectNumber, { offset: at, gen: ref.generationNumber });
    push(enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    const body = new Uint8Array(obj.sizeInBytes());
    obj.copyBytesInto(body, 0);
    push(body);
    push(enc.encode('\nendobj\n'));
  }
  const ctx = doc.context;
  const size = ctx.largestObjectNumber + 1;
  const t = ctx.trailerInfo;
  const refStr = (v: unknown) => (v instanceof PDFRef ? `${v.objectNumber} ${v.generationNumber} R` : v ? serialize(v as PDFObject) : '');
  const trailerEntries = [`/Size ${size + (table ? 0 : 1)}`, `/Root ${refStr(t.Root)}`, t.Info ? `/Info ${refStr(t.Info)}` : '', t.Encrypt ? `/Encrypt ${refStr(t.Encrypt)}` : '', t.ID ? `/ID ${refStr(t.ID)}` : '', `/Prev ${prev}`].filter(Boolean).join(' ');
  const numbers = [...offsets.keys()].sort((a, b) => a - b);
  // Consecutive runs of object numbers, each a subsection.
  const runs: number[][] = [];
  for (const n of numbers) {
    const last = runs.at(-1);
    if (last && n === last[last.length - 1]! + 1) last.push(n);
    else runs.push([n]);
  }
  const xrefAt = at;
  if (table) {
    let x = 'xref\n';
    for (const run of runs) {
      x += `${run[0]} ${run.length}\n`;
      for (const n of run) {
        const o = offsets.get(n)!;
        x += `${String(o.offset).padStart(10, '0')} ${String(o.gen).padStart(5, '0')} n \n`;
      }
    }
    push(enc.encode(`${x}trailer\n<< ${trailerEntries} >>\nstartxref\n${xrefAt}\n%%EOF\n`));
  } else {
    // A cross-reference stream (the original uses them): itself the next object number.
    const self = size;
    offsets.set(self, { offset: xrefAt, gen: 0 });
    const all = [...numbers, self].sort((a, b) => a - b);
    const streamRuns: number[][] = [];
    for (const n of all) {
      const last = streamRuns.at(-1);
      if (last && n === last[last.length - 1]! + 1) last.push(n);
      else streamRuns.push([n]);
    }
    const rows = new Uint8Array(all.length * 7);
    all.forEach((n, i) => {
      const o = offsets.get(n)!;
      rows[i * 7] = 1;
      new DataView(rows.buffer).setUint32(i * 7 + 1, o.offset);
      new DataView(rows.buffer).setUint16(i * 7 + 5, o.gen);
    });
    const index = streamRuns.map((r) => `${r[0]} ${r.length}`).join(' ');
    push(enc.encode(`${self} 0 obj\n<< /Type /XRef ${trailerEntries} /Index [${index}] /W [1 4 2] /Length ${rows.length} >>\nstream\n`));
    push(rows);
    push(enc.encode(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`));
  }
  const out = new Uint8Array(at);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
