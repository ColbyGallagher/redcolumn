import forge from 'node-forge';
import { binaryToBytes, bytesToBinary } from './digitalIds';

/**
 * The certificate services around signatures: trusted time stamps (RFC 3161), building a
 * signer's certificate chain, and asking whether a certificate was revoked (OCSP, else the CRL).
 * Everything here works on DER bytes; the network is reached through a `PkiFetch`.
 */

const asn1 = forge.asn1;
type Node = forge.asn1.Asn1;
const { Class, Type } = asn1;

const kids = (n: Node) => n.value as Node[];
const parse = (der: Uint8Array): Node => asn1.fromDer(bytesToBinary(der), { strict: false, parseAllBytes: false, decodeBitStrings: false } as never);
const der = (n: Node) => binaryToBytes(asn1.toDer(n).getBytes());
const oidOf = (n: Node) => asn1.derToOid(n.value as string);
const bytesOf = (n: Node) => binaryToBytes(n.value as string);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const isContext = (n: Node | undefined, tag: number) => !!n && n.tagClass === Class.CONTEXT_SPECIFIC && n.type === tag;
/** An INTEGER's value without leading zero bytes, as hex. */
const serialHex = (n: Node) => hex(bytesOf(n)).replace(/^(00)+(?=.)/, '');
const timeOf = (n: Node) => (n.type === Type.UTCTIME ? asn1.utcTimeToDate(n.value as string) : asn1.generalizedTimeToDate(n.value as string));
/** A BIT STRING's bytes, without its unused-bits byte. */
const bitsOf = (n: Node) => bytesOf(n).subarray(1);

async function digest(alg: HashName, data: Uint8Array) {
  return new Uint8Array(await globalThis.crypto.subtle.digest(alg, data as BufferSource));
}

export type HashName = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export const HASH_OIDS: Record<string, HashName> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};
const HASH_OID_OF: Record<HashName, string> = { 'SHA-1': '1.3.14.3.2.26', 'SHA-256': '2.16.840.1.101.3.4.2.1', 'SHA-384': '2.16.840.1.101.3.4.2.2', 'SHA-512': '2.16.840.1.101.3.4.2.3' };

/** Signature algorithms (on certificates, OCSP answers and CRLs) and the hash each uses. */
const SIG_HASH: Record<string, HashName> = {
  '1.2.840.113549.1.1.5': 'SHA-1',
  '1.2.840.113549.1.1.11': 'SHA-256',
  '1.2.840.113549.1.1.12': 'SHA-384',
  '1.2.840.113549.1.1.13': 'SHA-512',
  '1.2.840.10045.4.1': 'SHA-1',
  '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384',
  '1.2.840.10045.4.3.4': 'SHA-512',
};

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  timestampToken: '1.2.840.113549.1.9.16.2.14',
  messageDigest: '1.2.840.113549.1.9.4',
  authorityInfoAccess: '1.3.6.1.5.5.7.1.1',
  ocsp: '1.3.6.1.5.5.7.48.1',
  caIssuers: '1.3.6.1.5.5.7.48.2',
  crlDistributionPoints: '2.5.29.31',
  ocspBasic: '1.3.6.1.5.5.7.48.1.1',
  commonName: '2.5.4.3',
  org: '2.5.4.10',
};

// --- Verifying signatures --------------------------------------------------------------------------

/** An ECDSA signature (DER SEQUENCE of r, s) as WebCrypto's fixed-width r‖s. */
function ecdsaRaw(sig: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * 2);
  kids(parse(sig)).forEach((n, k) => {
    let v = bytesOf(n);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    out.set(v, k * size + size - v.length);
  });
  return out;
}

const EC_CURVES: Record<string, [string, number]> = { '1.2.840.10045.3.1.7': ['P-256', 32], '1.3.132.0.34': ['P-384', 48], '1.3.132.0.35': ['P-521', 66] };

