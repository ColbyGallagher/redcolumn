import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useState } from 'react';
import { unitsFor, useSettings } from '../settings/settings';
import { formatLength, METERS_PER_UNIT, parseLength, type LengthUnit, type Scale } from '@nb/measure';

const UNITS: LengthUnit[] = ['ft', 'in', 'yd', 'mi', 'm', 'cm', 'mm', 'km'];

interface Props {
  /** The two reference points picked on the markups, in PDF points. */
  points: readonly [readonly [number, number], readonly [number, number]];
  /** The page's (or viewport's) scale where the reference starts. */
  scale: Scale;
  /** Grow the markups by this factor. */
  onScale: (factor: number) => void;
  /** Pick the new length as two points on the page instead. */
  onPick: () => void;
  onCancel: () => void;
}

/** The real length of a line's run between two points at a scale, in metres. */
function meters(a: readonly [number, number], b: readonly [number, number], scale: Scale): number {
  return Math.hypot((b[0] - a[0]) * scale.metersPerPoint, (b[1] - a[1]) * (scale.yMetersPerPoint ?? scale.metersPerPoint));
}

/**
 * Scale to Length (AutoCAD's Scale › Reference): asks how long the two picked reference points
 * should be apart, and scales the selected markups so they are, the first point staying put.
 */
export function ScaleToLengthDialog({ points, scale, onScale, onPick, onCancel }: Props) {
  const system = useSettings().unitSystem;
  const [unit, setUnit] = useState<LengthUnit>(scale.unit);
  const [text, setText] = useState('');
  const value = parseLength(text, unit);
  const current = meters(points[0], points[1], scale);
  const factor = value !== null && current > 0 ? (value * METERS_PER_UNIT[unit]) / current : null;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (factor) onScale(factor);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>{msg('Scale to length')}</h3>
        <p>
          {keyed(msgParts('The two points are {strong} apart. How far apart should they be?', { strong: <strong>{formatLength(current, scale)}</strong> }))}
        </p>
        <div className="row">
          <input
            autoFocus
            aria-label={msg('New length')}
            value={text}
            placeholder={unit === 'ft' ? msg('e.g. 25 or 25\'-6"') : 'e.g. 12.5'}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={text !== '' && value === null}
          />
          <select aria-label={msg('Unit')} value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)}>
            {unitsFor(system, UNITS, unit).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <p className="scale-note">{factor ? msg('Scales by ×{value}.', { value: +factor.toFixed(4) }) : msg('Lengths are at the page’s scale.')}</p>
        <div className="actions">
          <button type="button" className="btn" title={msg('Pick two points on the page that are the length the reference should be (e.g. a known dimension on the drawing)')} onClick={onPick}>
            {msg('Pick on page…')}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!factor}>
            {msg('Scale')}
          </button>
        </div>
      </form>
    </div>
  );
}
