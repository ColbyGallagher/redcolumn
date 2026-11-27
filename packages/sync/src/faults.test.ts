/**
 * Sync under faults, one named test per rule, run through the deterministic simulation in
 * `faultHarness.ts`. A failure here names the rule that broke.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Markup } from '@nb/markup';
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOL, type Operation } from '@nb/ops';
import { DAY, HOUR, SCOPE_ID, STREAM_ID, SyncSim, type SimClient } from './faultHarness.ts';
import { runSeed } from './faultRun.ts';

const STYLE = { stroke: '#d92d20', fill: null, width: 2, opacity: 1 };
const HELLO = { streamId: STREAM_ID, cursor: null, protocol: SUPPORTED_PROTOCOL };

function rect(id: string, extra: Partial<Markup> = {}): Markup {
  return {
    id,
    type: 'rect',
    pageIndex: 0,
    points: [[10, 20], [110, 80]],
    style: { ...STYLE },
    status: 'none',
    author: '',
    createdAt: 0,
    modifiedAt: 0,
    ...extra,
  };
}

/** An editor-only world with the given users, all connected. */
async function world(names: string[], seed = 1, options: { maxLogLength?: number } = {}): Promise<{ sim: SyncSim; c: SimClient[] }> {
  const sim = new SyncSim({ seed, ...options });
  const c: SimClient[] = [];
  for (const name of names) c.push(await sim.addClient(name, { role: 'editor' }));
  for (const client of c) await client.connect();
  return { sim, c };
}

function opsOn(sim: SyncSim, entityId: string): string[] {
  return sim.commits.flatMap((e) => e.ops.filter((o) => o.entityId === entityId).map((o) => o.opId));
}

function assertHealthy(sim: SyncSim): void {
  assert.deepEqual(sim.problems(), []);
}

// ---- The harness itself ----------------------------------------------------------------------

test('harness: the same seed replays the same run exactly', async () => {
  const a = await runSeed(4242);
  const b = await runSeed(4242);
  assert.deepEqual(a, b);
  assert.deepEqual(a.problems, []);
  assert.ok(a.accepted > 0);
});

test('harness: the virtual clock jumps days without waiting, and frames keep their order on a connection', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  const start = sim.clock.now();
  sim.clock.advanceDays(3);
  assert.equal(sim.clock.now() - start, 3 * DAY);
  sim.net.faults = { ...sim.net.faults, minLatency: 1, maxLatency: 200 };
  for (let i = 0; i < 20; i++) ann!.doc.add(rect(`note-${i}`, { text: `Note ${i}` }));
  await sim.net.drain();
  // Twenty units sent back to back arrive, and are committed, in the order they were made.
  assert.deepEqual(
    sim.commits.map((e) => e.ops[0]!.entityId),
    Array.from({ length: 20 }, (_, i) => `note-${i}`),
  );
  assert.equal(ben!.doc.all().length, 20);
  assertHealthy(sim);
});

// ---- Proof 1: allowed and forbidden edits, and a modified client ---------------------------

test('proof 1: two users make allowed edits; the edits one may not make never leave a well-behaved app', async () => {
  const sim = new SyncSim({ seed: 11 });
  const ann = await sim.addClient('ann', { role: 'editor' });
  const ben = await sim.addClient('ben', { role: 'author', editRule: (m) => m.author === 'ben' });
  await ann.connect();
  await ben.connect();

  ann.doc.add(rect('ann-note', { text: 'Check beam size' }));
  ben.doc.add(rect('ben-note', { text: 'Sleeve needed' }));
  await sim.net.drain();

  // Allowed: Ann may edit anything; Ben may edit his own markup.
  ann.doc.setField(['ben-note'], 'trade', 'Mechanical');
  ben.doc.update('ben-note', { text: 'Sleeve needed at grid C4' });
  // Forbidden: Ben may not edit Ann's markup, and his app does not send it.
  assert.equal(ben.doc.mayEdit(ben.doc.get('ann-note')!), false);
  const queued = ben.doc.sync.pendingCount;
  ben.doc.update('ann-note', { text: 'Overwritten' });
  ben.doc.remove(['ann-note']);
  assert.equal(ben.doc.sync.pendingCount, queued, 'nothing forbidden is queued');
  await sim.net.drain();

  for (const doc of [ann.doc, ben.doc]) {
    assert.equal(doc.get('ann-note')?.text, 'Check beam size');
    assert.equal(doc.get('ben-note')?.text, 'Sleeve needed at grid C4');
    assert.equal(doc.get('ben-note')?.fields?.trade, 'Mechanical');
  }
  assertHealthy(sim);
});