/** Checks an RSA (PKCS #1 v1.5) or ECDSA signature over `signed` with a SubjectPublicKeyInfo. */
export async function verifySignature(spki: Uint8Array, hash: string, signed: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const alg = kids(kids(parse(spki))[0]!);
  const keyOid = oidOf(alg[0]!);
  const subtle = globalThis.crypto.subtle;
  if (keyOid === '1.2.840.113549.1.1.1') {
    const key = await subtle.importKey('spki', spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
    return subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, signed as BufferSource);
  }
  if (keyOid === '1.2.840.10045.2.1') {
    const curve = EC_CURVES[oidOf(alg[1]!)];
    if (!curve) throw new Error('This elliptic curve is not supported');
    const key = await subtle.importKey('spki', spki as BufferSource, { name: 'ECDSA', namedCurve: curve[0] }, false, ['verify']);
    return subtle.verify({ name: 'ECDSA', hash }, key, ecdsaRaw(signature, curve[1]) as BufferSource, signed as BufferSource);
  }
  throw new Error('This kind of key is not supported');
}

/** Something signed with an X.509-style envelope: SEQUENCE { tbs, algorithm, BIT STRING }. */
async function verifySigned(envelope: Node, spki: Uint8Array): Promise<boolean> {
  const [tbs, alg, sig] = kids(envelope);
  const hash = SIG_HASH[oidOf(kids(alg!)[0]!)];
  if (!hash) return false;
  try {
    return await verifySignature(spki, hash, der(tbs!), bitsOf(sig!));
  } catch {
    return false;
  }
}

// --- Certificates ----------------------------------------------------------------------------------

export interface CertFacts {
  der: Uint8Array;
  node: Node;
  serial: string;
  /** Name DERs, compared as bytes to link a certificate to its issuer. */
  issuerDer: Uint8Array;
  subjectDer: Uint8Array;
  subjectName: string;
  spki: Uint8Array;
  /** The public key's bits (for OCSP's issuer key hash). */
  keyBits: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  ocspUrls: string[];
  crlUrls: string[];
  caIssuerUrls: string[];
  fingerprint: string;
}

/** Every URI (GeneralName [6]) inside a node. */
function urisIn(n: Node, out: string[] = []): string[] {
  if (n.tagClass === Class.CONTEXT_SPECIFIC && n.type === 6 && !n.constructed) out.push(n.value as string);
  else if (Array.isArray(n.value)) for (const k of n.value) urisIn(k, out);
  return out;
}

function nameText(name: Node): string {
  const found = new Map<string, string>();
  for (const rdn of kids(name))
    for (const atv of kids(rdn)) {
      const [type, value] = kids(atv);
      const oid = oidOf(type!);
      let v = value!.value as string;
      if (value!.type === Type.BMPSTRING) v = new TextDecoder('utf-16be').decode(binaryToBytes(v));
      else if (value!.type === Type.UTF8) v = forge.util.decodeUtf8(v);
      if (!found.has(oid)) found.set(oid, v);
    }
  return found.get(OID.commonName) ?? found.get(OID.org) ?? '';
}

