import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { assembliesToJson, sanitizeAssemblies, type Assembly } from './assemblies.ts';
import {
  estimatingFromJson,
  estimatingToJson,
  listCost,
  mergeById,
  referencedRecords,
  resolveAssemblies,
  resolveAssemblyItem,
  sanitizeItems,
  sanitizeProductLists,
  sanitizeTemplates,
  type Item,
  type ProductList,
  type TakeoffTemplate,
} from './estimating.ts';
import { exportWithAnnotations } from './export.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { MarkupStore } from './store.ts';

const board: Item = { id: 'i1', name: 'Gypsum board', category: 'material', unit: 'sheets', unitCost: 14, waste: 10, roundUp: true, sku: 'GB-12' };
const supplier: ProductList = {
  id: 'l1',
  name: 'Supplier',
  columns: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'cost', label: 'Unit Cost', type: 'number' },
    { key: 'sell', label: 'Sell', type: 'number' },
  ],
  records: [{ id: 'r1', values: { name: '1/2" board', cost: 11.5, sell: 18 } }],
};
const tpl: TakeoffTemplate = { id: 't1', name: 'Partition', tool: 'polylength', preset: { subject: 'Partition', layer: 'Walls', depth: 2.7 }, assemblyId: 'a1', inputs: { Layers: 2 } };

test('sanitize keeps items, lists and templates and drops what is not one', () => {
  const items = sanitizeItems([board, { name: '' }, { name: 'Labour', category: 'nope', unit: 'hr', unitCost: '5', listRef: { listId: 1 } }, { ...board }]);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], board);
  assert.deepEqual(items[1], { id: items[1]!.id, name: 'Labour', category: 'material', unit: 'hr' });
  assert.notEqual(items[2]!.id, 'i1');
  const lists = sanitizeProductLists([supplier, { name: 'X', columns: [{ key: 'a', type: 'number' }, { key: 'a' }], records: [{ values: { a: '$1,200' } }, 'z'] }]);
  assert.deepEqual(lists[0], supplier);
  assert.deepEqual(lists[1]!.columns, [{ key: 'a', label: 'a', type: 'number' }]);
  assert.equal(lists[1]!.records[0]!.values.a, 1200);
  const templates = sanitizeTemplates([tpl, { name: 'bad', tool: '<script>' }, { name: 'x', tool: 'area', preset: { depth: -1, style: { evil: 1 } }, inputs: { A: 'no' } }]);
  assert.deepEqual(templates[0], tpl);
  assert.equal(templates.length, 2);
  assert.deepEqual(templates[1]!.preset, {});
  assert.equal(templates[1]!.inputs, undefined);
});

test('mergeById replaces by id, then by name keeping the id, and adds the rest', () => {
  assert.deepEqual(mergeById([board], [{ ...board, unitCost: 15 }]), [{ ...board, unitCost: 15 }]);
  assert.deepEqual(mergeById([board], [{ ...board, id: 'other' }]), [board]);
  assert.equal(mergeById([board], [{ ...board, id: 'x', name: 'Studs' }]).length, 2);
});

test('a linked item takes its cost and price from the list record', () => {
  const linked: Item = { ...board, listRef: { listId: 'l1', recordId: 'r1' } };
  // "Unit Cost" is found by name; "Sell" only when the list names it the price column.
  assert.deepEqual(listCost(linked, [supplier]), { unitCost: 11.5 });
  assert.deepEqual(listCost(linked, [{ ...supplier, priceColumn: 'sell' }]), { unitCost: 11.5, unitPrice: 18 });
  // A missing record falls back to the item's own cost.
  assert.deepEqual(listCost({ ...linked, listRef: { listId: 'l1', recordId: 'gone' } }, [supplier]), { unitCost: 14 });
});

test('an assembly item takes its linked item as defaults, and its own fields win', () => {
  const ai = { id: 'x', itemId: 'i1', name: '', unit: '', formula: '[Area] / 32' };
  assert.deepEqual(resolveAssemblyItem(ai, [board], []), { ...ai, name: 'Gypsum board', unit: 'sheets', waste: 10, unitCost: 14, roundUp: true });
  const own = { ...ai, name: 'Board, ceilings', waste: 5, unitCost: 20, roundUp: false };
  assert.deepEqual(resolveAssemblyItem(own, [board], []), { id: 'x', itemId: 'i1', name: 'Board, ceilings', unit: 'sheets', formula: '[Area] / 32', waste: 5, unitCost: 20 });
  // Through the product list.
  const linked = { ...board, listRef: { listId: 'l1', recordId: 'r1' } };
  assert.equal(resolveAssemblyItem(ai, [linked], [supplier]).unitCost, 11.5);
  // Nothing linked: the same array back.
  const plain: Assembly[] = [{ id: 'a', name: 'A', variables: [], items: [{ id: 'y', name: 'Y', unit: 'ea', formula: '1' }] }];
  assert.equal(resolveAssemblies(plain, [board], []), plain);
});

