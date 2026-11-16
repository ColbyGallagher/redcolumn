import { useState } from 'react';
import type { MarkupStatusDef } from '@nb/markup';
import { REGISTER_VALUES, blankKey, cellRef, fieldKey, parseCellRef, withStatuses, type RegisterCell, type RegisterColumn, type RegisterField, type RegisterTemplate, type RegisterValue } from '../sheetsync/register';
import { columnName } from '../sheetsync/xlsx';

/** Which markups a register lists: those that say something, or every markup. */
export type RegisterScope = 'comments' | 'all';

interface ExportProps {
  docName: string;
  templates: readonly RegisterTemplate[];
  /** The template to start on (the one kept beside the document's drawing standard). */
  initialId?: string;
  /** What the cells above the table start with. */
  values: Partial<Record<RegisterValue, string>>;
  counts: Record<RegisterScope, number>;
  /** Whether this app can fill in a client's own file (the Windows desktop app). */
  canFill: boolean;
  /** `fill`: write into a copy of the template's client file instead of a new workbook. */
  onExport: (template: RegisterTemplate, scope: RegisterScope, values: Partial<Record<RegisterValue, string>>, fill: boolean) => Promise<void>;
  /** Opens the template editor (on this template, or to make the first one). */
  onTemplates: (id?: string) => void;
  onClose: () => void;
}

