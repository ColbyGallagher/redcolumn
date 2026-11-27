import type { ItemKind, ItemRef, LaneStatus, Release } from './entities.ts';
import type { OperationOf } from './operations.ts';
import { own, reject, withEntry, type ApplyContext, type ApplyResult, type Change, type Conflict, type OpsState } from './state.ts';

/** The record an item reference names, if it is in the state. */
export function itemOf(state: OpsState, kind: ItemKind, id: string): { rev: number; deleted?: boolean } | undefined {
  switch (kind) {
    case 'markup':
      return own(state.markups, id);
    case 'placement':
      return own(state.placements, id);
    case 'issue':
      return own(state.issues, id);
    case 'response':
      return own(state.responses, id);
    case 'statusEvent':
      return own(state.statusEvents, id);
  }
}

/**
 * Applies a release: the exact versions named become visible to the lanes named. All of it applies
 * or none: if any item has changed since it was previewed, the release is rejected with every
 * item that changed. A released status change also becomes the receiving lanes' current status (in the
 * order the items are listed).
 *
 * Whether the actor may release through the gate, and to which lanes, is not checked here.
 */
export function reduceRelease(state: OpsState, op: OperationOf<'release.create'>, ctx: ApplyContext): ApplyResult {
  if (own(state.releases, op.entityId)) return reject({ code: 'exists', kind: 'release', id: op.entityId });
  const { gateId, toLaneIds, items } = op.payload;
  const conflicts: Conflict[] = [];
  for (const item of items) {
    const record = itemOf(state, item.kind, item.id);
    if (!record) return reject({ code: 'not_found', kind: item.kind, id: item.id });
    if (record.rev !== item.rev) conflicts.push({ kind: item.kind, id: item.id, groups: ['rev'] });
  }
  if (conflicts.length) return reject({ code: 'conflict', conflicts });

  const release: Release = { id: op.entityId, rev: 1, gateId, toLaneIds: [...new Set(toLaneIds)], items: items.map((i): ItemRef => ({ ...i })), by: ctx.actor, at: ctx.now };
  let laneStatus = state.laneStatus;
  const changes: Change[] = [{ kind: 'release', id: release.id }];
  for (const item of items) {
    if (item.kind !== 'statusEvent') continue;
    const event = own(state.statusEvents, item.id)!;
    let lanes: Readonly<Record<string, LaneStatus>> = own(laneStatus, event.issueId) ?? {};
    for (const lane of release.toLaneIds) lanes = withEntry(lanes, lane, { status: event.to, eventId: event.id });
    laneStatus = withEntry(laneStatus, event.issueId, lanes);
    if (!changes.some((c) => c.kind === 'laneStatus' && c.id === event.issueId)) changes.push({ kind: 'laneStatus', id: event.issueId });
  }
  return { ok: true, state: { ...state, releases: withEntry(state.releases, release.id, release), laneStatus }, changes };
}
