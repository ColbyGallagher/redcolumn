import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { offlineReason, useOnline } from '../offline/network';
import { copyState, describeQueued, isUnreachable, loadSnapshot, noteText, projectQueue, saveSnapshot } from '../studio/projectQueue';
import { askText } from './AskText';
import {
  atLeast,
  folderPath,
  forgetProject,
  knownProjects,
  LEVEL_LABELS,
  libraryCopyOf,
  linkOf,
  mailtoInvite,
  parseEmails,
  projectsApi,
  type Grant,
  type KnownProject,
  type Level,
  type ProjectFile,
  type ProjectMe,
  type ProjectRecordEntry,
  type ProjectView,
} from '../studio/projects';

interface Props {
  me: string;
  /** The library document in front, if any (for adding it to the Project). */
  current: { id: string; name: string } | null;
  /** Sessions this browser hosts, for Send to Session. */
  sessions: { id: string; name: string }[];
  /** Downloads a revision (the latest if none) into the library and opens it. */
  onOpen: (projectId: string, file: ProjectFile, rev?: number) => Promise<void>;
  /** Checks the library copy (with its markups) in as a new revision. */
  onCheckIn: (projectId: string, file: ProjectFile, comment: string, keep: boolean) => Promise<void>;
  onAddCurrent: (projectId: string, folderId: string | null) => Promise<void>;
  onAddFiles: (projectId: string, folderId: string | null, files: File[]) => Promise<void>;
  /** Checks the file out to a session and adds it there; finishing the session checks it back in. */
  onSendToSession: (projectId: string, file: ProjectFile, sessionId: string) => Promise<void>;
  onNotice: (text: string) => void;
  /** Sends Project changes queued offline now (App does it by itself when back online). */
  onSendQueued: () => void;
  /** A Project to open (from a ?project= link). */
  openId?: string | null;
  /** File › New Team Project asked for a new one; `onCreateHandled` clears it. */
  createRequest?: boolean;
  onCreateHandled?: () => void;
}

const LEVELS: Level[] = ['none', 'read', 'write', 'delete', 'full'];
const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

/**
 * Team Projects: shared folders of PDFs on the redcolumn server. Files are checked out to change
 * them and checked in as new revisions; folders carry permissions; the Record lists everything
 * that happened, and changes by others show as notifications.
 */
