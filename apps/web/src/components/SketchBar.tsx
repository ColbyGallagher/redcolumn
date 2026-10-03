import { useEffect, useRef, useState } from 'react';
import { MARKUP_LABELS } from '@nb/markup';
import { METERS_PER_UNIT, parseLength, type Scale } from '@nb/measure';
import type { SketchState } from '../markup/MarkupTools';

interface Props {
  sketch: SketchState;
  /** The scale at the point being drawn from (its viewport's, else the page's). */
  scale: Scale;
  onSegment: (lengthPoints: number, angle: number | null) => void;
  onBox: (widthPoints: number, heightPoints: number) => void;
  onCancel: () => void;
  /** Enter on an empty length finishes the shape, as it does on the page. */
  onFinish: () => void;
}

/**
 * Draw to Size: exact lengths and angles (click-drawn shapes and measurements) or widths and
 * heights (rectangles, ellipses, clouds) typed in the page's units. Typing a number while drawing
 * jumps here; Enter places it, Tab moves between the fields.
 */
export function SketchBar({ sketch, scale, onSegment, onBox, onCancel, onFinish }: Props) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const toPoints = (text: string) => {
    const v = parseLength(text, scale.unit);
    return v === null ? null : (v * METERS_PER_UNIT[scale.unit]) / scale.metersPerPoint;
  };
  const box = sketch.mode === 'box';

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
  }, [sketch.from[0], sketch.from[1], sketch.mode]);

  const aPoints = toPoints(a);
  const angle = b.trim() === '' ? null : Number(b);
  const bPoints = box ? toPoints(b) : null;
  const ready = box ? aPoints !== null && bPoints !== null : aPoints !== null && (angle === null || Number.isFinite(angle));

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
        if (box) onBox(aPoints!, bPoints!);
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
      <span className="sketch-title">Draw to Size · {MARKUP_LABELS[sketch.type]}</span>
      <label>
        {box ? 'Width' : 'Length'}
        <input ref={first} value={a} onChange={(e) => setA(e.target.value)} placeholder={scale.unit === 'ft' ? `12'-6"` : '0'} aria-label={box ? 'Width' : 'Length'} />
      </label>
      <label>
        {box ? 'Height' : 'Angle'}
        <input value={b} onChange={(e) => setB(e.target.value)} placeholder={box ? (scale.unit === 'ft' ? `8'-0"` : '0') : 'toward pointer'} aria-label={box ? 'Height' : 'Angle'} />
        {!box && '°'}
      </label>
      <span className="unit">{scale.unit === 'ft' && scale.feetInches ? 'ft-in' : scale.unit}</span>
      <button type="submit" className="btn small primary" disabled={!ready && (box || !!a.trim())}>
        Place
      </button>
    </form>
  );
}
