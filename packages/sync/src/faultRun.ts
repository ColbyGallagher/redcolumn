/**
 * Randomised fault run: one seed drives a random mix of edits, undos, lost, duplicated and
 * reordered frames, broken connections, restarts, crashes, clock jumps, access changes and a
 * modified client, then heals everything and reports what is wrong (nothing, when sync is sound).
 */
import type { Markup, UndoResult } from '@nb/markup';
import { PROTOCOL_VERSION, type Operation } from '@nb/ops';
import { DAY, HOUR, MINUTE, PAGES, SCOPE_ID, STREAM_ID, SyncSim, type FaultConfig, type SimClient } from './faultHarness.ts';

const STYLE = { stroke: '#2e7d32', fill: null, width: 2, opacity: 1 };
const COLOURS = ['#2e7d32', '#1565c0', '#c62828', '#6a1b9a'];
const WORDS = ['Check level', 'Add sleeve', 'Confirm size', 'Move duct', 'See detail 4', 'Clash'];
const COLUMNS = ['trade', 'priority'];

export interface RunResult {
  seed: number;
  problems: string[];
  steps: number;
  accepted: number;
  inbox: number;
  undos: { ok: number; changed: number; other: number; unsettled: number };
}

function noisyFaults(sim: SyncSim): FaultConfig {
  const r = sim.random;
  return {
    dropToServer: r.pick([0, 0.03, 0.1]),
    dropToClient: r.pick([0, 0.03, 0.1]),
    duplicateToServer: r.pick([0, 0.05, 0.2]),
    duplicateToClient: r.pick([0, 0.05, 0.2]),
    reorderToServer: r.pick([0, 0.05, 0.15]),
    leakOnCut: r.pick([0, 0.5, 1]),
    minLatency: 1,
    maxLatency: r.pick([5, 40, 200]),
  };
}

function newMarkup(id: string, sim: SyncSim): Markup {
  const r = sim.random;
  const x = r.int(0, 500);
  const y = r.int(0, 500);
  return {
    id,
    type: 'rect',
    pageIndex: r.int(0, PAGES.length - 1),
    points: [[x, y], [x + r.int(5, 80), y + r.int(5, 80)]],
    style: { ...STYLE },
    status: 'none',
    author: '',
    createdAt: 0,
    modifiedAt: 0,
    text: r.pick(WORDS),
  };
}

function editable(c: SimClient): Markup[] {
  return c.doc.all().filter((m) => c.doc.mayEdit(m));
}

/** One random edit through the normal editing API. */
function randomEdit(sim: SyncSim, c: SimClient, counter: { n: number }): void {
  const r = sim.random;
  const doc = c.doc;
  const targets = editable(c);
  const kind = targets.length
    ? r.weighted([['add', 3], ['text', 3], ['move', 2], ['style', 1], ['field', 2], ['remove', 1], ['batch', 1], ['page', 1]] as const)
    : 'add';
  const target = targets.length ? r.pick(targets) : null;
  switch (kind) {
    case 'add':
      doc.add(newMarkup(`${c.name}-m${++counter.n}`, sim));
      return;
    case 'text':
      doc.update(target!.id, { text: `${r.pick(WORDS)} ${r.int(1, 99)}` });
      return;
    case 'move': {
      const dx = r.int(-20, 20);
      doc.update(target!.id, { points: target!.points.map(([x, y]) => [x + dx, y + 1] as [number, number]) });
      return;
    }
    case 'style':
      doc.update(target!.id, { style: { ...target!.style, stroke: r.pick(COLOURS) } });
      return;
    case 'field':
      doc.setField([target!.id], r.pick(COLUMNS), r.pick(['', 'Electrical', 'High', 'Low']));
      return;
    case 'remove':
      doc.remove([target!.id]);
      return;
    case 'page':
      doc.update(target!.id, { pageIndex: (target!.pageIndex + 1) % PAGES.length });
      return;
    case 'batch':
      doc.batch(() => {
        doc.add(newMarkup(`${c.name}-m${++counter.n}`, sim));
        doc.update(target!.id, { text: `Batch ${r.int(1, 99)}` });
        if (targets.length > 1) {
          const other = r.pick(targets.filter((m) => m.id !== target!.id));
          doc.setField([other.id], 'trade', 'Mechanical');
        }
      });
      return;
  }
}

/**
 * A forged frame from a modified client: must always be refused. An author may create markups, so
 * an author's forged frames only touch other people's work or are malformed.
 */
function hostileFrame(sim: SyncSim, counter: { n: number }, isAuthor: boolean): Operation[] {
  const r = sim.random;
  const markups = Object.values(sim.server.state.markups);
  const placements = Object.values(sim.server.state.placements);
  const id = `forged-${++counter.n}`;
  const base = { schemaVersion: PROTOCOL_VERSION, streamId: STREAM_ID, clientTime: sim.clock.now() };
  const victim = markups.length ? r.pick(markups) : null;
  const kind = r.pick(isAuthor ? (['patch', 'delete', 'move', 'reuse', 'bad'] as const) : (['create', 'patch', 'delete', 'move', 'reuse', 'bad'] as const));
  if (kind === 'reuse' && sim.commits.length) {
    // Someone else's opId with different content.
    const original = r.pick(r.pick(sim.commits).ops) as Operation;
    return [{ ...original, clientTime: sim.clock.now(), payload: { ...(original.payload as object), forged: true } } as unknown as Operation];
  }
  if (kind === 'patch' && victim) {
    return [{ ...base, opId: id, type: 'markup.patch', entityId: victim.id, basedOn: { text: victim.versions.text?.v ?? 0 }, payload: { set: { text: 'Forged' } } }];
  }
  if (kind === 'delete' && victim) return [{ ...base, opId: id, type: 'markup.delete', entityId: victim.id, payload: {} }];
  if (kind === 'move' && placements.length) {
    const p = r.pick(placements);
    return [{ ...base, opId: id, type: 'placement.patch', entityId: p.id, basedOn: { geometry: p.versions.geometry?.v ?? 0 }, payload: { geometry: { points: [[0, 0], [1, 1]] } } }];
  }
  if (kind === 'bad' || isAuthor) {
    return [{ ...base, opId: id, type: 'markup.create', entityId: `${id}-m`, payload: { scopeId: SCOPE_ID, type: 'rect', content: {} } } as unknown as Operation];
  }
  return [{ ...base, opId: id, type: 'markup.create', entityId: `${id}-m`, payload: { scopeId: SCOPE_ID, type: 'rect', content: { style: STYLE, text: 'Forged' } } }];
}

