import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { platformKeys } from '../commands/keys';

/** One entry in a right-click menu. `items` makes it a submenu; `sep` a separator line. */
export type MenuEntry =
  | { sep: true }
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      /** Drawn before the label (a tick replaces it while checked). */
      icon?: ReactNode;
      /** Drawn at the start of the label, kept while checked (a tool's own icon in a checklist). */
      lead?: ReactNode;
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
  /** A long flat list (no submenus) that scrolls when taller than the window. */
  scroll?: boolean;
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

function MenuList({ items, onDone, sub, scroll, dir = 'r' }: { items: MenuEntry[]; onDone: () => void; sub?: boolean; scroll?: boolean; dir?: 'l' | 'r' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState({ x: false, y: 0, shift: 0 });
  // Submenus open beside their parent item: on the side the parent chain already goes (so a third
  // menu never lands back over the first), else the side with room. Re-measured on hover because
  // the root menu is clamped into the window after its submenus first mount.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!sub || !el || !host) return;
    const win = el.ownerDocument.defaultView ?? window;
    const measure = () => {
      const pr = host.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Room for this menu plus the widest menu that can open from it, so the next level does not
      // have to fold back over this one's parent.
      let deep = 0;
      el.querySelectorAll<HTMLElement>('.ctx-sub').forEach((d) => (deep = Math.max(deep, d.offsetWidth)));
      const right = win.innerWidth - 4 - pr.right;
      const left = pr.left - 4;
      const x = dir === 'l' ? !(left < w + deep && right > left) : right < w + deep && left > right;
      // Whichever side is used, slide the menu back inside the window rather than crossing over its parent.
      const shift = Math.min(0, (x ? left : right) - w);
      setFlip((f) => {
        const y = Math.min(0, win.innerHeight - 4 - (pr.top - 5 + h));
        return f.x === x && f.y === y && f.shift === shift ? f : { x, y, shift };
      });
    };
    measure();
    host.addEventListener('mouseenter', measure);
    host.addEventListener('focusin', measure);
    return () => {
      host.removeEventListener('mouseenter', measure);
      host.removeEventListener('focusin', measure);
    };
  }, [sub, dir]);
  return (
    <div
      ref={ref}
      className={`ctx-menu${sub ? ' ctx-sub' : ''}${flip.x ? ' flip' : ''}${scroll ? ' ctx-scroll' : ''}`}
      role="menu"
      style={sub && (flip.y || flip.shift) ? { marginTop: flip.y, ...(flip.x ? { marginRight: flip.shift } : { marginLeft: flip.shift }) } : undefined}
    >
      {tidy(items).map((it, i) => {
        if ('sep' in it) return <div key={`s${i}`} className="menu-sep" role="separator" />;
        if (it.items) {
          const children = tidy(it.items);
          return (
            <div key={`${i}:${it.label}`} className="ctx-has-sub">
              <button role="menuitem" aria-haspopup="menu" className="menu-item has-sub" disabled={it.disabled || !children.length}>
                <span className="check">{it.checked ? '✓' : (it.icon ?? '')}</span>
                <span className="label">
              {it.lead != null && <span className="lead">{it.lead}</span>}
              {it.label}
            </span>
                <span className="sc">▸</span>
              </button>
              {!it.disabled && children.length > 0 && <MenuList items={children} onDone={onDone} sub dir={flip.x ? 'l' : 'r'} />}
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
            <span className="check">{it.checked ? '✓' : (it.icon ?? '')}</span>
            <span className="label">
              {it.lead != null && <span className="lead">{it.lead}</span>}
              {it.label}
            </span>
            {it.shortcut ? <span className="sc">{platformKeys(it.shortcut)}</span> : <span />}
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
    // The menu can sit in a pop-out window, which has its own size.
    const win = el.ownerDocument.defaultView ?? window;
    setPos({
      left: Math.max(4, Math.min(menu.x, win.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(menu.y, win.innerHeight - r.height - 4)),
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
    // The document and window the menu is shown in (a pop-out window has its own).
    const doc = ref.current?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;
    doc.addEventListener('pointerdown', away, true);
    doc.addEventListener('wheel', away, true);
    doc.addEventListener('keydown', key);
    win.addEventListener('resize', close);
    win.addEventListener('blur', close);
    return () => {
      doc.removeEventListener('pointerdown', away, true);
      doc.removeEventListener('wheel', away, true);
      doc.removeEventListener('keydown', key);
      win.removeEventListener('resize', close);
      win.removeEventListener('blur', close);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-root" style={pos} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={menu.items} onDone={onClose} scroll={menu.scroll} />
    </div>
  );
}
