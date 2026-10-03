import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib';

/**
 * Archive as PDF/A-2b: the document with what the standard asks for added (an sRGB output intent,
 * XMP metadata identifying it as PDF/A-2b and matching the document information, a file ID) and
 * what it forbids removed (JavaScript, launch actions, hidden or non-printing annotations, the
 * NeedAppearances flag). Problems it cannot fix here — fonts that are not embedded, embedded files —
 * are listed so the file can be checked with a validator before archiving.
 */
export async function archiveAsPdfA(bytes: ArrayBuffer | Uint8Array, title: string): Promise<{ bytes: Uint8Array; issues: string[] }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error('Remove the password first (Document › Security): PDF/A files cannot be encrypted.');
  const ctx = doc.context;
  const issues: string[] = [];
  const now = new Date();

  // Document information, and the same in XMP.
  if (!doc.getTitle()) doc.setTitle(title);
  doc.setProducer('redcolumn');
  doc.setModificationDate(now);
  if (!doc.getCreationDate()) doc.setCreationDate(now);
  const xmp = xmpPacket({
    title: doc.getTitle() ?? title,
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    keywords: doc.getKeywords(),
    creator: doc.getCreator(),
    producer: 'redcolumn',
    created: doc.getCreationDate() ?? now,
    modified: now,
  });
  const metadata = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(metadata));

  // The output intent: colours are sRGB.
  const icc = ctx.stream(srgbProfile(), { N: 3 });
  const intent = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: ctx.register(icc) });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));

  // A file identifier.
  if (!ctx.trailerInfo.ID) {
    const id = PDFHexString.of([...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }

  // No JavaScript or launching other programs.
  let scripts = 0;
  doc.catalog.delete(PDFName.of('AA'));
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names?.has(PDFName.of('JavaScript'))) {
    names.delete(PDFName.of('JavaScript'));
    scripts++;
  }
  const badAction = (a: PDFObject | undefined) => {
    const dict = a instanceof PDFRef ? ctx.lookupMaybe(a, PDFDict) : a instanceof PDFDict ? a : undefined;
    const s = dict?.get(PDFName.of('S'))?.toString();
    return s === '/JavaScript' || s === '/Launch' || s === '/Sound' || s === '/Movie' || s === '/ResetForm' || s === '/ImportData';
  };
  if (badAction(doc.catalog.get(PDFName.of('OpenAction')))) {
    doc.catalog.delete(PDFName.of('OpenAction'));
    scripts++;
  }
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (acro) {
    acro.delete(PDFName.of('NeedAppearances'));
    acro.delete(PDFName.of('XFA'));
  }

  // Annotations: printed, visible, with appearances; no scripts.
  let fixedAnnots = 0;
  let noAppearance = 0;
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of('AA'));
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let i = annots ? annots.size() - 1 : -1; i >= 0; i--) {
      const a = annots!.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const subtype = a.get(PDFName.of('Subtype'))?.toString();
      if (subtype === '/Movie' || subtype === '/Sound' || subtype === '/Screen' || subtype === '/3D' || subtype === '/FileAttachment') {
        annots!.remove(i);
        fixedAnnots++;
        continue;
      }
      const f = a.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
      // Print on; Invisible, Hidden, ToggleNoView and NoView off.
      const next = (f | 4) & ~(1 | 2 | 32 | 256);
      if (next !== f) {
        a.set(PDFName.of('F'), PDFNumber.of(next));
        fixedAnnots++;
      }
      if (badAction(a.get(PDFName.of('A')))) {
        a.delete(PDFName.of('A'));
        scripts++;
      }
      a.delete(PDFName.of('AA'));
      if (subtype !== '/Popup' && subtype !== '/Link' && !a.has(PDFName.of('AP')) && (a.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray() ?? []).some((n) => n instanceof PDFNumber && n.asNumber() !== 0)) noAppearance++;
    }
  }
  if (noAppearance) issues.push(`${noAppearance} annotation${noAppearance === 1 ? ' has' : 's have'} no appearance stream.`);
  if (names?.has(PDFName.of('EmbeddedFiles'))) {
    names.delete(PDFName.of('EmbeddedFiles'));
    issues.push('Embedded files were removed (PDF/A-2b allows only PDF/A attachments).');
  }

  // Fonts must be embedded: those that are not are listed.
  const unembedded = new Set<string>();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
    const sub = obj.get(PDFName.of('Subtype'))?.toString();
    if (sub === '/Type3' || sub === '/Type0') continue;
    const fd = obj.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    const embedded = fd && (fd.has(PDFName.of('FontFile')) || fd.has(PDFName.of('FontFile2')) || fd.has(PDFName.of('FontFile3')));
    if (!embedded) unembedded.add(obj.get(PDFName.of('BaseFont'))?.toString().slice(1) ?? 'unnamed');
  }
  if (unembedded.size) issues.push(`Fonts not embedded: ${[...unembedded].sort().join(', ')}. Flatten markups with text, or re-create the PDF with fonts embedded, for a valid PDF/A.`);
  if (scripts) issues.unshift(`Removed ${scripts} script or launch action${scripts === 1 ? '' : 's'}.`);
  if (fixedAnnots) issues.unshift(`Set ${fixedAnnots} annotation${fixedAnnots === 1 ? '' : 's'} to print (or removed media ones).`);

  // PDF/A-2 allows object streams and cross-reference streams; the header says 1.7.
  const out = await doc.save({ useObjectStreams: true });
  return { bytes: withHeader(out), issues };
}

