import { Fragment, useMemo, useRef, useState } from 'react';
import { assembliesFromJson, assembliesToJson, mergeAssemblies, type Assembly, type AssemblyItem, type CustomColumn } from '@nb/markup';
import { assemblyProblems, MEASURED_NAMES, type ItemQuantity } from '../assemblies/quantities';
import { loadLibrary, writeLibrary } from '../assemblies/library';
import { starterAssemblies } from '../assemblies/starters';
import { formatNumber } from '../columns/listColumns';
import type { UnitSystem } from '../settings/settings';

interface Props {
  initial: readonly Assembly[];
  readOnly: boolean;
  /** The document's custom columns, which formulas may also use. */
  columns: readonly CustomColumn[];
  /** Measurements using each assembly, so deleting one in use says so. */
  usage: Readonly<Record<string, number>>;
  unitSystem: UnitSystem;
  /** The selected measurement's quantities under an assembly being edited (null when none is selected). */
  preview: ((a: Assembly) => ItemQuantity[]) | null;
  /** What the preview is worked out for, e.g. "Length 24' 6\" on page 3". */
  previewLabel: string;
  onSave: (list: Assembly[]) => void;
  onExportJson: (json: string) => void;
  onClose: () => void;
}

const newItem = (): AssemblyItem => ({ id: crypto.randomUUID(), name: 'New item', unit: 'ea', formula: '[Quantity]' });
const newAssembly = (name: string): Assembly => ({ id: crypto.randomUUID(), name, variables: [], items: [newItem()] });

