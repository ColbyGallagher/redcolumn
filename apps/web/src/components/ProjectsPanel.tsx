import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DrivePermission } from '../studio/drive/DriveApi';
import { microsoftUser, subscribeMicrosoftUser, urlFromShareId } from '../studio/drive/onedrive';
import { forgetProject, knownProjects, restoreProject, libraryCopyOf, linkOf, projectInviteLink } from '../studio/projects/local';
import { descendantFolders, folderPath, type ProjectFile, type ProjectFolder } from '../studio/projects/model';
import type { Project } from '../studio/projects/Project';
import { copyState, describeQueued, isUnreachable, noteText, projectQueue } from '../studio/projects/queue';
import { closeProject, createProject, openProject, openProjects, projectById, projectView, projectsVersion, setProjectView, subscribeProjects } from '../studio/projects/store';
import { askText } from './AskText';
import { Dialog } from './sessions/SessionDialogs';
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
  return project ? <ProjectView {...props} project={project} /> : <ProjectList {...props} />;
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

function ProjectList({ me, oneDriveAvailable, invite, onDismissInvite }: Props) {
  const { busy, error, run } = useRun();
  const online = useOnline();
  const open = openProjects();
  const known = knownProjects();
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [refresh, setRefresh] = useState(0);
  const rows = useMemo(
    () => known.map((k) => ({ ...k, open: open.some((p) => p.id === k.id) })).filter((r) => filter === 'all' || r.open || !r.removed),
    // The known list lives in localStorage; the version changes whenever it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectsVersion(), known.length, filter, refresh],
  );
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
    <div className="sessions projects">
      <div className="session-toolbar">
        <button className="btn primary" disabled={blocked} title={why ?? 'Make a Project in your OneDrive'} onClick={() => void make()}>
          + New
        </button>
        <button className="btn" disabled={blocked} title={why ?? 'Open a Project from a link'} onClick={() => void join()}>
          Open…
        </button>
      </div>
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
      <h3>
        My Projects
        <span className="experimental-badge" title="Projects is experimental and may change">Experimental</span>
        <span className="record-filter" role="tablist">
          {(['active', 'all'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'active' ? 'Active' : 'All'}
            </button>
          ))}
        </span>
      </h3>
      {rows.length === 0 && known.length > 0 ? (
        <p className="empty">No active Projects. Show All to see removed ones.</p>
      ) : rows.length === 0 ? (
        <p className="empty">Projects are shared folders of PDFs in OneDrive, with everyone on the Project able to open them from here. Make one, or open one from the link its owner sent.</p>
      ) : (
        <ul className="session-list">
          {rows.map((r) => {
            const p = projectById(r.id);
            const snap = p?.getSnapshot();
            return (
              <li key={r.id} className={r.open ? 'joined' : ''}>
                <button className="session-row" disabled={blocked} onClick={() => void run(() => openProject(r.id, me, true))} title="Open this Project">
                  <span className="line1">
                    <b>{snap?.manifest.name ?? r.name}</b>
                    <span className={`status${r.removed && !r.open ? ' removed' : ''}`}>{r.open ? 'Open' : r.removed ? 'Removed' : 'OneDrive'}</span>
                  </span>
                  {snap && (
                    <span className="line2">
                      {snap.files.length} file{snap.files.length === 1 ? '' : 's'} · {snap.manifest.owner}
                    </span>
                  )}
                </button>
                {r.removed && !r.open ? (
                  <button
                    className="btn small flat"
                    title="Restore to the Active list"
                    aria-label="Restore"
                    onClick={() => {
                      restoreProject(r.id);
                      setRefresh((n) => n + 1);
                    }}
                  >
                    ↺
                  </button>
                ) : (
                  <button
                    className="btn small flat"
                    title="Remove from the Active list (the Project is not deleted; restore it from All)"
                    aria-label="Remove from list"
                    onClick={() => {
                      if (!confirm(`Remove ${snap?.manifest.name ?? r.name} from your Projects? The Project is not deleted, and you can restore it from All.`)) return;
                      if (r.open) closeProject(r.id);
                      else {
                        forgetProject(r.id);
                        setProjectView(null);
                      }
                      setRefresh((n) => n + 1);
                    }}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProjectView({ project, me, localDocName, onOpenFile, onAddFiles, onAddCurrent, onCheckIn, onSendQueued }: Props & { project: Project }) {
  const { busy, error, setError, run } = useRun();
  const online = useOnline();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showRecord, setShowRecord] = useState(false);
  const [managing, setManaging] = useState(false);
  const upload = useSyncExternalStore(subscribeUploads, () => uploads.get(project.id) ?? null);
  /** The file being opened from a click, while it loads. */
  const [opening, setOpening] = useState<string | null>(null);
  /** Runs an add-files job with the progress panel showing until it ends, however it ends. */
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
  const url = urlFromShareId(project.id);
  const sel = snap.files.find((f) => f.id === selected) ?? null;
  const go = (id: string | null) => {
    setSelected(null);
    setProjectView(project.id, id);
  };
  const net = (what: string) => (online ? undefined : offlineReason(what));

  return (
    <div className="sessions projects">
      <div className="session-toolbar">
        <button className="btn small flat" onClick={() => setProjectView(null)} title="Back to the list of Projects" aria-label="Back">
          ‹ Projects
        </button>
        <button className="btn small flat" disabled={busy || !online} title={net('Refreshing') ?? 'Check OneDrive for changes now'} onClick={() => void run(() => project.poll())} aria-label="Refresh">
          ↻
        </button>
      </div>
      <h3>
        {snap.manifest.name}
        <span className="status">{project.level === 'owner' ? 'Owner' : project.level === 'viewer' ? 'View only' : 'Editor'}</span>
      </h3>
      <button className="btn small manage-button" onClick={() => setManaging(true)} title="Rename the Project, manage every folder and file, and who has access">
        Manage project…
      </button>
      {managing && (
        <ManageProject
          project={project}
          online={online}
          upload={upload}
          onClose={() => setManaging(false)}
          onAddFiles={(folderId, picked) => void uploading((p) => onAddFiles(project, folderId, picked, p))}
        />
      )}
      {error && (
        <p className="session-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn small" disabled={busy || !writable} title={net('Adding a folder') ?? 'Make a folder here'} onClick={() => void run(async () => {
          const name = await askText('New folder', '', { label: 'Folder name', confirm: 'Create' });
          if (name?.trim()) await project.addFolder(name, current);
        })}>
          + Folder
        </button>
        <button className="btn small" disabled={busy || !!upload || !writable} title={net('Adding files') ?? 'Add PDFs from this computer to this folder'} onClick={() => fileInput.current?.click()}>
          Add PDFs…
        </button>
        <button className="btn small" disabled={busy || !!upload || !writable || !localDocName} title={localDocName ? `Add ${localDocName} to this folder` : 'Open a document first'} onClick={() => void uploading((p) => onAddCurrent(project, current, p))}>
          Add open document
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
      {upload && (
        <div className="upload-progress" role="status" aria-live="polite">
          <b>
            Uploading {Math.min(upload.done + 1, upload.total)} of {upload.total}
          </b>
          <span className="hint-text">{upload.name}</span>
          <progress max={upload.total} value={upload.done} aria-label="Upload progress" />
          <span className="hint-text">You can keep working while this uploads. Just don't close the app.</span>
        </div>
      )}

      <nav className="project-crumbs" aria-label="Folder">
        <button className="btn small flat" onClick={() => go(null)}>
          {snap.manifest.name}
        </button>
        {crumbs.map((f) => (
          <span key={f.id}>
            {' / '}
            <button className="btn small flat" onClick={() => go(f.id)}>
              {f.name}
            </button>
          </span>
        ))}
      </nav>

      {current && (
        <div className="row">
          <button
            className="btn small flat"
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
            className="btn small flat danger"
            disabled={busy || !writable}
            onClick={() => {
              const { folders: nf, files: nfiles } = project.contentsOf(current);
              const inside = nf || nfiles ? ` It holds ${nfiles} file${nfiles === 1 ? '' : 's'} and ${nf} folder${nf === 1 ? '' : 's'}, which go with it.` : '';
              if (window.confirm(`Delete the folder ${crumbs[crumbs.length - 1]?.name}?${inside} Their revisions stay in the OneDrive folder.`)) {
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

      <ul className="session-list">
        {folders.map((f: ProjectFolder) => (
          <li key={f.id}>
            <button className="session-row" onClick={() => go(f.id)} title="Open this folder">
              <span className="line1">
                <span aria-hidden="true">📁</span>
                <b>{f.name}</b>
              </span>
              <span className="line2">
                {snap.files.filter((x) => x.folderId === f.id).length} file(s) · {snap.folders.filter((x) => x.parentId === f.id).length} folder(s)
              </span>
            </button>
          </li>
        ))}
        {files.map((f) => {
          const last = f.revisions[f.revisions.length - 1]!;
          return (
            <li key={f.id}>
              <button
                className={`session-row ${selected === f.id ? 'selected' : ''}`}
                disabled={busy}
                onClick={() => {
                  // Opens it, and shows what else can be done with it below.
                  setSelected(f.id);
                  setOpening(f.id);
                  void run(() => onOpenFile(project, f)).finally(() => setOpening(null));
                }}
                title="Open this file"
                aria-busy={opening === f.id}
              >
                <span className="line1">
                  {opening === f.id && <span className="spinner" role="status" aria-label={`Opening ${f.name}`} />}
                  <b>{f.name}</b>
                  <span className="dots">
                    {snap.presence
                      .filter((p) => p.fileId === f.id && !p.self)
                      .map((p) => (
                        <i key={p.seat} style={{ background: p.color }} title={`${p.name} is viewing`} />
                      ))}
                  </span>
                  <span className="status">Rev {last.n}</span>
                  {f.checkout && <span className="status checked-out">{project.heldByMe(f) ? 'Out: you' : `Out: ${f.checkout.by}`}</span>}
                </span>
                <span className="line2">
                  {size(last.size)} · {last.by}, {when(last.at)}
                  {last.comment && last.n > 1 ? ` · ${last.comment}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {sel && (
        <FileActions project={project} file={sel} busy={busy} online={online} run={run} onOpenFile={onOpenFile} onCheckIn={onCheckIn} queuedCheckIn={queued.some((c) => c.kind === 'checkin' && c.fileId === sel.id)} />
      )}
      {queued.length > 0 && (
        <div className="session-invite">
          <b>
            {queued.length} change{queued.length === 1 ? '' : 's'} waiting to be sent
          </b>
          <ul className="plain-list">
            {queued.map((c) => (
              <li key={c.id}>
                {describeQueued(c)}
                {c.error && <span className="session-error"> {c.error}</span>}{' '}
                {c.error && (
                  <button className="btn small flat" onClick={() => projectQueue().retry(c.id)}>
                    Retry
                  </button>
                )}
                <button className="btn small flat" title="Do not send it" onClick={() => projectQueue().discard(c.id)}>
                  Discard
                </button>
              </li>
            ))}
          </ul>
          <button className="btn small" disabled={!online} title={net('Sending') ?? 'Send them now'} onClick={onSendQueued}>
            Send now
          </button>
        </div>
      )}
      {!folders.length && !files.length && <p className="empty">{current ? 'This folder is empty.' : 'No files yet.'} {project.canWrite ? 'Add PDFs or make a folder.' : 'The owner has not added anything you can see yet.'}</p>}

      <h3>
        Project Record
        <button className="btn small flat" onClick={() => setShowRecord((v) => !v)} aria-expanded={showRecord}>
          {showRecord ? 'Hide' : `Show (${snap.record.length})`}
        </button>
      </h3>
      {showRecord && (
        <ul className="plain-list project-record">
          {snap.record.length === 0 && <li className="empty">Nothing yet.</li>}
          {[...snap.record]
            .reverse()
            .filter((e) => !sel || e.fileId === sel.id)
            .map((e) => (
              <li key={e.id}>
                <span className="hint-text">{new Date(e.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span> <b>{e.who}</b> {e.text}
              </li>
            ))}
        </ul>
      )}

      <h3>Sharing</h3>
      <div className="row">
        <button className="btn small" onClick={() => void navigator.clipboard.writeText(projectInviteLink(project.id)).then(() => setError(null), () => setError('Could not copy the link.'))} title="Copy a link that opens the app and this Project">
          Copy invite link
        </button>
        {url && (
          <a className="btn small" href={url} target="_blank" rel="noreferrer" title="Open the Project folder in OneDrive">
            Open in OneDrive
          </a>
        )}
      </div>
      <p className="hint-text">You are {me}. Who can open or change this Project is set by the sharing of its OneDrive folder.</p>
      {project.level === 'owner' ? <Members project={project} online={online} /> : <p className="hint-text">The owner, {snap.manifest.owner}, manages who has access.</p>}
      {folderPath(snap.folders, current) && <p className="hint-text">Folder: {folderPath(snap.folders, current)}</p>}
    </div>
  );
}

/** The Project window: its name, every folder and file in one list to change, and who has access. */
function ManageProject({ project, online, upload, onClose, onAddFiles }: { project: Project; online: boolean; upload: UploadProgress | null; onClose: () => void; onAddFiles: (folderId: string | null, files: File[]) => void }) {
  const { busy, error, run } = useRun();
  const addRef = useRef<HTMLInputElement>(null);
  const addTo = useRef<string | null>(null);
  const snap = project.getSnapshot();
  const url = urlFromShareId(project.id);
  const owner = project.level === 'owner';
  const can = project.canWrite && online;
  const working = busy || !!upload;
  const net = (what: string) => (online ? undefined : offlineReason(what));

  type Row = { kind: 'folder'; depth: number; folder: ProjectFolder } | { kind: 'file'; depth: number; file: ProjectFile };
  const rows: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const folder of snap.folders.filter((f) => f.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ kind: 'folder', depth, folder });
      walk(folder.id, depth + 1);
    }
    for (const file of snap.files.filter((f) => f.folderId === parent).sort((a, b) => a.name.localeCompare(b.name))) rows.push({ kind: 'file', depth, file });
  };
  walk(null, 0);

  const newFolder = (parent: string | null) =>
    run(async () => {
      const name = await askText('New folder', '', { label: 'Folder name', confirm: 'Create' });
      if (name?.trim()) await project.addFolder(name, parent);
    });
  const pickFiles = (folderId: string | null) => {
    addTo.current = folderId;
    addRef.current?.click();
  };

  return (
    <Dialog title="Manage Project" className="wide" onClose={onClose}>
      <div className="dialog-body">
        <div className="dialog-pane manage-project">
          <div className="row">
            <b>{snap.manifest.name}</b>
            {owner && (
              <button
                className="btn small flat"
                disabled={working || !online}
                title={net('Renaming') ?? 'Rename the Project'}
                onClick={() =>
                  void run(async () => {
                    const name = await askText('Rename Project', snap.manifest.name, { label: 'Name', confirm: 'Rename' });
                    if (name?.trim()) await project.rename(name);
                  })
                }
              >
                Rename…
              </button>
            )}
          </div>

          <fieldset>
            <legend>Folders and files</legend>
            <div className="row">
              <button className="btn small" disabled={working || !can} title={net('Adding a folder')} onClick={() => void newFolder(null)}>
                + Folder
              </button>
              <button className="btn small" disabled={working || !can} title={net('Adding files')} onClick={() => pickFiles(null)}>
                Add PDFs…
              </button>
            </div>
            {rows.length === 0 && <p className="hint">Nothing here yet.</p>}
            <ul className="plain-list manage-list">
              {rows.map((r) => {
                if (r.kind === 'folder') {
                  const f = r.folder;
                  const exclude = [f.id, ...descendantFolders(snap.folders, f.id).map((x) => x.id)];
                  return (
                    <li key={`d${f.id}`} style={{ paddingLeft: r.depth * 16 }}>
                      <span className="name">
                        <span aria-hidden="true">📁</span> <b>{f.name}</b>
                      </span>
                      <button className="btn small flat" disabled={working || !can} onClick={() => void newFolder(f.id)} title="Make a folder inside this one">
                        + Folder
                      </button>
                      <button className="btn small flat" disabled={working || !can} onClick={() => pickFiles(f.id)} title="Add PDFs to this folder">
                        Add PDFs…
                      </button>
                      <button
                        className="btn small flat"
                        disabled={working || !can}
                        onClick={() =>
                          void run(async () => {
                            const name = await askText('Rename folder', f.name, { label: 'Name', confirm: 'Rename' });
                            if (name?.trim()) await project.renameFolder(f.id, name);
                          })
                        }
                      >
                        Rename…
                      </button>
                      <select
                        value=""
                        aria-label={`Move ${f.name} to`}
                        disabled={working || !can}
                        onChange={(e) => {
                          const to = e.target.value;
                          if (to) void run(() => project.moveFolder(f.id, to === TOP ? null : to));
                        }}
                      >
                        <option value="">Move to…</option>
                        <MoveOptions folders={snap.folders} exclude={exclude} />
                      </select>
                      <button
                        className="btn small flat danger"
                        disabled={working || !can}
                        onClick={() => {
                          const { folders: nf, files: nfiles } = project.contentsOf(f.id);
                          const inside = nf || nfiles ? ` It holds ${nfiles} file${nfiles === 1 ? '' : 's'} and ${nf} folder${nf === 1 ? '' : 's'}, which go with it.` : '';
                          if (window.confirm(`Delete the folder ${f.name}?${inside} Their revisions stay in the OneDrive folder.`)) void run(() => project.deleteFolder(f.id));
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  );
                }
                const f = r.file;
                const last = f.revisions[f.revisions.length - 1]!;
                const theirs = !!f.checkout && !project.heldByMe(f);
                return (
                  <li key={`f${f.id}`} style={{ paddingLeft: r.depth * 16 }}>
                    <span className="name" title={`Rev ${last.n} · ${size(last.size)} · ${last.by}, ${when(last.at)}`}>
                      {f.name} <span className="status">Rev {last.n}</span>
                      {f.checkout && <span className="status checked-out">{project.heldByMe(f) ? 'Out: you' : `Out: ${f.checkout.by}`}</span>}
                    </span>
                    <button
                      className="btn small flat"
                      disabled={working || !can || theirs}
                      title={theirs ? `${f.checkout!.by} has it checked out` : undefined}
                      onClick={() =>
                        void run(async () => {
                          const name = await askText('Rename file', f.name, { label: 'Name', confirm: 'Rename' });
                          if (name?.trim()) await project.renameFile(f.id, name);
                        })
                      }
                    >
                      Rename…
                    </button>
                    <select
                      value=""
                      aria-label={`Move ${f.name} to`}
                      disabled={working || !can || theirs}
                      onChange={(e) => {
                        const to = e.target.value;
                        if (to) void run(() => project.moveFile(f.id, to === TOP ? null : to));
                      }}
                    >
                      <option value="">Move to…</option>
                      {f.folderId !== null && <option value={TOP}>Top of the Project</option>}
                      <MoveOptions folders={snap.folders} exclude={f.folderId ? [f.folderId] : []} top={false} />
                    </select>
                    <button
                      className="btn small flat danger"
                      disabled={working || !can || !!f.checkout}
                      title={f.checkout ? 'Undo the check-out first' : undefined}
                      onClick={() => {
                        if (window.confirm(`Delete ${f.name}? Its ${f.revisions.length} revision${f.revisions.length === 1 ? '' : 's'} stay in the OneDrive folder.`)) void run(() => project.deleteFile(f.id));
                      }}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
            <input
              ref={addRef}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = '';
                if (picked.length) onAddFiles(addTo.current, picked);
              }}
            />
            {upload && (
              <div className="upload-progress" role="status" aria-live="polite">
                <b>
                  Uploading {Math.min(upload.done + 1, upload.total)} of {upload.total}
                </b>
                <span className="hint-text">{upload.name}</span>
                <progress max={upload.total} value={upload.done} aria-label="Upload progress" />
                <span className="hint-text">You can keep working while this uploads. Just don&apos;t close the app.</span>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>Sharing</legend>
            <div className="row">
              <button className="btn small" onClick={() => void navigator.clipboard.writeText(projectInviteLink(project.id))} title="Copy a link that opens the app and this Project">
                Copy invite link
              </button>
              {url && (
                <a className="btn small" href={url} target="_blank" rel="noreferrer" title="Open the Project folder in OneDrive">
                  Open in OneDrive
                </a>
              )}
            </div>
            {owner ? <Members project={project} online={online} /> : <p className="hint-text">The owner, {snap.manifest.owner}, manages who has access.</p>}
          </fieldset>
          {error && (
            <p className="session-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
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
