import { msg } from '@nb/i18n';
import { useState } from 'react';
import { LOW_CONFIDENCE, MARKUP_LABELS, type GroupingProposal, type GroupingStatus, type Markup, type MarkupStore, type ReviewFinding, type SourceRef } from '@nb/markup';
import { ReviewFindings } from './ReviewFindings';
import { acceptGrouping, deleteGrouping, editGrouping, groupValues, ownsColumn, regroup, rejectGrouping, reopenGrouping } from '../takeoff/groupingColumns';

interface Props {
  store: MarkupStore;
  me: string;
  /** Waiting ones only, or all with decisions. */
  waitingOnly: boolean;
  pageLabel: (pageIndex: number) => string;
  onShow: (m: Markup) => void;
  onMessage: (text: string) => void;
  /** What the AI review pass said, by review item (`column:<id>`). */
  findings: ReadonlyMap<string, ReviewFinding[]>;
  onShowSource: (s: SourceRef) => void;
}

export const GROUPING_STATUS_LABEL = (): Record<GroupingStatus, string> => ({ proposed: msg('Proposed'), review: msg('In review'), accepted: msg('Accepted'), rejected: msg('Rejected') });
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** Rows shown before "Show all", so a column over thousands of markups stays quick. */
const FIRST_ROWS = 100;

export const isWaitingGrouping = (g: GroupingProposal) => g.status === 'proposed' || g.status === 'review';

/**
 * Review AI Takeoff › Columns: grouping columns an AI client or a grouping tool proposed. Each has
 * its status, its reasoning and each markup's group with the reason for it; a person renames it,
 * moves markups between groups, and accepts or rejects it. Columns only group: they never change a
 * quantity.
 */
export function GroupingReview({ store, me, waitingOnly, pageLabel, onShow, onMessage, findings, onShowSource }: Props) {
  const all = store.aiReview().columns;
  // An accepted or rejected column the review pass has an open finding on still waits: for the finding.
  const findingWaits = (g: GroupingProposal) => (findings.get(`column:${g.id}`) ?? []).some((f) => f.status === 'open' && f.severity !== 'ok');
  const shown = waitingOnly ? all.filter((g) => isWaitingGrouping(g) || findingWaits(g)) : all;
  if (!shown.length) return <p className="empty">{all.length ? msg('No grouping column is waiting for review.') : msg('No grouping columns yet. Ask your AI client to group the takeoff (by level, zone, trade...), or run an accepted tool from the Tools tab.')}</p>;
  return (
    <>
      <p className="hint-text takeoff-review-note">{msg('Grouping columns only change how markups are grouped and listed. They are text or a drop-down, never a number, so they never change a quantity.')}</p>
      {shown.map((g) => (
        <Grouping key={g.id} g={g} store={store} me={me} pageLabel={pageLabel} onShow={onShow} onMessage={onMessage} findings={findings} onShowSource={onShowSource} />
      ))}
    </>
  );
}

