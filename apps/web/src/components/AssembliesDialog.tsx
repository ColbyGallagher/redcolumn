import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { Fragment, useMemo, useRef, useState } from 'react';
import { estimatingFromJson, estimatingToJson, listCost, mergeAssemblies, type Assembly, type AssemblyItem, type CustomColumn, type Estimating, type Item } from '@nb/markup';
import { FormulaBuilder, type FormulaNameGroup } from './FormulaBuilder';
import { DragHandle, GripIcon, SortButton, useDragReorder } from './ReorderControls';
import { reorderAt, reorderById, sortAlphabetically } from '../assemblies/ordering';
import { assemblyProblems, MEASURED_NAMES, type ItemQuantity } from '../assemblies/quantities';
import { loadLibrary, writeLibrary } from '../assemblies/library';
import { starterGroups } from '../assemblies/starters';
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
  /** The document's catalog items, product lists and templates: items to pick from, and what Export writes with the assemblies. */
  estimating: Estimating;
  onSave: (list: Assembly[]) => void;
  /** An imported estimating file's items, product lists and templates, added to the document right away. */
  onImportEstimating: (incoming: Estimating) => void;
  onExportJson: (json: string) => void;
  /** Opens a help page (by id) in a new window. */
  onHelp?: (page: string) => void;
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

/** The box a formula is typed in. */
type FormulaField = HTMLInputElement | HTMLTextAreaElement;

/** A one-line formula box, with a button that opens the formula in a larger editor. */
function FormulaBox({ value, invalid, label, onFocus, onChange, onExpand }: { value: string; invalid: boolean; label: string; onFocus: (el: FormulaField) => void; onChange: (v: string) => void; onExpand: () => void }) {
  return (
    <div className="asm-formula-box">
      <input aria-label={label} className="col-formula" value={value} title={value || undefined} aria-invalid={invalid} spellCheck={false} onFocus={(e) => onFocus(e.currentTarget)} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="ms-glyph asm-expand" aria-label={msg('Formula Builder: {label}', { label })} title={msg('Formula Builder: pick properties, functions and operators, and see the result')} onClick={onExpand}>
        ƒx
      </button>
    </div>
  );
}

/** The formula language in brief (the same as calculation columns'); Help › Formulas has the rest. */
function FormulaSyntax({ onHelp }: { onHelp?: (page: string) => void }) {
  return (
    <details className="asm-syntax">
      <summary>{msg('How to write a formula')}</summary>
      <p>
        {keyed(msgParts('Formulas work like a spreadsheet’s. Put names of values in {code}; numbers as they are. Spaces don’t matter.', { code: <code>[square brackets]</code> }))}
      </p>
      <table>
        <tbody>
          <tr>
            <td>
              <code>+ - * /</code> <code>^</code>
            </td>
            <td>{keyed(msgParts('add, subtract, multiply, divide, power; brackets {code} group', { code: <code>( )</code> }))}</td>
            <td>
              <code>([Length] + 2) * 3</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>IF(test, then, else)</code>
            </td>
            <td>
              {keyed(msgParts('one value or another; tests use {code}', { code: <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code> }))}
            </td>
            <td>
              <code>IF([Depth] &gt; 0, [Depth], [Wall Height])</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ROUND(x, places)</code>
            </td>
            <td>
              {keyed(msgParts('round; {code} up and {code2} down to a whole number', { code: <code>CEILING(x)</code>, code2: <code>FLOOR(x)</code> }))}
            </td>
            <td>
              <code>CEILING([Length] / 10)</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>MIN MAX SUM AVG</code>
            </td>
            <td>
              {keyed(
                msgParts('smallest, largest, total, average of a list; also {functions}', {
                  functions: (
                    <>
                      <code>ABS</code>, <code>SQRT</code>, <code>AND</code>, <code>OR</code>, <code>NOT</code>
                    </>
                  ),
                }),
              )}
            </td>
            <td>
              <code>MAX([Count], 1)</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        {keyed(msgParts('Read {code} as: length × height (the measurement’s depth if it has one, else the Wall Height variable) × 2 sides ÷ the area of one board.', { code: <code>[Length] * IF([Depth] &gt; 0, [Depth], [Wall Height]) * 2 / [Board Area]</code> }))}
      </p>
      {onHelp && (
        <button type="button" className="btn small" onClick={() => onHelp('formulas')}>
          {msg('More in Help › Formulas')}
        </button>
      )}
    </details>
  );
}

