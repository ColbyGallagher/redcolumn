import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import type { Markup } from './model.ts';

function annot(partial: Partial<ImportableAnnotation>): ImportableAnnotation {
  return {
    index: 0,
    subtype: 'Square',
    rect: { x: 100, y: 100, w: 50, h: 20 },
    color: '#ff0000',
    interior: null,
    opacity: 1,
    borderWidth: 2,
    contents: '',
    author: 'Jane',
    intent: '',
    cloudy: false,
    da: '',
    appData: '',
    flags: 4,
    vertices: [],
    ink: [],
    line: null,
    link: null,
    ...partial,
  };
}

test('foreign markups map to editable markup types', () => {
  const { markups, imported } = importAnnotations(2, [
    annot({ index: 0, subtype: 'Square', contents: 'check this' }),
    annot({ index: 1, subtype: 'Polygon', cloudy: true, vertices: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
    annot({ index: 2, subtype: 'Line', intent: 'LineDimension', line: [[0, 0], [100, 0]] }),
    annot({ index: 3, subtype: 'Ink', opacity: 0.4, borderWidth: 12, ink: [[[0, 0], [10, 0]], [[0, 5], [10, 5]]] }),
    annot({ index: 4, subtype: 'FreeText', contents: 'Verify', da: '/Helv 9 Tf 0 0 1 rg' }),
    annot({ index: 5, subtype: 'Stamp' }),
    annot({ index: 6, subtype: 'Square', flags: 2 }),
  ]);
  assert.deepEqual(
    markups.map((m) => [m.type, m.pageIndex, m.author]),
    [
      ['rect', 2, 'Jane'],
      ['cloud', 2, 'Jane'],
      ['length', 2, 'Jane'],
      ['highlighter', 2, 'Jane'],
      ['highlighter', 2, 'Jane'],
      ['text', 2, 'Jane'],
    ],
  );
  // Rect points exclude the border; comment and text come from /Contents; font size from /DA.
  assert.deepEqual(markups[0]!.points, [[101, 101], [149, 119]]);
  assert.equal(markups[0]!.comment, 'check this');
  assert.equal(markups[5]!.text, 'Verify');
  assert.equal(markups[5]!.style.fontSize, 9);
  // Stamps and hidden annotations stay with PDFium.
  assert.deepEqual(imported, [0, 1, 2, 3, 4]);
});

test("this app's exported markups come back exactly", () => {
  const original: Markup = {
    id: 'abc',
    type: 'arrow',
    pageIndex: 0,
    points: [[1, 2], [3, 4]],
    style: { stroke: '#123456', fill: null, width: 1.5, opacity: 0.9 },
    comment: 'hi',
    status: 'accepted',
    author: 'Sam',
    createdAt: 1,
    modifiedAt: 2,
  };
  const { markups } = importAnnotations(3, [annot({ subtype: 'Line', appData: JSON.stringify(original) })]);
  const { pdfAnnot, ...back } = markups[0]!;
  assert.deepEqual([back], [{ ...original, pageIndex: 3 }]);
  // Linked to its annotation, so an unchanged markup leaves it untouched on save.
  assert.deepEqual(pdfAnnot && { index: pdfAnnot.index, id: pdfAnnot.id, status: pdfAnnot.status }, { index: 0, id: 'abc', status: 'accepted' });
});

test('links with page destinations become accepted-quality links', () => {
  const { links, markups, imported } = importAnnotations(0, [
    annot({ index: 7, subtype: 'Link', link: { targetPage: 4, targetRect: null, uri: null, file: null } }),
    annot({ index: 8, subtype: 'Link', link: { targetPage: null, targetRect: null, uri: 'https://example.com', file: null } }),
    // Link to a sheet published as its own file, resolved to the page with that sheet number.
    annot({ index: 9, subtype: 'Link', link: { targetPage: null, targetRect: null, uri: null, file: 'dwgs\\C-DRG-100051.pdf' } }),
    annot({ index: 10, subtype: 'Link', link: { targetPage: null, targetRect: null, uri: null, file: 'OTHER-SET-001.pdf' } }),
  ], (name) => (name === 'C-DRG-100051' ? 12 : null));
  assert.deepEqual(
    links.map((l) => [l.id, l.targetPage, l.kind, l.label]),
    [
      ['pdf-0-7', 4, 'sheet', 'PDF link'],
      ['pdf-0-9', 12, 'sheet', 'C-DRG-100051'],
    ],
  );
  // The web link becomes a hyperlink markup.
  assert.deepEqual(markups.map((m) => [m.type, m.link]), [['hyperlink', { kind: 'url', url: 'https://example.com' }]]);
  assert.deepEqual(imported, [7, 8, 9]);
});