test('proof 1: a modified client sending forbidden operations is refused, and honest clients are untouched', async () => {
  const sim = new SyncSim({ seed: 12 });
  const ann = await sim.addClient('ann', { role: 'editor' });
  const ben = await sim.addClient('ben', { role: 'author', editRule: (m) => m.author === 'ben' });
  await ann.connect();
  await ben.connect();
  ann.doc.add(rect('ann-note', { text: 'Check beam size' }));
  ben.doc.add(rect('ben-note', { text: 'Sleeve needed' }));
  await sim.net.drain();

  // A modified client signed in as Ben speaks the wire protocol directly.
  const raw = sim.rawClient('ben', 'author');
  raw.connect(HELLO);
  await sim.net.drain();
  const before = structuredClone(sim.server.state);
  const seqBefore = sim.server.seq;
  const annMarkup = sim.server.state.markups['ann-note']!;
  const annPlacement = Object.values(sim.server.state.placements).find((p) => p.markupId === 'ann-note')!;
  const annCreate = sim.commits[0]!.ops[0]! as Operation;
  const env = { schemaVersion: PROTOCOL_VERSION, streamId: STREAM_ID };

  const forged: Operation[][] = [
    // Edit, delete and move someone else's markup.
    [{ ...env, opId: 'f1', type: 'markup.patch', entityId: 'ann-note', basedOn: { text: annMarkup.versions.text?.v ?? 0 }, payload: { set: { text: 'Forged' } } }],
    [{ ...env, opId: 'f2', type: 'markup.delete', entityId: 'ann-note', payload: {} }],
    [{ ...env, opId: 'f3', type: 'placement.patch', entityId: annPlacement.id, basedOn: { geometry: 0 }, payload: { geometry: { points: [[0, 0], [1, 1]] } } }],
    // A batch mixing an allowed edit with a forbidden one is refused as a whole.
    [
      { ...env, opId: 'f4a', type: 'markup.patch', entityId: 'ben-note', basedOn: { text: 0 }, payload: { set: { text: 'Mine' } }, batchId: 'fb', batchSize: 2 },
      { ...env, opId: 'f4b', type: 'markup.delete', entityId: 'ann-note', payload: {}, batchId: 'fb', batchSize: 2 },
    ],
    // Claiming to be someone else: the owner always comes from the connection, and is not content.
    [{ ...env, opId: 'f5', type: 'markup.create', entityId: 'fake-note', payload: { scopeId: SCOPE_ID, type: 'rect', content: { style: STYLE, owner: { userId: 'ann' } } } } as unknown as Operation],
    // Replaying Ann's operation id with different content.
    [{ ...annCreate, payload: { ...(annCreate.payload as object), content: { style: STYLE, text: 'Hijacked' } } } as Operation],
  ];
  for (const frame of forged) raw.send(frame);
  await sim.net.drain();

  const answers = raw.received.filter((m) => m.type === 'ack' || m.type === 'reject');
  assert.equal(answers.length, forged.length, 'every forged frame is answered');
  assert.deepEqual(
    answers.map((m) => (m.type === 'reject' ? m.reason.code : 'ACCEPTED')),
    ['forbidden', 'forbidden', 'forbidden', 'forbidden', 'invalid', 'op_id_reused'],
  );
  assert.deepEqual(sim.server.state, before, 'nothing forged reached the server state');
  assert.equal(sim.server.seq, seqBefore);
  assert.equal(sim.commits.filter((e) => e.ops.some((o) => o.opId.startsWith('f'))).length, 0);

  // Honest clients keep working and converge.
  ann.doc.update('ann-note', { text: 'Check beam size and depth' });
  await sim.heal();
  for (const doc of [ann.doc, ben.doc]) assert.equal(doc.get('ann-note')?.text, 'Check beam size and depth');
  assert.equal(ben.doc.get('ben-note')?.text, 'Sleeve needed');
  assertHealthy(sim);
});

// ---- Proof 2: undo after another user's change -------------------------------------------

