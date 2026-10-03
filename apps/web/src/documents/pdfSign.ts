import forge from 'node-forge';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFSignature, PDFString, StandardFonts, type PDFPage } from 'pdf-lib';
import { applyMatrix, pageMatrix } from '@nb/markup/export';
import { saveIncremental, snapshot } from './incremental';
import { binaryToBytes, bytesToBinary, readCertificate, type UnlockedId } from './digitalIds';
import { buildChain, readTimestamp, signatureValueOf, timestampTokenOf, verifySignature, withTimestamp, type TimestampInfo } from './pki';

/**
 * PDF digital signatures: signing (a CMS detached signature over the file's bytes, written with
 * an incremental update so earlier signatures stay valid), certifying (DocMDP), and checking the
 * signatures in a file.
 */

/** Bytes reserved for the signature (the certificate chain goes in it too; a time stamp needs more). */
const SIGNATURE_SPACE = 12 * 1024;
const TIMESTAMPED_SPACE = 28 * 1024;
const PLACEHOLDER = 9_999_999_999;

export interface SignRequest {
  /** An existing empty signature field to sign; otherwise a new one (visible at `area`, or invisible). */
  fieldName?: string;
  area?: { pageIndex: number; rect: { x: number; y: number; w: number; h: number } };
  reason?: string;
  location?: string;
  contact?: string;
  /** Certify instead of approve: which changes are allowed afterwards (1 none, 2 forms and signatures, 3 also markups). */
  certify?: 1 | 2 | 3;
  /** Picture of a handwritten signature (PNG) drawn in the field. */
  image?: Uint8Array;
  date?: Date;
  /** Gets a trusted time stamp token (RFC 3161) over the signature value, added to the signature. */
  timestamp?: (signatureValue: Uint8Array) => Promise<Uint8Array>;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const tz = -d.getTimezoneOffset();
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${tz === 0 ? 'Z' : `${tz > 0 ? '+' : '-'}${p(Math.floor(Math.abs(tz) / 60))}'${p(Math.abs(tz) % 60)}'`}`;
}

/** The field's box in user space, from page space. */
function userRect(page: PDFPage, r: { x: number; y: number; w: number; h: number }): [number, number, number, number] {
  const m = pageMatrix(page);
  const a = applyMatrix(m, [r.x, r.y]);
  const b = applyMatrix(m, [r.x + r.w, r.y + r.h]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** The signature's look: a picture (if given) on the left, the signer's details on the right. */
async function appearance(doc: PDFDocument, w: number, h: number, lines: string[], image?: Uint8Array): Promise<PDFRef> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const resources: { Font: { F1: PDFRef }; XObject?: { Im1: PDFRef } } = { Font: { F1: font.ref } };
  const ops: string[] = [];
  let textX = 3;
  if (image) {
    const png = await doc.embedPng(image);
    const boxW = w * 0.45;
    const s = Math.min(boxW / png.width, (h - 4) / png.height);
    const iw = png.width * s;
    const ih = png.height * s;
    ops.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${((boxW - iw) / 2 + 2).toFixed(2)} ${((h - ih) / 2).toFixed(2)} cm /Im1 Do Q`);
    resources.XObject = { Im1: png.ref };
    textX = boxW + 6;
  }
  const size = Math.max(4, Math.min(10, (h - 4) / (lines.length * 1.25)));
  const maxW = w - textX - 2;
  ops.push('BT', `/F1 ${size.toFixed(2)} Tf`, '0 0 0 rg');
  lines.forEach((line, i) => {
    let t = line;
    while (t.length > 3 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2);
    if (t !== line) t = `${t.slice(0, -1)}…`.replace('…', '...');
    const safe = [...t].map((c) => (c.charCodeAt(0) < 256 ? c : '?')).join('');
    ops.push(`1 0 0 1 ${textX.toFixed(2)} ${(h - 2 - size * 1.2 * (i + 1) + size * 0.2).toFixed(2)} Tm ${font.encodeText(safe).toString()} Tj`);
  });
  ops.push('ET');
  const stream = doc.context.flateStream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: resources });
  return doc.context.register(stream);
}