test('assemblies keep item links, unnamed linked items and Yes/No variables', () => {
  const [a] = sanitizeAssemblies([
    {
      name: 'Wall',
      variables: [
        { name: 'Insulated', value: 5, type: 'boolean' },
        { name: 'Height', value: 2.7, type: 'number', unit: 'm' },
      ],
      items: [{ name: '', itemId: 'i1', formula: '1', roundUp: false }, { name: '', formula: '1' }],
    },
  ]);
  assert.deepEqual(a!.variables, [
    { name: 'Insulated', value: 1, type: 'boolean' },
    { name: 'Height', value: 2.7, type: 'number', unit: 'm' },
  ]);
  assert.deepEqual(a!.items.map((i) => [i.itemId, i.roundUp]), [['i1', false]]);
});

const wall: Assembly = { id: 'a1', name: 'Wall', variables: [], items: [{ id: 'x', itemId: 'i1', name: '', unit: '', formula: '[Length]' }] };

test('estimating files round trip, and old assemblies files still import', () => {
  const file = { assemblies: [wall], items: [board], productLists: [supplier], templates: [tpl] };
  assert.deepEqual(estimatingFromJson(estimatingToJson(file)), file);
  assert.deepEqual(estimatingFromJson(assembliesToJson([wall])), { assemblies: [wall], items: [], productLists: [], templates: [] });
  assert.deepEqual(estimatingFromJson(JSON.stringify([wall])).assemblies, [wall]);
  assert.throws(() => estimatingFromJson('<xml/>'), /not JSON/);
  assert.throws(() => estimatingFromJson('{"a":1}'), /no assemblies/);
});

test('referencedRecords copies an assembly with the items and lists it uses', () => {
  const linked = { ...board, listRef: { listId: 'l1', recordId: 'r1' } };
  const from = { assemblies: [wall, { ...wall, id: 'a2', name: 'Other', items: [] }], items: [linked, { ...board, id: 'i2', name: 'Other' }], productLists: [supplier], templates: [] };
  assert.deepEqual(referencedRecords(from, ['a1']), { assemblies: [wall], items: [linked], productLists: [supplier] });
});

test('/NBEstimating is saved in the PDF and read back', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
  const est = { items: [board], productLists: [supplier], templates: [tpl] };
  const saved = await exportWithAnnotations(bytes, [], { estimating: est });
  assert.deepEqual((await readPdfExtras(saved))!.estimating, est);
  const kept = await exportWithAnnotations(saved.slice().buffer as ArrayBuffer, [], {});
  assert.deepEqual((await readPdfExtras(kept))!.estimating, est);
  const cleared = await exportWithAnnotations(saved.slice().buffer as ArrayBuffer, [], { estimating: { items: [], productLists: [], templates: [] } });
  assert.equal((await readPdfExtras(cleared))!.estimating, undefined);
});

test('the store keeps items, lists and templates, resolves assemblies, merges imports and undoes', async () => {
  const store = await MarkupStore.open('estimating', { persist: false });
  assert.deepEqual(store.estimating(), { items: [], productLists: [], templates: [] });
  store.setAssemblies([wall]);
  store.setEstimating({ items: [board] });
  assert.deepEqual(store.estimating().items, [board]);
  assert.equal(store.resolvedAssemblies()[0]!.items[0]!.name, 'Gypsum board');
  store.importAnnotations([], [], {}, { estimating: { templates: [tpl], items: [{ ...board, id: 'z', unitCost: 99 }] } });
  assert.equal(store.estimating().templates.length, 1);
  // Same name: replaces the existing item, keeping its id.
  assert.deepEqual(store.estimating().items, [{ ...board, unitCost: 99 }]);
  store.setEstimating({ items: [] });
  assert.equal(store.resolvedAssemblies()[0]!.items[0]!.name, '');
  store.undoManager.undo();
  assert.equal(store.estimating().items.length, 1);
  await store.destroy();
});