/** A free name like "New assembly 2". */
function freeName(base: string, list: readonly Assembly[]): string {
  const taken = new Set(list.map((a) => a.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** A number typed in a box: empty is unset, anything else must parse. */
function parseOptional(text: string): number | undefined | null {
  if (!text.trim()) return undefined;
  const n = Number(text.replace(/[,$\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function NumberBox({ value, onChange, label, placeholder, width = 70 }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string; placeholder?: string; width?: number }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [bad, setBad] = useState(false);
  return (
    <input
      aria-label={label}
      value={text}
      placeholder={placeholder}
      style={{ width }}
      aria-invalid={bad}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseOptional(e.target.value);
        setBad(n === null);
        if (n !== null) onChange(n);
      }}
    />
  );
}

/** Tools › Takeoff › Assemblies: the document's assemblies, edited together and saved as one step. */
export function AssembliesDialog({ initial, readOnly, columns, usage, unitSystem, preview, previewLabel, onSave, onExportJson, onClose }: Props) {
  const [list, setList] = useState<Assembly[]>(() => structuredClone([...initial]));
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [message, setMessage] = useState('');
  const [library, setLibrary] = useState(loadLibrary);
  const [menu, setMenu] = useState<'starters' | 'library' | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** The formula box last typed in, which the reference chips insert into. */
  const formulaRef = useRef<{ el: HTMLInputElement; itemId: string } | null>(null);

  const selected = list.find((a) => a.id === selectedId) ?? null;
  const problems = useMemo(() => new Map(list.map((a) => [a.id, assemblyProblems(a, list, columns)])), [list, columns]);
  const valid = [...problems.values()].every((p) => p.size === 0);
  const results = useMemo(() => (selected && preview ? preview(selected) : null), [selected, preview]);

  const patch = (fn: (a: Assembly) => Assembly) => setList((l) => l.map((a) => (a.id === selectedId ? fn(a) : a)));
  const patchItem = (id: string, p: Partial<AssemblyItem>) => patch((a) => ({ ...a, items: a.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const add = (incoming: Assembly[], how: string) => {
    // Copies get new ids, so the same starter added twice is two assemblies.
    const fresh = incoming.map((a) => ({ ...structuredClone(a), id: crypto.randomUUID(), name: freeName(a.name, list) }));
    setList((l) => [...l, ...fresh]);
    setSelectedId(fresh[0]?.id ?? selectedId);
    setMessage(`${how}. Save to apply.`);
    setMenu(null);
  };
  const remove = (a: Assembly) => {
    const used = usage[a.id] ?? 0;
    if (used && !confirm(`${used} measurement${used === 1 ? ' uses' : 's use'} “${a.name}”. Delete it anyway? They keep their measurements but lose its quantities.`)) return;
    const at = list.findIndex((x) => x.id === a.id);
    const next = list.filter((x) => x.id !== a.id);
    setList(next);
    setSelectedId(next[Math.min(at, next.length - 1)]?.id ?? null);
  };
  const insertRef = (name: string) => {
    const f = formulaRef.current;
    const item = f && selected?.items.find((i) => i.id === f.itemId);
    if (!f || !item) return;
    const text = `[${name}]`;
    const at = f.el.selectionStart ?? item.formula.length;
    const end = f.el.selectionEnd ?? item.formula.length;
    patchItem(item.id, { formula: item.formula.slice(0, at) + text + item.formula.slice(end) });
    requestAnimationFrame(() => {
      f.el.focus();
      f.el.setSelectionRange(at + text.length, at + text.length);
    });
  };
  const saveToLibrary = (a: Assembly) => {
    const next = mergeAssemblies(library, [structuredClone(a)]);
    setLibrary(next);
    setMessage(writeLibrary(next) ? `Saved “${a.name}” to My Assemblies, for use in any document.` : 'This browser would not keep My Assemblies (private window or storage full).');
  };

  const p = selected ? problems.get(selected.id)! : new Map<string, string>();
  const fmt = (n: number | null) => (n === null ? '' : formatNumber(n, 2));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal columns-dialog assemblies-dialog" role="dialog" aria-label="Assemblies" onMouseDown={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest('[data-asm-pop]')) setMenu(null); }}>
        <div className="columns-head">
          <h3>Assemblies</h3>
        </div>
        <p className="hint-text asm-intro">
          An assembly turns each measurement into the materials and labour it stands for. Pick one for a measurement in the Measurements panel; the Takeoff Quantities window adds them all up.
        </p>
        {readOnly && <p className="columns-readonly">This document is read-only; assemblies can be viewed and exported but not changed.</p>}

        <div className="columns-body">
          <div className="columns-list">
            <ul aria-label="Assemblies in this document">
              {list.map((a) => (
                <li key={a.id}>
                  <button type="button" className={`col-row${a.id === selectedId ? ' active' : ''}${problems.get(a.id)!.size ? ' invalid' : ''}`} onClick={() => setSelectedId(a.id)}>
                    <span className="col-type-icon" aria-hidden="true">
                      {a.items.length}
                    </span>
                    <span className="col-name">{a.name || 'Untitled'}</span>
                    {!!usage[a.id] && <span className="col-hidden">{usage[a.id]} used</span>}
                  </button>
                </li>
              ))}
              {!list.length && <li className="empty">No assemblies yet. Start from an example or make a new one.</li>}
            </ul>
            <div className="col-add asm-add">
              <button type="button" className="btn small" disabled={readOnly} onClick={() => add([newAssembly(freeName('New assembly', list))], 'Added a new assembly')}>
                + New
              </button>
              <button type="button" className="btn small" disabled={readOnly || !selected} onClick={() => selected && add([{ ...selected, name: `${selected.name} copy` }], `Duplicated “${selected?.name}”`)}>
                Duplicate
              </button>
              <button type="button" className="btn small" disabled={readOnly || !selected} onClick={() => selected && remove(selected)}>
                Delete
              </button>
              <div className="asm-pop" data-asm-pop>
                <button type="button" className="btn small" disabled={readOnly} aria-expanded={menu === 'starters'} onClick={() => setMenu(menu === 'starters' ? null : 'starters')}>
                  Examples ▾
                </button>
                {menu === 'starters' && (
                  <div className="ms-menu up" role="menu">
                    {starterAssemblies(unitSystem).map((a) => (
                      <button key={a.name} type="button" role="menuitem" onClick={() => add([a], `Added the example “${a.name}”`)}>
                        {a.name}
                      </button>
                    ))}
                    <button type="button" role="menuitem" onClick={() => add(starterAssemblies(unitSystem), 'Added every example')}>
                      All examples
                    </button>
                  </div>
                )}
              </div>
              <div className="asm-pop" data-asm-pop>
                <button type="button" className="btn small" disabled={readOnly} aria-expanded={menu === 'library'} title="Assemblies saved in this browser, for any document" onClick={() => setMenu(menu === 'library' ? null : 'library')}>
                  My Assemblies ▾
                </button>
                {menu === 'library' && (
                  <div className="ms-menu up" role="menu">
                    {library.map((a) => (
                      <div key={a.id} className="asm-lib-row">
                        <button type="button" role="menuitem" onClick={() => add([a], `Added “${a.name}” from My Assemblies`)}>
                          {a.name}
                        </button>
                        <button
                          type="button"
                          className="ms-glyph"
                          title={`Remove “${a.name}” from My Assemblies`}
                          aria-label={`Remove ${a.name} from My Assemblies`}
                          onClick={() => {
                            const next = library.filter((x) => x.id !== a.id);
                            setLibrary(next);
                            writeLibrary(next);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {!library.length && <p className="asm-empty">Nothing saved yet. Select an assembly and click Save to My Assemblies.</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="columns-editor">
            {!selected ? (
              <p className="empty">Select an assembly to edit it, or add one.</p>
            ) : (
              <fieldset disabled={readOnly}>
                <label className="col-field">
                  <span>Name</span>
                  <input value={selected.name} aria-invalid={p.has('name')} onChange={(e) => patch((a) => ({ ...a, name: e.target.value }))} />
                  {p.has('name') && <em className="col-error">{p.get('name')}</em>}
                </label>
                <label className="col-field">
                  <span>Notes</span>
                  <input value={selected.description ?? ''} placeholder="How to measure it, what it includes" onChange={(e) => patch((a) => ({ ...a, description: e.target.value || undefined }))} />
                </label>

                <div className="col-field">
                  <span>Variables</span>
                  <small className="hint-text">Numbers the formulas use by name, such as a stud spacing or a wall height. Lengths are in the page’s units (feet or metres).</small>
                  <table className="asm-table">
                    <tbody>
                      {selected.variables.map((v, i) => (
                        <tr key={i}>
                          <td>
                            <input aria-label="Variable name" value={v.name} aria-invalid={p.has(`var:${i}`)} onChange={(e) => patch((a) => ({ ...a, variables: a.variables.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} />
                          </td>
                          <td>
                            <NumberBox key={`${selected.id}:${i}:${selected.variables.length}`} label="Variable value" value={v.value} width={90} onChange={(n) => patch((a) => ({ ...a, variables: a.variables.map((x, j) => (j === i ? { ...x, value: n ?? 0 } : x)) }))} />
                          </td>
                          <td>
                            <button type="button" className="ms-glyph" aria-label={`Remove variable ${v.name}`} title="Remove" onClick={() => patch((a) => ({ ...a, variables: a.variables.filter((_, j) => j !== i) }))}>
                              ×
                            </button>
                          </td>
                          <td className="asm-row-error">{p.get(`var:${i}`) && <em className="col-error">{p.get(`var:${i}`)}</em>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div>
                    <button type="button" className="btn small" onClick={() => patch((a) => ({ ...a, variables: [...a.variables, { name: `Variable ${a.variables.length + 1}`, value: 1 }] }))}>
                      + Variable
                    </button>
                  </div>
                </div>

                <div className="col-field">
                  <span>Items</span>
                  <small className="hint-text">
                    Each item’s quantity per measurement. Waste is added before rounding up; totals round up once, on the total.
                  </small>
                  <div className="asm-refs" aria-label="Insert into the formula">
                    {[...MEASURED_NAMES, ...selected.variables.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), hint: `Variable: ${v.value}` })), ...columns.filter((c) => c.type === 'number' || c.type === 'formula').map((c) => ({ name: c.name, hint: 'Custom column' }))].map((r) => (
                      <button key={r.name} type="button" className="asm-ref" title={r.hint} onMouseDown={(e) => e.preventDefault()} onClick={() => insertRef(r.name)}>
                        [{r.name}]
                      </button>
                    ))}
                  </div>
                  <table className="asm-table asm-items">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Quantity formula</th>
                        <th>Unit</th>
                        <th>Waste %</th>
                        <th title="Round up to a whole number">Round up</th>
                        <th>Unit cost</th>
                        {results && <th className="num">Selected</th>}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item) => {
                        const r = results?.find((x) => x.item.id === item.id);
                        const err = p.get(`item:${item.id}`);
                        return (
                          <Fragment key={item.id}>
                            <tr>
                              <td>
                                <input aria-label="Item name" value={item.name} onChange={(e) => patchItem(item.id, { name: e.target.value })} />
                              </td>
                              <td className="asm-formula">
                                <input
                                  aria-label={`Formula for ${item.name}`}
                                  className="col-formula"
                                  value={item.formula}
                                  aria-invalid={!!err}
                                  spellCheck={false}
                                  onFocus={(e) => (formulaRef.current = { el: e.currentTarget, itemId: item.id })}
                                  onChange={(e) => patchItem(item.id, { formula: e.target.value })}
                                />
                              </td>
                              <td>
                                <input aria-label="Unit" value={item.unit} style={{ width: 64 }} onChange={(e) => patchItem(item.id, { unit: e.target.value })} />
                              </td>
                              <td>
                                <NumberBox key={`${item.id}:w`} label="Waste percent" value={item.waste} placeholder="0" width={56} onChange={(n) => patchItem(item.id, { waste: n || undefined })} />
                              </td>
                              <td className="center">
                                <input type="checkbox" aria-label="Round up" checked={!!item.roundUp} onChange={(e) => patchItem(item.id, { roundUp: e.target.checked || undefined })} />
                              </td>
                              <td>
                                <NumberBox key={`${item.id}:c`} label="Unit cost" value={item.unitCost} placeholder="—" width={70} onChange={(n) => patchItem(item.id, { unitCost: n })} />
                              </td>
                              {results && <td className="num" title={r?.error}>{r?.error ? '⚠' : `${fmt(r?.rounded ?? null)} ${item.unit}`}</td>}
                              <td>
                                <button type="button" className="ms-glyph" aria-label={`Remove ${item.name}`} title="Remove" onClick={() => patch((a) => ({ ...a, items: a.items.filter((i) => i.id !== item.id) }))}>
                                  ×
                                </button>
                              </td>
                            </tr>
                            {err && (
                              <tr className="asm-error-row">
                                <td />
                                <td colSpan={results ? 7 : 6}>
                                  <em className="col-error">{err}</em>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <div>
                    <button type="button" className="btn small" onClick={() => patch((a) => ({ ...a, items: [...a.items, newItem()] }))}>
                      + Item
                    </button>
                  </div>
                  <small className="hint-text">{results ? `“Selected” is worked out for ${previewLabel}.` : 'Select a measurement before opening this window to see its quantities here as you edit.'}</small>
                </div>
              </fieldset>
            )}
          </div>
        </div>

        {message && <p className="columns-message">{message}</p>}
        <div className="actions columns-actions">
          <button type="button" className="btn small" disabled={readOnly} onClick={() => importRef.current?.click()} title="Add assemblies from a file exported from another document">
            Import…
          </button>
          <button type="button" className="btn small" disabled={!list.length} onClick={() => onExportJson(assembliesToJson(list))} title="Save these assemblies as a file to share">
            Export
          </button>
          <button type="button" className="btn small" disabled={!selected || (selected && problems.get(selected.id)!.size > 0)} onClick={() => selected && saveToLibrary(selected)} title="Keep a copy in this browser, for any document">
            Save to My Assemblies
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              type="button"
              className="btn primary"
              disabled={!valid}
              title={valid ? undefined : 'Fix the problems shown in red first'}
              onClick={() => onSave(list.map((a) => ({ ...a, name: a.name.trim(), variables: a.variables.map((v) => ({ ...v, name: v.name.trim() })), items: a.items.map((i) => ({ ...i, name: i.name.trim(), unit: i.unit.trim() })) })))}
            >
              Save
            </button>
          )}
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const incoming = assembliesFromJson(await f.text());
              const next = mergeAssemblies(list, incoming);
              setList(next);
              setSelectedId(incoming[0] ? (next.find((a) => a.name === incoming[0]!.name)?.id ?? selectedId) : selectedId);
              setMessage(`Imported ${incoming.length} assembl${incoming.length === 1 ? 'y' : 'ies'} from ${f.name} (ones with the same name were replaced). Save to apply.`);
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    </div>
  );
}
