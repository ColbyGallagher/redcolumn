import { msg } from '@nb/i18n';
import { useMemo, useRef, useState } from 'react';
import { categoryName } from '../i18n/names';
import type { Command, CommandCategory } from '../commands/appCommands';
import { assignKey, comboOf, DEFAULT_KEYS, formatCombo, keysFor, removeKey, resetKeys } from '../commands/keys';
import { importRevuShortcuts, revu21Preset, revuNote } from '../commands/revuKeys';
import { updateWorkspace, useWorkspace } from '../workspace/profiles';

interface Props {
  commands: readonly Command[];
  onDownload: (name: string, text: string) => void;
  onClose: () => void;
}

const CATEGORIES: CommandCategory[] = ['File', 'Edit', 'View', 'Document', 'Bulk', 'Tools', 'Window', 'Help'];

/** Keys that cannot be shortcuts: they work the page and the dialog itself. */
const RESERVED = new Set(['Escape', 'Enter', 'Tab', 'Shift+Tab']);

/**
 * Keyboard Shortcuts: every command with its shortcuts, which can be changed, removed or
 * reset. Changes belong to the active profile; they export and import as a file.
 */
export function ShortcutsDialog({ commands, onDownload, onClose }: Props) {
  const overrides = useWorkspace().shortcuts;
  const [query, setQuery] = useState('');
  /** The command waiting for a new key press. */
  const [recording, setRecording] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const ids = useMemo(() => commands.map((c) => c.id), [commands]);
  const labels = useMemo(() => new Map(commands.map((c) => [c.id, `${categoryName(c.category)} › ${c.label}`])), [commands]);

  const save = (next: Record<string, readonly string[]>) => updateWorkspace((w) => ({ ...w, shortcuts: next }));
  const record = (id: string, combo: string) => {
    if (RESERVED.has(combo)) {
      setNote(msg('{combo} is kept for finishing and cancelling, so it cannot be a shortcut.', { combo }));
      return;
    }
    const holder = ids.find((other) => other !== id && keysFor(other, overrides).includes(combo));
    save(assignKey(ids, overrides, id, combo));
    setNote(holder ? msg('{combo} moved from {get}.', { combo: formatCombo(combo), get: labels.get(holder) }) : null);
    setRecording(null);
  };

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = commands.filter((c) => {
    const hay = `${c.category} ${categoryName(c.category)} ${c.label} ${keysFor(c.id, overrides).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const changed = Object.keys(overrides).length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal shortcuts-editor"
        role="dialog"
        aria-label={msg('Keyboard shortcuts')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (recording) {
            e.preventDefault();
            if (e.key === 'Escape') {
              setRecording(null);
              return;
            }
            const combo = comboOf(e);
            if (combo) record(recording, combo);
          } else if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{msg('Keyboard Shortcuts')}</h3>
        <p className="pref-hint">{msg('Click a command\'s key box, then press the new shortcut. Changes are saved to the active profile. The defaults follow Revu 21; Import… also reads Revu\'s KeyboardShortcuts.xml.')}</p>
        <input autoFocus value={query} placeholder={msg('Search commands or keys…')} aria-label={msg('Search shortcuts')} onChange={(e) => setQuery(e.target.value)} />
        {note && <p className="pref-hint note">{note}</p>}
        <div className="shortcut-list">
          {CATEGORIES.map((cat) => {
            const rows = shown.filter((c) => c.category === cat);
            if (!rows.length) return null;
            return (
              <section key={cat}>
                <h4>{categoryName(cat)}</h4>
                {rows.map((c) => {
                  const keys = keysFor(c.id, overrides);
                  const custom = c.id in overrides;
                  return (
                    <div key={c.id} className={`shortcut-row${custom ? ' custom' : ''}`}>
                      <span className="name">{c.label}</span>
                      <span className="keys">
                        {keys.map((k) => (
                          <span key={k} className="key-chip">
                            <kbd>{formatCombo(k)}</kbd>
                            <button className="chip-x" title={msg('Remove {combo}', { combo: formatCombo(k) })} onClick={() => save(removeKey(overrides, c.id, k))}>
                              ×
                            </button>
                          </span>
                        ))}
                        <button className={`btn small add-key${recording === c.id ? ' recording' : ''}`} onClick={() => setRecording(recording === c.id ? null : c.id)}>
                          {recording === c.id ? msg('Press keys…') : keys.length ? '+' : msg('Add')}
                        </button>
                        {custom && (
                          <button
                            className="btn small"
                            title={msg('Back to {value}', { value: (DEFAULT_KEYS[c.id] ?? []).map((k) => formatCombo(k)).join(', ') || msg('no shortcut') })}
                            onClick={() => save(resetKeys(overrides, c.id))}
                          >
                            {msg('Reset')}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json,.xml,application/xml,text/xml"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (/\.xml$/i.test(file.name)) {
              // Revu's KeyboardShortcuts.xml, from its settings folder.
              try {
                const r = importRevuShortcuts(await file.text());
                save(r.overrides);
                setNote(revuNote(r.changed, r.unmapped));
              } catch (err) {
                setNote(`${file.name}: ${err instanceof Error ? err.message : String(err)}.`);
              }
              return;
            }
            try {
              const data = JSON.parse(await file.text()) as { format?: string; shortcuts?: Record<string, unknown> };
              if (data.format !== 'nb-shortcuts' || !data.shortcuts) throw new Error('not a shortcuts file');
              const next: Record<string, string[]> = {};
              for (const [id, keys] of Object.entries(data.shortcuts)) if (Array.isArray(keys)) next[id] = keys.filter((k): k is string => typeof k === 'string');
              save(next);
              setNote(msg('Imported shortcuts from {name}.', { name: file.name }));
            } catch {
              setNote(msg('{name} is not a shortcuts file.', { name: file.name }));
            }
          }}
        />
        <div className="actions">
          <button className="btn" title={`A shortcuts file exported here, or Revu's KeyboardShortcuts.xml`} onClick={() => importRef.current?.click()}>
            {msg('Import…')}
          </button>
          <button
            className="btn"
            title={msg('Only Revu 21\'s own shortcuts: keys redcolumn adds (O for Offset, Ctrl+Shift+K for Find Commands…) are removed')}
            onClick={() => {
              if (changed && !confirm(msg('Replace your shortcuts with the Revu 21 preset?'))) return;
              save({ ...revu21Preset() });
              setNote(msg("Revu 21 preset: every shortcut is Revu 21's, and keys Revu does not have are off. Reset All goes back to redcolumn's defaults (Revu's keys plus a few of its own)."));
            }}
          >
            {msg('Revu 21 Preset')}
          </button>
          <button className="btn" onClick={() => onDownload('shortcuts.json', JSON.stringify({ format: 'nb-shortcuts', version: 1, shortcuts: overrides }, null, 2))}>
            {msg('Export…')}
          </button>
          <button className="btn" disabled={!changed} onClick={() => confirm(msg('Put every shortcut back to its default?')) && save({})}>
            {msg('Reset All')}
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            {msg('Done')}
          </button>
        </div>
      </div>
    </div>
  );
}
