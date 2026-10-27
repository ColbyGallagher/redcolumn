import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { createSelfSignedId, importDigitalId, unlockId, readCertificate, binaryToBytes } from './digitalIds.ts';
import { checkSignatures, signPdf, signedVersion, type Signer } from './pdfSign.ts';
import { saveIncremental, snapshot } from './incremental.ts';
import { createFields } from './forms.ts';

async function sample(useObjectStreams = false) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  return doc.save({ useObjectStreams });
}

// Key generation is the slow part: one ID for the whole file.
const idPromise = createSelfSignedId({ name: 'Jane Engineer', email: 'jane@example.com', org: 'Acme', password: 'pw' });

test('a self-signed Digital ID unlocks only with its password', async () => {
  const id = await idPromise;
  assert.equal(id.name, 'Jane Engineer');
  assert.equal(id.email, 'jane@example.com');
  assert.equal(id.selfSigned, true);
  assert.ok(id.notAfter > Date.now());
  assert.throws(() => unlockId(id, 'wrong'));
  const unlocked = unlockId(id, 'pw');
  const info = await readCertificate(unlocked.chainDer[0]!);
  assert.equal(info.subject.org, 'Acme');
  assert.equal(info.fingerprint, id.fingerprint);
  // Importing the same PKCS#12 gives the same certificate.
  const again = await importDigitalId(binaryToBytes(forge.util.decode64(id.p12)), 'pw');
  assert.equal(again.fingerprint, id.fingerprint);
});

for (const streams of [false, true]) {
  test(`signing appends a valid signature (${streams ? 'cross-reference stream' : 'table'})`, async () => {
    const unlocked = unlockId(await idPromise, 'pw');
    const original = await sample(streams);
    const signed = await signPdf(original, unlocked, { area: { pageIndex: 0, rect: { x: 40, y: 40, w: 180, h: 50 } }, reason: 'Approved', location: 'Sydney' });
    assert.deepEqual(signed.subarray(0, original.length), original, 'the original bytes are kept');
    const [check] = await checkSignatures(signed);
    assert.ok(check, 'one signature');
    assert.equal(check.problem, null);
    assert.equal(check.intact, true);
    assert.equal(check.coversWholeFile, true);
    assert.equal(check.signer, 'Jane Engineer');
    assert.equal(check.reason, 'Approved');
    assert.equal(check.location, 'Sydney');
    assert.equal(check.certificate?.selfSigned, true);
    assert.equal(check.certificate?.validAtSigning, true);
    assert.equal(check.certify, null);
    // pdf-lib still reads it, with the signature field.
    const doc = await PDFDocument.load(signed);
    assert.equal(doc.getForm().getFields().length, 1);
  });
}

for (const digest of ['SHA-384', 'SHA-512'] as const) {
  test(`signing with ${digest} checks out`, async () => {
    const signed = await signPdf(await sample(), unlockId(await idPromise, 'pw'), { digest });
    const [check] = await checkSignatures(signed);
    assert.equal(check?.intact, true);
    assert.equal(check?.problem, null);
  });
}

test('changing a signed byte breaks the signature; appending keeps it but not the whole file', async () => {
  const unlocked = unlockId(await idPromise, 'pw');
  const signed = await signPdf(await sample(), unlocked, {});
  const tampered = signed.slice();
  // A byte inside the first page's objects (not the signature itself).
  tampered[200] = tampered[200] === 0x30 ? 0x31 : 0x30;
  const [bad] = await checkSignatures(tampered);
  assert.equal(bad!.intact, false);
  assert.match(bad!.problem ?? '', /changed after it was signed/);

  const doc = await PDFDocument.load(signed);
  const snap = snapshot(doc, signed);
  doc.setTitle('Changed later');
  const later = await saveIncremental(signed, doc, snap);
  const [after] = await checkSignatures(later);
  assert.equal(after!.intact, true);
  assert.equal(after!.coversWholeFile, false);
  assert.deepEqual(signedVersion(later, after!), signed);
});

