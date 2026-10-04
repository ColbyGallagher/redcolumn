import { useState, type KeyboardEvent } from 'react';
import { boundsOf, circleBox, polarPoint, resizedBox, segmentPolar, withSegment, type Markup, type MarkupStore, type Point } from '@nb/markup';
import { formatLength, METERS_PER_UNIT, parseLength, type Scale } from '@nb/measure';

interface Props {
  markup: Markup;
  /** The scale the shape is measured at (its viewport's, else its page's). */
  scale: Scale;
  store: MarkupStore;
  readOnly: boolean;
}

/** Markup types whose geometry Draw to Scale edits in the toolbar. */
export const GEOMETRY_TYPES = new Set(['line', 'arrow', 'rect', 'ellipse', 'polyline']);

/**
 * Draw to Scale: a selected shape's sizes in real units at its scale. Lines take a length and
 * angle (the start stays put), rectangles and ellipses a width and height (the first corner
 * stays put), circles a radius or diameter (the centre stays put), and polylines a length and
 * angle per segment (the points after it move along).
 */
export function ShapeGeometry({ markup: m, scale, store, readOnly }: Props) {
  const setPoints = (points: Point[]) => {
    store.checkpoint();
    store.update(m.id, { points });
  };
  if (m.type === 'rect') {
    const b = boundsOf(m.points.slice(0, 2));
    return (
      <>
        <LengthField label="Width" title="Width at the page's scale; the first corner stays put" points={b.w} scale={scale} readOnly={readOnly} onChange={(w) => setPoints(resizedBox(m, w, b.h))} />
        <LengthField label="Height" title="Height at the page's scale; the first corner stays put" points={b.h} scale={scale} readOnly={readOnly} onChange={(h) => setPoints(resizedBox(m, b.w, h))} />
      </>
    );
  }
  if (m.type === 'ellipse') return <EllipseGeometry markup={m} scale={scale} readOnly={readOnly} onChange={setPoints} />;
  if (m.type === 'polyline') return <PolylineGeometry markup={m} scale={scale} readOnly={readOnly} onChange={setPoints} />;
  const start = m.points[0]!;
  const { length, angle } = segmentPolar(start, m.points[1]!);
  const setEnd = (l: number, a: number) => setPoints([start, polarPoint(start, l, a), ...m.points.slice(2)]);
  return (
    <>
      <LengthField label="Length" title="Length at the page's scale; the line's start stays put" points={length} scale={scale} readOnly={readOnly} onChange={(l) => setEnd(l, angle)} />
      <AngleField angle={angle} readOnly={readOnly} onChange={(a) => setEnd(length, a)} />
    </>
  );
}

/** An ellipse by width and height, or (as a circle) by radius or diameter. */
function EllipseGeometry({ markup: m, scale, readOnly, onChange }: { markup: Markup; scale: Scale; readOnly: boolean; onChange: (points: Point[]) => void }) {
  const b = boundsOf(m.points.slice(0, 2));
  const round = Math.abs(b.w - b.h) <= 1e-6 * Math.max(b.w, b.h, 1);
  const [as, setAs] = useState<'ellipse' | 'circle'>(round ? 'circle' : 'ellipse');
  const centre: Point = [b.x + b.w / 2, b.y + b.h / 2];
  const circle = as === 'circle' && round;
  return (
    <>
      <label className="field" title="Ellipse: width and height. Circle: radius or diameter, about its centre.">
        <select
          value={circle ? 'circle' : 'ellipse'}
          disabled={readOnly}
          aria-label="Shape"
          onChange={(e) => {
            const next = e.target.value as 'ellipse' | 'circle';
            setAs(next);
            // Making it a circle keeps its centre and takes its width as the diameter.
            if (next === 'circle' && !round) onChange(circleBox(centre, b.w / 2));
          }}
        >
          <option value="ellipse">Ellipse</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      {circle ? (
        <>
          <LengthField label="Radius" title="Radius at the page's scale; the centre stays put" points={b.w / 2} scale={scale} readOnly={readOnly} onChange={(r) => onChange(circleBox(centre, r))} />
          <LengthField label="Diameter" title="Diameter at the page's scale; the centre stays put" points={b.w} scale={scale} readOnly={readOnly} onChange={(d) => onChange(circleBox(centre, d / 2))} />
        </>
      ) : (
        <>
          <LengthField label="Width" title="Width at the page's scale; the first corner stays put" points={b.w} scale={scale} readOnly={readOnly} onChange={(w) => onChange(resizedBox(m, w, b.h))} />
          <LengthField label="Height" title="Height at the page's scale; the first corner stays put" points={b.h} scale={scale} readOnly={readOnly} onChange={(h) => onChange(resizedBox(m, b.w, h))} />
        </>
      )}
    </>
  );
}

