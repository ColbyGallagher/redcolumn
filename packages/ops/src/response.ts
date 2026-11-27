import type { Response } from './entities.ts';
import type { OperationOf } from './operations.ts';
import { bumped, created, invalid, own, reject, setDeleted, staleGroups, withEntry, type ApplyContext, type ApplyResult, type OpsState } from './state.ts';

type ResponseOp = OperationOf<'response.create' | 'response.patch' | 'response.delete' | 'response.restore'>;

/**
 * Applies a response operation. A response is its own record, so it never conflicts with edits to
 * what it answers. A response to an earlier version of its parent is accepted and records which.
 */
export function reduceResponse(state: OpsState, op: ResponseOp, ctx: ApplyContext): ApplyResult {
  const current = own(state.responses, op.entityId);
  const done = (record: Response): ApplyResult => ({
    ok: true,
    state: record === current ? state : { ...state, responses: withEntry(state.responses, record.id, record) },
    changes: record === current ? [] : [{ kind: 'response', id: record.id }],
  });

  if (op.type === 'response.create') {
    if (current) return reject({ code: 'exists', kind: 'response', id: op.entityId });
    const { parent, inReplyTo = null, answersRev = null, kind, body } = op.payload;
    const target = parent.kind === 'markup' ? own(state.markups, parent.id) : own(state.issues, parent.id);
    if (!target) return reject({ code: 'not_found', kind: parent.kind, id: parent.id });
    if (target.deleted) return reject({ code: 'deleted', kind: parent.kind, id: parent.id });
    if (answersRev !== null && answersRev > target.rev) return invalid('It answers a version that does not exist');
    if (inReplyTo !== null) {
      const answered = own(state.responses, inReplyTo);
      if (!answered) return reject({ code: 'not_found', kind: 'response', id: inReplyTo });
      if (answered.parent.kind !== parent.kind || answered.parent.id !== parent.id) return invalid('It answers a response on something else');
    }
    return done({ ...created(op, ctx), parent: { ...parent }, inReplyTo, answersRev, kind, body, owner: ctx.actor });
  }

  if (!current) return reject({ code: 'not_found', kind: 'response', id: op.entityId });
  if (op.type === 'response.delete') return done(setDeleted(current, true, op, ctx.now));
  if (op.type === 'response.restore') return done(setDeleted(current, false, op, ctx.now));
  if (current.deleted) return reject({ code: 'deleted', kind: 'response', id: current.id });

  const stale = staleGroups(current, ['body'], op.basedOn);
  if (stale.length) return reject({ code: 'conflict', conflicts: [{ kind: 'response', id: current.id, groups: stale }] });
  return done({ ...current, body: op.payload.body, ...bumped(current, ['body'], op, ctx.now) });
}
