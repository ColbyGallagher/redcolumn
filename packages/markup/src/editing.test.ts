import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MarkupStatusDef } from './columns.ts';
import { planAdd, planFollowConnectors, planRemove, planUpdate } from './editing.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';
import { ownMarkupsOnly } from './ownership.ts';

function markup(id: string, type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return {
    id,
    type,
    pageIndex: 0,
    points,
    style: { ...DEFAULT_STYLES[type] },
    status: 'none',
    author: 'Nadia',
    createdAt: 10,
    modifiedAt: 10,
    ...extra,
  };
}

const rect = (id: string, x = 0, y = 0, extra: Partial<Markup> = {}) =>
  markup(id, 'rect', [[x, y], [x + 20, y + 20]], extra);

const shape = (id: string, x: number, y: number, extra: Partial<Markup> = {}) =>
  markup(id, 'flowShape', [[x, y], [x + 100, y + 50]], { flowShape: 'process', ...extra });

const mapOf = (list: readonly Markup[]) => new Map(list.map((m) => [m.id, m]));

// ---- planAdd ------------------------------------------------------------------------------

test('planAdd assigns the next sequence number, strips undefined fields and drops status history on none copies', () => {
  const existing = mapOf([rect('m1', 0, 0, { seq: 2 })]);
  const incoming: Markup = {
    ...rect('m2', 30, 0),
    comment: undefined,
    status: 'none',
    statusHistory: [{ state: 'Accepted', model: 'Review', author: 'Owen', at: 5 }],
  };
  const plan = planAdd(existing, incoming, { lastSeq: 4 });
  assert.equal(plan.nextSeq, 5);
  assert.equal(plan.put.length, 1);
  assert.deepEqual(plan.remove, []);
  const placed = plan.put[0]!;
  assert.equal(placed.seq, 5);
  assert.equal(plan.added, placed);
  assert.equal('comment' in placed, false);
  assert.equal('statusHistory' in placed, false);
  // Input is not mutated.
  assert.equal(incoming.seq, undefined);
  assert.equal(incoming.statusHistory?.length, 1);
});

test('planAdd uses the highest sequence number across both lastSeq and existing markups', () => {
  const existing = mapOf([rect('m1', 0, 0, { seq: 7 })]);
  const plan = planAdd(existing, rect('m2', 20, 0), { lastSeq: 3 });
  assert.equal(plan.nextSeq, 8);
  assert.equal(plan.put[0]!.seq, 8);
});

test('planAdd replacing an existing markup keeps its seq and statusHistory and reports added as null', () => {
  const history = [{ state: 'Accepted', model: 'Review', author: 'Tariq', at: 5 }];
  const existing = mapOf([rect('m1', 0, 0, { seq: 3 })]);
  const replacement = rect('m1', 10, 10, { status: 'none', statusHistory: history });
  const plan = planAdd(existing, replacement, { lastSeq: 9 });
  assert.equal(plan.added, null);
  assert.equal(plan.nextSeq, undefined);
  assert.equal(plan.put.length, 1);
  assert.equal(plan.put[0]!.seq, 3);
  assert.deepEqual(plan.put[0]!.statusHistory, history);
});

test('planAdd routes a new connector to its glued shapes and re-routes glued connectors when a shape is placed', () => {
  const a = shape('a', 0, 0);
  const b = shape('b', 0, 150);
  const conn = markup('c', 'connector', [[0, 0], [1, 1]], { connect: { from: { id: 'a' }, to: { id: 'b' } } });

  // Adding a connector even with hasConnectors: false routes the connector itself.
  const addedConn = planAdd(mapOf([a, b]), conn, { hasConnectors: false });
  assert.equal(addedConn.put.length, 1);
  assert.deepEqual(addedConn.put[0]!.points, [[50, 50], [50, 150]]);
  assert.deepEqual(addedConn.added!.points, [[50, 50], [50, 150]]);

  // Adding a shape that an existing connector already references re-routes the connector.
  const placedConn = addedConn.put[0]!;
  const readded = planAdd(mapOf([a, placedConn]), shape('b', 0, 260));
  assert.deepEqual(readded.put.map((m) => m.id), ['b', 'c']);
  assert.deepEqual(readded.put[1]!.points, [[50, 50], [50, 260]]);
});

