import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { DrivePermission } from '../studio/drive/DriveApi';
import { microsoftUser, subscribeMicrosoftUser, urlFromShareId } from '../studio/drive/onedrive';
import { forgetProject, knownProjects, restoreProject, libraryCopyOf, linkOf, projectInviteLink } from '../studio/projects/local';
import { descendantFolders, folderPath, type ProjectFile, type ProjectFolder } from '../studio/projects/model';
import type { Project } from '../studio/projects/Project';
import { copyState, describeQueued, isUnreachable, noteText, projectQueue } from '../studio/projects/queue';
import { closeProject, createProject, openProject, openProjects, projectById, projectView, projectsVersion, setProjectView, subscribeProjects } from '../studio/projects/store';
import { askText } from './AskText';
import { Dialog } from './sessions/SessionDialogs';
import { DocIcon, FilterButton, FolderIcon, StudioHeader, StudioMenu, StudioRow, StudioTabs, studioIdText, type StudioSort } from './studio/chrome';
import { offlineReason, useOnline } from '../offline/network';

interface Props {
  /** The name markups are authored under; it is also who the Project knows you as. */
  me: string;
  /** Whether this build has a Microsoft client ID (VITE_MICROSOFT_CLIENT_ID). */
  oneDriveAvailable: boolean;
  /** A Project from an invite link, waiting for a click to open. */
  invite: string | null;
  onDismissInvite: () => void;
  /** A local document in the active tab that could be added to a Project. */
  localDocName: string | null;
  /** Opens a Project file in a tab (its library copy, brought up to date). */
  onOpenFile: (project: Project, file: ProjectFile, rev?: number) => Promise<void>;
  onAddFiles: (project: Project, folderId: string | null, files: File[], onProgress: (p: UploadProgress) => void) => Promise<void>;
  onAddCurrent: (project: Project, folderId: string | null, onProgress: (p: UploadProgress) => void) => Promise<void>;
  /** Checks the library copy in; queued when OneDrive cannot be reached. */
  onCheckIn: (project: Project, file: ProjectFile, comment: string) => Promise<void>;
  /** Sends what was queued offline. */
  onSendQueued: () => void;
}

/** How far adding files to a Project has got: `done` of `total` are up, and `name` is being sent. */
export interface UploadProgress {
  done: number;
  total: number;
  name: string;
}

/** Uploads in flight, by Project. Kept outside the panel so switching side panels does not lose track of them. */
const uploads = new Map<string, UploadProgress>();
const uploadListeners = new Set<() => void>();
const setUploadFor = (projectId: string, p: UploadProgress | null) => {
  if (p) uploads.set(projectId, p);
  else uploads.delete(projectId);
  uploadListeners.forEach((l) => l());
};
const subscribeUploads = (l: () => void) => {
  uploadListeners.add(l);
  return () => void uploadListeners.delete(l);
};

const when = (at: number) => new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Projects: shared folders of PDFs in OneDrive. A list of the Projects you have made or opened,
 * and, inside one, its folders and files. Everything is read from and written to the OneDrive
 * folder by this browser; there is no redcolumn server.
 */
export function ProjectsPanel(props: Props) {
  useSyncExternalStore(subscribeProjects, projectsVersion);
  useSyncExternalStore(subscribeMicrosoftUser, microsoftUser);
  const { projectId } = projectView();
  const project = projectId ? projectById(projectId) : null;
  const [browsing, setBrowsing] = useState(!!project);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('bb-project-slot')), []);
  useEffect(() => {
    if (projectId) setBrowsing(true);
  }, [projectId]);
  return (
    <>
      <ProjectList {...props} selectedId={project?.id ?? null} showFiles={browsing && !!project} onShowFiles={() => setBrowsing(true)} />
      {project && browsing && slot ? createPortal(<ProjectView {...props} project={project} onOpened={() => setBrowsing(false)} />, slot) : null}
    </>
  );
}

