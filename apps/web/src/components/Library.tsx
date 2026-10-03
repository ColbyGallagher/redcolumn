import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { drawingSets } from '../storage/sets';
import { fileGroups, useFileGroups, type FileGroup } from '../storage/fileGroups';
import type { StoredFile } from '../storage/fileStore';
import { InlineName } from './InlineName';
import { ContextMenu, type ContextMenuState, type MenuEntry } from './ContextMenu';

interface Props {
  files: StoredFile[];
  activeHash: string | null;
  onOpen: (file: StoredFile) => void;
  onRemove: (file: StoredFile) => void;
  /**
   * The right-click menu for a file; `groupEntries` are the File Access group actions to include.
   * Without it a basic menu is shown.
   */
  fileMenu?: (file: StoredFile, groupEntries: MenuEntry[]) => MenuEntry[];
  /** A file to scroll to and flash (a tab's Show in File Access). */
  reveal?: { id: string; token: number } | null;
}

const DRAG_TYPE = 'application/x-nb-file';

function formatSize(bytes: number) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/**
 * File Access: documents stored on this device (available offline), as Recents plus the user's
 * own groups for quick access. Drag a file onto a group, or right-click it.
 */
export function Library({ files, activeHash, onOpen, onRemove, fileMenu: appMenu, reveal }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reveal) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(reveal.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, [reveal]);
  const groups = useFileGroups();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [naming, setNaming] = useState<{ id: string | 'new'; fileId?: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [query, setQuery] = useState('');
  const closeMenu = useCallback(() => setMenu(null), []);

  const byId = new Map(files.map((f) => [f.id, f]));
  const q = query.trim().toLowerCase();
  const matches = (f: StoredFile) => !q || f.name.toLowerCase().includes(q);

  const confirmRemove = (f: StoredFile) => {
    if (!confirm(`Remove "${f.name}" from this device? Its markups are kept and return if you open it again.`)) return;
    fileGroups.forget(f.id);
    drawingSets.forget(f.id);
    onRemove(f);
  };

  const fileMenu = (e: ReactMouseEvent, f: StoredFile, group?: FileGroup) => {
    e.preventDefault();
    const addTo: MenuEntry[] = [
      ...groups.map((g) => ({ label: g.name, checked: g.fileIds.includes(f.id), disabled: g.fileIds.includes(f.id), onClick: () => fileGroups.add(g.id, f.id) })),
      ...(groups.length ? [{ sep: true } as const] : []),
      { label: 'New Group…', onClick: () => setNaming({ id: 'new', fileId: f.id }) },
    ];
    const groupEntries: MenuEntry[] = [
      { label: 'Add to Group', items: addTo },
      ...(group ? [{ label: `Remove from "${group.name}"`, onClick: () => fileGroups.removeFile(group.id, f.id) }] : []),
    ];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: appMenu
        ? appMenu(f, groupEntries)
        : [{ label: 'Open', onClick: () => onOpen(f) }, { sep: true }, ...groupEntries, { sep: true }, { label: 'Remove from Device…', danger: true, onClick: () => confirmRemove(f) }],
    });
  };

  const groupMenu = (e: ReactMouseEvent, g: FileGroup, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    const members = g.fileIds.map((id) => byId.get(id)).filter((f): f is StoredFile => !!f);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: `Open All (${members.length})`, disabled: !members.length, onClick: () => members.forEach(onOpen) },
        { sep: true },
        { label: 'Rename', onClick: () => setNaming({ id: g.id }) },
        { label: 'Move Up', disabled: i === 0, onClick: () => fileGroups.move(g.id, -1) },
        { label: 'Move Down', disabled: i === groups.length - 1, onClick: () => fileGroups.move(g.id, 1) },
        { sep: true },
        {
          label: 'Delete Group',
          danger: true,
          onClick: () => {
            if (confirm(`Delete the group "${g.name}"? The documents stay on this device.`)) fileGroups.remove(g.id);
          },
        },
      ],
    });
  };

  const dropProps = (target: string, onDrop: (fileId: string) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropOn(target);
    },
    onDragLeave: () => setDropOn((d) => (d === target ? null : d)),
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      setDropOn(null);
      if (id) {
        e.preventDefault();
        onDrop(id);
      }
    },
  });

  const row = (f: StoredFile, group?: FileGroup) => (
    <li
      key={f.id}
      data-id={f.id}
      className={f.hash === activeHash ? 'active' : ''}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, f.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onContextMenu={(e) => fileMenu(e, f, group)}
    >
      <button className="file" onClick={() => onOpen(f)} title={f.name}>
        <span className="file-icon" aria-hidden="true">
          PDF
        </span>
        <span className="file-text">
          <span className="name">{f.name}</span>
          <span className="meta">
            {formatSize(f.size)} · {new Date(f.lastOpenedAt).toLocaleDateString()}
          </span>
        </span>
      </button>
      <button className="icon" title="More…" onClick={(e) => fileMenu(e, f, group)}>
        ⋯
      </button>
    </li>
  );

  const finishNaming = (name: string | null) => {
    const n = naming;
    setNaming(null);
    if (!n || !name) return;
    if (n.id === 'new') fileGroups.create(name, n.fileId ? [n.fileId] : []);
    else fileGroups.rename(n.id, name);
  };

  const recents = files.filter(matches);

  return (
    <div className="library" ref={root}>
      <div className="library-tools">
        <input className="library-search" type="search" placeholder="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter files" />
        <button className="btn small" title="Create a group for quick access to a set of files" onClick={() => setNaming({ id: 'new' })}>
          + Group
        </button>
      </div>

      {groups.map((g, i) => {
        const members = g.fileIds.map((id) => byId.get(id)).filter((f): f is StoredFile => !!f);
        const shown = members.filter(matches);
        return (
          <section key={g.id} className={`file-group${dropOn === g.id ? ' drop' : ''}`} {...dropProps(g.id, (id) => fileGroups.add(g.id, id))}>
            {naming?.id === g.id ? (
              <div className="group-head">
                <InlineName initial={g.name} placeholder="Group name" onDone={finishNaming} />
              </div>
            ) : (
              <div className="group-head" onContextMenu={(e) => groupMenu(e, g, i)}>
                <button className="group-toggle" aria-expanded={!g.collapsed} onClick={() => fileGroups.toggle(g.id)}>
                  <span className="caret">{g.collapsed ? '▸' : '▾'}</span>
                  <span className="group-icon" aria-hidden="true">
                    ★
                  </span>
                  <span className="group-name">{g.name}</span>
                  <span className="count">{members.length}</span>
                </button>
                <button className="icon" title="Group options" onClick={(e) => groupMenu(e, g, i)}>
                  ⋯
                </button>
              </div>
            )}
            {!g.collapsed && (
              <ul>
                {shown.map((f) => row(f, g))}
                {!members.length && <li className="group-empty">Drag files here, or right-click a file → Add to Group.</li>}
              </ul>
            )}
          </section>
        );
      })}

      {naming?.id === 'new' && (
        <section className="file-group">
          <div className="group-head">
            <InlineName initial="" placeholder="Group name" onDone={finishNaming} />
          </div>
        </section>
      )}

      {!groups.length && naming?.id !== 'new' && files.length > 0 && (
        <div className={`group-drop-new${dropOn === 'new' ? ' drop' : ''}`} {...dropProps('new', (id) => setNaming({ id: 'new', fileId: id }))}>
          Drop a file here to start a group
        </div>
      )}

      <section className="file-group recents">
        <div className="group-head">
          <button className="group-toggle" aria-expanded={recentsOpen} onClick={() => setRecentsOpen((o) => !o)}>
            <span className="caret">{recentsOpen ? '▾' : '▸'}</span>
            <span className="group-icon" aria-hidden="true">
              ⏱
            </span>
            <span className="group-name">Recents</span>
            <span className="count">{files.length}</span>
          </button>
        </div>
        {recentsOpen && (
          <ul>
            {recents.map((f) => row(f))}
            {files.length === 0 && <li className="group-empty">Opened PDFs are kept here for offline use.</li>}
          </ul>
        )}
      </section>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
}
