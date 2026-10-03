import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { ALL_ALLOWED, checkPassword, decryptBytes, encryptPdf, fileKeyFor, permissionBits, permissionsFromBits, readSecurity } from './security.ts';

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText('Top secret drawing', { x: 20, y: 100, size: 14, font });
  doc.setTitle('Level 3 plan');
  return doc.save();
}

test('permission bits follow the specification', () => {
  assert.equal(permissionBits(ALL_ALLOWED), -4);
  const none = permissionBits({ print: 'none', modify: false, copy: false, annotate: false, fillForms: false, assemble: false, accessibility: false });
  assert.equal(none, 0xfffff0c0 | 0);
  const printLow = permissionsFromBits(permissionBits({ ...ALL_ALLOWED, print: 'low', copy: false }));
  assert.equal(printLow.print, 'low');
  assert.equal(printLow.copy, false);
  assert.equal(printLow.modify, true);
});

test('an encrypted copy opens with either password, and only with them', async () => {
  const bytes = await encryptPdf(await sample(), { openPassword: 'open sesame', permissionsPassword: 'boss', permissions: { ...ALL_ALLOWED, copy: false } });
  const info = await readSecurity(bytes);
  assert.equal(info.encrypted, true);
  assert.equal(info.revision, 6);
  assert.equal(info.permissions?.copy, false);
  assert.equal(await checkPassword(bytes, 'open sesame'), 'open');
  assert.equal(await checkPassword(bytes, 'boss'), 'permissions');
  assert.equal(await checkPassword(bytes, 'open'), null);
  assert.equal(await fileKeyFor(bytes, 'wrong'), null);
  assert.equal((await readSecurity(await sample())).encrypted, false);
});

test('streams and strings are encrypted and decrypt back', async () => {
  const plain = await sample();
  const bytes = await encryptPdf(plain, { openPassword: 'pw', permissionsPassword: '', permissions: ALL_ALLOWED });
  // Nothing readable is left in the file.
  const text = new TextDecoder('latin1').decode(bytes);
  assert.doesNotMatch(text, /Level 3 plan/);
  const key = (await fileKeyFor(bytes, 'pw'))!;
  assert.equal(key.length, 32);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  // The page's content stream decrypts to what it was.
  const c = doc.getPage(0).node.lookup(PDFName.of('Contents'));
  const contents = (c instanceof PDFArray ? c.lookup(0) : c) as PDFRawStream;
  const decrypted = await decryptBytes(key, contents.getContents());
  const inflated = new TextDecoder().decode(decodePDFRawStream(PDFRawStream.of(contents.dict, decrypted)).decode());
  assert.match(inflated, /Tj/);
  // The title (an /Info string) too.
  const info = doc.context.lookup(doc.context.trailerInfo.Info!) as unknown as { get(k: PDFName): PDFHexString };
  const title = await decryptBytes(key, info.get(PDFName.of('Title')).asBytes());
  assert.equal(PDFHexString.of([...title].map((b) => b.toString(16).padStart(2, '0')).join('')).decodeText(), 'Level 3 plan');
});
