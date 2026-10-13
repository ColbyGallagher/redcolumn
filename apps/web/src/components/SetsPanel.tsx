import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings, type Settings } from '../settings/settings';
import type { StoredFile } from '../storage/fileStore';
import { drawingSets, neighbourSheet, revisionPairs, setSheets, sheetKey, unindexed, useDrawingSets, type DrawingSet, type SetListOptions, type SetSheet } from '../storage/sets';
import { InlineName } from './InlineName';

interface Props {
  library: readonly StoredFile[];
  /** The sheet in front, to highlight and to step from. */
  current: { fileId: string; page: number } | null;
  onOpenSheet: (fileId: string, page: number) => void;
  /** Reads the sheets of files not indexed yet. */
  onIndex: (fileIds: string[]) => void;
  indexing: boolean;
  /** New revisions in a set to follow up (copy markups, stamp the earlier one), as `earlier>later` keys. */
  onRevisions: (setId: string, pairs: { key: string; earlier: SetSheet; later: SetSheet }[]) => void;
  /** A small picture of a sheet, for the hover preview; null when it cannot be made. */
  onPreview: (fileId: string, page: number) => Promise<string | null>;
}

/** Tags every set offers besides the ones in Preferences › Sets › Tags. */
const BUILT_IN_TAGS = ['Revision Number', 'Discipline', 'Sheet Type'];

/** How a set lists its sheets, from Preferences › Sets. */
function listOptions(set: DrawingSet, prefs: Settings, library: readonly StoredFile[]): Partial<SetListOptions> {
  const autoMark = (name: string) => prefs.setTags.find((t) => t.name === name)?.autoMark ?? true;
  return {
    fileName: (id) => library.find((f) => f.id === id)?.name ?? 'Missing file',
    addedAt: (id) => library.find((f) => f.id === id)?.addedAt ?? 0,
    categories: prefs.setCategories,
    template: prefs.setTemplates[set.template ?? prefs.setDefaultTemplate] ?? null,
    autoMark: { number: autoMark('Sheet Number'), title: autoMark('Sheet Name') },
    autoTagRevision: prefs.setAutoTagRevision,
    autoTagDiscipline: prefs.setAutoTagDiscipline,
    autoTagSheetType: prefs.setAutoTagSheetType,
    sortBy: prefs.setSortBy,
    sortTagged: prefs.setSortTagged,
    sortOrder: prefs.setSortOrder,
    revisionFilter: prefs.setRevisionFilter,
    wildcard: prefs.setWildcard,
    previousRevisions: prefs.setPreviousRevisions,
    currentRevisions: prefs.setCurrentRevisions,
  };
}

/**
 * Sets: drawing files shown as one sheet list, by category and sheet number, laid out as
 * Preferences › Sets says. Clicking a sheet opens its file at that page; Previous and Next step
 * through the whole set across files.
 */
