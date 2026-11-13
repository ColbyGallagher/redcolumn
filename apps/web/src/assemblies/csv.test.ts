import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listCost } from '@nb/markup';
import { parseCsv, productListFromCsv } from './csv';

test('CSV rows: quotes, doubled quotes, CRLF and blank lines', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2'), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
    ['1', '2'],
  ]);
});

test('a product list from CSV: the header row becomes the columns, number columns are numbers', () => {
  const list = productListFromCsv('Supplier', '﻿Name,Unit Cost,SKU\n"Board, 1/2""",$12.50,GB-1\nStud,"1,200",\n');
  assert.deepEqual(list.columns, [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'unit_cost', label: 'Unit Cost', type: 'number' },
    { key: 'sku', label: 'SKU', type: 'text' },
  ]);
  assert.deepEqual(list.records.map((r) => r.values), [
    { name: 'Board, 1/2"', unit_cost: 12.5, sku: 'GB-1' },
    { name: 'Stud', unit_cost: 1200, sku: '' },
  ]);
  // An item linked to a record takes its cost from the "Unit Cost" column.
  const item = { id: 'i', name: 'Board', category: 'material' as const, unit: 'ea', listRef: { listId: list.id, recordId: list.records[0]!.id } };
  assert.deepEqual(listCost(item, [list]), { unitCost: 12.5 });
  assert.throws(() => productListFromCsv('x', ''), /empty/);
});
