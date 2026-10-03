import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { saveIncremental, snapshot } from './incremental.ts';

for (const useObjectStreams of [false, true]) {
  test(`changes are appended, the original bytes kept (${useObjectStreams ? 'cross-reference stream' : 'table'})`, async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 200]);
    src.addPage([300, 300]);
    const original = await src.save({ useObjectStreams });
    const doc = await PDFDocument.load(original);
    const before = snapshot(doc, original);
    doc.setTitle('Changed');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPage(1).drawText('added', { x: 10, y: 10, size: 12, font });
    const out = await saveIncremental(original, doc, before);
    assert.deepEqual(out.subarray(0, original.length), original);
    const tail = new TextDecoder('latin1').decode(out.subarray(original.length));
    assert.match(tail, /startxref\s+\d+\s+%%EOF\s*$/);
    assert.match(tail, useObjectStreams ? /\/Type \/XRef/ : /\bxref\b[\s\S]*trailer/);
    assert.match(tail, /\/Prev \d+/);
    const back = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(back.getTitle(), 'Changed');
    assert.equal(back.getPageCount(), 2);
    // Unchanged objects were not written again: only a handful are in the update.
    assert.ok((tail.match(/ 0 obj/g) ?? []).length < 12);
    // A second update on top of the first.
    const doc2 = await PDFDocument.load(out, { updateMetadata: false });
    const snap2 = snapshot(doc2, out);
    doc2.setSubject('Again');
    const out2 = await saveIncremental(out, doc2, snap2);
    assert.deepEqual(out2.subarray(0, out.length), out);
    const back2 = await PDFDocument.load(out2, { updateMetadata: false });
    assert.equal(back2.getSubject(), 'Again');
    assert.equal(back2.getTitle(), 'Changed');
  });
}

test('new objects never reuse the numbers of object streams or cross-reference streams', async () => {
  const src = await PDFDocument.create();
  src.addPage([200, 200]);
  const original = await src.save({ useObjectStreams: true });
  const text = new TextDecoder('latin1').decode(original);
  // Objects pdf-lib drops after parsing: the object and cross-reference streams.
  const streams = new Set([...text.matchAll(/(\d+) 0 obj\s*<<[^>]*\/Type \/(?:XRef|ObjStm)/g)].map((m) => Number(m[1])));
  assert.ok(streams.size >= 2);
  const doc = await PDFDocument.load(original);
  const before = snapshot(doc, original);
  const ref = doc.context.register(doc.context.obj({ Added: true }));
  doc.catalog.set(PDFName.of('Extra'), ref);
  const out = await saveIncremental(original, doc, before);
  const tail = new TextDecoder('latin1').decode(out.subarray(original.length));
  for (const m of tail.matchAll(/(\d+) 0 obj/g)) assert.ok(!streams.has(Number(m[1])), `object ${m[1]} is one of the original's streams`);
});
