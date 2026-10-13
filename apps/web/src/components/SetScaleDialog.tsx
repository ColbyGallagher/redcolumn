import { useState } from 'react';
import {
  DECIMAL_PRECISIONS,
  FRACTION_PRECISIONS,
  LENGTH_UNITS,
  SCALE_PRESETS,
  formatScaleNumber,
  parseScaleNumber,
  scaleEquation,
  scaleFromParts,
  scaleParts,
  type LengthUnit,
  type PaperUnit,
  type Scale,
} from '@nb/measure';
import { SCALE_GROUPS, unitsFor, useSettings } from '../settings/settings';
import { PAPER_UNITS, closeScale, loadPresets, matchPreset, pagesOf, precisionText, precisionValue, rangeText, writePresets, type SavedPreset } from '../measure/scalePresets';

interface Props {
  /** Scale of the first page the dialog acts on, used to fill the fields. */
  scale: Scale | null;
  pageCount: number;
  currentPage: number;
  /** Pages selected in the thumbnails (more than one makes "Selected" a choice). */
  selected: readonly number[];
  /** Pages to start with instead of the current page, e.g. from Bulk Scales. */
  initialPages?: readonly number[];
  /** Closes the dialog and starts the Calibrate tool. Null when calibrating is not possible. */
  onCalibrate: (() => void) | null;
  onApply: (pages: number[], scale: Scale) => void;
  onCancel: () => void;
}

type PagesMode = 'current' | 'selected' | 'all' | 'range';

interface Side {
  paper: string;
  paperUnit: PaperUnit;
  real: string;
  realUnit: LengthUnit;
}

function sideOf(scale: Scale): Side {
  const p = scaleParts(scale);
  return { paper: formatScaleNumber(p.paper), paperUnit: p.paperUnit, real: formatScaleNumber(p.real), realUnit: p.realUnit };
}