test('certifying, signing an existing field, and a second signature', async () => {
  const unlocked = unlockId(await idPromise, 'pw');
  const withField = await createFields(await sample(), [{ type: 'signature', name: 'Engineer', pageIndex: 1, rect: { x: 50, y: 50, w: 150, h: 40 } }]);
  const certified = await signPdf(withField, unlocked, { certify: 2, reason: 'Issued for construction' });
  const first = await signPdf(certified, unlocked, { fieldName: 'Engineer', reason: 'Checked' });
  const checks = await checkSignatures(first);
  assert.equal(checks.length, 2);
  const cert = checks.find((c) => c.certify)!;
  const field = checks.find((c) => c.field === 'Engineer')!;
  assert.equal(cert.certify, 2);
  assert.equal(cert.intact, true);
  assert.equal(cert.coversWholeFile, false, 'the second signature came after it');
  assert.equal(field.intact, true);
  assert.equal(field.coversWholeFile, true);
  await assert.rejects(signPdf(first, unlocked, { fieldName: 'Engineer' }), /already signed/);
});

test('filling in a signed form appends, so the signature stays valid', async () => {
  const { fillForm } = await import('./forms.ts');
  const unlocked = unlockId(await idPromise, 'pw');
  const form = await createFields(await sample(), [{ type: 'text', name: 'Comments', pageIndex: 0, rect: { x: 40, y: 40, w: 200, h: 20 } }]);
  const signed = await signPdf(form, unlocked, { certify: 2 });
  const { bytes } = await fillForm(signed, { Comments: 'Looks good' });
  assert.deepEqual(bytes.subarray(0, signed.length), signed);
  const [check] = await checkSignatures(bytes);
  assert.equal(check!.intact, true);
  assert.equal(check!.coversWholeFile, false);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getForm().getTextField('Comments').getText(), 'Looks good');
});

test('headers, a text layer, properties, crops and flattening append to a signed file', async () => {
  const { addHeaderFooter } = await import('./headerFooter.ts');
  const { addTextLayer } = await import('./ocr.ts');
  const { setDocumentInfo } = await import('./docInfo.ts');
  const { cropPages } = await import('./pageTools.ts');
  const { flattenAnnotations } = await import('./process.ts');
  const unlocked = unlockId(await idPromise, 'pw');
  const signed = await signPdf(await sample(), unlocked, { area: { pageIndex: 0, rect: { x: 40, y: 40, w: 180, h: 50 } } });
  const spec = { text: { footerCenter: 'Page <<page>>' }, fontSize: 9, color: '#000000', font: 'Helvetica', margin: { top: 20, bottom: 20, left: 20, right: 20 }, bates: { start: 1, digits: 6, prefix: '', suffix: '' }, startPage: 1 } as const;
  const edits: [string, () => Promise<Uint8Array>][] = [
    ['header and footer', () => addHeaderFooter(signed, [0, 1], spec, () => ({ label: '', file: 'f.pdf', date: 'today' }))],
    ['text layer', () => addTextLayer(signed, new Map([[1, [{ text: 'Hello', x0: 50, y0: 50, x1: 90, y1: 60 }]]]))],
    ['properties', async () => new Uint8Array(await setDocumentInfo(signed.slice().buffer, { title: 'Later', author: '', subject: '', keywords: '' }))],
    ['crop', async () => (await cropPages(signed, new Map([[1, { x: 10, y: 10, w: 300, h: 200 }]]))).bytes],
    ['flatten', async () => (await flattenAnnotations(signed, null)).bytes],
  ];
  for (const [what, edit] of edits) {
    const bytes = await edit();
    assert.deepEqual(bytes.subarray(0, signed.length), signed, `${what}: the signed bytes are kept`);
    const [check] = await checkSignatures(bytes);
    assert.equal(check!.intact, true, `${what}: the signature is intact`);
  }
});

test('an unsigned file is written again rather than appended to', async () => {
  const { setDocumentInfo } = await import('./docInfo.ts');
  const original = await sample();
  const bytes = new Uint8Array(await setDocumentInfo(original.slice().buffer, { title: 'New', author: '', subject: '', keywords: '' }));
  assert.notDeepEqual(bytes.subarray(0, original.length), original);
  assert.equal((await PDFDocument.load(bytes)).getTitle(), 'New');
});

// --- Keys this app never holds (smart cards, USB tokens) --------------------------------------------

