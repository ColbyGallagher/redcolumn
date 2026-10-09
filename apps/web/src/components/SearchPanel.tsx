import { useEffect, useRef, useState } from 'react';
import { searchText, type SearchHit, type SheetInfo } from '@nb/sheets';
import { fileSource, type Labelled, type SearchSource } from '../search/sources';

/** Where to look, as in Bluebeam's Search panel. */
export type SearchScope = 'document' | 'page' | 'open' | 'recents' | 'folder';

export interface SearchOptions {
  includeSubfolders: boolean;
  pages: boolean;
  filenames: boolean;
  properties: boolean;
  fields: boolean;
  markups: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** What a match was found in. */
export type HitKind = 'text' | 'field' | 'markup' | 'filename' | 'property';

/** A match in one of the documents searched. File name and property matches have no page (-1). */
export interface DocHit extends SearchHit {
  docId: string;
  docName: string;
  kind: HitKind;
}

interface Folder {
  name: string;
  /** PDFs in the folder, with paths relative to it (the first part is the folder itself). */
  files: { file: File; path: string }[];
}

/** The panel's state, kept by the app while the panel is closed or another document is in front. */
export interface SearchMemory {
  query: string;
  scope: SearchScope;
  options: SearchOptions;
  folder: Folder | null;
  hits: DocHit[] | null;
  selected: number;
  showResults: boolean;
  collapsed: string[];
  /** The document in front when the results were found. */
  activeKey: string | null;
}

const DEFAULT_OPTIONS: SearchOptions = { includeSubfolders: false, pages: true, filenames: false, properties: false, fields: true, markups: false, caseSensitive: false, wholeWord: false };

const OPTION_LABELS: [keyof SearchOptions, string][] = [
  ['includeSubfolders', 'Include Subfolders'],
  ['pages', 'Search Pages'],
  ['filenames', 'Search Filenames'],
  ['properties', 'Search File Properties'],
  ['fields', 'Search Form Fields'],
  ['markups', 'Search Markups'],
  ['caseSensitive', 'Case Sensitive'],
  ['wholeWord', 'Whole Words Only'],
];

/** Whether an option applies to a scope: subfolders only to a folder, file names only to several files. */
const applies = (option: keyof SearchOptions, scope: SearchScope) => (option === 'includeSubfolders' ? scope === 'folder' : option === 'filenames' ? scope !== 'document' && scope !== 'page' : true);

const KIND_LABELS: Record<HitKind, string> = { text: 'Page', field: 'Form field', markup: 'Markup', filename: 'File name', property: 'Property' };

const SNIPPET_CONTEXT = 40;

/** A regular expression for the query with the case and whole-word options. */
function matcher(query: string, o: SearchOptions): RegExp {
  const esc = query.replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc, o.caseSensitive ? 'u' : 'iu');
}

/** A match in a labelled piece of text, shown as "label: …text around the match…". */
function labelledHit(re: RegExp, pageIndex: number, rects: SearchHit['rects'], label: string, text: string): SearchHit | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = re.exec(t);
  if (!m) return null;
  const start = Math.max(0, m.index - SNIPPET_CONTEXT);
  const lead = (label ? `${label}: ` : '') + (start > 0 ? '…' : '');
  const end = m.index + m[0].length;
  const snippet = lead + t.slice(start, end + SNIPPET_CONTEXT) + (end + SNIPPET_CONTEXT < t.length ? '…' : '');
  const matchStart = lead.length + m.index - start;
  return { pageIndex, rects, snippet, matchStart, matchEnd: matchStart + m[0].length };
}

const byPosition = (a: SearchHit, b: SearchHit) => a.pageIndex - b.pageIndex || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0) || (a.rects[0]?.x ?? 0) - (b.rects[0]?.x ?? 0);

