import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FONT_FAMILIES, cssFontFamily } from '@nb/markup';
import { desktop } from '../desktop/host';
import { buildFontList, loadRecentFonts, rememberFont, type FontEntry } from '../fonts/fontList';

type Sys = typeof import('../fonts/systemFonts');
let sysPromise: Promise<Sys> | null = null;
/** The fonts module (and its font reader) is only loaded once a picker needs it. */
const loadSys = () => (sysPromise ??= import('../fonts/systemFonts'));

/** Installed family names, once listed in this window (shared by every picker). */
let installedNames: string[] | null = null;

const GROUP_LABEL: Record<FontEntry['group'], string> = { standard: 'Standard', recent: 'Recent', installed: 'Installed' };

/**
 * The font choice for text: the three standard fonts, then recently used fonts, then the fonts
 * installed on the computer, each name shown in its own face, with type-to-filter. In the desktop
 * app installed fonts are listed straight away; in a browser they come after "Show installed
 * fonts…", which asks permission. `mixed` shows that a selection holds several fonts.
 */
export function FontPicker({ value, onChange, mixed = false, className = '', title = 'Font', label }: { value: string | undefined; onChange: (family: string) => void; mixed?: boolean; className?: string; title?: string; label?: string }) {
  const [openList, setOpenList] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecentFonts());
  const [installed, setInstalled] = useState<string[] | null>(installedNames);
  const [asking, setAsking] = useState(false);
  const [sys, setSys] = useState<Sys | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const current = value || 'sans';

  const show = useCallback(async () => {
    setAsking(true);
    try {
      const mod = await loadSys();
      setSys(mod);
      const families = await mod.listSystemFonts();
      if (families.length) {
        installedNames = families.map((f) => f.family);
        setInstalled(installedNames);
      }
    } finally {
      setAsking(false);
    }
  }, []);

  // Opening: place the list under the button, refresh the recent list, and load installed fonts where that needs no permission prompt.
  useEffect(() => {
    if (!openList) return;
    setRecent(loadRecentFonts());
    const r = button.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const up = below < 200 && above > below;
      const maxHeight = Math.max(160, Math.min(360, up ? above : below));
      setPlace({ left: Math.max(4, Math.min(r.left, window.innerWidth - 260)), top: up ? Math.max(4, r.top - maxHeight - 2) : r.bottom + 2, width: Math.max(r.width, 240), maxHeight });
    }
    input.current?.focus();
    if (installedNames) {
      void loadSys().then(setSys);
      return;
    }
    if (desktop()?.fonts) {
      void show();
      return;
    }
    // A browser that was allowed before lists without asking again.
    void (async () => {
      try {
        const status = await navigator.permissions?.query({ name: 'local-fonts' as PermissionName });
        if (status?.state === 'granted') void show();
      } catch {
        // No permissions API or no such permission: the button asks.
      }
    })();
  }, [openList, show]);

  useEffect(() => {
    if (!openList) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [openList]);

  // A value that is not a standard font gets its own face loaded, so the button shows it too.
  useEffect(() => {
    if (current !== 'sans' && current !== 'serif' && current !== 'mono' && !sys) void loadSys().then(setSys);
  }, [current, sys]);

  const entries = useMemo(() => buildFontList({ installed: installed ?? [], recent, current: mixed ? null : current, filter, missing: (f) => sys?.isFontMissing(f) ?? false }), [installed, recent, current, mixed, filter, sys]);
  useEffect(() => setActive(0), [filter, openList]);
  useEffect(() => {
    if (openList) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, openList, id]);

  const choose = (entry: FontEntry) => {
    setRecent(rememberFont(entry.value));
    setOpenList(false);
    setFilter('');
    onChange(entry.value);
    button.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(entries.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(entries.length - 1);
    else if (e.key === 'Enter') {
      const entry = entries[active];
      if (entry) choose(entry);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpenList(false);
      if (e.key === 'Escape') button.current?.focus();
    } else return;
    if (e.key !== 'Tab') e.preventDefault();
    e.stopPropagation();
  };

  const std = FONT_FAMILIES.find((f) => f.value === current);
  const shownName = mixed ? 'Mixed' : (std?.label ?? current);
  const canAsk = !installed && !desktop()?.fonts && typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';
  const unavailable = !installed && !desktop()?.fonts && !canAsk;

  return (
    <span className={`font-picker ${className}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="font-picker-button"
        title={title}
        aria-label={label ?? title}
        aria-haspopup="listbox"
        aria-expanded={openList}
        style={mixed ? undefined : { fontFamily: cssFontFamily(current) }}
        onClick={() => setOpenList((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpenList(true);
          }
        }}
      >
        <span className="font-picker-name">{shownName}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {openList && place && (
        <div className="font-picker-pop" style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }} onKeyDown={onKey}>
          <input
            ref={input}
            className="font-picker-filter"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={entries[active] ? `${id}-${active}` : undefined}
            aria-label="Filter fonts"
            placeholder="Type to filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="font-picker-list" role="listbox" id={`${id}-list`} aria-label={title}>
            {entries.map((f, i) => (
              <div key={f.value}>
                {(i === 0 || entries[i - 1]!.group !== f.group) && (
                  <div className="font-picker-group" role="presentation">
                    {GROUP_LABEL[f.group]}
                  </div>
                )}
                <div
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={!mixed && f.value === current}
                  className={`font-picker-option${i === active ? ' active' : ''}${!mixed && f.value === current ? ' selected' : ''}`}
                  style={{ fontFamily: f.css }}
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(f)}
                >
                  {f.label}
                  {f.missing && <span className="font-picker-missing"> (not installed)</span>}
                </div>
              </div>
            ))}
            {!entries.length && <div className="font-picker-empty">No font matches.</div>}
          </div>
          {canAsk && (
            <button type="button" className="font-picker-show" disabled={asking} onClick={() => void show()}>
              {asking ? 'Loading fonts…' : 'Show installed fonts…'}
            </button>
          )}
          {unavailable && <div className="font-picker-hint">This browser can’t list installed fonts. Chrome or Edge can, or use the desktop app.</div>}
        </div>
      )}
    </span>
  );
}