function Grouping({ g, store, me, pageLabel, onShow, onMessage, findings, onShowSource }: { g: GroupingProposal } & Omit<Props, 'waitingOnly'>) {
  const [all, setAll] = useState(false);
  const open = isWaitingGrouping(g);
  const readOnly = store.readOnly;
  const values = groupValues(g);
  const counts = new Map<string, number>();
  for (const a of g.assignments) counts.set(a.value, (counts.get(a.value) ?? 0) + 1);
  const rows = all ? g.assignments : g.assignments.slice(0, FIRST_ROWS);
  const listId = `grouping-values-${g.id}`;
  const accept = () => {
    try {
      const r = acceptGrouping(store, g.id, me);
      if (r) onMessage(msg('Added the “{name}” column to {written, plural, one {# markup} other {# markups}}{value}. Undo takes it back.', { name: g.name, written: r.written, value: r.skipped ? msg('; {skipped} could not be (gone, locked or someone else\'s)', { skipped: r.skipped }) : '' }));
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <article className={`takeoff-proposal ${g.status === 'accepted' ? 'approved' : g.status === 'rejected' ? 'rejected' : 'pending'}`} aria-label={msg('Grouping column: {name}', { name: g.name })}>
      <div className="tp-head">
        <span className={`ar-conf${g.confidence !== undefined && g.confidence < LOW_CONFIDENCE ? ' low' : ''}`}>{g.confidence === undefined ? '?' : `${Math.round(g.confidence * 100)}%`}</span>
        <span className="ar-kind column">{msg('Column')}</span>
        {open ? <input aria-label={msg('Column name')} className="ar-subject" value={g.name} disabled={readOnly} onChange={(e) => editGrouping(store, g.id, { name: e.target.value })} /> : <b>{g.name}</b>}
        {open && (
          <select aria-label={msg('Column type')} value={g.type} disabled={readOnly} onChange={(e) => editGrouping(store, g.id, { type: e.target.value as 'text' | 'choice' })}>
            <option value="choice">{msg('Drop-down')}</option>
            <option value="text">{msg('Text')}</option>
          </select>
        )}
        <span className="grow" />
        <span className={`tp-state ${g.status === 'accepted' ? 'approved' : g.status}`}>{GROUPING_STATUS_LABEL()[g.status]}</span>
      </div>
      <p className="hint-text">
        {msg('{count, plural, one {# markup} other {# markups}} in {size, plural, one {# group} other {# groups}}: {list}{value}', { count: g.assignments.length, size: counts.size, list: [...counts].map(([v, n]) => `${v || '(none)'} ${n}`).join(', '), value: g.toolUse ? ' ' + msg('· made by the tool “{toolName}”, {when}', { toolName: g.toolUse.toolName, when: when(g.toolUse.at) }) : '' })}
      </p>
      <blockquote className="tp-reason">
        <span className="hint-text">
          {g.source}, {when(g.createdAt)}:
        </span>{' '}
        {g.reasoning}
      </blockquote>
      <datalist id={listId}>
        {values.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <table className="qty-table ar-groups">
        <thead>
          <tr>
            <th>{msg('Markup')}</th>
            <th>{msg('Group')}</th>
            <th>{msg('Why')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const m = store.get(a.markupId);
            return (
              <tr key={a.markupId}>
                <td>
                  <button type="button" className="tp-measure" disabled={!m} onClick={() => m && onShow(m)} title={msg('Show it on the sheet')}>
                    {m ? `${m.subject ?? MARKUP_LABELS[m.type]} · ${pageLabel(m.pageIndex)}` : msg('Deleted markup')}
                  </button>
                </td>
                <td>
                  {open ? <input aria-label={msg('Group')} list={listId} value={a.value} disabled={readOnly} onChange={(e) => regroup(store, g.id, a.markupId, e.target.value)} /> : a.value}
                  {a.edited && <span className="ar-edited" title={msg('Changed by a person')}>{msg('AI: {value}', { value: a.edited.from || msg('(none)') })}</span>}
                </td>
                <td className="hint-text">
                  {a.confidence !== undefined ? `${Math.round(a.confidence * 100)}% ` : ''}
                  {a.reasoning ?? ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!all && g.assignments.length > FIRST_ROWS && (
        <button type="button" className="rc-linkish" onClick={() => setAll(true)}>
          {msg('Show all {count}', { count: g.assignments.length })}
        </button>
      )}
      <ReviewFindings store={store} me={me} findings={findings.get(`column:${g.id}`) ?? []} pageLabel={pageLabel} onShowSource={onShowSource} />
      {g.accepted && (
        <p className="hint-text">
          {msg('Accepted by {by}, {when}{value}.', { by: g.accepted.by, when: when(g.accepted.at), value: g.assignments.some((a) => a.edited) ? msg(', with {count} markup(s) regrouped by a person', { count: g.assignments.filter((a) => a.edited).length }) : '' })}
        </p>
      )}
      {g.rejected && (
        <p className="hint-text">
          {msg('Rejected by {by}, {when}.', { by: g.rejected.by, when: when(g.rejected.at) })}
        </p>
      )}
      <div className="tp-actions">
        {open && (
          <>
            <button type="button" className="btn small" disabled={readOnly} onClick={() => rejectGrouping(store, g.id, me)}>
              {msg('Reject')}
            </button>
            <button type="button" className="btn small primary" disabled={readOnly || !g.name.trim()} onClick={accept}>
              {msg('Accept Column')}
            </button>
          </>
        )}
        {g.status === 'rejected' && (
          <button type="button" className="btn small" disabled={readOnly} onClick={() => reopenGrouping(store, g.id)}>
            {msg('Review Again')}
          </button>
        )}
        {!open && (
          <button type="button" className="btn small" disabled={readOnly} title={g.accepted ? msg('Forget this record; the column stays in the document') : msg('Forget this proposal')} onClick={() => deleteGrouping(store, g.id, false)}>
            {g.accepted ? msg('Forget') : msg('Delete')}
          </button>
        )}
        {g.accepted && ownsColumn(store, g) && (
          <button type="button" className="btn small" disabled={readOnly} title={msg('Delete the column from the document (markups keep the values stored for it). Undo takes it back.')} onClick={() => deleteGrouping(store, g.id, true)}>
            {msg('Delete Column')}
          </button>
        )}
      </div>
    </article>
  );
}
