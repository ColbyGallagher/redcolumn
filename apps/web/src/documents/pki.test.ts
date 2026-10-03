import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { binaryToBytes, bytesToBinary } from './digitalIds.ts';
import { PDFDocument } from 'pdf-lib';
import { checkSignatures, signPdf } from './pdfSign.ts';
import { buildChain, certFacts, checkRevocation, crlStatus, fetchTimestamp, ocspRequest, ocspStatus, readTimestamp, signatureValueOf, timestampTokenOf, withTimestamp } from './pki.ts';

const asn1 = forge.asn1;
const { Class, Type } = asn1;
type Node = forge.asn1.Asn1;
const seq = (...v: Node[]) => asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, v);
const set = (...v: Node[]) => asn1.create(Class.UNIVERSAL, Type.SET, true, v);
const oid = (o: string) => asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(o).getBytes());
const int = (n: number) => asn1.create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(n).getBytes());
const intHex = (h: string) => asn1.create(Class.UNIVERSAL, Type.INTEGER, false, forge.util.hexToBytes(h));
const octets = (s: string) => asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, s);
const gtime = (d: Date) => asn1.create(Class.UNIVERSAL, Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(d));
const utime = (d: Date) => asn1.create(Class.UNIVERSAL, Type.UTCTIME, false, asn1.dateToUtcTime(d));
const nul = () => asn1.create(Class.UNIVERSAL, Type.NULL, false, '');
const alg = (o: string) => seq(oid(o), nul());
const bits = (s: string) => asn1.create(Class.UNIVERSAL, Type.BITSTRING, false, '\x00' + s);
const ctx = (tag: number, constructed: boolean, v: Node[] | string) => asn1.create(Class.CONTEXT_SPECIFIC, tag, constructed, v);
const toDer = (n: Node) => asn1.toDer(n).getBytes();
const SHA256 = '2.16.840.1.101.3.4.2.1';
const SHA256_RSA = '1.2.840.113549.1.1.11';
const sha256 = (s: string) => {
  const md = forge.md.sha256.create();
  md.update(s);
  return md;
};

interface Party {
  key: forge.pki.rsa.KeyPair;
  cert: forge.pki.Certificate;
  der: Uint8Array;
}

function party(name: string, serial: string, issuer: Party | null, extensions: object[] = []): Party {
  const key = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = key.publicKey;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
  cert.setSubject([{ name: 'commonName', value: name }]);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : [{ name: 'commonName', value: name }]);
  cert.setExtensions(extensions);
  cert.sign(issuer ? issuer.key.privateKey : key.privateKey, forge.md.sha256.create());
  return { key, cert, der: binaryToBytes(toDer(forge.pki.certificateToAsn1(cert))) };
}

// A root CA, a signer it issued (with OCSP, CA Issuers and CRL addresses), and a TSA.
const aia = toDer(seq(seq(oid('1.3.6.1.5.5.7.48.1'), ctx(6, false, 'http://ocsp.example/')), seq(oid('1.3.6.1.5.5.7.48.2'), ctx(6, false, 'http://ca.example/root.cer'))));
const crlDp = toDer(seq(seq(ctx(0, true, [ctx(0, true, [ctx(6, false, 'http://ca.example/root.crl')])]))));
const root = party('Test Root', '01', null, [{ name: 'basicConstraints', cA: true }]);
const signer = party('Jane Signer', '1a2b', root, [
  { id: '1.3.6.1.5.5.7.1.1', value: aia },
  { id: '2.5.29.31', value: crlDp },
]);
const tsa = party('Test TSA', '7f', root);

/** A detached CMS by the signer over some bytes, as signPdf makes. */
function cms(): Uint8Array {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer('the document');
  p7.addCertificate(signer.cert);
  p7.addCertificate(root.cert);
  p7.addSigner({ key: signer.key.privateKey, certificate: signer.cert, digestAlgorithm: forge.pki.oids.sha256!, authenticatedAttributes: [{ type: forge.pki.oids.contentType!, value: forge.pki.oids.data! }, { type: forge.pki.oids.messageDigest! }] });
  p7.sign({ detached: true });
  return binaryToBytes(toDer(p7.toAsn1()));
}