const subtle = globalThis.crypto.subtle;
const asn1 = forge.asn1;
type Node = forge.asn1.Asn1;
const node = (tag: number, constructed: boolean, value: Node[] | string) => asn1.create(asn1.Class.UNIVERSAL, tag, constructed, value);
const seq = (...v: Node[]) => node(asn1.Type.SEQUENCE, true, v);
const oidNode = (o: string) => node(asn1.Type.OID, false, asn1.oidToDer(o).getBytes());
const toBin = (b: Uint8Array) => String.fromCharCode(...b);
const derOf = (n: Node) => binaryToBytes(asn1.toDer(n).getBytes());
/** An unsigned big-endian integer, as a DER INTEGER. */
const uint = (b: Uint8Array) => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  return node(asn1.Type.INTEGER, false, toBin(v[0]! & 0x80 ? new Uint8Array([0, ...v]) : v));
};
/** WebCrypto's ECDSA r‖s as the DER SEQUENCE a CMS carries (what a PKCS #11 token returns raw, too). */
const ecdsaDer = (raw: Uint8Array) => derOf(seq(uint(raw.subarray(0, raw.length / 2)), uint(raw.subarray(raw.length / 2))));

/** A self-signed P-256 certificate whose private key is non-extractable, like a token's. */
async function ecToken(): Promise<Signer> {
  const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const spki = new Uint8Array(await subtle.exportKey('spki', keys.publicKey));
  const ecdsaSha256 = seq(oidNode('1.2.840.10045.4.3.2'));
  const name = node(asn1.Type.SEQUENCE, true, [node(asn1.Type.SET, true, [seq(oidNode('2.5.4.3'), node(asn1.Type.UTF8, false, 'Token Signer'))])]);
  const now = Date.now();
  const tbs = seq(
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [node(asn1.Type.INTEGER, false, asn1.integerToDer(2).getBytes())]),
    uint(new Uint8Array([0x2a])),
    ecdsaSha256,
    name,
    seq(node(asn1.Type.UTCTIME, false, asn1.dateToUtcTime(new Date(now - 86_400_000))), node(asn1.Type.UTCTIME, false, asn1.dateToUtcTime(new Date(now + 86_400_000)))),
    name,
    asn1.fromDer(toBin(spki)),
  );
  const sig = ecdsaDer(new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, derOf(tbs) as BufferSource)));
  const cert = derOf(seq(tbs, ecdsaSha256, node(asn1.Type.BITSTRING, false, '\x00' + toBin(sig))));
  return {
    chainDer: [cert],
    sign: async (data, hash) => ecdsaDer(new Uint8Array(await subtle.sign({ name: 'ECDSA', hash }, keys.privateKey, data as BufferSource))),
  };
}

test('a key held outside the app signs through a Signer (RSA in WebCrypto, never exported)', async () => {
  const unlocked = unlockId(await idPromise, 'pw');
  const pkcs8 = derOf(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(unlocked.key)));
  const key = await subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const seen: string[] = [];
  const token: Signer = {
    chainDer: unlocked.chainDer,
    sign: async (data, hash) => {
      seen.push(hash);
      return new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', key, data as BufferSource));
    },
  };
  const signed = await signPdf(await sample(), token, { area: { pageIndex: 0, rect: { x: 40, y: 40, w: 180, h: 50 } }, reason: 'Approved' });
  assert.deepEqual(seen, ['SHA-256'], 'signed once, over the signed attributes');
  const [check] = await checkSignatures(signed);
  assert.equal(check?.problem, null);
  assert.equal(check?.intact, true);
  assert.equal(check?.signer, 'Jane Engineer');
  assert.equal(check?.certificate?.fingerprint, (await idPromise).fingerprint);
});

for (const digest of ['SHA-256', 'SHA-384'] as const) {
  test(`an ECDSA P-256 token key signs with ${digest} and checks out`, async () => {
    const signed = await signPdf(await sample(), await ecToken(), { digest, reason: 'Checked' });
    const [check] = await checkSignatures(signed);
    assert.equal(check?.problem, null);
    assert.equal(check?.intact, true);
    assert.equal(check?.signer, 'Token Signer');
    assert.equal(check?.certificate?.selfSigned, true);
  });
}

test('a Signer that fails leaves no signed file', async () => {
  const failing: Signer = { chainDer: unlockId(await idPromise, 'pw').chainDer, sign: async () => { throw new Error('The card was removed'); } };
  await assert.rejects(signPdf(await sample(), failing, {}), /card was removed/);
});

test('a Signer whose signature does not match its certificate is refused before anything is written', async () => {
  const token = await ecToken();
  const wrong: Signer = { chainDer: token.chainDer, sign: (data, hash) => token.sign(new Uint8Array([...data, 0]), hash) };
  await assert.rejects(signPdf(await sample(), wrong, {}), /does not match the certificate/);
  await assert.rejects(signPdf(await sample(), { chainDer: [], sign: token.sign }, {}), /no certificate/);
});
