import { msg } from '@nb/i18n';
import { useRef, useState } from 'react';
import { writeBpx, type ColumnSet } from '@nb/markup';
import { bpxFromLayout } from '../columns/bpxLayout';
import { listColumns, resolveLayout } from '../columns/listColumns';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import { availableBackends, backendLabel, backUpProfiles, hasBackup, restoreProfiles, stopBackingUp, useProfileBackup } from '../workspace/profileBackup';
import { profiles, updateWorkspace, useProfiles, type WorkspaceState } from '../workspace/profiles';
import { InlineName } from './InlineName';
import { LEFT_TABS, leftTitles, type LeftTab } from './MenuBar';
import { MARKUP_TOOLS, MEASURE_TOOLS } from './ToolBar';
import { importBpxProfile } from '../workspace/revuProfile';

type Tab = 'toolbar' | 'panels' | 'toolchest' | 'list' | 'columns';

const TABS: { id: Tab; label: string }[] = [
  { id: 'toolbar', get label() { return msg('Toolbar'); } },
  { id: 'panels', get label() { return msg('Panels'); } },
  { id: 'toolchest', get label() { return msg('Tool Library'); } },
  { id: 'list', get label() { return msg('Markup List'); } },
  { id: 'columns', get label() { return msg('Columns & Statuses'); } },
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

/** Profiles are kept in this browser; this copies them to OneDrive and brings them back. */
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
        {msg('Profiles are saved in this browser only. Clearing the browser’s site data removes them{value}', { value: backends.length ? msg(', so keep a copy in the cloud or export them.') : msg('; export them to keep a copy.') })}
      </p>
      {link && (
        <p className="hint-text">
          {msg('Backed up to {backendLabel} {date}. Changes are copied automatically.{value2}', { backendLabel: backendLabel(link.backend), date: new Date(link.at).toLocaleString(), value2: failed && ' ' + msg('The last copy failed: {failed}', { failed }) })}
        </p>
      )}
      {backends.map((b) => (
        <div className="profiles-actions" key={b}>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!link && (await hasBackup(b)) && !confirm(msg('{backendLabel} already holds a profile backup. Backing up now replaces it with the profiles in this browser. Restore from it first if you want its profiles.\n\nReplace it?', { backendLabel: backendLabel(b) }))) return 'Backup cancelled.';
                await backUpProfiles(b);
                return msg('Backed up to {backendLabel}.', { backendLabel: backendLabel(b) });
              })
            }
          >
            {msg('Back up to {backendLabel}', { backendLabel: backendLabel(b) })}
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const n = await restoreProfiles(b);
                return n ? msg('Restored {n, plural, one {# profile} other {# profiles}} from {backendLabel}.', { n, backendLabel: backendLabel(b) }) : msg('{backendLabel} has no profile backup yet.', { backendLabel: backendLabel(b) });
              })
            }
          >
            {msg('Restore')}
          </button>
        </div>
      ))}
      {link && (
        <button className="btn small flat" onClick={stopBackingUp}>
          {msg('Stop backing up')}
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
      <div className="modal profiles-dialog" role="dialog" aria-label={msg('Manage profiles')} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{msg('Profiles')}</h3>
        <p>{msg('A profile remembers how the workspace is set up. Changes are saved to the active profile as you make them.')}</p>
        <div className="profiles-body">
          <div className="profiles-list">
            <ul>
              {list.map((p) => (
                <li key={p.id}>
                  {renaming === p.id ? (
                    <InlineName
                      initial={p.name}
                      placeholder={msg('Profile name')}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name) profiles.rename(p.id, name);
                      }}
                    />
                  ) : (
                    <button className={`profile-row${p.id === activeId ? ' active' : ''}`} onClick={() => profiles.switchTo(p.id)} onDoubleClick={() => setRenaming(p.id)}>
                      <span className="radio-dot" aria-hidden="true" />
                      <span className="name">{p.name}</span>
                      {p.id === activeId && <span className="tag">{msg('Active')}</span>}
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
                title={msg('A new profile with the standard set-up')}
              >
                {msg('New')}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const p = profiles.create(`${active.name} copy`, 'current');
                  setRenaming(p.id);
                }}
                title={msg('A new profile copying the active one')}
              >
                {msg('Duplicate')}
              </button>
              <button className="btn small" onClick={() => setRenaming(activeId)}>
                {msg('Rename')}
              </button>
              <button
                className="btn small danger"
                disabled={list.length < 2}
                onClick={() => {
                  if (confirm(msg('Delete the profile "{name}"?', { name: active.name }))) profiles.remove(activeId);
                }}
              >
                {msg('Delete')}
              </button>
              <button className="btn small" onClick={() => importRef.current?.click()}>
                {msg('Import…')}
              </button>
              <button className="btn small" onClick={() => onDownload(`${active.name}.nbprofile.json`, profiles.exportJson(activeId))}>
                {msg('Export')}
              </button>
              <button
                className="btn small"
                title={msg('The markup list\'s columns as a Revu profile (.bpx). Export tool sets for Revu from the Tool Library.')}
                onClick={() => {
                  const { profile, skipped } = bpxFromLayout(active.name, layout, documentColumns?.columns ?? ws.columnTemplate?.columns ?? []);
                  onDownload(`${active.name}.bpx`, writeBpx(profile));
                  setMessage(msg('Exported {name}.bpx ({count} markup list columns).{value}', { name: active.name, count: profile.columns.filter((c) => c.visible).length, value: skipped.length ? ' ' + msg('Revu has no column for {skipped}.', { skipped: skipped.join(', ') }) : '' }));
                }}
              >
                {msg('Export for Revu')}
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
                    <span>{msg('Show the Tools toolbar')}</span>
                  </label>
                  <p className="hint-text">{msg('Tools shown on the toolbar:')}</p>
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
                  <p className="hint-text">{msg('Side panels available on the panel bar and Window menu:')}</p>
                  <div className="check-grid">
                    {LEFT_TABS.filter((id) => id !== 'markups').map((id) => (
                      <label key={id} className="check-tile">
                        <input
                          type="checkbox"
                          checked={!ws.hiddenPanels.includes(id)}
                          disabled={id === 'files'}
                          onChange={(e) => edit((s) => ({ ...s, hiddenPanels: e.target.checked ? s.hiddenPanels.filter((x) => x !== id) : [...s.hiddenPanels, id] }))}
                        />
                        {leftTitles()[id]}
                        <button
                          type="button"
                          className="btn small flat dock-side"
                          title={msg('The side of the window this panel is docked on (or drag its rail button or title across)')}
                          onClick={(e) => {
                            e.preventDefault();
                            edit((s) => ({ ...s, rightPanels: s.rightPanels.includes(id) ? s.rightPanels.filter((x) => x !== id) : [...s.rightPanels, id] }));
                          }}
                        >
                          {ws.rightPanels.includes(id) ? msg('Right') : msg('Left')}
                        </button>
                      </label>
                    ))}
                  </div>
                </>
              )}
              {tab === 'toolchest' && (
                <>
                  <p className="hint-text">{msg('Tool sets shown in the Tool Library:')}</p>
                  <ul className="plain-list">
                    {ws.toolChests.map((t) => (
                      <li key={t.id}>
                        <label>
                          <input type="checkbox" checked={!t.hidden} onChange={(e) => edit((s) => ({ ...s, toolChests: s.toolChests.map((x) => (x.id === t.id ? { ...x, hidden: !e.target.checked } : x)) }))} />
                          {t.name} <span className="hint-text">{msg('({count} tools)', { count: t.items.length })}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tab === 'list' && (
                <>
                  <p className="hint-text">{msg('Columns shown in the Markups list{value}:', { value: documentColumns ? '' : ' ' + msg('(open a document to include its custom columns)') })}</p>
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
                  <p className="hint-text">{msg('Saved filters:')}</p>
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
                        <button className="btn flat" title={msg('Delete')} onClick={() => edit((s) => ({ ...s, list: { ...s.list, savedFilters: s.list.savedFilters.filter((x) => x.id !== f.id) } }))}>
                          ×
                        </button>
                      </li>
                    ))}
                    {!ws.list.savedFilters.length && <li className="hint-text">{msg('None yet — filter the Markups list and choose Save filter.')}</li>}
                  </ul>
                </>
              )}
              {tab === 'columns' && (
                <>
                  <p className="hint-text">{msg('Documents without their own custom columns start with the profile\'s columns and statuses.')}</p>
                  {ws.columnTemplate ? (
                    <div className="template-summary">
                      <b>{msg('{count} column(s):', { count: ws.columnTemplate.columns.length })}</b> {ws.columnTemplate.columns.map((c) => c.name).join(', ') || '—'}
                      <br />
                      <b>{msg('{count} status(es):', { count: ws.columnTemplate.statuses.length - 1 })}</b>{' '}
                      {ws.columnTemplate.statuses
                        .filter((s) => s.id !== 'none')
                        .map((s) => s.name)
                        .join(', ')}
                    </div>
                  ) : (
                    <p className="empty">{msg('This profile has no default columns.')}</p>
                  )}
                  <div className="row wrap">
                    <button
                      className="btn small"
                      disabled={!documentColumns}
                      onClick={() => {
                        edit((s) => ({ ...s, columnTemplate: structuredClone(documentColumns!) }));
                        setMessage(msg('Saved the open document’s columns and statuses to this profile.'));
                      }}
                    >
                      {msg('Use open document’s columns')}
                    </button>
                    <button
                      className="btn small"
                      disabled={!ws.columnTemplate || !canApplyToDocument}
                      onClick={() => {
                        onApplyToDocument(ws.columnTemplate!);
                        setMessage(msg('Applied to the open document.'));
                      }}
                    >
                      {msg('Apply to open document')}
                    </button>
                    <button className="btn small danger" disabled={!ws.columnTemplate} onClick={() => edit((s) => ({ ...s, columnTemplate: null }))}>
                      {msg('Clear')}
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
            {msg('Done')}
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json,.bpx,application/json,text/xml,application/xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              if (/\.bpx$/i.test(f.name)) {
                const r = importBpxProfile(await f.text(), f.name, true);
                setMessage(msg('Imported "{name}" from Bluebeam Revu and made it active: {columns} markup list columns shown.{value}', { name: r.profile.name, columns: r.columns, value: r.skipped.length ? ' ' + msg('No equivalent yet for {skipped}.', { skipped: r.skipped.join(', ') }) : '' }));
                return;
              }
              const p = profiles.importJson(await f.text());
              setMessage(msg('Imported "{name}" and made it active.', { name: p.name }));
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    </div>
  );
}
