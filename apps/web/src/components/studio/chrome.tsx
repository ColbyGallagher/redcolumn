import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** Nine-digit ids read as NNN-NNN-NNN. Anything else is the real id, unchanged. */
export function studioIdText(id: string): string {
  const m = /^(\d{3})(\d{3})(\d{3})$/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : id;
}

export type StudioSort = 'recent' | 'name' | 'id';

function svg(paths: ReactNode) {
  return (
    <svg className="bb-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {paths}
    </svg>
  );
}

export function DocIcon() {
  return svg(
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M4 1.5h5.2L13 5.2V14.5H4z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M9.1 1.7V5.3H12.7M6 8.2h4.2M6 10.6h3" />
    </>,
  );
}

export function FolderIcon() {
  return svg(<path fill="none" stroke="currentColor" strokeWidth="1.2" d="M1.6 4.2h4.6l1.2-1.6h7v9.2h-12.8z" />);
}

export function PersonIcon() {
  return svg(
    <>
      <circle cx="8" cy="5.2" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M3.4 13.2c.7-2.3 2.4-3.4 4.6-3.4s3.9 1.1 4.6 3.4" />
    </>,
  );
}

export function FilterIcon() {
  return svg(<path fill="none" stroke="currentColor" strokeWidth="1.2" d="M1.8 2.4h12.4L9.4 8v4.6L6.6 14V8z" />);
}

export function RefreshIcon() {
  return svg(
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M13.2 8a5.2 5.2 0 1 1-1.4-3.5" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M13.2 2.2v3.2H10" />
    </>,
  );
}

export function PlusIcon() {
  return svg(<path fill="none" stroke="currentColor" strokeWidth="1.4" d="M8 3v10M3 8h10" />);
}

export function KebabIcon() {
  return svg(
    <>
      <circle cx="8" cy="3.4" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="8" cy="12.6" r="1" fill="currentColor" />
    </>,
  );
}

export function Caret({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'bb-caret open' : 'bb-caret'} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="currentColor" d="M6 3.5 11.5 8 6 12.5z" />
    </svg>
  );
}

export function StudioHeader({ title, onRefresh, plus, filter }: { title: string; onRefresh: () => void; plus?: ReactNode; filter?: ReactNode }) {
  return (
    <div className="bb-head">
      <h2 className="bb-title">{title}</h2>
      <span className="bb-head-actions">
        {plus}
        {filter}
        <button type="button" className="bb-icon-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh">
          <RefreshIcon />
        </button>
      </span>
    </div>
  );
}

export function StudioTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="bb-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>
  );
}

export function StudioRow({
  icon,
  name,
  id,
  selected,
  disabled,
  title,
  onClick,
  trailing,
}: {
  icon: ReactNode;
  name: string;
  id?: string | null;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  const label = id ? studioIdText(id) : '';
  return (
    <li className={selected ? 'selected' : ''}>
      <button type="button" className="bb-row" disabled={disabled} title={title ?? (id ? `${name} (${id})` : name)} onClick={onClick}>
        <span className="bb-row-ico">{icon}</span>
        <span className="bb-name">{name}</span>
        {label && (
          <span className="bb-id" title={id ?? undefined}>
            {label}
          </span>
        )}
      </button>
      {trailing}
    </li>
  );
}

function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, close]);
}

export function StudioMenu({ label, icon, items }: { label: string; icon?: ReactNode; items: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  if (!items.length) return null;
  return (
    <span className="bb-pop" ref={ref}>
      <button type="button" className="bb-icon-btn" aria-label={label} title={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {icon ?? <PlusIcon />}
      </button>
      {open && (
        <div className="bb-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'bb-menu-item danger' : 'bb-menu-item'}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Sort menu. Show-filters that this app cannot answer (my sessions, attended) are omitted. */
export function FilterButton({ sort, desc, onChange }: { sort: StudioSort; desc: boolean; onChange: (sort: StudioSort, desc: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const pick = (key: StudioSort) => {
    if (key === sort) onChange(key, !desc);
    else onChange(key, key === 'recent');
    setOpen(false);
  };
  const item = (key: StudioSort, label: string) => (
    <button key={key} type="button" className="bb-menu-item" role="menuitemradio" aria-checked={sort === key} onClick={() => pick(key)}>
      <span className="bb-check">{sort === key ? '✓' : ''}</span>
      <span className="bb-menu-label-text">{label}</span>
      {sort === key && <span className="bb-sort-arrow">{desc ? '↓' : '↑'}</span>}
    </button>
  );
  return (
    <span className="bb-pop" ref={ref}>
      <button type="button" className={open ? 'bb-icon-btn on' : 'bb-icon-btn'} aria-label="Sort" title="Sort" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <FilterIcon />
      </button>
      {open && (
        <div className="bb-menu" role="menu" aria-label="Sort">
          <div className="bb-menu-label">Sort By</div>
          {item('recent', 'Recently Accessed')}
          {item('name', 'Name')}
          {item('id', 'ID')}
        </div>
      )}
    </span>
  );
}