test('proof 2: undo succeeds after another user changed a different field group', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('m1', { text: 'Original' }));
  await sim.net.drain();
  ann!.doc.update('m1', { text: 'Revised' });
  await sim.net.drain();
  ben!.doc.update('m1', { style: { ...STYLE, stroke: '#1565c0' } });
  ben!.doc.setField(['m1'], 'trade', 'Electrical');
  await sim.net.drain();

  const undo = ann!.history('undo');
  await sim.net.drain();
  assert.deepEqual(await undo, { ok: true });
  for (const doc of [ann!.doc, ben!.doc]) {
    assert.equal(doc.get('m1')?.text, 'Original');
    assert.equal(doc.get('m1')?.style.stroke, '#1565c0', "Ben's style stays");
    assert.equal(doc.get('m1')?.fields?.trade, 'Electrical');
  }
  assertHealthy(sim);
});

test('proof 2: undo after another user changed the same field group reports changed and keeps the inbox clean', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('m1', { text: 'Original' }));
  await sim.net.drain();
  ann!.doc.update('m1', { text: 'Ann edit' });
  await sim.net.drain();
  ben!.doc.update('m1', { text: 'Ben edit' });
  await sim.net.drain();

  // Seen locally: refused at once.
  assert.deepEqual(await ann!.history('undo'), { ok: false, reason: 'changed' });
  assert.equal(ann!.doc.undoHistory().length, 1, 'the stale step is dropped, the earlier one kept');
  assert.equal(ann!.doc.sync.inbox.length, 0);
  assert.equal(sim.server.state.markups.m1!.content.text, 'Ben edit');

  // Not yet seen locally: Ben's change is committed while its event is still on the way to Ann.
  ann!.doc.update('m1', { text: 'Ann again' });
  await sim.net.drain();
  const seq = sim.server.seq;
  ben!.doc.update('m1', { text: 'Ben again' });
  await sim.net.until(() => sim.server.seq === seq + 1);
  assert.equal(ann!.doc.get('m1')?.text, 'Ann again', "Ann has not seen Ben's change yet");
  const undo = ann!.history('undo');
  await sim.net.drain();
  assert.deepEqual(await undo, { ok: false, reason: 'changed' }, 'the server refused it');
  assert.equal(ann!.doc.sync.inbox.length, 0, 'a refused undo is reported to the caller, not the inbox');
  for (const doc of [ann!.doc, ben!.doc]) assert.equal(doc.get('m1')?.text, 'Ben again');
  assertHealthy(sim);
});

test('proof 2: undoing a batch is all or nothing', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('existing', { text: 'Before' }));
  await sim.net.drain();
  const batch = () =>
    ann!.doc.batch(() => {
      ann!.doc.add(rect('pasted-1', { text: 'Pasted one' }));
      ann!.doc.add(rect('pasted-2', { text: 'Pasted two' }));
      ann!.doc.update('existing', { text: 'After' });
    });

  // Undone as one: a single event carries every inverse operation.
  batch();
  await sim.net.drain();
  const seq = sim.server.seq;
  const undo = ann!.history('undo');
  await sim.net.drain();
  assert.deepEqual(await undo, { ok: true });
  assert.equal(sim.server.seq, seq + 1, 'one atomic event');
  for (const doc of [ann!.doc, ben!.doc]) {
    assert.equal(doc.get('pasted-1'), undefined);
    assert.equal(doc.get('pasted-2'), undefined);
    assert.equal(doc.get('existing')?.text, 'Before');
  }

  // One part changed by someone else in the same field group: nothing is undone, locally or on
  // the server. Ben's edit blocks reverting the text, so the two pasted markups stay as well.
  const redo = ann!.history('redo');
  await sim.net.drain();
  assert.deepEqual(await redo, { ok: true });
  const seq2 = sim.server.seq;
  ben!.doc.update('existing', { text: 'Ben moved on' });
  await sim.net.until(() => sim.server.seq === seq2 + 1);
  const blocked = ann!.history('undo');
  await sim.net.drain();
  assert.deepEqual(await blocked, { ok: false, reason: 'changed' });
  for (const doc of [ann!.doc, ben!.doc]) {
    assert.equal(doc.get('pasted-1')?.text, 'Pasted one');
    assert.equal(doc.get('pasted-2')?.text, 'Pasted two');
    assert.equal(doc.get('existing')?.text, 'Ben moved on');
  }
  assert.equal(ann!.doc.sync.inbox.length, 0);
  assertHealthy(sim);
});

// ---- Proof 3: a rejection with dependent pending operations ------------------------------

