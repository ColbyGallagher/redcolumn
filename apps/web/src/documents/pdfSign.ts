import forge from 'node-forge';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFSignature, PDFString, StandardFonts, type PDFPage } from 'pdf-lib';
import { applyMatrix, pageMatrix } from '@nb/markup/export';
import { saveIncremental, snapshot } from './incremental';
import { binaryToBytes, bytesToBinary, readCertificate, type UnlockedId } from './digitalIds';
import { addDss, onlyValidationAdded, readDss, vriKey, type Dss, type ValidationEntry } from './ltv';
import { buildChain, buildSignedData, certFacts, completeChain, crlStatus, ocspStatus, readTimestamp, revocationEvidence, signatureValueOf, timestampTokenOf, verifySignature, withTimestamp, type Chain, type PkiFetch, type RawSign, type TimestampInfo } from './pki';

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
  /** The digest the signature is made over (SHA-256 unless given). */
  digest?: 'SHA-256' | 'SHA-384' | 'SHA-512';
  /**
   * PAdES (ETSI.CAdES.detached, the default): the European standard Acrobat and eIDAS validators
   * check, with a time stamp PAdES B-T. PKCS #7 (adbe.pkcs7.detached): the older Adobe format.
   */
  format?: 'pades' | 'pkcs7';
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

/**
 * Whatever holds the signing key: its certificate chain (the signer's first, DER) and a way to
 * sign with it. A .p12 Digital ID unlocked in this app is one (see `softwareSigner`); a smart card
 * or USB token, whose key never leaves it, is another.
 */
export interface Signer {
  chainDer: Uint8Array[];
  sign: RawSign;
}

const FORGE_MD = { 'SHA-256': () => forge.md.sha256.create(), 'SHA-384': () => forge.md.sha384.create(), 'SHA-512': () => forge.md.sha512.create() } as const;

/** Signs with an unlocked Digital ID's key, here in the app (RSA PKCS #1 v1.5). */
export function softwareSigner(id: UnlockedId): Signer {
  return {
    chainDer: id.chainDer,
    sign: async (data, hash) => {
      const make = FORGE_MD[hash as keyof typeof FORGE_MD];
      if (!make) throw new Error(`Cannot sign with ${hash}`);
      const md = make();
      md.update(bytesToBinary(data));
      return binaryToBytes(id.key.sign(md));
    },
  };
}

/** Signs a PDF with a Digital ID or another `Signer`. The input's bytes are kept; the signature is appended. */
export async function signPdf(bytes: Uint8Array, id: UnlockedId | Signer, req: SignRequest): Promise<Uint8Array> {
  const signerKey = 'sign' in id ? id : softwareSigner(id);
  if (!signerKey.chainDer.length) throw new Error('This Digital ID has no certificate to sign with');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const before = snapshot(doc, bytes);
  const ctx = doc.context;
  const form = doc.getForm();
  const pages = doc.getPages();
  const date = req.date ?? new Date();
  // PAdES unless the older format is asked for by name (an unknown value is not a reason to downgrade).
  const pades = req.format !== 'pkcs7';
  const signer = await readCertificate(signerKey.chainDer[0]!);
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
    SubFilter: pades ? 'ETSI.CAdES.detached' : 'adbe.pkcs7.detached',
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
  // A card or other Signer is checked against its certificate before its signature is written in:
  // the wrong key or format would otherwise save a PDF whose signature can never be valid.
  const spki = (await certFacts(signerKey.chainDer[0]!)).spki;
  const checkedSign: RawSign = async (data, hash) => {
    const value = await signerKey.sign(data, hash);
    if (!(await verifySignature(spki, hash, data, value))) throw new Error('The signature does not match the certificate: the card or token signed with another key, or in a way this app cannot use');
    return value;
  };
  let der = await buildSignedData(signed, signerKey.chainDer, date, req.digest ?? 'SHA-256', checkedSign, { pades });
  if (req.timestamp) der = withTimestamp(der, await req.timestamp(signatureValueOf(der)));
  const hexSig = [...der].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  if (hexSig.length > zeros.length) throw new Error('The signature is larger than the space for it');
  out.set(new TextEncoder().encode(hexSig), a + 1);
  return out;
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
  /** PAdES (SubFilter ETSI.CAdES.detached), the older Adobe PKCS #7 format, or another (a document time stamp, adbe.x509.rsa_sha1). */
  format: 'pades' | 'pkcs7' | 'other';
  /** The signed bytes are unchanged and the signature matches them and the certificate. */
  intact: boolean;
  /** Why not, when not intact. */
  problem: string | null;
  /** The signature covers the whole file (nothing was added after it). */
  coversWholeFile: boolean;
  /** What was added after it is only validation data (a DSS), which leaves the signed document as it was. */
  onlyValidationAdded: boolean;
  /**
   * Long-term validation: the PDF holds the signer's whole chain and a checked "not revoked"
   * answer (OCSP or CRL) for every certificate in it but the root, so it can be checked offline later.
   */
  ltv: boolean;
  /** The signature's key in the DSS's /VRI. */
  vri: string;
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
const SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
const SIGNING_CERTIFICATE = '1.2.840.113549.1.9.16.2.12';

type Node = forge.asn1.Asn1;
const kids = (n: Node) => n.value as Node[];

/** One DER element: its tag, where its contents start, and where it ends. */
function tlv(b: Uint8Array, at: number): { tag: number; start: number; body: number; end: number } {
  let p = at + 1;
  let len = b[p++]!;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (!n || n > 4) throw new Error('Unreadable length');
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + b[p++]!;
  }
  if (p + len > b.length) throw new Error('Truncated');
  return { tag: b[at]!, start: at, body: p, end: p + len };
}
const children = (b: Uint8Array, t: { body: number; end: number }) => {
  const out: ReturnType<typeof tlv>[] = [];
  for (let p = t.body; p < t.end; p = out[out.length - 1]!.end) out.push(tlv(b, p));
  return out;
};