/** File › Export › Comment Register: pick the client's template, check the details, export. */
export function ExportRegisterDialog({ docName, templates, initialId, values: initial, counts, canFill, onExport, onTemplates, onClose }: ExportProps) {
  const [id, setId] = useState(initialId ?? templates[0]?.id ?? '');
  const [scope, setScope] = useState<RegisterScope>('comments');
  const [values, setValues] = useState(initial);
  const [into, setInto] = useState<'client' | 'new'>('client');
  const [busy, setBusy] = useState(false);
  const template = templates.find((t) => t.id === id) ?? templates[0];
  const fill = canFill && !!template?.clientFile && into === 'client';
  // Only the details this template shows are asked for.
  const used = REGISTER_VALUES.filter((v) => template?.cells.some((c) => c.value === v.value));
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal register-dialog" role="dialog" aria-label="Export comment register" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Export Comment Register</h3>
        {template ? (
          <>
            <p className="hint-text">
              Writes the comments on <b>{docName}</b> to an Excel workbook in a client's register layout. The designer fills in responses and statuses, and the workbook comes back with File › Import › Markups from Excel.
            </p>
            <label className="col-field">
              <span>Template</span>
              <select aria-label="Register template" value={template.id} onChange={(e) => setId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn small" onClick={() => onTemplates(template.id)}>
                Edit Templates…
              </button>
            </label>
            <label className="col-field">
              <span>Rows</span>
              <select aria-label="Register rows" value={scope} onChange={(e) => setScope(e.target.value as RegisterScope)}>
                <option value="comments">Markups with a comment ({counts.comments})</option>
                <option value="all">Every markup ({counts.all})</option>
              </select>
            </label>
            {canFill && template.clientFile && (
              <label className="col-field">
                <span>Workbook</span>
                <select aria-label="Register workbook" value={into} onChange={(e) => setInto(e.target.value === 'new' ? 'new' : 'client')}>
                  <option value="client">A copy of the client’s file ({template.clientFile.name})</option>
                  <option value="new">A new workbook in the template’s layout</option>
                </select>
              </label>
            )}
            {used.map((v) => (
              <label key={v.value} className="col-field">
                <span>{v.label}</span>
                <input aria-label={v.label} value={values[v.value] ?? ''} onChange={(e) => setValues((cur) => ({ ...cur, [v.value]: e.target.value }))} />
              </label>
            ))}
            <p className="hint-text">
              {fill
                ? 'Excel fills in a copy of the client’s file: its title block, logos and styles stay as they are, and you choose where the copy is saved. The copy is not protected.'
                : template.protection === 'protected'
                ? 'This template is protected: only the columns to fill in can be changed. The designer can filter the sheet but not sort it. The password is written on the workbook’s Read me sheet.'
                : 'This template is open: nothing is locked, so the sheet can be sorted.'}
            </p>
          </>
        ) : (
          <p>There are no register templates yet. A template sets the column headings, the status wording and the block above the table for one client.</p>
        )}
        <div className="actions">
          {!template && (
            <button type="button" className="btn" onClick={() => onTemplates()}>
              New Template…
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!template || !counts[scope] || busy}
            onClick={() => {
              if (!template) return;
              setBusy(true);
              void onExport(template, scope, values, fill).finally(() => setBusy(false));
            }}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TemplatesProps {
  templates: readonly RegisterTemplate[];
  /** The template to open on. */
  initialId?: string;
  /** Clients' drawing standards, to keep a template beside one. */
  standards: readonly { id: string; name: string }[];
  /** The columns the open document's list has. */
  listColumns: readonly { key: string; label: string }[];
  statuses: readonly MarkupStatusDef[];
  /** A new template to start from. */
  onNew: () => RegisterTemplate;
  onSave: (template: RegisterTemplate) => void;
  onDelete: (id: string) => void;
  /** Reads a shared template file; null when cancelled or unreadable (the caller says why). */
  onImportFile: () => Promise<RegisterTemplate | null>;
  onExportFile: (template: RegisterTemplate) => void;
  /**
   * Picks the client's own register file and checks it against the template as it is being edited;
   * null when cancelled or unreadable (the caller says why). Absent where a client's file cannot be
   * filled in (the web app).
   */
  onPickClientFile?: (draft: RegisterTemplate) => Promise<{ id: string; name: string; problems: string[] } | null>;
  onClose: () => void;
}

const THREADS = [1, 2, 3, 4];
const fieldOf = (key: string): RegisterField => {
  const reply = /^reply:(\d+)$/.exec(key);
  const who = /^responder:(\d+)$/.exec(key);
  return reply ? { kind: 'reply', index: Number(reply[1]) } : who ? { kind: 'responder', index: Number(who[1]) } : { kind: 'column', key };
};

/** Register templates: one per client, edited here and shared as files. */
export function RegisterTemplatesDialog({ templates, initialId, standards, listColumns, statuses, onNew, onSave, onDelete, onImportFile, onExportFile, onPickClientFile, onClose }: TemplatesProps) {
  const first = templates.find((t) => t.id === initialId) ?? templates[0] ?? null;
  const [draft, setDraft] = useState<RegisterTemplate | null>(first ? withStatuses(first, statuses) : null);
  const [dirty, setDirty] = useState(false);
  /** What checking the client's file against the template found, when it was last picked. */
  const [fileCheck, setFileCheck] = useState<string[] | null>(null);
  const open = (t: RegisterTemplate | null, changed = false) => {
    setDraft(t ? withStatuses(t, statuses) : null);
    setDirty(changed);
    setFileCheck(null);
  };
  const edit = (patch: Partial<RegisterTemplate>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };
  const column = (i: number, patch: Partial<RegisterColumn>) => draft && edit({ columns: draft.columns.map((c, n) => (n === i ? { ...c, ...patch } : c)) });
  const move = (i: number, by: number) => {
    if (!draft || i + by < 0 || i + by >= draft.columns.length) return;
    const columns = [...draft.columns];
    [columns[i], columns[i + by]] = [columns[i + by]!, columns[i]!];
    edit({ columns });
  };
  const cell = (i: number, patch: Partial<RegisterCell>) => draft && edit({ cells: draft.cells.map((c, n) => (n === i ? { ...c, ...patch } : c)) });
  const used = new Set(draft?.columns.map((c) => fieldKey(c.field)));
  const repeated = draft ? draft.columns.length !== used.size : false;
  // The legacy sheet-protection password is hashed a byte per character.
  const badPassword = !!draft?.password && !/^[\x20-\x7e]*$/.test(draft.password);
  const cellsBelow = draft ? draft.cells.filter((c) => c.row >= draft.headerRow).length : 0;
  const problem = !draft ? '' : !draft.name.trim() ? 'Give the template a name.' : !draft.columns.length ? 'Add at least one column.' : repeated ? 'Each field can be in one column only.' : badPassword ? 'The password can only use plain letters, digits and punctuation.' : '';
  const fields = [
    ...listColumns.map((c) => ({ key: c.key, label: c.label })),
    ...THREADS.map((n) => ({ key: `reply:${n}`, label: `Reply ${n} (text)` })),
    ...THREADS.map((n) => ({ key: `responder:${n}`, label: `Reply ${n} (who wrote it)` })),
    ...THREADS.map((n) => ({ key: blankKey(n), label: `Nothing: left blank (${n})` })),
  ];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal quantities-dialog register-templates-dialog" role="dialog" aria-label="Register templates" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Register Templates</h3>
        </div>
        <div className="qty-toolbar">
          <select aria-label="Template" value={draft?.id ?? ''} onChange={(e) => open(templates.find((t) => t.id === e.target.value) ?? null)}>
            {draft && !templates.some((t) => t.id === draft.id) && <option value={draft.id}>{draft.name || 'New template'} (not saved)</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {!draft && <option value="">No templates yet</option>}
          </select>
          <button type="button" className="btn small" onClick={() => open(onNew(), true)}>
            New
          </button>
          <button type="button" className="btn small" disabled={!draft} onClick={() => draft && open({ ...draft, id: crypto.randomUUID(), name: `${draft.name} copy` }, true)}>
            Duplicate
          </button>
          <button type="button" className="btn small" onClick={() => void onImportFile().then((t) => t && open(t, true))}>
            Open File…
          </button>
          <button type="button" className="btn small" disabled={!draft || dirty} title={dirty ? 'Save the template first' : 'Save this template as a file to share'} onClick={() => draft && onExportFile(draft)}>
            Save as File…
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!draft || !templates.some((t) => t.id === draft.id)}
            onClick={() => {
              if (!draft || !confirm(`Delete the template “${draft.name}”? Registers already exported with it can still be imported.`)) return;
              onDelete(draft.id);
              open(templates.find((t) => t.id !== draft.id) ?? null);
            }}
          >
            Delete
          </button>
        </div>
        {draft ? (
          <div className="qty-scroll register-editor">
            <div className="register-basics">
              <label className="col-field">
                <span>Name</span>
                <input aria-label="Template name" value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
              </label>
              <label className="col-field">
                <span>Client</span>
                <select aria-label="Client drawing standard" value={draft.standardId ?? ''} onChange={(e) => edit({ standardId: e.target.value || undefined })}>
                  <option value="">Any (no drawing standard)</option>
                  {standards.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-field">
                <span>Sheet name</span>
                <input aria-label="Sheet name" maxLength={31} value={draft.sheet} onChange={(e) => edit({ sheet: e.target.value })} />
              </label>
              <label className="col-field">
                <span>Header row</span>
                <input aria-label="Header row" type="number" min={1} max={1000} value={draft.headerRow + 1} onChange={(e) => edit({ headerRow: Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 1) - 1)) })} />
              </label>
              <label className="col-field">
                <span>First column</span>
                <input
                  aria-label="First column"
                  value={columnName(draft.firstCol)}
                  onChange={(e) => {
                    const at = parseCellRef(`${e.target.value}1`);
                    if (at && at.col < 200) edit({ firstCol: at.col });
                  }}
                />
              </label>
              <label className="col-field">
                <span>Sheet</span>
                <select aria-label="Protection" value={draft.protection} onChange={(e) => edit({ protection: e.target.value === 'open' ? 'open' : 'protected' })}>
                  <option value="protected">Protected (filter only)</option>
                  <option value="open">Open (can be sorted)</option>
                </select>
              </label>
              {draft.protection === 'protected' && (
                <label className="col-field">
                  <span>Password</span>
                  <input aria-label="Protection password" placeholder="redcolumn" maxLength={60} value={draft.password ?? ''} onChange={(e) => edit({ password: e.target.value || undefined })} />
                </label>
              )}
            </div>
            {onPickClientFile && (
              <div className="register-client-file">
                <span className="register-client-label">Client’s file</span>
                <span data-testid="client-file-name">{draft.clientFile ? draft.clientFile.name : 'None: the export makes a new workbook in this layout'}</span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    void onPickClientFile(draft).then((picked) => {
                      if (!picked) return;
                      edit({ clientFile: { id: picked.id, name: picked.name } });
                      setFileCheck(picked.problems);
                    })
                  }
                >
                  Choose…
                </button>
                {draft.clientFile && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      edit({ clientFile: undefined });
                      setFileCheck(null);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            {onPickClientFile && draft.clientFile && (
              <p className="hint-text">
                The export can fill in a copy of this file with Excel, keeping its title block, logos, merged headings and styles. The sheet name, header row, first column and headings below must be the file’s own. Text cells above the table, widths and protection are not used: the file keeps
                its own.
              </p>
            )}
            {fileCheck &&
              (fileCheck.length ? (
                fileCheck.map((p) => (
                  <p key={p} className="warn" data-testid="client-file-check">
                    {p}
                  </p>
                ))
              ) : (
                <p className="hint-text" data-testid="client-file-check">
                  The file’s headings match this template.
                </p>
              ))}
            {draft.protection === 'protected' && <p className="hint-text">Protection stops a column being deleted or overtyped by accident. It is not security: the password is written on the workbook’s Read me sheet so anyone who needs to sort or restructure the sheet can.</p>}

            <h4>Columns</h4>
            <p className="hint-text">The table’s header row is row {draft.headerRow + 1}, starting at column {columnName(draft.firstCol)}. Status, Comment, the document’s own columns and the reply columns can be filled in; the rest are locked.</p>
            <table className="qty-table register-columns">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Heading</th>
                  <th>Holds</th>
                  <th>Width</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.columns.map((c, i) => {
                  const key = fieldKey(c.field);
                  return (
                    <tr key={i}>
                      <td>{columnName(draft.firstCol + i)}</td>
                      <td>
                        <input aria-label={`Heading ${i + 1}`} value={c.header} onChange={(e) => column(i, { header: e.target.value })} />
                      </td>
                      <td>
                        <select aria-label={`Field ${i + 1}`} value={key} onChange={(e) => column(i, { field: fieldOf(e.target.value) })}>
                          {!fields.some((f) => f.key === key) && <option value={key}>{key} (not in this document)</option>}
                          {fields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input aria-label={`Width ${i + 1}`} type="number" min={1} max={255} placeholder="auto" value={c.width ?? ''} onChange={(e) => column(i, { width: e.target.value ? Math.max(1, Math.min(255, Math.round(Number(e.target.value)))) : undefined })} />
                      </td>
                      <td className="register-row-actions">
                        <button type="button" className="btn small" aria-label={`Move column ${i + 1} left`} disabled={i === 0} onClick={() => move(i, -1)}>
                          ↑
                        </button>
                        <button type="button" className="btn small" aria-label={`Move column ${i + 1} right`} disabled={i === draft.columns.length - 1} onClick={() => move(i, 1)}>
                          ↓
                        </button>
                        <button type="button" className="btn small" aria-label={`Remove column ${i + 1}`} onClick={() => edit({ columns: draft.columns.filter((_, n) => n !== i) })}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const free = fields.find((f) => !used.has(f.key));
                if (free) edit({ columns: [...draft.columns, { header: free.label, field: fieldOf(free.key) }] });
              }}
            >
              Add Column
            </button>

            <h4>Status wording</h4>
            <p className="hint-text">The client’s word for each status, which ones count as closed out, and any other words that mean the same when they are typed in the register (separate them with commas).</p>
            <table className="qty-table register-statuses">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Register says</th>
                  <th>Closed</th>
                  <th>Also read as</th>
                </tr>
              </thead>
              <tbody>
                {draft.statuses.map((s, i) => {
                  const def = statuses.find((x) => x.id === s.id);
                  const status = (patch: Partial<typeof s>) => edit({ statuses: draft.statuses.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
                  const name = s.id === 'none' ? 'No status' : (def?.name ?? `${s.id} (not in this document)`);
                  return (
                    <tr key={s.id}>
                      <td>{name}</td>
                      <td>
                        <input aria-label={`Word for ${name}`} value={s.word} onChange={(e) => status({ word: e.target.value })} />
                      </td>
                      <td>
                        <input type="checkbox" aria-label={`${name} is closed`} checked={s.closed} onChange={(e) => status({ closed: e.target.checked })} />
                      </td>
                      <td>
                        <input aria-label={`Other words for ${name}`} value={s.also.join(', ')} onChange={(e) => status({ also: e.target.value.split(',').map((a) => a.trimStart()) })} onBlur={() => status({ also: s.also.map((a) => a.trim()).filter(Boolean) })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h4>Above the table</h4>
            <p className="hint-text">Cells in the rows above the header: fixed text such as a title, or a detail filled in at each export. They are ignored on import.</p>
            <table className="qty-table register-cells">
              <thead>
                <tr>
                  <th>Cell</th>
                  <th>Shows</th>
                  <th>Text</th>
                  <th>Bold</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.cells.map((c, i) => (
                  <tr key={i} className={c.row >= draft.headerRow ? 'conflict' : undefined}>
                    <td>
                      <input
                        aria-label={`Cell ${i + 1}`}
                        defaultValue={cellRef(c.row, c.col)}
                        key={cellRef(c.row, c.col)}
                        onBlur={(e) => {
                          const at = parseCellRef(e.target.value);
                          if (at) cell(i, at);
                          else e.target.value = cellRef(c.row, c.col);
                        }}
                      />
                    </td>
                    <td>
                      <select aria-label={`Cell ${i + 1} shows`} value={c.value ?? ''} onChange={(e) => cell(i, e.target.value ? { value: e.target.value as RegisterValue, text: undefined } : { value: undefined, text: c.text ?? '' })}>
                        <option value="">Text</option>
                        {REGISTER_VALUES.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{!c.value && <input aria-label={`Cell ${i + 1} text`} value={c.text ?? ''} onChange={(e) => cell(i, { text: e.target.value })} />}</td>
                    <td>
                      <input type="checkbox" aria-label={`Cell ${i + 1} bold`} checked={!!c.bold} onChange={(e) => cell(i, { bold: e.target.checked || undefined })} />
                    </td>
                    <td>
                      <button type="button" className="btn small" aria-label={`Remove cell ${i + 1}`} onClick={() => edit({ cells: draft.cells.filter((_, n) => n !== i) })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cellsBelow > 0 && <p className="warn">{cellsBelow === 1 ? 'One cell is' : `${cellsBelow} cells are`} on or below the header row and will be left out: move the header row down, or the cell up.</p>}
            <button type="button" className="btn small" onClick={() => edit({ cells: [...draft.cells, { row: Math.max(0, Math.min(draft.headerRow - 1, draft.cells.length)), col: draft.firstCol, text: '' }] })} disabled={draft.headerRow === 0}>
              Add Cell
            </button>
          </div>
        ) : (
          <p className="empty">No templates yet. Click New to start from the usual register columns, or Open File… to use one a colleague saved.</p>
        )}
        <div className="actions">
          {problem && <span className="form-error">{problem}</span>}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!draft || !dirty || !!problem}
            onClick={() => {
              if (!draft) return;
              const saved = { ...draft, name: draft.name.trim(), sheet: draft.sheet.trim() || 'Register', updatedAt: Date.now() };
              onSave(saved);
              open(saved);
            }}
          >
            Save Template
          </button>
        </div>
      </div>
    </div>
  );
}
