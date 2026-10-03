import forge from 'node-forge';

/**
 * Digital IDs: a private key with its certificate, used to sign PDFs. They are made here
 * (self-signed) or imported from a .p12/.pfx file, and kept as a password-protected PKCS#12.
 */

export interface CertificateInfo {
  subject: { name: string; email: string; org: string };
  issuer: { name: string; org: string };
  serial: string;
  notBefore: Date;
  notAfter: Date;
  /** SHA-256 of the certificate, as hex. */
  fingerprint: string;
  selfSigned: boolean;
  /** The certificate's public key (SubjectPublicKeyInfo, DER). */
  spki: Uint8Array;
  /** The certificate itself (DER). */
  der: Uint8Array;
}

export interface DigitalIdRecord {
  id: string;
  /** PKCS#12, base64, protected by the ID's password. */
  p12: string;
  /** For lists, without unlocking. */
  name: string;
  email: string;
  org: string;
  issuer: string;
  notAfter: number;
  fingerprint: string;
  selfSigned: boolean;
  createdAt: number;
}

export interface UnlockedId {
  key: forge.pki.rsa.PrivateKey;
  /** The signer's certificate first, then the rest of its chain. */
  chain: forge.pki.Certificate[];
  /** DER of each certificate in `chain`. */
  chainDer: Uint8Array[];
}

const asn1 = forge.asn1;
const toBinary = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};
const fromBinary = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
export const bytesToBinary = toBinary;
export const binaryToBytes = fromBinary;
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

async function sha256Hex(b: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b as BufferSource)));
}

const OID = {
  commonName: '2.5.4.3',
  org: '2.5.4.10',
  email: '1.2.840.113549.1.9.1',
};

/** Attribute values of an X.501 Name, by OID. */
function nameOf(node: forge.asn1.Asn1): Map<string, string> {
  const out = new Map<string, string>();
  for (const rdn of node.value as forge.asn1.Asn1[])
    for (const atv of rdn.value as forge.asn1.Asn1[]) {
      const [type, value] = atv.value as forge.asn1.Asn1[];
      const oid = asn1.derToOid(type!.value as string);
      let v = value!.value as string;
      // BMPString is UTF-16; UTF8String needs decoding.
      if (value!.type === asn1.Type.BMPSTRING) v = new TextDecoder('utf-16be').decode(fromBinary(v));
      else if (value!.type === asn1.Type.UTF8) v = forge.util.decodeUtf8(v);
      if (!out.has(oid)) out.set(oid, v);
    }
  return out;
}

function timeOf(node: forge.asn1.Asn1): Date {
  return node.type === asn1.Type.UTCTIME ? asn1.utcTimeToDate(node.value as string) : asn1.generalizedTimeToDate(node.value as string);
}

/** Reads a certificate (RSA or EC keys alike; forge's own parser only takes RSA). */
export async function readCertificate(der: Uint8Array): Promise<CertificateInfo> {
  const cert = asn1.fromDer(toBinary(der));
  const tbs = (cert.value as forge.asn1.Asn1[])[0]!;
  const fields = tbs.value as forge.asn1.Asn1[];
  // Version is an explicit [0] when present.
  const i = fields[0]!.tagClass === asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  const serial = hex(fromBinary(fields[i]!.value as string));
  const issuer = nameOf(fields[i + 2]!);
  const validity = fields[i + 3]!.value as forge.asn1.Asn1[];
  const subject = nameOf(fields[i + 4]!);
  const spki = fromBinary(asn1.toDer(fields[i + 5]!).getBytes());
  const issuerDer = asn1.toDer(fields[i + 2]!).getBytes();
  const subjectDer = asn1.toDer(fields[i + 4]!).getBytes();
  return {
    subject: { name: subject.get(OID.commonName) ?? subject.get(OID.org) ?? '', email: subject.get(OID.email) ?? '', org: subject.get(OID.org) ?? '' },
    issuer: { name: issuer.get(OID.commonName) ?? issuer.get(OID.org) ?? '', org: issuer.get(OID.org) ?? '' },
    serial,
    notBefore: timeOf(validity[0]!),
    notAfter: timeOf(validity[1]!),
    fingerprint: await sha256Hex(der),
    selfSigned: issuerDer === subjectDer,
    spki,
    der,
  };
}

