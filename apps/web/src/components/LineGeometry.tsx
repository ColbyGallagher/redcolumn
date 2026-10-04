import type { KeyboardEvent } from 'react';
import { polarPoint, segmentPolar, type Markup, type MarkupStore } from '@nb/markup';
import { formatLength, METERS_PER_UNIT, parseLength, type Scale } from '@nb/measure';

interface Props {
  markup: Markup;
  /** The scale the line is measured at (its viewport's, else its page's). */
  scale: Scale;
  store: MarkupStore;
  readOnly: boolean;
}

/**
 * A line's length, in real units at its scale, and angle (counter-clockwise from pointing right,
 * as on paper): editing either moves the end point and keeps the start where it is.
 */
export function LineGeometry({ markup: m, scale, store, readOnly }: Props) {
  const start = m.points[0]!;
  const { length, angle } = segmentPolar(start, m.points[1]!);
  const shown = formatLength(length * scale.metersPerPoint, scale);
  const shownAngle = Number(angle.toFixed(2));
  const setEnd = (lengthPoints: number, degrees: number) => {
    store.checkpoint();
    store.update(m.id, { points: [start, polarPoint(start, lengthPoints, degrees), ...m.points.slice(2)] });
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    // Typing here must not reach the app's shortcuts.
    e.stopPropagation();
    if (e.key === 'Enter') e.currentTarget.blur();
  };
  return (
    <>
      <label className="field" title="Length at the page's scale; the line's start stays put">
        Length
        <input
          key={`${m.id}:${shown}`}
          className="geometry-length"
          defaultValue={shown}
          disabled={readOnly}
          aria-label="Length"
          onBlur={(e) => {
            const text = e.target.value.replace(/,/g, '').replace(new RegExp(`\\s*${scale.unit}$`), '').trim();
            const v = parseLength(text, scale.unit);
            if (v === null) {
              e.target.value = shown;
              return;
            }
            const points = (v * METERS_PER_UNIT[scale.unit]) / scale.metersPerPoint;
            if (Math.abs(points - length) > 1e-6) setEnd(points, angle);
          }}
          onKeyDown={keys}
        />
      </label>
      <label className="field" title="Angle in degrees, counter-clockwise from pointing right, as on paper">
        Angle
        <input
          key={`${m.id}:${shownAngle}`}
          className="geometry-angle"
          inputMode="decimal"
          defaultValue={shownAngle}
          disabled={readOnly}
          aria-label="Angle"
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (e.target.value.trim() === '' || !Number.isFinite(v)) {
              e.target.value = String(shownAngle);
              return;
            }
            if (Math.abs(v - shownAngle) > 1e-9) setEnd(length, v);
          }}
          onKeyDown={keys}
        />
        °
      </label>
    </>
  );
}