interface Props {
  /** The document in front (library id), and a key that changes when its contents do. */
  activeId: string | null;
  activeKey: string | null;
  /** The page in front, for Current Page. */
  currentPage: number;
  sheets: Readonly<Record<number, SheetInfo>>;
  /** The documents each scope covers (all but Folder, which the panel reads itself). */
  sources: (scope: Exclude<SearchScope, 'folder'>) => SearchSource[];
  memory: { current: SearchMemory | null };
  /** Focus the query box (Ctrl+F). */
  focusToken: number;
  /** The matches on the document in front, to highlight. */
  onResults: (hits: SearchHit[]) => void;
  /**
   * Shows a match, opening its document first when needed; `sameDoc` is every match in that
   * document, and `file` the file on disk for a match in a chosen folder.
   */
  onOpen: (hit: DocHit, sameDoc: DocHit[], file?: File) => void;
  /** Marks matches in the front document's text for redaction; unset when it cannot be edited. */
  onRedactAll?: (hits: SearchHit[]) => void;
}

/** Find text in the document, the open documents, recent files or a folder, as in Bluebeam's Search panel. */
export function SearchPanel({ activeId, activeKey, currentPage, sheets, sources, memory, focusToken, onResults, onOpen, onRedactAll }: Props) {
  const saved = memory.current;
  const [query, setQuery] = useState(saved?.query ?? '');
  const [scope, setScope] = useState<SearchScope>(saved?.scope ?? 'document');
  const [options, setOptions] = useState<SearchOptions>(saved?.options ?? DEFAULT_OPTIONS);
  const [folder, setFolder] = useState<Folder | null>(saved?.folder ?? null);
  // Results for one document are dropped when another comes to the front.
  const stale = !!saved && saved.activeKey !== activeKey && (saved.scope === 'document' || saved.scope === 'page');
  const [hits, setHits] = useState<DocHit[] | null>(stale ? null : (saved?.hits ?? null));
  const [selected, setSelected] = useState(stale ? -1 : (saved?.selected ?? -1));
  const [showResults, setShowResults] = useState(saved?.showResults ?? true);
  const [collapsed, setCollapsed] = useState<string[]>(saved?.collapsed ?? []);
  const [resultsKey, setResultsKey] = useState(stale ? activeKey : (saved?.activeKey ?? activeKey));
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => {
    memory.current = { query, scope, options, folder, hits, selected, showResults, collapsed, activeKey: resultsKey };
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  // Another document in front: Current Document and Current Page results were for the last one.
  const lastKey = useRef(activeKey);
  useEffect(() => {
    if (lastKey.current === activeKey) return;
    lastKey.current = activeKey;
    if (scope === 'document' || scope === 'page') {
      ++run.current;
      setHits(null);
      setSelected(-1);
      setProgress(null);
      setResultsKey(activeKey);
    }
  }, [activeKey, scope]);

  // The front document's matches are highlighted on its pages.
  useEffect(() => {
    onResults((hits ?? []).filter((h) => h.docId === activeId && h.pageIndex >= 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, activeId]);

  const reset = () => {
    ++run.current;
    setHits(null);
    setSelected(-1);
    setProgress(null);
  };

  const setOption = (key: keyof SearchOptions, on: boolean) => {
    setOptions((o) => ({ ...o, [key]: on }));
    reset();
  };

  const chooseFolder = () => folderRef.current?.click();

  const documents = (): SearchSource[] => {
    if (scope !== 'folder') return sources(scope);
    if (!folder) return [];
    return folder.files.filter((f) => options.includeSubfolders || f.path.split('/').length <= 2).map((f) => fileSource(f.file, f.path));
  };

  const search = async () => {
    const id = ++run.current;
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    if (scope === 'folder' && !folder) {
      chooseFolder();
      return;
    }
    const docs = documents();
    const re = matcher(q, options);
    const found: DocHit[] = [];
    setHits(null);
    setResultsKey(activeKey);
    setShowResults(true);
    for (const [n, doc] of docs.entries()) {
      const status = (what: string) => id === run.current && setProgress(docs.length > 1 ? `Searching ${n + 1} of ${docs.length}: ${doc.name}${what ? ` (${what})` : ''}` : what || 'Searching');
      status('');
      const tag = (kind: HitKind) => (h: SearchHit | null): DocHit[] => (h ? [{ ...h, docId: doc.id, docName: doc.name, kind }] : []);
      const onPage = (p: number) => doc.page === undefined || p === doc.page;
      const inLabelled = (items: Labelled[], kind: HitKind) => items.filter((l) => onPage(l.pageIndex)).flatMap((l) => tag(kind)(labelledHit(re, l.pageIndex, [l.rect], l.label, l.text)));
      const own: DocHit[] = [];
      try {
        if (options.filenames && applies('filenames', scope)) own.push(...tag('filename')(labelledHit(re, -1, [], '', doc.name)));
        if (options.properties) own.push(...Object.entries(await doc.properties()).flatMap(([k, v]) => tag('property')(labelledHit(re, -1, [], k, v))));
        if (options.pages) {
          const pages = await doc.text((done, total) => status(`reading text ${done}/${total}`));
          if (id !== run.current) return;
          const searched = doc.page === undefined ? pages : pages.map((p, i) => (i === doc.page ? p : { ...p, words: [] }));
          own.push(...searchText(searched, q, { wholeWord: options.wholeWord, caseSensitive: options.caseSensitive }).flatMap(tag('text')));
        }
        if (options.fields) own.push(...inLabelled(await doc.fields(), 'field'));
        if (options.markups) own.push(...inLabelled(await doc.markups(), 'markup'));
      } catch (err) {
        console.warn(`Search: ${doc.name} could not be read`, err);
      }
      if (id !== run.current) return;
      found.push(...own.sort(byPosition));
      // Results come in document by document, so a long folder search shows what it has found so far.
      setHits([...found]);
    }
    setProgress(null);
    setHits([...found]);
    const first = found.findIndex((h) => h.docId === activeId && h.pageIndex >= 0);
    setSelected(first);
    if (first >= 0) onOpen(found[first]!, found.filter((h) => h.docId === activeId));
  };

  const open = (i: number) => {
    const h = hits?.[i];
    if (!h) return;
    setSelected(i);
    onOpen(h, hits!.filter((x) => x.docId === h.docId), folder?.files.find((f) => `file:${f.path}` === h.docId)?.file);
  };

  const step = (delta: number) => {
    if (!hits?.length) return;
    open((selected + delta + hits.length) % hits.length);
  };

  const scopeLabel = (s: SearchScope) =>
    s === 'document' ? 'Current Document' : s === 'page' ? `Current Page (${sheets[currentPage]?.number ?? `Page ${currentPage + 1}`})` : s === 'open' ? 'All Open Documents' : s === 'recents' ? 'Recents' : 'Folder';

  // Matches by document, in the order searched.
  const groups = new Map<string, { name: string; items: { hit: DocHit; index: number }[] }>();
  hits?.forEach((hit, index) => {
    const g = groups.get(hit.docId) ?? { name: hit.docName, items: [] };
    g.items.push({ hit, index });
    groups.set(hit.docId, g);
  });
  const grouped = scope !== 'document' && scope !== 'page';
  const redactable = (hits ?? []).filter((h) => h.docId === activeId && h.kind === 'text');

  const where = (h: DocHit) => {
    if (h.pageIndex < 0) return KIND_LABELS[h.kind];
    const page = (h.docId === activeId ? sheets[h.pageIndex]?.number : null) ?? `Page ${h.pageIndex + 1}`;
    return h.kind === 'text' ? page : `${page} · ${KIND_LABELS[h.kind]}`;
  };

  const row = ({ hit: h, index: i }: { hit: DocHit; index: number }) => (
    <li key={i}>
      <button className={`search-hit${i === selected ? ' active' : ''}`} onClick={() => open(i)}>
        <span className="num">{where(h)}</span>
        <span className="snippet">
          {h.snippet.slice(0, h.matchStart)}
          <mark>{h.snippet.slice(h.matchStart, h.matchEnd)}</mark>
          {h.snippet.slice(h.matchEnd)}
        </span>
      </button>
    </li>
  );

  return (
    <div className="search">
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (hits?.length && query.trim() && !progress) step(1);
          else void search();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span className="search-input">
          <input
            ref={inputRef}
            value={query}
            placeholder="Search text"
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear the search"
              title="Clear"
              onClick={() => {
                setQuery('');
                reset();
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
        </span>
        <button className="btn small" type="submit">
          {hits?.length && query.trim() && !progress ? 'Next' : 'Search'}
        </button>
      </form>
      <div className="search-scope">
        <select
          aria-label="Where to search"
          value={scope}
          onChange={(e) => {
            const next = e.target.value as SearchScope;
            setScope(next);
            reset();
            if (next === 'folder' && !folder) chooseFolder();
          }}
        >
          {(['document', 'page', 'open', 'recents', 'folder'] as const).map((s) => (
            <option key={s} value={s}>
              {scopeLabel(s)}
            </option>
          ))}
        </select>
        {scope === 'folder' && (
          <div className="search-folder">
            <span title={folder ? `${folder.files.length} PDF${folder.files.length === 1 ? '' : 's'}` : undefined}>{folder ? folder.name : 'No folder chosen'}</span>
            <button className="btn small" type="button" onClick={chooseFolder}>
              Choose…
            </button>
          </div>
        )}
        <input
          ref={(el) => {
            folderRef.current = el;
            el?.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const all = [...(e.target.files ?? [])];
            e.target.value = '';
            if (!all.length) return;
            const pathOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
            const files = all.filter((f) => /\.pdf$/i.test(f.name)).map((file) => ({ file, path: pathOf(file) }));
            setFolder({ name: pathOf(all[0]!).split('/')[0] || 'Folder', files });
            reset();
          }}
        />
      </div>
      <div className="search-opts">
        {OPTION_LABELS.map(([key, label]) => {
          const on = applies(key, scope);
          return (
            <label key={key} className={`field search-opt${on ? '' : ' disabled'}`}>
              <input type="checkbox" disabled={!on} checked={options[key]} onChange={(e) => setOption(key, e.target.checked)} />
              {label}
            </label>
          );
        })}
      </div>
      <button className="search-results-head" aria-expanded={showResults} onClick={() => setShowResults(!showResults)}>
        <span className="chev">{showResults ? '▾' : '▸'}</span>
        Results
        {hits && hits.length > 0 && (
          <span className="count">
            {hits.length}
            {grouped && groups.size > 1 ? ` in ${groups.size} files` : ''}
          </span>
        )}
      </button>
      {showResults && (
        <>
          {progress && <p className="empty">{progress}</p>}
          {hits && !progress && (
            <p className="empty">
              {hits.length === 0 ? 'No matches.' : `${hits.length} match${hits.length === 1 ? '' : 'es'}${grouped ? ` in ${groups.size} file${groups.size === 1 ? '' : 's'}` : ` on ${new Set(hits.map((h) => h.pageIndex)).size} page(s)`}`}
              {redactable.length > 0 && onRedactAll && (
                <button className="btn small" title="Mark every match on this document's pages for redaction (Tools › Redaction › Apply Redactions removes them)" onClick={() => onRedactAll(redactable)}>
                  Mark for redaction
                </button>
              )}
            </p>
          )}
          {grouped ? (
            [...groups].map(([docId, g]) => {
              const shut = collapsed.includes(docId);
              return (
                <div key={docId} className="search-group">
                  <button className="search-group-head" aria-expanded={!shut} title={g.name} onClick={() => setCollapsed(shut ? collapsed.filter((c) => c !== docId) : [...collapsed, docId])}>
                    <span className="chev">{shut ? '▸' : '▾'}</span>
                    <span className="name">{g.name}</span>
                    <span className="count">{g.items.length}</span>
                  </button>
                  {!shut && <ul>{g.items.map(row)}</ul>}
                </div>
              );
            })
          ) : (
            <ul>{[...groups.values()].flatMap((g) => g.items).map(row)}</ul>
          )}
        </>
      )}
    </div>
  );
}
