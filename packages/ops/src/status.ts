import type { StatusEvent } from './entities.ts';
import { statusDef } from './issue.ts';
import type { OperationOf } from './operations.ts';
import { invalid, own, reject, withEntry, type ApplyContext, type ApplyResult, type OpsState } from './state.ts';

/**
 * Applies a status change in the actor's lane. The change names the status the sender saw; if
 * that lane's status has moved since, it is rejected so the person can decide again. Accepted
 * events are never changed. Other lanes' statuses are untouched until a release shares the event.
 */
export function reduceStatus(state: OpsState, op: OperationOf<'status.transition'>, ctx: ApplyContext): ApplyResult {
  if (own(state.statusEvents, op.entityId)) return reject({ code: 'exists', kind: 'statusEvent', id: op.entityId });
  const { issueId, from, to, note = null, revisionSeenId = null } = op.payload;
  const issue = own(state.issues, issueId);
  if (!issue) return reject({ code: 'not_found', kind: 'issue', id: issueId });
  if (issue.deleted) return reject({ code: 'deleted', kind: 'issue', id: issueId });
  if (from === to) return invalid('The status is not changing');
  if (ctx.statuses) {
    const def = statusDef(ctx.statuses, to);
    if (!def) return invalid(`"${to}" is not one of the project's statuses`);
    if (def.category === 'closed' && !revisionSeenId) return invalid('Closing needs the revision that was checked');
  }

  const lanes = own(state.laneStatus, issueId) ?? {};
  const now = own(lanes, ctx.laneId)?.status ?? null;
  if (now !== from) return reject({ code: 'conflict', conflicts: [{ kind: 'issue', id: issueId, groups: ['status'] }] });

  const event: StatusEvent = { id: op.entityId, rev: 1, issueId, laneId: ctx.laneId, from, to, note, revisionSeenId, actor: ctx.actor, at: ctx.now, clientTime: op.clientTime ?? null };
  return {
    ok: true,
    state: {
      ...state,
      statusEvents: withEntry(state.statusEvents, event.id, event),
      laneStatus: withEntry(state.laneStatus, issueId, withEntry(lanes, ctx.laneId, { status: to, eventId: event.id })),
    },
    changes: [
      { kind: 'statusEvent', id: event.id },
      { kind: 'laneStatus', id: issueId },
    ],
  };
}
