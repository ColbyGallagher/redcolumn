import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CustomColumn, Markup } from '@nb/markup';
import { matchesFilter, type CellContext } from '../columns/listColumns';
import {
  applyIncludeMode,
  catalogColumns,
  columnFromInfo,
  defaultBcf,
  defaultColumns,
  describeColumn,
  EXPORT_FORMAT,
  EXPORT_FORMATS,
  filterFromValues,
  includeMode,
  pageScopeLabel,
  parseBatchFile,
  parseBcf,
  readFilter,
  serializeBatchFile,
  serializeBcf,
  type BcfColumn,
  type BcfConfig,
  type PageScope,
  type SummaryColumnInfo,
} from '../summary/bcf';
import { columnHasValues, distinctValues, statusSample } from '../summary/exportSummary';

export interface SummaryFileInput {
  id: string;
  name: string;
  pageCount: number | null;
}

/** A folder chosen with the File System Access API, so Export to can write the report there. */
export interface SummaryDirectory {
  name: string;
  getFileHandle(name: string, options: { create: boolean }): Promise<{
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

export interface SummaryExportRequest {
  config: BcfConfig;
  files: { id: string; name: string; scope: PageScope }[];
  directory: SummaryDirectory | null;
}

interface FileRow {
  id: string;
  name: string;
  pageCount: number | null;
  scope: PageScope;
}

interface Props {
  docName: string;
  activeFile: SummaryFileInput | null;
  /** 1-based page in front. */
  currentPage: number;
  markups: readonly Markup[];
  ctx: CellContext;
  customColumns: readonly CustomColumn[];
  openFiles: readonly SummaryFileInput[];
  library: readonly { id: string; name: string }[];
  busy: boolean;
  /** Markups-list filters to seed the Filter tab (Bluebeam starts from those). */
  initialFilters: Readonly<Record<string, string>>;
  initialSort: { key: string; dir: 'asc' | 'desc' } | null;
  onExport: (req: SummaryExportRequest) => void;
  onDownload: (name: string, blob: Blob) => void;
  onClose: () => void;
}

type Tab = 'columns' | 'filter' | 'output';
type ResizeEdge = 'e' | 's' | 'se';

const SUMMARY_MIN_W = 560;
const SUMMARY_MIN_H = 480;
const SUMMARY_DEFAULT_W = 820;
const SUMMARY_DEFAULT_H = 680;

interface DialogBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function centeredSummaryBox(): DialogBox {
  const maxW = Math.max(320, window.innerWidth - 24);
  const maxH = Math.max(280, window.innerHeight - 24);
  const w = Math.min(SUMMARY_DEFAULT_W, maxW);
  const h = Math.min(SUMMARY_DEFAULT_H, maxH);
  return {
    w,
    h,
    x: Math.max(12, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(12, Math.round((window.innerHeight - h) / 2)),
  };
}

/** Keep a user-chosen size, only shrinking or shifting it so it stays on screen. */
function clampSummaryBox(box: DialogBox): DialogBox {
  const maxW = Math.max(320, window.innerWidth - 24);
  const maxH = Math.max(280, window.innerHeight - 24);
  const w = Math.min(box.w, maxW);
  const h = Math.min(box.h, maxH);
  return {
    w,
    h,
    x: Math.min(Math.max(12, box.x), Math.max(12, window.innerWidth - w - 12)),
    y: Math.min(Math.max(12, box.y), Math.max(12, window.innerHeight - h - 12)),
  };
}

function resizedSummaryBox(origin: DialogBox, dx: number, dy: number): DialogBox {
  const maxW = Math.max(320, window.innerWidth - origin.x - 12);
  const maxH = Math.max(280, window.innerHeight - origin.y - 12);
  return {
    x: origin.x,
    y: origin.y,
    w: Math.round(Math.min(maxW, Math.max(Math.min(SUMMARY_MIN_W, maxW), origin.w + dx))),
    h: Math.round(Math.min(maxH, Math.max(Math.min(SUMMARY_MIN_H, maxH), origin.h + dy))),
  };
}

const titleOf = (name: string) => name.replace(/\.pdf$/i, '') || 'Markup summary';

/**
 * Bluebeam's Markup Summary: files and page ranges, then Columns, Filter and Sort, and Output.
 * Save Config / Load Config is the .bcf. Save… / Load… is the file list.
 */
export function MarkupSummaryDialog(props: Props) {
  const { docName, activeFile, currentPage, markups, ctx, customColumns, openFiles, library, busy, initialFilters, initialSort, onExport, onDownload, onClose } = props;
  const catalog = useMemo(() => catalogColumns(customColumns, activeFile?.name || docName || 'document.pdf'), [customColumns, activeFile?.name, docName]);
  const [config, setConfig] = useState<BcfConfig>(() => seed(defaultBcf(titleOf(docName), defaultColumns(customColumns, activeFile?.name || docName || 'document.pdf')), catalog, initialFilters, initialSort, markups, ctx));
  const [files, setFiles] = useState<FileRow[]>(() => (activeFile ? [{ id: activeFile.id, name: activeFile.name, pageCount: activeFile.pageCount, scope: { kind: 'all' } }] : []));
  const [picked, setPicked] = useState(0);
  const [tab, setTab] = useState<Tab>('columns');
  const [addOpen, setAddOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [fromFile, setFromFile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filterKey, setFilterKey] = useState<string | null>(null);
  const folder = useRef<SummaryDirectory | null>(null);
  const configInput = useRef<HTMLInputElement>(null);
  const batchInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [box, setBox] = useState(centeredSummaryBox);
  const boxRef = useRef(box);
  boxRef.current = box;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onResize = () => setBox((current) => clampSummaryBox(current));
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  const onResizeDown = (edge: ResizeEdge) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const origin = boxRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const el = e.currentTarget;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = edge === 'e' ? 'ew-resize' : edge === 's' ? 'ns-resize' : 'nwse-resize';
    document.body.style.userSelect = 'none';
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = edge === 's' ? 0 : ev.clientX - startX;
      const dy = edge === 'e' ? 0 : ev.clientY - startY;
      setBox(resizedSummaryBox(origin, dx, dy));
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  const nudgeSize = (dx: number, dy: number) => setBox((current) => resizedSummaryBox(current, dx, dy));

  const described = config.Columns.map((column) => ({ column, info: describeColumn(column, catalog) }));
  const usedKeys = new Set(described.map((d) => d.info.key));
  const extras = catalog.filter((info) => !usedKeys.has(info.key));
  const listed = (info: SummaryColumnInfo, pinned: boolean) => config.ShowEmptyColumns || (pinned && (fromFile || !info.custom)) || columnHasValues(info.key, markups, ctx);
  const rows = [...described.filter((d) => listed(d.info, true)), ...extras.filter((info) => listed(info, false)).map((info) => ({ column: null as BcfColumn | null, info }))];
  const checkedCount = config.Columns.filter((c) => !c.FilterOnly).length;
  const filterRows = rows.filter((r) => config.ShowUnselectedColumns || (r.column != null && !r.column.FilterOnly));
  const sortChoices = filterRows.filter((r) => r.column);
  const primaryName = sortChoices.find((r) => r.column?.Key === config.Sorts[0]?.Item1)?.info.name ?? config.Sorts[0]?.Item1 ?? 'Subject';
  const allChecked = rows.length > 0 && rows.every((r) => (r.column ? !r.column.FilterOnly : false));

  const setColumn = (key: string, patch: (column: BcfColumn) => BcfColumn) => setConfig((c) => ({ ...c, Columns: c.Columns.map((column) => (column.Key === key ? patch(column) : column)) }));

  const toggle = (row: (typeof rows)[number], on: boolean) => {
    if (row.column) setColumn(row.column.Key, (column) => ({ ...column, FilterOnly: !on }));
    else if (on) setConfig((c) => ({ ...c, Columns: [...c.Columns, columnFromInfo(row.info, true)] }));
  };

  const toggleAll = (on: boolean) => {
    setConfig((c) => {
      const have = new Set(c.Columns.map((column) => column.Key));
      const next = c.Columns.map((column) => ({ ...column, FilterOnly: !on }));
      if (!on) return { ...c, Columns: next };
      for (const row of rows) if (!row.column && !have.has(row.info.bcfKey)) next.push(columnFromInfo(row.info, true));
      return { ...c, Columns: next };
    });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= config.Columns.length || from === to) return;
    setConfig((c) => {
      const columns = [...c.Columns];
      const [item] = columns.splice(from, 1);
      if (!item) return c;
      columns.splice(to, 0, item);
      return { ...c, Columns: columns };
    });
  };

  const addFiles = (incoming: readonly SummaryFileInput[]) => {
    setFiles((cur) => {
      const have = new Set(cur.map((f) => f.id));
      const next = [...cur];
      for (const f of incoming) if (f.id && !have.has(f.id)) next.push({ id: f.id, name: f.name, pageCount: f.pageCount, scope: { kind: 'all' } });
      return next;
    });
    setAddOpen(false);
    setLibraryOpen(false);
  };

  const loadConfigText = (text: string) => {
    const parsed = parseBcf(text);
    if (!parsed.Title) parsed.Title = titleOf(docName);
    setConfig(parsed);
    setFromFile(true);
    setMessage(`Loaded config: ${parsed.Columns.length} column${parsed.Columns.length === 1 ? '' : 's'}.`);
    setTab('columns');
  };

  const saveConfig = () => {
    const name = `${(config.Title || 'Markup summary').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Markup summary'}.bcf`;
    onDownload(name, new Blob([serializeBcf(config)], { type: 'application/json' }));
  };

  const saveBatch = () => {
    const xml = serializeBatchFile(files.map((f) => ({ filename: f.name, scope: f.scope })));
    onDownload(`${titleOf(docName) || 'files'} batch.xml`, new Blob([xml], { type: 'application/xml' }));
  };

  const loadBatchText = (text: string) => {
    const entries = parseBatchFile(text);
    const known = [...openFiles, ...library.map((f) => ({ ...f, pageCount: openFiles.find((o) => o.id === f.id)?.pageCount ?? null }))];
    const next: FileRow[] = [];
    const missing: string[] = [];
    for (const entry of entries) {
      const hit = known.find((f) => f.name.toLowerCase() === entry.filename.toLowerCase());
      if (!hit) missing.push(entry.filename);
      else next.push({ id: hit.id, name: hit.name, pageCount: hit.pageCount, scope: entry.scope });
    }
    if (next.length) setFiles(next);
    setPicked(0);
    setMessage(missing.length ? `Loaded ${next.length} file${next.length === 1 ? '' : 's'}. Not in the library: ${missing.join(', ')}.` : `Loaded ${next.length} file${next.length === 1 ? '' : 's'}.`);
  };

  const readChosen = (file: File | undefined, load: (text: string) => void) => {
    if (!file) return;
    void file.text().then(load).catch(() => setMessage('Could not read that file.'));
  };

  const browse = async () => {
    const pick = (window as unknown as { showDirectoryPicker?: () => Promise<SummaryDirectory> }).showDirectoryPicker;
    if (!pick) {
      setMessage('This browser has no folder picker. The path is kept in the config, and the report downloads instead.');
      return;
    }
    try {
      const handle = await pick();
      folder.current = handle;
      setConfig((c) => ({ ...c, Location: handle.name }));
    } catch {
      // Cancelled.
    }
  };

  const exportable = files.filter((f) => f.id);
  const canOk = !busy && checkedCount > 0 && exportable.length > 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal markup-summary"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ms-title">
          <h3 id={titleId}>Markup Summary</h3>
          <button type="button" className="btn small flat" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="ms-files">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Pages</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 && (
                <tr>
                  <td colSpan={2} className="ms-empty">
                    No files. Use Add to choose documents.
                  </td>
                </tr>
              )}
              {files.map((file, i) => (
                <tr key={file.id || file.name} className={i === picked ? 'selected' : ''} onClick={() => setPicked(i)}>
                  <td>{file.name}</td>
                  <td>
                    <select
                      aria-label={`Pages for ${file.name}`}
                      value={file.scope.kind}
                      onChange={(e) => {
                        const kind = e.target.value as PageScope['kind'];
                        setFiles((cur) => cur.map((f, n) => (n === i ? { ...f, scope: kind === 'custom' ? { kind, text: f.scope.kind === 'custom' ? f.scope.text : '' } : { kind } } : f)));
                      }}
                    >
                      <option value="all">{pageScopeLabel({ kind: 'all' }, file.pageCount, currentPage)}</option>
                      <option value="current">{pageScopeLabel({ kind: 'current' }, file.pageCount, file.id === activeFile?.id ? currentPage : 1)}</option>
                      <option value="custom">Pages…</option>
                    </select>
                    {file.scope.kind === 'custom' && (
                      <input
                        aria-label={`Page range for ${file.name}`}
                        value={file.scope.text}
                        placeholder="1-2, 4"
                        onChange={(e) => setFiles((cur) => cur.map((f, n) => (n === i ? { ...f, scope: { kind: 'custom', text: e.target.value } } : f)))}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ms-file-actions">
          <div className="ms-add">
            <button type="button" className="btn" aria-expanded={addOpen} aria-haspopup="menu" onClick={() => { setAddOpen((v) => !v); setLibraryOpen(false); }}>
              Add ▾
            </button>
            {addOpen && (
              <div className="ms-menu" role="menu">
                <button type="button" role="menuitem" disabled={!openFiles.some((f) => !files.some((have) => have.id === f.id))} onClick={() => addFiles(openFiles)}>
                  Add Open Files
                </button>
                <button type="button" role="menuitem" onClick={() => setLibraryOpen((v) => !v)}>
                  Add Files…
                </button>
                {libraryOpen && (
                  <div className="ms-library">
                    {library.length === 0 && <p>No documents in the library.</p>}
                    {library.map((f) => (
                      <label key={f.id}>
                        <input type="checkbox" checked={files.some((have) => have.id === f.id)} onChange={(e) => (e.target.checked ? addFiles([{ id: f.id, name: f.name, pageCount: openFiles.find((o) => o.id === f.id)?.pageCount ?? null }]) : setFiles((cur) => cur.filter((have) => have.id !== f.id)))} />
                        {f.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button type="button" className="btn" disabled={!files.length} onClick={() => setFiles((cur) => cur.filter((_, i) => i !== picked))}>
            Remove
          </button>
          <span className="ms-spacer" />
          <button type="button" className="btn" disabled={!files.length} onClick={saveBatch}>
            Save…
          </button>
          <button type="button" className="btn" onClick={() => batchInput.current?.click()}>
            Load…
          </button>
        </div>

        <div className="tabs ms-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'columns'} className={tab === 'columns' ? 'active' : ''} onClick={() => setTab('columns')}>
            Columns
          </button>
          <button type="button" role="tab" aria-selected={tab === 'filter'} className={tab === 'filter' ? 'active' : ''} onClick={() => setTab('filter')}>
            Filter and Sort
          </button>
          <button type="button" role="tab" aria-selected={tab === 'output'} className={tab === 'output' ? 'active' : ''} onClick={() => setTab('output')}>
            Output
          </button>
        </div>

        {tab === 'columns' && (
          <div className="ms-pane" role="tabpanel">
            <div className="ms-grid">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" aria-label="Select all columns" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
                    </th>
                    <th>Name</th>
                    <th>Sample</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const index = row.column ? config.Columns.findIndex((c) => c.Key === row.column!.Key) : -1;
                    const sample = sampleOf(row.info, markups, ctx);
                    return (
                      <tr
                        key={row.column?.Key ?? row.info.bcfKey}
                        draggable={index >= 0}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = Number(e.dataTransfer.getData('text/plain'));
                          if (index >= 0 && Number.isFinite(from)) move(from, index);
                        }}
                      >
                        <td>
                          <input type="checkbox" aria-label={row.info.name} checked={row.column ? !row.column.FilterOnly : false} onChange={(e) => toggle(row, e.target.checked)} />
                        </td>
                        <td>{row.info.name}</td>
                        <td className="ms-sample" title={sample.title}>
                          {sample.color ? <span className="ms-swatch" style={{ background: sample.color }} /> : sample.tick ? <span className="ms-tick">✓</span> : sample.text}
                        </td>
                        <td>{row.info.typeLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label className="ms-check">
              <input type="checkbox" checked={config.ShowEmptyColumns} onChange={(e) => setConfig((c) => ({ ...c, ShowEmptyColumns: e.target.checked }))} />
              Show Empty Columns
            </label>
          </div>
        )}

        {tab === 'filter' && (
          <div className="ms-pane" role="tabpanel">
            <div className="ms-grid">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Filter</th>
                  </tr>
                </thead>
                <tbody>
                  {filterRows.map((row) => {
                    const column = row.column;
                    const values = distinctValues(row.info, markups, ctx);
                    const read = column ? readFilter(column.Filter) : { values: null, custom: false };
                    return (
                      <tr key={column?.Key ?? row.info.key}>
                        <td>{row.info.name}</td>
                        <td>
                          {column ? (
                            <FilterMenu
                              open={filterKey === column.Key}
                              custom={read.custom}
                              selected={read.values}
                              values={values}
                              onOpen={() => setFilterKey((k) => (k === column.Key ? null : column.Key))}
                              onChange={(selected) => setColumn(column.Key, (current) => ({ ...current, ...(selected ? { Filter: filterFromValues(selected) } : { Filter: undefined }) }))}
                            />
                          ) : (
                            <span className="ms-all">[All]</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label className="ms-check">
              <input type="checkbox" checked={config.ShowUnselectedColumns} onChange={(e) => setConfig((c) => ({ ...c, ShowUnselectedColumns: e.target.checked }))} />
              Show All Columns
            </label>
            <div className="ms-sort">
              <SortRow
                label="Sort By"
                value={config.Sorts[0]?.Item1 ?? ''}
                ascending={config.Sorts[0]?.Item2 ?? true}
                choices={sortChoices.flatMap((r) => (r.column ? [{ key: r.column.Key, name: r.info.name }] : []))}
                onChange={(key, ascending) =>
                  setConfig((c) => {
                    const rest = c.Sorts.slice(1);
                    return { ...c, Sorts: key ? [{ Item1: key, Item2: ascending }, ...rest] : rest };
                  })
                }
              />
              {config.Sorts.slice(1).map((sort, i) => (
                <SortRow
                  key={`${sort.Item1}:${i}`}
                  label="Then by"
                  value={sort.Item1}
                  ascending={sort.Item2}
                  choices={sortChoices.flatMap((r) => (r.column ? [{ key: r.column.Key, name: r.info.name }] : []))}
                  onChange={(key, ascending) =>
                    setConfig((c) => {
                      const sorts = [...c.Sorts];
                      if (!key) sorts.splice(i + 1, 1);
                      else sorts[i + 1] = { Item1: key, Item2: ascending };
                      return { ...c, Sorts: sorts };
                    })
                  }
                />
              ))}
              <SortRow
                label={config.Sorts.length ? 'Then by' : 'Sort By'}
                value=""
                ascending
                choices={sortChoices.flatMap((r) => (r.column ? [{ key: r.column.Key, name: r.info.name }] : []))}
                onChange={(key, ascending) => {
                  if (!key) return;
                  setConfig((c) => ({ ...c, Sorts: [...c.Sorts, { Item1: key, Item2: ascending }] }));
                }}
              />
            </div>
          </div>
        )}

        {tab === 'output' && (
          <div className="ms-pane ms-output" role="tabpanel">
            <label className="ms-field">
              <span>Export as</span>
              <select aria-label="Export as" value={config.ExportFormat} onChange={(e) => setConfig((c) => ({ ...c, ExportFormat: Number(e.target.value) }))}>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            {config.ExportFormat !== EXPORT_FORMAT.Print && (
              <>
                <label className="ms-field">
                  <span>Export to</span>
                  <input aria-label="Export to" value={config.Location} onChange={(e) => setConfig((c) => ({ ...c, Location: e.target.value }))} />
                  <button type="button" className="btn" onClick={() => void browse()} aria-label="Browse for a folder">
                    …
                  </button>
                </label>
                <label className="ms-check">
                  <input type="checkbox" checked={config.ReplaceExistingFiles} onChange={(e) => setConfig((c) => ({ ...c, ReplaceExistingFiles: e.target.checked }))} />
                  Overwrite Existing File
                </label>
              </>
            )}
            <label className="ms-field">
              <span>File name</span>
              <input aria-label="File name" value={config.Title} onChange={(e) => setConfig((c) => ({ ...c, Title: e.target.value }))} />
            </label>
            {config.ExportFormat !== EXPORT_FORMAT.Print && (
              <>
                <label className="ms-check">
                  <input type="checkbox" checked={config.SplitReportOnPrimarySort} onChange={(e) => setConfig((c) => ({ ...c, SplitReportOnPrimarySort: e.target.checked }))} />
                  Create Multiple Reports Per {primaryName}
                </label>
                <label className="ms-check">
                  <input type="checkbox" checked={config.AppendDateToTitle} onChange={(e) => setConfig((c) => ({ ...c, AppendDateToTitle: e.target.checked }))} />
                  Append Date to Title
                </label>
              </>
            )}
            <fieldset className="ms-include">
              <legend>Include</legend>
              {(['markups', 'totals', 'both'] as const).map((mode) => (
                <label key={mode} className="ms-check">
                  <input type="radio" name="include" checked={includeMode(config) === mode} onChange={() => setConfig((c) => applyIncludeMode(c, mode))} />
                  {mode === 'markups' ? 'Markups' : mode === 'totals' ? 'Totals' : 'Markups & Totals'}
                </label>
              ))}
            </fieldset>
            {config.ExportFormat === EXPORT_FORMAT.CSV && (
              <label className="ms-check">
                <input type="checkbox" checked={config.IncludeHeaders} onChange={(e) => setConfig((c) => ({ ...c, IncludeHeaders: e.target.checked }))} />
                Column Headers
              </label>
            )}
            {config.ExportFormat === EXPORT_FORMAT.CSV && (
              <label className="ms-check">
                <input type="checkbox" checked={config.IncludeIDColumn} onChange={(e) => setConfig((c) => ({ ...c, IncludeIDColumn: e.target.checked }))} />
                ID Columns
              </label>
            )}
            {config.ExportFormat !== EXPORT_FORMAT.Print && (
              <>
                <label className="ms-check">
                  <input type="checkbox" checked={config.IncludeUnits} onChange={(e) => setConfig((c) => ({ ...c, IncludeUnits: e.target.checked }))} />
                  Include Measurement Units
                </label>
                <label className="ms-check">
                  <input type="checkbox" checked={config.FormatNumbers} onChange={(e) => setConfig((c) => ({ ...c, FormatNumbers: e.target.checked }))} />
                  Format Numbers
                </label>
              </>
            )}
            <label className="ms-check">
              <input type="checkbox" checked={config.IncludeReplies} onChange={(e) => setConfig((c) => ({ ...c, IncludeReplies: e.target.checked }))} />
              Replies
            </label>
            {(config.ExportFormat === EXPORT_FORMAT.CSV || config.ExportFormat === EXPORT_FORMAT.PDF || config.ExportFormat === EXPORT_FORMAT.Print) && (
              <>
                <label className="ms-check">
                  <input type="checkbox" checked={config.IncludeFullStatusHistory} onChange={(e) => setConfig((c) => ({ ...c, IncludeFullStatusHistory: e.target.checked }))} />
                  Full Status History
                </label>
                <label className="ms-check indent">
                  <input type="checkbox" checked={config.IncludeStatusAuthorAndTime} disabled={!config.IncludeFullStatusHistory} onChange={(e) => setConfig((c) => ({ ...c, IncludeStatusAuthorAndTime: e.target.checked }))} />
                  Include Status Author and Time
                </label>
              </>
            )}
            {config.ExportFormat === EXPORT_FORMAT.PDF && (
              <label className="ms-check">
                <input type="checkbox" checked={config.AppendToCurrentPDF} onChange={(e) => setConfig((c) => ({ ...c, AppendToCurrentPDF: e.target.checked }))} />
                Append to Current PDF
              </label>
            )}
          </div>
        )}

        {message && <p className="ms-message">{message}</p>}

        <div className="ms-footer">
          <label className="ms-check">
            {config.ExportFormat !== EXPORT_FORMAT.Print && (
              <>
                <input type="checkbox" checked={config.OpenDocument} onChange={(e) => setConfig((c) => ({ ...c, OpenDocument: e.target.checked }))} />
                Open File After Creation
              </>
            )}
          </label>
          <span className="ms-spacer" />
          <button type="button" className="btn" onClick={saveConfig}>
            Save Config
          </button>
          <button type="button" className="btn" onClick={() => configInput.current?.click()}>
            Load Config
          </button>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" disabled={!canOk} onClick={() => onExport({ config, files: exportable.map((f) => ({ id: f.id, name: f.name, scope: f.scope })), directory: folder.current })}>
            {busy ? 'Working…' : 'OK'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        <input ref={configInput} type="file" accept=".bcf,.json,application/json" hidden onChange={(e) => { readChosen(e.target.files?.[0], loadConfigText); e.target.value = ''; }} />
        <input ref={batchInput} type="file" accept=".xml,.bcx,application/xml,text/xml" hidden onChange={(e) => { readChosen(e.target.files?.[0], loadBatchText); e.target.value = ''; }} />
        <div className="ms-resize ms-resize-e" aria-hidden="true" onPointerDown={onResizeDown('e')} />
        <div className="ms-resize ms-resize-s" aria-hidden="true" onPointerDown={onResizeDown('s')} />
        <div
          className="ms-resize ms-resize-se"
          role="slider"
          tabIndex={0}
          aria-label="Resize dialog"
          aria-valuemin={SUMMARY_MIN_W}
          aria-valuemax={Math.max(SUMMARY_MIN_W, window.innerWidth - 24)}
          aria-valuenow={box.w}
          aria-orientation="horizontal"
          onPointerDown={onResizeDown('se')}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 48 : 16;
            if (e.key === 'ArrowRight') { e.preventDefault(); nudgeSize(step, 0); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeSize(-step, 0); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); nudgeSize(0, step); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); nudgeSize(0, -step); }
          }}
        />
      </div>
    </div>
  );
}

/** @deprecated Use MarkupSummaryDialog. Kept so older imports still compile. */
export const ExportDialog = MarkupSummaryDialog;

function seed(config: BcfConfig, catalog: readonly SummaryColumnInfo[], filters: Readonly<Record<string, string>>, sort: { key: string; dir: 'asc' | 'desc' } | null, markups: readonly Markup[], ctx: CellContext): BcfConfig {
  let next = config;
  if (sort) {
    const info = catalog.find((c) => c.key === sort.key);
    if (info) next = { ...next, Sorts: [{ Item1: info.bcfKey, Item2: sort.dir !== 'desc' }] };
  }
  if (!Object.values(filters).some((f) => f.trim())) return next;
  return {
    ...next,
    Columns: next.Columns.map((column) => {
      const info = describeColumn(column, catalog);
      const filter = filters[info.key]?.trim();
      if (!filter) return column;
      const all = distinctValues(info, markups, ctx);
      const picked = all.filter((value) => matchesFilter({ text: value, num: null }, filter));
      if (!picked.length || picked.length === all.length) return column;
      return { ...column, Filter: filterFromValues(picked) };
    }),
  };
}

function sampleOf(info: SummaryColumnInfo, markups: readonly Markup[], ctx: CellContext): { text: string; title: string; color?: string; tick?: boolean } {
  if (!markups.length) return { text: 'Empty', title: 'Empty' };
  if (info.key === 'color') {
    const m = markups.find((markup) => markup.style.stroke);
    return m ? { text: '', title: m.style.stroke, color: m.style.stroke } : { text: 'Empty', title: 'Empty' };
  }
  if (info.key === 'status') {
    const m = markups.find((markup) => markup.statusHistory?.length || markup.status) ?? markups[0];
    const text = m ? statusSample(m, ctx.statuses) : '';
    return { text: text || 'Empty', title: text || 'Empty' };
  }
  const cells = markups.map((m) => distinctValues(info, [m], ctx)[0] ?? '');
  const text = cells.find((value) => value !== '') ?? '';
  if (!text) return { text: 'Empty', title: 'Empty' };
  if (info.typeLabel === 'Tick mark' || info.key === 'checked') return { text: '', title: text, tick: true };
  return { text, title: text };
}

function FilterMenu({ open, custom, selected, values, onOpen, onChange }: { open: boolean; custom: boolean; selected: string[] | null; values: string[]; onOpen: () => void; onChange: (selected: string[] | null) => void }) {
  const options = [...values];
  for (const value of selected ?? []) if (!options.includes(value)) options.push(value);
  const all = selected == null && !custom;
  const label = custom ? '[Custom]' : all ? '[All]' : selected!.length === 0 ? '(none)' : selected!.length === 1 ? selected![0] || '(blank)' : `${selected!.length} selected`;
  const checked = (value: string) => (selected == null ? !custom : selected.includes(value));
  const toggle = (value: string, on: boolean) => {
    const current = selected ?? options;
    const next = on ? [...new Set([...current, value])] : current.filter((v) => v !== value);
    onChange(next.length === options.length ? null : next);
  };
  return (
    <div className="ms-filter">
      <button type="button" className="ms-filter-btn" aria-expanded={open} onClick={onOpen}>
        {label || '[All]'}
      </button>
      {open && (
        <div className="ms-filter-pop" role="group" aria-label="Filter values">
          <label>
            <input
              type="checkbox"
              checked={all || (selected != null && options.every((v) => selected.includes(v)))}
              onChange={(e) => onChange(e.target.checked ? null : [])}
            />
            [All]
          </label>
          {options.map((value) => (
            <label key={value || '(blank)'}>
              <input type="checkbox" checked={checked(value)} onChange={(e) => toggle(value, e.target.checked)} />
              {value || '(blank)'}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SortRow({ label, value, ascending, choices, onChange }: { label: string; value: string; ascending: boolean; choices: { key: string; name: string }[]; onChange: (key: string, ascending: boolean) => void }) {
  const known = value && !choices.some((c) => c.key === value);
  return (
    <div className="ms-sort-row">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value, ascending)}>
        <option value="" />
        {known && <option value={value}>{value}</option>}
        {choices.map((c) => (
          <option key={c.key} value={c.key}>
            {c.name}
          </option>
        ))}
      </select>
      <select aria-label={`${label} direction`} value={ascending ? 'asc' : 'desc'} onChange={(e) => onChange(value, e.target.value === 'asc')}>
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </select>
    </div>
  );
}