// ---- planUpdate: status history -----------------------------------------------------------

test('planUpdate appends status history on status change using actor, clock and status definitions', () => {
  const customStatuses: MarkupStatusDef[] = [
    { id: 'none', name: 'None', color: '#999' },
    { id: 'open-review', name: '1.0 Open', color: '#f59e0b', model: 'BSI_CUSTOM' },
  ];
  const m = rect('m1', 0, 0, { status: 'none' });

  const plan = planUpdate(mapOf([m]), 'm1', { status: 'open-review' }, { actor: 'Priya', now: 1234, statuses: customStatuses });
  assert.equal(plan.put.length, 1);
  const next = plan.put[0]!;
  assert.equal(next.status, 'open-review');
  assert.equal(next.modifiedAt, 1234);
  assert.deepEqual(next.statusHistory, [{ state: '1.0 Open', model: 'BSI_CUSTOM', author: 'Priya', at: 1234 }]);
  // Original markup is not mutated.
  assert.equal(m.statusHistory, undefined);

  // Returning to 'none' uses the 'None' label and default Review model when not in custom list.
  const back = planUpdate(mapOf([next]), 'm1', { status: 'none' }, { actor: 'Owen', now: 2000, statuses: [] });
  assert.deepEqual(back.put[0]!.statusHistory, [
    { state: '1.0 Open', model: 'BSI_CUSTOM', author: 'Priya', at: 1234 },
    { state: 'None', model: 'Review', author: 'Owen', at: 2000 },
  ]);

  // Unknown status id falls back to the id itself with Review model.
  const unknown = planUpdate(mapOf([m]), 'm1', { status: 'hold' }, { actor: 'Priya', now: 3000, statuses: customStatuses });
  assert.deepEqual(unknown.put[0]!.statusHistory, [{ state: 'hold', model: 'Review', author: 'Priya', at: 3000 }]);
});

test('planUpdate does not append status history when status is unchanged or statusHistory is explicitly patched', () => {
  const existingHistory = [{ state: 'Accepted', model: 'Review', author: 'Nadia', at: 100 }];
  const m = rect('m1', 0, 0, { status: 'accepted', statusHistory: existingHistory });

  // Same status: no new entry.
  const same = planUpdate(mapOf([m]), 'm1', { status: 'accepted' }, { actor: 'Priya', now: 200 });
  assert.deepEqual(same.put[0]!.statusHistory, existingHistory);

  // Unrelated field edit: no new entry.
  const comment = planUpdate(mapOf([m]), 'm1', { comment: 'checked' }, { actor: 'Priya', now: 200 });
  assert.deepEqual(comment.put[0]!.statusHistory, existingHistory);

  // Explicit statusHistory in patch (including clearing it to undefined) overrides auto-append.
  const explicit = planUpdate(mapOf([m]), 'm1', { status: 'rejected', statusHistory: undefined }, { actor: 'Priya', now: 300 });
  assert.equal('statusHistory' in explicit.put[0]!, false);
});

// ---- planUpdate: assembly reset -----------------------------------------------------------