export async function certFacts(bytes: Uint8Array): Promise<CertFacts> {
  const node = parse(bytes);
  const fields = kids(kids(node)[0]!);
  const i = isContext(fields[0], 0) ? 1 : 0;
  const validity = kids(fields[i + 3]!);
  const spkiNode = fields[i + 5]!;
  const facts: CertFacts = {
    der: bytes,
    node,
    serial: serialHex(fields[i]!),
    issuerDer: der(fields[i + 2]!),
    subjectDer: der(fields[i + 4]!),
    subjectName: nameText(fields[i + 4]!),
    spki: der(spkiNode),
    keyBits: bitsOf(kids(spkiNode)[1]!),
    notBefore: timeOf(validity[0]!),
    notAfter: timeOf(validity[1]!),
    ocspUrls: [],
    crlUrls: [],
    caIssuerUrls: [],
    fingerprint: hex(await digest('SHA-256', bytes)),
  };
  const extensions = fields.find((f) => isContext(f, 3));
  for (const ext of extensions ? kids(kids(extensions)[0]!) : []) {
    const parts = kids(ext);
    const id = oidOf(parts[0]!);
    const value = parse(bytesOf(parts[parts.length - 1]!));
    if (id === OID.authorityInfoAccess)
      for (const ad of kids(value)) {
        const [method, location] = kids(ad);
        const uris = urisIn(location!);
        if (oidOf(method!) === OID.ocsp) facts.ocspUrls.push(...uris);
        else if (oidOf(method!) === OID.caIssuers) facts.caIssuerUrls.push(...uris);
      }
    else if (id === OID.crlDistributionPoints) facts.crlUrls.push(...urisIn(value));
  }
  const web = (u: string) => /^https?:\/\//i.test(u);
  facts.ocspUrls = facts.ocspUrls.filter(web);
  facts.crlUrls = facts.crlUrls.filter(web);
  facts.caIssuerUrls = facts.caIssuerUrls.filter(web);
  return facts;
}

/** Whether `issuer` signed `cert`. */
export async function issuedBy(cert: CertFacts, issuer: CertFacts): Promise<boolean> {
  return same(cert.issuerDer, issuer.subjectDer) && verifySigned(cert.node, issuer.spki);
}

const selfIssued = (c: CertFacts) => same(c.issuerDer, c.subjectDer);

export interface Chain {
  /** The signer's certificate first, then each issuer found. */
  certs: CertFacts[];
  /** It ends in a self-signed (root) certificate and every link checks out. */
  complete: boolean;
  problem: string | null;
}

/** Builds the signer's chain from the certificates at hand (a signature carries its chain). */
export async function buildChain(signer: Uint8Array, pool: readonly Uint8Array[]): Promise<Chain> {
  const all = await Promise.all(pool.map(certFacts));
  const first = await certFacts(signer);
  const certs = [first];
  for (let cur = first; certs.length < 10; ) {
    if (selfIssued(cur)) {
      const ok = await verifySigned(cur.node, cur.spki);
      return { certs, complete: ok, problem: ok ? null : `${cur.subjectName}’s certificate does not check out` };
    }
    let next: CertFacts | null = null;
    for (const c of all) if (c.fingerprint !== cur.fingerprint && !certs.some((x) => x.fingerprint === c.fingerprint) && (await issuedBy(cur, c))) next = c;
    if (!next) return { certs, complete: false, problem: `The certificate of ${cur.subjectName}’s issuer is not in the signature` };
    certs.push(next);
    cur = next;
  }
  return { certs, complete: false, problem: 'The certificate chain is too long' };
}

// --- Time stamps (RFC 3161) ----------------------------------------------------------------------

const seq = (...v: Node[]) => asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, v);
const int = (b: Uint8Array) => asn1.create(Class.UNIVERSAL, Type.INTEGER, false, bytesToBinary(b[0]! & 0x80 ? new Uint8Array([0, ...b]) : b));
const smallInt = (n: number) => asn1.create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(n).getBytes());
const octets = (b: Uint8Array) => asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, bytesToBinary(b));
const oid = (o: string) => asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(o).getBytes());
const nul = () => asn1.create(Class.UNIVERSAL, Type.NULL, false, '');
const algId = (o: string) => seq(oid(o), nul());

/** A TimeStampReq for a SHA-256 hash, asking for the TSA's certificate in the answer. */
export function timestampRequest(hash: Uint8Array, nonce: Uint8Array): Uint8Array {
  return der(seq(smallInt(1), seq(algId(HASH_OID_OF['SHA-256']), octets(hash)), int(nonce), asn1.create(Class.UNIVERSAL, Type.BOOLEAN, false, '\xff')));
}

