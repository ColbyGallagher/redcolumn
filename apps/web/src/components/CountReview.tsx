import { useState } from 'react';
import type { MarkupStore } from '@nb/markup';
import { approveCountProposal, countProposals, countStateOf, type CountProposal } from '../assemblies/countProposals';

interface Props {
  store: MarkupStore;
  proposals: readonly CountProposal[];
  /** Who approves: the name markups are authored under. */
  me: string;
  pageLabel: (pageIndex: number) => string;
  /** Brings a match into view on the sheet. */
  onShow: (pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void;
  onMessage: (text: string) => void;
}

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The count proposals in Takeoff Review: matches an AI client staged, to approve or reject. */
export function CountReview({ store, proposals, me, pageLabel, onShow, onMessage }: Props) {
  // Matches a person turned off, per proposal (indexes into its matches).
  const [off, setOff] = useState<Record<string, Set<number>>>({});
  const toggle = (id: string, i: number) =>
    setOff((all) => {
      const next = new Set(all[id] ?? []);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return { ...all, [id]: next };
    });

  return (
    <>
      {proposals.map((p) => {
        const state = countStateOf(p, store);
        const skip = off[p.id] ?? new Set<number>();
        const kept = p.matches.length - [...skip].filter((i) => i < p.matches.length).length;
        return (
          <article key={p.id} className={`takeoff-proposal ${state}`} aria-label={`Count proposal: ${p.subject}`}>
            <div className="tp-head">
              <b>Count: {p.subject}</b>
              <span className="tp-value">
                {state === 'approved' && p.placed ? p.placed.count : kept} of {p.matches.length}
              </span>
              <span className="grow" />
              <span className={`tp-state ${state}`}>{state === 'pending' ? 'Waiting' : state === 'approved' ? 'Approved' : 'Rejected'}</span>
            </div>
            {state === 'pending' && (
              <ul className="tp-matches" aria-label="Matches">
                {p.matches.map((m, i) => (
                  <li key={i}>
                    <label>
                      <input type="checkbox" checked={!skip.has(i)} onChange={() => toggle(p.id, i)} aria-label={`Match ${i + 1}`} />
                    </label>
                    <button type="button" className="tp-measure" title="Show it on the sheet" onClick={() => onShow(m.pageIndex, m.rect)}>
                      {pageLabel(m.pageIndex)} · match {i + 1}
                    </button>
                    {m.score !== undefined && <span className="hint-text"> {Math.round(m.score * 100)}%</span>}
                  </li>
                ))}
              </ul>
            )}
            <blockquote className="tp-reason">
              <span className="hint-text">
                {p.source}, {when(p.createdAt)}:
              </span>{' '}
              {p.reasoning}
            </blockquote>
            {state === 'approved' && p.placed && (
              <p className="hint-text">
                Approved by {p.placed.by}, {when(p.placed.at)}. Undo takes the counts back.
              </p>
            )}
            {state === 'rejected' && p.rejected && (
              <p className="hint-text">
                Rejected by {p.rejected.by}, {when(p.rejected.at)}.{' '}
                <button type="button" className="rc-linkish" onClick={() => countProposals.reopen(store.fileHash, p.id)}>
                  Review again
                </button>
              </p>
            )}
            {state === 'pending' && (
              <div className="tp-actions">
                <button type="button" className="btn small" onClick={() => countProposals.reject(store.fileHash, p.id, me)}>
                  Reject
                </button>
                <button
                  type="button"
                  className="btn small primary"
                  disabled={store.readOnly || !kept}
                  onClick={() => {
                    const n = approveCountProposal(store, p, me, skip);
                    onMessage(n ? `Counted ${n} ${p.subject}. Undo takes it back.` : 'Nothing was counted.');
                  }}
                >
                  Approve {kept}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}