async function recordFor(p12Der: string, chainDer: Uint8Array[]): Promise<Omit<DigitalIdRecord, 'id' | 'createdAt'>> {
  const info = await readCertificate(chainDer[0]!);
  return {
    p12: forge.util.encode64(p12Der),
    name: info.subject.name,
    email: info.subject.email,
    org: info.subject.org,
    issuer: info.issuer.name,
    notAfter: info.notAfter.getTime(),
    fingerprint: info.fingerprint,
    selfSigned: info.selfSigned,
  };
}

/** A new self-signed ID: an RSA key made by the browser, a certificate for document signing. */
export async function createSelfSignedId(opts: { name: string; email?: string; org?: string; password: string; years?: number }): Promise<DigitalIdRecord> {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const key = forge.pki.privateKeyFromAsn1(asn1.fromDer(toBinary(pkcs8))) as forge.pki.rsa.PrivateKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  // A positive serial number (top bit clear).
  const serial = globalThis.crypto.getRandomValues(new Uint8Array(16));
  serial[0]! &= 0x7f;
  cert.serialNumber = hex(serial);
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now);
  cert.validity.notAfter.setFullYear(now.getFullYear() + (opts.years ?? 5));
  const attrs = [{ name: 'commonName', value: opts.name }, ...(opts.org ? [{ name: 'organizationName', value: opts.org }] : []), ...(opts.email ? [{ name: 'emailAddress', value: opts.email }] : [])];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], opts.password, { algorithm: 'aes256', friendlyName: opts.name });
  const p12Der = asn1.toDer(p12).getBytes();
  const certDer = fromBinary(asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  return { id: crypto.randomUUID(), createdAt: Date.now(), ...(await recordFor(p12Der, [certDer])) };
}

/** Opens a PKCS#12 with its password: the key and its certificate chain. */
export function unlockP12(p12Der: string, password: string): UnlockedId {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(p12Der), false, password);
  } catch {
    throw new Error('Wrong password, or not a Digital ID file');
  }
  const bags = (type: string): forge.pkcs12.Bag[] => p12.getBags({ bagType: type })[type] ?? [];
  const keyBag = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag!), ...bags(forge.pki.oids.keyBag!)][0];
  const key = keyBag?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new Error('The Digital ID has no private key (or it is not an RSA key)');
  const certs = bags(forge.pki.oids.certBag!).map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  // The signer's certificate is the one whose public key matches the private key.
  const mine = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n));
  if (!mine) throw new Error('The Digital ID has no certificate for its key');
  const chain = [mine, ...certs.filter((c) => c !== mine)];
  return { key, chain, chainDer: chain.map((c) => fromBinary(asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes())) };
}

/** Imports a .p12/.pfx file (checked with its password). */
export async function importDigitalId(bytes: Uint8Array, password: string): Promise<DigitalIdRecord> {
  const der = toBinary(bytes);
  const unlocked = unlockP12(der, password);
  return { id: crypto.randomUUID(), createdAt: Date.now(), ...(await recordFor(der, unlocked.chainDer)) };
}

export function unlockId(record: DigitalIdRecord, password: string): UnlockedId {
  return unlockP12(forge.util.decode64(record.p12), password);
}

/** The ID's certificate as a .cer (DER), to give to people who check your signatures. */
export function certificateOf(record: DigitalIdRecord, password: string): Uint8Array {
  return unlockId(record, password).chainDer[0]!;
}

// --- Stored IDs and trusted certificates ---------------------------------------------------------

const IDS_KEY = 'nb.digitalIds';
const TRUST_KEY = 'nb.trustedCertificates';

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('The browser did not allow saving on this device');
  }
}

export const digitalIds = {
  list: (): DigitalIdRecord[] => read<DigitalIdRecord[]>(IDS_KEY, []),
  add(r: DigitalIdRecord) {
    write(IDS_KEY, [...digitalIds.list().filter((x) => x.fingerprint !== r.fingerprint), r]);
  },
  remove(id: string) {
    write(IDS_KEY, digitalIds.list().filter((x) => x.id !== id));
  },
  /** Certificates trusted to identify signers (by SHA-256 fingerprint); your own IDs always are. */
  trusted: (): string[] => [...new Set([...read<string[]>(TRUST_KEY, []), ...digitalIds.list().map((r) => r.fingerprint)])],
  trust(fingerprint: string) {
    write(TRUST_KEY, [...new Set([...read<string[]>(TRUST_KEY, []), fingerprint])]);
  },
};
