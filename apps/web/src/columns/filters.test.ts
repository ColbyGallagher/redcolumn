import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRows, matchesAdvanced, ruleFilter, type ListRowData } from './listColumns.ts';

const cells = (subject: string, page: number) => ({ subject: { text: subject, num: null }, page: { text: String(page), num: page } });

test('filter builder rules become column filters', () => {
  assert.equal(ruleFilter({ key: 'page', op: 'gte', value: '3' }), '>=3');
  assert.equal(ruleFilter({ key: 'subject', op: 'notContains', value: 'cloud' }), '!cloud');
  assert.equal(ruleFilter({ key: 'subject', op: 'blank', value: '' }), '(blank)');
});

test('rules match all or any, and ignore rules for columns the document lacks', () => {
  const row = cells('Cloud', 4);
  const rules = [
    { key: 'subject', op: 'equals' as const, value: 'Cloud' },
    { key: 'page', op: 'lt' as const, value: '3' },
  ];
  assert.equal(matchesAdvanced(row, { match: 'all', rules }), false);
  assert.equal(matchesAdvanced(row, { match: 'any', rules }), true);
  assert.equal(matchesAdvanced(row, { match: 'all', rules: [{ key: 'custom:gone', op: 'equals', value: 'x' }] }), true);
  // A rule still waiting for its value does not filter.
  assert.equal(matchesAdvanced(row, { match: 'all', rules: [{ key: 'subject', op: 'contains', value: ' ' }] }), true);
  assert.equal(matchesAdvanced(row, null), true);
});

test('rows group by a column in the order they come', () => {
  const rows = [cells('Cloud', 1), cells('Text', 1), cells('Cloud', 2), cells('', 3)].map((c, i) => ({ markup: { id: String(i) }, cells: c }) as unknown as ListRowData);
  assert.deepEqual(
    groupRows(rows, 'subject').map((g) => [g.label, g.rows.length]),
    [
      ['Cloud', 2],
      ['Text', 1],
      ['(blank)', 1],
    ],
  );
});
