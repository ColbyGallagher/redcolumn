import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { binaryToBytes, bytesToBinary } from './digitalIds.ts';
import { degrees, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { openForEdit } from './incremental.ts';
import { addDss, onlyValidationAdded, readDss } from './ltv.ts';
import { addValidationData, checkSignatures, signPdf } from './pdfSign.ts';
import { buildChain, certFacts, certificatesIn, checkRevocation, completeChain, crlStatus, fetchTimestamp, ocspRequest, ocspStatus, readTimestamp, signatureValueOf, timestampTokenOf, withTimestamp } from './pki.ts';

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

/** Alters a signature for sure: replacing a byte with a fixed one is a no-op when the byte already matches. */
const flipLastBit = (s: string) => s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) ^ 1);

/** What a TSA answers: a token over `hash`, signed by the TSA, echoing the nonce. */
function tsaResponse(request: Uint8Array, when: Date, tamper = false): Uint8Array {
  const req = asn1.fromDer(bytesToBinary(request)).value as Node[];
  const imprint = req[1]!;
  const nonce = req[2]!;
  const tst = toDer(seq(int(1), oid('1.2.3.4'), imprint, int(99), gtime(when), nonce));
  const attrs = [seq(oid(forge.pki.oids.contentType!), set(oid('1.2.840.113549.1.9.16.1.4'))), seq(oid(forge.pki.oids.messageDigest!), set(octets(sha256(tst).digest().getBytes())))];
  const signature = tsa.key.privateKey.sign(sha256(toDer(set(...attrs))));
  const signerInfo = seq(int(1), seq(forge.pki.distinguishedNameToAsn1(root.cert.subject), intHex('7f')), alg(SHA256), ctx(0, true, attrs), alg('1.2.840.113549.1.1.1'), octets(tamper ? flipLastBit(signature) : signature));
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

test('a short chain is completed from the CA Issuers address: DER, PKCS #7 or PEM, and only a real issuer', async () => {
  const asn = (p: Party) => forge.pki.certificateToAsn1(p.cert);
  const p7c = binaryToBytes(toDer(seq(oid('1.2.840.113549.1.7.2'), ctx(0, true, [seq(int(1), set(), seq(oid('1.2.840.113549.1.7.1')), ctx(0, true, [asn(tsa), asn(root)]), set())]))));
  const pem = new TextEncoder().encode(forge.pki.certificateToPem(root.cert));
  for (const [kind, answer] of [['DER', root.der], ['PKCS #7', p7c], ['PEM', pem]] as const) {
    const asked: string[] = [];
    const chain = await completeChain(await buildChain(signer.der, []), async (url) => (asked.push(url), answer));
    assert.equal(chain.complete, true, kind);
    assert.deepEqual(chain.certs.map((c) => c.subjectName), ['Jane Signer', 'Test Root'], kind);
    assert.deepEqual(asked, ['http://ca.example/root.cer'], kind);
  }
  // A certificate that did not issue the signer's, or a server that fails, leaves the chain as it was.
  let calls = 0;
  const wrong = await completeChain(await buildChain(signer.der, []), async () => (calls++, tsa.der));
  assert.equal(wrong.complete, false);
  assert.equal(wrong.certs.length, 1);
  assert.equal(calls, 1);
  const down = await completeChain(await buildChain(signer.der, []), async () => {
    throw new Error('ca.example cannot be reached');
  });
  assert.equal(down.certs.length, 1);
  // Answers that cannot be read (a SignedData header with nothing in it, garbage, an unreadable
  // known root or card certificate) leave the chain as it was instead of failing.
  const empty = new Uint8Array([0x30, 0x0b, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  assert.deepEqual(certificatesIn(empty), []);
  assert.deepEqual(certificatesIn(new Uint8Array([0x30, 0xff, 1])), []);
  for (const answer of [empty, new Uint8Array([0x30, 0xff, 1]), new TextEncoder().encode('-----BEGIN CERTIFICATE-----\n!!\n-----END CERTIFICATE-----')]) {
    const kept = await completeChain(await buildChain(signer.der, []), async () => answer, { anchors: [empty], pool: [new Uint8Array([0x30, 0x00])] });
    assert.deepEqual(kept.certs.map((c) => c.subjectName), ['Jane Signer']);
  }
  // A complete chain fetches nothing.
  await completeChain(await buildChain(signer.der, [root.der]), async () => assert.fail('fetched'));
});

test('a fetched certificate whose own signature does not check out is not kept (CA Issuers is plain http)', async () => {
  // The root's name and key, signed with someone else's key: it "issued" the signer, but is a forgery.
  const forged = forge.pki.createCertificate();
  forged.publicKey = root.key.publicKey;
  forged.serialNumber = '01';
  forged.validity.notBefore = root.cert.validity.notBefore;
  forged.validity.notAfter = root.cert.validity.notAfter;
  forged.setSubject(root.cert.subject.attributes);
  forged.setIssuer(root.cert.subject.attributes);
  forged.sign(tsa.key.privateKey, forge.md.sha256.create());
  const forgedDer = binaryToBytes(toDer(forge.pki.certificateToAsn1(forged)));
  const chain = await completeChain(await buildChain(signer.der, []), async () => forgedDer);
  assert.equal(chain.complete, false);
  assert.deepEqual(chain.certs.map((c) => c.subjectName), ['Jane Signer'], 'only the signer’s own certificate is kept');
});

test('a known root ends a chain whose CA publishes no address for it; an unknown one does not', async () => {
  // An intermediate with no CA Issuers address, and the signer it issued pointing at it.
  const intermediate = party('Test Intermediate', '0b', root, [{ name: 'basicConstraints', cA: true }]);
  const leafAia = toDer(seq(seq(oid('1.3.6.1.5.5.7.48.2'), ctx(6, false, 'http://ca.example/int.cer'))));
  const leaf = party('Leaf Signer', '0c', intermediate, [{ id: '1.3.6.1.5.5.7.1.1', value: leafAia }]);
  const known = await completeChain(await buildChain(leaf.der, []), async () => intermediate.der, { anchors: [tsa.der, root.der] });
  assert.equal(known.complete, true);
  assert.deepEqual(known.certs.map((c) => c.subjectName), ['Leaf Signer', 'Test Intermediate', 'Test Root']);
  // Without the root among the known ones, the fetched intermediate is unchecked and is not kept.
  const unknown = await completeChain(await buildChain(leaf.der, []), async () => intermediate.der, { anchors: [tsa.der] });
  assert.equal(unknown.complete, false);
  assert.deepEqual(unknown.certs.map((c) => c.subjectName), ['Leaf Signer']);
});

test('the rest of a card’s certificates fill gaps, and a slow CA is given up on', async () => {
  // The root on the card already: nothing to fetch.
  const fromCard = await completeChain(await buildChain(signer.der, []), async () => assert.fail('fetched'), { pool: [tsa.der, root.der] });
  assert.equal(fromCard.complete, true);
  const t0 = Date.now();
  const slow = await completeChain(await buildChain(signer.der, []), () => new Promise<Uint8Array>(() => {}), { timeoutMs: 50 });
  assert.equal(slow.complete, false);
  assert.ok(Date.now() - t0 < 1000, 'gave up in time');
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

function ocspResponse(request: Uint8Array, revoked: Date | null, signerKey = root.key.privateKey, certs: Party[] = [], produced = new Date(), next?: Date): Uint8Array {
  const certId = (((asn1.fromDer(bytesToBinary(request)).value as Node[])[0]!.value as Node[])[0]!.value as Node[])[0]!.value as Node[];
  const status = revoked ? ctx(1, true, [gtime(revoked)]) : ctx(0, false, '');
  const data = seq(ctx(1, true, [forge.pki.distinguishedNameToAsn1(root.cert.subject)]), gtime(produced), seq(seq(certId[0]!, status, gtime(produced), ...(next ? [ctx(0, true, [gtime(next)])] : []))));
  const basic = seq(data, alg(SHA256_RSA), bits(signerKey.sign(sha256(toDer(data)))), ...(certs.length ? [ctx(0, true, [seq(...certs.map((c) => forge.pki.certificateToAsn1(c.cert)))])] : []));
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

/** A small PDF signed by the signer, carrying only its own certificate (the root comes from CA Issuers). */
async function signedPdf(opts: { timestamp?: boolean; table?: boolean; base?: Uint8Array } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const id = { key: signer.key.privateKey, chain: [signer.cert], chainDer: [signer.der] };
  return signPdf(opts.base ?? (await doc.save({ useObjectStreams: !opts.table })), id, {
    reason: 'Approved',
    // Time stamped unless asked not to: LTV builds on a time stamp.
    ...(opts.timestamp !== false ? { timestamp: (value: Uint8Array) => fetchTimestamp('http://tsa.example/', value, async (_u, body) => tsaResponse(body!, new Date(Date.now() - 60_000))) } : {}),
  });
}

/** The CA: its root at CA Issuers, OCSP answers (good, or revoked), and its CRL. */
function ca(revoked = false, asked: string[] = []) {
  return async (url: string, body?: Uint8Array) => {
    asked.push(url);
    if (url.endsWith('.cer')) return root.der;
    if (url.startsWith('http://ocsp')) return ocspResponse(body!, revoked ? new Date(Date.UTC(2026, 0, 2)) : null);
    return crl([]);
  };
}

test('LTV: the chain and an OCSP answer go in a DSS, appended, and the signature stays valid', async () => {
  const signed = await signedPdf();
  const [before] = await checkSignatures(signed);
  assert.equal(before!.ltv, false);
  assert.equal(before!.chain.complete, false);
  const asked: string[] = [];
  const out = await addValidationData(signed, ca(false, asked));
  assert.equal(out.signatures, 1);
  // Only the time stamp server's, which names no revocation service.
  assert.ok(out.problems.every((p) => p.startsWith('Test TSA')), out.problems.join('; '));
  assert.deepEqual(asked, ['http://ca.example/root.cer', 'http://ocsp.example/']);
  assert.deepEqual(out.bytes.subarray(0, signed.length), signed, 'the signed bytes are kept');
  const [check] = await checkSignatures(out.bytes);
  assert.equal(check!.intact, true, check!.problem ?? '');
  assert.equal(check!.coversWholeFile, false);
  assert.equal(check!.onlyValidationAdded, true);
  assert.equal(check!.ltv, true);
  // The root kept in the DSS completes the chain offline.
  assert.equal(check!.chain.complete, true);
  const doc = await PDFDocument.load(out.bytes);
  const dss = readDss(doc);
  assert.equal(dss.certs.length, 2);
  assert.equal(dss.ocsps.length, 1);
  const vri = doc.catalog.lookup(PDFName.of('DSS'), PDFDict).lookup(PDFName.of('VRI'), PDFDict);
  assert.ok(vri.get(PDFName.of(check!.vri)), 'a VRI entry for the signature');
  // Nothing more to add.
  await assert.rejects(addValidationData(out.bytes, ca()), /No signature needs/);
});

test('LTV: a CRL when OCSP fails; a revoked certificate gets none', async () => {
  const signed = await signedPdf();
  const viaCrl = await addValidationData(signed, async (url, body) => {
    if (url.startsWith('http://ocsp')) throw new Error('offline');
    return ca()(url, body);
  });
  const [check] = await checkSignatures(viaCrl.bytes);
  assert.equal(check!.ltv, true);
  assert.equal(readDss(await PDFDocument.load(viaCrl.bytes)).crls.length, 1);
  await assert.rejects(addValidationData(signed, ca(true)), /Jane Signer’s certificate is revoked/);
  // No root to be had: nothing is added.
  await assert.rejects(addValidationData(signed, async () => tsa.der), /issuer/);
});

test('LTV: a time stamp server without revocation addresses is noted; the signature still gets its data', async () => {
  const out = await addValidationData(await signedPdf({ timestamp: true }), ca());
  assert.equal(out.signatures, 1);
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0]!, /^Test TSA: .*names no OCSP responder/);
  const [check] = await checkSignatures(out.bytes);
  assert.equal(check!.ltv, true);
  assert.equal(check!.timestamp?.verified, true);
});

test('changes after the validation data still show as changes', async () => {
  const { bytes: ltv } = await addValidationData(await signedPdf(), ca());
  for (const change of [(d: PDFDocument) => d.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines')), (d: PDFDocument) => d.getPage(0).setRotation(degrees(90))]) {
    const edit = await openForEdit(ltv);
    change(edit.doc);
    const [check] = await checkSignatures(await edit.save());
    assert.equal(check!.intact, true);
    assert.equal(check!.onlyValidationAdded, false);
  }
  // A DSS added together with other changes is not only validation data either.
  const signed = await signedPdf();
  const edit = await openForEdit(signed);
  edit.doc.getPage(0).setRotation(degrees(90));
  const withDss = await addValidationData(await edit.save(), ca());
  assert.equal((await checkSignatures(withDss.bytes))[0]!.onlyValidationAdded, false);
});

/** `bytes` with an incremental update (a cross-reference table) defining `objects` and freeing `free`; `trailer` names the catalog and info. */
function appendUpdate(bytes: Uint8Array, trailer: string, objects: { n: number; g: number; body: string }[], free: { n: number; g: number }[] = [], extra = '', hidden = ''): Uint8Array {
  const prev = [...new TextDecoder('latin1').decode(bytes).matchAll(/startxref\s+(\d+)/g)].at(-1)![1];
  let s = `\n${hidden}`;
  let xref = 'xref\n';
  for (const o of objects) {
    xref += `${o.n} 1\n${String(bytes.length + s.length).padStart(10, '0')} ${String(o.g).padStart(5, '0')} n \n`;
    s += `${o.n} ${o.g} obj\n${o.body}\nendobj\n`;
  }
  for (const f of free) xref += `${f.n} 1\n0000000000 ${String(f.g).padStart(5, '0')} f \n`;
  const at = bytes.length + s.length;
  s += `${xref}trailer\n<< /Size 1000 ${trailer} /Prev ${prev} ${extra}>>\nstartxref\n${at}\n%%EOF\n`;
  const out = new Uint8Array(bytes.length + s.length);
  out.set(bytes);
  out.set(new TextEncoder().encode(s), bytes.length);
  return out;
}

test('after a signature, only new objects and the catalog may follow, read by the cross-reference', async () => {
  for (const table of [false, true]) {
    const { bytes: ltv } = await addValidationData(await signedPdf({ table }), ca());
    assert.equal((await checkSignatures(ltv))[0]!.onlyValidationAdded, true, `table ${table}`);
    const doc = await PDFDocument.load(ltv);
    const page = doc.getPage(0).ref;
    const info = `/Info ${doc.context.trailerInfo.Info!.toString()}`;
    const root = `/Root ${doc.context.trailerInfo.Root!.toString()} ${info}`;
    const body = doc.context.lookup(page)!.toString();
    const only = async (b: Uint8Array) => (await checkSignatures(b))[0]!.onlyValidationAdded;
    // A new object nothing refers to changes nothing.
    assert.equal(await only(appendUpdate(ltv, root, [{ n: 900, g: 0, body: '<< /Note (x) >>' }])), true, `table ${table}`);
    // Redefining a signed object, even unchanged, or under a new generation, or freeing one, is a change.
    assert.equal(await only(appendUpdate(ltv, root, [{ n: page.objectNumber, g: 0, body }])), false);
    assert.equal(await only(appendUpdate(ltv, root, [{ n: page.objectNumber, g: 1, body }])), false);
    assert.equal(await only(appendUpdate(ltv, root, [], [{ n: page.objectNumber, g: 1 }])), false);
    // Encrypting it scrambles what readers show.
    assert.equal(await only(appendUpdate(ltv, root, [{ n: 900, g: 0, body: '<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>' }], [], '/Encrypt 900 0 R ')), false);
    // Dropping the document information, or another catalog, is not this document.
    assert.equal(await only(appendUpdate(ltv, `/Root ${doc.context.trailerInfo.Root!.toString()}`, [{ n: 900, g: 0, body: '<< >>' }])), false);
    // Another catalog is not this document.
    const signedLength = (await checkSignatures(ltv))[0]!.signedLength;
    assert.equal(await onlyValidationAdded(appendUpdate(ltv, `/Root 900 0 R ${info}`, [{ n: 900, g: 0, body: '<< /Type /Catalog >>' }]), signedLength), false);
  }
});

test('LTV: a later signature gets its own; a broken or self-signed one gets none', async () => {
  const { bytes: first } = await addValidationData(await signedPdf(), ca());
  const out = await addValidationData(await signedPdf({ base: first }), ca(), { newest: true });
  assert.equal(out.signatures, 1);
  const [a, b] = await checkSignatures(out.bytes);
  assert.equal(b!.intact, true);
  assert.equal(b!.ltv, true);
  assert.equal(b!.onlyValidationAdded, true);
  // The first is followed by a signature, which is more than validation data.
  assert.equal(a!.onlyValidationAdded, false);
  assert.equal(readDss(await PDFDocument.load(out.bytes)).vri.size, 2);
  // A tampered signature is not LTV, whatever the DSS holds.
  const broken = out.bytes.slice();
  broken[12] = broken[12]! ^ 1;
  const [x] = await checkSignatures(broken);
  assert.equal(x!.intact, false);
  assert.equal(x!.ltv, false);
  // A self-signed certificate has no authority to ask.
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const own = await signPdf(await doc.save(), { key: root.key.privateKey, chain: [root.cert], chainDer: [root.der] }, {});
  await assert.rejects(addValidationData(own, ca()), /self-signed/);
});

test('an OCSP answer counts only from the issuer or a responder it appointed for OCSP, about this issuer’s certificate', async () => {
  const cert = await certFacts(signer.der);
  const issuer = await certFacts(root.der);
  const req = await ocspRequest(cert, issuer);
  const plain = party('Some Server', '3c', root);
  const responder = party('OCSP Responder', '3d', root, [{ id: '2.5.29.37', value: toDer(seq(oid('1.3.6.1.5.5.7.3.9'))) }]);
  assert.equal((await ocspStatus(ocspResponse(req, null, plain.key.privateKey, [plain]), cert, issuer)).verified, false);
  assert.equal((await ocspStatus(ocspResponse(req, null, responder.key.privateKey, [responder]), cert, issuer)).verified, true);
  // The same serial number from another CA is another certificate.
  const other = party('Other CA', '02', null, [{ name: 'basicConstraints', cA: true }]);
  await assert.rejects(ocspStatus(ocspResponse(req, null), cert, await certFacts(other.der)), /another certificate/);
});

test('after a signature: no unlisted objects, no repeated catalog keys, and the signed catalog is the one its cross-reference names', async () => {
  const { bytes: ltv } = await addValidationData(await signedPdf({ table: true }), ca());
  const signedLength = (await checkSignatures(ltv))[0]!.signedLength;
  const doc = await PDFDocument.load(ltv);
  const rootNumber = (doc.context.trailerInfo.Root as PDFRef).objectNumber;
  const trailer = `/Root ${doc.context.trailerInfo.Root!.toString()} /Info ${doc.context.trailerInfo.Info!.toString()}`;
  const catalog = doc.catalog.toString();
  // An object in the update that its cross-reference does not list (a reader rebuilding the table would find it).
  const page = doc.getPage(0).ref;
  assert.equal(await onlyValidationAdded(appendUpdate(ltv, trailer, [{ n: 900, g: 0, body: '<< >>' }], [], '', `${page.objectNumber} 0 obj\n${doc.context.lookup(page)!.toString()}\nendobj\n`), signedLength), false);
  // The catalog again, as pdf-lib reads it, but naming /Pages twice: readers differ on which wins.
  const twice = catalog.replace('<<', '<<\n/Pages 99 0 R');
  assert.equal(await onlyValidationAdded(appendUpdate(ltv, trailer, [{ n: rootNumber, g: 0, body: twice }]), signedLength), false);
  assert.equal(await onlyValidationAdded(appendUpdate(ltv, trailer, [{ n: rootNumber, g: 0, body: catalog }]), signedLength), true);

  // A signed file with a second catalog after its last section, which pdf-lib (the last one wins)
  // reads but readers, going by the cross-reference, do not: an update making it real is a change.
  const plain = await PDFDocument.create();
  plain.addPage([300, 200]);
  const base = await plain.save({ useObjectStreams: false });
  const loaded = await PDFDocument.load(base);
  const n = (loaded.context.trailerInfo.Root as PDFRef).objectNumber;
  const decoy = loaded.catalog.toString().replace('<<', '<<\n/PageMode /UseOutlines');
  const signed = new Uint8Array([...base, ...new TextEncoder().encode(`${n} 0 obj\n${decoy}\nendobj\n`)]);
  const update = (body: string) => appendUpdate(signed, `/Root ${n} 0 R /Info ${loaded.context.trailerInfo.Info!.toString()}`, [{ n, g: 0, body }]);
  assert.equal(await onlyValidationAdded(update(decoy), signed.length), false);
  // The real one again is no change.
  assert.equal(await onlyValidationAdded(update(loaded.catalog.toString()), signed.length), true);
});

test('LTV: an old answer does not speak for a later signature, wherever it is kept', async () => {
  const signed = await signedPdf();
  const old = new Date(Date.now() - 2 * 365 * 86400_000);
  const stale = async (url: string, body?: Uint8Array) => {
    if (url.startsWith('http://ocsp')) return ocspResponse(body!, null, root.key.privateKey, [], old);
    if (url.endsWith('.crl')) throw new Error('offline');
    return ca()(url, body);
  };
  await assert.rejects(addValidationData(signed, stale), /issued before the signature’s time stamp/);
  // Put in the signature's own VRI entry by hand, it still does not count.
  const req = await ocspRequest(await certFacts(signer.der), await certFacts(root.der));
  const [check] = await checkSignatures(signed);
  const withOld = await addDss(signed, [{ vri: check!.vri, certs: [signer.der, root.der], ocsps: [ocspResponse(req, null, root.key.privateKey, [], old)], crls: [] }]);
  const [after] = await checkSignatures(withOld);
  assert.equal(after!.intact, true);
  assert.equal(after!.onlyValidationAdded, true);
  assert.equal(after!.ltv, false);
});

test('LTV needs a time stamp, and an answer for the signer issued after it', async () => {
  const req = await ocspRequest(await certFacts(signer.der), await certFacts(root.der));
  // Without a time stamp: none added, and a good answer kept by hand does not make it LTV.
  const plain = await signedPdf({ timestamp: false });
  await assert.rejects(addValidationData(plain, ca()), /needs a trusted time stamp/);
  const [p] = await checkSignatures(plain);
  const [pAfter] = await checkSignatures(await addDss(plain, [{ vri: p!.vri, certs: [signer.der, root.der], ocsps: [ocspResponse(req, null)], crls: [] }]));
  assert.equal(pAfter!.ltv, false);

  // Time stamped a minute ago: an answer from an hour before it, current until tomorrow, does not
  // count for the signer (a revocation in between would not show); one issued now does.
  const stamped = await signedPdf();
  const [s] = await checkSignatures(stamped);
  const t = s!.timestamp!.time;
  const earlier = ocspResponse(req, null, root.key.privateKey, [], new Date(t.getTime() - 3600_000), new Date(t.getTime() + 86400_000));
  const kept = async (ocsp: Uint8Array) => (await checkSignatures(await addDss(stamped, [{ vri: s!.vri, certs: [signer.der, root.der], ocsps: [ocsp], crls: [] }])))[0]!;
  assert.equal((await kept(earlier)).ltv, false);
  assert.equal((await kept(ocspResponse(req, null))).ltv, true);
  // A revocation after the time stamp does not count against it; one before it does.
  assert.equal((await kept(ocspResponse(req, new Date()))).ltv, true);
  assert.equal((await kept(ocspResponse(req, new Date(t.getTime() - 3600_000)))).ltv, false);
  // And the answers' next updates are read.
  assert.equal((await ocspStatus(earlier, await certFacts(signer.der), await certFacts(root.der))).nextUpdate!.getTime(), Math.floor((t.getTime() + 86400_000) / 1000) * 1000);
  assert.ok((await crlStatus(crl([]), await certFacts(signer.der), await certFacts(root.der))).nextUpdate);
});

test('the appended bytes are read end to end: odd headers, disguised object streams and filled-in references are changes', async () => {
  const { bytes: ltv } = await addValidationData(await signedPdf({ table: true }), ca());
  const signedLength = (await checkSignatures(ltv))[0]!.signedLength;
  const doc = await PDFDocument.load(ltv);
  const trailer = `/Root ${doc.context.trailerInfo.Root!.toString()} /Info ${doc.context.trailerInfo.Info!.toString()}`;
  const page = doc.getPage(0).ref;
  const body = doc.context.lookup(page)!.toString();
  const only = (b: Uint8Array) => onlyValidationAdded(b, signedLength);
  // Headers a reader (pdf-lib among them) still reads: a comment, or a NUL, between the parts.
  for (const head of [`${page.objectNumber} 0 %x\nobj`, `${page.objectNumber} 0\0obj`]) assert.equal(await only(appendUpdate(ltv, trailer, [{ n: 900, g: 0, body: '<< >>' }], [], '', `${head}\n${body}\nendobj\n`)), false, JSON.stringify(head));
  // An object stream by an escaped name.
  assert.equal(await only(appendUpdate(ltv, trailer, [{ n: 900, g: 0, body: '<< /Type /Obj#53tm /N 0 /First 0 /Length 0 >>\nstream\n\nendstream' }])), false);
  // A trailer nested deep is read in time.
  const t0 = Date.now();
  assert.equal(await only(appendUpdate(ltv, trailer, [{ n: 900, g: 0, body: '<< >>' }], [], `/X ${'<< /A '.repeat(40)}1${' >>'.repeat(40)} `)), true);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);

  // A signed file that refers to an object it does not define: an update defining it fills it in.
  const plain = await PDFDocument.create();
  const p = plain.addPage([300, 200]);
  p.node.set(PDFName.of('Annots'), plain.context.obj([PDFRef.of(950)]));
  const base = await plain.save({ useObjectStreams: false });
  const loaded = await PDFDocument.load(base);
  const t = `/Root ${loaded.context.trailerInfo.Root!.toString()} /Info ${loaded.context.trailerInfo.Info!.toString()}`;
  const annot = '<< /Type /Annot /Subtype /FreeText /Rect [0 0 100 100] /Contents (added) >>';
  assert.equal(await onlyValidationAdded(appendUpdate(base, t, [{ n: 950, g: 0, body: annot }]), base.length), false);
  assert.equal(await onlyValidationAdded(appendUpdate(base, t, [{ n: 951, g: 0, body: annot }]), base.length), true);
});
