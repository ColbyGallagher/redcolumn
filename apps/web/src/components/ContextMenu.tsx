import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** One entry in a right-click menu. `items` makes it a submenu; `sep` a separator line. */
export type MenuEntry =
  | { sep: true }
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      danger?: boolean;
      onClick?: () => void;
      items?: MenuEntry[];
      /** Keep the menu open after clicking (checkbox lists). */
      keepOpen?: boolean;
    };

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

export const SEP: MenuEntry = { sep: true };

/** Drops separators at the ends and doubled separators left by hidden items. */
function tidy(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if ('sep' in it && (!out.length || 'sep' in out[out.length - 1]!)) continue;
    out.push(it);
  }
  while (out.length && 'sep' in out[out.length - 1]!) out.pop();
  return out;
}

function MenuList({ items, onDone, sub }: { items: MenuEntry[]; onDone: () => void; sub?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState({ x: false, y: 0 });
  // Submenus open to the left, or shift up, when they would leave the window.
  useLayoutEffect(() => {
    if (!sub || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setFlip({ x: r.right > window.innerWidth - 4, y: Math.min(0, window.innerHeight - 4 - r.bottom) });
  }, [sub]);
  return (
    <div
      ref={ref}
      className={`ctx-menu${sub ? ' ctx-sub' : ''}${flip.x ? ' flip' : ''}`}
      role="menu"
      style={sub && flip.y ? { marginTop: flip.y } : undefined}
    >
      {tidy(items).map((it, i) => {
        if ('sep' in it) return <div key={`s${i}`} className="menu-sep" role="separator" />;
        if (it.items) {
          const children = tidy(it.items);
          return (
            <div key={`${i}:${it.label}`} className="ctx-has-sub">
              <button role="menuitem" aria-haspopup="menu" className="menu-item has-sub" disabled={it.disabled || !children.length}>
                <span className="check">{it.checked ? '✓' : ''}</span>
                <span className="label">{it.label}</span>
                <span className="sc">▸</span>
              </button>
              {!it.disabled && children.length > 0 && <MenuList items={children} onDone={onDone} sub />}
            </div>
          );
        }
        return (
          <button
            key={`${i}:${it.label}`}
            role="menuitem"
            className={`menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              if (!it.keepOpen) onDone();
              it.onClick?.();
            }}
          >
            <span className="check">{it.checked ? '✓' : ''}</span>
            <span className="label">{it.label}</span>
            {it.shortcut ? <span className="sc">{it.shortcut}</span> : <span />}
          </button>
        );
      })}
    </div>
  );
}

/** A right-click menu at a screen position; closes on click-away, Escape, scroll or resize. */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)),
    });
  }, [menu]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const close = () => onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('wheel', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('wheel', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-root" style={pos} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={menu.items} onDone={onClose} />
    </div>
  );
}
