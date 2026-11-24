import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchIndex, fetchPack, filterEntries, LIBRARY_PAGE, tradesOf, type LibraryEntry, type LibraryIndex } from '../library/catalog';
import { describeCounts, PACK_EXTENSION, parseTradePack, type TradePack } from '../library/pack';

interface Props {
  /** Adds a pack; `source` is its library id, or its name for a pack file. Returns what was added, in words. */
  onInstall: (pack: TradePack, source: string) => string;
  onHelp: () => void;
  onClose: () => void;
}

type Load = { state: 'loading' } | { state: 'ready'; index: LibraryIndex } | { state: 'failed'; error: string };

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Tools › Takeoff › Browse Library: the community library's trade packs (assemblies, tool sets,
 * takeoff templates and drawing standards), listed from GitHub when this opens, added on a click.
 * Also adds a .rctrade file from this computer.
 */
export function LibraryDialog({ onInstall, onHelp, onClose }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [trade, setTrade] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    fetchIndex()
      .then((index) => live && setLoad({ state: 'ready', index }))
      .catch((err: unknown) => live && setLoad({ state: 'failed', error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [attempt]);

  const index = load.state === 'ready' ? load.index : null;
  const trades = useMemo(() => (index ? tradesOf(index) : []), [index]);
  const shown = useMemo(() => (index ? filterEntries(index.entries, trade, query) : []), [index, trade, query]);

  const add = async (entry: LibraryEntry) => {
    setBusy(entry.id);
    setMessage(null);
    try {
      const pack = await fetchPack(entry);
      const added = onInstall(pack, entry.id);
      setDone((d) => ({ ...d, [entry.id]: added }));
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  };

  const addFile = async (file: File) => {
    setMessage(null);
    try {
      const pack = parseTradePack(await file.text());
      setMessage({ text: onInstall(pack, `file:${pack.name}`) });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal library-dialog"
        role="dialog"
        aria-label={msg('Community Library')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{msg('Community Library')}</h3>
        <p className="library-intro">
          {msg('Trade packs shared by other estimators: assemblies, tool sets, takeoff templates and drawing standards. Adding one puts it in your own library; quantities and rates are starting points to check, not advice.')}
        </p>
        <div className="library-filters">
          <select aria-label={msg('Trade')} value={trade ?? ''} onChange={(e) => setTrade(e.target.value || null)} disabled={!index}>
            <option value="">{msg('All trades')}</option>
            {trades.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input type="search" aria-label={msg('Search the library')} placeholder={msg('Search')} value={query} onChange={(e) => setQuery(e.target.value)} disabled={!index} autoFocus />
        </div>
        <div className="library-list" aria-live="polite">
          {load.state === 'loading' && <p className="empty">{msg('Getting the list from GitHub…')}</p>}
          {load.state === 'failed' && (
            <div className="empty">
              <p>{load.error}</p>
              <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
                {msg('Try Again')}
              </button>
            </div>
          )}
          {index && !shown.length && <p className="empty">{index.entries.length ? msg('No packs match.') : msg('The library has no packs yet.')}</p>}
          {shown.map((e) => (
            <article key={e.id} className="library-entry">
              <div className="library-entry-text">
                <h4>{e.name}</h4>
                <div className="library-meta">
                  {e.trade}
                  {e.units ? ' · ' + (e.units === 'metric' ? msg('Metric') : msg('Imperial')) : ''}
                  {e.author ? ' ' + msg('· by {author}', { author: e.author }) : ''} · {formatSize(e.size)}
                </div>
                {e.description && <p>{e.description}</p>}
                <div className="library-meta">{describeCounts({ assemblies: 0, items: 0, productLists: 0, templates: 0, toolSets: 0, tools: 0, standards: 0, ...e.contents })}</div>
                {done[e.id] && <div className="library-added">{msg('Added {done}.', { done: done[e.id] })}</div>}
              </div>
              <button className="btn" disabled={busy !== null} onClick={() => void add(e)}>
                {busy === e.id ? msg('Adding…') : done[e.id] ? msg('Add Again') : msg('Add')}
              </button>
            </article>
          ))}
        </div>
        {message && <p className={message.error ? 'library-error' : 'library-added'}>{message.text}</p>}
        <p className="print-hint">
          {keyed(msgParts('Listed from {code} when this opens. Nothing about you or your documents is sent.', { code: <code>github.com/ColbyGallagher/redcolumn-library</code> }))}
        </p>
        <div className="actions">
          <button className="btn" onClick={onHelp}>
            {msg('Help')}
          </button>
          <a className="btn" href={LIBRARY_PAGE} target="_blank" rel="noopener noreferrer">
            {msg('Share a Pack…')}
          </a>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            {msg('Add from File…')}
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            {msg('Close')}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={PACK_EXTENSION}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void addFile(f);
          }}
        />
      </div>
    </div>
  );
}
