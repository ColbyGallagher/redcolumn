import type { CountProposal } from '../assemblies/countProposals';

interface Props {
  p: CountProposal;
  pageLabel: (pageIndex: number) => string;
  /** Matches the person turned off (indexes into `p.matches`). */
  off: ReadonlySet<number>;
  /** Still waiting: matches can be turned off before approving. */
  editable: boolean;
  onToggle: (i: number) => void;
  /** Brings a match into view on the sheet. */
  onShow: (pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void;
}

/** A count proposal's matches in Review AI Takeoff: each one to look at, and to leave out before approving. */
export function CountMatches({ p, pageLabel, off, editable, onToggle, onShow }: Props) {
  return (
    <ul className="tp-matches" aria-label="Matches">
      {p.matches.map((m, i) => (
        <li key={i}>
          {editable && (
            <label>
              <input type="checkbox" checked={!off.has(i)} onChange={() => onToggle(i)} aria-label={`Match ${i + 1}`} />
            </label>
          )}
          <button type="button" className="tp-measure" title="Show it on the sheet" onClick={() => onShow(m.pageIndex, m.rect)}>
            {pageLabel(m.pageIndex)} · match {i + 1}
          </button>
          {m.score !== undefined && <span className="hint-text"> {Math.round(m.score * 100)}%</span>}
        </li>
      ))}
    </ul>
  );
}