/** The token in a TimeStampResp, or why the TSA refused. */
export function timestampToken(response: Uint8Array): Uint8Array {
  const parts = kids(parse(response));
  const status = kids(parts[0]!);
  const code = asn1.derToInteger(status[0]!.value as string);
  if (code > 1 || !parts[1]) {
    const words = status[1] && Array.isArray(status[1].value) ? kids(status[1]).map((n) => n.value as string).join(' ') : '';
    throw new Error(`The time stamp server refused${words ? `: ${words}` : ` (status ${code})`}`);
  }
  return der(parts[1]);
}

/** SignedData's parts: [version, digestAlgorithms, encapContentInfo, (certs), (crls), signerInfos]. */
function signedDataOf(contentInfo: Node): Node[] {
  const [type, content] = kids(contentInfo);
  if (oidOf(type!) !== OID.signedData) throw new Error('Not a CMS SignedData');
  return kids(kids(content!)[0]!);
}

/** The signature value of a CMS's first signer (what a time stamp is taken over). */
export function signatureValueOf(cms: Uint8Array): Uint8Array {
  const parts = signedDataOf(parse(cms));
  const si = kids(kids(parts[parts.length - 1]!)[0]!);
  const at = si.findIndex((n) => n.tagClass === Class.UNIVERSAL && n.type === Type.OCTETSTRING);
  return bytesOf(si[at]!);
}

/** The CMS with a time stamp token added to its first signer, as an unsigned attribute. */
export function withTimestamp(cms: Uint8Array, token: Uint8Array): Uint8Array {
  const root = parse(cms);
  const parts = signedDataOf(root);
  const si = kids(kids(parts[parts.length - 1]!)[0]!);
  const attr = seq(oid(OID.timestampToken), asn1.create(Class.UNIVERSAL, Type.SET, true, [parse(token)]));
  const unsigned = si.find((n) => isContext(n, 1));
  if (unsigned) kids(unsigned).push(attr);
  else si.push(asn1.create(Class.CONTEXT_SPECIFIC, 1, true, [attr]));
  return der(root);
}

/** A signer's unsigned time stamp token, if it has one. */
export function timestampTokenOf(cms: Uint8Array): Uint8Array | null {
  const parts = signedDataOf(parse(cms));
  const si = kids(kids(parts[parts.length - 1]!)[0]!);
  const unsigned = si.find((n) => isContext(n, 1));
  for (const a of unsigned ? kids(unsigned) : []) if (oidOf(kids(a)[0]!) === OID.timestampToken) return der(kids(kids(a)[1]!)[0]!);
  return null;
}

export interface TimestampInfo {
  time: Date;
  /** The TSA's name, from its certificate. */
  tsa: string;
  /** The token is for this signature and the TSA's signature on it checks out. */
  verified: boolean;
  problem: string | null;
}

