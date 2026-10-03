import { useEffect, useRef, useState } from 'react';

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
  onChange: (value: number) => void;
}

const show = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 100) / 100));

/** A number field with a dropdown of common values: pick one, or type your own. */
export function ComboField({ value, options, min, max, unit, placeholder, title, disabled, onChange }: Props) {
  const shown = show(value);
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => setText(shown), [shown]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) {
      const clamped = Math.min(max, Math.max(min, n));
      setText(show(clamped));
      if (clamped !== value) onChange(clamped);
    } else setText(shown);
  };
  return (
    <span className="combo" ref={root} title={title}>
      <input
        className="combo-input"
        type="text"
        inputMode="decimal"
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
            e.currentTarget.blur();
          }
        }}
      />
      <span className="combo-unit">{unit}</span>
      <button type="button" className="combo-caret" aria-label={`${title}: common values`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        ▾
      </button>
      {open && (
        <div className="combo-list" role="listbox">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={o === value}
              className={`menu-item${o === value ? ' checked' : ''}`}
              onClick={() => {
                setOpen(false);
                if (o !== value) onChange(o);
              }}
            >
              {o} {unit}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
