import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isModelFile, MODEL_ACCEPT } from './files.ts';

test('IFC files are models, whatever the case of the extension', () => {
  assert.equal(isModelFile({ name: 'Kestrel Road.ifc' }), true);
  assert.equal(isModelFile({ name: 'MODEL.IFC' }), true);
  assert.equal(isModelFile({ name: 'plan.pdf' }), false);
  assert.equal(isModelFile({ name: 'model.ifc.pdf' }), false);
  assert.equal(isModelFile({ name: 'ifc' }), false);
  assert.equal(MODEL_ACCEPT, '.ifc');
});