/** Reads and checks a time stamp token against the signature value it should cover. */
export async function readTimestamp(token: Uint8Array, signatureValue: Uint8Array): Promise<TimestampInfo> {
  const parts = signedDataOf(parse(token));
  const encap = kids(parts[2]!);
  if (oidOf(encap[0]!) !== OID.tstInfo) throw new Error('Not a time stamp token');
  const tstDer = bytesOf(kids(encap[1]!)[0]!);
  const tst = kids(parse(tstDer));
  const imprint = kids(tst[2]!);
  const hashName = HASH_OIDS[oidOf(kids(imprint[0]!)[0]!)];
  const time = timeOf(tst[4]!);
  const info: TimestampInfo = { time, tsa: '', verified: false, problem: null };
  const certSet = parts.find((p) => isContext(p, 0));
  const certs = certSet ? await Promise.all(kids(certSet).map((c) => certFacts(der(c)))) : [];
  const si = kids(kids(parts[parts.length - 1]!)[0]!);
  const sid = si[1]!;
  const serial = sid.tagClass === Class.UNIVERSAL ? serialHex(kids(sid)[1]!) : null;
  const tsaCert = certs.find((c) => !serial || c.serial === serial) ?? null;
  info.tsa = tsaCert?.subjectName ?? '';
  try {
    if (!hashName) throw new Error('The time stamp uses a hash this app cannot check');
    if (!same(bytesOf(imprint[1]!), await digest(hashName, signatureValue))) throw new Error('The time stamp is for another signature');
    if (!tsaCert) throw new Error('The time stamp has no certificate');
    const signHash = HASH_OIDS[oidOf(kids(si[2]!)[0]!)];
    if (!signHash) throw new Error('The time stamp is signed with a hash this app cannot check');
    let k = 3;
    const signedAttrs = isContext(si[k], 0) ? si[k++]! : null;
    k++; // signature algorithm
    const signature = bytesOf(si[k]!);
    let ok: boolean;
    if (signedAttrs) {
      const md = kids(signedAttrs).find((a) => oidOf(kids(a)[0]!) === OID.messageDigest);
      if (!md || !same(bytesOf(kids(kids(md)[1]!)[0]!), await digest(signHash, tstDer))) throw new Error('The time stamp was altered');
      const attrsDer = der(signedAttrs);
      attrsDer[0] = 0x31;
      ok = await verifySignature(tsaCert.spki, signHash, attrsDer, signature);
    } else ok = await verifySignature(tsaCert.spki, signHash, tstDer, signature);
    if (!ok) throw new Error('The time stamp server’s signature does not check out');
    if (time < tsaCert.notBefore || time > tsaCert.notAfter) throw new Error('The time stamp server’s certificate was not valid then');
    info.verified = true;
  } catch (err) {
    info.problem = err instanceof Error ? err.message : String(err);
  }
  return info;
}

/** Fetches through the relay: a POST with `body` of `type`, or a GET. */
export type PkiFetch = (url: string, body?: Uint8Array, type?: string) => Promise<Uint8Array>;

/** Asks a TSA for a token over a signature value (a random nonce guards against replays). */
export async function fetchTimestamp(url: string, signatureValue: Uint8Array, fetcher: PkiFetch): Promise<Uint8Array> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(8));
  nonce[0] = nonce[0]! & 0x7f;
  const token = timestampToken(await fetcher(url, timestampRequest(await digest('SHA-256', signatureValue), nonce), 'application/timestamp-query'));
  // The nonce must come back, or the answer could be an old one replayed.
  const tst = kids(parse(bytesOf(kids(kids(signedDataOf(parse(token))[2]!)[1]!)[0]!)));
  const back = tst.find((n, i) => i > 4 && n.tagClass === Class.UNIVERSAL && n.type === Type.INTEGER);
  if (back && serialHex(back) !== hex(nonce).replace(/^(00)+(?=.)/, '')) throw new Error('The time stamp server answered a different request');
  return token;
}

// --- Revocation -----------------------------------------------------------------------------------

export type RevocationStatus = 'good' | 'revoked' | 'unknown';

export interface Revocation {
  status: RevocationStatus;
  via: 'OCSP' | 'CRL';
  revokedAt: Date | null;
  /** When the answer was made. */
  at: Date | null;
  /** The answer is signed by the issuer (or a responder it appointed). */
  verified: boolean;
}

/** An OCSP request for one certificate (CertID with SHA-1, as responders universally accept). */
export async function ocspRequest(cert: CertFacts, issuer: CertFacts): Promise<Uint8Array> {
  const certId = seq(algId(HASH_OID_OF['SHA-1']), octets(await digest('SHA-1', cert.issuerDer)), octets(await digest('SHA-1', issuer.keyBits)), int(Uint8Array.from(cert.serial.match(/../g) ?? ['00'], (h) => parseInt(h, 16))));
  return der(seq(seq(seq(seq(certId)))));
}

