import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPopup } from './useFloatingPopup';
import { addCustomColor, HEX_COLOR, removeCustomColor } from '../workspace/customColors';
import { updateWorkspace, useWorkspace } from '../workspace/profiles';

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
export function ColorMenu({ label, short, icon, value, onChange, noneLabel, disabled, wide, title }: ColorMenuProps) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState('');
  const custom = useWorkspace().customColors ?? [];
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
  /** Applies a color typed or chosen in the picker and saves it to the Custom row. */
  const useCustom = (color: string, close: boolean) => {
    updateWorkspace((w) => ({ ...w, customColors: addCustomColor(w.customColors ?? [], color) }));
    if (close) pick(color);
    else onChange(color);
  };
  const hexOk = HEX_COLOR.test(hex);
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
          <span className={`color-bar${value ? '' : ' none'}`} style={value ? { background: value } : undefined} />
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
                    title={`${c} (right-click to remove)`}
                    aria-label={`Custom ${c}`}
                    aria-pressed={norm === c}
                    onClick={() => pick(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      updateWorkspace((w) => ({ ...w, customColors: removeCustomColor(w.customColors ?? [], c) }));
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <label className="color-more">
            <input type="color" aria-label={`${label}: more colors`} value={value ?? '#ffffff'} onChange={(e) => useCustom(e.target.value, false)} />
            More colors…
          </label>
          <form
            className="color-hex"
            onSubmit={(e) => {
              e.preventDefault();
              if (hexOk) useCustom(hex.toLowerCase(), true);
            }}
          >
            <input
              type="text"
              aria-label={`${label}: hex`}
              placeholder="#rrggbb"
              maxLength={7}
              spellCheck={false}
              value={hex}
              aria-invalid={hex !== '' && !hexOk}
              onChange={(e) => setHex(e.target.value.trim())}
            />
            <button type="submit" className="btn" disabled={!hexOk}>
              Add
            </button>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}
