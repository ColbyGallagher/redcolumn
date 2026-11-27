import type { ItemKind } from './entities.ts';
import { reduceIssue } from './issue.ts';
import { reduceMarkup } from './markup.ts';
import type { AnyOperation } from './operations.ts';
import { reducePlacement } from './placement.ts';
import { reduceRelease } from './release.ts';
import { reduceResponse } from './response.ts';
import { invalid, type ApplyContext, type ApplyResult, type Change, type OpsState, type RecordKind, type Rejection } from './state.ts';
import { reduceStatus } from './status.ts';

/**
 * Applies one operation: a new state and what changed, or why it was rejected. Pure: the same
 * state, operation and context always give the same result, and the inputs are never changed.
 * The operation is taken as already valid in shape (see `parseOperation`); permission is not checked.
 */
export function applyOp(state: OpsState, op: AnyOperation, ctx: ApplyContext): ApplyResult {
  switch (op.type) {
    case 'markup.create':
    case 'markup.patch':
    case 'markup.delete':
    case 'markup.restore':
      return reduceMarkup(state, op, ctx);
    case 'placement.create':
    case 'placement.patch':
    case 'placement.delete':
    case 'placement.restore':
      return reducePlacement(state, op, ctx);
    case 'issue.create':
    case 'issue.patch':
    case 'issue.link':
    case 'issue.unlink':
    case 'issue.delete':
    case 'issue.restore':
    case 'issue.number':
      return reduceIssue(state, op, ctx);
    case 'response.create':
    case 'response.patch':
    case 'response.delete':
    case 'response.restore':
      return reduceResponse(state, op, ctx);
    case 'status.transition':
      return reduceStatus(state, op, ctx);
    case 'release.create':
      return reduceRelease(state, op, ctx);
    default:
      return invalid(`Unknown operation "${(op as { type: string }).type}"`);
  }
}

/** The most operations one batch may hold. Larger imports are split into several batches. */
export const MAX_BATCH_SIZE = 1000;

export type BatchResult =
  | { ok: true; state: OpsState; changes: Change[] }
  | { ok: false; rejection: Rejection; /** Which operation was rejected. */ index: number };

/**
 * Applies a batch (a paste, a group move, an import) all or nothing: every operation in order, or
 * none if any is rejected. A batch is in one stream, shares one `batchId`, and says its size.
 */
export function applyBatch(state: OpsState, ops: readonly AnyOperation[], ctx: ApplyContext): BatchResult {
  const first = ops[0];
  const fail = (message: string, index = 0): BatchResult => ({ ok: false, rejection: { code: 'invalid', message }, index });
  if (!first) return fail('The batch is empty');
  if (ops.length > MAX_BATCH_SIZE) return fail(`A batch holds at most ${MAX_BATCH_SIZE} operations`);
  let next = state;
  const changes = new Map<string, Change>();
  const seen = new Set<string>();
  for (const [index, op] of ops.entries()) {
    if (op.batchId === undefined || op.batchId !== first.batchId) return fail('Every operation in a batch has its batchId', index);
    if (op.batchSize !== ops.length) return fail('The batch size does not match', index);
    if (op.streamId !== first.streamId) return fail('A batch is in one stream', index);
    if (seen.has(op.opId)) return fail('Duplicate opId in batch', index);
    seen.add(op.opId);
  }
  for (const [index, op] of ops.entries()) {
    const result = applyOp(next, op, ctx);
    if (!result.ok) return { ok: false, rejection: result.rejection, index };
    next = result.state;
    for (const c of result.changes) changes.set(`${c.kind}:${c.id}`, c);
  }
  return { ok: true, state: next, changes: [...changes.values()] };
}

/** The kind of record each operation makes or changes. */
export function kindOf(op: AnyOperation): RecordKind {
  if (op.type === 'status.transition') return 'statusEvent';
  if (op.type === 'release.create') return 'release';
  return op.type.slice(0, op.type.indexOf('.')) as ItemKind;
}

/**
 * The records an operation reads: what a server loads into the state it passes to `applyOp`. The
 * first is the record the operation makes or changes (to see whether it exists). Lane statuses are
 * keyed by issue id. Records found through these need a second look: a placement edit reads its
 * placement's markup, and a released status change its issue's lane statuses.
 */
export function dependencies(op: AnyOperation): { kind: RecordKind | 'laneStatus'; id: string }[] {
  const self = { kind: kindOf(op), id: op.entityId };
  switch (op.type) {
    case 'placement.create':
      return [self, { kind: 'markup', id: op.payload.markupId }];
    case 'response.create':
      return [self, { kind: op.payload.parent.kind, id: op.payload.parent.id }, ...(op.payload.inReplyTo ? [{ kind: 'response' as const, id: op.payload.inReplyTo }] : [])];
    case 'status.transition':
      return [self, { kind: 'issue', id: op.payload.issueId }, { kind: 'laneStatus', id: op.payload.issueId }];
    case 'release.create':
      return [self, ...op.payload.items.map((i) => ({ kind: i.kind, id: i.id }))];
    default:
      return [self];
  }
}