/** Runs one seed and returns what went wrong (an empty `problems` list means sync held up). */
export async function runSeed(seed: number, steps = 40, inspect?: (sim: SyncSim) => void): Promise<RunResult> {
  const sim = new SyncSim({ seed, maxLogLength: 30 });
  const r = sim.random;
  const ann = await sim.addClient('ann', { role: 'editor' });
  const ben = await sim.addClient('ben', { role: 'editor' });
  const cat = await sim.addClient('cat', { role: 'author', editRule: (m) => m.author === 'cat' });
  const clients = [ann, ben, cat];
  const hostileRole = r.pick(['viewer', 'author'] as const);
  const hostile = sim.rawClient('mallory', hostileRole);
  const counters = { ann: { n: 0 }, ben: { n: 0 }, cat: { n: 0 }, hostile: { n: 0 } };
  const undoResults: UndoResult[] = [];
  let unsettled = 0;

  for (const c of clients) await c.doc.connect();
  await sim.net.drain();
  sim.net.faults = noisyFaults(sim);

  for (let step = 0; step < steps; step++) {
    const c = r.pick(clients);
    const action = r.weighted([
      ['edit', 10],
      ['deliver', 8],
      ['undo', 3],
      ['redo', 1],
      ['cut', 1.5],
      ['reconnect', 3],
      ['restart', 1],
      ['crash', 0.7],
      ['clock', 1],
      ['days', 0.4],
      ['faults', 0.7],
      ['access', 0.5],
      ['stage', 0.4],
      ['hostile', 1],
      ['inbox', 0.6],
    ] as const);

    switch (action) {
      case 'edit':
        randomEdit(sim, c, counters[c.name as 'ann']);
        break;
      case 'deliver': {
        const n = r.int(1, 12);
        for (let i = 0; i < n; i++) if (!(await sim.net.step())) break;
        break;
      }
      case 'undo':
      case 'redo': {
        unsettled += 1;
        void c.history(action).then((res) => {
          unsettled -= 1;
          undoResults.push(res);
        });
        break;
      }
      case 'cut':
        c.transport.cut();
        break;
      case 'reconnect':
        c.transport.restore();
        if (c.doc.sync.connection !== 'connected') await c.doc.connect();
        break;
      case 'restart':
        await c.restart();
        break;
      case 'crash':
        await c.restart({ crash: true });
        break;
      case 'clock':
        sim.clock.advance(r.int(1, 90) * MINUTE);
        break;
      case 'days':
        sim.clock.advance(r.int(1, 5) * DAY + r.int(0, 23) * HOUR);
        break;
      case 'faults':
        sim.net.faults = r.chance(0.3) ? { ...sim.net.faults, dropToClient: 0, dropToServer: 0 } : noisyFaults(sim);
        break;
      case 'access':
        if (sim.revoked.has('cat')) sim.restoreAccess('cat');
        else sim.revoke('cat');
        break;
      case 'stage':
        sim.policy.stageClosed = !sim.policy.stageClosed;
        break;
      case 'hostile':
        if (hostile.state !== 'connected') {
          hostile.restore();
          hostile.connect({ streamId: STREAM_ID, cursor: null, protocol: { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION } });
        } else {
          hostile.send(hostileFrame(sim, counters.hostile, hostileRole === 'author'));
        }
        break;
      case 'inbox': {
        // The user deals with a rejected change: retry it as new work, or let it go.
        const entries = c.doc.sync.inbox;
        if (!entries.length) break;
        const entry = r.pick(entries);
        if (r.chance(0.6)) c.retryInbox(entry.id);
        else c.discardInbox(entry.id);
        break;
      }
    }
    await sim.net.step();
  }

  sim.policy.stageClosed = r.chance(0.5) ? false : sim.policy.stageClosed;
  await sim.heal();
  // Settle any undo still waiting on the server.
  await sim.heal();

  inspect?.(sim);
  const problems = sim.problems();
  if (unsettled > 0) problems.push(`${unsettled} undo/redo calls never settled`);
  const hostileAcks = hostile.received.filter((m) => m.type === 'ack').length;
  if (hostileAcks) problems.push(`modified client had ${hostileAcks} forged frames accepted`);
  if (sim.commits.some((e) => e.actor.userId === 'mallory')) problems.push('server log holds an event from the modified client');

  return {
    seed,
    problems,
    steps,
    accepted: sim.acceptedOpIds().length,
    inbox: clients.reduce((n, c) => n + c.doc.sync.inbox.length, 0),
    undos: {
      ok: undoResults.filter((u) => u.ok).length,
      changed: undoResults.filter((u) => !u.ok && u.reason === 'changed').length,
      other: undoResults.filter((u) => !u.ok && u.reason !== 'changed').length,
      unsettled,
    },
  };
}
