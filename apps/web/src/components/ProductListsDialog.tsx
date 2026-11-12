import { useRef, useState } from 'react';
import { parseNumber, type ProductList, type ProductListColumn } from '@nb/markup';
import { productListFromCsv } from '../assemblies/csv';
import { addToLibrary, loadEstimatingLibrary } from '../assemblies/estimatingLibrary';

interface Props {
  initial: readonly ProductList[];
  readOnly: boolean;
  /** Catalog items linked to each list, so deleting one in use says so. */
  usage: Readonly<Record<string, number>>;
  onSave: (lists: ProductList[]) => void;
  onClose: () => void;
}

function freeName(base: string, lists: readonly ProductList[]): string {
  const taken = new Set(lists.map((l) => l.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

const newList = (name: string): ProductList => ({
  id: crypto.randomUUID(),
  name,
  columns: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'cost', label: 'Cost', type: 'number' },
    { key: 'price', label: 'Price', type: 'number' },
  ],
  records: [],
});

/**
 * Takeoff › Product Lists: tables of products (a supplier's price list, a rate sheet) that catalog
 * items link to through a dropdown, so their cost and price follow the list. Each list's columns
 * are its own; a CSV file's header row becomes a new list's columns.
 */
export function ProductListsDialog({ initial, readOnly, usage, onSave, onClose }: Props) {
  const [lists, setLists] = useState<ProductList[]>(() => structuredClone([...initial]));
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [message, setMessage] = useState('');
  const csvRef = useRef<HTMLInputElement>(null);
  const selected = lists.find((l) => l.id === selectedId) ?? null;
  const patch = (fn: (l: ProductList) => ProductList) => setLists((all) => all.map((l) => (l.id === selectedId ? fn(l) : l)));
  const library = loadEstimatingLibrary().productLists.filter((l) => !lists.some((x) => x.id === l.id));
  const valid = lists.every((l) => l.name.trim() && l.columns.every((c) => c.label.trim()));

  const setColumn = (key: string, p: Partial<ProductListColumn>) =>
    patch((l) => {
      const columns = l.columns.map((c) => (c.key === key ? { ...c, ...p } : c));
      // A column turned into a number column reads its values as numbers.
      const records = p.type === 'number' ? l.records.map((r) => ({ ...r, values: { ...r.values, [key]: typeof r.values[key] === 'string' && Number.isFinite(parseNumber(r.values[key] as string)) ? parseNumber(r.values[key] as string) : (r.values[key] ?? '') } })) : l.records;
      return { ...l, columns, records };
    });
  const addColumn = () =>
    patch((l) => {
      let n = l.columns.length + 1;
      while (l.columns.some((c) => c.key === `col${n}`)) n++;
      return { ...l, columns: [...l.columns, { key: `col${n}`, label: `Column ${n}`, type: 'text' }] };
    });
  const setCell = (recordId: string, c: Pick<ProductListColumn, 'key'>, text: string) =>
    patch((l) => ({
      ...l,
      // Kept as typed while editing ("12." stays); saving and reading treat number columns' text as numbers.
      records: l.records.map((r) => (r.id === recordId ? { ...r, values: { ...r.values, [c.key]: text } } : r)),
    }));
  const remove = (l: ProductList) => {
    const used = usage[l.id] ?? 0;
    if (used && !confirm(`${used} item${used === 1 ? ' prices' : 's price'} from “${l.name}”. Delete it anyway? They go back to their own costs.`)) return;
    const next = lists.filter((x) => x.id !== l.id);
    setLists(next);
    setSelectedId(next[0]?.id ?? null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal columns-dialog estimating-dialog" role="dialog" aria-label="Product Lists" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Product Lists</h3>
        </div>
        <p className="hint-text asm-intro">
          Tables of products, such as a supplier’s price list. Items (Takeoff › Items) link to a record and take its cost from the column chosen below (else the one named Cost or Unit Cost) and its price likewise (Price or Unit Price). Import a CSV file to make a list from its header row and rows.
        </p>
        {readOnly && <p className="columns-readonly">This document is read-only; product lists can be viewed but not changed.</p>}
        <div className="columns-body">
          <div className="columns-list">
            <ul aria-label="Product lists in this document">
              {lists.map((l) => (
                <li key={l.id}>
                  <button type="button" className={`col-row${l.id === selectedId ? ' active' : ''}`} onClick={() => setSelectedId(l.id)}>
                    <span className="col-type-icon" aria-hidden="true">
                      {l.records.length}
                    </span>
                    <span className="col-name">{l.name || 'Untitled'}</span>
                    {!!usage[l.id] && <span className="col-hidden">{usage[l.id]} used</span>}
                  </button>
                </li>
              ))}
              {!lists.length && <li className="empty">No product lists yet.</li>}
            </ul>
            <div className="col-add asm-add">
              <button
                type="button"
                className="btn small"
                disabled={readOnly}
                onClick={() => {
                  const l = newList(freeName('New list', lists));
                  setLists((all) => [...all, l]);
                  setSelectedId(l.id);
                }}
              >
                + New
              </button>
              <button type="button" className="btn small" disabled={readOnly} onClick={() => csvRef.current?.click()}>
                Import CSV…
              </button>
              <button type="button" className="btn small" disabled={readOnly || !selected} onClick={() => selected && remove(selected)}>
                Delete
              </button>
              {library.length > 0 && (
                <select
                  aria-label="Add list from library"
                  value=""
                  disabled={readOnly}
                  onChange={(e) => {
                    const l = library.find((x) => x.id === e.target.value);
                    if (!l) return;
                    setLists((all) => [...all, structuredClone(l)]);
                    setSelectedId(l.id);
                  }}
                >
                  <option value="">From library…</option>
                  {library.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="columns-editor">
            {!selected ? (
              <p className="empty">Select a list to edit it, add one, or import a CSV file.</p>
            ) : (
              <fieldset disabled={readOnly}>
                <label className="col-field">
                  <span>Name</span>
                  <input aria-label="List name" value={selected.name} aria-invalid={!selected.name.trim()} onChange={(e) => patch((l) => ({ ...l, name: e.target.value }))} />
                </label>
                <div className="row est-toolbar">
                  <label>
                    Cost column{' '}
                    <select aria-label="Cost column" value={selected.costColumn ?? ''} onChange={(e) => patch((l) => ({ ...l, costColumn: e.target.value || undefined }))}>
                      <option value="">Named Cost / Unit Cost</option>
                      {selected.columns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Price column{' '}
                    <select aria-label="Price column" value={selected.priceColumn ?? ''} onChange={(e) => patch((l) => ({ ...l, priceColumn: e.target.value || undefined }))}>
                      <option value="">Named Price / Unit Price</option>
                      {selected.columns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="est-grid">
                  <table className="asm-table est-table" aria-label="Records">
                    <thead>
                      <tr>
                        {selected.columns.map((c) => (
                          <th key={c.key}>
                            <input aria-label="Column name" value={c.label} style={{ width: 100 }} onChange={(e) => setColumn(c.key, { label: e.target.value })} />
                            <select aria-label={`Type of ${c.label}`} value={c.type} onChange={(e) => setColumn(c.key, { type: e.target.value as 'text' | 'number' })}>
                              <option value="text">Text</option>
                              <option value="number">Number</option>
                            </select>
                            <button
                              type="button"
                              className="ms-glyph"
                              aria-label={`Remove column ${c.label}`}
                              title="Remove column"
                              onClick={() => patch((l) => ({ ...l, columns: l.columns.filter((x) => x.key !== c.key), ...(l.costColumn === c.key ? { costColumn: undefined } : {}), ...(l.priceColumn === c.key ? { priceColumn: undefined } : {}) }))}
                            >
                              ×
                            </button>
                          </th>
                        ))}
                        <th>
                          <button type="button" className="btn small" onClick={addColumn}>
                            + Column
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.records.map((r) => (
                        <tr key={r.id}>
                          {selected.columns.map((c) => (
                            <td key={c.key}>
                              <input aria-label={c.label} value={String(r.values[c.key] ?? '')} style={{ width: c.type === 'number' ? 80 : 140 }} className={c.type === 'number' ? 'num' : undefined} onChange={(e) => setCell(r.id, c, e.target.value)} />
                            </td>
                          ))}
                          <td>
                            <button type="button" className="ms-glyph" aria-label="Remove record" title="Remove record" onClick={() => patch((l) => ({ ...l, records: l.records.filter((x) => x.id !== r.id) }))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <button type="button" className="btn small" onClick={() => patch((l) => ({ ...l, records: [...l.records, { id: crypto.randomUUID(), values: {} }] }))}>
                    + Record
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        </div>
        {message && <p className="columns-message">{message}</p>}
        <div className="actions columns-actions">
          <button
            type="button"
            className="btn small"
            disabled={!selected}
            title="Keep a copy of this list in this browser, for any document"
            onClick={() => selected && setMessage(addToLibrary({ productLists: [selected] }) ? `Saved “${selected.name}” to the library.` : 'This browser would not keep the library (private window or storage full).')}
          >
            Save to Library
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button type="button" className="btn primary" disabled={!valid} onClick={() => onSave(lists.map((l) => ({ ...l, name: l.name.trim(), records: l.records.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, l.columns.find((c) => c.key === k)?.type === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(parseNumber(v)) ? parseNumber(v) : v])) })) })))}>
              Save
            </button>
          )}
        </div>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          aria-label="Import CSV file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const l = productListFromCsv(freeName(f.name.replace(/\.csv$/i, ''), lists), await f.text());
              setLists((all) => [...all, l]);
              setSelectedId(l.id);
              setMessage(`Imported ${l.records.length} record${l.records.length === 1 ? '' : 's'} with ${l.columns.length} columns from ${f.name}. Save to apply.`);
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    </div>
  );
}
