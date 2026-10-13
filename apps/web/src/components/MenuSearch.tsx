import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Command } from '../commands/appCommands';
import { shortcutLabel } from '../commands/shortcuts';
import { score } from './CommandPalette';
import { PreferencesDialog, type PrefEntry } from './PreferencesDialog';
import { MARKUP_TOOLS, MEASURE_TOOLS } from './ToolBar';

/** Most rows shown per section, so a one-letter query does not list the whole app. */
const MAX_COMMANDS = 12;
const MAX_SETTINGS = 10;

type Result = { kind: 'command'; command: Command } | { kind: 'setting'; setting: PrefEntry };

const TOOL_ICONS = new Map<string, ReactNode>([...MARKUP_TOOLS, ...MEASURE_TOOLS].map((t) => [`tool.${t.tool}`, t.icon]));

/** How well a preference matches: every word in its label, tab or category; label matches rank first. */
function settingScore(s: PrefEntry, words: string[]): number {
  const label = s.label.toLowerCase();
  const hay = `${label} ${s.tabLabel.toLowerCase()} ${s.categoryLabel.toLowerCase()} preferences settings`;
  let total = 0;
  for (const w of words) {
    const at = hay.indexOf(w);
    if (at < 0) return -1;
    total += label.startsWith(w) ? 0 : label.includes(` ${w}`) ? 1 : at < label.length ? 2 : 3;
  }
  return total;
}

interface Props {
  commands: readonly Command[];
  /** Opens Preferences on the tab that holds this setting. */
  onOpenSetting: (setting: PrefEntry) => void;
}

/** The menu bar's search box: finds any tool, command or preference and runs or opens it. */
export function MenuSearch({ commands, onOpenSetting }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Preferences are indexed from the Preferences dialog itself, the first time the box is used.
  const [prefIndex, setPrefIndex] = useState<PrefEntry[] | null>(null);
  const [wantIndex, setWantIndex] = useState(false);
  const onIndex = useCallback((entries: PrefEntry[]) => setPrefIndex(entries), []);
  const noop = useCallback(() => undefined, []);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const results = useMemo((): Result[] => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const cmds = commands
      .map((c, i) => ({ c, i, s: score(c, words) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => Number(b.c.enabled) - Number(a.c.enabled) || a.s - b.s || a.i - b.i)
      .slice(0, MAX_COMMANDS)
      .map((r): Result => ({ kind: 'command', command: r.c }));
    const seen = new Set<string>();
    const sets = (prefIndex ?? [])
      .map((p, i) => ({ p, i, s: settingScore(p, words) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .filter((r) => {
        const key = `${r.p.tab}:${r.p.label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_SETTINGS)
      .map((r): Result => ({ kind: 'setting', setting: r.p }));
    return [...cmds, ...sets];
  }, [commands, prefIndex, query]);

  const reset = () => {
    setQuery('');
    setActive(0);
    setOpen(false);
    input.current?.blur();
  };
  const runAt = (i: number) => {
    const r = results[i];
    if (!r) return;
    if (r.kind === 'command') {
      if (!r.command.enabled) return;
      reset();
      r.command.run();
    } else {
      reset();
      onOpenSetting(r.setting);
    }
  };
  const move = (by: number) => {
    const next = Math.max(0, Math.min(results.length - 1, active + by));
    setActive(next);
    list.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const firstSetting = results.findIndex((r) => r.kind === 'setting');
  const row = (r: Result, i: number) => {
    const on = i === active;
    if (r.kind === 'command') {
      const c = r.command;
      const sc = shortcutLabel(c.id);
      return (
        <li
          key={`c:${c.id}`}
          id={`menu-search-${i}`}
          data-index={i}
          role="option"
          aria-selected={on}
          aria-disabled={!c.enabled}
          className={`${on ? 'active' : ''}${c.enabled ? '' : ' disabled'}`}
          onMouseMove={() => setActive(i)}
          onClick={() => runAt(i)}
        >
          <span className="ico" aria-hidden="true">
            {TOOL_ICONS.get(c.id) ?? ''}
          </span>
          <span className="name">
            {c.label}
            {c.checked ? ' ✓' : ''}
          </span>
          <span className="where">{c.category}</span>
          {sc && <kbd>{sc}</kbd>}
        </li>
      );
    }
    const s = r.setting;
    return (
      <li key={`s:${s.tab}:${s.label}`} id={`menu-search-${i}`} data-index={i} role="option" aria-selected={on} className={on ? 'active' : ''} onMouseMove={() => setActive(i)} onClick={() => runAt(i)}>
        <span className="ico" aria-hidden="true">
          ⚙
        </span>
        <span className="name">{s.label}</span>
        <span className="where">
          {s.categoryLabel} › {s.tabLabel}
        </span>
      </li>
    );
  };

  const shown = open && query.trim() !== '';
  return (
    <div className="menu-search" ref={root}>
      <svg className="menu-search-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Search tools and settings"
        aria-label="Search tools, commands and settings"
        role="combobox"
        aria-expanded={shown}
        aria-controls="menu-search-list"
        aria-activedescendant={shown && results[active] ? `menu-search-${active}` : undefined}
        onFocus={() => {
          setWantIndex(true);
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (query) setQuery('');
            else reset();
          } else if (e.key === 'ArrowDown') move(1);
          else if (e.key === 'ArrowUp') move(-1);
          else if (e.key === 'PageDown') move(8);
          else if (e.key === 'PageUp') move(-8);
          else if (e.key === 'Enter') runAt(active);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {shown && (
        <ul id="menu-search-list" className="menu-search-drop" ref={list} role="listbox" aria-label="Results">
          {results.map((r, i) => (
            <FragmentWithHead key={i} head={i === 0 && r.kind === 'command' ? 'Tools & Commands' : i === firstSetting ? 'Settings' : null}>
              {row(r, i)}
            </FragmentWithHead>
          ))}
          {!results.length && <li className="empty">{prefIndex ? 'Nothing matches' : 'Searching…'}</li>}
        </ul>
      )}
      {wantIndex && !prefIndex && <PreferencesDialog author="" onAuthor={noop} onClose={noop} onIndex={onIndex} />}
    </div>
  );
}

function FragmentWithHead({ head, children }: { head: string | null; children: ReactNode }) {
  return (
    <>
      {head && (
        <li className="head" role="presentation">
          {head}
        </li>
      )}
      {children}
    </>
  );
}
