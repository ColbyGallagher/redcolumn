import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import {
  actionTarget,
  describeAction,
  flattenBookmarks,
  indentBookmark,
  insertBookmark,
  normalizeUrl,
  outdentBookmark,
  remapBookmarks,
  removeBookmark,
  shiftBookmark,
  type Bookmark,
} from './bookmarks.ts';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations } from './import.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';

const bm = (id: string, pageIndex = 0, children: Bookmark[] = []): Bookmark => ({ id, title: id.toUpperCase(), pageIndex, rect: null, children });
const shape = (tree: readonly Bookmark[]) => flattenBookmarks(tree).map(({ bookmark, depth }) => `${'.'.repeat(depth)}${bookmark.id}`).join(' ');

test('bookmarks nest, move and come out of their parents', () => {
  let tree = [bm('a'), bm('b'), bm('c')];
  tree = indentBookmark(tree, 'b');
  assert.equal(shape(tree), 'a .b c');
  tree = indentBookmark(tree, 'c');
  tree = shiftBookmark(tree, 'c', -1);
  assert.equal(shape(tree), 'a .c .b');
  tree = outdentBookmark(tree, 'c');
  assert.equal(shape(tree), 'a .b c', 'an outdented bookmark lands just after its old parent');
  // Indenting the first bookmark at a level does nothing.
  assert.equal(shape(indentBookmark(tree, 'a')), shape(tree));
  tree = insertBookmark(tree, bm('d'), { parentId: 'a', index: 0 });
  assert.equal(shape(tree), 'a .d .b c');
  assert.equal(shape(removeBookmark(tree, 'a')), 'c');
});

test('bookmarks follow page operations; a deleted page takes its bookmark but not the children', () => {
  const tree = [bm('a', 0, [bm('b', 2)]), bm('c', 1)];
  const to = (i: number) => (i === 0 ? null : i === 1 ? 0 : 1);
  const out = remapBookmarks(tree, to, (_, r) => r);
  assert.equal(shape(out), 'b c');
  assert.deepEqual(out.map((b) => b.pageIndex), [1, 0]);
});

test('actions resolve Places by id, and bare web addresses get a scheme', () => {
  const places = [{ id: 'p1', name: 'Grid A', pageIndex: 3, rect: { x: 1, y: 2, w: 3, h: 4 } }];
  assert.deepEqual(actionTarget({ kind: 'place', placeId: 'p1' }, places), { pageIndex: 3, rect: places[0]!.rect });
  assert.equal(actionTarget({ kind: 'place', placeId: 'gone' }, places), null);
  assert.equal(normalizeUrl('example.com/x'), 'https://example.com/x');
  assert.equal(normalizeUrl('a@b.co'), 'mailto:a@b.co');
  assert.equal(normalizeUrl('ftp://x'), 'ftp://x');
});

function link(id: string, link: Markup['link']): Markup {
  return { id, type: 'hyperlink', pageIndex: 0, points: [[10, 10], [60, 30]], style: { ...DEFAULT_STYLES.hyperlink }, link, status: 'none', author: 'me', createdAt: 1, modifiedAt: 1 };
}

test('hyperlinks, Places and bookmarks export as links, named destinations and the outline', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 100]);
  doc.addPage([200, 100]);
  const original = await doc.save();
  const markups = [link('u', { kind: 'url', url: 'https://example.com' }), link('p', { kind: 'page', pageIndex: 1, rect: { x: 0, y: 0, w: 50, h: 20 } }), link('n', { kind: 'place', placeId: 'pl' })];
  const bytes = await exportWithAnnotations(original.buffer as ArrayBuffer, markups, {
    places: [{ id: 'pl', name: 'Detail 1', pageIndex: 1, rect: null }],
    bookmarks: [bm('a', 0, [bm('b', 1)]), bm('c', 1)],
  });
  const out = await PDFDocument.load(bytes);
  const annots = out.getPage(0).node.Annots()!;
  const dicts = annots.asArray().map((r) => out.context.lookup(r, PDFDict));
  assert.ok(dicts.every((d) => d.get(PDFName.of('Subtype')) === PDFName.of('Link')));
  const uri = dicts[0]!.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString);
  assert.equal(uri.decodeText(), 'https://example.com');
  const fitr = dicts[1]!.lookup(PDFName.of('Dest'), PDFArray);
  assert.equal(fitr.get(1), PDFName.of('FitR'));
  assert.equal(fitr.get(0), out.getPage(1).ref);
  // Page space is y-down from the top; user space y-up: the top edge 0 maps to 100.
  assert.equal(fitr.lookup(5, PDFNumber).asNumber(), 100);
  assert.equal(dicts[2]!.get(PDFName.of('Dest')), PDFName.of('Detail 1'));
  const dests = out.catalog.lookup(PDFName.of('Dests'), PDFDict);
  assert.ok(dests.get(PDFName.of('Detail 1')));
  const outlines = out.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  assert.equal(outlines.lookup(PDFName.of('Count'), PDFNumber).asNumber(), 2);
  const first = outlines.lookup(PDFName.of('First'), PDFDict);
  assert.ok(first.get(PDFName.of('Title')));
  assert.ok(first.get(PDFName.of('First')), 'the first bookmark has its child');
  assert.ok(first.get(PDFName.of('Next')));
});

