import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineSupervisor, RESTART_WINDOW_MS, type RestartReport, type SupervisedEngine } from './engineSupervisor.ts';

interface Doc {
  name: string;
  open: boolean;
}

class FakeEngine implements SupervisedEngine<Doc> {
  openDocuments: Doc[];
  restarts = 0;
  abandoned: Doc[] = [];
  reopenFails = new Set<string>();
  private listeners = new Set<(err: Error) => void>();
  /** Runs inside reopen, to simulate the new worker dying part way. */
  onReopen: ((doc: Doc) => void) | null = null;
  constructor(docs: Doc[]) {
    this.openDocuments = docs;
  }
  onFailure(l: (err: Error) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  restart() {
    this.restarts++;
    for (const d of this.openDocuments) d.open = false;
    return true;
  }
  async reopen(doc: Doc) {
    this.onReopen?.(doc);
    if (this.reopenFails.has(doc.name)) throw new Error('boom');
    doc.open = true;
  }
  abandon(doc: Doc) {
    this.abandoned.push(doc);
    this.openDocuments = this.openDocuments.filter((d) => d !== doc);
  }
  die(message = 'worker error') {
    for (const l of [...this.listeners]) l(new Error(message));
  }
}

function setup(names: string[], missing: string[] = []) {
  const docs = names.map((name) => ({ name, open: true }));
  const engine = new FakeEngine(docs);
  let clock = 1000;
  const restarted: RestartReport[] = [];
  const gaveUp: Error[] = [];
  const logs: { message: string; detail: Record<string, unknown> }[] = [];
  const supervisor = new EngineSupervisor(engine, {
    bytesFor: async (d) => (missing.includes(d.name) ? null : new ArrayBuffer(10)),
    sizeOf: () => 100,
    onRestarted: (r) => restarted.push(r),
    onGaveUp: (e) => gaveUp.push(e),
    log: (message, detail) => logs.push({ message, detail }),
    now: () => clock,
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { docs, engine, supervisor, restarted, gaveUp, logs, settle, advance: (ms: number) => (clock += ms) };
}

test('a failure restarts the engine and reopens every document', async () => {
  const t = setup(['a.pdf', 'b.pdf']);
  t.engine.die('out of memory');
  await t.settle();
  assert.equal(t.engine.restarts, 1);
  assert.deepEqual(t.docs.map((d) => d.open), [true, true]);
  assert.deepEqual(t.restarted, [{ reopened: 2, lost: 0 }]);
  assert.equal(t.gaveUp.length, 0);
});

test('the failure is logged with its cause and the open documents', async () => {
  const t = setup(['a.pdf', 'b.pdf']);
  t.engine.die('out of memory');
  await t.settle();
  assert.equal(t.logs[0]!.message, 'PDF engine failed');
  assert.equal(t.logs[0]!.detail.cause, 'out of memory');
  assert.equal(t.logs[0]!.detail.openDocuments, 2);
  assert.equal(t.logs[0]!.detail.totalBytes, 200);
});

test('a document with no stored copy, or that will not reopen, is given up and counted as lost', async () => {
  const t = setup(['a.pdf', 'b.pdf', 'c.pdf'], ['b.pdf']);
  t.engine.reopenFails.add('c.pdf');
  t.engine.die();
  await t.settle();
  assert.deepEqual(t.restarted, [{ reopened: 1, lost: 2 }]);
  assert.deepEqual(t.engine.abandoned.map((d) => d.name), ['b.pdf', 'c.pdf']);
});

test('a second failure soon after a restart is not restarted again', async () => {
  const t = setup(['a.pdf']);
  t.engine.die();
  await t.settle();
  t.advance(RESTART_WINDOW_MS - 1);
  t.engine.die('again');
  await t.settle();
  assert.equal(t.engine.restarts, 1);
  assert.equal(t.gaveUp.length, 1);
  assert.equal(t.supervisor.needsRetry, true);
});

test('a failure long after a restart is restarted again', async () => {
  const t = setup(['a.pdf']);
  t.engine.die();
  await t.settle();
  t.advance(RESTART_WINDOW_MS + 1);
  t.engine.die();
  await t.settle();
  assert.equal(t.engine.restarts, 2);
  assert.equal(t.gaveUp.length, 0);
});

test('the engine dying while documents reopen stops the restart without reporting success', async () => {
  const t = setup(['a.pdf', 'b.pdf']);
  t.engine.onReopen = () => {
    t.engine.onReopen = null;
    t.engine.die('died again');
    throw new Error('rejected by dead engine');
  };
  t.engine.die();
  await t.settle();
  assert.equal(t.restarted.length, 0);
  assert.equal(t.gaveUp.length, 1);
  assert.equal(t.engine.abandoned.length, 0);
});

test('retry restarts even inside the window and clears the stuck state', async () => {
  const t = setup(['a.pdf']);
  t.engine.die();
  await t.settle();
  t.engine.die();
  await t.settle();
  assert.equal(t.supervisor.needsRetry, true);
  const report = await t.supervisor.retry();
  assert.deepEqual(report, { reopened: 1, lost: 0 });
  assert.equal(t.supervisor.needsRetry, false);
  assert.equal(t.engine.restarts, 2);
});

test('a disposed supervisor ignores failures', async () => {
  const t = setup(['a.pdf']);
  t.supervisor.dispose();
  t.engine.die();
  await t.settle();
  assert.equal(t.engine.restarts, 0);
});