test('proof 3: a server rejection takes the pending operations based on it along; independent ones survive', async () => {
  const { sim, c: [ann] } = await world(['ann']);
  // A rule the client cannot predict: the text of one markup is locked by the coordinator.
  sim.policy.deny = (_actor, op) =>
    op.type === 'markup.patch' && op.entityId === 'locked' && op.payload.set?.text !== undefined
      ? { code: 'forbidden', message: 'Locked by the coordinator' }
      : null;
  ann!.doc.add(rect('locked', { text: 'Agreed wording' }));
  ann!.doc.add(rect('free', { text: 'Free note' }));
  await sim.net.drain();

  ann!.transport.cut();
  await sim.net.drain();
  ann!.doc.update('locked', { text: 'First try' }); // rejected by the server
  ann!.doc.update('locked', { text: 'Second try' }); // based on the first: goes with it
  ann!.doc.update('locked', { style: { ...STYLE, stroke: '#1565c0' } }); // another group: survives
  ann!.doc.update('free', { text: 'Free note, edited' }); // another markup: survives
  ann!.doc.add(rect('new', { text: 'Added offline' })); // survives
  const [first, second] = ann!.doc.pendingOperations();
  assert.equal(second!.basedOn?.text, first!.opId, 'the second edit is based on the first');

  ann!.transport.restore();
  await ann!.connect();

  const inbox = ann!.doc.sync.inbox;
  assert.equal(inbox.length, 2);
  assert.deepEqual(inbox[0]!.reason, { code: 'forbidden', message: 'Locked by the coordinator' });
  assert.deepEqual(inbox[0]!.ops.map((o) => o.opId), [first!.opId]);
  assert.deepEqual(inbox[1]!.reason, { code: 'dependency_rejected', dependsOnOpId: first!.opId });
  assert.deepEqual(inbox[1]!.ops.map((o) => o.opId), [second!.opId]);

  const server = sim.server.state.markups;
  assert.equal(server.locked!.content.text, 'Agreed wording');
  assert.equal(server.locked!.content.style.stroke, '#1565c0');
  assert.equal(server.free!.content.text, 'Free note, edited');
  assert.equal(server.new!.content.text, 'Added offline');
  assert.equal(ann!.doc.get('locked')?.text, 'Agreed wording');
  assertHealthy(sim);
});

test('proof 3: a queued edit made stale by a peer goes to the inbox with the edits based on it', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('m1', { text: 'Start' }));
  await sim.net.drain();
  ann!.transport.cut();
  await sim.net.drain();
  ann!.doc.update('m1', { text: 'Ann 1' });
  ann!.doc.update('m1', { text: 'Ann 2' });
  ann!.doc.setField(['m1'], 'priority', 'High');
  ben!.doc.update('m1', { text: 'Ben' });
  await sim.net.drain();
  const [first, second, field] = ann!.doc.pendingOperations();

  ann!.transport.restore();
  await ann!.connect();
  assert.deepEqual(
    ann!.doc.sync.inbox.map((e) => [e.ops[0]!.opId, e.reason.code]),
    [[first!.opId, 'conflict'], [second!.opId, 'dependency_rejected']],
  );
  assert.ok(sim.acceptedOpIds().includes(field!.opId));
  for (const doc of [ann!.doc, ben!.doc]) {
    assert.equal(doc.get('m1')?.text, 'Ben');
    assert.equal(doc.get('m1')?.fields?.priority, 'High');
  }
  assertHealthy(sim);
});

test('proof 3: a refused new markup takes its later edits along', async () => {
  const { sim, c: [ann] } = await world(['ann']);
  sim.policy.deny = (_actor, op) => (op.type === 'markup.create' && op.entityId === 'refused' ? { code: 'forbidden', message: 'No new markups here' } : null);
  ann!.transport.cut();
  await sim.net.drain();
  ann!.doc.add(rect('refused', { text: 'Draft' }));
  ann!.doc.update('refused', { text: 'Draft, reworded' });
  ann!.doc.update('refused', { points: [[50, 50], [90, 90]] });
  ann!.doc.add(rect('kept', { text: 'Fine' }));
  const queued = ann!.doc.pendingOperations().filter((o) => o.entityId !== 'kept' && !(o.type === 'placement.create' && o.payload.markupId === 'kept'));

  ann!.transport.restore();
  await ann!.connect();
  const inboxOps = ann!.doc.sync.inbox.flatMap((e) => e.ops.map((o) => o.opId));
  assert.deepEqual(new Set(inboxOps), new Set(queued.map((o) => o.opId)), 'every edit of the refused markup is in the inbox');
  assert.equal(ann!.doc.sync.inbox[0]!.reason.code, 'forbidden');
  assert.ok(ann!.doc.sync.inbox.slice(1).every((e) => e.reason.code === 'dependency_rejected'));
  assert.equal(sim.server.state.markups.refused, undefined);
  assert.equal(sim.server.state.markups.kept?.content.text, 'Fine');
  assertHealthy(sim);
});

