import { useEffect, useMemo, useRef, useState } from 'react';
import { desktop } from '../desktop/host';
import { REVU_KIND_LABEL, REVU_KINDS, revuItems, splitPickedFolder, type RevuKind } from '../migrate/revuFolder';
import { runRevuMigration, type KindResult, type RevuSource } from '../migrate/revuMigration';
import { useProfiles } from '../workspace/profiles';

/** Where Revu keeps its settings, as a person would type it into File Explorer. */
const REVU_FOLDER = '%APPDATA%\\Bluebeam Software\\Revu\\21';

interface Version {
  version: string;
  items: RevuSource[];
}

type Stage = { at: 'finding' } | { at: 'choose' } | { at: 'importing'; kind: RevuKind; done: number; total: number } | { at: 'done'; results: KindResult[] };

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * File › Migrate from Revu: finds Revu's settings folder (the desktop app looks in the usual place;
 * a browser asks for the folder), lists the tool sets, stamps, line styles, hatches, profiles,
 * bookmark templates, categories and keyboard shortcuts in it, and imports the ticked ones into the
 * active profile in one go.
 */
export function RevuMigrationDialog({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const host = desktop();
  const scanner = host?.revuSettings;
  const [versions, setVersions] = useState<Version[]>([]);
  const [version, setVersion] = useState('');
  const [stage, setStage] = useState<Stage>(scanner ? { at: 'finding' } : { at: 'choose' });
  const [off, setOff] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<RevuKind>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const profile = useProfiles();
  const profileName = profile.profiles.find((p) => p.id === profile.activeId)?.name ?? 'the active profile';

  useEffect(() => {
    if (!scanner) return;
    let live = true;
    scanner
      .scan()
      .then((found) => {
        if (!live) return;
        const list = found.map((v) => ({
          version: v.version,
          items: revuItems(v.files).map((i) => ({ ...i, entry: { path: i.entry.path, size: i.entry.size, read: () => scanner.read(i.entry.id) } })),
        }));
        setVersions(list.filter((v) => v.items.length));
        setVersion(list.find((v) => v.items.length)?.version ?? '');
        setStage({ at: 'choose' });
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setStage({ at: 'choose' });
      });
    return () => {
      live = false;
    };
  }, [scanner]);

  const current = versions.find((v) => v.version === version) ?? versions[0];
  const items = useMemo(() => current?.items ?? [], [current]);
  const chosen = items.filter((i) => !off.has(i.entry.path));
  const byKind = REVU_KINDS.map((kind) => ({ kind, list: items.filter((i) => i.kind === kind) })).filter((g) => g.list.length);

  const toggle = (paths: string[], on: boolean) =>
    setOff((s) => {
      const next = new Set(s);
      for (const p of paths) {
        if (on) next.delete(p);
        else next.add(p);
      }
      return next;
    });

  const picked = (files: FileList | null) => {
    if (!files?.length) return;
    const rows = [...files].map((file) => ({ relativePath: file.webkitRelativePath || file.name, size: file.size, file }));
    const found = splitPickedFolder(rows)
      .map((v) => ({ version: v.version, items: revuItems(v.entries).map((i) => ({ ...i, entry: { path: i.entry.path, size: i.entry.size, read: async () => new Uint8Array(await i.entry.file.arrayBuffer()) } })) }))
      .filter((v) => v.items.length);
    setVersions(found);
    setVersion(found[0]?.version ?? '');
    setOff(new Set());
    setError(found.length ? null : 'No Revu tool sets, stamps or other libraries in that folder. Choose the folder named 21 (or 20, 2019…) under Bluebeam Software\\Revu.');
  };

  const start = async () => {
    setStage({ at: 'importing', kind: chosen[0]!.kind, done: 0, total: chosen.length });
    const results = await runRevuMigration(chosen, (kind, done, total) => setStage({ at: 'importing', kind, done, total }));
    setStage({ at: 'done', results });
  };

  const busy = stage.at === 'importing' || stage.at === 'finding';

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div
        className="modal revu-migration"
        role="dialog"
        aria-label="Migrate from Revu"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) onClose();
        }}
      >
        <h3>Migrate from Revu</h3>
        {stage.at === 'finding' && <p className="pref-hint">Looking for Revu's settings on this computer…</p>}

        {stage.at === 'choose' && (
          <>
            {scanner && !versions.length && !error && (
              <p>No Revu settings were found in {REVU_FOLDER.replace('\\21', '')} on this computer. If they are somewhere else (a copy from another computer, say), choose the folder.</p>
            )}
            {!scanner && !versions.length && (
              <p>
                Choose Revu's settings folder: in File Explorer, go to <code>{REVU_FOLDER}</code> (or 20, 2019… for older versions). The browser reads only the library files in it, and nothing leaves this computer.
              </p>
            )}
            {error && <p className="pref-hint note">{error}</p>}
            {versions.length > 0 && current && (
              <>
                <p className="pref-hint">
                  Ticked items are added to the profile <strong>{profileName}</strong>. Importing a tool set or profile twice adds it twice; stamps, hatch sets, bookmark templates and categories of the same name are replaced.
                </p>
                {versions.length > 1 && (
                  <label className="revu-version">
                    Revu version{' '}
                    <select value={current.version} onChange={(e) => setVersion(e.target.value)}>
                      {versions.map((v) => (
                        <option key={v.version} value={v.version}>
                          {/^\d+$/.test(v.version) ? `Revu ${v.version}` : v.version} ({v.items.length} items)
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="revu-groups" role="list">
                  {byKind.map(({ kind, list }) => {
                    const on = list.filter((i) => !off.has(i.entry.path)).length;
                    const expanded = open.has(kind);
                    return (
                      <div key={kind} className="revu-group" role="listitem">
                        <div className="revu-group-head">
                          <label>
                            <input
                              type="checkbox"
                              checked={on === list.length}
                              ref={(el) => {
                                if (el) el.indeterminate = on > 0 && on < list.length;
                              }}
                              onChange={(e) => toggle(list.map((i) => i.entry.path), e.target.checked)}
                            />{' '}
                            {REVU_KIND_LABEL[kind]}
                          </label>
                          <span className="count">
                            {on} of {list.length}
                          </span>
                          {list.length > 1 || kind !== 'shortcuts' ? (
                            <button
                              className="btn small"
                              aria-expanded={expanded}
                              onClick={() =>
                                setOpen((s) => {
                                  const next = new Set(s);
                                  if (expanded) next.delete(kind);
                                  else next.add(kind);
                                  return next;
                                })
                              }
                            >
                              {expanded ? 'Hide' : 'Show'}
                            </button>
                          ) : null}
                        </div>
                        {kind === 'shortcuts' && <p className="pref-hint">Replaces this profile's shortcuts with the ones in Revu, where redcolumn has the command.</p>}
                        {expanded && (
                          <ul className="revu-files">
                            {list.map((i) => (
                              <li key={i.entry.path}>
                                <label title={i.entry.path}>
                                  <input type="checkbox" checked={!off.has(i.entry.path)} onChange={(e) => toggle([i.entry.path], e.target.checked)} /> {i.name}
                                </label>
                                <span className="size">{kb(i.entry.size)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {stage.at === 'importing' && (
          <>
            <p>
              Importing {REVU_KIND_LABEL[stage.kind].toLowerCase()}… ({stage.done} of {stage.total})
            </p>
            <progress max={stage.total} value={stage.done} />
          </>
        )}

        {stage.at === 'done' && (
          <div className="revu-results">
            {stage.results.map((r) => (
              <section key={r.kind}>
                <h4>{REVU_KIND_LABEL[r.kind]}</h4>
                {r.notes.map((n, i) => (
                  <p key={`n${i}`}>{n}</p>
                ))}
                {r.failed.map((n, i) => (
                  <p key={`f${i}`} className="failed">
                    {n}
                  </p>
                ))}
                {!r.notes.length && !r.failed.length && <p>Nothing imported.</p>}
              </section>
            ))}
            <p className="pref-hint">Some Revu settings have no equivalent yet and are not imported: see the help page for the list.</p>
          </div>
        )}

        <input
          ref={pickRef}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            picked(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="actions">
          <button className="btn" onClick={onHelp}>
            Help
          </button>
          {stage.at === 'choose' && (
            <button
              className="btn"
              onClick={() => {
                pickRef.current?.setAttribute('webkitdirectory', '');
                pickRef.current?.click();
              }}
            >
              {versions.length ? 'Choose Another Folder…' : 'Choose Folder…'}
            </button>
          )}
          <span className="spacer" />
          {stage.at === 'done' ? (
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className="btn" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={stage.at !== 'choose' || !chosen.length} onClick={() => void start()}>
                {chosen.length ? `Import ${chosen.length} Item${chosen.length === 1 ? '' : 's'}` : 'Import'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
