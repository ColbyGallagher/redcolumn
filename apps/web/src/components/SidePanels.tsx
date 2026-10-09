import type { ReactNode } from 'react';
import type { PdfLayer } from '../documents/layers';
import { MARKUP_LABELS, type Markup, type MarkupStatusDef } from '@nb/markup';

export { MeasurementsPanel } from './MeasurementsPanel';

export function PlaceholderPanel({ body }: { body: string }) {
  return <p className="empty">{body}</p>;
}

export interface LayersPanelProps {
  /** The PDF's own layers (optional content), and which of them are hidden. */
  pdfLayers: readonly PdfLayer[];
  hiddenPdf: ReadonlySet<string>;
  onPdfLayer: (id: string, show: boolean) => void;
  /** Markup layers (their markups' `layer`) with counts, and which are hidden. */
  markupLayers: readonly { name: string; count: number }[];
  hiddenMarkup: ReadonlySet<string>;
  onMarkupLayer: (name: string, show: boolean) => void;
  showLinks: boolean;
  onShowLinks: (show: boolean) => void;
}

/**
 * Layers: the PDF's own layers (show or hide each; a locked one only on purpose), markup layers
 * (markups can be moved to a layer from their menu), and the app's hyperlinks.
 */
export function LayersPanel({ pdfLayers, hiddenPdf, onPdfLayer, markupLayers, hiddenMarkup, onMarkupLayer, showLinks, onShowLinks }: LayersPanelProps) {
  return (
    <div className="layers">
      <h3 className="panel-subhead">PDF layers</h3>
      {pdfLayers.length ? (
        <>
          <div className="layer-actions">
            <button className="btn small flat" onClick={() => pdfLayers.forEach((l) => hiddenPdf.has(l.id) && onPdfLayer(l.id, true))}>
              Show all
            </button>
            <button className="btn small flat" onClick={() => pdfLayers.forEach((l) => !hiddenPdf.has(l.id) && !l.locked && onPdfLayer(l.id, false))}>
              Hide all
            </button>
          </div>
          <ul className="layer-list">
            {pdfLayers.map((l) => (
              <li key={l.id} style={{ paddingLeft: 8 + l.depth * 14 }}>
                <label className="field" title={l.locked ? 'The file locks this layer; uncheck to hide it anyway' : undefined}>
                  <input
                    type="checkbox"
                    checked={!hiddenPdf.has(l.id)}
                    onChange={(e) => (!l.locked || e.target.checked || confirm(`"${l.name}" is locked in this file. Hide it anyway?`)) && onPdfLayer(l.id, e.target.checked)}
                  />
                  {l.name}
                  {l.locked && <span className="layer-lock">🔒</span>}
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty">This PDF has no layers of its own.</p>
      )}
      <h3 className="panel-subhead">Markup layers</h3>
      {markupLayers.length ? (
        <ul className="layer-list">
          {markupLayers.map((l) => (
            <li key={l.name}>
              <label className="field">
                <input type="checkbox" checked={!hiddenMarkup.has(l.name)} onChange={(e) => onMarkupLayer(l.name, e.target.checked)} />
                {l.name || 'No layer'} <span className="count">{l.count}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Right-click markups › Layer to put them on a layer.</p>
      )}
      <h3 className="panel-subhead">Shown by the app</h3>
      <label className="field">
        <input type="checkbox" checked={showLinks} onChange={(e) => onShowLinks(e.target.checked)} />
        Hyperlinks
      </label>
    </div>
  );
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
