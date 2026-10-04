import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyState, describeQueued, noteText, ProjectQueue, type KeyValueStore, type QueuedChange } from './queue';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const base = { projectId: 'p1', by: 'Ann' };
const checkin = (fileId: string, comment = '') => ({ ...base, kind: 'checkin' as const, fileId, fileName: `${fileId}.pdf`, libraryId: `lib-${fileId}`, baseRev: 2, comment, keep: false });
const note = (fileId: string, text: string) => ({ ...base, kind: 'note' as const, fileId, fileName: `${fileId}.pdf`, text });
const unreachable = new TypeError('Offline: could not reach OneDrive.');
const refused = new Error('Bob has it checked out.');

test('changes are kept across reloads and sent in the order they were made', async () => {
  const store = memory();
  const q = new ProjectQueue(store);
  q.add(note('a', 'first'), 1);
  q.add(checkin('b', 'clouds'), 2);
  q.add(note('a', 'second'), 3);
  const again = new ProjectQueue(store);
  assert.equal(again.all().length, 3);
  const order: string[] = [];
  const r = await again.send(async (c) => void order.push(describeQueued(c)));
  assert.deepEqual(order, ['Note on a.pdf: first', 'Check in b.pdf: clouds', 'Note on a.pdf: second']);
  assert.equal(r.sent.length, 3);
  assert.deepEqual(again.all(), []);
  assert.deepEqual(JSON.parse(store.data.get('nb.projects.queue')!), []);
});

test('a second offline check-in of a file replaces the first', () => {
  const q = new ProjectQueue(memory());
  q.add(checkin('a', 'one'));
  q.add(note('a', 'hello'));
  q.add(checkin('a', 'two'));
  assert.deepEqual(q.all().map(describeQueued), ['Note on a.pdf: hello', 'Check in a.pdf: two']);
  assert.equal(q.pendingCheckIn('p1', 'a')?.comment, 'two');
  assert.equal(q.pendingCheckIn('p1', 'b'), null);
});

test('when OneDrive cannot be reached, sending stops and everything stays queued', async () => {
  const q = new ProjectQueue(memory());
  q.add(note('a', 'x'));
  q.add(note('b', 'y'));
  let calls = 0;
  const r = await q.send(async () => {
    calls++;
    throw unreachable;
  });
  assert.equal(calls, 1);
  assert.equal(r.stopped, true);
  assert.equal(q.all().length, 2);
  assert.ok(q.all().every((c) => !c.error));
});

test('a refused change keeps its reason, holds back later changes to the same file, and others still go', async () => {
  const q = new ProjectQueue(memory());
  q.add(checkin('a', 'mine'));
  q.add(note('b', 'other file'));
  q.add(note('a', 'after the check-in'));
  const sent: string[] = [];
  const r = await q.send(async (c: QueuedChange) => {
    if (c.kind === 'checkin') throw refused;
    sent.push(describeQueued(c));
  });
  assert.deepEqual(sent, ['Note on b.pdf: other file']);
  assert.equal(r.failed.length, 1);
  assert.deepEqual(q.all().map((c) => [describeQueued(c), c.error ?? null]), [
    ['Check in a.pdf: mine', 'Bob has it checked out.'],
    ['Note on a.pdf: after the check-in', null],
  ]);
  // Refused changes are skipped until retried or discarded.
  const again = await q.send(async () => assert.fail('nothing should be sent'));
  assert.equal(again.sent.length, 0);
  q.discard(q.all()[0]!.id);
  await q.send(async (c) => void sent.push(describeQueued(c)));
  assert.deepEqual(sent.at(-1), 'Note on a.pdf: after the check-in');
  assert.deepEqual(q.all(), []);
});

test('retry clears the reason so the change is sent again', async () => {
  const q = new ProjectQueue(memory());
  q.add(checkin('a'));
  await q.send(async () => {
    throw refused;
  });
  q.retry();
  const r = await q.send(async () => {});
  assert.equal(r.sent.length, 1);
});

test('only one send runs at a time', async () => {
  const q = new ProjectQueue(memory());
  q.add(note('a', 'x'));
  let calls = 0;
  const [one, two] = [q.send(async () => void calls++), q.send(async () => void calls++)];
  assert.equal(one, two);
  await one;
  assert.equal(calls, 1);
  assert.equal(q.busy, false);
});

test('copyState tells current, out-of-date and missing copies apart', () => {
  assert.deepEqual(copyState(null, 3), { kind: 'none' });
  assert.deepEqual(copyState({ rev: 3 }, 3), { kind: 'current', rev: 3 });
  assert.deepEqual(copyState({ rev: 1 }, 3), { kind: 'stale', rev: 1, latest: 3 });
});

test('notes written offline say so when they are sent late', () => {
  const n = { ...note('a', 'Door moved'), id: '1', at: Date.UTC(2026, 0, 1) };
  assert.equal(noteText(n, n.at + 1000), 'noted on a.pdf: “Door moved”');
  assert.match(noteText(n, n.at + 3_600_000), /^noted on a\.pdf \(written offline .+\): “Door moved”$/);
});
