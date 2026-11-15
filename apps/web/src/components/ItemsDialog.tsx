import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, listCost, recordLabel, type Item, type ItemCategory, type ProductList } from '@nb/markup';
import { formatNumber } from '../columns/listColumns';
import { addToLibrary, loadEstimatingLibrary } from '../assemblies/estimatingLibrary';

interface Props {
  initial: readonly Item[];
  productLists: readonly ProductList[];
  readOnly: boolean;
  /** Assembly items linked to each catalog item, so deleting one in use says so. */
  usage: Readonly<Record<string, number>>;
  /** Saves the items; `lists` are product lists brought in from the library with them. */
  onSave: (items: Item[], lists: ProductList[]) => void;
  onManageLists: () => void;
  onClose: () => void;
}

/** A new item, named "New item" (or "New item 2"... when that is taken). */
function newItem(category: ItemCategory, items: readonly Item[]): Item {
  const taken = new Set(items.map((i) => i.name.trim().toLowerCase()));
  let name = 'New item';
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New item ${n}`;
  return { id: crypto.randomUUID(), name, category, unit: 'ea' };
}

function num(text: string): number | undefined | null {
  if (!text.trim()) return undefined;
  const n = Number(text.replace(/[,$\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function NumberCell({ value, label, onChange, width = 70, placeholder }: { value: number | undefined; label: string; onChange: (n: number | undefined) => void; width?: number; placeholder?: string }) {
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
        const n = num(e.target.value);
        setBad(n === null);
        if (n !== null) onChange(n);
      }}
    />
  );
}

/**
 * Takeoff › Items: the document's catalog of cost lines (materials, labour, equipment,
 * subcontracts and the rest), which assembly items link to for their name, unit, cost, waste and
 * rounding. An item can take its cost and price from a product list record.
 */
export function ItemsDialog({ initial, productLists, readOnly, usage, onSave, onManageLists, onClose }: Props) {
  const [items, setItems] = useState<Item[]>(() => structuredClone([...initial]));
  const [lists, setLists] = useState<ProductList[]>(() => [...productLists]);
  const [filter, setFilter] = useState<ItemCategory | ''>('');
  const [message, setMessage] = useState('');
  const [library, setLibrary] = useState(loadEstimatingLibrary);
  const shown = items.filter((i) => !filter || i.category === filter);
  const patch = (id: string, p: Partial<Item>) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const names = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of items) seen.set(i.name.trim().toLowerCase(), (seen.get(i.name.trim().toLowerCase()) ?? 0) + 1);
    return seen;
  }, [items]);
  const problem = (i: Item) => (!i.name.trim() ? 'Name the item' : (names.get(i.name.trim().toLowerCase()) ?? 0) > 1 ? 'Two items have this name' : undefined);
  const valid = items.every((i) => !problem(i));
  const fromLibrary = library.items.filter((i) => !items.some((x) => x.id === i.id));

  const remove = (i: Item) => {
    const used = usage[i.id] ?? 0;
    if (used && !confirm(`${used} assembly item${used === 1 ? ' uses' : 's use'} “${i.name}”. Delete it anyway? They keep their own fields but lose the item’s defaults.`)) return;
    setItems((l) => l.filter((x) => x.id !== i.id));
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal columns-dialog estimating-dialog" role="dialog" aria-label="Items" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Items</h3>
        </div>
        <p className="hint-text asm-intro">
          The cost lines assemblies price from: materials, labour, equipment, subcontracts and other costs. Link an assembly item to one (Assemblies › Catalog) and it takes the item’s name, unit, cost, waste and rounding unless it sets its own. Link an item to a product list record and its cost and price follow the list.
        </p>
        {readOnly && <p className="columns-readonly">This document is read-only; items can be viewed but not changed.</p>}
        <div className="row est-toolbar">
          <label>
            Category{' '}
            <select aria-label="Category filter" value={filter} onChange={(e) => setFilter(e.target.value as ItemCategory | '')}>
              <option value="">All</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <span className="grow" />
          <button type="button" className="btn small" disabled={readOnly} onClick={() => setItems((l) => [...l, newItem(filter || 'material', l)])}>
            + Item
          </button>
          {fromLibrary.length > 0 && (
            <select
              aria-label="Add from library"
              value=""
              disabled={readOnly}
              onChange={(e) => {
                const item = fromLibrary.find((i) => i.id === e.target.value);
                if (!item) return;
                setItems((l) => [...l, structuredClone(item)]);
                // The product list it prices from comes along.
                const list = item.listRef && library.productLists.find((x) => x.id === item.listRef!.listId);
                if (list && !lists.some((x) => x.id === list.id)) setLists((l) => [...l, list]);
                setMessage(`Added “${item.name}” from the library. Save to apply.`);
              }}
            >
              <option value="">Add from library…</option>
              {fromLibrary.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn small" onClick={onManageLists}>
            Product Lists…
          </button>
        </div>
        <div className="est-grid">
          <table className="asm-table est-table">
            <thead>
              <tr>
                <th>Item no.</th>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Unit cost</th>
                <th>Unit price</th>
                <th>Waste %</th>
                <th title="Round quantities up, to a whole number or a multiple you set">Round up</th>
                <th>SKU</th>
                <th>Description</th>
                <th>Product list</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const list = i.listRef ? lists.find((l) => l.id === i.listRef!.listId) : undefined;
                const priced = listCost(i, lists);
                const err = problem(i);
                return (
                  <tr key={i.id} data-item={i.name}>
                    <td>
                      <input aria-label="Item number" value={i.itemNo ?? ''} disabled={readOnly} style={{ width: 70 }} onChange={(e) => patch(i.id, { itemNo: e.target.value || undefined })} />
                    </td>
                    <td>
                      <input aria-label="Item name" value={i.name} disabled={readOnly} aria-invalid={!!err} title={err} style={{ width: 150 }} onChange={(e) => patch(i.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <select aria-label="Item category" value={i.category} disabled={readOnly} onChange={(e) => patch(i.id, { category: e.target.value as ItemCategory })}>
                        {ITEM_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input aria-label="Item unit" value={i.unit} disabled={readOnly} style={{ width: 54 }} onChange={(e) => patch(i.id, { unit: e.target.value })} />
                    </td>
                    <td>
                      {i.listRef && priced.unitCost !== undefined && priced.unitCost !== i.unitCost ? (
                        <span className="num" title={`From ${list?.name ?? 'the product list'}`}>
                          {formatNumber(priced.unitCost, 2)} <span className="muted">(list)</span>
                        </span>
                      ) : (
                        <NumberCell label="Item unit cost" value={i.unitCost} placeholder="—" onChange={(n) => patch(i.id, { unitCost: n })} />
                      )}
                    </td>
                    <td>
                      {i.listRef && priced.unitPrice !== undefined && priced.unitPrice !== i.unitPrice ? (
                        <span className="num" title={`From ${list?.name ?? 'the product list'}`}>
                          {formatNumber(priced.unitPrice, 2)} <span className="muted">(list)</span>
                        </span>
                      ) : (
                        <NumberCell label="Item unit price" value={i.unitPrice} placeholder="—" onChange={(n) => patch(i.id, { unitPrice: n })} />
                      )}
                    </td>
                    <td>
                      <NumberCell label="Item waste percent" value={i.waste} placeholder="0" width={50} onChange={(n) => patch(i.id, { waste: n || undefined })} />
                    </td>
                    <td>
                      <div className="asm-round">
                        <input type="checkbox" aria-label="Item round up" checked={!!i.roundUp} disabled={readOnly} onChange={(e) => patch(i.id, { roundUp: e.target.checked || undefined, ...(e.target.checked ? {} : { roundTo: undefined }) })} />
                        {i.roundUp && <NumberCell label="Item round up to nearest" value={i.roundTo} placeholder="1" width={44} onChange={(n) => patch(i.id, { roundTo: n !== undefined && n > 0 && n !== 1 ? n : undefined })} />}
                      </div>
                    </td>
                    <td>
                      <input aria-label="Item SKU" value={i.sku ?? ''} disabled={readOnly} style={{ width: 80 }} onChange={(e) => patch(i.id, { sku: e.target.value || undefined })} />
                    </td>
                    <td>
                      <input aria-label="Item description" value={i.description ?? ''} disabled={readOnly} style={{ width: 160 }} onChange={(e) => patch(i.id, { description: e.target.value || undefined })} />
                    </td>
                    <td>
                      <select
                        aria-label="Item product list"
                        value={i.listRef?.listId ?? ''}
                        disabled={readOnly || !lists.length}
                        onChange={(e) => {
                          const l = lists.find((x) => x.id === e.target.value);
                          patch(i.id, { listRef: l?.records[0] ? { listId: l.id, recordId: l.records[0].id } : undefined });
                        }}
                      >
                        <option value="">{lists.length ? 'None' : 'No lists yet'}</option>
                        {lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                      {list && (
                        <select aria-label="Item product record" value={i.listRef!.recordId} disabled={readOnly} style={{ maxWidth: 160 }} onChange={(e) => patch(i.id, { listRef: { listId: list.id, recordId: e.target.value } })}>
                          {list.records.map((r) => (
                            <option key={r.id} value={r.id}>
                              {recordLabel(list, r)}
                            </option>
                          ))}
                          {!list.records.some((r) => r.id === i.listRef!.recordId) && <option value={i.listRef!.recordId}>(deleted record)</option>}
                        </select>
                      )}
                    </td>
                    <td>
                      <button type="button" className="ms-glyph" aria-label={`Remove ${i.name}`} title="Remove" disabled={readOnly} onClick={() => remove(i)}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={12} className="empty">
                    {items.length ? 'No items in this category.' : 'No items yet. Add one, or bring them in with Assemblies › Import.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {message && <p className="columns-message">{message}</p>}
        <div className="actions columns-actions">
          <button
            type="button"
            className="btn small"
            disabled={!items.length || !valid}
            title="Keep a copy of these items (and the product lists they use) in this browser, for any document"
            onClick={() => {
              const used = new Set(items.flatMap((i) => (i.listRef ? [i.listRef.listId] : [])));
              const ok = addToLibrary({ items, productLists: lists.filter((l) => used.has(l.id)) });
              setLibrary(loadEstimatingLibrary());
              setMessage(ok ? `Saved ${items.length} item${items.length === 1 ? '' : 's'} to the library.` : 'This browser would not keep the library (private window or storage full).');
            }}
          >
            Save to Library
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button type="button" className="btn primary" disabled={!valid} title={valid ? undefined : 'Fix the problems shown in red first'} onClick={() => onSave(items.map((i) => ({ ...i, name: i.name.trim(), unit: i.unit.trim() })), lists.filter((l) => !productLists.some((x) => x.id === l.id)))}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