export function SetsPanel({ library, current, onOpenSheet, onIndex, indexing, onRevisions, onPreview }: Props) {
  const { sets, index } = useDrawingSets();
  const prefs = useSettings();
  const [creating, setCreating] = useState<string[] | null>(null);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState(prefs.setDefaultTemplate);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  /** The sheet whose tags are being edited, as `setId|sheetKey`. */
  const [tagging, setTagging] = useState<string | null>(null);
  /** Stacked revisions and multi-page files opened up, by `setId|key`. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<{ key: string; url: string; top: number } | null>(null);
  const previewTimer = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const following = useRef(new Set<string>());
  const nameOf = (id: string) => library.find((f) => f.id === id)?.name ?? 'Missing file';
  const q = filter.trim().toLowerCase();
  const matches = (s: SetSheet) => !q || `${s.number ?? ''} ${s.title ?? ''} ${s.fileName} ${Object.values(s.tags).join(' ')}`.toLowerCase().includes(q);
  const toggle = (key: string) => setOpened((o) => (o.has(key) ? new Set([...o].filter((k) => k !== key)) : new Set([...o, key])));

  // New revisions are followed up once. A set listed for the first time takes the revisions it
  // already has as done, so turning the preferences on never changes documents after the fact.
  useEffect(() => {
    for (const set of sets) {
      const all = setSheets(set, index, { ...listOptions(set, prefs, library), previousRevisions: 'none', currentRevisions: 'none' });
      const pairs = revisionPairs(all);
      if (!set.revised) {
        drawingSets.markRevised(set.id, pairs.map((p) => p.key));
        continue;
      }
      const fresh = pairs.filter((p) => !set.revised!.includes(p.key) && !following.current.has(p.key));
      if (!fresh.length) continue;
      // Neither follow-up turned on: noted as seen, so turning one on later does not act on them.
      if (!prefs.setCopyMarkups && !prefs.setStampSuperseded) {
        drawingSets.markRevised(set.id, fresh.map((p) => p.key));
        continue;
      }
      fresh.forEach((p) => following.current.add(p.key));
      onRevisions(set.id, fresh);
    }
  }, [sets, index, prefs, library, onRevisions]);

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  const step = (list: readonly SetSheet[], by: -1 | 1) => {
    const here = current ? neighbourSheet(list, current.fileId, current.page, by) : null;
    const inSet = current && list.some((s) => s.fileId === current.fileId && s.page === current.page);
    const target = inSet ? here : list[by === 1 ? 0 : list.length - 1];
    if (target) onOpenSheet(target.fileId, target.page);
  };

  /** A sheet's two columns, as Preferences › Sets › Show says. */
  const labels = (s: SetSheet): [string, string] => {
    const multi = (index[s.fileId]?.pageCount ?? 1) > 1;
    if (prefs.setShow === 'fileName') return [s.fileName.replace(/\.pdf$/i, ''), multi ? `p. ${s.page + 1}` : (s.title ?? '')];
    if (prefs.setShow === 'pageLabel') return [s.number ?? `p. ${s.page + 1}`, s.title ?? ''];
    return [s.number ?? `p. ${s.page + 1}`, s.title ?? s.fileName];
  };

  const hover = (s: SetSheet, el: HTMLElement | null) => {
    clearTimeout(previewTimer.current);
    if (!el || !prefs.setPreview) {
      setPreview(null);
      return;
    }
    const key = sheetKey(s);
    const top = el.getBoundingClientRect().top - (panel.current?.getBoundingClientRect().top ?? 0) + (panel.current?.scrollTop ?? 0);
    previewTimer.current = window.setTimeout(() => {
      void onPreview(s.fileId, s.page).then((url) => setPreview((p) => (url && (!p || p.key !== key) ? { key, url, top } : p)));
    }, 400);
  };

  const sheetRow = (set: DrawingSet, s: SetSheet, extra?: ReactNode, nested = false): ReactNode => {
    const active = current?.fileId === s.fileId && current.page === s.page;
    const crossed = s.superseded && prefs.setPreviousRevisions === 'crossOut';
    const [num, name] = labels(s);
    const tagKey = `${set.id}|${sheetKey(s)}`;
    return (
      <li key={sheetKey(s)} className={`${active ? 'active' : ''}${nested ? ' nested' : ''}`}>
        <div className="set-sheet-row">
          <button
            className={`sheet${crossed ? ' superseded' : ''}`}
            onClick={() => onOpenSheet(s.fileId, s.page)}
            onMouseEnter={(e) => hover(s, e.currentTarget)}
            onMouseLeave={() => hover(s, null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTagging(tagging === tagKey ? null : tagKey);
            }}
            title={`${s.fileName}, page ${s.page + 1}${s.revision !== null ? ` · revision ${s.tags['Revision Number'] ?? s.revision}` : ''}${s.superseded ? ' (superseded)' : ''}. Right-click to edit its tags.`}
          >
            <span className="num">{num}</span>
            <span className="name">{name}</span>
          </button>
          <button className="btn small flat set-tag-btn" title="Tags" onClick={() => setTagging(tagging === tagKey ? null : tagKey)}>
            #
          </button>
        </div>
        {extra}
        {tagging === tagKey && tagEditor(set, s)}
      </li>
    );
  };

  /** The sheet's tags: those in Preferences › Sets › Tags and the built-in ones, typed values over what was read. */
  const tagEditor = (set: DrawingSet, s: SetSheet) => {
    const typed = set.tags?.[sheetKey(s)] ?? {};
    const names = [...new Set([...prefs.setTags.map((t) => t.name), ...BUILT_IN_TAGS, ...Object.keys(typed)])];
    return (
      <div className="set-tags" onKeyDown={(e) => e.stopPropagation()}>
        {names.map((name) => {
          const type = prefs.setTags.find((t) => t.name === name)?.type ?? 'text';
          return (
            <label key={name} className="row">
              <span>{name}</span>
              <input
                type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
                defaultValue={typed[name] ?? ''}
                placeholder={typed[name] ? '' : (s.tags[name] ?? '')}
                onBlur={(e) => {
                  if (e.target.value.trim() !== (typed[name] ?? '')) drawingSets.setTag(set.id, sheetKey(s), name, e.target.value);
                }}
              />
            </label>
          );
        })}
        <div className="row">
          <button className="btn small" onClick={() => setTagging(null)}>
            Done
          </button>
        </div>
      </div>
    );
  };

  /** The sheets of one set, with category headings, stacked revisions and stacked multi-page files. */
  const sheetList = (set: DrawingSet, shown: SetSheet[]) => {
    const rows: ReactNode[] = [];
    const filesDone = new Set<string>();
    shown.forEach((s, i) => {
      if (s.category && (i === 0 || shown[i - 1]!.category !== s.category)) rows.push(<li key={`cat:${s.category}`} className="set-category">{s.category}</li>);
      const pages = prefs.setStackMultiPage ? shown.filter((x) => x.fileId === s.fileId && x.category === s.category) : [];
      if (pages.length > 1) {
        // Multi-page documents stacked: one row for the file, its pages under it.
        const key = `${set.id}|file:${s.fileId}:${s.category}`;
        if (filesDone.has(key)) return;
        filesDone.add(key);
        const open = opened.has(key);
        rows.push(
          <li key={key} className="set-file-row">
            <button className="sheet" onClick={() => toggle(key)} title={open ? 'Hide its pages' : 'Show its pages'}>
              <span className="num">{open ? '▾' : '▸'}</span>
              <span className="name">
                {s.fileName} <span className="badge">{pages.length}</span>
              </span>
            </button>
          </li>,
        );
        if (open) pages.forEach((p) => rows.push(sheetRow(set, p, stack(set, p), true)));
        return;
      }
      rows.push(sheetRow(set, s, stack(set, s)));
    });
    return rows;
  };

  /** Earlier revisions stacked under a sheet (Current Revisions: Stack). */
  const stack = (set: DrawingSet, s: SetSheet): ReactNode => {
    if (!s.previous.length) return null;
    const key = `${set.id}|rev:${sheetKey(s)}`;
    const open = opened.has(key);
    return (
      <>
        <button className="btn small flat set-stack" onClick={() => toggle(key)}>
          {open ? '▾' : '▸'} {s.previous.length} earlier revision{s.previous.length === 1 ? '' : 's'}
        </button>
        {open && <ul className="sheets set-sheets">{s.previous.map((p) => sheetRow(set, p, null, true))}</ul>}
      </>
    );
  };

  const templates = Object.keys(prefs.setTemplates);
  return (
    <div className="sets-panel" ref={panel}>
      <div className="sheet-actions">
        <button
          className="btn small"
          disabled={!library.length}
          onClick={() => {
            setCreating(current ? [current.fileId] : []);
            setNewTemplate(prefs.setDefaultTemplate);
          }}
        >
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
            const id = drawingSets.create(newName.trim() || 'New Set', creating, newTemplate);
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
          {prefs.setPromptTemplate && (
            <label className="row">
              Template
              <select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
                {templates.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
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
        const list = setSheets(set, index, listOptions(set, prefs, library));
        const missing = unindexed(set, index);
        const shown = list.filter((s) => matches(s) || s.previous.some(matches));
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
                    <option value="auto">As in Preferences › Sets</option>
                    <option value="sheet">By sheet number</option>
                    <option value="files">In file order</option>
                  </select>
                </label>
                {prefs.setCategories === 'auto' && (
                  <label className="row">
                    Template
                    <select value={set.template ?? prefs.setDefaultTemplate} onChange={(e) => drawingSets.setTemplate(set.id, e.target.value)}>
                      {templates.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
                      {prefs.setCategories !== 'none' && (
                        <input
                          list={`cats-${set.id}`}
                          placeholder={prefs.setCategories === 'auto' ? 'Category if not matched' : 'Category'}
                          defaultValue={e.category ?? ''}
                          onBlur={(ev) => drawingSets.setCategory(set.id, e.fileId, ev.target.value)}
                        />
                      )}
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
                  {sheetList(set, shown)}
                  {q && !shown.length && <li className="empty">No sheets match.</li>}
                </ul>
              </>
            )}
          </section>
        );
      })}
      {preview && (
        <img className="set-preview" src={preview.url} alt="" style={{ top: preview.top }} onMouseEnter={() => setPreview(null)} />
      )}
    </div>
  );
}
