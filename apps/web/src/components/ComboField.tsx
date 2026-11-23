import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPopup } from './useFloatingPopup';

/** Standard integer font sizes from 2 to 80 pt, finely spaced at small sizes and wider at large sizes. */
export const FONT_SIZES: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80];

interface Props {
  value: number | undefined;
  /** The dropdown's suggestions; any number between `min` and `max` can be typed instead. */
  options: readonly number[];
  min: number;
  max: number;
  unit: string;
  placeholder?: string;
  title: string;
  disabled?: boolean;
  /** Round displayed and committed values to whole integers. */
  integer?: boolean;
  onChange: (value: number) => void;
  /** Called while hovering/focusing an option in the dropdown, and with null when leaving or closing. */
  onPreview?: (value: number | null) => void;
}

const show = (v: number | undefined, integer?: boolean) => (v === undefined ? '' : String(integer ? Math.round(v) : Math.round(v * 100) / 100));

/** A number field with a dropdown of common values: pick one, or type your own. */
export function ComboField({ value, options, min, max, unit, placeholder, title, disabled, integer, onChange, onPreview }: Props) {
  const shown = show(value, integer);
  const current = value !== undefined && integer ? Math.round(value) : value;
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const floating = useFloatingPopup(root, open);
  useEffect(() => setText(shown), [shown]);
  useEffect(() => {
    if (!open) {
      previewRef.current?.(null);
      return;
    }
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => () => previewRef.current?.(null), []);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) {
      const raw = Math.min(max, Math.max(min, n));
      const clamped = integer ? Math.round(raw) : raw;
      setText(show(clamped, integer));
      if (clamped !== value) onChange(clamped);
    } else setText(shown);
  };
  return (
    <span className={`combo${disabled ? ' disabled' : ''}`} ref={root} title={title}>
      <input
        className="combo-input"
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        aria-label={title}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setText(shown);
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />
      <span className="combo-unit">{unit}</span>
      <button type="button" className="combo-caret" aria-label={`${title}: common values`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        ▾
      </button>
      {open &&
        floating &&
        createPortal(
          <div className="combo-list" role="listbox" ref={list} style={floating} onMouseLeave={() => onPreview?.(null)}>
            {options.map((o) => (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={o === current}
                className={`menu-item${o === current ? ' checked' : ''}`}
                onMouseEnter={() => onPreview?.(o)}
                onFocus={() => onPreview?.(o)}
                onClick={() => {
                  onPreview?.(null);
                  setOpen(false);
                  if (o !== value) onChange(o);
                }}
              >
                {o} {unit}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