/** The file with a %PDF-1.7 header and the binary comment line PDF/A asks for. */
function withHeader(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 32));
  const nl = text.indexOf('\n');
  if (!text.startsWith('%PDF-') || nl < 0) return bytes;
  // pdf-lib already writes a binary comment on the second line; only the version changes.
  const head = new TextEncoder().encode('%PDF-1.7');
  const out = bytes.slice();
  if (text.slice(0, 8).length === head.length) out.set(head, 0);
  return out;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function xmpPacket(i: { title: string; author?: string; subject?: string; keywords?: string; creator?: string; producer: string; created: Date; modified: Date }): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdfaid:part>2</pdfaid:part>
<pdfaid:conformance>B</pdfaid:conformance>
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${x(i.title)}</rdf:li></rdf:Alt></dc:title>
${i.author ? `<dc:creator><rdf:Seq><rdf:li>${x(i.author)}</rdf:li></rdf:Seq></dc:creator>\n` : ''}${i.subject ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${x(i.subject)}</rdf:li></rdf:Alt></dc:description>\n` : ''}${i.keywords ? `<pdf:Keywords>${x(i.keywords)}</pdf:Keywords>\n` : ''}<pdf:Producer>${x(i.producer)}</pdf:Producer>
${i.creator ? `<xmp:CreatorTool>${x(i.creator)}</xmp:CreatorTool>\n` : ''}<xmp:CreateDate>${iso(i.created)}</xmp:CreateDate>
<xmp:ModifyDate>${iso(i.modified)}</xmp:ModifyDate>
<xmp:MetadataDate>${iso(i.modified)}</xmp:MetadataDate>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * A small ICC v2 display profile for sRGB: D50 white point, the sRGB primaries (Bradford-adapted
 * to D50) and a 2.2 gamma curve, enough for an output intent.
 */
export function srgbProfile(): Uint8Array {
  const s15 = (v: number) => Math.round(v * 65536) | 0;
  const tags: { sig: string; data: number[] }[] = [];
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const xyz = (X: number, Y: number, Z: number) => [...ascii('XYZ '), 0, 0, 0, 0, ...u32(s15(X)), ...u32(s15(Y)), ...u32(s15(Z))];
  const desc = (text: string) => [...ascii('desc'), 0, 0, 0, 0, ...u32(text.length + 1), ...ascii(text), 0, ...new Array(11).fill(0), ...new Array(67).fill(0)];
  const curve = [...ascii('curv'), 0, 0, 0, 0, ...u32(1), 2, 51, 0, 0]; // gamma 2.2 as u8Fixed8 (0x0233)
  tags.push({ sig: 'desc', data: desc('sRGB IEC61966-2.1') });
  tags.push({ sig: 'cprt', data: [...ascii('text'), 0, 0, 0, 0, ...ascii('No copyright, use freely'), 0] });
  tags.push({ sig: 'wtpt', data: xyz(0.9642, 1.0, 0.8249) });
  tags.push({ sig: 'rXYZ', data: xyz(0.4361, 0.2225, 0.0139) });
  tags.push({ sig: 'gXYZ', data: xyz(0.3851, 0.7169, 0.0971) });
  tags.push({ sig: 'bXYZ', data: xyz(0.1431, 0.0606, 0.7141) });
  tags.push({ sig: 'rTRC', data: curve });
  tags.push({ sig: 'gTRC', data: curve });
  tags.push({ sig: 'bTRC', data: curve });
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const table: number[] = [...u32(tags.length)];
  const body: number[] = [];
  for (const t of tags) {
    while (offset % 4) {
      body.push(0);
      offset++;
    }
    table.push(...ascii(t.sig), ...u32(offset), ...u32(t.data.length));
    body.push(...t.data);
    offset += t.data.length;
  }
  while (offset % 4) {
    body.push(0);
    offset++;
  }
  const header = [
    ...u32(offset),
    ...ascii('none'),
    2, 0x10, 0, 0, // version 2.1
    ...ascii('mntr'),
    ...ascii('RGB '),
    ...ascii('XYZ '),
    ...new Array(12).fill(0), // date
    ...ascii('acsp'),
    ...ascii('APPL'),
    0, 0, 0, 0, // flags
    0, 0, 0, 0, // manufacturer
    0, 0, 0, 0, // model
    0, 0, 0, 0, 0, 0, 0, 0, // attributes
    0, 0, 0, 0, // rendering intent: perceptual
    ...u32(s15(0.9642)), ...u32(s15(1.0)), ...u32(s15(0.8249)), // illuminant D50
    0, 0, 0, 0, // creator
  ];
  while (header.length < 128) header.push(0);
  return new Uint8Array([...header, ...table, ...body]);
}

/** Whether a PDF declares itself PDF/A (its XMP names a pdfaid part). */
export async function pdfaPart(bytes: ArrayBuffer | Uint8Array): Promise<string | null> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const meta = doc.catalog.lookupMaybe(PDFName.of('Metadata'), PDFStream);
  if (!(meta instanceof PDFRawStream)) return null;
  const text = new TextDecoder().decode(meta.contents);
  const part = /<pdfaid:part>(\d)<\/pdfaid:part>/.exec(text)?.[1] ?? /pdfaid:part="(\d)"/.exec(text)?.[1];
  const conf = /<pdfaid:conformance>([ABU])<\/pdfaid:conformance>/.exec(text)?.[1] ?? /pdfaid:conformance="([ABU])"/.exec(text)?.[1] ?? '';
  return part ? `PDF/A-${part}${conf.toLowerCase()}` : null;
}
