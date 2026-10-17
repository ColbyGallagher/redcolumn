import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import type { CustomColumn } from './columns.ts';

test('custom columns are an indirect array in the catalog, which is the only form Bluebeam reads', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const m: Markup = {
    id: 'c1',
    type: 'rect',
    pageIndex: 0,
    points: [[10, 10], [50, 50]],
    style: { ...DEFAULT_STYLES.rect },
    status: 'none',
    author: 'Tester',
    createdAt: 1,
    modifiedAt: 1,
    fields: { a: 'x' },
  };
  const columns: CustomColumn[] = [{ id: 'a', name: 'Ref', type: 'text' }];
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m], { columns }));
  const entry = out.catalog.get(PDFName.of('BSIAnnotColumns'));
  assert.ok(entry instanceof PDFRef, 'a reference, not the array written into the catalog');
  assert.equal(out.context.lookup(entry, PDFArray).size(), 1);
});