/** Signs a PDF with a Digital ID. The input's bytes are kept; the signature is appended. */
/**
 * `externalCms` signs with something other than the ID's key (a smart card, a signing service):
 * given the bytes to sign, it returns the CMS SignedData (DER). The ID then only supplies the
 * certificate shown in the signature's appearance.
 */
export async function signPdf(bytes: Uint8Array, id: UnlockedId, req: SignRequest, externalCms?: (data: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const before = snapshot(doc, bytes);
  const ctx = doc.context;
  const form = doc.getForm();
  const pages = doc.getPages();
  const date = req.date ?? new Date();
  const signer = await readCertificate(id.chainDer[0]!);
  const space = req.timestamp ? TIMESTAMPED_SPACE : SIGNATURE_SPACE;

  // The field: an existing empty one, or a new one.
  let widget: PDFDict;
  let page: PDFPage;
  if (req.fieldName) {
    const field = form.getField(req.fieldName);
    if (!(field instanceof PDFSignature)) throw new Error(`${req.fieldName} is not a signature field`);
    if (field.acroField.dict.get(PDFName.of('V'))) throw new Error(`${req.fieldName} is already signed`);
    widget = field.acroField.getWidgets()[0]!.dict;
    const p = widget.get(PDFName.of('P'));
    page = pages.find((pg) => pg.ref === p) ?? pages.find((pg) => pg.node.Annots()?.asArray().some((r) => ctx.lookup(r) === widget)) ?? pages[0]!;
  } else {
    page = pages[req.area?.pageIndex ?? 0]!;
    const rect = req.area ? userRect(page, req.area.rect) : [0, 0, 0, 0];
    const taken = new Set(form.getFields().map((f) => f.getName()));
    let n = 1;
    while (taken.has(`Signature${n}`)) n++;
    widget = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(`Signature${n}`), F: 132, Rect: rect, P: page.ref });
    const ref = ctx.register(widget);
    page.node.addAnnot(ref);
    form.acroForm.addField(ref);
  }

  // The signature dictionary, with room left for the signature and its byte range.
  const sig = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER],
    Contents: PDFHexString.of('0'.repeat(space * 2)),
    M: PDFString.of(pdfDate(date)),
    Name: PDFHexString.fromText(signer.subject.name),
    ...(req.reason ? { Reason: PDFHexString.fromText(req.reason) } : {}),
    ...(req.location ? { Location: PDFHexString.fromText(req.location) } : {}),
    ...(req.contact ? { ContactInfo: PDFHexString.fromText(req.contact) } : {}),
    Prop_Build: { App: { Name: 'redcolumn' } },
  });
  const sigRef = ctx.register(sig);
  if (req.certify) {
    const reference = ctx.obj({ Type: 'SigRef', TransformMethod: 'DocMDP', TransformParams: { Type: 'TransformParams', P: req.certify, V: '1.2' } });
    sig.set(PDFName.of('Reference'), ctx.obj([reference]));
    doc.catalog.set(PDFName.of('Perms'), ctx.obj({ DocMDP: sigRef }));
  }
  widget.set(PDFName.of('V'), sigRef);

  // How it looks on the page (nothing for an invisible signature).
  const r = widget.lookup(PDFName.of('Rect'), PDFArray).asArray().map((v) => (v as PDFNumber).asNumber());
  const w = Math.abs(r[2]! - r[0]!);
  const h = Math.abs(r[3]! - r[1]!);
  if (w > 1 && h > 1) {
    const lines = [`Digitally signed by ${signer.subject.name}`, `Date: ${date.toLocaleString()}`, ...(req.reason ? [`Reason: ${req.reason}`] : []), ...(req.location ? [`Location: ${req.location}`] : [])];
    widget.set(PDFName.of('AP'), ctx.obj({ N: await appearance(doc, w, h, lines, req.image) }));
  }
  // Signatures exist; the file should only be appended to from now on.
  form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  const out = await saveIncremental(bytes, doc, before);

  // Fill in the byte range around the signature's hex string, then the signature itself.
  const text = new TextDecoder('latin1').decode(out.subarray(bytes.length));
  const zeros = '0'.repeat(space * 2);
  const hexAt = text.indexOf(`<${zeros}>`);
  const rangeMatch = /\/ByteRange\s*\[\s*0\s+9999999999\s+9999999999\s+9999999999\s*\]/.exec(text);
  if (hexAt < 0 || !rangeMatch) throw new Error('Could not find the space for the signature');
  const a = bytes.length + hexAt;
  const b = a + zeros.length + 2;
  const range = [0, a, b, out.length - b];
  const rangeText = `/ByteRange [${range.join(' ')}]`;
  if (rangeText.length > rangeMatch[0].length) throw new Error('The byte range does not fit');
  out.set(new TextEncoder().encode(rangeText.padEnd(rangeMatch[0].length, ' ')), bytes.length + rangeMatch.index);

  const signed = new Uint8Array(a + (out.length - b));
  signed.set(out.subarray(0, a), 0);
  signed.set(out.subarray(b), a);
  let der = externalCms ? await externalCms(signed) : cmsSign(signed, id, date);
  if (req.timestamp) der = withTimestamp(der, await req.timestamp(signatureValueOf(der)));
  const hexSig = [...der].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  if (hexSig.length > zeros.length) throw new Error('The signature is larger than the space for it');
  out.set(new TextEncoder().encode(hexSig), a + 1);
  return out;
}