// ---- Proof 4: days offline, restarts, reconnect ------------------------------------------

test('proof 4: several days offline with restarts from disk, then reconnect: nothing lost or duplicated', async () => {
  // A short server log, so catching up after days away needs a fresh snapshot.
  const { sim, c: [ann, ben] } = await world(['ann', 'ben'], 4, { maxLogLength: 5 });
  ann!.doc.add(rect('m1', { text: 'Level 2 slab' }));
  ann!.doc.add(rect('m2', { text: 'Remove me' }));
  await sim.net.drain();

  ann!.transport.cut();
  await sim.net.drain();

  // Day 1: edits, then the app is closed and opened again, still offline.
  ann!.doc.update('m1', { text: 'Level 2 slab: check thickness' });
  ann!.doc.add(rect('m3', { text: 'Added on site', pageIndex: 1 }));
  sim.clock.advanceDays(1);
  await sim.net.drain();
  const queuedDay1 = ann!.doc.pendingOperations().map((o) => o.opId);
  await ann!.restart();
  assert.deepEqual(ann!.doc.pendingOperations().map((o) => o.opId), queuedDay1, 'the queue survives a restart');
  assert.equal(ann!.doc.get('m3')?.text, 'Added on site', 'the view is rebuilt from confirmed state and the queue');

  // Day 2: more edits, written to disk, then the app crashes.
  ann!.doc.setField(['m3'], 'trade', 'Structural');
  ann!.doc.remove(['m2']);
  sim.clock.advance(DAY + 3 * HOUR);
  await sim.net.drain();
  const queuedDay2 = ann!.doc.pendingOperations().map((o) => o.opId);
  await ann!.restart({ crash: true });
  assert.deepEqual(ann!.doc.pendingOperations().map((o) => o.opId), queuedDay2);

  // Meanwhile Ben keeps working: more changes than the server log keeps.
  for (let i = 0; i < 8; i++) ben!.doc.setField(['m1'], 'priority', i % 2 ? 'High' : 'Low');
  ben!.doc.add(rect('m4', { text: 'Ben, while Ann was away' }));
  await sim.net.drain();

  // Day 4: back online.
  sim.clock.advanceDays(2);
  ann!.transport.restore();
  await ann!.connect();
  assert.ok(ann!.transport.received.some((m) => m.type === 'welcome' && m.snapshot), 'caught up from a snapshot');

  assert.equal(ann!.doc.sync.pendingCount, 0);
  assert.equal(ann!.doc.sync.inbox.length, 0);
  for (const id of queuedDay2) assert.equal(sim.acceptedOpIds().filter((x) => x === id).length, 1, `${id} applied exactly once`);
  for (const doc of [ann!.doc, ben!.doc]) {
    assert.equal(doc.get('m1')?.text, 'Level 2 slab: check thickness');
    assert.equal(doc.get('m1')?.fields?.priority, 'High');
    assert.equal(doc.get('m2'), undefined);
    assert.equal(doc.get('m3')?.fields?.trade, 'Structural');
    assert.equal(doc.get('m3')?.pageIndex, 1);
    assert.equal(doc.get('m4')?.text, 'Ben, while Ann was away');
    assert.equal(doc.all().length, 3);
  }
  assertHealthy(sim);
});

test('proof 4: a crash loses only what had not reached the disk', async () => {
  const { sim, c: [ann] } = await world(['ann']);
  ann!.transport.cut();
  await sim.net.drain();
  ann!.doc.add(rect('saved', { text: 'On disk' }));
  await sim.net.drain(); // the disk write lands
  ann!.doc.add(rect('unsaved', { text: 'Still in memory' }));
  await ann!.restart({ crash: true }); // before that write lands
  assert.equal(ann!.doc.get('saved')?.text, 'On disk');
  assert.equal(ann!.doc.get('unsaved'), undefined);
  ann!.transport.restore();
  await ann!.connect();
  assert.equal(sim.server.state.markups.saved?.content.text, 'On disk');
  assertHealthy(sim);
});

// ---- Proof 5: lost acknowledgement and retry ---------------------------------------------

