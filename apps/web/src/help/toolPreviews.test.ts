import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PREVIEW_IDS, toolPreview } from './toolPreviews.ts';

test('every preview names a recording that exists and has a short sentence', () => {
  for (const id of PREVIEW_IDS) {
    const p = toolPreview(id);
    assert.ok(p, id);
    if (p.gif) assert.ok(existsSync(new URL(`../../public/help/gif/${p.gif}.gif`, import.meta.url)), `${id}: ${p.gif}.gif`);
    assert.ok(p.hint.length > 0 && p.hint.length <= 80, `${id}: "${p.hint}" is ${p.hint.length} characters`);
    assert.ok(/[.]$/.test(p.hint), `${id}: the sentence should end with a full stop`);
  }
});

test('an unknown id has no preview, whatever Object.prototype holds', () => {
  assert.equal(toolPreview('nothing.here'), undefined);
  assert.equal(toolPreview('constructor'), undefined);
  assert.equal(toolPreview('toString'), undefined);
});

test('the Modify tab and the markup tools are covered', () => {
  for (const id of ['edit.move', 'edit.offset', 'edit.trim', 'edit.arrayPolar', 'edit.multiply', 'edit.alignLeft', 'rect', 'cloudPlus', 'redaction']) assert.ok(toolPreview(id), id);
});
