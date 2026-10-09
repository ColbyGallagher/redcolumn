import { useMemo, useRef, useState } from 'react';
import type { Command } from '../commands/appCommands';
import { shortcutLabel } from '../commands/shortcuts';

interface Props {
  commands: readonly Command[];
  onClose: () => void;
}

/** How well a command matches the query: every word must appear; earlier and label matches rank first. */
function score(c: Command, words: string[]): number {
  const label = c.label.toLowerCase();
  const hay = `${label} ${c.category.toLowerCase()} ${c.id.toLowerCase()}`;
  let total = 0;
  for (const w of words) {
    const at = hay.indexOf(w);
    if (at < 0) return -1;
    total += label.startsWith(w) ? 0 : label.includes(` ${w}`) ? 1 : at < label.length ? 2 : 3;
  }
  return total;
}

/** Help → Find Tools + Commands (Ctrl+Shift+K): type to find any command and run it. */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands
      .map((c, i) => ({ c, i, s: words.length ? score(c, words) : 0 }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => Number(b.c.enabled) - Number(a.c.enabled) || a.s - b.s || a.i - b.i)
      .map((r) => r.c);
  }, [commands, query]);

  const runAt = (i: number) => {
    const c = results[i];
    if (!c?.enabled) return;
    onClose();
    c.run();
  };
  const move = (by: number) => {
    const next = Math.max(0, Math.min(results.length - 1, active + by));
    setActive(next);
    list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div className="modal palette" role="dialog" aria-label="Find tools and commands" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Find a tool or command…"
          aria-label="Search commands"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `palette-${results[active]!.id}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') move(1);
            else if (e.key === 'ArrowUp') move(-1);
            else if (e.key === 'PageDown') move(8);
            else if (e.key === 'PageUp') move(-8);
            else if (e.key === 'Enter') runAt(active);
            else return;
            e.preventDefault();
          }}
        />
        <ul id="palette-list" ref={list} role="listbox">
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`palette-${c.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={!c.enabled}
              className={`${i === active ? 'active' : ''}${c.enabled ? '' : ' disabled'}`}
              onMouseMove={() => setActive(i)}
              onClick={() => runAt(i)}
            >
              <span className="cat">{c.category}</span>
              <span className="name">
                {c.label}
                {c.checked ? ' ✓' : ''}
              </span>
              {shortcutLabel(c.id) && <kbd>{shortcutLabel(c.id)}</kbd>}
            </li>
          ))}
          {!results.length && <li className="empty">No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}
