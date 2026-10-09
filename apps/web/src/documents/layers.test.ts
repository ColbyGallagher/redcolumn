import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from 'pdf-lib';
import { layersOnPages, readLayers, withLayersShown } from './layers.ts';

async function layered() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const ctx = doc.context;
  const a = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('Walls') }));
  const b = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('Furniture') }));
  const c = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('Grid') }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [a, b, c], D: { Order: [a, [b], c], OFF: [c], Locked: [a] } }));
  return doc.save();
}

test('layers are read in their order, with default visibility and locks', async () => {
  const layers = await readLayers(await layered());
  assert.deepEqual(layers.map((l) => [l.name, l.on, l.locked, l.depth]), [
    ['Walls', true, true, 0],
    ['Furniture', true, false, 1],
    ['Grid', false, false, 0],
  ]);
});

test('a viewing copy shows and hides the chosen layers', async () => {
  const bytes = await layered();
  const [walls, , grid] = await readLayers(bytes);
  const view = await withLayersShown(bytes, new Set([walls!.id]));
  const again = await readLayers(view);
  assert.deepEqual(again.map((l) => l.on), [false, true, true]);
  assert.equal(again.find((l) => l.id === grid!.id)?.on, true);
  const d = (await PDFDocument.load(view)).catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('D'), PDFDict);
  assert.equal(d.lookup(PDFName.of('OFF'), PDFArray).size(), 1);
});

test('each page lists the layers it draws with', async () => {
  const doc = await PDFDocument.load(await layered());
  const ctx = doc.context;
  const [walls, furniture] = await readLayers(await doc.save());
  const ref = (id: string) => PDFRef.of(Number(id.split(' ')[0]), Number(id.split(' ')[1]));
  doc.addPage([200, 200]);
  const [p1, p2] = doc.getPages();
  p1!.node.set(PDFName.of('Resources'), ctx.obj({ Properties: { oc1: ref(walls!.id) } }));
  p2!.node.set(PDFName.of('Resources'), ctx.obj({ Properties: { oc1: ctx.obj({ Type: 'OCMD', OCGs: [ref(furniture!.id)] }) } }));
  assert.deepEqual(await layersOnPages(await doc.save()), [[walls!.id], [furniture!.id]]);
});
