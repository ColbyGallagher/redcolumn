import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { assembliesFromJson, assembliesToJson, mergeAssemblies, sanitizeAssemblies, type Assembly } from './assemblies.ts';
import { exportWithAnnotations } from './export.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { MarkupStore } from './store.ts';

const wall: Assembly = {
  id: 'a1',
  name: 'Wall',
  variables: [{ name: 'Spacing', value: 1.333 }],
  items: [{ id: 'i1', name: 'Studs', unit: 'ea', formula: '[Length] / [Spacing] + 1', waste: 10, roundUp: true, unitCost: 4.5 }],
};

test('sanitize keeps assemblies and drops what is not one', () => {
  const out = sanitizeAssemblies([wall, null, { name: '' }, { name: 'X', items: [{ name: 'Y', formula: 1 }, 'z'], variables: [{ name: 'V', value: 'no' }] }, { ...wall }]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], wall);
  assert.deepEqual(
    out[1]!.items.map((i) => [i.name, i.formula]),
    [['Y', '']],
  );
  assert.deepEqual(out[1]!.variables, []);
  // A repeated id is given a new one, so measurements point at one assembly only.
  assert.notEqual(out[2]!.id, 'a1');
  assert.deepEqual(sanitizeAssemblies('nope'), []);
});

test('a round-up multiple survives, and only where the item rounds up', () => {
  const item = (x: object) => sanitizeAssemblies([{ name: 'A', items: [{ name: 'P', ...x }] }])[0]!.items[0]!;
  assert.equal(item({ roundUp: true, roundTo: 10 }).roundTo, 10);
  assert.equal(item({ roundUp: true, roundTo: 0.5 }).roundTo, 0.5);
  for (const bad of [{ roundTo: 10 }, { roundUp: true, roundTo: 0 }, { roundUp: true, roundTo: -5 }, { roundUp: true, roundTo: 1 }, { roundUp: true, roundTo: '10' }]) {
    assert.equal('roundTo' in item(bad), false, JSON.stringify(bad));
  }
});

test('JSON files round trip, and other files are refused with a reason', () => {
  assert.deepEqual(assembliesFromJson(assembliesToJson([wall])), [wall]);
  assert.throws(() => assembliesFromJson('<xml/>'), /not JSON/);
  assert.throws(() => assembliesFromJson('{"a":1}'), /list of assemblies/);
});

test('merge replaces by id, then by name (keeping the id), and adds the rest', () => {
  const renamed = { ...wall, items: [] };
  assert.deepEqual(mergeAssemblies([wall], [renamed]), [renamed]);
  const sameName = { ...wall, id: 'other', variables: [] };
  assert.deepEqual(mergeAssemblies([wall], [sameName]), [{ ...sameName, id: 'a1' }]);
  assert.equal(mergeAssemblies([wall], [{ ...wall, id: 'b', name: 'Slab' }]).length, 2);
});

test('assemblies are saved in the PDF and read back', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
  const saved = await exportWithAnnotations(bytes, [], { assemblies: [wall] });
  assert.deepEqual((await readPdfExtras(saved))!.assemblies, [wall]);
  // Saving without saying keeps the file's own; saving with none takes them out.
  const kept = await exportWithAnnotations(saved.slice().buffer as ArrayBuffer, [], {});
  assert.deepEqual((await readPdfExtras(kept))!.assemblies, [wall]);
  const cleared = await exportWithAnnotations(saved.slice().buffer as ArrayBuffer, [], { assemblies: [] });
  assert.equal((await readPdfExtras(cleared))!.assemblies, undefined);
});

test('the store keeps assemblies, merges imported ones and undoes changes', async () => {
  const store = await MarkupStore.open('assemblies', { persist: false });
  assert.deepEqual(store.assemblies(), []);
  store.setAssemblies([wall]);
  assert.deepEqual(store.assemblies(), [wall]);
  const slab: Assembly = { id: 'a2', name: 'Slab', variables: [], items: [] };
  store.importAnnotations([], [], {}, { assemblies: [{ ...wall, id: 'x', items: [] }, slab] });
  assert.deepEqual(store.assemblies(), [{ ...wall, items: [] }, slab]);
  store.setAssemblies([]);
  store.undoManager.undo();
  assert.equal(store.assemblies().length, 2);
  await store.destroy();
});