/** What a TSA answers: a token over `hash`, signed by the TSA, echoing the nonce. */
function tsaResponse(request: Uint8Array, when: Date, tamper = false): Uint8Array {
  const req = asn1.fromDer(bytesToBinary(request)).value as Node[];
  const imprint = req[1]!;
  const nonce = req[2]!;
  const tst = toDer(seq(int(1), oid('1.2.3.4'), imprint, int(99), gtime(when), nonce));
  const attrs = [seq(oid(forge.pki.oids.contentType!), set(oid('1.2.840.113549.1.9.16.1.4'))), seq(oid(forge.pki.oids.messageDigest!), set(octets(sha256(tst).digest().getBytes())))];
  const signature = tsa.key.privateKey.sign(sha256(toDer(set(...attrs))));
  const signerInfo = seq(int(1), seq(forge.pki.distinguishedNameToAsn1(root.cert.subject), intHex('7f')), alg(SHA256), ctx(0, true, attrs), alg('1.2.840.113549.1.1.1'), octets(tamper ? signature.replace(/^./, 'x') : signature));
  const signedData = seq(int(3), set(alg(SHA256)), seq(oid('1.2.840.113549.1.9.16.1.4'), ctx(0, true, [octets(tst)])), ctx(0, true, [forge.pki.certificateToAsn1(tsa.cert)]), set(signerInfo));
  const token = seq(oid('1.2.840.113549.1.7.2'), ctx(0, true, [signedData]));
  return binaryToBytes(toDer(seq(seq(int(0)), token)));
}

test('a time stamp is requested over the signature, attached, and checks out', async () => {
  const signed = cms();
  const value = signatureValueOf(signed);
  const when = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
  let asked = '';
  const token = await fetchTimestamp('http://tsa.example/', value, async (url, body, type) => {
    asked = `${url} ${type}`;
    return tsaResponse(body!, when);
  });
  assert.equal(asked, 'http://tsa.example/ application/timestamp-query');
  const stamped = withTimestamp(signed, token);
  assert.deepEqual(timestampTokenOf(stamped), token);
  // The signature itself is unchanged by the unsigned attribute.
  assert.deepEqual(signatureValueOf(stamped), value);
  const info = await readTimestamp(timestampTokenOf(stamped)!, value);
  assert.equal(info.problem, null);
  assert.equal(info.verified, true);
  assert.equal(info.tsa, 'Test TSA');
  assert.equal(info.time.getTime(), when.getTime());

  const other = await readTimestamp(token, new Uint8Array([1, 2, 3]));
  assert.equal(other.verified, false);
  assert.match(other.problem!, /another signature/);
  const forged = await fetchTimestamp('http://tsa.example/', value, async (_u, body) => tsaResponse(body!, when, true));
  assert.match((await readTimestamp(forged, value)).problem!, /does not check out/);
});

test('a refusing TSA or a replayed answer is an error', async () => {
  const value = signatureValueOf(cms());
  const refuse = binaryToBytes(toDer(seq(seq(int(2), seq(asn1.create(Class.UNIVERSAL, Type.UTF8, false, 'bad request'))))));
  await assert.rejects(fetchTimestamp('http://tsa.example/', value, async () => refuse), /refused: bad request/);
  const old = tsaResponse(binaryToBytes(toDer(seq(int(1), seq(alg(SHA256), octets('x'.repeat(32))), int(12345)))), new Date());
  await assert.rejects(fetchTimestamp('http://tsa.example/', value, async () => old), /different request/);
});

test('the chain runs from the signer to a self-signed root; addresses are read', async () => {
  const chain = await buildChain(signer.der, [tsa.der, root.der, signer.der]);
  assert.equal(chain.complete, true);
  assert.deepEqual(chain.certs.map((c) => c.subjectName), ['Jane Signer', 'Test Root']);
  const facts = chain.certs[0]!;
  assert.deepEqual(facts.ocspUrls, ['http://ocsp.example/']);
  assert.deepEqual(facts.caIssuerUrls, ['http://ca.example/root.cer']);
  assert.deepEqual(facts.crlUrls, ['http://ca.example/root.crl']);
  const alone = await buildChain(signer.der, []);
  assert.equal(alone.complete, false);
  assert.match(alone.problem!, /issuer/);
});

