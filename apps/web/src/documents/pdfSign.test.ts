import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { createSelfSignedId, importDigitalId, unlockId, readCertificate, binaryToBytes } from './digitalIds.ts';
import { checkSignatures, signPdf, signedVersion } from './pdfSign.ts';
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
