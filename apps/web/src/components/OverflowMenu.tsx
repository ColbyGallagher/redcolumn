import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPopup } from './useFloatingPopup';

export interface OverflowItem {
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  /** Draws a rule above this item. */
  separated?: boolean;
}

/** One button that opens a list of actions: where a row of buttons no longer fits. */
export function OverflowMenu({ label, items, disabled }: { label: string; items: OverflowItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
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
  return (
    <div className="overflow-menu" ref={root}>
      <button type="button" className="btn small" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label} ▾
      </button>
      {open && floating && createPortal(
        <div className="overflow-pop" role="menu" ref={pop} style={{ ...floating, minWidth: undefined }}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`overflow-item${item.separated ? ' separated' : ''}`}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
