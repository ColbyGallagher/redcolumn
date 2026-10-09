import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLES, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import { commentListMarkups, groupRows, matchesAdvanced, rowsToCsv, ruleFilter, withThreads, type ListRowData } from './listColumns.ts';

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

test('a Cloud+ cloud is left out of the list when its callout carries the comment', () => {
  const cloud: Markup = {
    id: 'cloud',
    type: 'cloud',
    pageIndex: 0,
    points: [[0, 0], [10, 10]],
    style: { ...DEFAULT_STYLES.cloud },
    status: 'none',
    author: 'A',
    createdAt: 1,
    modifiedAt: 1,
    groupId: 'g',
    subject: 'Cloud+',
  };
  const callout: Markup = {
    id: 'note',
    type: 'callout',
    pageIndex: 0,
    points: [[0, 0], [1, 1], [2, 2], [3, 3]],
    style: { ...DEFAULT_STYLES.callout },
    status: 'none',
    author: 'A',
    createdAt: 2,
    modifiedAt: 2,
    groupId: 'g',
    subject: 'Cloud+',
    text: 'Please clarify the underbore.',
    replies: [{ id: 'r1', author: 'B', text: 'Yes, the contractor will.', createdAt: 3 }],
  };
  assert.deepEqual(
    commentListMarkups([cloud, callout]).map((m) => m.id),
    ['note'],
  );
});

test('replies export under their parent, and a reply to a reply under that reply', () => {
  const markup: Markup = {
    id: 'm1',
    type: 'cloud',
    pageIndex: 0,
    points: [[0, 0], [10, 10]],
    style: { ...DEFAULT_STYLES.cloud },
    status: 'none',
    author: 'A',
    createdAt: 1,
    modifiedAt: 2,
    seq: 4,
    replies: [
      { id: 'r2', author: 'C', text: 'And', createdAt: 4, parentId: 'r1' },
      { id: 'r1', author: 'B', text: 'Yes', createdAt: 3 },
    ],
  };
  const row: ListRowData = { markup, cells: { subject: { text: 'Cloud', num: null }, comment: { text: 'Check', num: null } } };
  const flat = withThreads([row], { scaleOf: () => DEFAULT_SCALE, sheets: {}, statuses: [], columns: [] });
  assert.deepEqual(
    flat.map((r) => [r.reply?.id ?? r.markup.id, r.reply?.parentId ?? '', r.cells.subject?.text, r.cells.comment?.text]),
    [
      ['m1', '', 'Cloud', 'Check'],
      ['r1', 'm1', 'Reply', 'Yes'],
      ['r2', 'r1', 'Reply', 'And'],
    ],
  );
  const csv = rowsToCsv(flat, [
    { key: 'subject', label: 'Subject', defaultWidth: 10 },
    { key: 'comment', label: 'Comments', defaultWidth: 10 },
  ], true);
  assert.equal(csv.split('\r\n')[0], 'ID,Parent,Subject,Comments');
  assert.match(csv, /r1,m1,> Reply,Yes/);
  assert.match(csv, /r2,r1,> > Reply,And/);
});