test('proof 5: a lost acknowledgement and the retry apply the edit once', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.transport.dropNextAck();
  ann!.doc.add(rect('m1', { text: 'Once only' }));
  await sim.net.drain();
  assert.equal(ann!.doc.sync.connection, 'disconnected', 'losing the ack broke the connection');
  assert.equal(ann!.doc.sync.pendingCount, 2, 'still waiting to hear');
  assert.equal(opsOn(sim, 'm1').length, 1, 'but the server applied it');

  await ann!.connect();
  assert.equal(ann!.doc.sync.pendingCount, 0, 'the catch-up showed it was applied, so it was not resent');
  assert.equal(opsOn(sim, 'm1').length, 1);
  assert.equal(ben!.doc.all().length, 1);
  assertHealthy(sim);
});

test('proof 5: a frame lost on the way, and duplicated frames, still apply once', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.transport.dropNextToServer();
  ann!.doc.add(rect('m1', { text: 'Lost on the way' }));
  await sim.net.drain();
  assert.equal(opsOn(sim, 'm1').length, 0);
  await ann!.connect();
  assert.equal(opsOn(sim, 'm1').length, 1, 'resent on reconnect, applied once');

  ann!.transport.duplicateNextToServer(2);
  ann!.transport.duplicateNextToClient(4);
  ann!.doc.update('m1', { text: 'Sent twice' });
  ann!.doc.setField(['m1'], 'trade', 'Civil');
  await sim.net.drain();
  assert.equal(opsOn(sim, 'm1').length, 3);
  for (const doc of [ann!.doc, ben!.doc]) {
    assert.equal(doc.get('m1')?.text, 'Sent twice');
    assert.equal(doc.all().length, 1);
  }
  assertHealthy(sim);
});

test('proof 5: a copy left on the wire by a broken connection arrives after the retry and is ignored', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  sim.net.faults = { ...sim.net.faults, leakOnCut: 1 };
  ann!.doc.add(rect('m1', { text: 'Leaked' }));
  ann!.transport.holdNextToServer(1, 200); // still on the wire when the connection breaks
  ann!.doc.update('m1', { text: 'Leaked, then retried' });
  ann!.transport.cut();
  await sim.net.until(() => ann!.doc.sync.connection === 'disconnected');
  ann!.transport.restore();
  await ann!.connect(); // resends; the old copy reaches the server later
  await sim.net.drain();
  const patches = sim.commits.filter((e) => e.ops.some((o) => o.type === 'markup.patch'));
  assert.equal(patches.length, 1, 'applied once');
  for (const doc of [ann!.doc, ben!.doc]) assert.equal(doc.get('m1')?.text, 'Leaked, then retried');
  assertHealthy(sim);
});

test('proof 5: under drops, duplicates and reordering, fixed seeds converge with no duplicates', async () => {
  for (const seed of [5, 55, 505, 5005, 50005]) {
    const run = await runSeed(seed, 80);
    assert.deepEqual(run.problems, [], `seed ${seed}`);
  }
});

// ---- Proof 6: access removed, stage closed, client too old -------------------------------

async function withCat(seed: number) {
  const sim = new SyncSim({ seed });
  const ann = await sim.addClient('ann', { role: 'editor' });
  const cat = await sim.addClient('cat', { role: 'author', editRule: (m) => m.author === 'cat' });
  await ann.connect();
  await cat.connect();
  cat.doc.add(rect('cat-note', { text: 'Fire stopping' }));
  ann.doc.add(rect('ann-note', { text: 'Door swing' }));
  await sim.net.drain();
  return { sim, ann, cat };
}

async function assertLockedOut(cat: SimClient, unsent: string[]): Promise<void> {
  assert.equal(cat.doc.sync.connection, 'revoked');
  assert.equal(cat.doc.readOnly, true);
  assert.equal(cat.doc.all().length, 0, 'cached markups dropped');
  assert.deepEqual(cat.doc.confirmedState().markups, {});
  assert.equal(cat.doc.sync.pendingCount, 0);
  assert.deepEqual(cat.doc.sync.inbox.flatMap((e) => e.ops.map((o) => o.opId)), unsent, 'unsent work kept to export');
  assert.ok(cat.doc.sync.inbox.every((e) => e.reason.code === 'forbidden'));
  cat.doc.add(rect('after', { text: 'Not allowed' }));
  assert.equal(cat.doc.submitOps([]), false);
  assert.equal(cat.doc.sync.pendingCount, 0, 'read-only');
}

