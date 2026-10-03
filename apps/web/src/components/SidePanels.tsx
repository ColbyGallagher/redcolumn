import type { ReactNode } from 'react';
import { SCALE_GROUPS, unitsFor, useSettings } from '../settings/settings';
import type { PdfLayer } from '../documents/layers';
import { MARKUP_LABELS, measureProps, type Viewport, type Markup, type MarkupStatusDef } from '@nb/markup';
import { DECIMAL_PRECISIONS, SCALE_PRESETS, DEFAULT_SCALE, formatMeasure, FRACTION_PRECISIONS, isMeasureKind, LENGTH_UNITS, measureValue, QUANTITY, type LengthUnit, type MeasureKind, type Scale } from '@nb/measure';

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
}: {
  markups: Markup[];
  statuses: readonly MarkupStatusDef[];
  selected: ReadonlySet<string>;
  onSelect: (m: Markup) => void;
}) {
  // Flags on the page (Flag markups), markups flagged for follow-up, and markups with a status.
  const flags = markups.filter((m) => m.type === 'flag').sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
  const flagged = markups.filter((m) => m.flagged && m.type !== 'flag');
  const withStatus = markups.filter((m) => m.status !== 'none');
  if (!flags.length && !flagged.length && !withStatus.length) {
    return <p className="empty">Flags you place (Tools › Markup › Flag), markups you flag (right-click › Flag) and markups with a status appear here.</p>;
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

export function MeasurementsPanel({
  markups,
  scales,
  selected,
  onSelect,
  pageIndex,
  onScale,
  scaleOf,
  viewports,
  onViewports,
}: {
  markups: Markup[];
  scales: Readonly<Record<number, Scale>>;
  /** The scale each markup is measured at. */
  scaleOf: (m: Markup) => Scale;
  /** The current page's viewports. */
  viewports: readonly Viewport[];
  /** Viewport actions; null when the document cannot be edited. */
  onViewports: {
    add: () => void;
    calibrate: () => void;
    update: (v: Viewport) => void;
    remove: (id: string) => void;
  } | null;
  selected: ReadonlySet<string>;
  onSelect: (m: Markup) => void;
  /** The current page, whose units and precision the panel edits. */
  pageIndex: number;
  /** Changes the current page's scale; null when it cannot be edited. */
  onScale: ((scale: Scale) => void) | null;
}) {
  const rows = markups.filter((m) => isMeasureKind(m.type));
  const settings = (
    <>
      <ScaleSettings scale={scales[pageIndex] ?? null} onScale={onScale} />
      <ViewportList viewports={viewports} actions={onViewports} />
    </>
  );
  if (!rows.length)
    return (
      <div className="measure-panel">
        {settings}
        <p className="empty">Length, area, count and other takeoffs you draw appear here.</p>
      </div>
    );
  const totals = new Map<MeasureKind, { value: number; scale: Scale; n: number }>();
  for (const m of rows) {
    if (!isMeasureKind(m.type) || QUANTITY[m.type] === 'angle') continue;
    const scale = scaleOf(m);
    const value = measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m));
    const t = totals.get(m.type) ?? { value: 0, scale, n: 0 };
    t.value += value;
    t.n++;
    totals.set(m.type, t);
  }
  return (
    <div className="measure-panel">
      {settings}
      <ul className="bookmark-list">
        {rows.map((m) => {
          const scale = scaleOf(m);
          const value = isMeasureKind(m.type) ? measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m)) : null;
          return (
            <li key={m.id}>
              <button className={`bookmark${selected.has(m.id) ? ' active' : ''}`} onClick={() => onSelect(m)}>
                <span className="num">{MARKUP_LABELS[m.type]}</span>
                <span className="name">
                  p. {m.pageIndex + 1}
                  {value !== null && isMeasureKind(m.type) ? ` · ${formatMeasure(m.type, value, scale)}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {totals.size > 0 && (
        <ul className="measure-totals">
          {[...totals].map(([kind, t]) => (
            <li key={kind}>
              Total {MARKUP_LABELS[kind]} ({t.n}): {formatMeasure(kind, t.value, t.scale)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The page's scale, and its display units and precision (decimal places, or inch fractions). */
function ScaleSettings({ scale, onScale }: { scale: Scale | null; onScale: ((scale: Scale) => void) | null }) {
  const system = useSettings().unitSystem;
  if (!scale) return <p className="empty">This page has no scale yet: pick one in the status bar, or calibrate (K).</p>;
  const imperial = scale.unit === 'ft' || scale.unit === 'in';
  const fractions = scale.feetInches && imperial;
  const set = (patch: Partial<Scale>) => onScale?.({ ...scale, ...patch });
  return (
    <div className="scale-settings">
      <div className="prop-row">
        <span className="prop-label">Scale</span>
        <span>{scale.label}</span>
      </div>
      <label className="prop-row">
        <span className="prop-label">Units</span>
        <select
          value={scale.unit}
          disabled={!onScale}
          onChange={(e) => {
            const unit = e.target.value as LengthUnit;
            const keepFractions = fractions && (unit === 'ft' || unit === 'in');
            set({ unit, feetInches: keepFractions, precision: keepFractions ? scale.precision : 2 });
          }}
        >
          {unitsFor(system, LENGTH_UNITS, scale.unit).map((u) => (
            <option key={u} value={u}>
              {u === 'ft' && fractions ? 'ft-in' : u}
            </option>
          ))}
        </select>
      </label>
      <label className="prop-row">
        <span className="prop-label">Precision</span>
        <select
          value={`${fractions ? 'f' : 'd'}${scale.precision}`}
          disabled={!onScale}
          onChange={(e) => {
            const v = e.target.value;
            set({ feetInches: v[0] === 'f', precision: Number(v.slice(1)) });
          }}
        >
          {DECIMAL_PRECISIONS.map((p) => (
            <option key={`d${p}`} value={`d${p}`}>
              {p ? `0.${'0'.repeat(p)}` : '0'}
            </option>
          ))}
          {imperial &&
            FRACTION_PRECISIONS.map((p) => (
              <option key={`f${p}`} value={`f${p}`}>
                {p === 1 ? 'Whole inches' : `1/${p}"`}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Viewports on the page: regions (a detail, a section) with their own scale. Measurements that
 * start inside one use its scale; calibrating inside one sets its scale only.
 */
function ViewportList({ viewports, actions }: { viewports: readonly Viewport[]; actions: Parameters<typeof MeasurementsPanel>[0]['onViewports'] }) {
  const system = useSettings().unitSystem;
  return (
    <div className="viewports">
      <div className="viewports-head">
        <span className="prop-label">Viewports</span>
        {actions && (
          <>
            <button className="btn small" title="Drag a box around a detail drawn at another scale" onClick={actions.add}>
              + Add
            </button>
            {viewports.length > 0 && (
              <button className="btn small" title="Draw a line of known length inside a viewport to set its scale" onClick={actions.calibrate}>
                Calibrate
              </button>
            )}
          </>
        )}
      </div>
      {viewports.map((v) => (
        <div key={v.id} className="viewport-row">
          <input
            key={`${v.id}:${v.name}`}
            defaultValue={v.name}
            aria-label="Viewport name"
            disabled={!actions}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== v.name) actions?.update({ ...v, name });
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <select
            value={SCALE_PRESETS.some((p) => p.label === v.scale.label) ? v.scale.label : ''}
            aria-label="Viewport scale"
            disabled={!actions}
            onChange={(e) => {
              const preset = SCALE_PRESETS.find((p) => p.label === e.target.value);
              if (preset) actions?.update({ ...v, scale: preset.scale });
            }}
          >
            {!SCALE_PRESETS.some((p) => p.label === v.scale.label) && <option value="">{v.scale.label}</option>}
            {SCALE_PRESETS.filter((p) => SCALE_GROUPS[system].includes(p.group) || p.label === v.scale.label).map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
          <button className="btn small" title="Delete the viewport" disabled={!actions} onClick={() => actions?.remove(v.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
