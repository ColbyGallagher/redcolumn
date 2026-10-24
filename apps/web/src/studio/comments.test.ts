import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATUSES, type Markup } from '@nb/markup';
import { commentRows, commentsToCsv, filterComments, sortComments } from './comments.ts';

const m = (id: string, page: number, extra: Partial<Markup>): Markup => ({
  id,
  type: 'cloud',
  pageIndex: page,
  points: [],
  style: { stroke: '#f00', fill: null, width: 1, opacity: 1 },
  status: 'none',
  author: 'Hana',
  createdAt: page,
  modifiedAt: 1000 + page,
  ...extra,
});

const rowsOf = () => [
  ...commentRows(
    {
      fileId: 'f1',
      file: 'A-101.pdf',
      pageLabel: (i) => (i === 0 ? 'A-101' : `Page ${i + 1}`),
      markups: [
        m('m2', 1, { comment: 'Check the lintel', status: 'accepted', replies: [{ id: 'r1', author: 'Sam', text: 'Done, see rev B', createdAt: 5000 }] }),
        m('m1', 0, { comment: '  Door swing wrong ' }),
        m('m3', 0, {}),
        m('m4', 0, { replies: [{ id: 'r2', author: 'Sam', text: 'Why is this here?', createdAt: 4000 }] }),
      ],
    },
    DEFAULT_STATUSES,
  ),
  ...commentRows({ fileId: 'f2', file: 'S-201.pdf', pageLabel: () => 'S-201', markups: [m('n1', 0, { comment: 'Rebar spacing', author: 'Lee' })] }, DEFAULT_STATUSES),
];

test('comments and replies become rows, in page order; markups with neither are left out', () => {
  const rows = rowsOf();
  assert.deepEqual(
    rows.map((r) => [r.file, r.sheet, r.author, r.text, r.statusName, r.replyId ?? null]),
    [
      ['A-101.pdf', 'A-101', 'Hana', 'Door swing wrong', 'None', null],
      ['A-101.pdf', 'A-101', 'Sam', 'Why is this here?', 'None', 'r2'],
      ['A-101.pdf', 'Page 2', 'Hana', 'Check the lintel', 'Accepted', null],
      ['A-101.pdf', 'Page 2', 'Sam', 'Done, see rev B', 'Accepted', 'r1'],
      ['S-201.pdf', 'S-201', 'Lee', 'Rebar spacing', 'None', null],
    ],
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'keys are unique');
});

test('filters by open or resolved, by status, by file and by text', () => {
  const rows = rowsOf();
  assert.equal(filterComments(rows, 'open', null).length, 3);
  assert.deepEqual(filterComments(rows, 'resolved', null).map((r) => r.markupId), ['m2', 'm2']);
  assert.equal(filterComments(rows, 'status:accepted', null).length, 2);
  assert.deepEqual(filterComments(rows, 'all', 'f2').map((r) => r.text), ['Rebar spacing']);
  assert.deepEqual(filterComments(rows, 'all', null, 'sam').map((r) => r.replyId), ['r2', 'r1']);
});

test('sorts by any column, both ways, keeping thread order for ties', () => {
  const rows = rowsOf();
  assert.deepEqual(sortComments(rows, 'author', 1).map((r) => r.author), ['Hana', 'Hana', 'Lee', 'Sam', 'Sam']);
  assert.deepEqual(sortComments(rows, 'at', -1).map((r) => r.at), [5000, 4000, 1001, 1000, 1000]);
  assert.deepEqual(sortComments(rows, 'file', -1).map((r) => r.file)[0], 'S-201.pdf');
});

test('CSV has one line per row, quoted where needed', () => {
  const csv = commentsToCsv(rowsOf().slice(0, 2));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'File,Sheet,Page,Type,Author,Comment,Status,Date');
  assert.equal(lines[1], `A-101.pdf,A-101,1,Comment,Hana,Door swing wrong,None,${new Date(1000).toISOString()}`);
  assert.equal(lines[2]!.split(',')[3], 'Reply');
  assert.match(commentsToCsv(commentRows({ fileId: 'x', file: 'a,b.pdf', pageLabel: () => '1', markups: [m('q', 0, { comment: 'say "hi"' })] }, DEFAULT_STATUSES)), /"a,b\.pdf",1,1,Comment,Hana,"say ""hi"""/);
});