function ocspResponse(request: Uint8Array, revoked: Date | null, signerKey = root.key.privateKey): Uint8Array {
  const certId = (((asn1.fromDer(bytesToBinary(request)).value as Node[])[0]!.value as Node[])[0]!.value as Node[])[0]!.value as Node[];
  const status = revoked ? ctx(1, true, [gtime(revoked)]) : ctx(0, false, '');
  const data = seq(ctx(1, true, [forge.pki.distinguishedNameToAsn1(root.cert.subject)]), gtime(new Date()), seq(seq(certId[0]!, status, gtime(new Date()))));
  const basic = seq(data, alg(SHA256_RSA), bits(signerKey.sign(sha256(toDer(data)))));
  return binaryToBytes(toDer(seq(asn1.create(Class.UNIVERSAL, Type.ENUMERATED, false, '\x00'), ctx(0, true, [seq(oid('1.3.6.1.5.5.7.48.1.1'), octets(toDer(basic)))]))));
}

function crl(revokedSerials: string[]): Uint8Array {
  const tbs = seq(int(1), alg(SHA256_RSA), forge.pki.distinguishedNameToAsn1(root.cert.subject), utime(new Date()), utime(new Date(Date.now() + 86400_000)), ...(revokedSerials.length ? [seq(...revokedSerials.map((s) => seq(intHex(s), utime(new Date(Date.UTC(2026, 0, 2))))))] : []));
  return binaryToBytes(toDer(seq(tbs, alg(SHA256_RSA), bits(root.key.privateKey.sign(sha256(toDer(tbs)))))));
}

test('OCSP answers say good or revoked, and are checked against the issuer', async () => {
  const cert = await certFacts(signer.der);
  const issuer = await certFacts(root.der);
  const req = await ocspRequest(cert, issuer);
  const good = await ocspStatus(ocspResponse(req, null), cert, issuer);
  assert.equal(good.status, 'good');
  assert.equal(good.verified, true);
  const when = new Date(Date.UTC(2026, 3, 1));
  const bad = await ocspStatus(ocspResponse(req, when), cert, issuer);
  assert.equal(bad.status, 'revoked');
  assert.equal(bad.revokedAt!.getTime(), when.getTime());
  const forged = await ocspStatus(ocspResponse(req, null, tsa.key.privateKey), cert, issuer);
  assert.equal(forged.verified, false);
});

test('CRLs list revoked serial numbers', async () => {
  const cert = await certFacts(signer.der);
  const issuer = await certFacts(root.der);
  assert.equal((await crlStatus(crl(['05']), cert, issuer)).status, 'good');
  const hit = await crlStatus(crl(['05', '1a2b']), cert, issuer);
  assert.equal(hit.status, 'revoked');
  assert.equal(hit.verified, true);
});

test('revocation: OCSP first, the CRL when OCSP fails, the issuer fetched when missing', async () => {
  const urls: string[] = [];
  const chain = await buildChain(signer.der, []);
  const status = await checkRevocation(chain, async (url, body) => {
    urls.push(url);
    if (url.endsWith('.cer')) return root.der;
    if (url.startsWith('http://ocsp')) throw new Error('offline');
    return crl(body ? [] : ['1a2b']);
  });
  assert.deepEqual(urls, ['http://ca.example/root.cer', 'http://ocsp.example/', 'http://ca.example/root.crl']);
  assert.equal(status.via, 'CRL');
  assert.equal(status.status, 'revoked');
  await assert.rejects(checkRevocation(await buildChain(root.der, []), async () => new Uint8Array()), /self-signed/);
});

test('a PDF signed with a time stamp shows when the TSA says it was signed, and its chain', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const bytes = await doc.save();
  const when = new Date(Math.floor(Date.now() / 1000) * 1000 - 3600_000);
  const id = { key: signer.key.privateKey, chain: [signer.cert, root.cert], chainDer: [signer.der, root.der] };
  const signed = await signPdf(bytes, id, { reason: 'Approved', date: new Date(Date.UTC(2020, 0, 1)), timestamp: (value) => fetchTimestamp('http://tsa.example/', value, async (_u, body) => tsaResponse(body!, when)) });
  const [check] = await checkSignatures(signed);
  assert.equal(check!.intact, true, check!.problem ?? '');
  assert.equal(check!.timestamp?.verified, true);
  assert.equal(check!.timestamp?.tsa, 'Test TSA');
  // The TSA's time, not the signer's clock.
  assert.equal(check!.signedAt!.getTime(), when.getTime());
  assert.deepEqual(check!.chain.names, ['Jane Signer', 'Test Root']);
  assert.equal(check!.chain.complete, true);
  assert.equal(check!.certificates.length, 2);
});