/** Bluebeam's Set Page Scale: pages, a preset or custom equation, an optional separate Y scale, and precision. */
export function SetScaleDialog({ scale, pageCount, currentPage, selected, initialPages, onCalibrate, onApply, onCancel }: Props) {
  const system = useSettings().unitSystem;
  const groups = SCALE_GROUPS[system];
  const [saved, setSaved] = useState<SavedPreset[]>(loadPresets);
  const fallback = SCALE_PRESETS.find((p) => p.label === (system === 'metric' ? '1:100' : '1/8" = 1\'-0"'))!.scale;
  const start = scale ?? fallback;

  const [pagesMode, setPagesMode] = useState<PagesMode>(initialPages?.length ? 'range' : selected.length > 1 ? 'selected' : 'current');
  const [pagesText, setPagesText] = useState(initialPages?.length ? rangeText(initialPages) : '');
  const [mode, setMode] = useState<'preset' | 'custom'>(scale && matchPreset(scale, saved) ? 'preset' : 'custom');
  const [x, setX] = useState<Side>(() => sideOf(start));
  const [y, setY] = useState<Side>(() => sideOf(start.yMetersPerPoint != null ? { ...start, metersPerPoint: start.yMetersPerPoint } : start));
  const [xPreset, setXPreset] = useState(() => presetKey(start, saved));
  const [yPreset, setYPreset] = useState(() => presetKey(start.yMetersPerPoint != null ? { ...start, metersPerPoint: start.yMetersPerPoint } : start, saved));
  const [separateY, setSeparateY] = useState(start.yMetersPerPoint != null);
  const [prec, setPrec] = useState(() => precisionValue(start, 'd2'));

  const pages: number[] | null =
    pagesMode === 'current'
      ? [currentPage]
      : pagesMode === 'selected'
        ? [...selected].sort((a, b) => a - b)
        : pagesMode === 'all'
          ? pagesOf('all', '', pageCount)
          : pagesOf('range', pagesText, pageCount);

  const presetScale = (key: string): Scale | null =>
    (key.startsWith('saved:') ? saved.find((s) => `saved:${s.label}` === key)?.scale : SCALE_PRESETS.find((p) => p.label === key)?.scale) ?? null;

  const fromSide = (side: Side, opts?: { feetInches: boolean; precision: number }): Scale | null => {
    const paper = parseScaleNumber(side.paper);
    const real = parseScaleNumber(side.real);
    return paper && real ? scaleFromParts(paper, side.paperUnit, real, side.realUnit, opts) : null;
  };

  // The unit that lengths will be shown in decides whether inch fractions are offered.
  const xBase = mode === 'preset' ? presetScale(xPreset) : fromSide(x);
  const unit = xBase?.unit ?? x.realUnit;
  const fracOk = unit === 'ft' || unit === 'in';
  const precValue = !fracOk && prec[0] === 'f' ? 'd2' : prec;

  const built = ((): Scale | null => {
    if (!xBase) return null;
    const feetInches = precValue[0] === 'f';
    const precision = Number(precValue.slice(1));
    const builtin = SCALE_PRESETS.find((p) => closeScale(p.scale, xBase));
    const next: Scale = { ...(builtin?.scale ?? xBase), feetInches, precision };
    // Area and volume wording set elsewhere stays with the page.
    if (scale?.areaUnit) next.areaUnit = scale.areaUnit;
    if (scale?.volumeUnit) next.volumeUnit = scale.volumeUnit;
    if (scale?.areaLabel) next.areaLabel = scale.areaLabel;
    if (scale?.volumeLabel) next.volumeLabel = scale.volumeLabel;
    if (scale?.anglePrecision != null) next.anglePrecision = scale.anglePrecision;
    if (separateY) {
      const yScale = mode === 'preset' ? presetScale(yPreset) : fromSide(y);
      if (!yScale) return null;
      next.yMetersPerPoint = yScale.metersPerPoint;
    }
    return next;
  })();

  const canSave = !!built && !SCALE_PRESETS.some((p) => closeScale(p.scale, built)) && !saved.some((s) => closeScale(s.scale, built));

  const submit = () => {
    if (pages?.length && built) onApply(pages, built);
  };

  const presetSelect = (axis: 'X' | 'Y', value: string, onChange: (v: string) => void) => {
    const current = value.startsWith('saved:') ? undefined : SCALE_PRESETS.find((p) => p.label === value);
    // A scale from the other measurement system (a metric ratio while working in imperial) still has to appear.
    const outside = current && !groups.includes(current.group);
    return (
      <select className="scale-preset" aria-label={`${axis} scale preset`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Choose a preset
        </option>
        {outside && <option value={current.label}>{current.label}</option>}
        {saved.length > 0 && (
          <optgroup label="Saved">
            {saved.map((s) => (
              <option key={s.label} value={`saved:${s.label}`}>
                {s.label}
              </option>
            ))}
          </optgroup>
        )}
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {SCALE_PRESETS.filter((p) => p.group === group).map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  };

  const equation = (axis: 'X' | 'Y', side: Side, set: (s: Side) => void) => {
    const units = unitsFor(system, LENGTH_UNITS, side.realUnit);
    return (
      <div className="scale-eq">
        <input aria-label={`${axis} paper length`} value={side.paper} aria-invalid={!parseScaleNumber(side.paper)} onChange={(e) => set({ ...side, paper: e.target.value })} />
        <select aria-label={`${axis} paper unit`} value={side.paperUnit} onChange={(e) => set({ ...side, paperUnit: e.target.value as PaperUnit })}>
          {PAPER_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <span className="scale-eq-sign">=</span>
        <input aria-label={`${axis} real length`} value={side.real} aria-invalid={!parseScaleNumber(side.real)} onChange={(e) => set({ ...side, real: e.target.value })} />
        <select aria-label={`${axis} real unit`} value={side.realUnit} onChange={(e) => set({ ...side, realUnit: e.target.value as LengthUnit })}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal scale-dialog"
        role="dialog"
        aria-label="Apply scale to pages"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Apply Scale to Pages</h3>
        <div className="scale-grid">
          <span className="scale-k">Pages:</span>
          <div className="scale-pages">
            <div className="row">
              <select aria-label="Pages" value={pagesMode} onChange={(e) => setPagesMode(e.target.value as PagesMode)}>
                <option value="current">Current ({currentPage + 1})</option>
                {selected.length > 1 && <option value="selected">Selected ({rangeText(selected)})</option>}
                <option value="all">All ({pageCount})</option>
                <option value="range">Page range…</option>
              </select>
              {pagesMode === 'range' && (
                <input autoFocus aria-label="Page range" placeholder="e.g. 3-5 or 1,5" value={pagesText} aria-invalid={pagesText !== '' && !pages} onChange={(e) => setPagesText(e.target.value)} />
              )}
            </div>
            <small>e.g. 3-5 or 1,5</small>
          </div>

          <span className="scale-k">Scale:</span>
          <div className="scale-mode">
            <label className="check">
              <input type="radio" name="scale-mode" checked={mode === 'preset'}
                onChange={() => {
                  setMode('preset');
                  // Keep what was typed when it is a preset.
                  const typed = fromSide(x);
                  if (typed) setXPreset(presetKey(typed, saved));
                  const typedY = fromSide(y);
                  if (typedY) setYPreset(presetKey(typedY, saved));
                }}
              />{' '}
              Preset
            </label>
            <label className="check">
              <input type="radio" name="scale-mode" checked={mode === 'custom'} onChange={() => setMode('custom')} /> Custom
            </label>
            <span className="spacer" />
            <button type="button" className="btn small" disabled={!onCalibrate} title="Draw a line of known length on the page" onClick={() => onCalibrate?.()}>
              Calibrate
            </button>
            <button
              type="button"
              className="btn small"
              disabled={!canSave}
              title={canSave ? 'Save this scale in the preset list' : 'This scale is already a preset'}
              onClick={() => {
                if (!built) return;
                const label = scaleEquation(built);
                const next = [{ label, scale: { ...built, label } }, ...saved.filter((s) => s.label !== label)];
                writePresets(next);
                setSaved(next);
              }}
            >
              + Add Preset
            </button>
          </div>

          <span className="scale-k">{separateY ? 'X:' : ''}</span>
          {mode === 'preset'
            ? presetSelect('X', xPreset, (v) => {
                setXPreset(v);
                const chosen = presetScale(v);
                if (chosen) {
                  setPrec(precisionValue(chosen, prec));
                  setX(sideOf(chosen));
                }
              })
            : equation('X', x, setX)}

          {separateY && (
            <>
              <span className="scale-k">Y:</span>
              {mode === 'preset'
                ? presetSelect('Y', yPreset, (v) => {
                    setYPreset(v);
                    const chosen = presetScale(v);
                    if (chosen) setY(sideOf(chosen));
                  })
                : equation('Y', y, setY)}
            </>
          )}

          <span />
          <label className="check">
            <input
              type="checkbox"
              checked={separateY}
              onChange={(e) => {
                const on = e.target.checked;
                setSeparateY(on);
                // Y starts out matching X, ready to be changed.
                if (on) {
                  setY(x);
                  setYPreset(xPreset);
                }
              }}
            />
            Separate Y Scale
          </label>

          <span className="scale-k">Precision:</span>
          <select aria-label="Precision" value={precValue} onChange={(e) => setPrec(e.target.value)}>
            {DECIMAL_PRECISIONS.map((p) => (
              <option key={`d${p}`} value={`d${p}`}>
                {precisionText(`d${p}`)}
              </option>
            ))}
            {fracOk &&
              FRACTION_PRECISIONS.map((p) => (
                <option key={`f${p}`} value={`f${p}`}>
                  {precisionText(`f${p}`)}
                </option>
              ))}
          </select>
        </div>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={!pages?.length || !built}>
            Apply Scale
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function presetKey(scale: Scale, saved: readonly SavedPreset[]): string {
  const hit = matchPreset(scale, saved);
  if (!hit) return '';
  return hit.kind === 'saved' ? `saved:${hit.label}` : hit.label;
}
