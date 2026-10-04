import { useEffect, useRef, useState } from 'react';
import { MARKUP_LABELS } from '@nb/markup';
import { METERS_PER_UNIT, parseLength, type Scale } from '@nb/measure';
import type { SketchState } from '../markup/MarkupTools';
import { settings, useSettings } from '../settings/settings';

interface Props {
  sketch: SketchState;
  /** The scale at the point being drawn from (its viewport's, else the page's). */
  scale: Scale;
  onSegment: (lengthPoints: number, angle: number | null) => void;
  onBox: (widthPoints: number, heightPoints: number) => void;
  /** Ellipse tool drawing circles: the radius. */
  onCircle: (radiusPoints: number) => void;
  onCancel: () => void;
  /** Enter on an empty length finishes the shape, as it does on the page. */
  onFinish: () => void;
}

/**
 * Draw to Size: exact lengths and angles (click-drawn shapes and measurements) or widths and
 * heights (rectangles, ellipses, clouds) typed in the page's units. Typing a number while drawing
 * jumps here; Enter places it, Tab moves between the fields.
 */
export function SketchBar({ sketch, scale, onSegment, onBox, onCircle, onCancel, onFinish }: Props) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const toPoints = (text: string) => {
    const v = parseLength(text, scale.unit);
    return v === null ? null : (v * METERS_PER_UNIT[scale.unit]) / scale.metersPerPoint;
  };
  const box = sketch.mode === 'box';
  const ellipseAs = useSettings().sketchEllipse;
  // The Ellipse tool draws circles from their centre by one size, else boxes by two.
  const circle = box && sketch.type === 'ellipse' && ellipseAs !== 'ellipse';

  // Start typing a number anywhere while drawing and it lands in the first field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (/^[0-9.]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) first.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    setA('');
    setB('');
  }, [sketch.from[0], sketch.from[1], sketch.mode, circle]);

  const firstLabel = circle ? (ellipseAs === 'diameter' ? 'Diameter' : 'Radius') : box ? 'Width' : 'Length';
  const aPoints = toPoints(a);
  const angle = b.trim() === '' ? null : Number(b);
  const bPoints = box ? toPoints(b) : null;
  const ready = circle ? aPoints !== null : box ? aPoints !== null && bPoints !== null : aPoints !== null && (angle === null || Number.isFinite(angle));

  return (
    <form
      className="sketch-bar"
      onSubmit={(e) => {
        e.preventDefault();
        if (!box && !a.trim()) {
          (document.activeElement as HTMLElement | null)?.blur();
          onFinish();
          return;
        }
        if (!ready) return;
        if (circle) onCircle(ellipseAs === 'diameter' ? aPoints! / 2 : aPoints!);
        else if (box) onBox(aPoints!, bPoints!);
        else onSegment(aPoints!, angle);
        first.current?.focus();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          onCancel();
        }
      }}
    >
      <span className="sketch-title">Draw to Scale · {MARKUP_LABELS[sketch.type]}</span>
      {box && sketch.type === 'ellipse' && (
        <select
          value={ellipseAs}
          aria-label="Draw as"
          title="Ellipse: corner to corner by width and height. Circle: from its centre by radius or diameter."
          onChange={(e) => {
            settings.set({ sketchEllipse: e.target.value as typeof ellipseAs });
            first.current?.focus();
          }}
        >
          <option value="ellipse">Ellipse · width × height</option>
          <option value="radius">Circle · radius</option>
          <option value="diameter">Circle · diameter</option>
        </select>
      )}
      <label>
        {firstLabel}
        <input ref={first} value={a} onChange={(e) => setA(e.target.value)} placeholder={scale.unit === 'ft' ? `12'-6"` : '0'} aria-label={firstLabel} />
      </label>
      {!circle && (
        <label>
          {box ? 'Height' : 'Angle'}
          <input value={b} onChange={(e) => setB(e.target.value)} placeholder={box ? (scale.unit === 'ft' ? `8'-0"` : '0') : 'toward pointer'} aria-label={box ? 'Height' : 'Angle'} />
          {!box && '°'}
        </label>
      )}
      <span className="unit">{scale.unit === 'ft' && scale.feetInches ? 'ft-in' : scale.unit}</span>
      <button type="submit" className="btn small primary" disabled={!ready && (box || !!a.trim())}>
        Place
      </button>
    </form>
  );
}