export function ProjectsPanel({ me, current, sessions, onOpen, onCheckIn, onAddCurrent, onAddFiles, onSendToSession, onNotice, onSendQueued, openId, createRequest, onCreateHandled }: Props) {
  const api = useRef(projectsApi(me));
  api.current = projectsApi(me);
  const [known, setKnown] = useState<KnownProject[]>(knownProjects);
  const [projectId, setProjectId] = useState<string | null>(openId ?? known[0]?.id ?? null);
  const [view, setView] = useState<{ project: ProjectView; me: ProjectMe } | null>(null);
  const [record, setRecord] = useState<ProjectRecordEntry[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ kind: 'file' | 'folder'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'permissions'; folderId: string | null } | { kind: 'revisions'; fileId: string } | { kind: 'invite' } | { kind: 'record' }>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastSeen = useRef(0);
  // Offline: the Project as last seen (when), and the changes waiting to be sent.
  const online = useOnline();
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const offline = !online || offlineSince !== null;
  const queue = projectQueue();
  const queued = useSyncExternalStore(queue.subscribe, queue.all);
  const sending = useSyncExternalStore(queue.subscribe, () => queue.busy);
  const needsNetwork = (what: string) => (offline ? offlineReason(what) : undefined);

  const run = useCallback(async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Reloads the Project and its Record; new lines by others become notifications. */
  const refresh = useCallback(
    async (quiet = false) => {
      if (!projectId) return;
      let v: Awaited<ReturnType<typeof api.current.get>>;
      let r: Awaited<ReturnType<typeof api.current.record>>;
      try {
        [v, r] = await Promise.all([api.current.get(projectId), api.current.record(projectId)]);
      } catch (err) {
        // No server: show the Project as it was last seen, if this device has seen it.
        const snap = isUnreachable(err) ? loadSnapshot<{ project: ProjectView; me: ProjectMe }, ProjectRecordEntry>(localStorage, projectId) : null;
        if (!snap) throw err;
        setView((old) => (old?.project.id === projectId ? old : snap.view));
        setRecord((old) => (old.length ? old : snap.record));
        setOfflineSince(snap.savedAt);
        return;
      }
      setOfflineSince(null);
      saveSnapshot(localStorage, projectId, v, r.entries);
      setView(v);
      setRecord(r.entries);
      setKnown(knownProjects());
      const latest = r.entries.at(-1)?.at ?? 0;
      if (quiet && lastSeen.current) {
        const fresh = r.entries.filter((e) => e.at > lastSeen.current && e.who !== me);
        if (fresh.length) onNotice(`${v.project.name}: ${fresh.map((e) => `${e.who} ${e.text}`).join('; ')}`);
      }
      lastSeen.current = Math.max(lastSeen.current, latest);
    },
    [projectId, me, onNotice],
  );

  useEffect(() => {
    lastSeen.current = 0;
    setView(null);
    setRecord([]);
    if (projectId) void run(() => refresh());
    const timer = projectId ? setInterval(() => void refresh(true).catch(() => {}), 15_000) : null;
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [projectId, refresh, run]);

  useEffect(() => {
    if (openId) setProjectId(openId);
  }, [openId]);

  // Back online, or queued changes sent: show the server's view again.
  const queuedHere = queued.filter((c) => c.projectId === projectId).length;
  useEffect(() => {
    if (online && projectId && !sending) void refresh(true).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, sending, queuedHere]);

  /** Checks in now, or queues the check-in when the server cannot be reached. */
  const checkIn = async (file: ProjectFile, comment: string) => {
    const queueIt = () => {
      const copy = libraryCopyOf(p!.id, file.id)!;
      queue.add({ kind: 'checkin', projectId: p!.id, fileId: file.id, fileName: file.name, libraryId: copy, baseRev: linkOf(copy)?.rev ?? 0, comment, keep: false, by: me });
      onNotice(`Offline: the check-in of ${file.name} is queued. Your copy, as it is then, is checked in when the redcolumn server can be reached.`);
    };
    if (offline) return queueIt();
    try {
      await onCheckIn(p!.id, file, comment, false);
      await refresh();
    } catch (err) {
      if (!isUnreachable(err)) throw err;
      setOfflineSince(Date.now());
      queueIt();
    }
  };

  const addNote = async (file: ProjectFile) => {
    const text = await askText(`Note on ${file.name}`, '', { label: 'Note', confirm: offline ? 'Queue' : 'Add' });
    if (!text?.trim()) return;
    const n = { kind: 'note' as const, projectId: p!.id, fileId: file.id, fileName: file.name, text: text.trim(), by: me };
    const queueIt = () => {
      queue.add(n);
      onNotice(`Offline: your note on ${file.name} is queued and is added to the Project Record when the redcolumn server can be reached.`);
    };
    if (offline) return queueIt();
    try {
      await api.current.note(p!.id, file.id, noteText({ ...n, id: '', at: Date.now() }));
      await refresh();
    } catch (err) {
      if (!isUnreachable(err)) throw err;
      setOfflineSince(Date.now());
      queueIt();
    }
  };

  const apply = (v: { project: ProjectView; me: ProjectMe }) => setView({ project: v.project, me: v.me });
  const act = (job: () => Promise<{ project: ProjectView; me: ProjectMe } | void>) =>
    run(async () => {
      const v = await job();
      if (v) apply(v);
      else await refresh();
      const r = await api.current.record(projectId!);
      setRecord(r.entries);
      lastSeen.current = Math.max(lastSeen.current, r.entries.at(-1)?.at ?? 0);
    });

  const p = view?.project ?? null;
  const level = (folderId: string | null) => p?.levels[folderId ?? ''] ?? 'none';
  const selFile = selected?.kind === 'file' ? (p?.files.find((f) => f.id === selected.id) ?? null) : null;
  const selFolderId = selected?.kind === 'folder' ? selected.id : selFile ? selFile.folderId : null;
  const mine = (f: ProjectFile) => !!f.checkout && !!view && f.checkout.key === view.me.key;

  const tree = (parentId: string | null, depth: number): React.ReactNode[] => {
    if (!p) return [];
    const folders = p.folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
    const files = p.files.filter((f) => f.folderId === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return [
      ...folders.flatMap((f) => [
        <li key={f.id} className={`project-row folder${selected?.id === f.id ? ' selected' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}>
          <button
            className="project-name"
            onClick={() => {
              setSelected({ kind: 'folder', id: f.id });
              setOpen((o) => {
                const n = new Set(o);
                if (n.has(f.id)) n.delete(f.id);
                else n.add(f.id);
                return n;
              });
            }}
          >
            <span className="caret">{open.has(f.id) ? '▾' : '▸'}</span> {f.name}
            {f.permissions && <span className="badge" title="This folder has its own permissions">🔒</span>}
          </button>
        </li>,
        ...(open.has(f.id) ? tree(f.id, depth + 1) : []),
      ]),
      ...files.map((f) => {
        const rev = f.revisions.at(-1);
        const local = libraryCopyOf(p.id, f.id);
        const copy = copyState(local ? linkOf(local) : null, rev?.n ?? 0);
        const pending = queue.pendingCheckIn(p.id, f.id);
        return (
          <li key={f.id} className={`project-row file${selected?.id === f.id ? ' selected' : ''}`} style={{ paddingLeft: 20 + depth * 14 }}>
            <button className="project-name" onClick={() => setSelected({ kind: 'file', id: f.id })} onDoubleClick={() => void run(() => onOpen(p.id, f))} title="Double-click to open">
              {f.name}
              <span className="project-meta">
                rev {rev?.n ?? 0}
                {copy.kind === 'current' && <span title="A copy of the latest revision is on this device, so it opens offline"> · on this device</span>}
                {copy.kind === 'stale' && (
                  <span className="stale" title={`Your copy is revision ${copy.rev}; the Project has revision ${copy.latest}. Open it online to bring it up to date.`}>
                    {' '}
                    · your copy: rev {copy.rev} (out of date)
                  </span>
                )}
                {pending && <span title={pending.error ?? 'Sent when the redcolumn server can be reached'}> · {pending.error ? 'check-in refused' : 'check-in queued'}</span>}
              </span>
              {f.checkout && (
                <span className={`badge ${mine(f) ? 'mine' : 'theirs'}`} title={`${f.checkout.note ?? ''} ${when(f.checkout.at)}`.trim()}>
                  {mine(f) ? 'Checked out to you' : `Checked out: ${f.checkout.by}`}
                </span>
              )}
            </button>
          </li>
        );
      }),
    ];
  };

  const newProject = () =>
    run(async () => {
      const name = await askText('New Team Project', '', { label: 'Name', confirm: 'Create' });
      if (!name?.trim()) return;
      const r = await api.current.create(name.trim());
      setKnown(knownProjects());
      setProjectId(r.project.id);
      onNotice(`Created the Project “${r.project.name}”. Its ID is ${r.project.id}: share it (or invite people) to give them access.`);
    });

  useEffect(() => {
    if (!createRequest) return;
    onCreateHandled?.();
    void newProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest]);

  const joinProject = () =>
    run(async () => {
      const id = await askText('Open a Team Project', '', { label: 'Project ID', confirm: 'Open' });
      if (!id?.trim()) return;
      const r = await api.current.get(id.trim());
      setKnown(knownProjects());
      setProjectId(r.project.id);
    });

  return (
    <div className="projects-panel">
      <div className="sheet-actions">
        <select value={projectId ?? ''} aria-label="Project" onChange={(e) => setProjectId(e.target.value || null)} style={{ flex: 1, minWidth: 0 }}>
          {!known.length && <option value="">No Projects yet</option>}
          {known.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name} ({k.id})
            </option>
          ))}
        </select>
        <button className="btn small" disabled={busy || offline} onClick={() => void newProject()} title={needsNetwork('Making a Project') ?? 'Make a new Project on the redcolumn server'}>
          New…
        </button>
        <button className="btn small" disabled={busy || offline} onClick={() => void joinProject()} title={needsNetwork('Opening a Project by its ID') ?? 'Open a Project by its ID'}>
          Open…
        </button>
      </div>
      {error && <p className="print-error">{error}</p>}
      {p && offline && (
        <p className="project-offline" role="status">
          Offline{offlineSince ? `: the Project as of ${when(offlineSince)}` : ''}. Files on this device open; check-ins of files checked out to you and notes are queued and sent when the redcolumn server can be reached.
        </p>
      )}
      {queued.some((c) => c.projectId === projectId) && (
        <div className="project-actions">
          <b>Waiting to be sent</b>
          <ul className="project-queue">
            {queued
              .filter((c) => c.projectId === projectId)
              .map((c) => (
                <li key={c.id} className={c.error ? 'failed' : ''}>
                  <span style={{ flex: 1 }}>
                    {describeQueued(c)} <span className="print-hint">· {when(c.at)}</span>
                    {c.error && <span> · not sent: {c.error}</span>}
                  </span>
                  {c.error && (
                    <button className="btn small flat" onClick={() => queue.retry(c.id)}>
                      Retry
                    </button>
                  )}
                  <button className="btn small flat danger" onClick={() => queue.discard(c.id)} title="Do not send it">
                    Discard
                  </button>
                </li>
              ))}
          </ul>
          <button className="btn small" disabled={offline || sending} onClick={onSendQueued} title={needsNetwork('Sending') ?? 'Send them now'}>
            {sending ? 'Sending…' : 'Send Now'}
          </button>
        </div>
      )}
      {p && view && (
        <>
          <div className="project-head">
            <b>{p.name}</b>
            <span className="print-hint">
              {p.id} · owner {p.owner}
              {view.me.isOwner ? ' (you)' : ` · you: ${LEVEL_LABELS[level(null)]}`}
            </span>
          </div>
          <div className="sheet-actions">
            <button className="btn small" disabled={busy || offline || !atLeast(level(selFolderId), 'write')} onClick={() => fileInput.current?.click()} title={needsNetwork('Adding files') ?? 'Add PDFs from this computer to the selected folder'}>
              Add Files…
            </button>
            <button className="btn small" disabled={busy || offline || !current || !atLeast(level(selFolderId), 'write')} onClick={() => current && void run(() => onAddCurrent(p.id, selFolderId).then(() => refresh()))} title={needsNetwork('Adding files') ?? (current ? `Add ${current.name} to the selected folder` : 'Open a document first')}>
              Add Current
            </button>
            <button
              className="btn small"
              disabled={busy || offline || !atLeast(level(selFolderId), 'write')}
              title={needsNetwork('Making folders')}
              onClick={() =>
                void act(async () => {
                  const name = await askText('New Folder', '', { label: 'Name', confirm: 'Create' });
                  if (!name?.trim()) return;
                  const r = await api.current.newFolder(p.id, name.trim(), selFolderId);
                  if (selFolderId) setOpen((o) => new Set(o).add(selFolderId));
                  return r;
                })
              }
            >
              New Folder…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length) void run(() => onAddFiles(p.id, selFolderId, files).then(() => refresh()));
              }}
            />
          </div>
          <ul className="project-tree">
            <li className={`project-row folder${selected === null ? ' selected' : ''}`}>
              <button className="project-name" onClick={() => setSelected(null)}>
                {p.name} <span className="project-meta">top</span>
              </button>
            </li>
            {tree(null, 1)}
            {!p.files.length && !p.folders.length && <li className="empty">No files yet. Add PDFs from this computer or the document in front.</li>}
          </ul>
          {selFile && (
            <div className="project-actions">
              <b>{selFile.name}</b>
              <div className="sheet-actions">
                <button
                  className="btn small primary"
                  disabled={busy || (offline && !libraryCopyOf(p.id, selFile.id))}
                  title={offline && !libraryCopyOf(p.id, selFile.id) ? 'This file is not on this device. Open it once online to keep a copy.' : undefined}
                  onClick={() => void run(() => onOpen(p.id, selFile))}
                >
                  Open
                </button>
                {!selFile.checkout && (
                  <button className="btn small" disabled={busy || offline || !atLeast(level(selFile.folderId), 'write')} onClick={() => void act(() => api.current.checkout(p.id, selFile.id))} title={needsNetwork('Checking out') ?? 'Only you can check in changes until you check it in or undo'}>
                    Check Out
                  </button>
                )}
                {mine(selFile) && (
                  <>
                    <button
                      className="btn small primary"
                      disabled={busy || !libraryCopyOf(p.id, selFile.id)}
                      title={libraryCopyOf(p.id, selFile.id) ? (offline ? 'Queue your copy, with its markups, to be checked in when the redcolumn server can be reached' : 'Upload your copy, with its markups, as a new revision') : 'Open it first, then make your changes'}
                      onClick={() =>
                        void run(async () => {
                          const comment = await askText(`Check In ${selFile.name}`, '', { label: 'Comment', confirm: offline ? 'Queue Check In' : 'Check In' });
                          if (comment === null) return;
                          await checkIn(selFile, comment);
                        })
                      }
                    >
                      Check In…
                    </button>
                    <button className="btn small" disabled={busy || offline} title={needsNetwork('Undoing a check-out')} onClick={() => void act(() => api.current.undoCheckout(p.id, selFile.id))}>
                      Undo Check Out
                    </button>
                  </>
                )}
                {selFile.checkout && !mine(selFile) && atLeast(level(selFile.folderId), 'full') && (
                  <button className="btn small" disabled={busy || offline} onClick={() => void act(() => api.current.undoCheckout(p.id, selFile.id))} title={needsNetwork('Releasing a check-out') ?? 'Release the check-out (their changes are not checked in)'}>
                    Release Check Out
                  </button>
                )}
                <button className="btn small" onClick={() => setDialog({ kind: 'revisions', fileId: selFile.id })}>
                  Revisions ({selFile.revisions.length})
                </button>
                <button className="btn small" disabled={busy || !atLeast(level(selFile.folderId), 'write')} onClick={() => void run(() => addNote(selFile))} title={offline ? 'Write a note for the Project Record; it is sent when the redcolumn server can be reached' : 'Add a note about this file to the Project Record'}>
                  Add Note…
                </button>
                {sessions.length > 0 && !offline && !selFile.checkout && atLeast(level(selFile.folderId), 'write') && (
                  <select
                    value=""
                    aria-label="Send to Session"
                    disabled={busy}
                    onChange={(e) => {
                      const sid = e.target.value;
                      if (sid) void run(() => onSendToSession(p.id, selFile, sid).then(() => refresh()));
                    }}
                  >
                    <option value="">Send to Session…</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="sheet-actions">
                <button
                  className="btn small flat"
                  disabled={busy || offline || !atLeast(level(selFile.folderId), 'write')}
                  title={needsNetwork('Renaming')}
                  onClick={() =>
                    void act(async () => {
                      const name = await askText('Rename', selFile.name, { label: 'Name', confirm: 'Rename' });
                      if (name?.trim() && name.trim() !== selFile.name) return api.current.updateFile(p.id, selFile.id, { name: name.trim() });
                    })
                  }
                >
                  Rename…
                </button>
                <select
                  value=""
                  aria-label="Move to folder"
                  disabled={busy || offline || !atLeast(level(selFile.folderId), 'delete')}
                  onChange={(e) => {
                    const to = e.target.value === '__top' ? null : e.target.value;
                    if (e.target.value) void act(() => api.current.updateFile(p.id, selFile.id, { folderId: to }));
                  }}
                >
                  <option value="">Move to…</option>
                  <option value="__top">Top of the Project</option>
                  {p.folders.map((f) => (
                    <option key={f.id} value={f.id} disabled={f.id === selFile.folderId || !atLeast(level(f.id), 'write')}>
                      {folderPath(p, f.id).join(' / ')}
                    </option>
                  ))}
                </select>
                <button
                  className="btn small flat danger"
                  disabled={busy || offline || !atLeast(level(selFile.folderId), 'delete')}
                  title={needsNetwork('Deleting')}
                  onClick={() =>
                    void act(async () => {
                      if (!window.confirm(`Delete ${selFile.name} and all its revisions from the Project?`)) return;
                      setSelected(null);
                      return api.current.deleteFile(p.id, selFile.id);
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {selected?.kind === 'folder' &&
            (() => {
              const f = p.folders.find((x) => x.id === selected.id);
              if (!f) return null;
              return (
                <div className="project-actions">
                  <b>{folderPath(p, f.id).join(' / ')}</b>
                  <span className="print-hint">You: {LEVEL_LABELS[level(f.id)]}</span>
                  <div className="sheet-actions">
                    <button
                      className="btn small flat"
                      disabled={busy || offline || !atLeast(level(f.id), 'write')}
                      title={needsNetwork('Renaming')}
                      onClick={() =>
                        void act(async () => {
                          const name = await askText('Rename Folder', f.name, { label: 'Name', confirm: 'Rename' });
                          if (name?.trim() && name.trim() !== f.name) return api.current.updateFolder(p.id, f.id, { name: name.trim() });
                        })
                      }
                    >
                      Rename…
                    </button>
                    {atLeast(level(f.id), 'full') && (
                      <button className="btn small flat" disabled={offline} title={needsNetwork('Changing permissions')} onClick={() => setDialog({ kind: 'permissions', folderId: f.id })}>
                        Permissions…
                      </button>
                    )}
                    <button
                      className="btn small flat danger"
                      disabled={busy || offline || !atLeast(level(f.id), 'delete')}
                      title={needsNetwork('Deleting')}
                      onClick={() =>
                        void act(async () => {
                          setSelected(null);
                          return api.current.deleteFolder(p.id, f.id);
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })()}
          <div className="sheet-actions">
            {atLeast(level(null), 'full') && (
              <>
                <button className="btn small flat" disabled={offline} title={needsNetwork('Changing members')} onClick={() => setDialog({ kind: 'permissions', folderId: null })}>
                  Members…
                </button>
                <button className="btn small flat" disabled={offline} title={needsNetwork('Inviting people by email')} onClick={() => setDialog({ kind: 'invite' })}>
                  Invite…
                </button>
              </>
            )}
            <button className="btn small flat" onClick={() => setDialog({ kind: 'record' })}>
              Record ({record.length})
            </button>
            <button className="btn small flat" onClick={() => void run(() => refresh())} disabled={busy}>
              Refresh
            </button>
            <button
              className="btn small flat"
              onClick={() => {
                forgetProject(p.id);
                const rest = knownProjects();
                setKnown(rest);
                setProjectId(rest[0]?.id ?? null);
              }}
              title="Remove it from this list (the Project stays on the server)"
            >
              Forget
            </button>
          </div>
          <ul className="project-record">
            {record
              .slice(-6)
              .reverse()
              .map((e) => (
                <li key={e.id}>
                  <span className="print-hint">{when(e.at)}</span> <b>{e.who}</b> {e.text}
                </li>
              ))}
          </ul>
        </>
      )}
      {!projectId && <p className="empty">Team Projects keep a team’s drawings on the redcolumn server, with check out, check in and every revision. Make one, or open one by its ID.</p>}

      {dialog?.kind === 'permissions' && p && (
        <GrantsDialog
          title={dialog.folderId ? `Permissions: ${folderPath(p, dialog.folderId).join(' / ')}` : `Members of ${p.name}`}
          folder={dialog.folderId !== null}
          initial={
            dialog.folderId
              ? { inherit: !p.folders.find((f) => f.id === dialog.folderId)?.permissions, default: p.folders.find((f) => f.id === dialog.folderId)?.permissions?.default ?? null, people: p.folders.find((f) => f.id === dialog.folderId)?.permissions?.people ?? [] }
              : { inherit: false, default: p.defaultLevel, people: p.members }
          }
          onCancel={() => setDialog(null)}
          onSave={(v) =>
            void act(async () => {
              setDialog(null);
              if (dialog.folderId) return api.current.updateFolder(p.id, dialog.folderId, { permissions: v.inherit ? null : { ...(v.default ? { default: v.default } : {}), people: v.people } });
              return api.current.update(p.id, { members: v.people, defaultLevel: v.default ?? 'none' });
            })
          }
        />
      )}
      {dialog?.kind === 'revisions' &&
        p &&
        (() => {
          const f = p.files.find((x) => x.id === dialog.fileId);
          if (!f) return null;
          return (
            <div className="modal-backdrop" onMouseDown={() => setDialog(null)}>
              <div className="modal print-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <h3>Revisions of {f.name}</h3>
                <ul className="batch-results project-revisions">
                  {[...f.revisions].reverse().map((r) => (
                    <li key={r.n}>
                      <b>Revision {r.n}</b> {r.comment} <span className="print-hint">· {r.by} · {when(r.at)} · {Math.max(1, Math.round(r.size / 1024))} KB</span>
                      <div className="sheet-actions">
                        <button className="btn small" onClick={() => void run(() => onOpen(p.id, f, r.n)).then(() => setDialog(null))}>
                          Open
                        </button>
                        {r.n !== f.revisions.at(-1)!.n && (
                          <button className="btn small" disabled={busy || offline || !atLeast(level(f.folderId), 'write') || (!!f.checkout && !mine(f))} onClick={() => void act(() => api.current.restore(p.id, f.id, r.n)).then(() => setDialog(null))}>
                            Restore
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="actions">
                  <span className="spacer" />
                  <button className="btn" onClick={() => setDialog(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      {dialog?.kind === 'invite' && p && (
        <InviteDialog
          title={`Invite to ${p.name}`}
          withLevel
          onCancel={() => setDialog(null)}
          onSend={async ({ emails, level: l, note }) => {
            const r = await api.current.invite(p.id, emails, l, note);
            apply(r);
            setDialog(null);
            if (!r.sent.sent) {
              window.location.href = mailtoInvite(emails, `${me} invited you to the Team Project “${p.name}”`, [
                `${me} invited you to the Team Project “${p.name}”.`,
                '',
                `Open it: ${projectLink(p.id)}`,
                `Project ID: ${p.id}`,
                ...(note ? ['', note] : []),
              ]);
              onNotice(`Added ${emails.join(', ')} (${LEVEL_LABELS[l]}). This redcolumn server does not send email, so your mail app has the invitation ready to send.`);
            } else onNotice(`Invited ${emails.join(', ')}${r.sent.failed.length ? `; could not email ${r.sent.failed.join(', ')}` : ''}.`);
          }}
        />
      )}
      {dialog?.kind === 'record' && p && (
        <div className="modal-backdrop" onMouseDown={() => setDialog(null)}>
          <div className="modal print-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Project Record · {p.name}</h3>
            <ul className="project-record full">
              {[...record].reverse().map((e) => (
                <li key={e.id}>
                  <span className="print-hint">{when(e.at)}</span> <b>{e.who}</b> {e.text}
                </li>
              ))}
            </ul>
            <div className="actions">
              <span className="spacer" />
              <button className="btn" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A link that opens the app on a Project. */
export function projectLink(id: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('project', id);
  return url.href;
}

/** Who may do what: a default for everyone else, and people by email or name. */
function GrantsDialog({
  title,
  folder,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  folder: boolean;
  initial: { inherit: boolean; default: Level | null; people: Grant[] };
  onSave: (v: { inherit: boolean; default: Level | null; people: Grant[] }) => void;
  onCancel: () => void;
}) {
  const [inherit, setInherit] = useState(initial.inherit);
  const [def, setDef] = useState<Level | null>(initial.default);
  const [people, setPeople] = useState<Grant[]>(initial.people);
  const [who, setWho] = useState('');
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal print-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ inherit, default: def, people });
        }}
      >
        <h3>{title}</h3>
        {folder && (
          <label className="check">
            <input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} />
            Same as the folder it is in
          </label>
        )}
        {!inherit && (
          <>
            <label className="row">
              Everyone else
              <select value={def ?? ''} onChange={(e) => setDef((e.target.value || null) as Level | null)}>
                {folder && <option value="">As the folder it is in</option>}
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <ul className="batch-results">
              {people.map((g, i) => (
                <li key={g.who} className="row">
                  <span style={{ flex: 1 }}>{g.who}</span>
                  <select value={g.level} aria-label={`Level for ${g.who}`} onChange={(e) => setPeople(people.map((x, k) => (k === i ? { ...x, level: e.target.value as Level } : x)))}>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_LABELS[l]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn small flat" onClick={() => setPeople(people.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="row">
              <input placeholder="Email or name" value={who} onChange={(e) => setWho(e.target.value)} style={{ flex: 1 }} aria-label="Person to add" />
              <button
                type="button"
                className="btn small"
                disabled={!who.trim() || people.some((g) => g.who.toLowerCase() === who.trim().toLowerCase())}
                onClick={() => {
                  setPeople([...people, { who: who.trim(), level: 'read' }]);
                  setWho('');
                }}
              >
                Add
              </button>
            </div>
            <p className="print-hint">Read: open and download. Read/Write: also add, check out and check in. Read/Write/Delete: also move and delete. Full Control: also change permissions.</p>
          </>
        )}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** Email invitations: addresses, (for Projects) their level, and a note. */
export function InviteDialog({ title, withLevel, onSend, onCancel }: { title: string; withLevel?: boolean; onSend: (v: { emails: string[]; level: Level; note: string }) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [lvl, setLvl] = useState<Level>('write');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emails = parseEmails(text);
  const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <form
        className="modal print-dialog invite-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!emails.length || bad.length || busy) return;
          setBusy(true);
          setError(null);
          onSend({ emails, level: lvl, note: note.trim() }).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
      >
        <h3>{title}</h3>
        <label>
          Email addresses
          <textarea rows={3} value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder="ann@example.com, bob@example.com" style={{ width: '100%' }} />
        </label>
        {bad.length > 0 && <p className="print-error">Not an email address: {bad.join(', ')}</p>}
        {withLevel && (
          <label className="row">
            Access
            <select value={lvl} onChange={(e) => setLvl(e.target.value as Level)}>
              {LEVELS.filter((l) => l !== 'none').map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Message (optional)
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
        </label>
        <p className="print-hint">The redcolumn server emails the invitation if it is set up to send mail; otherwise your mail app opens with it ready to send.</p>
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !emails.length || bad.length > 0}>
            {busy ? 'Sending…' : 'Invite'}
          </button>
        </div>
      </form>
    </div>
  );
}
