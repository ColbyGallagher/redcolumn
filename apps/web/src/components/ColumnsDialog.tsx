import { useMemo, useRef, useState } from 'react';
import { COLUMN_TYPES, columnsFromXml, MARKUP_LABELS, columnsToXml, type ColumnSet, type ColumnType, type CustomColumn, type Markup, type MarkupStatusDef } from '@nb/markup';
import { FUNCTION_NAMES, parseFormula } from '../columns/formula';
import { BUILT_IN_COLUMNS, cellsFor, customKey, type CellContext } from '../columns/listColumns';

interface Props {
  initial: ColumnSet;
  readOnly: boolean;
  /** A markup to preview calculations with (the selected one, else the first). */
  sample: Markup | null;
  cellContext: Omit<CellContext, 'columns' | 'statuses'>;
  profileTemplate: ColumnSet | null;
  onSave: (set: ColumnSet) => void;
  onSaveTemplate: (set: ColumnSet) => void;
  onExportXml: (xml: string) => void;
  onClose: () => void;
}

const TYPE_ICONS: Record<ColumnType, string> = { text: 'Aa', multiline: '¶', choice: '▾', number: '#', date: '📅', checkmark: '☑', formula: 'ƒx' };

function formulaError(c: CustomColumn, all: readonly CustomColumn[]): string | null {
  if (c.type !== 'formula') return null;
  if (!c.formula?.trim()) return 'Enter a formula';
  try {
    parseFormula(c.formula);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  const names = new Set([...BUILT_IN_COLUMNS.map((b) => b.label.toLowerCase()), 'comment', 'color', ...all.map((x) => x.name.trim().toLowerCase())]);
  const missing = [...c.formula.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]!.trim()).find((n) => !names.has(n.toLowerCase()));
  return missing !== undefined ? `No column named [${missing}]` : null;
}

/**
 * Custom columns and statuses for the document's markup list →
 * Manage Columns: add text, multiline, dropdown, number, date and calculation columns, mark them
 * required, and define the statuses markups can be given. Shared as XML.
 */