/**
 * The certificates a CMS carries, exactly as they are in it: a certificate's hash (which
 * signing-certificate attributes name) is over those bytes, not over a re-encoding of them.
 */
function rawCertificates(der: Uint8Array): Uint8Array[] {
  const [, content] = children(der, tlv(der, 0));
  const signedData = children(der, content!)[0]!;
  const set = children(der, signedData).find((p) => p.tag === 0xa0);
  return set ? children(der, set).map((c) => der.slice(c.start, c.end)) : [];
}

/** The certificate hashes a signing-certificate (v1: SHA-1) or -v2 attribute names, first the signer's. */
function namedCertificate(attr: Node, v2: boolean): { hash: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'; value: Uint8Array } {
  const unreadable = () => new Error('The signature’s signing-certificate attribute cannot be read');
  // SigningCertificate(V2) { certs SEQUENCE OF ESSCertID(v2) { [hashAlgorithm DEFAULT sha256,] certHash, issuerSerial? } }
  let id: Node[];
  let algOid: string | null = null;
  try {
    id = kids(kids(kids(attr)[0]!)[0]!);
    if (v2 && id[0]!.type === forge.asn1.Type.SEQUENCE) algOid = forge.asn1.derToOid(kids(id[0]!)[0]!.value as string);
  } catch {
    throw unreadable();
  }
  const hash = !v2 ? 'SHA-1' : algOid ? OIDS[algOid] : 'SHA-256';
  if (!hash) throw new Error('The signature names its certificate with a digest this app cannot check');
  const value = id[algOid ? 1 : 0];
  if (!value || value.type !== forge.asn1.Type.OCTETSTRING) throw unreadable();
  return { hash, value: binaryToBytes(value.value as string) };
}

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
  // PAdES/CAdES name the signer's certificate (v2; v1 with SHA-1 in older CAdES).
  // Read when they are checked, once the signer is known (a bad one still leaves the signer shown).
  const signingCerts = [
    ...(attrs.has(SIGNING_CERTIFICATE_V2) ? [{ node: attrs.get(SIGNING_CERTIFICATE_V2)!, v2: true }] : []),
    ...(attrs.has(SIGNING_CERTIFICATE) ? [{ node: attrs.get(SIGNING_CERTIFICATE)!, v2: false }] : []),
  ];
  let raw: Uint8Array[] = [];
  try {
    raw = rawCertificates(der);
  } catch {
    // Read as re-encoded below.
  }
  return {
    signingCerts,
    certs,
    /** `certs` as they are in the signature (the same order), for their hashes. */
    rawCerts: raw.length === certs.length ? raw : certs,
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
const formatOf = (subFilter: unknown): SignatureCheck['format'] =>
  subFilter === PDFName.of('ETSI.CAdES.detached') ? 'pades' : subFilter === PDFName.of('adbe.pkcs7.detached') || subFilter === PDFName.of('adbe.pkcs7.sha1') ? 'pkcs7' : 'other';
const text = (v: unknown) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '');

