import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hipValleySlope, pickedSlopePatch, pickedSpec, setSlopePick, slopePick } from './slopePicker';
import { toolFieldsPatch } from './selectionFormat';

test('the Slope picker gives a slope spec, or none', () => {
  assert.deepEqual(pickedSpec({ kind: 'pitch', value: 6, rise: 1, run: 4 }), { kind: 'pitch', value: 6 });
  assert.deepEqual(pickedSpec({ kind: 'ratio', value: 6, rise: 1, run: 4 }), { kind: 'ratio', rise: 1, run: 4 });
  assert.equal(pickedSpec({ kind: 'none', value: 6, rise: 1, run: 4 }), null);
  setSlopePick({ kind: 'degrees', value: 30 });
  assert.deepEqual(hipValleySlope('valley'), { kind: 'valley', a: { kind: 'degrees', value: 30 } });
  setSlopePick({ kind: 'none' });
  assert.deepEqual(hipValleySlope('hip'), { kind: 'hip', a: { kind: 'pitch', value: 6 } }, 'no slope picked: 6:12');
  setSlopePick({ kind: 'pitch', value: 6 });
  assert.equal(slopePick().kind, 'pitch');
});

test('a picked slope goes on measurements it applies to; a hip keeps being a hip', () => {
  const pitch = { kind: 'pitch' as const, value: 8 };
  assert.deepEqual(pickedSlopePatch({ type: 'area' }, pitch), { slope: pitch });
  assert.deepEqual(pickedSlopePatch({ type: 'rect' }, pitch), {});
  assert.deepEqual(pickedSlopePatch({ type: 'count' }, pitch), {});
  assert.deepEqual(pickedSlopePatch({ type: 'length', slope: { kind: 'hip', a: { kind: 'pitch', value: 6 } } }, pitch), { slope: { kind: 'hip', a: pitch } });
  assert.deepEqual(pickedSlopePatch({ type: 'length', slope: pitch }, null), { slope: undefined });
  // The tool's slope edit goes on measurements only, and hips on runs only.
  assert.deepEqual(toolFieldsPatch({ type: 'area' }, { slope: { kind: 'hip', a: pitch } }), {});
  assert.deepEqual(toolFieldsPatch({ type: 'polylength' }, { slope: { kind: 'hip', a: pitch } }), { slope: { kind: 'hip', a: pitch } });
});