function NumberBox({ value, onChange, label, placeholder, width = 70, title }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string; placeholder?: string; width?: number; title?: string }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [bad, setBad] = useState(false);
  return (
    <input
      aria-label={label}
      title={title}
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
export function AssembliesDialog({ initial, readOnly, columns, usage, unitSystem, preview, previewLabel, estimating, onSave, onImportEstimating, onExportJson, onHelp, onClose }: Props) {
  const [list, setList] = useState<Assembly[]>(() => structuredClone([...initial]));
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [message, setMessage] = useState('');
  const [library, setLibrary] = useState(loadLibrary);
  const [menu, setMenu] = useState<'starters' | 'library' | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** The formula box last typed in, which the reference chips insert into. */
  const formulaRef = useRef<{ el: FormulaField; itemId: string } | null>(null);
  /** The item whose formula is open in the larger editor. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [varOrderTick, setVarOrderTick] = useState(0);

  const selected = list.find((a) => a.id === selectedId) ?? null;
  const catalog = estimating.items;
  const problems = useMemo(
    () =>
      new Map(
        list.map((a) => {
          const p = assemblyProblems(a, list, columns);
          for (const i of a.items) if (i.itemId && !catalog.some((c) => c.id === i.itemId) && !p.has(`item:${i.id}`)) p.set(`item:${i.id}`, 'The catalog item it links to is gone: pick another or none');
          return [a.id, p];
        }),
      ),
    [list, columns, catalog],
  );
  const valid = [...problems.values()].every((p) => p.size === 0);
  const results = useMemo(() => (selected && preview ? preview(selected) : null), [selected, preview]);

  const patch = (fn: (a: Assembly) => Assembly) => setList((l) => l.map((a) => (a.id === selectedId ? fn(a) : a)));
  const patchItem = (id: string, p: Partial<AssemblyItem>) => patch((a) => ({ ...a, items: a.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const asmDrag = useDragReorder(
    list.map((a) => a.id),
    readOnly,
    (from, to, pos) => setList((l) => reorderById(l, from, to, pos)),
  );
  const varDrag = useDragReorder(
    (selected?.variables ?? []).map((_, i) => i),
    readOnly,
    (from, to, pos) => {
      patch((a) => ({ ...a, variables: reorderAt(a.variables, from, to, pos) }));
      setVarOrderTick((t) => t + 1);
    },
  );
  const itemDrag = useDragReorder(
    (selected?.items ?? []).map((i) => i.id),
    readOnly,
    (from, to, pos) => patch((a) => ({ ...a, items: reorderById(a.items, from, to, pos) })),
  );
  const add = (incoming: Assembly[], how: string) => {
    // Copies get new ids, so the same starter added twice is two assemblies.
    const fresh = incoming.map((a) => ({ ...structuredClone(a), id: crypto.randomUUID(), name: freeName(a.name, list) }));
    setList((l) => [...l, ...fresh]);
    setSelectedId(fresh[0]?.id ?? selectedId);
    setMessage(how);
    setMenu(null);
  };
  const remove = (a: Assembly) => {
    const used = usage[a.id] ?? 0;
    if (used && !confirm(msg('{used, plural, one {# measurement uses} other {# measurements use}} “{name}”. Delete it anyway? They keep their measurements but lose its quantities.', { used, name: a.name }))) return;
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
    setMessage(writeLibrary(next) ? msg('Saved “{name}” to My Assemblies, for use in any document.', { name: a.name }) : msg('This browser would not keep My Assemblies (private window or storage full).'));
  };

  const p = selected ? problems.get(selected.id)! : new Map<string, string>();
  const fmt = (n: number | null) => (n === null ? '' : formatNumber(n, 2));
  const varHint = (v: Assembly['variables'][number]) => (v.type === 'boolean' ? msg('Yes/No switch: {value} (1 or 0)', { value: v.value ? msg('Yes') : msg('No') }) : v.unit ? msg('Variable: {value} {unit}', { value: v.value, unit: v.unit }) : msg('Variable: {value}', { value: v.value }));
  /** What the Formula Builder's property picker offers: measured values, this assembly's variables and switches, the document's columns. */
  const groups: FormulaNameGroup[] = selected
    ? [
        { label: msg('Measured'), names: MEASURED_NAMES },
        { label: msg('Variables'), names: selected.variables.filter((v) => v.name.trim() && v.type !== 'boolean').map((v) => ({ name: v.name.trim(), hint: varHint(v) })) },
        { label: msg('Yes/No switches'), names: selected.variables.filter((v) => v.name.trim() && v.type === 'boolean').map((v) => ({ name: v.name.trim(), hint: varHint(v) })) },
        { label: msg('Columns'), names: columns.filter((c) => c.type === 'number' || c.type === 'formula' || c.type === 'checkmark').map((c) => ({ name: c.name, hint: c.type === 'checkmark' ? msg('Checkmark column (1 or 0)') : msg('Custom column') })) },
      ]
    : [];
  /** The names the reference chips insert: measured values, then this assembly's variables and the document's number columns. */
  const refs = groups.flatMap((g) => g.names);
  const linked = (item: AssemblyItem): Item | undefined => (item.itemId ? catalog.find((c) => c.id === item.itemId) : undefined);
  const expanded = selected?.items.find((i) => i.id === expandedId) ?? null;
  const roundHint = msg('Round the quantity up to a multiple of this instead of a whole number: 10 for pipe sold in 10 ft lengths, 0.5 for half sheets. Leave blank for whole numbers.');

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal columns-dialog assemblies-dialog" role="dialog" aria-label={msg('Assemblies')} onMouseDown={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest('[data-asm-pop]')) setMenu(null); }}>
        <div className="columns-head">
          <h3>{msg('Assemblies')}</h3>
        </div>
        <p className="hint-text asm-intro">
          {msg('An assembly turns each measurement into the materials and labour it stands for. Pick one for a measurement in the Measurements panel; the Takeoff Quantities window adds them all up.')}
        </p>
        {readOnly && <p className="columns-readonly">{msg('This document is read-only; assemblies can be viewed and exported but not changed.')}</p>}

        <div className="columns-body">
          <div className="columns-list">
            <ul aria-label={msg('Assemblies in this document')}>
              {list.map((a) => (
                <li
                  key={a.id}
                  draggable={!readOnly}
                  className={asmDrag.rowClass(a.id)}
                  onDragStart={(e) => asmDrag.start(a.id, e)}
                  onDragEnd={asmDrag.end}
                  {...asmDrag.targetProps(a.id)}
                >
                  <button type="button" className={`col-row${a.id === selectedId ? ' active' : ''}${problems.get(a.id)!.size ? ' invalid' : ''}`} onClick={() => setSelectedId(a.id)}>
                    {!readOnly && (
                      <span className="drag-handle list-grip" aria-hidden="true">
                        <GripIcon />
                      </span>
                    )}
                    <span className="col-type-icon" aria-hidden="true">
                      {a.items.length}
                    </span>
                    <span className="col-name">{a.name || msg('Untitled')}</span>
                    {!!usage[a.id] && <span className="col-hidden">{msg('{usage} used', { usage: usage[a.id] })}</span>}
                  </button>
                </li>
              ))}
              {!list.length && <li className="empty">{msg('No assemblies yet. Start from an example or make a new one.')}</li>}
            </ul>
            <div className="col-add asm-add">
              <button type="button" className="btn small" disabled={readOnly} onClick={() => add([newAssembly(freeName('New assembly', list))], msg('Added a new assembly. Save to apply.'))}>
                {msg('+ New')}
              </button>
              <button type="button" className="btn small" disabled={readOnly || !selected} onClick={() => selected && add([{ ...selected, name: `${selected.name} copy` }], msg('Duplicated “{name}”. Save to apply.', { name: selected?.name }))}>
                {msg('Duplicate')}
              </button>
              <button type="button" className="btn small" disabled={readOnly || !selected} onClick={() => selected && remove(selected)}>
                {msg('Delete')}
              </button>
              <SortButton items={list} getName={(a) => a.name} disabled={readOnly} noun={msg('assemblies')} onSort={(dir) => setList((l) => sortAlphabetically(l, (a) => a.name, dir))} />
              <div className="asm-pop" data-asm-pop>
                <button type="button" className="btn small" disabled={readOnly} aria-expanded={menu === 'starters'} onClick={() => setMenu(menu === 'starters' ? null : 'starters')}>
                  {msg('Examples ▾')}
                </button>
                {menu === 'starters' && (
                  <div className="ms-menu up" role="menu">
                    {starterGroups(unitSystem).map((g) => (
                      <div key={g.discipline} role="group" aria-label={g.discipline}>
                        <div className="asm-menu-head">{g.discipline}</div>
                        {g.assemblies.map((a) => (
                          <button key={a.name} type="button" role="menuitem" onClick={() => add([a], msg('Added the example “{name}”. Save to apply.', { name: a.name }))}>
                            {a.name}
                          </button>
                        ))}
                        <button type="button" role="menuitem" className="asm-menu-all" onClick={() => add(g.assemblies, msg('Added the {count} {discipline} examples. Save to apply.', { count: g.assemblies.length, discipline: g.discipline.toLowerCase() }))}>
                          {msg('All {discipline}', { discipline: g.discipline.toLowerCase() })}
                        </button>
                      </div>
                    ))}
                    <div className="asm-menu-head" />
                    <button type="button" role="menuitem" onClick={() => add(starterGroups(unitSystem).flatMap((g) => g.assemblies), msg('Added every example. Save to apply.'))}>
                      {msg('Every example')}
                    </button>
                  </div>
                )}
              </div>
              <div className="asm-pop" data-asm-pop>
                <button type="button" className="btn small" disabled={readOnly} aria-expanded={menu === 'library'} title={msg('Assemblies saved in this browser, for any document')} onClick={() => setMenu(menu === 'library' ? null : 'library')}>
                  {msg('My Assemblies ▾')}
                </button>
                {menu === 'library' && (
                  <div className="ms-menu up" role="menu">
                    {library.map((a) => (
                      <div key={a.id} className="asm-lib-row">
                        <button type="button" role="menuitem" onClick={() => add([a], msg('Added “{name}” from My Assemblies. Save to apply.', { name: a.name }))}>
                          {a.name}
                        </button>
                        <button
                          type="button"
                          className="ms-glyph"
                          title={msg('Remove “{name}” from My Assemblies', { name: a.name })}
                          aria-label={msg('Remove {name} from My Assemblies', { name: a.name })}
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
                    {!library.length && <p className="asm-empty">{msg('Nothing saved yet. Select an assembly and click Save to My Assemblies.')}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="columns-editor">
            {!selected ? (
              <p className="empty">{msg('Select an assembly to edit it, or add one.')}</p>
            ) : (
              <fieldset disabled={readOnly}>
                <label className="col-field">
                  <span>{msg('Name')}</span>
                  <input value={selected.name} aria-invalid={p.has('name')} onChange={(e) => patch((a) => ({ ...a, name: e.target.value }))} />
                  {p.has('name') && <em className="col-error">{p.get('name')}</em>}
                </label>
                <label className="col-field">
                  <span>{msg('Notes')}</span>
                  <input value={selected.description ?? ''} placeholder={msg('How to measure it, what it includes')} onChange={(e) => patch((a) => ({ ...a, description: e.target.value || undefined }))} />
                </label>

                <div className="col-field">
                  <span>{msg('Variables')}</span>
                  <small className="hint-text">
                    {msg('Numbers the formulas use by name, such as a stud spacing or a wall height, and Yes/No switches (Yes is 1, No is 0). Lengths are in the page’s units (feet or metres). These are the defaults: each measurement can set its own inputs when the assembly is applied.')}
                  </small>
                  <table className="asm-table">
                    <tbody>
                      {selected.variables.map((v, i) => (
                        <tr key={i} className={varDrag.rowClass(i)} {...varDrag.targetProps(i)}>
                          <td className="drag-handle-cell">
                            <DragHandle disabled={readOnly} label={msg('Drag to reorder variable {name}', { name: v.name || String(i + 1) })} onDragStart={(e) => varDrag.start(i, e)} onDragEnd={varDrag.end} />
                          </td>
                          <td>
                            <input aria-label={msg('Variable name')} value={v.name} aria-invalid={p.has(`var:${i}`)} onChange={(e) => patch((a) => ({ ...a, variables: a.variables.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} />
                          </td>
                          <td>
                            <select
                              aria-label={msg('Variable type')}
                              value={v.type === 'boolean' ? 'boolean' : 'number'}
                              onChange={(e) => {
                                const yesNo = e.target.value === 'boolean';
                                patch((a) => ({ ...a, variables: a.variables.map((x, j) => (j === i ? (yesNo ? { name: x.name, value: x.value ? 1 : 0, type: 'boolean' as const } : { name: x.name, value: x.value }) : x)) }));
                              }}
                            >
                              <option value="number">{msg('Number')}</option>
                              <option value="boolean">{msg('Yes/No')}</option>
                            </select>
                          </td>
                          <td>
                            {v.type === 'boolean' ? (
                              <select aria-label={msg('Variable value')} value={v.value ? '1' : '0'} onChange={(e) => patch((a) => ({ ...a, variables: a.variables.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) }))}>
                                <option value="1">{msg('Yes')}</option>
                                <option value="0">{msg('No')}</option>
                              </select>
                            ) : (
                              <NumberBox key={`${selected.id}:${i}:${selected.variables.length}:${varOrderTick}`} label={msg('Variable value')} value={v.value} width={90} onChange={(n) => patch((a) => ({ ...a, variables: a.variables.map((x, j) => (j === i ? { ...x, value: n ?? 0 } : x)) }))} />
                            )}
                          </td>
                          <td>
                            {v.type !== 'boolean' && <input aria-label={msg('Variable unit')} placeholder={msg('unit')} value={v.unit ?? ''} style={{ width: 54 }} onChange={(e) => patch((a) => ({ ...a, variables: a.variables.map((x, j) => (j === i ? { ...x, unit: e.target.value || undefined } : x)) }))} />}
                          </td>
                          <td>
                            <button type="button" className="ms-glyph" aria-label={msg('Remove variable {name}', { name: v.name })} title={msg('Remove')} onClick={() => patch((a) => ({ ...a, variables: a.variables.filter((_, j) => j !== i) }))}>
                              ×
                            </button>
                          </td>
                          <td className="asm-row-error">{p.get(`var:${i}`) && <em className="col-error">{p.get(`var:${i}`)}</em>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="asm-row-actions">
                    <button type="button" className="btn small" onClick={() => patch((a) => ({ ...a, variables: [...a.variables, { name: `Variable ${a.variables.length + 1}`, value: 1 }] }))}>
                      {msg('+ Variable')}
                    </button>
                    <button type="button" className="btn small" onClick={() => patch((a) => ({ ...a, variables: [...a.variables, { name: `Switch ${a.variables.length + 1}`, value: 1, type: 'boolean' }] }))}>
                      {msg('+ Yes/No')}
                    </button>
                    <SortButton
                      items={selected.variables}
                      getName={(v) => v.name}
                      disabled={readOnly}
                      noun={msg('variables')}
                      onSort={(dir) => {
                        patch((a) => ({ ...a, variables: sortAlphabetically(a.variables, (v) => v.name, dir) }));
                        setVarOrderTick((t) => t + 1);
                      }}
                    />
                  </div>
                </div>

                <div className="col-field">
                  <span>{msg('Items')}</span>
                  <small className="hint-text">
                    {msg('Each item’s quantity per measurement. Waste is added before rounding up; totals round up once, on the total.')}
                  </small>
                  <FormulaSyntax onHelp={onHelp} />
                  <div className="asm-refs" aria-label={msg('Insert into the formula')}>
                    {refs.map((r) => (
                      <button key={r.name} type="button" className="asm-ref" title={r.hint} onMouseDown={(e) => e.preventDefault()} onClick={() => insertRef(r.name)}>
                        [{r.name}]
                      </button>
                    ))}
                  </div>
                  <table className="asm-table asm-items">
                    <thead>
                      <tr>
                        <th className="drag-col" />
                        <th>{msg('Item')}</th>
                        <th title={msg('A catalog item (Takeoff › Items) this item takes its name, unit, cost, waste and rounding from')}>{msg('Catalog')}</th>
                        <th>{msg('Quantity formula')}</th>
                        <th>{msg('Unit')}</th>
                        <th>{msg('Waste %')}</th>
                        <th title={msg('Round up to a whole number, or to a multiple you set (10 for pipe sold in 10 ft lengths)')}>{msg('Round up')}</th>
                        <th>{msg('Unit cost')}</th>
                        {results && <th className="num">{msg('Selected')}</th>}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item) => {
                        const r = results?.find((x) => x.item.id === item.id);
                        const err = p.get(`item:${item.id}`);
                        const from = linked(item);
                        const fromCost = from ? listCost(from, estimating.productLists).unitCost : undefined;
                        return (
                          <Fragment key={item.id}>
                            <tr className={itemDrag.rowClass(item.id)} {...itemDrag.targetProps(item.id)}>
                              <td className="drag-handle-cell">
                                <DragHandle disabled={readOnly} label={msg('Drag to reorder {name}', { name: item.name || from?.name || msg('item') })} onDragStart={(e) => itemDrag.start(item.id, e)} onDragEnd={itemDrag.end} />
                              </td>
                              <td className="asm-item-name">
                                <input aria-label={msg('Item name')} value={item.name} placeholder={from?.name} onChange={(e) => patchItem(item.id, { name: e.target.value })} />
                              </td>
                              <td>
                                <select
                                  aria-label={msg('Catalog item for {value}', { value: item.name || from?.name || msg('item') })}
                                  value={item.itemId ?? ''}
                                  style={{ width: 120 }}
                                  onChange={(e) => {
                                    const id = e.target.value;
                                    // Linking clears the fields the catalog item now supplies, so they follow it.
                                    if (id) patchItem(item.id, { itemId: id, name: '', unit: '', waste: undefined, unitCost: undefined, roundUp: undefined, roundTo: undefined });
                                    else patchItem(item.id, { itemId: undefined, name: item.name || from?.name || 'Item', unit: item.unit || from?.unit || '' });
                                  }}
                                >
                                  <option value="">{msg('None')}</option>
                                  {catalog.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.itemNo ? `${c.itemNo} ${c.name}` : c.name}
                                    </option>
                                  ))}
                                  {item.itemId && !from && <option value={item.itemId}>{msg('(deleted item)')}</option>}
                                </select>
                              </td>
                              <td className="asm-formula">
                                <FormulaBox
                                  label={msg('Formula for {value}', { value: item.name || from?.name || '' })}
                                  value={item.formula}
                                  invalid={!!err}
                                  onFocus={(el) => (formulaRef.current = { el, itemId: item.id })}
                                  onChange={(formula) => patchItem(item.id, { formula })}
                                  onExpand={() => setExpandedId(item.id)}
                                />
                              </td>
                              <td>
                                <input aria-label={msg('Unit')} value={item.unit} placeholder={from?.unit} style={{ width: 64 }} onChange={(e) => patchItem(item.id, { unit: e.target.value })} />
                              </td>
                              <td>
                                <NumberBox key={`${item.id}:w`} label={msg('Waste percent')} value={item.waste} placeholder={from?.waste !== undefined ? String(from.waste) : '0'} width={56} onChange={(n) => patchItem(item.id, { waste: n || undefined })} />
                              </td>
                              <td>
                                <div className="asm-round">
                                  <input type="checkbox" aria-label={msg('Round up')} title={msg('Round the quantity up instead of leaving it fractional')} checked={!!item.roundUp} onChange={(e) => patchItem(item.id, { roundUp: e.target.checked || undefined, ...(e.target.checked ? {} : { roundTo: undefined }) })} />
                                  {item.roundUp && (
                                    <NumberBox key={`${item.id}:r`} label={msg('Round up {name} to a multiple of', { name: item.name })} title={roundHint} value={item.roundTo} placeholder="1" width={44} onChange={(n) => patchItem(item.id, { roundTo: n !== undefined && n > 0 && n !== 1 ? n : undefined })} />
                                  )}
                                </div>
                              </td>
                              <td>
                                <NumberBox key={`${item.id}:c`} label={msg('Unit cost')} value={item.unitCost} placeholder={fromCost !== undefined ? String(fromCost) : '—'} width={70} onChange={(n) => patchItem(item.id, { unitCost: n })} />
                              </td>
                              {results && <td className="num" title={r?.error}>{r?.error ? '⚠' : `${fmt(r?.rounded ?? null)} ${item.unit}`}</td>}
                              <td>
                                <button type="button" className="ms-glyph" aria-label={msg('Remove {name}', { name: item.name })} title={msg('Remove')} onClick={() => patch((a) => ({ ...a, items: a.items.filter((i) => i.id !== item.id) }))}>
                                  ×
                                </button>
                              </td>
                            </tr>
                            {err && (
                              <tr className="asm-error-row">
                                <td colSpan={2} />
                                <td colSpan={results ? 8 : 7}>
                                  <em className="col-error">{err}</em>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="asm-row-actions">
                    <button type="button" className="btn small" onClick={() => patch((a) => ({ ...a, items: [...a.items, newItem()] }))}>
                      {msg('+ Item')}
                    </button>
                    <SortButton
                      items={selected.items}
                      getName={(i) => i.name.trim() || linked(i)?.name || ''}
                      disabled={readOnly}
                      noun={msg('assembly items')}
                      onSort={(dir) => patch((a) => ({ ...a, items: sortAlphabetically(a.items, (i) => i.name.trim() || linked(i)?.name || '', dir) }))}
                    />
                  </div>
                  <small className="hint-text">{results ? msg('“Selected” is worked out for {previewLabel}.', { previewLabel }) : msg('Select a measurement before opening this window to see its quantities here as you edit.')}</small>
                </div>
              </fieldset>
            )}
          </div>
        </div>

        {expanded && (
          <FormulaBuilder
            item={expanded.name || linked(expanded)?.name || ''}
            unit={expanded.unit || linked(expanded)?.unit || ''}
            formula={expanded.formula}
            groups={groups}
            problem={p.get(`item:${expanded.id}`)}
            result={(() => {
              const r = results?.find((x) => x.item.id === expanded.id);
              return r ? { rounded: r.rounded, base: r.base, ...(r.error ? { error: r.error } : {}) } : null;
            })()}
            resultLabel={previewLabel}
            readOnly={readOnly}
            onChange={(formula) => patchItem(expanded.id, { formula })}
            onClose={() => setExpandedId(null)}
          />
        )}

        {message && <p className="columns-message">{message}</p>}
        <div className="actions columns-actions">
          <button type="button" className="btn small" disabled={readOnly} onClick={() => importRef.current?.click()} title={msg('Add assemblies, items, product lists and templates from an estimating file (or an older assemblies file)')}>
            {msg('Import…')}
          </button>
          <button type="button" className="btn small" disabled={!list.length && !estimating.items.length && !estimating.productLists.length && !estimating.templates.length} onClick={() => onExportJson(estimatingToJson({ assemblies: list, ...estimating }))} title={msg('Save these assemblies, with the document\'s items, product lists and templates, as a file to share company-wide')}>
            {msg('Export')}
          </button>
          <button type="button" className="btn small" disabled={!selected || (selected && problems.get(selected.id)!.size > 0)} onClick={() => selected && saveToLibrary(selected)} title={msg('Keep a copy in this browser, for any document')}>
            {msg('Save to My Assemblies')}
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? msg('Close') : msg('Cancel')}
          </button>
          {!readOnly && (
            <button
              type="button"
              className="btn primary"
              disabled={!valid}
              title={valid ? undefined : msg('Fix the problems shown in red first')}
              onClick={() => onSave(list.map((a) => ({ ...a, name: a.name.trim(), variables: a.variables.map((v) => ({ ...v, name: v.name.trim() })), items: a.items.map((i) => ({ ...i, name: i.name.trim(), unit: i.unit.trim() })) })))}
            >
              {msg('Save')}
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
              const file = estimatingFromJson(await f.text());
              const incoming = file.assemblies;
              const next = mergeAssemblies(list, incoming);
              setList(next);
              setSelectedId(incoming[0] ? (next.find((a) => a.name === incoming[0]!.name)?.id ?? selectedId) : selectedId);
              const extras = file.items.length + file.productLists.length + file.templates.length;
              if (extras) onImportEstimating({ items: file.items, productLists: file.productLists, templates: file.templates });
              const also = extras ? ' ' + msg('and {count, plural, one {# item} other {# items}}, {count2} product {count3, plural, one {list} other {lists}} and {count4, plural, one {# template} other {# templates}} (added to the document now)', { count: file.items.length, count2: file.productLists.length, count3: file.productLists.length, count4: file.templates.length }) : '';
              setMessage(msg('Imported {count, plural, one {# assembly} other {# assemblies}}{also} from {name} (ones with the same name were replaced). Save to apply the assemblies.', { count: incoming.length, also, name: f.name }));
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    </div>
  );
}