test('planUpdate resets assembly overrides, takeoff approval and inputs when assemblyId changes', () => {
  const m = markup('w1', 'length', [[0, 0], [50, 0]], {
    assemblyId: 'wall-a',
    assemblyOverrides: { studs: 12 },
    assemblyInputs: { height: 3 },
    takeoffApproval: { by: 'Mira', at: 50, proposalId: 'p1', source: 'AI' },
  });

  // Other edit or same assembly keeps overrides, approval and inputs.
  const same = planUpdate(mapOf([m]), 'w1', { assemblyId: 'wall-a', comment: 'ok' }, { actor: 'Nadia', now: 100 });
  assert.deepEqual(same.put[0]!.assemblyOverrides, { studs: 12 });
  assert.deepEqual(same.put[0]!.assemblyInputs, { height: 3 });
  assert.deepEqual(same.put[0]!.takeoffApproval, m.takeoffApproval);

  // Switching assembly clears all three.
  const changed = planUpdate(mapOf([m]), 'w1', { assemblyId: 'slab-b' }, { actor: 'Nadia', now: 200 });
  assert.equal('assemblyOverrides' in changed.put[0]!, false);
  assert.equal('assemblyInputs' in changed.put[0]!, false);
  assert.equal('takeoffApproval' in changed.put[0]!, false);

  // Explicitly providing new overrides/inputs in the same patch keeps them (and keeps takeoffApproval when overrides were explicit).
  const supplied = planUpdate(
    mapOf([m]),
    'w1',
    { assemblyId: 'slab-b', assemblyOverrides: { mesh: 4 }, assemblyInputs: { depth: 0.2 } },
    { actor: 'Nadia', now: 300 },
  );
  assert.deepEqual(supplied.put[0]!.assemblyOverrides, { mesh: 4 });
  assert.deepEqual(supplied.put[0]!.assemblyInputs, { depth: 0.2 });
  assert.deepEqual(supplied.put[0]!.takeoffApproval, m.takeoffApproval);
});

// ---- planUpdate: span shifting ------------------------------------------------------------

test('planUpdate shifts text spans when text changes without an explicit spans patch', () => {
  const m = markup('t1', 'text', [[0, 0], [100, 30]], {
    text: 'hello world',
    spans: [{ start: 6, end: 11, style: { bold: true } }],
  });

  const inserted = planUpdate(mapOf([m]), 't1', { text: 'oh hello world' }, { actor: 'Nadia', now: 100 });
  assert.deepEqual(inserted.put[0]!.spans, [{ start: 9, end: 14, style: { bold: true } }]);

  // Deleting the styled range drops spans altogether.
  const deleted = planUpdate(mapOf([m]), 't1', { text: 'hello ' }, { actor: 'Nadia', now: 200 });
  assert.equal('spans' in deleted.put[0]!, false);

  // Explicit spans in patch are kept verbatim.
  const explicitSpans = [{ start: 0, end: 2, style: { italic: true } }];
  const explicit = planUpdate(mapOf([m]), 't1', { text: 'oh hello world', spans: explicitSpans }, { actor: 'Nadia', now: 300 });
  assert.deepEqual(explicit.put[0]!.spans, explicitSpans);
});

// ---- planUpdate: connector rerouting & permissions ----------------------------------------

test('planUpdate re-routes glued connectors when a shape moves, rotates or changes page, respecting mayEdit', () => {
  const a = shape('a', 0, 0);
  const b = shape('b', 0, 150);
  const cMine = markup('c1', 'connector', [[50, 50], [50, 150]], { author: 'Nadia', connect: { from: { id: 'a' }, to: { id: 'b' } } });
  const cTheirs = markup('c2', 'connector', [[50, 50], [50, 150]], { author: 'Tariq', connect: { from: { id: 'a' }, to: { id: 'b' } } });
  const state = mapOf([a, b, cMine, cTheirs]);

  // Moving b re-routes editable connectors and skips uneditable ones.
  const moved = planUpdate(state, 'b', { points: [[0, 260], [100, 310]] }, { actor: 'Nadia', now: 100, mayEdit: ownMarkupsOnly('Nadia') });
  assert.deepEqual(moved.put.map((m) => m.id), ['b', 'c1']);
  assert.deepEqual(moved.put[1]!.points, [[50, 50], [50, 260]]);

  // Non-geometry edit does not reroute connectors.
  const commented = planUpdate(state, 'b', { comment: 'note' }, { actor: 'Nadia', now: 200 });
  assert.deepEqual(commented.put.map((m) => m.id), ['b']);

  // Updating a connector's own connect link re-routes it in place (single put entry).
  const straight = planUpdate(state, 'c1', { connect: { from: { id: 'a', side: 'right' }, to: { id: 'b', side: 'left' }, route: 'straight' } }, { actor: 'Nadia', now: 300 });
  assert.deepEqual(straight.put.map((m) => m.id), ['c1']);
  assert.deepEqual(straight.put[0]!.points, [[100, 25], [0, 175]]);
});

