import {
  applyBatch,
  applyOp,
  columnGroupKey,
  contentGroupKey,
  own,
  versionOf,
  type ApplyContext,
  type ContentKey,
  type Operation,
  type OpsState,
  type VersionedRecord,
} from '@nb/ops';
import type { InboxEntry } from './types.ts';

/**
 * Splits a pending queue into atomic submission units: consecutive operations sharing a `batchId`
 * stay together as one unit, while standalone operations become single-element units.
 */
export function groupPendingUnits(pending: readonly Operation[]): Operation[][] {
  const units: Operation[][] = [];
  let i = 0;
  while (i < pending.length) {
    const op = pending[i]!;
    if (op.batchId === undefined) {
      units.push([op]);
      i += 1;
      continue;
    }
    const batch: Operation[] = [op];
    let j = i + 1;
    while (j < pending.length && pending[j]!.batchId === op.batchId) {
      batch.push(pending[j]!);
      j += 1;
    }
    units.push(batch);
    i = j;
  }
  return units;
}

/**
 * Returns the `basedOn` value for `group`: the numeric confirmed version when the optimistic view
 * matches confirmed state for that group, or the pending `opId` when chaining onto an earlier
 * local operation that has not yet been acknowledged.
 */
export function baseForGroup(
  confirmedRecord: VersionedRecord | undefined,
  viewRecord: VersionedRecord,
  group: string,
): number | string {
  const viewVer = versionOf(viewRecord, group);
  if (!confirmedRecord) return viewVer.op;
  const confVer = versionOf(confirmedRecord, group);
  return confVer.op === viewVer.op ? confVer.v : viewVer.op;
}

/**
 * Checks whether any operation in `unit` depends on an operation that was rejected earlier in this
 * queue (via `basedOn` referencing a rejected `opId`, or creating a placement/response for a
 * record whose creation was rejected).
 */
export function findRejectedDependency(
  unit: readonly Operation[],
  rejectedOpIds: ReadonlySet<string>,
  rejectedCreatedMarkups: ReadonlySet<string>,
  state: OpsState,
): string | null {
  if (!rejectedOpIds.size && !rejectedCreatedMarkups.size) return null;
  for (const op of unit) {
    if (op.basedOn) {
      for (const base of Object.values(op.basedOn)) {
        if (typeof base === 'string' && rejectedOpIds.has(base)) return base;
      }
    }
    if (
      op.type === 'placement.create' &&
      rejectedCreatedMarkups.has(op.payload.markupId) &&
      !own(state.markups, op.payload.markupId)
    ) {
      return op.payload.markupId;
    }
  }
  return null;
}

export interface RebaseInput {
  confirmed: OpsState;
  pending: readonly Operation[];
  ctx: ApplyContext;
  now: number;
  labelOf: (ops: readonly Operation[]) => string;
  /** OpIds already known to have been rejected before this rebase pass (cascades dependents). */
  previouslyRejected?: ReadonlySet<string>;
  /**
   * OpIds sent on the current connection and not yet answered. A unit holding one is never
   * rejected locally for failing to apply: it stays in `kept` (left out of the view) until the
   * server's answer arrives, and so does a later unit that fails only because it is based on such
   * a held unit. A unit depending on a rejected operation is still rejected.
   */
  awaitingServer?: ReadonlySet<string>;
}

export interface RebaseOutput {
  viewState: OpsState;
  kept: Operation[];
  rejected: InboxEntry[];
  rejectedOpIds: Set<string>;
}

/**
 * Re-applies the pending queue on top of `confirmed` using `@nb/ops` reducers.
 *
 * Conflict policy:
 * - Edits to different field groups of the same record both succeed cleanly.
 * - A pending operation (or atomic batch) whose base group version is now stale, or whose target
 *   was deleted/removed, is moved to the rejected inbox rather than silently overwritten.
 * - Any subsequent pending operation that depends on a rejected operation (via `basedOn` opId)
 *   is moved to the inbox alongside it with `dependency_rejected`.
 * - An operation awaiting the server's answer (see `awaitingServer`) is kept, not rejected.
 */
