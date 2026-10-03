import { useState } from 'react';
import type { StoredFile } from '../storage/fileStore';
import { drawingSets, neighbourSheet, setSheets, unindexed, useDrawingSets, type DrawingSet, type SetSheet } from '../storage/sets';
import { InlineName } from './InlineName';

interface Props {
  library: readonly StoredFile[];
  /** The sheet in front, to highlight and to step from. */
  current: { fileId: string; page: number } | null;
  onOpenSheet: (fileId: string, page: number) => void;
  /** Reads the sheets of files not indexed yet. */
  onIndex: (fileIds: string[]) => void;
  indexing: boolean;
}

/**
 * Sets: drawing files shown as one sheet list, by category and sheet number. Clicking a sheet opens
 * its file at that page; Previous and Next step through the whole set across files.
 */
export function SetsPanel({ library, current, onOpenSheet, onIndex, indexing }: Props) {
  const { sets, index } = useDrawingSets();
  const [creating, setCreating] = useState<string[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const nameOf = (id: string) => library.find((f) => f.id === id)?.name ?? 'Missing file';
  const q = filter.trim().toLowerCase();
  const matches = (s: SetSheet) => !q || `${s.number ?? ''} ${s.title ?? ''} ${nameOf(s.fileId)}`.toLowerCase().includes(q);

  const step = (list: readonly SetSheet[], by: -1 | 1) => {
    const here = current ? neighbourSheet(list, current.fileId, current.page, by) : null;
    const inSet = current && list.some((s) => s.fileId === current.fileId && s.page === current.page);
    const target = inSet ? here : list[by === 1 ? 0 : list.length - 1];
    if (target) onOpenSheet(target.fileId, target.page);
  };

  return (
    <div className="sets-panel">
      <div className="sheet-actions">
        <button className="btn small" disabled={!library.length} onClick={() => setCreating(current ? [current.fileId] : [])}>
          New Set…
        </button>
        <input className="sets-filter" type="search" placeholder="Filter sheets" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {creating && (
        <form
          className="set-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (!creating.length) return;
            const id = drawingSets.create(newName.trim() || 'New Set', creating);
            setCreating(null);
            setNewName('');
            if (unindexed(drawingSets.get().find((s) => s.id === id)!, drawingSets.index()).length) onIndex(creating.filter((f) => !index[f]));
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setCreating(null);
          }}
        >
          <input autoFocus placeholder="Set name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <div className="set-files">
            {library.map((f) => (
              <label key={f.id} className="check">
                <input type="checkbox" checked={creating.includes(f.id)} onChange={(e) => setCreating((c) => (e.target.checked ? [...(c ?? []), f.id] : (c ?? []).filter((x) => x !== f.id)))} />
                {f.name}
              </label>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn small" onClick={() => setCreating(null)}>
              Cancel
            </button>
            <button type="submit" className="btn small primary" disabled={!creating.length}>
              Create
            </button>
          </div>
        </form>
      )}
      {!sets.length && !creating && <p className="empty">A set shows many drawing files as one list of sheets, by discipline and sheet number. Each file keeps its own markups.</p>}
      {sets.map((set) => {
        const list = setSheets(set, index);
        const missing = unindexed(set, index);
        const shown = list.filter(matches);
        const categories = [...new Set(set.entries.map((e) => e.category).filter((c): c is string => !!c))];
        return (
          <section key={set.id} className="drawing-set">
            <div className="set-head">
              <button className="btn small flat caret" onClick={() => drawingSets.toggle(set.id)} aria-label={set.collapsed ? 'Expand' : 'Collapse'}>
                {set.collapsed ? '▸' : '▾'}
              </button>
              {renaming === set.id ? (
                <InlineName
                  initial={set.name}
                  onDone={(name) => {
                    if (name) drawingSets.rename(set.id, name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <b onDoubleClick={() => setRenaming(set.id)} title="Double-click to rename">
                  {set.name}
                </b>
              )}
              <span className="badge">{list.length}</span>
              <span className="spacer" />
              <button className="btn small flat" title="Previous sheet in the set" disabled={!list.length} onClick={() => step(list, -1)}>
                ‹
              </button>
              <button className="btn small flat" title="Next sheet in the set" disabled={!list.length} onClick={() => step(list, 1)}>
                ›
              </button>
              <button className={`btn small flat${editing === set.id ? ' active' : ''}`} title="Files and categories" onClick={() => setEditing(editing === set.id ? null : set.id)}>
                ⚙
              </button>
            </div>
            {editing === set.id && (
              <div className="set-edit" onKeyDown={(e) => e.stopPropagation()}>
                <label className="row">
                  Order
                  <select value={set.sort} onChange={(e) => drawingSets.setSort(set.id, e.target.value as DrawingSet['sort'])}>
                    <option value="sheet">By sheet number</option>
                    <option value="files">In file order</option>
                  </select>
                </label>
                <datalist id={`cats-${set.id}`}>
                  {['Architectural', 'Structural', 'Mechanical', 'Electrical', 'Plumbing', 'Civil', 'Landscape', ...categories].filter((c, i, a) => a.indexOf(c) === i).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <ul className="set-entries">
                  {set.entries.map((e, i) => (
                    <li key={e.fileId}>
                      <span className="set-file" title={nameOf(e.fileId)}>
                        {nameOf(e.fileId)}
                      </span>
                      <input list={`cats-${set.id}`} placeholder="Category" defaultValue={e.category ?? ''} onBlur={(ev) => drawingSets.setCategory(set.id, e.fileId, ev.target.value)} />
                      <button className="btn small flat" disabled={i === 0} title="Move up" onClick={() => drawingSets.moveFile(set.id, e.fileId, -1)}>
                        ↑
                      </button>
                      <button className="btn small flat" disabled={i === set.entries.length - 1} title="Move down" onClick={() => drawingSets.moveFile(set.id, e.fileId, 1)}>
                        ↓
                      </button>
                      <button className="btn small flat" title="Remove from the set" onClick={() => drawingSets.removeFile(set.id, e.fileId)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="row">
                  <select
                    value=""
                    aria-label="Add a file"
                    onChange={(ev) => {
                      if (!ev.target.value) return;
                      drawingSets.addFiles(set.id, [ev.target.value]);
                      if (!index[ev.target.value]) onIndex([ev.target.value]);
                    }}
                  >
                    <option value="">Add a file…</option>
                    {library
                      .filter((f) => !set.entries.some((e) => e.fileId === f.id))
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                  <button className="btn small" disabled={indexing} title="Read every file's sheet numbers again" onClick={() => onIndex(set.entries.map((e) => e.fileId))}>
                    Re-read sheets
                  </button>
                  <button
                    className="btn small flat"
                    onClick={() => {
                      if (confirm(`Delete the set "${set.name}"? Its files stay on the device.`)) drawingSets.remove(set.id);
                    }}
                  >
                    Delete set
                  </button>
                </div>
              </div>
            )}
            {!set.collapsed && (
              <>
                {missing.length > 0 && (
                  <p className="empty">
                    {missing.length} file{missing.length === 1 ? '' : 's'} not read yet.{' '}
                    <button className="btn small" disabled={indexing} onClick={() => onIndex(missing)}>
                      {indexing ? 'Reading…' : 'Read sheets'}
                    </button>
                  </p>
                )}
                <ul className="sheets set-sheets">
                  {shown.map((s, i) => {
                    const heading = i === 0 || shown[i - 1]!.category !== s.category;
                    const active = current?.fileId === s.fileId && current.page === s.page;
                    return (
                      <li key={`${s.fileId}:${s.page}`} className={active ? 'active' : ''}>
                        {heading && <div className="set-category">{s.category}</div>}
                        <button className="sheet" onClick={() => onOpenSheet(s.fileId, s.page)} title={`${nameOf(s.fileId)}, page ${s.page + 1}`}>
                          <span className="num">{s.number ?? `p. ${s.page + 1}`}</span>
                          <span className="name">{s.title ?? nameOf(s.fileId)}</span>
                        </button>
                      </li>
                    );
                  })}
                  {q && !shown.length && <li className="empty">No sheets match.</li>}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