function PolylineGeometry({ markup: m, scale, readOnly, onChange }: { markup: Markup; scale: Scale; readOnly: boolean; onChange: (points: Point[]) => void }) {
  const [chosen, setChosen] = useState(0);
  const count = m.points.length - 1;
  const i = Math.min(chosen, count - 1);
  const { length, angle } = segmentPolar(m.points[i]!, m.points[i + 1]!);
  let total = 0;
  for (let k = 0; k < count; k++) total += segmentPolar(m.points[k]!, m.points[k + 1]!).length;
  return (
    <>
      <label className="field" title="Segment to edit, counted from the polyline's start">
        Segment
        <select value={i} onChange={(e) => setChosen(Number(e.target.value))}>
          {Array.from({ length: count }, (_, k) => (
            <option key={k} value={k}>
              {k + 1} of {count}
            </option>
          ))}
        </select>
      </label>
      <LengthField
        label="Length"
        title="This segment's length at the page's scale; the points after it move along"
        points={length}
        scale={scale}
        readOnly={readOnly}
        onChange={(l) => onChange(withSegment(m.points, i, l, angle))}
      />
      <AngleField angle={angle} readOnly={readOnly} onChange={(a) => onChange(withSegment(m.points, i, length, a))} />
      <span className="field" title="Total length of all segments">
        Total {formatLength(total * scale.metersPerPoint, scale)}
      </span>
    </>
  );
}

/** Typing here must not reach the app's shortcuts; Enter applies. */
function keys(e: KeyboardEvent<HTMLInputElement>) {
  e.stopPropagation();
  if (e.key === 'Enter') e.currentTarget.blur();
}

/** A length in real units (feet-inches too) for a distance of `points` on the page. */
function LengthField({ label, title, points, scale, readOnly, onChange }: { label: string; title: string; points: number; scale: Scale; readOnly: boolean; onChange: (points: number) => void }) {
  const shown = formatLength(points * scale.metersPerPoint, scale);
  return (
    <label className="field" title={title}>
      {label}
      <input
        key={shown}
        className="geometry-length"
        defaultValue={shown}
        disabled={readOnly}
        aria-label={label}
        onBlur={(e) => {
          const text = e.target.value.replace(/,/g, '').replace(new RegExp(`\\s*${scale.unit}$`), '').trim();
          const v = parseLength(text, scale.unit);
          if (v === null) {
            e.target.value = shown;
            return;
          }
          const next = (v * METERS_PER_UNIT[scale.unit]) / scale.metersPerPoint;
          if (Math.abs(next - points) > 1e-6) onChange(next);
        }}
        onKeyDown={keys}
      />
    </label>
  );
}

/** An angle in degrees, counter-clockwise from pointing right, as on paper. */
function AngleField({ angle, readOnly, onChange }: { angle: number; readOnly: boolean; onChange: (degrees: number) => void }) {
  const shown = Number(angle.toFixed(2));
  return (
    <label className="field" title="Angle in degrees, counter-clockwise from pointing right, as on paper">
      Angle
      <input
        key={shown}
        className="geometry-angle"
        inputMode="decimal"
        defaultValue={shown}
        disabled={readOnly}
        aria-label="Angle"
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (e.target.value.trim() === '' || !Number.isFinite(v)) {
            e.target.value = String(shown);
            return;
          }
          if (Math.abs(v - shown) > 1e-9) onChange(v);
        }}
        onKeyDown={keys}
      />
      °
    </label>
  );
}
