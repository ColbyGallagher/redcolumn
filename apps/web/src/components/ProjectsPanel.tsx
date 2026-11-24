import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { DrivePermission } from '../studio/drive/DriveApi';
import { microsoftUser, subscribeMicrosoftUser, urlFromShareId } from '../studio/drive/onedrive';
import { forgetProject, knownProjects, restoreProject, libraryCopyOf, linkOf, projectInviteLink } from '../studio/projects/local';
import { descendantFolders, folderPath, type ProjectFile, type ProjectFolder } from '../studio/projects/model';
import type { Project } from '../studio/projects/Project';
import { copyState, describeQueued, isUnreachable, noteText, projectQueue } from '../studio/projects/queue';
import { desktop } from '../desktop/host';
import { isLocalFolderId } from '../studio/drive/folder';
import { closeProject, createLocalProject, createProject, localFoldersAvailable, openLocalProject, openProject, openProjects, projectById, projectView, projectsVersion, setProjectView, subscribeProjects } from '../studio/projects/store';
import { askText } from './AskText';
import { Dialog } from './sessions/SessionDialogs';
import { StudioHelp } from './studio/StudioHelp';
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
  /** Shows every comment and reply across the Project's files in one table. */
  onShowComments: (project: Project) => void;
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
  useEffect(() => setSlot(document.getElementById('rc-project-slot')), []);
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
  const why = !oneDriveAvailable ? msg('OneDrive sharing is turned off.') : !online ? offlineReason(msg('Projects')) : undefined;

  /** `local`: a folder on this computer that a sync client shares, instead of OneDrive. */
  const make = (local = false) =>
    run(async () => {
      const name = await askText(msg('New Project'), '', { label: msg('Project name'), confirm: msg('Next') });
      if (!name?.trim()) return;
      const kind = await askText(msg('New Project'), 'plain', {
        label: msg('Encrypt the Project end to end?'),
        confirm: local ? msg('Choose folder…') : msg('Create'),
        choices: [
          { value: 'plain', label: local ? msg('Not encrypted: the PDFs also open in other apps') : msg('Not encrypted: the PDFs also open in OneDrive itself') },
          { value: 'encrypted', label: local ? msg('Encrypted: the sync service stores only scrambled files. The key is in the Project link; PDFs open only in redcolumn, and a lost link cannot be recovered') : msg('Encrypted: OneDrive stores only scrambled files. The key is in the Project link; PDFs open only in redcolumn, and a lost link cannot be recovered') },
        ],
      });
      if (!kind) return;
      if (local) await createLocalProject(name, me, kind === 'encrypted');
      else await createProject(name, me, kind === 'encrypted');
    });
  const join = () =>
    run(async () => {
      const link = await askText(msg('Open a Project'), '', { label: msg('Paste the Project link or its OneDrive folder link'), confirm: msg('Open') });
      if (link?.trim()) await openProject(link, me, true);
    });

  return (
    <div className="sessions rc-studio projects">
      <StudioHeader
        title={msg('All Projects')}
        onRefresh={() => setRefresh((n) => n + 1)}
        plus={
          <StudioMenu
            label={msg('New project')}
            items={[
              ...(oneDriveAvailable
                ? [
                    { label: msg('New project'), onClick: () => void make(), disabled: blocked },
                    { label: msg('Open from link…'), onClick: () => void join(), disabled: blocked },
                  ]
                : []),
              // A folder this computer syncs (OneDrive, Dropbox, a file server): no sign-in, works offline.
              ...(localFoldersAvailable()
                ? [
                    { label: msg('New project in a folder on this computer…'), onClick: () => void make(true), disabled: busy },
                    { label: msg('Open a project folder on this computer…'), onClick: () => void run(() => openLocalProject(me)), disabled: busy },
                  ]
                : []),
            ]}
          />
        }
        filter={<FilterButton sort={sort} desc={sortDesc} onChange={(next, desc) => { setSort(next); setSortDesc(desc); }} />}
      />
      <StudioTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'joined', label: msg('Joined') },
          { id: 'not', label: msg('Not Joined'), count: notJoinedCount },
        ]}
      />
      <StudioHelp id="projects" title={msg('How projects work')}>
        <p>
          {keyed(msgParts('{b} They are never uploaded to a redcolumn server or database, because redcolumn does not have one. This app opens and saves the files directly in the OneDrive folder, from your device.', { b: <b>{msg('Your PDFs stay in your own OneDrive.')}</b> }))}
        </p>
        <p>{msg('A project is a shared folder of PDFs for a team, such as all the drawings for one job. Everyone with access sees the same files and the same markups, and the project remembers every version of each file.')}</p>
        <h4>{msg('Where it lives')}</h4>
        <p>{msg('Projects are stored in a OneDrive folder, or in a folder on your computer that a sync app (OneDrive, Dropbox or a company file server) shares. Either way, the files stay in storage you control.')}</p>
        <h4>{msg('Accounts you need')}</h4>
        <ul>
          <li>{msg('A Microsoft account (personal, work or school) for a OneDrive project. Opening a project link signs you in.')}</li>
          <li>{msg('No account is needed for a project in a folder on your computer. The desktop app can open these. Your sync app does the sharing.')}</li>
          <li>{msg('The project owner decides who can edit and who can only view. OneDrive enforces this, so it cannot be bypassed from inside redcolumn.')}</li>
        </ul>
        <h4>{msg('What the app can reach')}</h4>
        <ul>
          <li>{msg('The project folder, and nothing else you own. It asks your permission before it needs more, such as sharing the folder.')}</li>
          <li>{msg('Your name and email, so versions, notes and markups show who did them.')}</li>
          <li>{msg('You can choose to encrypt a project when you create it. The files are then scrambled in OneDrive and open only in redcolumn. The key is in the project link, so keep that link safe: a lost link cannot be recovered.')}</li>
        </ul>
        <h4>{msg('Working on files')}</h4>
        <ul>
          <li>{msg('Double-click a PDF to open it. Markups are shared live and need no check-out.')}</li>
          <li>{msg('Check Out reserves a PDF so only you can replace it with a new version. Check In uploads your version, and the old ones stay available under Revisions.')}</li>
        </ul>
      </StudioHelp>
      {selectedId && !showFiles && (
        <button type="button" className="rc-text-btn" style={{ margin: '0 10px 6px' }} onClick={onShowFiles}>
          {msg('Show files')}
        </button>
      )}
      <div className="rc-scroll">
        {error && (
          <p className="session-error" role="alert">
            {error}
          </p>
        )}
        {invite && (
          <div className="session-invite">
            <b>{msg('You\'re invited to a Project.')}</b>
            <p>{msg('Opening it signs you in to Microsoft (a personal, work or school account).')}</p>
            <div className="row">
              <button className="btn primary" disabled={blocked} onClick={() => void run(() => openProject(invite, me, true).then(onDismissInvite))}>
                {msg('Open Project')}
              </button>
              <button className="btn small flat" onClick={onDismissInvite}>
                {msg('Not now')}
              </button>
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="rc-empty">{rows.length === 0 && why && !localFoldersAvailable() ? why : tab === 'joined' ? msg('Projects you have open are listed here.') : msg('Projects you have not opened are listed here.')}</p>
        ) : (
          <ul className="rc-list">
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
                  disabled={!!r.removed || (!r.open && (isLocalFolderId(r.id) ? busy : blocked))}
                  title={r.open || isLocalFolderId(r.id) ? name : (why ?? name)}
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
                        className="rc-join"
                        onClick={() => {
                          restoreProject(r.id);
                          setRefresh((n) => n + 1);
                        }}
                      >
                        {msg('Restore')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rc-x"
                        title={msg('Remove from your projects. The project is not deleted.')}
                        aria-label={msg('Remove from list')}
                        onClick={() => {
                          if (!confirm(msg('Remove {name} from your Projects? The Project is not deleted, and you can restore it from Not Joined.', { name }))) return;
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

function ProjectView({ project, me, localDocName, onOpenFile, onAddFiles, onAddCurrent, onCheckIn, onSendQueued, onShowComments, onOpened }: Props & { project: Project; onOpened: () => void }) {
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
  const uploadStatus = upload ? msg('Uploading {number} of {total}: {name}', { number: Math.min(upload.done + 1, upload.total), total: upload.total, name: upload.name }) : queued.length ? msg('{count} waiting to send', { count: queued.length }) : msg('Up to date');
  const bytes = snap.files.reduce((sum, f) => sum + (f.revisions[f.revisions.length - 1]?.size ?? 0), 0);

  return (
    <div className="rc-project-stage">
      <header className="rc-project-bar">
        <span className="name">{snap.manifest.name}</span>
        <span className="meta" title={project.id}>
          {msg('ID: {studioIdText}', { studioIdText: studioIdText(project.id) })}
        </span>
        <span className="meta">{msg('Owner: {owner}', { owner: snap.manifest.owner })}</span>
        <span className="meta">{msg('Created: {date}', { date: new Date(snap.manifest.createdAt).toLocaleString() })}</span>
        <span className="meta">{msg('Upload status: {uploadStatus}', { uploadStatus })}</span>
        <span className="spacer" />
        <button type="button" className="rc-linkish" disabled={busy || !online} title={net(msg('Refreshing')) ?? msg('Check OneDrive for changes now')} onClick={() => void run(() => project.poll())}>
          {msg('Refresh')}
        </button>
        <button type="button" className="rc-linkish" disabled={!snap.files.length} title={msg('Every comment and reply on the Project\'s files, in one table')} onClick={() => onShowComments(project)}>
          {msg('Comments')}
        </button>
        <button type="button" className="rc-linkish" onClick={() => setManaging(true)}>
          {msg('Settings')}
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
            {msg('Uploading {count} of {total}', { count: Math.min(upload.done + 1, upload.total), total: upload.total })}
          </b>
          <span className="hint-text">{upload.name}</span>
          <progress max={upload.total} value={upload.done} aria-label={msg('Upload progress')} />
        </div>
      )}
      <div className="rc-project-panes">
        <aside className="rc-tree" aria-label={msg('Project files')}>
          <div className="rc-tree-scroll">
            <button type="button" className={current === null && !selected ? 'rc-tree-row on' : 'rc-tree-row'} onClick={() => go(null)}>
              <FolderIcon />
              <span className="rc-name">{snap.manifest.name}</span>
            </button>
            {nodes.map((node) => (
              <button
                key={`${node.kind}-${node.id}`}
                type="button"
                className={(node.kind === 'file' ? selected === node.id : current === node.id) ? 'rc-tree-row on' : 'rc-tree-row'}
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
                <span className="rc-name">{node.name}</span>
              </button>
            ))}
          </div>
          {(queued.length > 0 || snap.record.length > 0) && (
            <div className="rc-pending">
              {queued.length > 0 && (
                <>
                  <h3>{msg('Pending')}</h3>
                  <ul className="rc-people">
                    {queued.map((c) => (
                      <li key={c.id} className="rc-person">
                        <span className="rc-name">
                          {describeQueued(c)}
                          {c.error ? ` — ${c.error}` : ''}
                        </span>
                        {c.error && (
                          <button type="button" className="rc-mini" onClick={() => projectQueue().retry(c.id)}>
                            {msg('Retry')}
                          </button>
                        )}
                        <button type="button" className="rc-mini" onClick={() => projectQueue().discard(c.id)}>
                          {msg('Discard')}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="rc-linkish" disabled={!online} onClick={onSendQueued}>
                    {msg('Send now')}
                  </button>
                </>
              )}
              {snap.record.length > 0 && (
                <details>
                  <summary className="rc-group">{msg('Record ({count})', { count: snap.record.length })}</summary>
                  <ul className="rc-people">
                    {[...snap.record].reverse().map((e) => (
                      <li key={e.id} className="rc-person">
                        <span className="rc-name">
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
        <section className="rc-thumbs">
          <div className="rc-stage-tools">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={msg('Search with a keyword')} aria-label={msg('Search files')} />
            <StudioMenu
              label={msg('Add')}
              icon={<span>{msg('Add')}</span>}
              items={[
                { label: msg('Add PDFs…'), onClick: () => fileInput.current?.click(), disabled: busy || !!upload || !writable },
                { label: localDocName ? msg('Add {localDocName}', { localDocName }) : msg('Add open document'), onClick: () => void uploading((p) => onAddCurrent(project, current, p)), disabled: busy || !!upload || !writable || !localDocName },
                {
                  label: msg('New folder'),
                  disabled: busy || !writable,
                  onClick: () =>
                    void run(async () => {
                      const name = await askText(msg('New folder'), '', { label: msg('Folder name'), confirm: msg('Create') });
                      if (name?.trim()) await project.addFolder(name, current);
                    }),
                },
              ]}
            />
            <button type="button" className="rc-linkish" aria-expanded={actionsOpen} onClick={() => setActionsOpen((v) => !v)}>
              {msg('Actions')}
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
          <div className="rc-path">{[snap.manifest.name, ...crumbs.map((c) => c.name)].join(' / ')}</div>
          {actionsOpen && (
            <div className="rc-actions-pop">
              {sel ? (
                <FileActions project={project} file={sel} busy={busy} online={online} run={run} onOpenFile={async (p, file, rev) => openFile(file, rev)} onCheckIn={onCheckIn} queuedCheckIn={queued.some((c) => c.kind === 'checkin' && c.fileId === sel.id)} />
              ) : (
                <p className="rc-empty">{msg('Select a file to check it out, rename it, or open it.')}</p>
              )}
              {current && (
                <div className="row">
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy || !writable}
                    onClick={() =>
                      void run(async () => {
                        const name = await askText(msg('Rename folder'), crumbs[crumbs.length - 1]?.name ?? '', { label: msg('Name'), confirm: msg('Rename') });
                        if (name?.trim()) await project.renameFolder(current, name);
                      })
                    }
                  >
                    {msg('Rename folder…')}
                  </button>
                  <select
                    value=""
                    aria-label={msg('Move folder to')}
                    disabled={busy || !writable}
                    onChange={(e) => {
                      const to = e.target.value;
                      if (to) void run(() => project.moveFolder(current, to === TOP ? null : to));
                    }}
                  >
                    <option value="">{msg('Move folder to…')}</option>
                    <MoveOptions folders={snap.folders} exclude={[current, ...descendantFolders(snap.folders, current).map((f) => f.id)]} />
                  </select>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy || !writable}
                    onClick={() => {
                      const { folders: nf, files: nfiles } = project.contentsOf(current);
                      const name = crumbs[crumbs.length - 1]?.name;
                      const question = nf || nfiles
                        ? msg('Delete the folder {name}? It holds {files, plural, one {# file} other {# files}} and {folders, plural, one {# folder} other {# folders}}.', { name, files: nfiles, folders: nf })
                        : msg('Delete the folder {name}?', { name });
                      if (window.confirm(question)) {
                        const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2]!.id : null;
                        void run(async () => {
                          await project.deleteFolder(current);
                          go(parent);
                        });
                      }
                    }}
                  >
                    {msg('Delete folder')}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="rc-thumb-grid">
            {gridFolders.map((f) => (
              <button key={f.id} type="button" className={current === f.id ? 'rc-tile on' : 'rc-tile'} onClick={() => go(f.id)} onDoubleClick={() => go(f.id)}>
                <span className="rc-tile-face folder">
                  <FolderIcon />
                </span>
                <span className="rc-tile-name">{f.name}</span>
              </button>
            ))}
            {gridFiles.map((f) => {
              const kind = tileKind(f.name);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={selected === f.id ? 'rc-tile on' : 'rc-tile'}
                  aria-busy={opening === f.id}
                  onClick={() => setSelected(f.id)}
                  onDoubleClick={() => {
                    setOpening(f.id);
                    void run(() => openFile(f)).finally(() => setOpening(null));
                  }}
                >
                  <span className={`rc-tile-face ${kind}`}>{tileLabel(kind)}</span>
                  <span className="rc-tile-name">{f.name}</span>
                </button>
              );
            })}
            {gridFolders.length === 0 && gridFiles.length === 0 && <p className="rc-empty">{q ? msg('No files match.') : current ? msg('This folder is empty.') : msg('No files yet.')}</p>}
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
    <Dialog title={msg('Project Settings')} className="wide rc-light" onClose={onClose}>
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
              ['general', msg('General')],
              ['access', msg('User Access')],
              ['permissions', msg('Permissions')],
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
              <dl className="rc-set-grid">
                <dt>{msg('Project Name')}</dt>
                <dd>
                  <input aria-label={msg('Project Name')} value={name} readOnly={!owner} onChange={(e) => setName(e.target.value)} maxLength={200} />
                </dd>
                <dt>{msg('Project ID')}</dt>
                <dd>
                  <input aria-label={msg('Project ID')} value={studioIdText(project.id)} readOnly />
                </dd>
                <dt>{msg('Total Users')}</dt>
                <dd>{users}</dd>
                <dt>{msg('Total Files')}</dt>
                <dd>{snap.files.length}</dd>
                <dt>{msg('Total Folders')}</dt>
                <dd>{snap.folders.length}</dd>
                <dt>{msg('Created On')}</dt>
                <dd>{new Date(snap.manifest.createdAt).toLocaleString()}</dd>
                <dt>{msg('Project Size')}</dt>
                <dd>{space}</dd>
              </dl>
              <div className="rc-set-links">
                {isLocalFolderId(project.id) ? (
                  // Shared by the sync client: people open the synced folder with "Open a project folder on this computer…".
                  <button type="button" className="rc-set-link" title={msg('Share this folder from the app that syncs it (OneDrive, Dropbox…)')} onClick={() => void desktop()?.folder.show(project.id)}>
                    {msg('Show folder')}
                  </button>
                ) : (
                <button
                  type="button"
                  className="rc-set-link"
                  onClick={() =>
                    void navigator.clipboard.writeText(projectInviteLink(project.id)).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? msg('Link copied') : msg('Copy invite link')}
                </button>
                )}
                {url && (
                  <a className="rc-set-link" href={url} target="_blank" rel="noreferrer">
                    {msg('Open in OneDrive')}
                  </a>
                )}
              </div>
              <p className="hint">{msg('You are {me}.', { me })}</p>
            </>
          )}
          {tab === 'access' && (owner ? <Members project={project} online={online} /> : <p className="hint">{msg('The owner, {owner}, manages who has access.', { owner: snap.manifest.owner })}</p>)}
          {tab === 'permissions' && (
            <p className="hint">
              {project.level === 'owner' ? msg('You are the owner of this project.') : project.level === 'viewer' ? msg('You are a viewer of this project.') : msg('You are an editor of this project.')}{' '}
              {project.canWrite ? msg('You can add and change files.') : msg('You can open files, not change them.')}{' '}
              {msg('OneDrive enforces this. Folder access follows the project folder.')}
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
            {msg('OK')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {msg('Cancel')}
          </button>
          <button type="button" className="btn primary" disabled={busy || (!online && owner && name.trim() !== snap.manifest.name)} onClick={() => save(false)}>
            {msg('Apply')}
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
        {state.kind === 'none' && msg('Not on this device yet.')}
        {state.kind === 'current' && msg('Your copy is revision {rev}, the latest.', { rev: state.rev })}
        {state.kind === 'stale' && msg('Your copy is revision {rev}; the Project has revision {latest}.', { rev: state.rev, latest: state.latest })}
        {' '}
        {msg('Markups are shared live with everyone who has it open.')}
        {file.checkout?.note ? ' ' + msg('Checked out for: {note}', { note: file.checkout.note }) : ''}
      </p>
      <Viewers project={project} fileId={file.id} />
      <div className="row">
        <button
          className="btn small primary"
          disabled={busy || (!online && !copy)}
          title={!online && !copy ? msg('This file is not on this device. Open it once online to keep a copy.') : msg('Open this file')}
          onClick={() => void run(() => onOpenFile(project, file))}
        >
          {msg('Open')}
        </button>
        {!file.checkout && (
          <button
            className="btn small"
            disabled={busy || !online || !canWrite}
            title={net(msg('Checking out')) ?? msg('Reserve the PDF to replace it with a new revision. Markups need no check-out: they are shared live.')}
            onClick={() =>
              void run(async () => {
                await project.checkOut(file.id);
                // Opened too, so the changes are made on the latest revision.
                await onOpenFile(project, file);
              })
            }
          >
            {msg('Check Out')}
          </button>
        )}
        {mine && (
          <>
            <button
              className="btn small primary"
              disabled={busy || !copy || queuedCheckIn}
              title={queuedCheckIn ? msg('Already waiting to be sent') : copy ? (online ? msg('Upload your copy of the PDF as a new revision (markups are shared live, so they need no check-in)') : msg('Queue your copy to be checked in when OneDrive can be reached')) : msg('Open it first, then make your changes')}
              onClick={() =>
                void run(async () => {
                  const comment = await askText(msg('Check In {name}', { name: file.name }), '', { label: msg('Comment'), confirm: online ? msg('Check In') : msg('Queue Check In') });
                  if (comment !== null) await onCheckIn(project, file, comment);
                })
              }
            >
              {msg('Check In…')}
            </button>
            <button className="btn small" disabled={busy || !online} title={net(msg('Undoing a check-out')) ?? msg('Give up the check-out without checking in')} onClick={() => void run(() => project.undoCheckOut(file.id))}>
              {msg('Undo Check Out')}
            </button>
          </>
        )}
        {canRelease && (
          <button
            className="btn small"
            disabled={busy || !online}
            title={msg('Release {by}’s check-out (their changes are not checked in)', { by: file.checkout!.by })}
            onClick={() => {
              if (window.confirm(msg('Release {by}’s check-out of {name}? Anything they have not checked in is not kept.', { by: file.checkout!.by, name: file.name }))) void run(() => project.undoCheckOut(file.id, true));
            }}
          >
            {msg('Release Check Out')}
          </button>
        )}
        <button className="btn small" aria-expanded={revs} onClick={() => setRevs((v) => !v)}>
          {msg('Revisions ({count})', { count: file.revisions.length })}
        </button>
        <button
          className="btn small"
          disabled={busy || !canWrite}
          title={msg('Add a note about this file to the Project Record')}
          onClick={() =>
            void run(async () => {
              const text = await askText(msg('Note on {name}', { name: file.name }), '', { label: msg('Note'), confirm: msg('Add Note') });
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
          {msg('Add Note…')}
        </button>
      </div>
      <div className="row">
        <button
          className="btn small flat"
          disabled={busy || !online || !canWrite || theirs}
          title={theirs ? msg('{by} has it checked out', { by: file.checkout!.by }) : msg('Rename this file')}
          onClick={() =>
            void run(async () => {
              const name = await askText(msg('Rename file'), file.name, { label: msg('Name'), confirm: msg('Rename') });
              if (name?.trim()) await project.renameFile(file.id, name);
            })
          }
        >
          {msg('Rename…')}
        </button>
        <select
          value=""
          aria-label={msg('Move file to')}
          disabled={busy || !online || !canWrite || theirs}
          onChange={(e) => {
            const to = e.target.value;
            if (to) void run(() => project.moveFile(file.id, to === TOP ? null : to));
          }}
        >
          <option value="">{msg('Move to…')}</option>
          {file.folderId !== null && <option value={TOP}>{msg('Top of the Project')}</option>}
          <MoveOptions folders={project.getSnapshot().folders} exclude={file.folderId ? [file.folderId] : []} top={false} />
        </select>
        <button
          className="btn small flat danger"
          disabled={busy || !online || !canWrite || !!file.checkout}
          title={file.checkout ? msg('Undo the check-out first') : msg('Remove this file from the Project')}
          onClick={() => {
            if (window.confirm(msg('Delete {name}? {count, plural, one {Its # revision stays} other {Its # revisions stay}} in the OneDrive folder.', { name: file.name, count: file.revisions.length }))) void run(() => project.deleteFile(file.id));
          }}
        >
          {msg('Delete')}
        </button>
      </div>
      {revs && (
        <ul className="plain-list">
          {[...file.revisions].reverse().map((r) => (
            <li key={r.n}>
              <b>{msg('Rev {number}', { number: r.n })}</b> · {r.by}, {new Date(r.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · {size(r.size)}
              {r.comment ? ` · ${r.comment}` : ''}{' '}
              {r.n !== last.n && (
                <>
                  <button className="btn small flat" disabled={busy || !online} title={net(msg('Opening')) ?? msg('Open this revision on its own')} onClick={() => void run(() => onOpenFile(project, file, r.n))}>
                    {msg('Open')}
                  </button>
                  <button
                    className="btn small flat"
                    disabled={busy || !online || !canWrite || theirs}
                    title={theirs ? msg('{by} has it checked out', { by: file.checkout!.by }) : msg('Make this revision the newest again, as a new revision')}
                    onClick={() => void run(() => project.restore(file.id, r.n))}
                  >
                    {msg('Restore')}
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
      {keyed(msgParts('Viewing now: {viewers}', { viewers: others.map((p, i) => (
        <span key={p.seat}>
          {i > 0 && ', '}
          <i style={{ background: p.color }} aria-hidden="true" />
          <b>{p.name}</b>
          {p.page != null && <span className="hint-text"> {msg('(page {page})', { page: p.page + 1 })}</span>}
        </span>
      )) }))}
    </p>
  );
}

const TOP = '__top';

/** Folders to choose from, with their paths, leaving out `exclude` (where it already is, or inside itself). */
function MoveOptions({ folders, exclude, top = true }: { folders: ProjectFolder[]; exclude: string[]; top?: boolean }) {
  return (
    <>
      {top && <option value={TOP}>{msg('Top of the Project')}</option>}
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
  { value: 'editor', get label() { return msg('Can edit: open, check out and in, add and change files'); } },
  { value: 'viewer', get label() { return msg('Can view: open and read only'); } },
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
  const net = online ? undefined : offlineReason(msg('Changing who has access'));

  return (
    <>
      <h3>
        {keyed(msgParts('People{button}', { button: <button className="btn small flat" disabled={busy || !online} title={net ?? msg('Share the folder with someone by email')} onClick={() => void act(async () => { const email = await askText(msg('Invite to the Project'), '', { label: msg('Their Microsoft account email'), confirm: msg('Next') }); if (!email?.trim()) return; const level = await askText(msg('What can they do?'), 'editor', { choices: LEVEL_CHOICES, confirm: msg('Invite') }); if (level) await project.invite(email, level === 'viewer' ? 'viewer' : 'editor'); }) } > {msg('Invite…')} </button> }))}
      </h3>
      {(error || loadError) && <p className="session-error">{error ?? loadError}</p>}
      {people && (
        <ul className="plain-list project-people">
          {people.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>
              {p.email && p.email !== p.name && <span className="hint-text"> {p.email}</span>}{' '}
              {p.role === 'owner' ? (
                <span className="status">{msg('Owner')}</span>
              ) : (
                <>
                  <select
                    aria-label={msg('What {name} can do', { name: p.name })}
                    value={p.role === 'reader' ? 'viewer' : 'editor'}
                    disabled={busy || !online || p.inherited}
                    title={p.inherited ? msg('Set on a folder above, so it cannot be changed here') : undefined}
                    onChange={(e) => void act(() => project.setLevel(p.id, e.target.value === 'viewer' ? 'viewer' : 'editor'))}
                  >
                    <option value="editor">{msg('Can edit')}</option>
                    <option value="viewer">{msg('Can view')}</option>
                  </select>
                  <button
                    className="btn small flat danger"
                    disabled={busy || !online || p.inherited}
                    title={p.kind === 'link' ? msg('Turn this link off') : msg('Stop sharing with {name}', { name: p.name })}
                    aria-label={p.kind === 'link' ? msg('Turn this link off') : msg('Remove {name}', { name: p.name })}
                    onClick={() => {
                      if (window.confirm(p.kind === 'link' ? msg('Turn off this link? People who only have the link lose access.') : msg('Stop sharing the Project with {name}?', { name: p.name }))) void act(() => project.removeMember(p.id));
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
      {!people && !loadError && <p className="hint-text">{msg('Loading…')}</p>}
    </>
  );
}