/** Reads an OCSP answer about `cert`. */
export async function ocspStatus(response: Uint8Array, cert: CertFacts, issuer: CertFacts): Promise<Revocation> {
  const top = kids(parse(response));
  const code = asn1.derToInteger(top[0]!.value as string);
  if (code !== 0) throw new Error(`The OCSP responder refused (status ${code})`);
  const bytes = kids(kids(top[1]!)[0]!);
  if (oidOf(bytes[0]!) !== OID.ocspBasic) throw new Error('An OCSP answer of a kind this app cannot read');
  const basicNode = parse(bytesOf(bytes[1]!));
  const basic = kids(basicNode);
  const data = kids(basic[0]!);
  let i = isContext(data[0], 0) ? 1 : 0;
  i++; // responder ID
  const producedAt = timeOf(data[i++]!);
  let found: Revocation | null = null;
  for (const single of kids(data[i]!)) {
    const [certId, status] = kids(single);
    if (serialHex(kids(certId!)[3]!) !== cert.serial) continue;
    const state = status!.type === 0 ? 'good' : status!.type === 1 ? 'revoked' : 'unknown';
    found = { status: state, via: 'OCSP', revokedAt: state === 'revoked' ? timeOf(kids(status!)[0]!) : null, at: producedAt, verified: false };
  }
  if (!found) throw new Error('The OCSP answer is about another certificate');
  // Signed by the issuer, or by a responder certificate the issuer signed.
  let verified = await verifySigned(basicNode, issuer.spki);
  const certSet = basic.find((p) => isContext(p, 0));
  if (!verified && certSet)
    for (const c of kids(kids(certSet)[0]!)) {
      const responder = await certFacts(der(c));
      if ((await issuedBy(responder, issuer)) && (await verifySigned(basicNode, responder.spki))) verified = true;
    }
  found.verified = verified;
  return found;
}

/** Looks `cert` up in a certificate revocation list. */
export async function crlStatus(crl: Uint8Array, cert: CertFacts, issuer: CertFacts): Promise<Revocation> {
  const node = parse(crl);
  const tbs = kids(kids(node)[0]!);
  let i = tbs[0]!.type === Type.INTEGER ? 1 : 0;
  i++; // signature algorithm
  const crlIssuer = der(tbs[i++]!);
  if (!same(crlIssuer, cert.issuerDer)) throw new Error('The revocation list is from another issuer');
  const thisUpdate = timeOf(tbs[i++]!);
  if (tbs[i] && (tbs[i]!.type === Type.UTCTIME || tbs[i]!.type === Type.GENERALIZEDTIME)) i++;
  let revokedAt: Date | null = null;
  const list = tbs[i] && tbs[i]!.tagClass === Class.UNIVERSAL && tbs[i]!.type === Type.SEQUENCE ? kids(tbs[i]!) : [];
  for (const entry of list) {
    const [serial, when] = kids(entry);
    if (serialHex(serial!) === cert.serial) revokedAt = timeOf(when!);
  }
  return { status: revokedAt ? 'revoked' : 'good', via: 'CRL', revokedAt, at: thisUpdate, verified: await verifySigned(node, issuer.spki) };
}

/**
 * Whether the signer's certificate was revoked: its OCSP responder first, else its CRL. The
 * issuer comes from the chain, or is fetched from the certificate's CA Issuers address.
 */
export async function checkRevocation(chain: Chain, fetcher: PkiFetch): Promise<Revocation> {
  const cert = chain.certs[0]!;
  if (selfIssued(cert)) throw new Error('A self-signed certificate cannot be revoked; trust it or not');
  let issuer = chain.certs[1] ?? null;
  if (!issuer)
    for (const url of cert.caIssuerUrls) {
      try {
        const candidate = await certFacts(await fetcher(url));
        if (await issuedBy(cert, candidate)) issuer = candidate;
      } catch {
        // Try the next address.
      }
    }
  if (!issuer) throw new Error('The issuer’s certificate is not available to check with');
  const problems: string[] = [];
  for (const url of cert.ocspUrls) {
    try {
      return await ocspStatus(await fetcher(url, await ocspRequest(cert, issuer), 'application/ocsp-request'), cert, issuer);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  for (const url of cert.crlUrls) {
    try {
      return await crlStatus(await fetcher(url), cert, issuer);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(problems.length ? problems.join('; ') : 'The certificate names no OCSP responder or revocation list');
}
