import { useState } from 'react';
import { unitsFor, useSettings } from '../settings/settings';
import { parseLength, type LengthUnit, type Scale } from '@nb/measure';
import { calibrateFromLine, calibrationLength, hasSeparateY } from '../measure/axisScale';

const UNITS: LengthUnit[] = ['ft', 'in', 'yd', 'mi', 'm', 'cm', 'mm', 'km'];

interface Props {
  /** The line the user drew, as its page-point offset (dx, dy). */
  delta: readonly [number, number];
  /** The scale being calibrated (the page's, or its viewport's), if any. */
  current: Scale | null;
  pageCount: number;
  /** Default for "apply to all pages": true when the document has no scales yet. */
  defaultAllPages: boolean;
  onApply: (scale: Scale, allPages: boolean) => void;
  /** The line was drawn in this viewport: the scale is for it alone. */
  viewportName?: string;
  onCancel: () => void;
}

/** Asks for the real length of a calibration line and turns it into a page scale. */
export function CalibrateDialog({ delta, current, pageCount, defaultAllPages, viewportName, onApply, onCancel }: Props) {
  const [text, setText] = useState('');
  const { unitSystem: system, lengthUnit } = useSettings();
  const [unit, setUnit] = useState<LengthUnit>(lengthUnit);
  const [allPages, setAllPages] = useState(defaultAllPages);
  const value = parseLength(text, unit);
  // With a separate Y scale the line calibrates one axis (the one it runs along, to start with).
  const separate = hasSeparateY(current);
  const [axis, setAxis] = useState<'x' | 'y'>(Math.abs(delta[1]) > Math.abs(delta[0]) ? 'y' : 'x');
  const outcome = value === null ? null : calibrateFromLine(current, separate ? axis : 'both', delta, value, unit);
  const lineError = separate && 'error' in calibrationLength(delta, axis) ? (calibrationLength(delta, axis) as { error: string }).error : null;

  const submit = () => {
    if (!outcome || 'error' in outcome) return;
    onApply(outcome.scale, allPages);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
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
        <h3>{viewportName ? `Calibrate viewport “${viewportName}”` : 'Calibrate scale'}</h3>
        {separate && (
          <fieldset className="row" aria-label="Axis to calibrate">
            <label className="check">
              <input type="radio" name="calibrate-axis" checked={axis === 'x'} onChange={() => setAxis('x')} />
              Horizontal (X)
            </label>
            <label className="check">
              <input type="radio" name="calibrate-axis" checked={axis === 'y'} onChange={() => setAxis('y')} />
              Vertical (Y)
            </label>
          </fieldset>
        )}
        <p>{separate ? `How long is the ${axis === 'x' ? 'horizontal' : 'vertical'} extent of the line you drew in reality?` : 'How long is the line you drew in reality?'}</p>
        {lineError && (
          <p role="alert" className="error">
            {lineError}
          </p>
        )}
        <div className="row">
          <input
            autoFocus
            value={text}
            placeholder={unit === 'ft' ? `e.g. 25 or 25'-6"` : 'e.g. 12.5'}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={text !== '' && value === null}
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)}>
            {unitsFor(system, UNITS, unit).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        {pageCount > 1 && !viewportName && (
          <label className="check">
            <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} />
            Apply to all {pageCount} pages
          </label>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!outcome || 'error' in outcome}>
            Set scale
          </button>
        </div>
      </form>
    </div>
  );
}
