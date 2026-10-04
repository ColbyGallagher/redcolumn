import { useRef, useState } from 'react';
import type { ColumnSet } from '@nb/markup';
import { listColumns, resolveLayout } from '../columns/listColumns';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import { availableBackends, backendLabel, backUpProfiles, hasBackup, restoreProfiles, stopBackingUp, useProfileBackup } from '../workspace/profileBackup';
import { profiles, updateWorkspace, useProfiles, type WorkspaceState } from '../workspace/profiles';
import { InlineName } from './InlineName';
import { LEFT_TITLES, type LeftTab } from './MenuBar';
import { MARKUP_TOOLS, MEASURE_TOOLS } from './ToolBar';

type Tab = 'toolbar' | 'panels' | 'toolchest' | 'list' | 'columns';

const TABS: { id: Tab; label: string }[] = [
  { id: 'toolbar', label: 'Toolbar' },
  { id: 'panels', label: 'Panels' },
  { id: 'toolchest', label: 'Tool Library' },
  { id: 'list', label: 'Markup List' },
  { id: 'columns', label: 'Columns & Statuses' },
];

const ALL_TOOLS = [...MARKUP_TOOLS, ...MEASURE_TOOLS];

interface Props {
  /** The open document's columns and statuses (null without a document). */
  documentColumns: ColumnSet | null;
  canApplyToDocument: boolean;
  onApplyToDocument: (set: ColumnSet) => void;
  onDownload: (name: string, text: string) => void;
  onClose: () => void;
}

/** Profiles are kept in this browser; this copies them to Google Drive or OneDrive and brings them back. */
function CloudBackup({ onMessage }: { onMessage: (m: string) => void }) {
  const { link, failed } = useProfileBackup();
  const [busy, setBusy] = useState(false);
  const backends = availableBackends();
  const run = (job: () => Promise<string>) => {
    setBusy(true);
    job()
      .then(onMessage)
      .catch((err) => onMessage(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="profiles-backup">
      <p className="hint-text">
        Profiles are saved in this browser only. Clearing the browser’s site data removes them
        {backends.length ? ', so keep a copy in the cloud or export them.' : '; export them to keep a copy.'}
      </p>
      {link && (
        <p className="hint-text">
          Backed up to {backendLabel(link.backend)} {new Date(link.at).toLocaleString()}. Changes are copied automatically.
          {failed && ` The last copy failed: ${failed}`}
        </p>
      )}
      {backends.map((b) => (
        <div className="profiles-actions" key={b}>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!link && (await hasBackup(b)) && !confirm(`${backendLabel(b)} already holds a profile backup. Backing up now replaces it with the profiles in this browser. Restore from it first if you want its profiles.\n\nReplace it?`)) return 'Backup cancelled.';
                await backUpProfiles(b);
                return `Backed up to ${backendLabel(b)}.`;
              })
            }
          >
            Back up to {backendLabel(b)}
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const n = await restoreProfiles(b);
                return n ? `Restored ${n} profile${n === 1 ? '' : 's'} from ${backendLabel(b)}.` : `${backendLabel(b)} has no profile backup yet.`;
              })
            }
          >
            Restore
          </button>
        </div>
      ))}
      {link && (
        <button className="btn small flat" onClick={stopBackingUp}>
          Stop backing up
        </button>
      )}
    </div>
  );
}

/**
 * Profiles (File → Profiles → Manage Profiles): switch between named workspace set-ups,
 * and choose what each shows — toolbar tools, side panels, tool sets, markup list columns and
 * filters, and the columns and statuses new documents start with.
 */
