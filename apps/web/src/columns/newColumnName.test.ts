import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMN_TYPES } from '@nb/markup';
import { BUILT_IN_COLUMNS, newColumnName } from './listColumns.ts';

test('newColumnName keeps a free name as is', () => {
  assert.equal(newColumnName('Text', []), 'Text');
});

test('newColumnName numbers a name another custom column has', () => {
  assert.equal(newColumnName('Text', ['Text', 'Text 2']), 'Text 3');
});

test('newColumnName never gives a built-in column’s name (which would stop the column being saved)', () => {
  assert.equal(newColumnName('Date', []), 'Date 2');
  assert.equal(newColumnName('Checkmark', []), 'Checkmark 2');
});

test('newColumnName gives every column type a name that is not a built-in', () => {
  const builtIns = new Set(BUILT_IN_COLUMNS.map((b) => b.label.toLowerCase()));
  for (const t of COLUMN_TYPES) assert.equal(builtIns.has(newColumnName(t.label, []).toLowerCase()), false);
});
