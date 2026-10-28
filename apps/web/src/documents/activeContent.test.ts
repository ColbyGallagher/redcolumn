import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { activeContentWarning, describeActiveContent, findActiveContent } from './activeContent.ts';

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  return doc;
}

test('a plain PDF has no active content', async () => {
  const doc = await blank();
  const found = findActiveContent(doc);
  assert.deepEqual(found, { onOpen: false, documentLevel: false, javascript: 0, launch: 0 });
  assert.equal(describeActiveContent(found), null);
  assert.equal(await activeContentWarning(await doc.save()), null);
  // An open action that only goes to a page is not active content.
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj([doc.getPage(0).ref, PDFName.of('Fit')]));
  assert.equal(await activeContentWarning(await doc.save()), null);
});

test('JavaScript on opening, document-level scripts, page events and Launch actions are found', async () => {
  const doc = await blank();
  const ctx = doc.context;
  const js = (code: string) => ctx.obj({ S: 'JavaScript', JS: PDFHexString.fromText(code) });
  // Opening: a harmless action whose /Next runs a script.
  doc.catalog.set(PDFName.of('OpenAction'), ctx.obj({ S: 'GoTo', D: [doc.getPage(0).ref, 'Fit'], Next: ctx.register(js('app.alert(1)')) }));
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFHexString.fromText('init'), ctx.register(js('var x = 1'))] }) }));
  doc.getPage(0).node.set(PDFName.of('AA'), ctx.obj({ O: js('this.print()') }));
  doc.getPage(0).node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'Launch', F: 'calc.exe' } }))]));
  const found = findActiveContent(await PDFDocument.load(await doc.save()));
  assert.equal(found.onOpen, true);
  assert.equal(found.documentLevel, true);
  assert.equal(found.javascript, 3);
  assert.equal(found.launch, 1);
  const warning = await activeContentWarning(await doc.save());
  assert.match(warning!, /runs a script or program when it opens, has document-level JavaScript, has 3 JavaScript actions, has 1 action that opens a file or program/);
  assert.match(warning!, /may not be what was signed/);
});

test('a script run by the catalog’s additional actions counts as on opening; unreadable bytes warn of nothing', async () => {
  const doc = await blank();
  doc.catalog.set(PDFName.of('AA'), doc.context.obj({ WC: { S: 'JavaScript', JS: PDFHexString.fromText('1') } }));
  assert.equal(findActiveContent(doc).onOpen, true);
  assert.equal(await activeContentWarning(new Uint8Array([1, 2, 3])), null);
});