test('proof 6: access removed while online', async () => {
  const { sim, ann, cat } = await withCat(61);
  cat.transport.holdNextToServer(1, 50);
  cat.doc.update('cat-note', { text: 'Fire stopping at riser' });
  const unsent = cat.doc.pendingOperations().map((o) => o.opId);
  sim.revoke('cat');
  await sim.net.drain();
  await assertLockedOut(cat, unsent);
  assert.equal(sim.server.state.markups['cat-note']!.content.text, 'Fire stopping', 'the late frame was refused');

  // Stays locked out after a restart.
  await cat.restart();
  await assertLockedOut(cat, unsent);
  const disk = await cat.saved();
  assert.equal(disk?.revoked, true);
  assert.deepEqual(disk?.confirmed.markups, {});

  // Others carry on.
  ann.doc.update('ann-note', { text: 'Door swing reversed' });
  await sim.heal();
  assertHealthy(sim);

  // Access back: a fresh snapshot, the inbox still there to retry.
  sim.restoreAccess('cat');
  await cat.connect();
  assert.equal(cat.doc.readOnly, false);
  assert.equal(cat.doc.get('ann-note')?.text, 'Door swing reversed');
  assert.equal(cat.retryInbox(cat.doc.sync.inbox[0]!.id), true);
  await sim.net.drain();
  assert.equal(sim.server.state.markups['cat-note']!.content.text, 'Fire stopping at riser');
  assertHealthy(sim);
});

test('proof 6: access removed while offline', async () => {
  const { sim, cat } = await withCat(62);
  cat.transport.cut();
  await sim.net.drain();
  cat.doc.update('cat-note', { text: 'Edited on the train' });
  cat.doc.add(rect('cat-2', { text: 'New, offline' }));
  const unsent = cat.doc.pendingOperations().map((o) => o.opId);
  sim.clock.advanceDays(2);
  sim.revoke('cat');
  cat.transport.restore();
  await cat.connect();
  await assertLockedOut(cat, unsent);
  assert.equal(sim.server.state.markups['cat-2'], undefined);
  assertHealthy(sim);
});

test('proof 6: work made offline before a stage closed is refused when it arrives', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben'], 63);
  ann!.doc.add(rect('m1', { text: 'For review' }));
  await sim.net.drain();
  ben!.transport.cut();
  await sim.net.drain();
  ben!.doc.update('m1', { text: 'Late comment' });
  sim.clock.advanceDays(1);
  sim.policy.stageClosed = true;
  ben!.transport.restore();
  await ben!.connect();
  assert.equal(ben!.doc.sync.connection, 'connected', 'still connected and readable');
  assert.deepEqual(ben!.doc.sync.inbox.map((e) => e.reason), [{ code: 'forbidden', message: 'The review stage is closed' }]);
  assert.equal(ben!.doc.get('m1')?.text, 'For review');
  assertHealthy(sim);

  // The coordinator reopens the stage; Ben retries his work as new.
  sim.policy.stageClosed = false;
  assert.equal(ben!.retryInbox(ben!.doc.sync.inbox[0]!.id), true);
  await sim.net.drain();
  assert.equal(ann!.doc.get('m1')?.text, 'Late comment');
  assertHealthy(sim);
});

test('proof 6: a client too old for the server keeps its queue, sends nothing, and syncs once updated', async () => {
  const sim = new SyncSim({ seed: 64, protocol: { min: 2, max: 3 } });
  const old = await sim.addClient('ann', { role: 'editor', protocol: { min: 1, max: 1 } });
  old.doc.add(rect('m1', { text: 'Queued before the update' }));
  const queued = old.doc.pendingOperations().map((o) => o.opId);
  await old.connect();
  assert.equal(old.doc.sync.connection, 'update_required');
  assert.equal(old.doc.sync.lastError, 'client_too_old');
  assert.equal(old.transport.sent.length, 0, 'nothing sent the server cannot read');
  assert.equal(old.transport.state, 'disconnected', 'the server closed the connection');
  assert.deepEqual(old.doc.pendingOperations().map((o) => o.opId), queued);

  await old.restart();
  assert.deepEqual(old.doc.pendingOperations().map((o) => o.opId), queued, 'the queue survives a restart');

  // The server learns to read this client's version again (or the client is updated).
  sim.server.setProtocol({ min: 1, max: 3 });
  await old.connect();
  assert.equal(old.doc.sync.connection, 'connected');
  assert.equal(old.doc.sync.pendingCount, 0);
  assert.deepEqual(sim.acceptedOpIds(), queued);
  assertHealthy(sim);
});