test('a link to a sheet in another file exports as a remote go-to', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 100]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [link('f', { kind: 'file', fileId: 'x', name: 'Structural.pdf', pageIndex: 2, rect: null, label: 'S-201' })]);
  const out = await PDFDocument.load(bytes);
  const a = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict).lookup(PDFName.of('A'), PDFDict);
  assert.equal(a.get(PDFName.of('S')), PDFName.of('GoToR'));
  assert.equal(a.lookup(PDFName.of('F'), PDFString).decodeText(), 'Structural.pdf');
  const d = a.lookup(PDFName.of('D'), PDFArray);
  assert.equal(d.lookup(0, PDFNumber).asNumber(), 2);
  assert.equal(d.get(1), PDFName.of('Fit'));
  assert.equal(describeAction({ kind: 'file', fileId: 'x', name: 'Structural.pdf', pageIndex: 2, rect: null, label: 'S-201' }, [], () => ''), 'S-201 in Structural.pdf');
});

test('web links in a PDF import as hyperlink markups', () => {
  const res = importAnnotations(
    0,
    [
      {
        index: 0,
        subtype: 'Link',
        rect: { x: 5, y: 6, w: 10, h: 4 },
        flags: 0,
        author: 'x',
        link: { targetPage: null, targetRect: null, uri: 'https://example.com', file: null },
      } as Parameters<typeof importAnnotations>[1][number],
    ],
  );
  assert.equal(res.markups.length, 1);
  assert.equal(res.markups[0]!.type, 'hyperlink');
  assert.deepEqual(res.markups[0]!.link, { kind: 'url', url: 'https://example.com' });
  assert.deepEqual(res.imported, [0]);
});

test('page labels are written as the /PageLabels tree', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  doc.addPage([100, 100]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [], { pageLabels: ['A-101', null] });
  const out = await PDFDocument.load(bytes);
  const labels = out.catalog.lookup(PDFName.of('PageLabels'), PDFDict);
  const nums = labels.lookup(PDFName.of('Nums'), PDFArray);
  assert.equal(nums.size(), 4);
  const first = nums.lookup(1, PDFDict);
  assert.ok(first.get(PDFName.of('P')));
  assert.equal(nums.lookup(3, PDFDict).get(PDFName.of('S')), PDFName.of('D'));
});

test('bookmarks with actions export them in the outline', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 100]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [], {
    bookmarks: [
      { id: 'a', title: 'Spec', pageIndex: 0, rect: null, children: [], action: { kind: 'url', url: 'https://example.com/spec' } },
      { id: 'b', title: 'Structure', pageIndex: 0, rect: null, children: [], action: { kind: 'file', fileId: 'x', name: 'Structural.pdf', pageIndex: 1, rect: null } },
    ],
  });
  const out = await PDFDocument.load(bytes);
  const first = out.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookup(PDFName.of('First'), PDFDict);
  assert.equal(first.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText(), 'https://example.com/spec');
  assert.equal(first.get(PDFName.of('Dest')), undefined);
  const second = first.lookup(PDFName.of('Next'), PDFDict).lookup(PDFName.of('A'), PDFDict);
  assert.equal(second.get(PDFName.of('S')), PDFName.of('GoToR'));
});
