import { useState } from 'react';
import { unitsFor, useSettings } from '../settings/settings';
import { calibratedScale, parseLength, type LengthUnit, type Scale } from '@nb/measure';

const UNITS: LengthUnit[] = ['ft', 'in', 'yd', 'mi', 'm', 'cm', 'mm', 'km'];

interface Props {
  /** Length of the line the user drew, in PDF points. */
  lengthPoints: number;
  pageCount: number;
  /** Default for "apply to all pages": true when the document has no scales yet. */
  defaultAllPages: boolean;
  onApply: (scale: Scale, allPages: boolean) => void;
  /** The line was drawn in this viewport: the scale is for it alone. */
  viewportName?: string;
  onCancel: () => void;
}

/** Asks for the real length of a calibration line and turns it into a page scale. */
export function CalibrateDialog({ lengthPoints, pageCount, defaultAllPages, viewportName, onApply, onCancel }: Props) {
  const [text, setText] = useState('');
  const system = useSettings().unitSystem;
  const [unit, setUnit] = useState<LengthUnit>(system === 'metric' ? 'm' : 'ft');
  const [allPages, setAllPages] = useState(defaultAllPages);
  const value = parseLength(text, unit);

  const submit = () => {
    if (value === null) return;
    onApply(calibratedScale(lengthPoints, value, unit), allPages);
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
        <p>How long is the line you drew in reality?</p>
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
          <button type="submit" className="btn primary" disabled={value === null}>
            Set scale
          </button>
        </div>
      </form>
    </div>
  );
}
