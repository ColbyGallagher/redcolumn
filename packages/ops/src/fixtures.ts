// Helpers for this package's tests.
import assert from 'node:assert/strict';
import { applyOp } from './apply.ts';
import type { AnyOperation, OperationOf, OperationType } from './operations.ts';
import { PROTOCOL_VERSION } from './protocol.ts';
import { emptyState, type ApplyContext, type ApplyResult, type OpsState, type Rejection } from './state.ts';
import type { StatusDef } from './entities.ts';

export const STATUSES: StatusDef[] = [
  { id: 'open', name: 'Open', category: 'open' },
  { id: 'answered', name: 'Answered', category: 'open' },
  { id: 'closed', name: 'Closed', category: 'closed' },
  { id: 'void', name: 'Not applicable', category: 'void' },
];

export const ctx = (userId = 'ann', laneId = 'laneA', now = 1000): ApplyContext => ({
  actor: { userId, partyId: 'partyA', groupId: null },
  laneId,
  now,
  statuses: STATUSES,
});

let counter = 0;

/** An operation with a fresh opId (or the one given in `extra`). */
export function op<T extends OperationType>(
  type: T,
  entityId: string,
  payload: OperationOf<T>['payload'],
  extra: Partial<Omit<OperationOf<T>, 'type' | 'entityId' | 'payload'>> = {},
): OperationOf<T> {
  return { opId: `op${++counter}`, schemaVersion: PROTOCOL_VERSION, streamId: 'doc1', type, entityId, payload, ...extra } as OperationOf<T>;
}

export const STYLE = { stroke: '#ff0000', fill: null, width: 1, opacity: 1 };

/** Applies operations in order, failing the test if one is rejected. */
export function applyAll(state: OpsState, ops: AnyOperation[], context: ApplyContext = ctx()): OpsState {
  for (const o of ops) {
    const result = applyOp(state, o, context);
    assert.ok(result.ok, `${o.type} ${o.entityId} was rejected: ${JSON.stringify(!result.ok && result.rejection)}`);
    state = result.state;
  }
  return state;
}

/** The rejection, failing the test if the result was accepted. */
export function rejected(result: ApplyResult): Rejection {
  assert.equal(result.ok, false, 'expected a rejection');
  return (result as { rejection: Rejection }).rejection;
}

/** A document with one markup `m1` (text "hello") and its placement `p1`. */
export function withMarkup(): { state: OpsState; createOp: string; placeOp: string } {
  const create = op('markup.create', 'm1', { scopeId: 'review1', type: 'rect', content: { style: STYLE, text: 'hello' } });
  const place = op('placement.create', 'p1', {
    markupId: 'm1',
    revisionId: 'revA',
    pageId: 'page1',
    geometry: { points: [[0, 0], [10, 10]] },
    method: 'original',
    confidence: null,
    state: 'confirmed',
  });
  return { state: applyAll(emptyState(), [create, place]), createOp: create.opId, placeOp: place.opId };
}

/** A project with one issue `i1`, open in lane A. */
export function withIssue(state: OpsState = emptyState()): OpsState {
  return applyAll(state, [op('issue.create', 'i1', { scopeId: 'review1', title: 'Door width', status: 'open', markupIds: ['m1'] })]);
}
