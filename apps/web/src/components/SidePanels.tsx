import type { ReactNode } from 'react';
import { MARKUP_LABELS, type Markup, type MarkupStatusDef } from '@nb/markup';

export { MeasurementsPanel } from './MeasurementsPanel';

export function PlaceholderPanel({ body }: { body: string }) {
  return <p className="empty">{body}</p>;
}

export function FlagsPanel({
  markups,
  statuses,
  selected,
  onSelect,
  onAdd,
}: {
  markups: Markup[];
  statuses: readonly MarkupStatusDef[];
  selected: ReadonlySet<string>;
  onSelect: (m: Markup) => void;
  /** Starts the Flag tool; null when no document can be marked up. */
  onAdd: (() => void) | null;
}) {
  // Flags on the page (Flag markups), markups flagged for follow-up, and markups with a status.
  const flags = markups.filter((m) => m.type === 'flag').sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
  const flagged = markups.filter((m) => m.flagged && m.type !== 'flag');
  const withStatus = markups.filter((m) => m.status !== 'none');
  const add = (
    <button className="btn small" disabled={!onAdd} title="Click on the page to place a flag" onClick={onAdd ?? undefined}>
      ⚑ Add Flag
    </button>
  );
  if (!flags.length && !flagged.length && !withStatus.length) {
    return (
      <div className="flags-panel">
        {add}
        <p className="empty">Flags you place, markups you flag (right-click › Flag) and markups with a status appear here.</p>
      </div>
    );
  }
  const item = (m: Markup, tag: ReactNode, name: string) => (
    <li key={m.id}>
      <button className={`bookmark${selected.has(m.id) ? ' active' : ''}`} onClick={() => onSelect(m)} title={m.comment ?? ''}>
        {tag}
        <span className="name">{name}</span>
      </button>
    </li>
  );
  return (
    <div className="flags-panel">
      {add}
      {flags.length > 0 && (
        <>
          <h3 className="panel-subhead">Flags</h3>
          <ul className="bookmark-list">{flags.map((m) => item(m, <span className="num" style={{ color: m.style.fill ?? m.style.stroke }}>⚑</span>, `${m.comment?.split('\n')[0] || 'Flag'} · p. ${m.pageIndex + 1}`))}</ul>
        </>
      )}
      {flagged.length > 0 && (
        <>
          <h3 className="panel-subhead">Flagged markups</h3>
          <ul className="bookmark-list">{flagged.map((m) => item(m, <span className="num">⚑</span>, `${m.subject || MARKUP_LABELS[m.type]} · p. ${m.pageIndex + 1}`))}</ul>
        </>
      )}
      {withStatus.length > 0 && (
        <>
          <h3 className="panel-subhead">With a status</h3>
          <ul className="bookmark-list">
            {withStatus.map((m) =>
              item(
                m,
                <span className="num" style={{ color: statuses.find((s) => s.id === m.status)?.color }}>
                  {statuses.find((s) => s.id === m.status)?.name ?? m.status}
                </span>,
                `${MARKUP_LABELS[m.type]} · p. ${m.pageIndex + 1}`,
              ),
            )}
          </ul>
        </>
      )}
    </div>
  );
}
