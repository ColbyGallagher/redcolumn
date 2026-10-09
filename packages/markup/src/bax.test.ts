import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { baxColumnTag, baxTypeInternal, exportBax, injectBax, parseBax } from './bax.ts';

const text = (s: string) => PDFHexString.fromText(s);

/**
 * A page as Revu writes one: a cloud with a reply, a status change and a pop-up; a Cloud+ (a callout
 * with a polygon cloud grouped under it); a stamp whose appearance is its own stream; two custom
 * columns. Plus a link, which BAX leaves out.
 */
async function revuPage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  doc.catalog.set(PDFName.of('BSIAnnotColumns'), ctx.obj([{ Name: text('Trade'), Subtype: 'Text' }, { Name: text('Old'), Subtype: 'Text', Deleted: true }, { Name: text('Done Yet'), Subtype: 'Checkmark' }]));
  const reg = (o: Record<string, unknown>) => ctx.register(ctx.obj(o as never));
  const cloud = reg({ Type: 'Annot', Subtype: 'Square', NM: text('CLOUDAAAAAAAAAAA'), T: text('Pat'), Subj: text('Cloud'), C: [1, 0, 0], Rect: [10, 10, 100, 100], CreationDate: text('D:20260105165032+11\'00\''), M: text('D:20260105170312+11\'00\''), Contents: text('Check kerb'), BSIColumnData: [text('Civil'), text('gone'), text('True')] });
  const popup = reg({ Type: 'Annot', Subtype: 'Popup', NM: text('POPUPAAAAAAAAAAA'), Parent: cloud, Rect: [100, 100, 200, 160] });
  (ctx.lookup(cloud) as PDFDict).set(PDFName.of('Popup'), popup);
  const reply = reg({ Type: 'Annot', Subtype: 'Text', NM: text('REPLYAAAAAAAAAAA'), IRT: cloud, T: text('Lee'), Contents: text('Done'), Rect: [0, 0, 0, 0] });
  const state = reg({ Type: 'Annot', Subtype: 'Text', NM: text('STATEAAAAAAAAAAA'), IRT: cloud, StateModel: text('Review'), State: text('Accepted'), T: text('Lee'), F: 30, Rect: [0, 0, 0, 0] });
  const callout = reg({ Type: 'Annot', Subtype: 'FreeText', IT: 'FreeTextCallout', NM: text('CALLOUTAAAAAAAAA'), Contents: text('See note'), Rect: [150, 150, 250, 200] });
  const member = reg({ Type: 'Annot', Subtype: 'Polygon', IT: 'PolygonCloud', NM: text('MEMBERAAAAAAAAAA'), IRT: callout, RT: 'Group', Vertices: [120, 120, 140, 120, 140, 140], Rect: [115, 115, 145, 145] });
  const ap = ctx.register(ctx.stream('0 0 1 rg 0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }));
  const stamp = reg({ Type: 'Annot', Subtype: 'Stamp', NM: text('STAMPAAAAAAAAAAA'), Rect: [300, 300, 310, 310], AP: { N: ap } });
  const link = reg({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 5, 5] });
  page.node.set(PDFName.of('Annots'), ctx.obj([cloud, popup, reply, state, callout, member, stamp, link]));
  return doc;
}