// ---- Regressions found by the fault run ---------------------------------------------------

test('regression: an undo in flight when the connection drops settles on the server answer, and edits based on it are kept', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('m1', { text: 'A' }));
  await sim.net.drain();
  ann!.doc.update('m1', { text: 'B' });
  await sim.net.drain();

  ann!.transport.dropNextAck();
  const undo = ann!.history('undo');
  await sim.net.drain();
  assert.equal(ann!.doc.sync.connection, 'disconnected');
  // Offline, Ann keeps editing on top of the undone text.
  ann!.doc.update('m1', { text: 'C' });
  await ann!.connect();
  assert.deepEqual(await undo, { ok: true }, 'the server had applied it');
  assert.equal(ann!.doc.sync.inbox.length, 0);
  for (const doc of [ann!.doc, ben!.doc]) assert.equal(doc.get('m1')?.text, 'C');
  assertHealthy(sim);
});

test('regression: an undo in flight that becomes stale while offline reports changed, not an inbox entry', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('m1', { text: 'A' }));
  await sim.net.drain();
  ann!.doc.update('m1', { text: 'B' });
  await sim.net.drain();
  ann!.transport.dropNextToServer();
  const undo = ann!.history('undo');
  await sim.net.drain();
  ben!.doc.update('m1', { text: 'Ben' });
  await sim.net.drain();
  await ann!.connect();
  assert.deepEqual(await undo, { ok: false, reason: 'changed' });
  assert.equal(ann!.doc.sync.inbox.length, 0);
  assert.equal(ann!.doc.get('m1')?.text, 'Ben');
  assertHealthy(sim);
});

test('regression: an edit already sent is kept until the server answers, even when a peer change makes it stale locally', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('m1', { text: 'Moving' }));
  await sim.net.drain();

  // Ann's move is slow to reach the server. Ben deletes the markup, then undoes that.
  ann!.transport.holdNextToServer(1, 100);
  ann!.doc.update('m1', { points: [[200, 200], [260, 240]] });
  ben!.doc.remove(['m1']);
  await sim.net.until(() => ann!.doc.get('m1') === undefined && ben!.doc.sync.pendingCount === 0);
  assert.equal(ann!.doc.sync.pendingCount, 1, 'kept although it no longer applies here');
  const restore = ben!.history('undo');
  await sim.net.drain();
  assert.deepEqual(await restore, { ok: true });

  // The move reached the server after the restore and was applied; Ann's copy agrees.
  for (const doc of [ann!.doc, ben!.doc]) assert.deepEqual(doc.get('m1')?.points, [[200, 200], [260, 240]]);
  assert.equal(ann!.doc.sync.inbox.length, 0);
  assertHealthy(sim);
});

test('regression: two people moving one markup to another page at once leave it in one place', async () => {
  const { sim, c: [ann, ben] } = await world(['ann', 'ben']);
  ann!.doc.add(rect('m1', { text: 'Where am I?' }));
  await sim.net.drain();
  ann!.doc.update('m1', { pageIndex: 1, points: [[1, 1], [2, 2]] });
  ben!.doc.update('m1', { pageIndex: 1, points: [[5, 5], [6, 6]] });
  await sim.net.drain();

  const live = Object.values(sim.server.state.placements).filter((p) => p.markupId === 'm1' && !p.deleted);
  assert.equal(live.length, 1);
  assert.deepEqual(live[0]!.geometry.points, [[1, 1], [2, 2]], 'the first to arrive wins');
  assert.deepEqual(ben!.doc.sync.inbox.map((e) => e.reason.code), ['conflict']);
  assertHealthy(sim);
});

test('regression: work the server applied before access was removed leaves the inbox once access returns', async () => {
  const { sim, cat } = await withCat(65);
  cat.transport.dropNextAck();
  cat.doc.update('cat-note', { text: 'Applied, but the ack was lost' });
  await sim.net.drain();
  sim.revoke('cat');
  await cat.connect();
  assert.equal(cat.doc.sync.inbox.length, 1, 'the client cannot know it was applied');

  sim.restoreAccess('cat');
  await cat.connect();
  assert.equal(cat.doc.sync.inbox.length, 0, 'the snapshot shows it was applied');
  assert.equal(cat.doc.get('cat-note')?.text, 'Applied, but the ack was lost');
  assertHealthy(sim);
});