export function rebasePending(input: RebaseInput): RebaseOutput {
  const { confirmed, pending, ctx, now, labelOf } = input;
  let state = confirmed;
  const kept: Operation[] = [];
  const rejected: InboxEntry[] = [];
  const rejectedOpIds = new Set<string>(input.previouslyRejected);
  const rejectedCreatedMarkups = new Set<string>();
  // Kept although they do not apply here, waiting on the server (see `awaitingServer`).
  const heldOpIds = new Set<string>();
  const heldCreatedMarkups = new Set<string>();

  for (const unit of groupPendingUnits(pending)) {
    const dep = findRejectedDependency(unit, rejectedOpIds, rejectedCreatedMarkups, state);
    if (dep !== null) {
      for (const op of unit) {
        rejectedOpIds.add(op.opId);
        if (op.type === 'markup.create') rejectedCreatedMarkups.add(op.entityId);
      }
      rejected.push({
        id: unit[0]!.batchId ?? unit[0]!.opId,
        ops: unit,
        reason: { code: 'dependency_rejected', dependsOnOpId: dep },
        rejectedAt: now,
        label: labelOf(unit),
      });
      continue;
    }

    const res = unit.length === 1 && unit[0]!.batchId === undefined ? applyOp(state, unit[0]!, ctx) : applyBatch(state, unit, ctx);
    if (res.ok) {
      state = res.state;
      kept.push(...unit);
      continue;
    }
    const awaiting = input.awaitingServer;
    if (
      (awaiting && unit.some((op) => awaiting.has(op.opId))) ||
      findRejectedDependency(unit, heldOpIds, heldCreatedMarkups, state) !== null
    ) {
      // Already sent: only the server can say whether it applies. It no longer applies here (say a
      // peer deleted its target), but by the time it reaches the server that may have changed
      // again (the target restored). Keep it queued, out of the view, until the server answers;
      // likewise the edits based on it, which stand or fall with it.
      for (const op of unit) {
        heldOpIds.add(op.opId);
        if (op.type === 'markup.create') heldCreatedMarkups.add(op.entityId);
      }
      kept.push(...unit);
      continue;
    }
    for (const op of unit) {
      rejectedOpIds.add(op.opId);
      if (op.type === 'markup.create') rejectedCreatedMarkups.add(op.entityId);
    }
    rejected.push({
      id: unit[0]!.batchId ?? unit[0]!.opId,
      ops: unit,
      reason: res.rejection,
      rejectedAt: now,
      label: labelOf(unit),
    });
  }

  return { viewState: state, kept, rejected, rejectedOpIds };
}

/**
 * Rebuilds rejected operation(s) from the inbox as fresh operation(s) with new `opId`(s) and
 * updated `basedOn` versions from the current optimistic state so the user can retry their work.
 * Returns `null` if any target record is missing or deleted and cannot accept the patch.
 */
export function buildRetryOps(
  ops: readonly Operation[],
  confirmed: OpsState,
  viewState: OpsState,
  newId: () => string,
  now: number,
): Operation[] | null {
  if (!ops.length) return null;
  const batchId = ops.length > 1 ? newId() : undefined;
  const fresh: Operation[] = [];
  const opIdMap = new Map<string, string>();

  for (const op of ops) {
    const opId = newId();
    opIdMap.set(op.opId, opId);
    const cloned = structuredClone(op);
    cloned.opId = opId;
    cloned.clientTime = now;
    if (batchId !== undefined) {
      cloned.batchId = batchId;
      cloned.batchSize = ops.length;
    } else {
      delete cloned.batchId;
      delete cloned.batchSize;
    }

    if (cloned.type === 'markup.patch') {
      const viewRec = own(viewState.markups, cloned.entityId);
      if (!viewRec || viewRec.deleted) return null;
      const confRec = own(confirmed.markups, cloned.entityId);
      const basedOn: Record<string, number | string> = {};
      for (const k of Object.keys(cloned.payload.set ?? {})) {
        const g = contentGroupKey(k as Exclude<ContentKey, 'fields'>);
        basedOn[g] = baseForGroup(confRec, viewRec, g);
      }
      for (const col of Object.keys(cloned.payload.fields ?? {})) {
        const g = columnGroupKey(col);
        basedOn[g] = baseForGroup(confRec, viewRec, g);
      }
      cloned.basedOn = basedOn;
    } else if (cloned.type === 'placement.patch') {
      const viewRec = own(viewState.placements, cloned.entityId);
      if (!viewRec || viewRec.deleted) return null;
      const confRec = own(confirmed.placements, cloned.entityId);
      const basedOn: Record<string, number | string> = {};
      if (cloned.payload.geometry && Object.keys(cloned.payload.geometry).length) {
        basedOn.geometry = baseForGroup(confRec, viewRec, 'geometry');
      }
      if (cloned.payload.placed && Object.values(cloned.payload.placed).some((v) => v !== undefined)) {
        basedOn.state = baseForGroup(confRec, viewRec, 'state');
      }
      cloned.basedOn = basedOn;
    } else if (cloned.type === 'response.patch') {
      const viewRec = own(viewState.responses, cloned.entityId);
      if (!viewRec || viewRec.deleted) return null;
      const confRec = own(confirmed.responses, cloned.entityId);
      cloned.basedOn = { body: baseForGroup(confRec, viewRec, 'body') };
    } else if (cloned.type === 'issue.patch') {
      const viewRec = own(viewState.issues, cloned.entityId);
      if (!viewRec || viewRec.deleted) return null;
      const confRec = own(confirmed.issues, cloned.entityId);
      const basedOn: Record<string, number | string> = {};
      if (cloned.payload.title !== undefined) basedOn.title = baseForGroup(confRec, viewRec, 'title');
      if (cloned.payload.checked !== undefined) basedOn.checked = baseForGroup(confRec, viewRec, 'checked');
      cloned.basedOn = basedOn;
    } else if (cloned.basedOn) {
      const remapped: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(cloned.basedOn)) {
        remapped[k] = typeof v === 'string' && opIdMap.has(v) ? opIdMap.get(v)! : v;
      }
      cloned.basedOn = remapped;
    }

    fresh.push(cloned);
  }

  return fresh;
}
