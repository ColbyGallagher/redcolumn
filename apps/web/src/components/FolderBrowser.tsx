import { useEffect, useState } from 'react';

interface Entry {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemHandle;
}

interface Props {
  /** Opens a PDF chosen in the folder. */
  onOpen: (file: File) => void;
}

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;

const DB = 'nb-folders';

/** The last folder opened is remembered (browsers keep the handle; permission is asked again). */
function remember(handle: FileSystemDirectoryHandle | null): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const tx = req.result.transaction('handles', 'readwrite');
      if (handle) tx.objectStore('handles').put(handle, 'last');
      else tx.objectStore('handles').delete('last');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

function recall(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const get = req.result.transaction('handles').objectStore('handles').get('last');
      get.onsuccess = () => resolve((get.result as FileSystemDirectoryHandle | undefined) ?? null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

/**
 * File Access in Explorer mode: browse a folder on this computer (and its subfolders) and open its
 * PDFs in local and network folders. Needs the File System Access API
 * (Chromium browsers).
 */
export function FolderBrowser({ onOpen }: Props) {
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  const [path, setPath] = useState<FileSystemDirectoryHandle[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<'pdf' | 'all'>('pdf');
  const [saved, setSaved] = useState<FileSystemDirectoryHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dir = path.at(-1) ?? null;

  useEffect(() => {
    if (picker) void recall().then(setSaved);
  }, [picker]);

  useEffect(() => {
    if (!dir) return;
    let stale = false;
    void (async () => {
      const list: Entry[] = [];
      try {
        for await (const handle of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) list.push({ name: handle.name, kind: handle.kind, handle });
      } catch (err) {
        if (!stale) setError(err instanceof Error ? err.message : String(err));
        return;
      }
      list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'directory' ? -1 : 1));
      if (!stale) setEntries(list);
    })();
    return () => {
      stale = true;
    };
  }, [dir]);

  if (!picker) return null;

  const openFolder = async (handle?: FileSystemDirectoryHandle) => {
    setError(null);
    try {
      const h = handle ?? (await picker({ id: 'redcolumn-files', mode: 'read' }));
      if (handle) {
        const perm = await (h as unknown as { requestPermission(o: { mode: 'read' }): Promise<PermissionState> }).requestPermission({ mode: 'read' });
        if (perm !== 'granted') return;
      }
      setPath([h]);
      setSaved(h);
      void remember(h);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(err instanceof Error ? err.message : String(err));
    }
  };

  const shown = entries.filter((e) => e.kind === 'directory' || filter === 'all' || /\.pdf$/i.test(e.name));
  return (
    <div className="folder-browser">
      <div className="folder-head">
        <span className="folder-title">Folders</span>
        <button className="btn small" onClick={() => void openFolder()} title="Browse a folder on this computer">
          Open Folder…
        </button>
        {!dir && saved && (
          <button className="btn small flat" onClick={() => void openFolder(saved)} title="Open the folder used last time">
            {saved.name}
          </button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {dir && (
        <>
          <div className="folder-path">
            {path.map((p, i) => (
              <button key={i} className="btn flat small" onClick={() => setPath(path.slice(0, i + 1))}>
                {i ? '› ' : ''}
                {p.name}
              </button>
            ))}
            <select value={filter} onChange={(e) => setFilter(e.target.value as 'pdf' | 'all')} title="Show PDFs only, or every file">
              <option value="pdf">PDFs</option>
              <option value="all">All files</option>
            </select>
          </div>
          <ul className="folder-list">
            {shown.map((e) => (
              <li key={e.name}>
                <button
                  className="folder-entry"
                  disabled={e.kind === 'file' && !/\.pdf$/i.test(e.name)}
                  onClick={async () => {
                    if (e.kind === 'directory') setPath([...path, e.handle as FileSystemDirectoryHandle]);
                    else onOpen(await (e.handle as FileSystemFileHandle).getFile());
                  }}
                >
                  <span className="icon">{e.kind === 'directory' ? '📁' : /\.pdf$/i.test(e.name) ? '📄' : '·'}</span>
                  {e.name}
                </button>
              </li>
            ))}
            {!shown.length && <li className="empty">No {filter === 'pdf' ? 'PDFs or folders' : 'files'} here.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