export function ProfilesDialog({ documentColumns, canApplyToDocument, onApplyToDocument, onDownload, onClose }: Props) {
  const { profiles: list, activeId } = useProfiles();
  const active = list.find((p) => p.id === activeId)!;
  const ws = active.state;
  const [tab, setTab] = useState<Tab>('toolbar');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const edit = (fn: (s: WorkspaceState) => WorkspaceState) => updateWorkspace(fn);

  const toolbar = ws.toolbarTools ?? ALL_TOOLS.map((t) => t.tool);
  const layout = resolveLayout(ws.list.columns, listColumns(documentColumns?.columns ?? []));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal profiles-dialog" role="dialog" aria-label="Manage profiles" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Profiles</h3>
        <p>A profile remembers how the workspace is set up. Changes are saved to the active profile as you make them.</p>
        <div className="profiles-body">
          <div className="profiles-list">
            <ul>
              {list.map((p) => (
                <li key={p.id}>
                  {renaming === p.id ? (
                    <InlineName
                      initial={p.name}
                      placeholder="Profile name"
                      onDone={(name) => {
                        setRenaming(null);
                        if (name) profiles.rename(p.id, name);
                      }}
                    />
                  ) : (
                    <button className={`profile-row${p.id === activeId ? ' active' : ''}`} onClick={() => profiles.switchTo(p.id)} onDoubleClick={() => setRenaming(p.id)}>
                      <span className="radio-dot" aria-hidden="true" />
                      <span className="name">{p.name}</span>
                      {p.id === activeId && <span className="tag">Active</span>}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="profiles-actions">
              <button
                className="btn small"
                onClick={() => {
                  const p = profiles.create(`Profile ${list.length + 1}`, 'default');
                  setRenaming(p.id);
                }}
                title="A new profile with the standard set-up"
              >
                New
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const p = profiles.create(`${active.name} copy`, 'current');
                  setRenaming(p.id);
                }}
                title="A new profile copying the active one"
              >
                Duplicate
              </button>
              <button className="btn small" onClick={() => setRenaming(activeId)}>
                Rename
              </button>
              <button
                className="btn small danger"
                disabled={list.length < 2}
                onClick={() => {
                  if (confirm(`Delete the profile "${active.name}"?`)) profiles.remove(activeId);
                }}
              >
                Delete
              </button>
              <button className="btn small" onClick={() => importRef.current?.click()}>
                Import…
              </button>
              <button className="btn small" onClick={() => onDownload(`${active.name}.nbprofile.json`, profiles.exportJson(activeId))}>
                Export
              </button>
            </div>
            <CloudBackup onMessage={setMessage} />
          </div>

          <div className="profiles-settings">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="profiles-pane">
              {tab === 'toolbar' && (
                <>
                  <label className="col-toggle">
                    <input type="checkbox" checked={ws.showToolbar} onChange={(e) => edit((s) => ({ ...s, showToolbar: e.target.checked }))} />
                    <span>Show the Tools toolbar</span>
                  </label>
                  <p className="hint-text">Tools shown on the toolbar:</p>
                  <div className="check-grid">
                    {ALL_TOOLS.map(({ tool, icon }) => (
                      <label key={tool} className="check-tile">
                        <input
                          type="checkbox"
                          checked={toolbar.includes(tool)}
                          onChange={(e) =>
                            edit((s) => {
                              const cur = s.toolbarTools ?? ALL_TOOLS.map((t) => t.tool);
                              const next = e.target.checked ? ALL_TOOLS.map((t) => t.tool).filter((t) => cur.includes(t) || t === tool) : cur.filter((t) => t !== tool);
                              return { ...s, toolbarTools: next.length === ALL_TOOLS.length ? null : next };
                            })
                          }
                        />
                        <span className="icon">{icon}</span> {toolLabel(tool)}
                      </label>
                    ))}
                  </div>
                </>
              )}
              {tab === 'panels' && (
                <>
                  <p className="hint-text">Side panels available on the panel bar and Window menu:</p>
                  <div className="check-grid">
                    {(Object.keys(LEFT_TITLES) as LeftTab[]).map((id) => (
                      <label key={id} className="check-tile">
                        <input
                          type="checkbox"
                          checked={!ws.hiddenPanels.includes(id)}
                          disabled={id === 'files'}
                          onChange={(e) => edit((s) => ({ ...s, hiddenPanels: e.target.checked ? s.hiddenPanels.filter((x) => x !== id) : [...s.hiddenPanels, id] }))}
                        />
                        {LEFT_TITLES[id]}
                      </label>
                    ))}
                  </div>
                </>
              )}
              {tab === 'toolchest' && (
                <>
                  <p className="hint-text">Tool sets shown in the Tool Library:</p>
                  <ul className="plain-list">
                    {ws.toolChests.map((t) => (
                      <li key={t.id}>
                        <label>
                          <input type="checkbox" checked={!t.hidden} onChange={(e) => edit((s) => ({ ...s, toolChests: s.toolChests.map((x) => (x.id === t.id ? { ...x, hidden: !e.target.checked } : x)) }))} />
                          {t.name} <span className="hint-text">({t.items.length} tools)</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tab === 'list' && (
                <>
                  <p className="hint-text">Columns shown in the Markups list{documentColumns ? '' : ' (open a document to include its custom columns)'}:</p>
                  <div className="check-grid">
                    {layout.map((c) => (
                      <label key={c.key} className="check-tile">
                        <input
                          type="checkbox"
                          checked={!c.hidden}
                          onChange={(e) =>
                            edit((s) => ({
                              ...s,
                              list: { ...s.list, columns: layout.map((x) => ({ key: x.key, width: x.width, hidden: x.key === c.key ? !e.target.checked : x.hidden })) },
                            }))
                          }
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  <p className="hint-text">Saved filters:</p>
                  <ul className="plain-list">
                    {ws.list.savedFilters.map((f) => (
                      <li key={f.id}>
                        {f.name}{' '}
                        <span className="hint-text">
                          ({Object.entries(f.filters)
                            .map(([k, v]) => `${layout.find((c) => c.key === k)?.label ?? k} ${v}`)
                            .join(', ')}
                          )
                        </span>
                        <button className="btn flat" title="Delete" onClick={() => edit((s) => ({ ...s, list: { ...s.list, savedFilters: s.list.savedFilters.filter((x) => x.id !== f.id) } }))}>
                          ×
                        </button>
                      </li>
                    ))}
                    {!ws.list.savedFilters.length && <li className="hint-text">None yet — filter the Markups list and choose Save filter.</li>}
                  </ul>
                </>
              )}
              {tab === 'columns' && (
                <>
                  <p className="hint-text">Documents without their own custom columns start with the profile's columns and statuses.</p>
                  {ws.columnTemplate ? (
                    <div className="template-summary">
                      <b>{ws.columnTemplate.columns.length} column(s):</b> {ws.columnTemplate.columns.map((c) => c.name).join(', ') || '—'}
                      <br />
                      <b>{ws.columnTemplate.statuses.length - 1} status(es):</b>{' '}
                      {ws.columnTemplate.statuses
                        .filter((s) => s.id !== 'none')
                        .map((s) => s.name)
                        .join(', ')}
                    </div>
                  ) : (
                    <p className="empty">This profile has no default columns.</p>
                  )}
                  <div className="row wrap">
                    <button
                      className="btn small"
                      disabled={!documentColumns}
                      onClick={() => {
                        edit((s) => ({ ...s, columnTemplate: structuredClone(documentColumns!) }));
                        setMessage('Saved the open document’s columns and statuses to this profile.');
                      }}
                    >
                      Use open document’s columns
                    </button>
                    <button
                      className="btn small"
                      disabled={!ws.columnTemplate || !canApplyToDocument}
                      onClick={() => {
                        onApplyToDocument(ws.columnTemplate!);
                        setMessage('Applied to the open document.');
                      }}
                    >
                      Apply to open document
                    </button>
                    <button className="btn small danger" disabled={!ws.columnTemplate} onClick={() => edit((s) => ({ ...s, columnTemplate: null }))}>
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {message && <p className="columns-message">{message}</p>}
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
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
              const p = profiles.importJson(await f.text());
              setMessage(`Imported "${p.name}" and made it active.`);
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    </div>
  );
}