/** Every signature in the file, checked. */
export async function checkSignatures(bytes: Uint8Array): Promise<SignatureCheck[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acro) return [];
  const dss = readDss(doc);
  // Signatures of the same version share the answer.
  const laterOnlyValidation = new Map<number, boolean>();
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
      format: formatOf(v.lookup(PDFName.of('SubFilter'))),
      intact: false,
      problem: null,
      coversWholeFile: false,
      onlyValidationAdded: false,
      ltv: false,
      vri: '',
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
    // D:YYYYMMDDHHmmSS then Z, or +HH'mm' / -HH'mm' from UTC (the time PAdES signatures claim).
    const md = /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:([Zz+-])(\d{2})?'?(\d{2})?'?)?/.exec(m);
    if (md) {
      const offset = md[7] === '+' || md[7] === '-' ? (md[7] === '-' ? -1 : 1) * (+(md[8] ?? 0) * 60 + +(md[9] ?? 0)) : 0;
      check.signedAt = new Date(Date.UTC(+md[1]!, +md[2]! - 1, +md[3]!, +(md[4] ?? 0), +(md[5] ?? 0), +(md[6] ?? 0)) - offset * 60_000);
    }
    try {
      const range = v.lookup(PDFName.of('ByteRange'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
      const contents = v.lookup(PDFName.of('Contents'));
      if (range.length !== 4 || !(contents instanceof PDFHexString || contents instanceof PDFString)) throw new Error('The signature has no byte range or contents');
      const [s1, l1, s2, l2] = range as [number, number, number, number];
      if (s1 !== 0 || s2 + l2 > bytes.length || l1 > s2) throw new Error('The signature’s byte range is outside the file');
      check.signedLength = s2 + l2;
      check.coversWholeFile = s2 + l2 === bytes.length;
      check.vri = await vriKey(contents.asBytes());
      if (!check.coversWholeFile && dss.certs.length + dss.ocsps.length + dss.crls.length) {
        let only = laterOnlyValidation.get(check.signedLength);
        if (only === undefined) {
          only = await onlyValidationAdded(bytes, check.signedLength);
          laterOnlyValidation.set(check.signedLength, only);
        }
        check.onlyValidationAdded = only;
      }
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
      // PAdES and CAdES name the signer's certificate: it must be the one carried, as it is carried.
      const raw = cms.rawCerts[cms.certs.findIndex((c) => same(c, signerInfo.der))] ?? signerInfo.der;
      for (const attr of cms.signingCerts) {
        const named = namedCertificate(attr.node, attr.v2);
        if (!same(named.value, new Uint8Array(await globalThis.crypto.subtle.digest(named.hash, raw as BufferSource)))) throw new Error('The signature names a different certificate from the one it carries');
      }
      if (cms.signingTime) check.signedAt = cms.signingTime;
      // The signer's own certificate first.
      check.certificates = [signerInfo.der, ...cms.certs.filter((d) => d !== signerInfo.der)];
      let chain: Chain | null = null;
      try {
        // Certificates kept for LTV fill in what the signature leaves out.
        chain = await buildChain(signerInfo.der, [...cms.certs, ...dss.certs]);
        check.chain = { names: chain.certs.map((c) => c.subjectName), fingerprints: chain.certs.map((c) => c.fingerprint), complete: chain.complete, problem: chain.problem };
      } catch (err) {
        check.chain.problem = err instanceof Error ? err.message : String(err);
      }
      const token = timestampTokenOf(contents.asBytes());
      if (token) {
        try {
          check.timestamp = await readTimestamp(token, cms.signature);
        } catch (err) {
          check.timestamp = { time: new Date(NaN), tsa: '', verified: false, problem: err instanceof Error ? err.message : String(err), certificates: [] };
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
      // Only a valid signature can be LTV.
      if (chain) check.ltv = await revocationKept(chain, dss, check.vri, check.signedAt ?? new Date());
    } catch (err) {
      check.problem = err instanceof Error ? err.message : String(err);
    }
    out.push(check);
  }
  return out;
}

/** How long before signing a revocation answer may have been made and still count, for a signature with no /VRI entry. */
const ANSWER_GRACE_MS = 24 * 3600_000;

/**
 * Whether the DSS holds a checked "not revoked" answer for every certificate in a complete chain
 * but its root: from the signature's own /VRI entry when it has one, else any in the DSS made no
 * earlier than a day before `signedAt` (another signature's answers may be older than this one).
 */
async function revocationKept(chain: Chain, dss: Dss, vri: string, signedAt: Date): Promise<boolean> {
  if (!chain.complete || chain.certs.length < 2) return false;
  const own = dss.vri.get(vri);
  const pool = own ?? { ocsps: dss.ocsps, crls: dss.crls };
  const recent = (at: Date | null) => !!own || (!!at && at.getTime() >= signedAt.getTime() - ANSWER_GRACE_MS);
  for (let i = 0; i < chain.certs.length - 1; i++) {
    const cert = chain.certs[i]!;
    const issuer = chain.certs[i + 1]!;
    let ok = false;
    for (const [answers, read] of [
      [pool.ocsps, ocspStatus],
      [pool.crls, crlStatus],
    ] as const) {
      for (const answer of answers) {
        try {
          const r = await read(answer, cert, issuer);
          if (!r.verified) continue;
          if (r.status === 'good' && !recent(r.at)) continue;
          // A revoked certificate's signature is not LTV, whatever else is kept.
          if (r.status !== 'good') return false;
          ok = true;
        } catch {
          // About another certificate, or from another issuer.
        }
      }
      if (ok) break;
    }
    if (!ok) return false;
  }
  return true;
}

export interface ValidationAdded {
  bytes: Uint8Array;
  /** Signatures given validation data. */
  signatures: number;
  /** What could not be gathered, per signature (a signature here may still have got its own). */
  problems: string[];
}

/**
 * Adds long-term validation data (LTV) for the PDF's intact signatures that lack it: each signer's
 * whole chain (completed from CA Issuers addresses, `anchors` being known roots) and an OCSP answer
 * or CRL for each certificate in it but the root, checked, and the same for a time stamp's server
 * where it can be had. They go in the DSS, appended, so the signatures stay valid. `fields` limits
 * it to those signatures, `newest` to the one covering the whole file (just made). Self-signed
 * signatures have no authority to vouch for them and get none. Fails, adding nothing, when no
 * signature could be given its data.
 */
export async function addValidationData(bytes: Uint8Array, fetcher: PkiFetch, opts: { anchors?: readonly Uint8Array[]; fields?: readonly string[]; newest?: boolean } = {}): Promise<ValidationAdded> {
  const kept = readDss(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }));
  const asked = (await checkSignatures(bytes)).filter((c) => c.intact && c.certificates.length && (!opts.fields || opts.fields.includes(c.field)) && (!opts.newest || c.coversWholeFile));
  // A signature with its own data already, or another's that covers it, needs none.
  const checks = asked.filter((c) => !c.certificate?.selfSigned && !(c.ltv && kept.vri.has(c.vri)));
  if (!checks.length) throw new Error(asked.length && asked.every((c) => c.certificate?.selfSigned) ? 'A self-signed certificate has no certificate authority to vouch for it' : 'No signature needs validation data');
  const anchors = opts.anchors ?? [];
  const problems: string[] = [];
  const entries: ValidationEntry[] = [];
  /** The chain from `certs` (the first is the one to validate) and each link's revocation answer, into `entry`. */
  const gather = async (certs: readonly Uint8Array[], entry: ValidationEntry, pool: readonly Uint8Array[] = []) => {
    let chain = await buildChain(certs[0]!, [...certs, ...kept.certs, ...pool]);
    if (!chain.complete) chain = await completeChain(chain, fetcher, { pool: [...certs.slice(1), ...pool], anchors });
    if (!chain.complete) throw new Error(chain.problem ?? 'Its certificate chain is incomplete');
    if (chain.certs.length < 2) throw new Error('A self-signed certificate has no certificate authority to vouch for it');
    entry.certs.push(...chain.certs.map((c) => c.der));
    for (let i = 0; i < chain.certs.length - 1; i++) {
      const cert = chain.certs[i]!;
      const { revocation, answer } = await revocationEvidence(cert, chain.certs[i + 1]!, fetcher);
      if (!revocation.verified) throw new Error(`The ${revocation.via} answer about ${cert.subjectName} is not signed by its issuer`);
      if (revocation.status !== 'good') throw new Error(`${cert.subjectName}’s certificate is ${revocation.status === 'revoked' ? 'revoked' : 'unknown to its CA'}`);
      (revocation.via === 'OCSP' ? entry.ocsps : entry.crls).push(answer);
    }
  };
  for (const c of checks) {
    const entry: ValidationEntry = { vri: c.vri, certs: [], ocsps: [], crls: [] };
    try {
      await gather(c.certificates, entry);
    } catch (err) {
      problems.push(`${c.signer || c.field}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    entries.push(entry);
    // The time stamp server's own, best effort: the signature's data stands without it. Kept in the
    // DSS without a /VRI entry (the signature's entry is for the signature's own chain).
    if (c.timestamp?.verified && c.timestamp.certificates.length) {
      const tsa: ValidationEntry = { vri: '', certs: [], ocsps: [], crls: [] };
      try {
        // Often the same CA as the signer's: its chain may finish the server's.
        await gather(c.timestamp.certificates, tsa, entry.certs);
        entries.push(tsa);
      } catch (err) {
        problems.push(`${c.timestamp.tsa || 'Time stamp server'}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const signatures = entries.filter((e) => e.vri).length;
  if (!signatures) throw new Error(problems.join('; '));
  return { bytes: await addDss(bytes, entries), signatures, problems };
}

/** The file as it was when a signature was made (its signed version). */
export const signedVersion = (bytes: Uint8Array, check: SignatureCheck) => bytes.slice(0, check.signedLength);