/** Runs an action with a busy flag, showing what goes wrong in the panel. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function ProjectList({ me, oneDriveAvailable, invite, onDismissInvite, selectedId, showFiles, onShowFiles }: Props & { selectedId: string | null; showFiles: boolean; onShowFiles: () => void }) {
  const { busy, error, run } = useRun();
  const online = useOnline();
  const open = openProjects();
  const known = knownProjects();
  const [tab, setTab] = useState<'joined' | 'not'>('joined');
  const [sort, setSort] = useState<StudioSort>('recent');
  const [sortDesc, setSortDesc] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const rows = useMemo(
    () => known.map((k, index) => ({ ...k, open: open.some((p) => p.id === k.id), index })),
    // The known list lives in localStorage; the version changes whenever it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectsVersion(), known.length, refresh, open.length],
  );
  const notJoinedCount = rows.filter((r) => !r.open && !r.removed).length;
  const shown = rows
    .filter((r) => (tab === 'joined' ? r.open : !r.open))
    .sort((a, b) => {
      if (sort === 'recent') return (sortDesc ? 1 : -1) * (a.index - b.index);
      const dir = sortDesc ? -1 : 1;
      if (sort === 'name') return dir * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return dir * a.id.localeCompare(b.id);
    });
  const blocked = busy || !online || !oneDriveAvailable;
  const why = !oneDriveAvailable ? 'This build is not set up for OneDrive.' : !online ? offlineReason('Projects') : undefined;

  const make = () =>
    run(async () => {
      const name = await askText('New Project', '', { label: 'Project name', confirm: 'Create' });
      if (name?.trim()) await createProject(name, me);
    });
  const join = () =>
    run(async () => {
      const link = await askText('Open a Project', '', { label: 'Paste the Project link or its OneDrive folder link', confirm: 'Open' });
      if (link?.trim()) await openProject(link, me, true);
    });

  return (
    <div className="sessions bb-studio projects">
      <StudioHeader
        title="All Projects"
        onRefresh={() => setRefresh((n) => n + 1)}
        plus={
          <StudioMenu
            label="New project"
            items={[
              { label: 'New project', onClick: () => void make(), disabled: blocked },
              { label: 'Open from link…', onClick: () => void join(), disabled: blocked },
            ]}
          />
        }
        filter={<FilterButton sort={sort} desc={sortDesc} onChange={(next, desc) => { setSort(next); setSortDesc(desc); }} />}
      />
      <StudioTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'joined', label: 'Joined' },
          { id: 'not', label: 'Not Joined', count: notJoinedCount },
        ]}
      />
      {selectedId && !showFiles && (
        <button type="button" className="bb-text-btn" style={{ margin: '0 10px 6px' }} onClick={onShowFiles}>
          Show files
        </button>
      )}
      <div className="bb-scroll">
        {error && (
          <p className="session-error" role="alert">
            {error}
          </p>
        )}
        {invite && (
          <div className="session-invite">
            <b>You're invited to a Project.</b>
            <p>Opening it signs you in to Microsoft (a personal, work or school account).</p>
            <div className="row">
              <button className="btn primary" disabled={blocked} onClick={() => void run(() => openProject(invite, me, true).then(onDismissInvite))}>
                Open Project
              </button>
              <button className="btn small flat" onClick={onDismissInvite}>
                Not now
              </button>
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="bb-empty">{rows.length === 0 && why ? why : tab === 'joined' ? 'Projects you have open are listed here.' : 'Projects you have not opened are listed here.'}</p>
        ) : (
          <ul className="bb-list">
            {shown.map((r) => {
              const p = projectById(r.id);
              const snap = p?.getSnapshot();
              const name = snap?.manifest.name ?? r.name;
              return (
                <StudioRow
                  key={r.id}
                  icon={<FolderIcon />}
                  name={name}
                  id={r.id}
                  selected={r.id === selectedId}
                  disabled={!!r.removed || (!r.open && blocked)}
                  title={r.open ? name : (why ?? name)}
                  onClick={() => {
                    if (r.removed) return;
                    onShowFiles();
                    if (r.open) {
                      if (r.id !== selectedId) setProjectView(r.id);
                    } else void run(() => openProject(r.id, me, true));
                  }}
                  trailing={
                    r.removed && !r.open ? (
                      <button
                        type="button"
                        className="bb-join"
                        onClick={() => {
                          restoreProject(r.id);
                          setRefresh((n) => n + 1);
                        }}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bb-x"
                        title="Remove from your projects. The project is not deleted."
                        aria-label="Remove from list"
                        onClick={() => {
                          if (!confirm(`Remove ${name} from your Projects? The Project is not deleted, and you can restore it from Not Joined.`)) return;
                          if (r.open) closeProject(r.id);
                          else {
                            forgetProject(r.id);
                            if (selectedId === r.id) setProjectView(null);
                          }
                          setRefresh((n) => n + 1);
                        }}
                      >
                        ×
                      </button>
                    )
                  }
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
function tileKind(name: string, folder = false) {
  if (folder) return 'folder';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'xls';
  if (ext === 'pptx' || ext === 'ppt') return 'ppt';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'bpx') return 'bpx';
  return 'file';
}

function tileLabel(kind: string) {
  if (kind === 'folder') return '';
  if (kind === 'xls') return 'XLS';
  if (kind === 'ppt') return 'PPT';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'bpx') return 'BPX';
  return kind.slice(0, 4).toUpperCase();
}

function ProjectView({ project, me, localDocName, onOpenFile, onAddFiles, onAddCurrent, onCheckIn, onSendQueued, onOpened }: Props & { project: Project; onOpened: () => void }) {
  const { busy, error, setError, run } = useRun();
  const online = useOnline();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const upload = useSyncExternalStore(subscribeUploads, () => uploads.get(project.id) ?? null);
  const [opening, setOpening] = useState<string | null>(null);
  const uploading = (job: (onProgress: (p: UploadProgress) => void) => Promise<void>) =>
    run(async () => {
      try {
        await job((p) => setUploadFor(project.id, p));
      } finally {
        setUploadFor(project.id, null);
      }
    });
  const queue = useSyncExternalStore(projectQueue().subscribe, () => projectQueue().all());
  const queued = queue.filter((c) => c.projectId === project.id);
  const snap = project.getSnapshot();
  const { folderId } = projectView();
  const current = snap.folders.find((f) => f.id === folderId) ? folderId : null;
  const crumbs = project.pathOf(current);
  const folders = snap.folders.filter((f) => f.parentId === current);
  const files = snap.files.filter((f) => f.folderId === current);
  const writable = project.canWrite && online;
  const sel = snap.files.find((f) => f.id === selected) ?? null;
  const go = (id: string | null) => {
    setSelected(null);
    setProjectView(project.id, id);
  };
  const net = (what: string) => (online ? undefined : offlineReason(what));
  const openFile = async (file: ProjectFile, rev?: number) => {
    await onOpenFile(project, file, rev);
    onOpened();
  };
  const q = query.trim().toLowerCase();
  const gridFolders = folders.filter((f) => !q || f.name.toLowerCase().includes(q));
  const gridFiles = files.filter((f) => !q || f.name.toLowerCase().includes(q));
  const nodes: { kind: 'folder' | 'file'; id: string; name: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const folder of snap.folders.filter((f) => f.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) {
      nodes.push({ kind: 'folder', id: folder.id, name: folder.name, depth });
      if (!collapsed.has(folder.id)) walk(folder.id, depth + 1);
    }
    for (const file of snap.files.filter((f) => f.folderId === parent).sort((a, b) => a.name.localeCompare(b.name))) nodes.push({ kind: 'file', id: file.id, name: file.name, depth });
  };
  walk(null, 0);
  const uploadStatus = upload ? `Uploading ${Math.min(upload.done + 1, upload.total)} of ${upload.total}: ${upload.name}` : queued.length ? `${queued.length} waiting to send` : 'Up to date';
  const bytes = snap.files.reduce((sum, f) => sum + (f.revisions[f.revisions.length - 1]?.size ?? 0), 0);

  return (
    <div className="bb-project-stage">
      <header className="bb-project-bar">
        <span className="name">{snap.manifest.name}</span>
        <span className="meta" title={project.id}>
          ID: {studioIdText(project.id)}
        </span>
        <span className="meta">Owner: {snap.manifest.owner}</span>
        <span className="meta">Created: {new Date(snap.manifest.createdAt).toLocaleString()}</span>
        <span className="meta">Upload status: {uploadStatus}</span>
        <span className="spacer" />
        <button type="button" className="bb-linkish" disabled={busy || !online} title={net('Refreshing') ?? 'Check OneDrive for changes now'} onClick={() => void run(() => project.poll())}>
          Refresh
        </button>
        <button type="button" className="bb-linkish" onClick={() => setManaging(true)}>
          Settings
        </button>
      </header>
      {managing && (
        <ManageProject
          project={project}
          online={online}
          bytes={bytes}
          me={me}
          onClose={() => setManaging(false)}
        />
      )}
      {error && (
        <p className="session-error" role="alert">
          {error}
        </p>
      )}
      {upload && (
        <div className="upload-progress" role="status">
          <b>
            Uploading {Math.min(upload.done + 1, upload.total)} of {upload.total}
          </b>
          <span className="hint-text">{upload.name}</span>
          <progress max={upload.total} value={upload.done} aria-label="Upload progress" />
        </div>
      )}
      <div className="bb-project-panes">
        <aside className="bb-tree" aria-label="Project files">
          <div className="bb-tree-scroll">
            <button type="button" className={current === null && !selected ? 'bb-tree-row on' : 'bb-tree-row'} onClick={() => go(null)}>
              <FolderIcon />
              <span className="bb-name">{snap.manifest.name}</span>
            </button>
            {nodes.map((node) => (
              <button
                key={`${node.kind}-${node.id}`}
                type="button"
                className={(node.kind === 'file' ? selected === node.id : current === node.id) ? 'bb-tree-row on' : 'bb-tree-row'}
                style={{ paddingLeft: 8 + node.depth * 14 }}
                aria-busy={opening === node.id}
                onClick={() => {
                  if (node.kind === 'folder') {
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      next.delete(node.id);
                      return next;
                    });
                    go(node.id);
                  } else setSelected(node.id);
                }}
                onDoubleClick={() => {
                  if (node.kind !== 'file') return;
                  const file = snap.files.find((f) => f.id === node.id);
                  if (file) {
                    setOpening(file.id);
                    void run(() => openFile(file)).finally(() => setOpening(null));
                  }
                }}
              >
                {node.kind === 'folder' ? <FolderIcon /> : <DocIcon />}
                <span className="bb-name">{node.name}</span>
              </button>
            ))}
          </div>
          {(queued.length > 0 || snap.record.length > 0) && (
            <div className="bb-pending">
              {queued.length > 0 && (
                <>
                  <h3>Pending</h3>
                  <ul className="bb-people">
                    {queued.map((c) => (
                      <li key={c.id} className="bb-person">
                        <span className="bb-name">
                          {describeQueued(c)}
                          {c.error ? ` — ${c.error}` : ''}
                        </span>
                        {c.error && (
                          <button type="button" className="bb-mini" onClick={() => projectQueue().retry(c.id)}>
                            Retry
                          </button>
                        )}
                        <button type="button" className="bb-mini" onClick={() => projectQueue().discard(c.id)}>
                          Discard
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="bb-linkish" disabled={!online} onClick={onSendQueued}>
                    Send now
                  </button>
                </>
              )}
              {snap.record.length > 0 && (
                <details>
                  <summary className="bb-group">Record ({snap.record.length})</summary>
                  <ul className="bb-people">
                    {[...snap.record].reverse().map((e) => (
                      <li key={e.id} className="bb-person">
                        <span className="bb-name">
                          {e.who}: {e.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </aside>
        <section className="bb-thumbs">
          <div className="bb-stage-tools">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search with a keyword" aria-label="Search files" />
            <StudioMenu
              label="Add"
              icon={<span>Add</span>}
              items={[
                { label: 'Add PDFs…', onClick: () => fileInput.current?.click(), disabled: busy || !!upload || !writable },
                { label: localDocName ? `Add ${localDocName}` : 'Add open document', onClick: () => void uploading((p) => onAddCurrent(project, current, p)), disabled: busy || !!upload || !writable || !localDocName },
                {
                  label: 'New folder',
                  disabled: busy || !writable,
                  onClick: () =>
                    void run(async () => {
                      const name = await askText('New folder', '', { label: 'Folder name', confirm: 'Create' });
                      if (name?.trim()) await project.addFolder(name, current);
                    }),
                },
              ]}
            />
            <button type="button" className="bb-linkish" aria-expanded={actionsOpen} onClick={() => setActionsOpen((v) => !v)}>
              Actions
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = '';
                if (picked.length) void uploading((p) => onAddFiles(project, current, picked, p));
              }}
            />
          </div>
          <div className="bb-path">{[snap.manifest.name, ...crumbs.map((c) => c.name)].join(' / ')}</div>
          {actionsOpen && (
            <div className="bb-actions-pop">
              {sel ? (
                <FileActions project={project} file={sel} busy={busy} online={online} run={run} onOpenFile={async (p, file, rev) => openFile(file, rev)} onCheckIn={onCheckIn} queuedCheckIn={queued.some((c) => c.kind === 'checkin' && c.fileId === sel.id)} />
              ) : (
                <p className="bb-empty">Select a file to check it out, rename it, or open it.</p>
              )}
              {current && (
                <div className="row">
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy || !writable}
                    onClick={() =>
                      void run(async () => {
                        const name = await askText('Rename folder', crumbs[crumbs.length - 1]?.name ?? '', { label: 'Name', confirm: 'Rename' });
                        if (name?.trim()) await project.renameFolder(current, name);
                      })
                    }
                  >
                    Rename folder…
                  </button>
                  <select
                    value=""
                    aria-label="Move folder to"
                    disabled={busy || !writable}
                    onChange={(e) => {
                      const to = e.target.value;
                      if (to) void run(() => project.moveFolder(current, to === TOP ? null : to));
                    }}
                  >
                    <option value="">Move folder to…</option>
                    <MoveOptions folders={snap.folders} exclude={[current, ...descendantFolders(snap.folders, current).map((f) => f.id)]} />
                  </select>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy || !writable}
                    onClick={() => {
                      const { folders: nf, files: nfiles } = project.contentsOf(current);
                      const inside = nf || nfiles ? ` It holds ${nfiles} file${nfiles === 1 ? '' : 's'} and ${nf} folder${nf === 1 ? '' : 's'}.` : '';
                      if (window.confirm(`Delete the folder ${crumbs[crumbs.length - 1]?.name}?${inside}`)) {
                        const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2]!.id : null;
                        void run(async () => {
                          await project.deleteFolder(current);
                          go(parent);
                        });
                      }
                    }}
                  >
                    Delete folder
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="bb-thumb-grid">
            {gridFolders.map((f) => (
              <button key={f.id} type="button" className={current === f.id ? 'bb-tile on' : 'bb-tile'} onClick={() => go(f.id)} onDoubleClick={() => go(f.id)}>
                <span className="bb-tile-face folder">
                  <FolderIcon />
                </span>
                <span className="bb-tile-name">{f.name}</span>
              </button>
            ))}
            {gridFiles.map((f) => {
              const kind = tileKind(f.name);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={selected === f.id ? 'bb-tile on' : 'bb-tile'}
                  aria-busy={opening === f.id}
                  onClick={() => setSelected(f.id)}
                  onDoubleClick={() => {
                    setOpening(f.id);
                    void run(() => openFile(f)).finally(() => setOpening(null));
                  }}
                >
                  <span className={`bb-tile-face ${kind}`}>{tileLabel(kind)}</span>
                  <span className="bb-tile-name">{f.name}</span>
                </button>
              );
            })}
            {gridFolders.length === 0 && gridFiles.length === 0 && <p className="bb-empty">{q ? 'No files match.' : current ? 'This folder is empty.' : 'No files yet.'}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
/** Project settings: name and counts, who has access, and what this person can do. */
function ManageProject({ project, online, bytes, me, onClose }: { project: Project; online: boolean; bytes: number; me: string; onClose: () => void }) {
  const { busy, error, run } = useRun();
  const snap = project.getSnapshot();
  const url = urlFromShareId(project.id);
  const owner = project.level === 'owner';
  const [tab, setTab] = useState<'general' | 'access' | 'permissions'>('general');
  const [name, setName] = useState(snap.manifest.name);
  const [copied, setCopied] = useState(false);
  const space = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
  const users = new Set([snap.manifest.owner, ...snap.manifest.members.map((m) => m.who)]).size;
  const save = (close: boolean) => {
    const next = name.trim();
    if (!owner || !next || next === snap.manifest.name) {
      if (close) onClose();
      return;
    }
    void run(async () => {
      await project.rename(next);
      if (close) onClose();
    });
  };
  return (
    <Dialog title="Project Settings" className="wide bb-light" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
      >
        <nav className="dialog-steps" role="tablist">
          {(
            [
              ['general', 'General'],
              ['access', 'User Access'],
              ['permissions', 'Permissions'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="dialog-pane">
          {tab === 'general' && (
            <>
              <dl className="bb-set-grid">
                <dt>Project Name</dt>
                <dd>
                  <input aria-label="Project Name" value={name} readOnly={!owner} onChange={(e) => setName(e.target.value)} maxLength={200} />
                </dd>
                <dt>Project ID</dt>
                <dd>
                  <input aria-label="Project ID" value={studioIdText(project.id)} readOnly />
                </dd>
                <dt>Total Users</dt>
                <dd>{users}</dd>
                <dt>Total Files</dt>
                <dd>{snap.files.length}</dd>
                <dt>Total Folders</dt>
                <dd>{snap.folders.length}</dd>
                <dt>Created On</dt>
                <dd>{new Date(snap.manifest.createdAt).toLocaleString()}</dd>
                <dt>Project Size</dt>
                <dd>{space}</dd>
              </dl>
              <div className="bb-set-links">
                <button
                  type="button"
                  className="bb-set-link"
                  onClick={() =>
                    void navigator.clipboard.writeText(projectInviteLink(project.id)).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? 'Link copied' : 'Copy invite link'}
                </button>
                {url && (
                  <a className="bb-set-link" href={url} target="_blank" rel="noreferrer">
                    Open in OneDrive
                  </a>
                )}
              </div>
              <p className="hint">You are {me}.</p>
            </>
          )}
          {tab === 'access' && (owner ? <Members project={project} online={online} /> : <p className="hint">The owner, {snap.manifest.owner}, manages who has access.</p>)}
          {tab === 'permissions' && (
            <p className="hint">
              You are {project.level === 'owner' ? 'the owner' : project.level === 'viewer' ? 'a viewer' : 'an editor'} of this project.
              {project.canWrite ? ' You can add and change files.' : ' You can open files, not change them.'} OneDrive enforces this. Folder access follows the project folder.
            </p>
          )}
          {error && (
            <p className="session-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="actions">
          <span className="spacer" />
          <button type="submit" className="btn" disabled={busy || !online && owner && name.trim() !== snap.manifest.name}>
            OK
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || (!online && owner && name.trim() !== snap.manifest.name)} onClick={() => save(false)}>
            Apply
          </button>
        </div>
      </form>
    </Dialog>
  );
}
/** What can be done to the selected file: open, check out and in, revisions, a note. */
function FileActions({
  project,
  file,
  busy,
  online,
  run,
  onOpenFile,
  onCheckIn,
  queuedCheckIn,
}: {
  project: Project;
  file: ProjectFile;
  busy: boolean;
  online: boolean;
  run: (job: () => Promise<unknown>) => Promise<void>;
  onOpenFile: Props['onOpenFile'];
  onCheckIn: Props['onCheckIn'];
  queuedCheckIn: boolean;
}) {
  const [revs, setRevs] = useState(false);
  const last = file.revisions[file.revisions.length - 1]!;
  const mine = project.heldByMe(file);
  const theirs = !!file.checkout && !mine;
  const copy = libraryCopyOf(project.id, file.id);
  const state = copyState(copy ? linkOf(copy) : null, last.n);
  const canWrite = project.canWrite;
  const net = (what: string) => (online ? undefined : offlineReason(what));
  // A check-out untouched for a day is probably abandoned; the owner can always release one.
  const stale = !!file.checkout && Date.now() - file.checkout.at > 24 * 3_600_000;
  const canRelease = theirs && (project.level === 'owner' || stale);

  return (
    <div className="project-actions">
      <b>{file.name}</b>
      <p className="hint-text">
        {state.kind === 'none' && 'Not on this device yet.'}
        {state.kind === 'current' && `Your copy is revision ${state.rev}, the latest.`}
        {state.kind === 'stale' && `Your copy is revision ${state.rev}; the Project has revision ${state.latest}.`}
        {' '}Markups are shared live with everyone who has it open.
        {file.checkout?.note ? ` Checked out for: ${file.checkout.note}` : ''}
      </p>
      <Viewers project={project} fileId={file.id} />
      <div className="row">
        <button
          className="btn small primary"
          disabled={busy || (!online && !copy)}
          title={!online && !copy ? 'This file is not on this device. Open it once online to keep a copy.' : 'Open this file'}
          onClick={() => void run(() => onOpenFile(project, file))}
        >
          Open
        </button>
        {!file.checkout && (
          <button
            className="btn small"
            disabled={busy || !online || !canWrite}
            title={net('Checking out') ?? 'Reserve the PDF to replace it with a new revision. Markups need no check-out: they are shared live.'}
            onClick={() =>
              void run(async () => {
                await project.checkOut(file.id);
                // Opened too, so the changes are made on the latest revision.
                await onOpenFile(project, file);
              })
            }
          >
            Check Out
          </button>
        )}
        {mine && (
          <>
            <button
              className="btn small primary"
              disabled={busy || !copy || queuedCheckIn}
              title={queuedCheckIn ? 'Already waiting to be sent' : copy ? (online ? 'Upload your copy of the PDF as a new revision (markups are shared live, so they need no check-in)' : 'Queue your copy to be checked in when OneDrive can be reached') : 'Open it first, then make your changes'}
              onClick={() =>
                void run(async () => {
                  const comment = await askText(`Check In ${file.name}`, '', { label: 'Comment', confirm: online ? 'Check In' : 'Queue Check In' });
                  if (comment !== null) await onCheckIn(project, file, comment);
                })
              }
            >
              Check In…
            </button>
            <button className="btn small" disabled={busy || !online} title={net('Undoing a check-out') ?? 'Give up the check-out without checking in'} onClick={() => void run(() => project.undoCheckOut(file.id))}>
              Undo Check Out
            </button>
          </>
        )}
        {canRelease && (
          <button
            className="btn small"
            disabled={busy || !online}
            title={`Release ${file.checkout!.by}\u2019s check-out (their changes are not checked in)`}
            onClick={() => {
              if (window.confirm(`Release ${file.checkout!.by}\u2019s check-out of ${file.name}? Anything they have not checked in is not kept.`)) void run(() => project.undoCheckOut(file.id, true));
            }}
          >
            Release Check Out
          </button>
        )}
        <button className="btn small" aria-expanded={revs} onClick={() => setRevs((v) => !v)}>
          Revisions ({file.revisions.length})
        </button>
        <button
          className="btn small"
          disabled={busy || !canWrite}
          title="Add a note about this file to the Project Record"
          onClick={() =>
            void run(async () => {
              const text = await askText(`Note on ${file.name}`, '', { label: 'Note', confirm: 'Add Note' });
              if (!text?.trim()) return;
              const change = { projectId: project.id, fileId: file.id, fileName: file.name, by: '', kind: 'note' as const, text: text.trim() };
              try {
                if (!online) throw new TypeError('offline');
                await project.note('file', noteText({ ...change, id: '', at: Date.now() }), { fileId: file.id });
              } catch (err) {
                if (!isUnreachable(err)) throw err;
                projectQueue().add(change);
              }
            })
          }
        >
          Add Note…
        </button>
      </div>
      <div className="row">
        <button
          className="btn small flat"
          disabled={busy || !online || !canWrite || theirs}
          title={theirs ? `${file.checkout!.by} has it checked out` : 'Rename this file'}
          onClick={() =>
            void run(async () => {
              const name = await askText('Rename file', file.name, { label: 'Name', confirm: 'Rename' });
              if (name?.trim()) await project.renameFile(file.id, name);
            })
          }
        >
          Rename…
        </button>
        <select
          value=""
          aria-label="Move file to"
          disabled={busy || !online || !canWrite || theirs}
          onChange={(e) => {
            const to = e.target.value;
            if (to) void run(() => project.moveFile(file.id, to === TOP ? null : to));
          }}
        >
          <option value="">Move to…</option>
          {file.folderId !== null && <option value={TOP}>Top of the Project</option>}
          <MoveOptions folders={project.getSnapshot().folders} exclude={file.folderId ? [file.folderId] : []} top={false} />
        </select>
        <button
          className="btn small flat danger"
          disabled={busy || !online || !canWrite || !!file.checkout}
          title={file.checkout ? 'Undo the check-out first' : 'Remove this file from the Project'}
          onClick={() => {
            if (window.confirm(`Delete ${file.name}? Its ${file.revisions.length} revision${file.revisions.length === 1 ? '' : 's'} stay in the OneDrive folder.`)) void run(() => project.deleteFile(file.id));
          }}
        >
          Delete
        </button>
      </div>
      {revs && (
        <ul className="plain-list">
          {[...file.revisions].reverse().map((r) => (
            <li key={r.n}>
              <b>Rev {r.n}</b> · {r.by}, {new Date(r.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · {size(r.size)}
              {r.comment ? ` · ${r.comment}` : ''}{' '}
              {r.n !== last.n && (
                <>
                  <button className="btn small flat" disabled={busy || !online} title={net('Opening') ?? 'Open this revision on its own'} onClick={() => void run(() => onOpenFile(project, file, r.n))}>
                    Open
                  </button>
                  <button
                    className="btn small flat"
                    disabled={busy || !online || !canWrite || theirs}
                    title={theirs ? `${file.checkout!.by} has it checked out` : 'Make this revision the newest again, as a new revision'}
                    onClick={() => void run(() => project.restore(file.id, r.n))}
                  >
                    Restore
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who else has the file open now, and on which page. */
function Viewers({ project, fileId }: { project: Project; fileId: string }) {
  const others = project.getSnapshot().presence.filter((p) => p.fileId === fileId && !p.self);
  if (!others.length) return null;
  return (
    <p className="project-viewers">
      Viewing now:{' '}
      {others.map((p, i) => (
        <span key={p.seat}>
          {i > 0 && ', '}
          <i style={{ background: p.color }} aria-hidden="true" />
          <b>{p.name}</b>
          {p.page != null && <span className="hint-text"> (page {p.page + 1})</span>}
        </span>
      ))}
    </p>
  );
}

const TOP = '__top';

/** Folders to choose from, with their paths, leaving out `exclude` (where it already is, or inside itself). */
function MoveOptions({ folders, exclude, top = true }: { folders: ProjectFolder[]; exclude: string[]; top?: boolean }) {
  return (
    <>
      {top && <option value={TOP}>Top of the Project</option>}
      {folders
        .filter((f) => !exclude.includes(f.id))
        .map((f) => ({ id: f.id, path: folderPath(folders, f.id) }))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => (
          <option key={f.id} value={f.id}>
            {f.path}
          </option>
        ))}
    </>
  );
}

const LEVEL_CHOICES = [
  { value: 'editor', label: 'Can edit: open, check out and in, add and change files' },
  { value: 'viewer', label: 'Can view: open and read only' },
];

/** Who the folder is shared with, as OneDrive reports it. The owner changes it here, and OneDrive enforces it. */
function Members({ project, online }: { project: Project; online: boolean }) {
  const [people, setPeople] = useState<DrivePermission[] | null>(null);
  const { busy, error, run } = useRun();
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = async () => {
    try {
      setPeople(await project.members());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };
  useEffect(() => {
    if (online) void load();
    // Read again when another Project is opened, not on every change inside this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, online]);
  const act = (job: () => Promise<unknown>) => run(async () => (await job(), await load()));
  const net = online ? undefined : offlineReason('Changing who has access');

  return (
    <>
      <h3>
        People
        <button
          className="btn small flat"
          disabled={busy || !online}
          title={net ?? 'Share the folder with someone by email'}
          onClick={() =>
            void act(async () => {
              const email = await askText('Invite to the Project', '', { label: 'Their Microsoft account email', confirm: 'Next' });
              if (!email?.trim()) return;
              const level = await askText('What can they do?', 'editor', { choices: LEVEL_CHOICES, confirm: 'Invite' });
              if (level) await project.invite(email, level === 'viewer' ? 'viewer' : 'editor');
            })
          }
        >
          Invite…
        </button>
      </h3>
      {(error || loadError) && <p className="session-error">{error ?? loadError}</p>}
      {people && (
        <ul className="plain-list project-people">
          {people.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>
              {p.email && p.email !== p.name && <span className="hint-text"> {p.email}</span>}{' '}
              {p.role === 'owner' ? (
                <span className="status">Owner</span>
              ) : (
                <>
                  <select
                    aria-label={`What ${p.name} can do`}
                    value={p.role === 'reader' ? 'viewer' : 'editor'}
                    disabled={busy || !online || p.inherited}
                    title={p.inherited ? 'Set on a folder above, so it cannot be changed here' : undefined}
                    onChange={(e) => void act(() => project.setLevel(p.id, e.target.value === 'viewer' ? 'viewer' : 'editor'))}
                  >
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </select>
                  <button
                    className="btn small flat danger"
                    disabled={busy || !online || p.inherited}
                    title={p.kind === 'link' ? 'Turn this link off' : `Stop sharing with ${p.name}`}
                    aria-label={p.kind === 'link' ? 'Turn this link off' : `Remove ${p.name}`}
                    onClick={() => {
                      if (window.confirm(p.kind === 'link' ? 'Turn off this link? People who only have the link lose access.' : `Stop sharing the Project with ${p.name}?`)) void act(() => project.removeMember(p.id));
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!people && !loadError && <p className="hint-text">Loading…</p>}
    </>
  );
}
