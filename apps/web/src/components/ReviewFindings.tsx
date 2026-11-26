import { msg } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import type { AiReviewFacet, MarkupDocument, ReviewFinding, SourceRef } from '@nb/markup';
import { formatNumber } from '../columns/listColumns';
import { decideFindings, FINDING_KIND_LABEL } from '../takeoff/reviewPass';

interface Props {
  store: MarkupDocument & AiReviewFacet;
  me: string;
  findings: readonly ReviewFinding[];
  pageLabel: (pageIndex: number) => string;
  onShowSource: (s: SourceRef) => void;
}

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const SEVERITY = lazy((): Record<ReviewFinding['severity'], string> => ({ issue: msg('Issue'), check: msg('Check'), ok: msg('Agrees') }));
const STATUS = lazy((): Record<ReviewFinding['status'], string> => ({ open: '', accepted: msg('Accepted'), dismissed: msg('Dismissed') }));

/**
 * What the AI review pass said about an item (or found missing), labelled as AI review so it is
 * never mistaken for the takeoff itself. Each one is accepted or dismissed by a person; neither
 * changes the drawing.
 */
export function ReviewFindings({ store, me, findings, pageLabel, onShowSource }: Props) {
  if (!findings.length) return null;
  return (
    <ul className="ar-findings" aria-label={msg('AI review findings')}>
      {findings.map((f) => (
        <li key={f.id} className={`ar-finding ${f.severity} ${f.status}`}>
          <div className="tp-head">
            <span className="ar-kind review" title={msg('From the optional AI review pass, run in a fresh context')}>
              {msg('AI review')}
            </span>
            <span className={`ar-sev ${f.severity}`}>{SEVERITY()[f.severity]}</span>
            <span className="hint-text">{FINDING_KIND_LABEL()[f.kind]}</span>
            <span className="grow" />
            {f.status !== 'open' && <span className={`tp-state ${f.status === 'accepted' ? 'approved' : 'rejected'}`}>{STATUS()[f.status]}</span>}
          </div>
          <p className="ar-finding-text">
            {f.message}
            {f.expected ? (
              <b>
                {' ' + msg('Reviewer: {number}{value}.', { number: formatNumber(f.expected.quantity, 2), value: f.expected.unit ? ` ${f.expected.unit}` : '' })}
              </b>
            ) : null}
          </p>
          {!!f.sources?.length && (
            <ul className="ar-sources" aria-label={msg('Finding sources')}>
              {f.sources.map((s, k) => (
                <li key={k}>
                  <button type="button" className="rc-linkish" onClick={() => onShowSource(s)}>
                    {pageLabel(s.pageIndex)}
                    {s.kind ? ` · ${s.kind}` : ''}
                  </button>
                  {s.text ? <span> “{s.text}”</span> : null}
                </li>
              ))}
            </ul>
          )}
          <div className="tp-actions">
            <span className="hint-text grow">
              {f.source}, {when(f.createdAt)}
              {f.decided ? ' ' + msg('· {status} by {by}', { status: STATUS()[f.status].toLowerCase(), by: f.decided.by }) : ''}
            </span>
            {f.status === 'open' ? (
              <>
                <button type="button" className="btn small" disabled={store.readOnly} onClick={() => decideFindings(store, [f.id], 'dismissed', me)}>
                  {msg('Dismiss')}
                </button>
                <button type="button" className="btn small" disabled={store.readOnly} onClick={() => decideFindings(store, [f.id], 'accepted', me)} title={msg('Agree with the reviewer. Nothing is changed: fix or reject the item yourself.')}>
                  {msg('Accept Finding')}
                </button>
              </>
            ) : (
              <button type="button" className="btn small" disabled={store.readOnly} onClick={() => decideFindings(store, [f.id], 'open', me)}>
                {msg('Undecide')}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