test('planUpdate enforces mayEdit on someone else’s markup and ignores missing markups', () => {
  const theirs = shape('b', 0, 150, { author: 'Tariq', status: 'none' });
  const conn = markup('c1', 'connector', [[50, 50], [50, 150]], { author: 'Nadia', connect: { to: { id: 'b' } } });
  const state = mapOf([theirs, conn]);
  const rule = ownMarkupsOnly('Nadia');

  // Missing id -> empty plan.
  assert.deepEqual(planUpdate(state, 'missing', { comment: 'x' }, { actor: 'Nadia', now: 100 }), { put: [], remove: [] });

  // Disallowed fields only -> empty plan.
  assert.deepEqual(planUpdate(state, 'b', { points: [[0, 300], [100, 350]], comment: 'nope' }, { actor: 'Nadia', now: 100, mayEdit: rule }), { put: [], remove: [] });

  // Mixed patch -> only open fields apply, status history records actor/now, and connector is not rerouted.
  const mixed = planUpdate(state, 'b', { status: 'accepted', points: [[0, 300], [100, 350]] }, { actor: 'Nadia', now: 500, mayEdit: rule });
  assert.deepEqual(mixed.put.map((m) => m.id), ['b']);
  assert.equal(mixed.put[0]!.status, 'accepted');
  assert.deepEqual(mixed.put[0]!.points, theirs.points);
  assert.deepEqual(mixed.put[0]!.statusHistory, [{ state: 'Accepted', model: 'Review', author: 'Nadia', at: 500 }]);
});

// ---- planRemove ---------------------------------------------------------------------------

test('planRemove deletes existing editable ids without cascading to glued connectors or group peers', () => {
  const a = shape('a', 0, 0, { author: 'Nadia', groupId: 'g1' });
  const b = shape('b', 0, 150, { author: 'Nadia', groupId: 'g1' });
  const c = markup('c', 'connector', [[50, 50], [50, 150]], { author: 'Nadia', connect: { from: { id: 'a' }, to: { id: 'b' } } });
  const theirs = rect('t', 40, 40, { author: 'Tariq' });
  const state = mapOf([a, b, c, theirs]);

  const plan = planRemove(state, ['b', 'b', 'missing', 't'], { mayEdit: ownMarkupsOnly('Nadia') });
  assert.deepEqual(plan, { put: [], remove: ['b'] });
});

// ---- planFollowConnectors -----------------------------------------------------------------

test('planFollowConnectors re-routes connectors glued to any changed shape and skips unchanged ones', () => {
  const a = shape('a', 0, 0);
  const b = shape('b', 0, 240);
  const c = markup('c', 'connector', [[50, 50], [50, 150]], { connect: { from: { id: 'a' }, to: { id: 'b' } } });
  const already = markup('c2', 'connector', [[50, 50], [50, 240]], { connect: { from: { id: 'a' }, to: { id: 'b' } } });
  const state = mapOf([a, b, c, already]);

  const rerouted = planFollowConnectors(state, new Set(['b']));
  assert.deepEqual(rerouted.map((m) => m.id), ['c']);
  assert.deepEqual(rerouted[0]!.points, [[50, 50], [50, 240]]);
  // Input connector is not mutated.
  assert.deepEqual(c.points, [[50, 50], [50, 150]]);
});
