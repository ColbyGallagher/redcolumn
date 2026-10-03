import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetParams, MODEL, SheetRequest, toSheetResult } from './sheetIndex.ts';

test('request shape: two JPEGs, hint text, structured output, fallbacks', () => {
  const params = buildSheetParams({ page: 'AAA', titleBlock: 'BBB', textHint: { number: 'C-101', title: null } });
  assert.equal(params.model, MODEL);
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.equal(params.output_config.effort, 'low');
  assert.equal(params.output_config.format.type, 'json_schema');
  const content = params.messages[0]!.content;
  const images = content.filter((b) => b.type === 'image');
  assert.equal(images.length, 2);
  assert.equal(content.at(-1)!.type === 'text' && content.at(-1)!.text, 'Text-layer hint: number C-101, title unknown.');
});

test('no hint tells the model the sheet may be scanned', () => {
  const params = buildSheetParams({ page: 'A', titleBlock: 'B' });
  const last = params.messages[0]!.content.at(-1)!;
  assert.ok(last.type === 'text' && /scanned/.test(last.text));
});

test('request validation rejects missing and oversized images', () => {
  assert.equal(SheetRequest.safeParse({ page: '', titleBlock: 'x' }).success, false);
  assert.equal(SheetRequest.safeParse({ page: 'x'.repeat(5_000_001), titleBlock: 'x' }).success, false);
  assert.equal(SheetRequest.safeParse({ page: 'x', titleBlock: 'y', textHint: null }).success, true);
});

test('results are trimmed, numbers upper-cased, confidence mapped', () => {
  assert.deepEqual(
    toSheetResult({ sheet_number: ' c-101 ', sheet_title: 'GRADING PLAN', discipline: 'Civil', scale: '1" = 20\'', revision: '', confidence: 'medium' }),
    { number: 'C-101', title: 'GRADING PLAN', discipline: 'Civil', scaleText: '1" = 20\'', revision: null, confidence: 0.7 },
  );
});