export function ColumnsDialog({ initial, readOnly, sample, cellContext, profileTemplate, onSave, onSaveTemplate, onExportXml, onClose }: Props) {
  const [tab, setTab] = useState<'columns' | 'statuses'>('columns');
  const [columns, setColumns] = useState<CustomColumn[]>(initial.columns);
  const [statuses, setStatuses] = useState<MarkupStatusDef[]>(initial.statuses);
  const [selectedId, setSelectedId] = useState<string | null>(initial.columns[0]?.id ?? null);
  const [newOption, setNewOption] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const formulaRef = useRef<HTMLTextAreaElement>(null);

  const selected = columns.find((c) => c.id === selectedId) ?? null;
  const patch = (p: Partial<CustomColumn>) => setColumns((cs) => cs.map((c) => (c.id === selectedId ? { ...c, ...p } : c)));

  const nameProblem = (c: CustomColumn) => {
    const n = c.name.trim().toLowerCase();
    if (!n) return 'Name is required';
    if (BUILT_IN_COLUMNS.some((b) => b.label.toLowerCase() === n)) return 'A built-in column has this name';
    if (columns.some((o) => o.id !== c.id && o.name.trim().toLowerCase() === n)) return 'Another column has this name';
    return null;
  };
  const problems = columns.map((c) => nameProblem(c) ?? formulaError(c, columns) ?? (c.type === 'choice' && !c.options?.length ? 'Add at least one choice' : null));
  const statusProblem = statuses.some((s) => !s.name.trim()) ? 'Every status needs a name' : null;
  const valid = problems.every((p) => !p) && !statusProblem;

  const preview = useMemo(() => {
    if (!selected || selected.type !== 'formula' || !sample) return null;
    const cells = cellsFor(sample, { ...cellContext, columns, statuses });
    return cells[customKey(selected.id)] ?? null;
  }, [selected, sample, cellContext, columns, statuses]);

  const addColumn = (type: ColumnType) => {
    let n = 1;
    const base = COLUMN_TYPES.find((t) => t.value === type)!.label.replace('Multiline text', 'Notes');
    while (columns.some((c) => c.name.toLowerCase() === (n === 1 ? base : `${base} ${n}`).toLowerCase())) n++;
    const c: CustomColumn = {
      id: crypto.randomUUID(),
      name: n === 1 ? base : `${base} ${n}`,
      type,
      ...(type === 'choice' ? { options: ['Option 1', 'Option 2'] } : {}),
      ...(type === 'formula' ? { formula: '', decimals: 2 } : {}),
    };
    setColumns((cs) => [...cs, c]);
    setSelectedId(c.id);
  };

  /** A punch list: where, which trade, when and who, and a checkmark when done, with punch statuses. */
  const addPunchList = () => {
    const have = new Set(columns.map((c) => c.name.toLowerCase()));
    const add: CustomColumn[] = [
      { id: crypto.randomUUID(), name: 'Location', type: 'text' },
      { id: crypto.randomUUID(), name: 'Trade', type: 'choice', options: ['General', 'Electrical', 'Mechanical', 'Plumbing', 'Fire', 'Finishes', 'Structural'] },
      { id: crypto.randomUUID(), name: 'Assigned To', type: 'text' },
      { id: crypto.randomUUID(), name: 'Due', type: 'date' },
      { id: crypto.randomUUID(), name: 'Done', type: 'checkmark' },
    ].filter((c) => !have.has(c.name.toLowerCase())) as CustomColumn[];
    setColumns((cs) => [...cs, ...add]);
    setStatuses((ss) => {
      const names = new Set(ss.map((x) => x.name.toLowerCase()));
      const punch = [
        { id: 'open', name: 'Open', color: '#dc2626' },
        { id: 'ready', name: 'Ready for Inspection', color: '#d97706' },
        { id: 'closed', name: 'Closed', color: '#16a34a' },
      ].filter((x) => !names.has(x.name.toLowerCase()) && !ss.some((y) => y.id === x.id));
      return [...ss, ...punch];
    });
    setMessage(`Added ${add.length} punch list column(s) and statuses. Save to apply.`);
  };

  const move = (id: string, by: -1 | 1) =>
    setColumns((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + by;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const insertRef = (text: string) => {
    if (!selected) return;
    const el = formulaRef.current;
    const cur = selected.formula ?? '';
    const at = el ? el.selectionStart : cur.length;
    const end = el ? el.selectionEnd : cur.length;
    patch({ formula: cur.slice(0, at) + text + cur.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  const load = (set: ColumnSet, how: string) => {
    setColumns(set.columns);
    setStatuses(set.statuses);
    setSelectedId(set.columns[0]?.id ?? null);
    setMessage(`${how}: ${set.columns.length} column(s), ${set.statuses.length} status(es). Save to apply.`);
  };

  const refsFor = selected ? [...BUILT_IN_COLUMNS.filter((b) => b.key !== 'color').map((b) => b.label), ...columns.filter((c) => c.id !== selected.id).map((c) => c.name)] : [];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal columns-dialog" role="dialog" aria-label="Custom columns" onMouseDown={(e) => e.stopPropagation()}>
        <div className="columns-head">
          <h3>Markup Columns &amp; Statuses</h3>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'columns'} className={tab === 'columns' ? 'active' : ''} onClick={() => setTab('columns')}>
              Custom Columns ({columns.length})
            </button>
            <button role="tab" aria-selected={tab === 'statuses'} className={tab === 'statuses' ? 'active' : ''} onClick={() => setTab('statuses')}>
              Statuses ({statuses.length - 1})
            </button>
          </div>
        </div>
        {readOnly && <p className="columns-readonly">This document is read-only; columns can be viewed and exported but not changed.</p>}

        {tab === 'columns' ? (
          <div className="columns-body">
            <div className="columns-list">
              <ul>
                {columns.map((c, i) => (
                  <li key={c.id}>
                    <button className={`col-row${c.id === selectedId ? ' active' : ''}${problems[i] ? ' invalid' : ''}`} onClick={() => setSelectedId(c.id)}>
                      <span className="col-type-icon">{TYPE_ICONS[c.type]}</span>
                      <span className="col-name">{c.name || 'Untitled'}</span>
                      {c.required && (
                        <span className="req" title="Required">
                          *
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {!columns.length && <li className="empty">No custom columns yet. Add one below.</li>}
              </ul>
              <div className="col-add">
                <span>Add column</span>
                <div className="col-add-grid">
                  {COLUMN_TYPES.map((t) => (
                    <button key={t.value} className="btn small" disabled={readOnly} title={t.hint} onClick={() => addColumn(t.value)}>
                      <span className="col-type-icon">{TYPE_ICONS[t.value]}</span> {t.label}
                    </button>
                  ))}
                </div>
                <button className="btn small" disabled={readOnly} title="Location, Trade, Due date, Assigned to and a Done checkmark, plus Open / Ready for inspection / Closed statuses: a punch list" onClick={addPunchList}>
                  + Punch list columns
                </button>
              </div>
            </div>

            <div className="columns-editor">
              {!selected ? (
                <p className="empty">Select a column to edit it, or add one.</p>
              ) : (
                <fieldset disabled={readOnly}>
                  <label className="col-field">
                    <span>Name</span>
                    <input value={selected.name} aria-invalid={!!nameProblem(selected)} onChange={(e) => patch({ name: e.target.value })} />
                    {nameProblem(selected) && <em className="col-error">{nameProblem(selected)}</em>}
                  </label>
                  <div className="col-field">
                    <span>Type</span>
                    <div className="col-types">
                      {COLUMN_TYPES.map((t) => (
                        <button
                          key={t.value}
                          className={`col-type${selected.type === t.value ? ' active' : ''}`}
                          title={t.hint}
                          onClick={() =>
                            patch({
                              type: t.value,
                              ...(t.value === 'choice' && !selected.options?.length ? { options: ['Option 1', 'Option 2'] } : {}),
                              ...(t.value === 'formula' && selected.formula === undefined ? { formula: '' } : {}),
                            })
                          }
                        >
                          <span className="col-type-icon">{TYPE_ICONS[t.value]}</span>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <small className="hint-text">{COLUMN_TYPES.find((t) => t.value === selected.type)?.hint}</small>
                  </div>

                  {selected.type !== 'formula' && (
                    <label className="col-toggle">
                      <input type="checkbox" checked={!!selected.required} onChange={(e) => patch({ required: e.target.checked })} />
                      <span>
                        <b>Required</b> — markups without a value are flagged in the list
                      </span>
                    </label>
                  )}

                  {selected.type === 'choice' && (
                    <div className="col-field">
                      <span>Choices</span>
                      <ul className="col-options">
                        {(selected.options ?? []).map((o, i) => (
                          <li key={i}>
                            <input
                              value={o}
                              onChange={(e) => patch({ options: selected.options!.map((x, j) => (j === i ? e.target.value : x)) })}
                            />
                            <button className="btn flat" title="Move up" disabled={i === 0} onClick={() => {
                              const next = [...selected.options!];
                              [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                              patch({ options: next });
                            }}>
                              ↑
                            </button>
                            <button className="btn flat" title="Remove" onClick={() => patch({ options: selected.options!.filter((_, j) => j !== i) })}>
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="row">
                        <input
                          value={newOption}
                          placeholder="New choice"
                          onChange={(e) => setNewOption(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newOption.trim()) {
                              patch({ options: [...(selected.options ?? []), newOption.trim()] });
                              setNewOption('');
                            }
                          }}
                        />
                        <button
                          className="btn"
                          disabled={!newOption.trim()}
                          onClick={() => {
                            patch({ options: [...(selected.options ?? []), newOption.trim()] });
                            setNewOption('');
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}

                  {selected.type === 'formula' && (
                    <div className="col-field">
                      <span>Formula</span>
                      <textarea
                        ref={formulaRef}
                        className="col-formula"
                        rows={3}
                        spellCheck={false}
                        value={selected.formula ?? ''}
                        placeholder="[Quantity] * [Unit Cost]"
                        aria-invalid={!!formulaError(selected, columns)}
                        onChange={(e) => patch({ formula: e.target.value })}
                      />
                      <div className="col-insert">
                        <span>Columns</span>
                        {refsFor.map((n) => (
                          <button key={n} className="chip" onClick={() => insertRef(`[${n}]`)}>
                            {n}
                          </button>
                        ))}
                      </div>
                      <div className="col-insert">
                        <span>Functions</span>
                        {FUNCTION_NAMES.map((f) => (
                          <button key={f} className="chip fn" onClick={() => insertRef(`${f}(`)}>
                            {f}
                          </button>
                        ))}
                        {['+', '-', '*', '/', '&', '=', '>', '<'].map((o) => (
                          <button key={o} className="chip op" onClick={() => insertRef(` ${o} `)}>
                            {o}
                          </button>
                        ))}
                      </div>
                      <div className={`col-preview${formulaError(selected, columns) || preview?.error ? ' bad' : ''}`}>
                        {formulaError(selected, columns) ? (
                          <>⚠ {formulaError(selected, columns)}</>
                        ) : !sample ? (
                          <>✓ Formula is valid. Draw a markup to preview its result.</>
                        ) : preview?.error ? (
                          <>⚠ {preview.error}</>
                        ) : (
                          <>
                            ✓ For {sample.subject || MARKUP_LABELS[sample.type]} on page {sample.pageIndex + 1}: <b>{preview?.text || '(empty)'}</b>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {(selected.type === 'number' || selected.type === 'formula') && (
                    <label className="col-field inline">
                      <span>Decimal places</span>
                      <select value={selected.decimals ?? ''} onChange={(e) => patch({ decimals: e.target.value === '' ? undefined : Number(e.target.value) })}>
                        <option value="">Auto</option>
                        {[0, 1, 2, 3, 4].map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {selected.type !== 'formula' && (
                    <label className="col-field">
                      <span>Default value for new markups</span>
                      {selected.type === 'checkmark' ? (
                        <input type="checkbox" checked={selected.defaultValue === 'true'} onChange={(e) => patch({ defaultValue: e.target.checked ? 'true' : undefined })} />
                      ) : selected.type === 'choice' ? (
                        <select value={selected.defaultValue ?? ''} onChange={(e) => patch({ defaultValue: e.target.value || undefined })}>
                          <option value="">(none)</option>
                          {(selected.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={selected.type === 'number' ? 'number' : selected.type === 'date' ? 'date' : 'text'}
                          value={selected.defaultValue ?? ''}
                          onChange={(e) => patch({ defaultValue: e.target.value || undefined })}
                        />
                      )}
                    </label>
                  )}

                  <div className="col-editor-actions">
                    <button className="btn small" disabled={columns[0]?.id === selected.id} onClick={() => move(selected.id, -1)}>
                      Move up
                    </button>
                    <button className="btn small" disabled={columns.at(-1)?.id === selected.id} onClick={() => move(selected.id, 1)}>
                      Move down
                    </button>
                    <span className="grow" />
                    <button
                      className="btn small danger"
                      onClick={() => {
                        if (!confirm(`Delete the column "${selected.name}"? Its values are removed from the list (they stay stored on markups until overwritten).`)) return;
                        const i = columns.findIndex((c) => c.id === selected.id);
                        const rest = columns.filter((c) => c.id !== selected.id);
                        setColumns(rest);
                        setSelectedId(rest[Math.min(i, rest.length - 1)]?.id ?? null);
                      }}
                    >
                      Delete column
                    </button>
                  </div>
                </fieldset>
              )}
            </div>
          </div>
        ) : (
          <div className="statuses-body">
            <p className="hint-text">Statuses markups can be given in the list and Properties. Reviewers see the colour next to each markup.</p>
            <ul className="status-rows">
              {statuses.map((s, i) => (
                <li key={s.id}>
                  <input type="color" value={s.color} disabled={readOnly} onChange={(e) => setStatuses((all) => all.map((x) => (x.id === s.id ? { ...x, color: e.target.value } : x)))} />
                  <input
                    value={s.name}
                    disabled={readOnly || s.id === 'none'}
                    aria-invalid={!s.name.trim()}
                    onChange={(e) => setStatuses((all) => all.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                  />
                  {s.id === 'none' ? (
                    <span className="hint-text">No status</span>
                  ) : (
                    <>
                      <button className="btn flat" title="Move up" disabled={readOnly || i <= 1} onClick={() => setStatuses((all) => {
                        const next = [...all];
                        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                        return next;
                      })}>
                        ↑
                      </button>
                      <button className="btn flat" title="Remove" disabled={readOnly} onClick={() => setStatuses((all) => all.filter((x) => x.id !== s.id))}>
                        ×
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <button
              className="btn small"
              disabled={readOnly}
              onClick={() => setStatuses((all) => [...all, { id: crypto.randomUUID(), name: `Status ${all.length}`, color: '#f59e0b' }])}
            >
              + Add status
            </button>
            {statusProblem && <p className="col-error">{statusProblem}</p>}
          </div>
        )}

        {message && <p className="columns-message">{message}</p>}
        <div className="actions columns-actions">
          <button className="btn small" disabled={readOnly} onClick={() => importRef.current?.click()} title="Load columns and statuses from an XML file">
            Import XML…
          </button>
          <button className="btn small" onClick={() => onExportXml(columnsToXml({ columns, statuses }))} title="Save these columns and statuses as XML to share">
            Export XML
          </button>
          <button className="btn small" disabled={readOnly || !profileTemplate} onClick={() => profileTemplate && load(profileTemplate, 'Loaded profile defaults')} title="Use the columns saved in your profile">
            Load profile defaults
          </button>
          <button
            className="btn small"
            disabled={!valid}
            onClick={() => {
              onSaveTemplate({ columns, statuses });
              setMessage('Saved as your profile’s default columns: new documents start with them.');
            }}
            title="New documents will start with these columns and statuses"
          >
            Set as profile default
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button className="btn primary" disabled={!valid} onClick={() => onSave({ columns: columns.map((c) => ({ ...c, name: c.name.trim() })), statuses })}>
              Save
            </button>
          )}
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".xml,application/xml,text/xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              load(columnsFromXml(await f.text()), `Imported ${f.name}`);
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    </div>
  );
}
