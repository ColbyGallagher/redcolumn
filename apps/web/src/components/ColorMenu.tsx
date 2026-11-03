import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPopup } from './useFloatingPopup';
import { addCustomColor, parseHex, removeCustomColor } from '../workspace/customColors';
import { profiles, updateWorkspace } from '../workspace/profiles';

const NO_COLORS: readonly string[] = [];

/** Office-style palette: a greys row, then the standard hues from light to dark. */
const PALETTE: string[][] = [
  ['#000000', '#404040', '#7f7f7f', '#bfbfbf', '#e5e7eb', '#ffffff'],
  ['#fecaca', '#fed7aa', '#fef9c3', '#bbf7d0', '#bae6fd', '#e9d5ff'],
  ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#c084fc'],
  ['#dc2626', '#ea580c', '#eab308', '#16a34a', '#0284c7', '#9333ea'],
  ['#991b1b', '#9a3412', '#a16207', '#166534', '#075985', '#6b21a8'],
];

interface ColorMenuProps {
  /** What the color is for: names the button and the menu ("Line color", "Fill color"). */
  label: string;
  /** Short word on the button, beside the icon. */
  short: string;
  icon: ReactNode;
  /** Current color; null for none (only when `noneLabel` is set). */
  value: string | null;
  /** The color shown on the button's bar while `value` is null (what "same as line" resolves to). */
  fallback?: string;
  onChange: (color: string | null) => void;
  /** Adds a "No fill"-style entry at the top that sets the color to null. */
  noneLabel?: string;
  disabled?: boolean;
  /** Draws the button as a labelled row control (properties panel) instead of a toolbar button. */
  wide?: boolean;
  title?: string;
}

/**
 * A Word/Excel-style color button: the icon with a bar in the current color under it, and a palette
 * dropdown with "No fill", standard colors and a custom picker.
 */
export function ColorMenu({ label, short, icon, value, fallback, onChange, noneLabel, disabled, wide, title }: ColorMenuProps) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState('');
  const custom = useSyncExternalStore(profiles.subscribe, () => profiles.active().state.customColors) ?? NO_COLORS;
  const native = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const floating = useFloatingPopup(root, open);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (color: string | null) => {
    onChange(color);
    setOpen(false);
  };
  const saveCustom = (color: string) => updateWorkspace((w) => ({ ...w, customColors: addCustomColor(w.customColors ?? [], color) }));
  // The native picker fires `input` all the while it is dragged (a live preview) and `change` once
  // when it is committed; only that one goes in the Custom row.
  useEffect(() => {
    const el = native.current;
    if (!open || !el) return;
    const commit = () => saveCustom(el.value);
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  });
  const forget = (c: string) => updateWorkspace((w) => ({ ...w, customColors: removeCustomColor(w.customColors ?? [], c) }));
  const typed = parseHex(hex);
  const norm = value?.toLowerCase() ?? null;
  return (
    <div className={`color-menu${wide ? ' wide' : ''}`} ref={root}>
      <button
        type="button"
        className={`btn color-btn${open ? ' open' : ''}`}
        disabled={disabled}
        title={title ?? label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="color-btn-icon">
          <span className="field-icon">{icon}</span>
          <span className={`color-bar${value || fallback ? '' : ' none'}`} style={value || fallback ? { background: value ?? fallback } : undefined} />
        </span>
        <span className="field-label">{wide ? (value ?? noneLabel ?? 'None') : short}</span>
        <span className="color-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && floating && createPortal(
        <div className="color-pop" role="dialog" aria-label={label} ref={pop} style={{ ...floating, minWidth: undefined }}>
          <div className="color-pop-title">{label}</div>
          {noneLabel && (
            <button type="button" className={`color-none${value === null ? ' on' : ''}`} onClick={() => pick(null)}>
              <span className="color-swatch none" />
              {noneLabel}
            </button>
          )}
          <div className="color-grid">
            {PALETTE.flatMap((row, r) =>
              row.map((c) => (
                <button
                  key={`${r}${c}`}
                  type="button"
                  className={`color-swatch${norm === c ? ' on' : ''}`}
                  style={{ background: c }}
                  title={c}
                  aria-label={c}
                  aria-pressed={norm === c}
                  onClick={() => pick(c)}
                />
              )),
            )}
          </div>
          {custom.length > 0 && (
            <>
              <div className="color-pop-title">Custom</div>
              <div className="color-grid">
                {custom.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-swatch${norm === c ? ' on' : ''}`}
                    style={{ background: c }}
                    title={`${c} (right-click or press Delete to remove)`}
                    aria-label={`Custom ${c}`}
                    aria-pressed={norm === c}
                    onClick={() => pick(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      forget(c);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault();
                        forget(c);
                      }
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <label className="color-more">
            <input ref={native} type="color" aria-label={`${label}: more colors`} value={value ?? fallback ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
            More colors…
          </label>
          <form
            className="color-hex"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed) return;
              saveCustom(typed);
              setHex('');
              pick(typed);
            }}
          >
            <input
              type="text"
              aria-label={`${label}: hex`}
              placeholder="#rrggbb"
              spellCheck={false}
              value={hex}
              aria-invalid={hex.trim() !== '' && !typed}
              onChange={(e) => setHex(e.target.value)}
            />
            <button type="submit" className="btn" disabled={!typed}>
              Add
            </button>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}
