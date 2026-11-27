import type { Issue, StatusDef } from './entities.ts';
import type { OperationOf } from './operations.ts';
import { bumped, created, invalid, own, reject, setDeleted, staleGroups, withEntry, type ApplyContext, type ApplyResult, type Change, type OpsState } from './state.ts';

type IssueOp = OperationOf<'issue.create' | 'issue.patch' | 'issue.link' | 'issue.unlink' | 'issue.delete' | 'issue.restore' | 'issue.number'>;

export const statusDef = (statuses: readonly StatusDef[] | undefined, id: string): StatusDef | undefined => statuses?.find((s) => s.id === id);

/**
 * Applies an issue operation. `title` and `checked` are versioned apart. Links to markups are a
 * set: linking twice or unlinking what is not linked changes nothing, and links never conflict.
 * The number is the server's to give (`issue.number`), once.
 */
export function reduceIssue(state: OpsState, op: IssueOp, ctx: ApplyContext): ApplyResult {
  const current = own(state.issues, op.entityId);
  const done = (record: Issue, extra: Partial<OpsState> = {}, more: Change[] = []): ApplyResult => ({
    ok: true,
    state: record === current ? state : { ...state, ...extra, issues: withEntry(state.issues, record.id, record) },
    changes: record === current ? [] : [{ kind: 'issue', id: record.id }, ...more],
  });

  if (op.type === 'issue.create') {
    if (current) return reject({ code: 'exists', kind: 'issue', id: op.entityId });
    const { scopeId, title, status, markupIds = [], originatingReviewId = null } = op.payload;
    if (ctx.statuses && !statusDef(ctx.statuses, status)) return invalid(`"${status}" is not one of the project's statuses`);
    const issue: Issue = { ...created(op, ctx), scopeId, number: null, title, checked: false, originatingReviewId, markupIds: [...new Set(markupIds)], owner: ctx.actor };
    const lanes = { [ctx.laneId]: { status, eventId: null } };
    return done(issue, { laneStatus: withEntry(state.laneStatus, issue.id, lanes) }, [{ kind: 'laneStatus', id: issue.id }]);
  }

  if (!current) return reject({ code: 'not_found', kind: 'issue', id: op.entityId });
  switch (op.type) {
    case 'issue.delete':
      return done(setDeleted(current, true, op, ctx.now));
    case 'issue.restore':
      return done(setDeleted(current, false, op, ctx.now));
    case 'issue.number':
      if (current.number !== null) return invalid('The issue already has a number');
      return done({ ...current, number: op.payload.number, ...bumped(current, ['number'], op, ctx.now) });
  }
  if (current.deleted) return reject({ code: 'deleted', kind: 'issue', id: current.id });

  if (op.type === 'issue.link' || op.type === 'issue.unlink') {
    const { markupId } = op.payload;
    const linked = current.markupIds.includes(markupId);
    if (linked === (op.type === 'issue.link')) return done(current);
    const markupIds = linked ? current.markupIds.filter((id) => id !== markupId) : [...current.markupIds, markupId];
    return done({ ...current, markupIds, ...bumped(current, ['links'], op, ctx.now) });
  }

  const groups = (['title', 'checked'] as const).filter((k) => op.payload[k] !== undefined);
  if (!groups.length) return invalid('The patch changes nothing');
  const stale = staleGroups(current, groups, op.basedOn);
  if (stale.length) return reject({ code: 'conflict', conflicts: [{ kind: 'issue', id: current.id, groups: stale }] });
  return done({ ...current, title: op.payload.title ?? current.title, checked: op.payload.checked ?? current.checked, ...bumped(current, groups, op, ctx.now) });
}