test('BAX nests replies, statuses, pop-ups and group members under their markup, as Revu does', async () => {
  const doc = await revuPage();
  const xml = await exportBax(await doc.save(), { pageLabels: ['A-101'] });
  assert.ok(xml.startsWith('﻿<?xml version="1.0" encoding="utf-8"?>\r\n<Document Version="1">'));
  assert.match(xml, /<Label>A-101<\/Label>/);
  assert.doesNotMatch(xml, /Link/, 'links are left out');
  const bax = await parseBax(xml);
  const [page] = bax.pages;
  assert.deepEqual(page!.markups.map((m) => m.id), ['CLOUDAAAAAAAAAAA', 'CALLOUTAAAAAAAAA', 'STAMPAAAAAAAAAAA']);
  const cloud = page!.markups[0]!;
  assert.deepEqual([cloud.replies.map((r) => r.id), cloud.statuses.map((s) => s.id), cloud.popup?.id], [['REPLYAAAAAAAAAAA'], ['STATEAAAAAAAAAAA'], 'POPUPAAAAAAAAAAA']);
  assert.deepEqual(page!.markups[1]!.children.map((c) => c.id), ['MEMBERAAAAAAAAAA']);
  // Column values by name; a deleted column is left out.
  assert.deepEqual(cloud.custom, { Trade: 'Civil', Done_Yet: 'True' });
  // Dictionaries refer to annotations by /NM, to anything else through GlobalResources; no page links.
  const raw = (m: { raw: Uint8Array }) => Buffer.from(m.raw).toString('latin1');
  assert.match(raw(cloud.replies[0]!), /\/IRT\/CLOUDAAAAAAAAAAA/);
  assert.doesNotMatch(raw(cloud), /\/P |\/Popup/);
  const pointer = /\/BBObjPtr_([A-Z]{16})/.exec(raw(page!.markups[2]!));
  assert.ok(pointer && bax.resources.get(pointer[1]!)?.length, 'the stamp’s appearance is a resource');
  assert.match(Buffer.from(bax.resources.get(pointer![1]!)!).toString('latin1'), /stream\r\n0 0 1 rg 0 0 10 10 re f\r\nendstream$/);
  assert.match(xml, /<ModDate>2026-01-05T06:03:12\.0000000Z<\/ModDate>/);
  assert.match(xml, /<Parent>CLOUDAAAAAAAAAAA<\/Parent>\s*<State>Accepted<\/State>/);
});

test('BAX markups go back into a PDF as annotations, linked up again', async () => {
  const source = await revuPage();
  const bax = await parseBax(await exportBax(await source.save()));
  // Into the same page with nothing on it.
  const blank = await PDFDocument.create();
  blank.addPage([400, 400]);
  const inj = await injectBax(await blank.save(), bax);
  // The cloud (its reply, status and pop-up after it), the callout and its group member, the stamp.
  assert.deepEqual(inj.added, { 0: [0, 4, 5, 6] });
  assert.deepEqual(inj.nms[0], { 0: 'CLOUDAAAAAAAAAAA', 4: 'CALLOUTAAAAAAAAA', 5: 'MEMBERAAAAAAAAAA', 6: 'STAMPAAAAAAAAAAA' });
  const out = await PDFDocument.load(inj.bytes);
  const annots = out.getPage(0).node.Annots()!;
  const dicts = annots.asArray().map((r) => out.context.lookup(r, PDFDict));
  const nm = (d: PDFDict) => d.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText();
  const byNm = (n: string) => annots.asArray()[dicts.findIndex((d) => nm(d) === n)] as PDFRef;
  const reply = dicts.find((d) => nm(d) === 'REPLYAAAAAAAAAAA')!;
  assert.equal(reply.get(PDFName.of('IRT')), byNm('CLOUDAAAAAAAAAAA'), 'the reply points at its markup again');
  const cloud = dicts.find((d) => nm(d) === 'CLOUDAAAAAAAAAAA')!;
  assert.equal(cloud.get(PDFName.of('Popup')), byNm('POPUPAAAAAAAAAAA'));
  assert.equal(cloud.has(PDFName.of('BSIColumnData')), false, 'column values come by name instead');
  assert.deepEqual(inj.custom[0]![0], { Trade: 'Civil', Done_Yet: 'True' });
  const stamp = dicts.find((d) => nm(d) === 'STAMPAAAAAAAAAAA')!;
  assert.ok(stamp.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')) instanceof PDFRef, 'its appearance is an object again');
  // Into the PDF they came from: recognised as its own annotations.
  const again = await injectBax(await source.save(), bax);
  assert.deepEqual(Object.values(again.same[0]!).sort((a, b) => a - b), [0, 4, 5, 6]);
});

test('Revu class names and column tags', async () => {
  const doc = await PDFDocument.create();
  const d = (o: Record<string, string>) => doc.context.obj(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, PDFName.of(v)])));
  assert.equal(baxTypeInternal(d({ Subtype: 'Polygon', IT: 'PolygonCount' })), 'Bluebeam.PDF.Annotations.AnnotationMeasureCount');
  assert.equal(baxTypeInternal(d({ Subtype: 'PolyLine', IT: 'PolyLineDimension' })), 'Bluebeam.PDF.Annotations.AnnotationMeasurePerimeter');
  assert.equal(baxTypeInternal(d({ Subtype: 'Stamp' })), 'Bluebeam.PDF.Annotations.AnnotationBRXStamp');
  assert.equal(baxColumnTag('Reference (sec, para)'), 'Reference__sec__para_');
  assert.equal(baxColumnTag('2nd check'), '_2nd_check');
});