/** CMS SignedData (detached) over `data`: signing time, content type and digest signed with the key. */
function cmsSign(data: Uint8Array, id: UnlockedId, date: Date): Uint8Array {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(bytesToBinary(data));
  for (const c of id.chain) p7.addCertificate(c);
  p7.addSigner({
    key: id.key,
    certificate: id.chain[0]!,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime!, value: date as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return binaryToBytes(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// --- Checking signatures -------------------------------------------------------------------------

export interface SignatureCheck {
  field: string;
  signer: string;
  email: string;
  org: string;
  issuer: string;
  /** When it says it was signed (from the signature, else /M). */
  signedAt: Date | null;
  reason: string;
  location: string;
  /** The signed bytes are unchanged and the signature matches them and the certificate. */
  intact: boolean;
  /** Why not, when not intact. */
  problem: string | null;
  /** The signature covers the whole file (nothing was added after it). */
  coversWholeFile: boolean;
  /** Certification level (DocMDP P), for certifying signatures. */
  certify: 1 | 2 | 3 | null;
  certificate: { fingerprint: string; selfSigned: boolean; notBefore: Date; notAfter: Date; validAtSigning: boolean } | null;
  /** Bytes of the file that the signature covers (the version that was signed). */
  signedLength: number;
  /** A trusted time stamp on the signature, checked. */
  timestamp: TimestampInfo | null;
  /** The signer's certificate chain as far as the signature's certificates go (signer first). */
  chain: { names: string[]; fingerprints: string[]; complete: boolean; problem: string | null };
  /** The certificates the signature carries (DER), the signer's first, for revocation checks. */
  certificates: Uint8Array[];
}

const OIDS: Record<string, 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};
const MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const SIGNING_TIME = '1.2.840.113549.1.9.5';

type Node = forge.asn1.Asn1;
const kids = (n: Node) => n.value as Node[];

/** Pieces of a CMS SignedData needed to check it. */
function parseCms(der: Uint8Array) {
  const content = forge.asn1.fromDer(bytesToBinary(der), { parseAllBytes: false } as unknown as boolean);
  const signedData = kids(kids(content)[1]!)[0]!;
  const parts = kids(signedData);
  const certSet = parts.find((p) => p.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && p.type === 0);
  const certs = certSet ? kids(certSet).map((c) => binaryToBytes(forge.asn1.toDer(c).getBytes())) : [];
  const signerInfos = parts[parts.length - 1]!;
  const si = kids(kids(signerInfos)[0]!);
  const sid = si[1]!;
  const serial = sid.tagClass === forge.asn1.Class.UNIVERSAL ? [...binaryToBytes(kids(sid)[1]!.value as string)].map((x) => x.toString(16).padStart(2, '0')).join('') : null;
  const digestOid = forge.asn1.derToOid(kids(si[2]!)[0]!.value as string);
  let i = 3;
  let signedAttrs: Node | null = null;
  if (si[i]!.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && si[i]!.type === 0) signedAttrs = si[i++]!;
  const sigAlgOid = forge.asn1.derToOid(kids(si[i++]!)[0]!.value as string);
  const signature = binaryToBytes(si[i]!.value as string);
  const attrs = new Map<string, Node>();
  for (const a of signedAttrs ? kids(signedAttrs) : []) attrs.set(forge.asn1.derToOid(kids(a)[0]!.value as string), kids(kids(a)[1]!)[0]!);
  // The signed attributes are signed as a SET (tag 0x31), not as the [0] they are stored as.
  let signedAttrsDer: Uint8Array | null = null;
  if (signedAttrs) {
    signedAttrsDer = binaryToBytes(forge.asn1.toDer(signedAttrs).getBytes());
    signedAttrsDer[0] = 0x31;
  }
  const md = attrs.get(MESSAGE_DIGEST);
  const time = attrs.get(SIGNING_TIME);
  return {
    certs,
    serial,
    digest: OIDS[digestOid] ?? null,
    sigAlgOid,
    signature,
    signedAttrsDer,
    messageDigest: md ? binaryToBytes(md.value as string) : null,
    signingTime: time ? (time.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(time.value as string) : forge.asn1.generalizedTimeToDate(time.value as string)) : null,
  };
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const text = (v: unknown) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '');

/** Every signature in the file, checked. */
export async function checkSignatures(bytes: Uint8Array): Promise<SignatureCheck[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acro) return [];
  const out: SignatureCheck[] = [];
  for (const field of doc.getForm().getFields()) {
    if (!(field instanceof PDFSignature)) continue;
    const v = field.acroField.dict.lookup(PDFName.of('V'));
    if (!(v instanceof PDFDict)) continue;
    const check: SignatureCheck = {
      field: field.getName(),
      signer: text(v.lookup(PDFName.of('Name'))),
      email: '',
      org: '',
      issuer: '',
      signedAt: null,
      reason: text(v.lookup(PDFName.of('Reason'))),
      location: text(v.lookup(PDFName.of('Location'))),
      intact: false,
      problem: null,
      coversWholeFile: false,
      certify: null,
      certificate: null,
      signedLength: 0,
      timestamp: null,
      chain: { names: [], fingerprints: [], complete: false, problem: null },
      certificates: [],
    };
    const ref = v.lookup(PDFName.of('Reference'));
    if (ref instanceof PDFArray)
      for (const r of ref.asArray()) {
        const d = doc.context.lookup(r);
        if (d instanceof PDFDict && d.get(PDFName.of('TransformMethod')) === PDFName.of('DocMDP')) {
          const p = d.lookupMaybe(PDFName.of('TransformParams'), PDFDict)?.lookup(PDFName.of('P'));
          check.certify = (p instanceof PDFNumber ? p.asNumber() : 2) as 1 | 2 | 3;
        }
      }
    const m = text(v.lookup(PDFName.of('M')));
    const md = /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(m);
    if (md) check.signedAt = new Date(Date.UTC(+md[1]!, +md[2]! - 1, +md[3]!, +(md[4] ?? 0), +(md[5] ?? 0), +(md[6] ?? 0)));
    try {
      const range = v.lookup(PDFName.of('ByteRange'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
      const contents = v.lookup(PDFName.of('Contents'));
      if (range.length !== 4 || !(contents instanceof PDFHexString || contents instanceof PDFString)) throw new Error('The signature has no byte range or contents');
      const [s1, l1, s2, l2] = range as [number, number, number, number];
      if (s1 !== 0 || s2 + l2 > bytes.length || l1 > s2) throw new Error('The signature’s byte range is outside the file');
      check.signedLength = s2 + l2;
      check.coversWholeFile = s2 + l2 === bytes.length;
      const cms = parseCms(contents.asBytes());
      const signerDer = cms.certs[0];
      const signerInfo = await (async () => {
        for (const c of cms.certs) {
          const info = await readCertificate(c);
          if (!cms.serial || info.serial.replace(/^0+/, '') === cms.serial.replace(/^0+/, '')) return info;
        }
        return signerDer ? readCertificate(signerDer) : null;
      })();
      if (!signerInfo) throw new Error('The signature has no certificate');
      check.signer = signerInfo.subject.name || check.signer;
      check.email = signerInfo.subject.email;
      check.org = signerInfo.subject.org;
      check.issuer = signerInfo.issuer.name;
      if (cms.signingTime) check.signedAt = cms.signingTime;
      // The signer's own certificate first.
      check.certificates = [signerInfo.der, ...cms.certs.filter((d) => d !== signerInfo.der)];
      try {
        const chain = await buildChain(signerInfo.der, cms.certs);
        check.chain = { names: chain.certs.map((c) => c.subjectName), fingerprints: chain.certs.map((c) => c.fingerprint), complete: chain.complete, problem: chain.problem };
      } catch (err) {
        check.chain.problem = err instanceof Error ? err.message : String(err);
      }
      const token = timestampTokenOf(contents.asBytes());
      if (token) {
        try {
          check.timestamp = await readTimestamp(token, cms.signature);
        } catch (err) {
          check.timestamp = { time: new Date(NaN), tsa: '', verified: false, problem: err instanceof Error ? err.message : String(err) };
        }
        // A verified time stamp is when it was signed, whatever the signer's clock said.
        if (check.timestamp.verified) check.signedAt = check.timestamp.time;
      }
      const at = check.signedAt ?? new Date();
      check.certificate = { fingerprint: signerInfo.fingerprint, selfSigned: signerInfo.selfSigned, notBefore: signerInfo.notBefore, notAfter: signerInfo.notAfter, validAtSigning: at >= signerInfo.notBefore && at <= signerInfo.notAfter };
      if (!cms.digest) throw new Error('The signature uses a digest this app cannot check');
      const signedBytes = new Uint8Array(l1 + l2);
      signedBytes.set(bytes.subarray(0, l1), 0);
      signedBytes.set(bytes.subarray(s2, s2 + l2), l1);
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest(cms.digest, signedBytes as BufferSource));
      if (cms.signedAttrsDer) {
        if (!cms.messageDigest || !same(cms.messageDigest, digest)) throw new Error('The document was changed after it was signed');
        if (!(await verifySignature(signerInfo.spki, cms.digest, cms.signedAttrsDer, cms.signature))) throw new Error('The signature does not match its certificate');
      } else if (!(await verifySignature(signerInfo.spki, cms.digest, signedBytes, cms.signature))) {
        throw new Error('The document was changed after it was signed');
      }
      check.intact = true;
    } catch (err) {
      check.problem = err instanceof Error ? err.message : String(err);
    }
    out.push(check);
  }
  return out;
}

/** The file as it was when a signature was made (its signed version). */
export const signedVersion = (bytes: Uint8Array, check: SignatureCheck) => bytes.slice(0, check.signedLength);
