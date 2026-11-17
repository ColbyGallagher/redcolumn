import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STATUSES, MarkupStore, openPatch, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import { buildRows, listColumns, type CellContext } from '../columns/listColumns.ts';
import { closeOut, closeOutCsv, closedComments, closedStatuses, isComment, raisedRevisions } from './closeOut.ts';
import { registerTable, starterTemplate } from './register.ts';

function markup(n: number, patch: Partial<Markup> = {}): Markup {
  return { id: `m${n}`, seq: n, type: 'cloud', pageIndex: 0, points: [[10, 10], [50, 40]], style: { stroke: '#ff0000', strokeWidth: 1 }, author: 'Rae Reviewer', createdAt: n, modifiedAt: n, status: 'none', ...patch } as Markup;
}
// Two sheets of the fictional Kestrel Road set, and a page with no title block found.
const sheets = { 0: { number: 'KR-C-101', title: 'General arrangement', revision: 'B' }, 1: { number: 'KR-C-102', title: 'Drainage plan', revision: ' C ' }, 2: { number: null, title: null, revision: null } };
const markups = () => [
  markup(1, { comment: 'Kerb line clashes with pit lid' }),
  markup(2, { comment: 'Show the batter extent', status: 'completed', raisedRev: 'A' }),
  markup(3, { comment: 'Label the culvert', status: 'rejected', pageIndex: 1, replies: [{ id: 'r1', author: 'Priya', text: 'It is on KR-C-103', createdAt: 5 }] }),
  markup(4, { pageIndex: 1 }),
  markup(5, { type: 'text', text: 'Pit P4 missing', pageIndex: 2, status: 'accepted' }),
  markup(6, { type: 'space', comment: 'Room 1', pageIndex: 1 } as Partial<Markup>),
];

test('a comment is a markup that says something', () => {
  assert.deepEqual(markups().filter(isComment).map((m) => m.id), ['m1', 'm2', 'm3', 'm5']);
  assert.equal(isComment(markup(7, { comment: '   ' })), false);
  assert.equal(isComment(markup(8, { replies: [{ id: 'r', author: 'P', text: 'ok', createdAt: 1 }] })), true);
});

test('closed is what the client’s template says, or accepted, completed and cancelled', () => {
  assert.deepEqual([...closedStatuses(null)].sort(), ['accepted', 'cancelled', 'completed']);
  const t = starterTemplate('t', DEFAULT_STATUSES, 0);
  assert.deepEqual([...closedStatuses(t)].sort(), ['accepted', 'cancelled', 'completed']);
  // This client closes a comment by rejecting it too, and "accepted" still needs the drawing changed.
  const theirs = { statuses: t.statuses.map((s) => ({ ...s, closed: s.id === 'rejected' || s.id === 'completed' })) };
  assert.deepEqual([...closedStatuses(theirs)].sort(), ['completed', 'rejected']);
});

test('a comment is raised on its sheet’s revision, once', () => {
  const raised = raisedRevisions(markups(), sheets);
  // m2 has one already; m4 and the space are not comments; m5's page has no revision.
  assert.deepEqual([...raised], [['m1', 'B'], ['m3', 'C']]);
  assert.deepEqual([...raisedRevisions(markups(), sheets, new Set([1]))], [['m3', 'C']]);
});

test('the close-out counts open and closed by sheet, in page order', () => {
  const out = closeOut(markups(), sheets, closedStatuses(null), DEFAULT_STATUSES);
  assert.deepEqual(out.map((s) => [s.sheet, s.title, s.revision, s.open, s.closed]), [['KR-C-101', 'General arrangement', 'B', 1, 1], ['KR-C-102', 'Drainage plan', 'C', 1, 0], ['Page 3', '', '', 0, 1]]);
  assert.deepEqual(out[0]!.comments.map((c) => [c.itemNo, c.text, c.statusName, c.closed, c.raisedRev]), [[1, 'Kerb line clashes with pit lid', 'Open', false, ''], [2, 'Show the batter extent', 'Completed', true, 'A']]);
  assert.deepEqual([out[1]!.comments[0]!.statusName, out[1]!.comments[0]!.closed, out[1]!.comments[0]!.replies], ['Rejected', false, 1]);
  assert.equal(out[2]!.comments[0]!.text, 'Pit P4 missing');

  // The same document where rejecting closes a comment.
  const strict = closeOut(markups(), sheets, new Set(['rejected', 'completed']), DEFAULT_STATUSES);
  assert.deepEqual(strict.map((s) => [s.open, s.closed]), [[1, 1], [0, 1], [1, 0]]);

  const csv = closeOutCsv(out).split('\r\n');
  assert.equal(csv[0], 'Sheet,Title,Revision,ID,Comment,Author,Status,Open or closed,Raised at revision,Replies');
  assert.equal(csv[2], 'KR-C-101,General arrangement,B,2,Show the batter extent,Rae Reviewer,Completed,Closed,A,0');
  assert.equal(csv.length, 5);
});

test('Slip Sheet leaves behind the closed comments on the replaced sheets only', () => {
  const closed = closedStatuses(null);
  assert.deepEqual(closedComments(markups(), new Set([0, 1]), closed).map((m) => m.id), ['m2']);
  assert.deepEqual(closedComments(markups(), new Set([2]), closed).map((m) => m.id), ['m5']);
  // A markup with a closed status and nothing to say is not a comment: it stays.
  assert.deepEqual(closedComments([markup(9, { status: 'completed' })], new Set([0]), closed), []);
});

test('the raised revision is kept on the markup, shows in the list, and is not taken back from a register', async () => {
  const store = await MarkupStore.open(`close-out-${Math.random()}`, { persist: false });
  store.add(markup(1, { comment: 'Kerb line clashes with pit lid' }));
  store.update('m1', { raisedRev: 'B' });
  assert.equal(store.get('m1')?.raisedRev, 'B');
  // Anyone who can mark up may record it on someone else's comment, as they may set its status.
  assert.deepEqual(openPatch({ raisedRev: 'B', comment: 'changed' }), { raisedRev: 'B' });

  const ctx: CellContext = { scaleOf: () => DEFAULT_SCALE, sheets: {}, statuses: DEFAULT_STATUSES, columns: [] };
  const all = listColumns([]);
  const column = all.find((c) => c.key === 'raisedRev');
  assert.equal(column?.label, 'Raised at Revision');
  const rows = buildRows([store.get('m1')!], ctx, {}, null);
  assert.equal(rows[0]!.cells.raisedRev!.text, 'B');

  // In a register it is a column like Sheet: locked, so nothing typed there changes it.
  const t = starterTemplate('t', DEFAULT_STATUSES, 0);
  const table = registerTable(rows, all, { ...t, columns: [...t.columns, { header: 'Raised at rev', field: { kind: 'column', key: 'raisedRev' } }] }, DEFAULT_STATUSES);
  const at = table.columns.findIndex((c) => c.key === 'raisedRev');
  assert.deepEqual([table.columns[at]!.label, table.columns[at]!.edit, table.rows[0]!.cells[at]], ['Raised at rev', 'locked', 'B']);
});
