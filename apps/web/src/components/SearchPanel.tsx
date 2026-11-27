import { msg } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { searchText, type PageText, type SearchHit, type SheetInfo } from '@nb/sheets';
import { CountToolDialog } from './CountToolDialog';
import { centreOf, type CountHit, type CountTool } from '../search/countFromHits';
import { fileSource, type Labelled, type SearchSource } from '../search/sources';
import { searchIndex, type Related } from '../search/index/client';
import { settings, useSettings } from '../settings/settings';

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
  /** Also list pages about the query in other words (desktop app: its model ships with it). */
  meaning: boolean;
}

/** What a match was found in. */
export type HitKind = 'text' | 'field' | 'markup' | 'filename' | 'property' | 'meaning';

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

const DEFAULT_OPTIONS: SearchOptions = { includeSubfolders: false, pages: true, filenames: false, properties: false, fields: true, markups: false, caseSensitive: false, wholeWord: false, meaning: true };

const OPTION_LABELS = lazy((): [keyof SearchOptions, string][] => [
  ['includeSubfolders', msg('Include Subfolders')],
  ['pages', msg('Search Pages')],
  ['filenames', msg('Search Filenames')],
  ['properties', msg('Search File Properties')],
  ['fields', msg('Search Form Fields')],
  ['markups', msg('Search Markups')],
  ['caseSensitive', msg('Case Sensitive')],
  ['wholeWord', msg('Whole Words Only')],
  ['meaning', msg('Search by Meaning')],
]);

/** Whether an option applies to a scope: subfolders only to a folder, file names only to several files. */
const applies = (option: keyof SearchOptions, scope: SearchScope) =>
  option === 'includeSubfolders' ? scope === 'folder' : option === 'filenames' ? scope !== 'document' && scope !== 'page' : option === 'meaning' ? scope !== 'page' : true;

const KIND_LABELS = lazy((): Record<HitKind, string> => ({ text: msg('Page'), field: msg('Form field'), markup: msg('Markup'), filename: msg('File name'), property: msg('Property'), meaning: msg('Related') }));

/** Pages listed under Related at most, and the words of each one's passage shown. */
const RELATED_LIMIT = 10;
const RELATED_WORDS = 24;

/** A page found by meaning as a result: its passage's words as the snippet, their area to show. */
function relatedHit(r: Related, doc: { id: string; name: string }): DocHit {
  const ws = r.words;
  const x0 = Math.min(...ws.map((w) => w.x0));
  const y0 = Math.min(...ws.map((w) => w.y0));
  const x1 = Math.max(...ws.map((w) => w.x1));
  const y1 = Math.max(...ws.map((w) => w.y1));
  const snippet = ws.slice(0, RELATED_WORDS).map((w) => w.text).join(' ') + (ws.length > RELATED_WORDS ? '…' : '');
  return { pageIndex: r.pageIndex, rects: ws.length ? [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }] : [], snippet, matchStart: 0, matchEnd: 0, docId: doc.id, docName: doc.name, kind: 'meaning' };
}

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
  /** The Tool Chest's count tools, offered by Apply Count to Checked. */
  countTools?: CountTool[];
  /** Turns checked matches (each with the point to count) into counts with a tool, or the default count when null. Unset hides the action. */
  onApplyCount?: (hits: CountHit[], tool: CountTool | null) => void;
  /** The front document cannot be edited. */
  readOnly?: boolean;
}

/** Find text in the document, the open documents, recent files or a folder, as in Bluebeam's Search panel. */
export function SearchPanel({ activeId, activeKey, currentPage, sheets, sources, memory, focusToken, onResults, onOpen, onRedactAll, countTools = [], onApplyCount, readOnly }: Props) {
  const { zoomToSearchResults } = useSettings();
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
  // A search that found nothing, run again with its misspelt words corrected.
  const [respelt, setRespelt] = useState<{ from: string; to: string } | null>(null);
  // Search by meaning: whether this app has the model, and the pages it found for the last search.
  const [semantic, setSemantic] = useState<{ available: boolean; done: number; total: number } | null>(null);
  const [related, setRelated] = useState<DocHit[]>([]);
  // Checked results (by index in `hits`) to turn into a count, and the page the list is narrowed to (-1: all).
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [pageFilter, setPageFilter] = useState(-1);
  const [pickCount, setPickCount] = useState(false);
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
      setChecked(new Set());
      setPageFilter(-1);
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

  useEffect(() => {
    let live = true;
    void searchIndex.semanticStatus([]).then((s) => live && setSemantic(s));
    return () => {
      live = false;
    };
  }, []);

  const reset = () => {
    ++run.current;
    setRespelt(null);
    setRelated([]);
    setChecked(new Set());
    setPageFilter(-1);
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

  /** Searches for `q`; `misspelt` is the query it corrects, when the search for that found nothing. */
  const search = async (q = query.trim(), misspelt: string | null = null) => {
    const id = ++run.current;
    if (!q) {
      setHits(null);
      return;
    }
    if (scope === 'folder' && !folder) {
      chooseFolder();
      return;
    }
    setRespelt(misspelt ? { from: misspelt, to: q } : null);
    setRelated([]);
    const re = matcher(q, options);
    const found: DocHit[] = [];
    setHits(null);
    setResultsKey(activeKey);
    setShowResults(true);
    // The search index says which pages of the documents it holds can match, so only those are
    // read (and none, for a document where nothing can). Documents it does not hold yet are read
    // in full, and kept in it for next time.
    const keys = options.pages ? documents().flatMap((d) => (d.indexKey ? [d.indexKey] : [])) : [];
    const narrowed = keys.length ? await searchIndex.candidates(keys, q, options.wholeWord) : null;
    if (id !== run.current) return;
    const candidates = narrowed?.hits ?? null;
    const indexed = new Set(narrowed?.indexed ?? []);
    const rankOf = (d: SearchSource) => (d.indexKey ? candidates?.[d.indexKey]?.rank : undefined);
    // With several documents, the ones with the best matching pages come first (a word in a page's
    // body ranks above the same word only in its title block), then the others in their usual order.
    const all = documents();
    const ranked = all.filter((d) => rankOf(d) !== undefined).sort((a, b) => rankOf(a)! - rankOf(b)!);
    const docs = [...ranked, ...all.filter((d) => rankOf(d) === undefined)];
    for (const [n, doc] of docs.entries()) {
      const status = (what: string) => id === run.current && setProgress(docs.length > 1 ? (what ? msg('Searching {number} of {count}: {name} ({step})', { number: n + 1, count: docs.length, name: doc.name, step: what }) : msg('Searching {number} of {count}: {name}', { number: n + 1, count: docs.length, name: doc.name })) : what || msg('Searching'));
      status('');
      const tag = (kind: HitKind) => (h: SearchHit | null): DocHit[] => (h ? [{ ...h, docId: doc.id, docName: doc.name, kind }] : []);
      const onPage = (p: number) => doc.page === undefined || p === doc.page;
      const inLabelled = (items: Labelled[], kind: HitKind) => items.filter((l) => onPage(l.pageIndex)).flatMap((l) => tag(kind)(labelledHit(re, l.pageIndex, [l.rect], l.label, l.text)));
      const own: DocHit[] = [];
      try {
        if (options.filenames && applies('filenames', scope)) own.push(...tag('filename')(labelledHit(re, -1, [], '', doc.name)));
        if (options.properties) own.push(...Object.entries(await doc.properties()).flatMap(([k, v]) => tag('property')(labelledHit(re, -1, [], k, v))));
        if (options.pages) {
          let pages: PageText[] | null = null;
          if (doc.indexKey && candidates && indexed.has(doc.indexKey)) {
            const wanted = (candidates[doc.indexKey]?.pages ?? []).filter((p) => doc.page === undefined || p === doc.page);
            pages = wanted.length ? await searchIndex.pages(doc.indexKey, wanted) : [];
          }
          pages ??= await doc.text((done, total) => status(msg('reading text {done}/{total}', { done, total })));
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
    // Nothing found: try again with misspelt words corrected from the words the index holds (in
    // lower case, so not when the case must match).
    if (!found.length && !misspelt && keys.length && !options.caseSensitive) {
      const respelling = await searchIndex.suggest(keys, q);
      if (id !== run.current) return;
      if (respelling) return search(respelling, q);
    }
    setProgress(null);
    setHits([...found]);
    const first = found.findIndex((h) => h.docId === activeId && h.pageIndex >= 0);
    setSelected(first);
    if (first >= 0) onOpen(found[first]!, found.filter((h) => h.docId === activeId));
    // Pages about the query in other words, below the matches (and not repeating them).
    if (options.meaning && semantic?.available && applies('meaning', scope) && q.length >= 3) {
      const byKey = new Map(all.flatMap((d) => (d.indexKey ? [[d.indexKey, d] as const] : [])));
      const keysAll = [...byKey.keys()];
      const [found2, status] = await Promise.all([searchIndex.related(keysAll, q, RELATED_LIMIT + found.length), searchIndex.semanticStatus(keysAll)]);
      if (id !== run.current) return;
      if (status) setSemantic(status);
      const matched = new Set(found.map((h) => `${h.docId}:${h.pageIndex}`));
      const extra = (found2 ?? []).flatMap((r) => {
        const d = byKey.get(r.key);
        return d && !matched.has(`${d.id}:${r.pageIndex}`) ? [relatedHit(r, d)] : [];
      });
      setRelated(extra.slice(0, RELATED_LIMIT));
    }
  };

  const openRelated = (h: DocHit) => {
    setSelected(-1);
    onOpen(h, [h], folder?.files.find((f) => `file:${f.path}` === h.docId)?.file);
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

  // Keep the active result in view in the list, whether it was reached by key or from the page.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.search-hit.active')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, hits, collapsed]);

  // Up and Down step through the results (wrapping at either end) from the query box or a result,
  // so a text field elsewhere keeps its own arrow keys.
  const onArrow = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target as HTMLElement;
    if (t !== inputRef.current && !t.classList.contains('search-hit')) return;
    if (!hits?.length || progress) return;
    e.preventDefault();
    e.stopPropagation();
    const next = selected < 0 ? (e.key === 'ArrowDown' ? 0 : hits.length - 1) : (selected + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    // A result in a collapsed file group is not on screen, so open its group.
    const doc = hits[next]!.docId;
    if (collapsed.includes(doc)) setCollapsed(collapsed.filter((c) => c !== doc));
    open(next);
    if (t !== inputRef.current) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('.search-hit.active')?.focus());
  };

  const scopeLabel = (s: SearchScope) =>
    s === 'document' ? msg('Current Document') : s === 'page' ? msg('Current Page ({page})', { page: sheets[currentPage]?.number ?? msg('Page {page}', { page: currentPage + 1 }) }) : s === 'open' ? msg('All Open Documents') : s === 'recents' ? msg('Recents') : msg('Folder');

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
    if (h.pageIndex < 0) return KIND_LABELS()[h.kind];
    const page = (h.docId === activeId ? sheets[h.pageIndex]?.number : null) ?? msg('Page {page}', { page: h.pageIndex + 1 });
    return h.kind === 'text' ? page : `${page} · ${KIND_LABELS()[h.kind]}`;
  };

  // Matches in the front document's page text can be counted.
  const countable = (h: DocHit) => !!onApplyCount && h.docId === activeId && h.kind === 'text' && h.rects.length > 0;
  const countablePages = [...new Set((hits ?? []).filter(countable).map((h) => h.pageIndex))].sort((a, b) => a - b);
  const shown = (h: DocHit) => pageFilter < 0 || !countable(h) || h.pageIndex === pageFilter;
  const shownCountable = (hits ?? []).flatMap((h, i) => (countable(h) && shown(h) ? [i] : []));
  const checkedCount = [...checked].filter((i) => hits?.[i] && countable(hits[i]!)).length;
  const toggle = (i: number, on: boolean) =>
    setChecked((c) => {
      const next = new Set(c);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });
  /** The point to count on a match: the centre of its bounding box. */
  const countHits = (): CountHit[] =>
    [...checked].sort((a, b) => a - b).flatMap((i) => {
      const h = hits?.[i];
      if (!h || !countable(h)) return [];
      const x0 = Math.min(...h.rects.map((r) => r.x));
      const y0 = Math.min(...h.rects.map((r) => r.y));
      const x1 = Math.max(...h.rects.map((r) => r.x + r.w));
      const y1 = Math.max(...h.rects.map((r) => r.y + r.h));
      return [{ pageIndex: h.pageIndex, point: centreOf({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) }];
    });

  const row = ({ hit: h, index: i }: { hit: DocHit; index: number }) =>
    !shown(h) ? null : (
    <li key={i} className={countable(h) ? 'search-hit-row' : undefined}>
      {countable(h) && (
        <input type="checkbox" className="search-check" aria-label={msg('Check {where}: {snippet}', { where: where(h), snippet: h.snippet.slice(h.matchStart, h.matchEnd) })} checked={checked.has(i)} onChange={(e) => toggle(i, e.target.checked)} />
      )}
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
    <div className="search" ref={listRef} onKeyDownCapture={onArrow}>
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
            placeholder={msg('Search text')}
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              aria-label={msg('Clear the search')}
              title={msg('Clear')}
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
          {hits?.length && query.trim() && !progress ? msg('Next') : msg('Search')}
        </button>
      </form>
      <div className="search-scope">
        <select
          aria-label={msg('Where to search')}
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
            <span title={folder ? msg('{count, plural, one {# PDF} other {# PDFs}}', { count: folder.files.length }) : undefined}>{folder ? folder.name : msg('No folder chosen')}</span>
            <button className="btn small" type="button" onClick={chooseFolder}>
              {msg('Choose…')}
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
            setFolder({ name: pathOf(all[0]!).split('/')[0] || msg('Folder'), files });
            reset();
          }}
        />
      </div>
      <div className="search-opts">
        {OPTION_LABELS().map(([key, label]) => {
          // Only where the model is: the desktop app.
          if (key === 'meaning' && !semantic?.available) return null;
          const on = applies(key, scope);
          return (
            <label key={key} className={`field search-opt${on ? '' : ' disabled'}`}>
              <input type="checkbox" disabled={!on} checked={options[key]} onChange={(e) => setOption(key, e.target.checked)} />
              {label}
            </label>
          );
        })}
        <label className="field search-opt" title={msg('Zoom in on a search result when clicking it (off keeps your current zoom)')}>
          <input type="checkbox" checked={zoomToSearchResults} onChange={(e) => settings.set({ zoomToSearchResults: e.target.checked })} />
          {msg('Zoom to Search Results')}
        </label>
      </div>
      <button className="search-results-head" aria-expanded={showResults} onClick={() => setShowResults(!showResults)}>
        <span className="chev">{showResults ? '▾' : '▸'}</span>
        {msg('Results')}
        {hits && hits.length > 0 && (
          <span className="count">
            {hits.length}
            {grouped && groups.size > 1 ? ' ' + msg('in {count} files', { count: groups.size }) : ''}
          </span>
        )}
      </button>
      {showResults && (
        <>
          {progress && <p className="empty">{progress}</p>}
          {respelt && !!hits?.length && !progress && (
            <p className="empty search-respelt">
              {msg('No matches for “{from}”. Showing matches for “{to}”.', { from: respelt.from, to: respelt.to })}
            </p>
          )}
          {hits && !progress && (
            <p className="empty">
              {hits.length === 0
                ? msg('No matches.')
                : grouped
                  ? msg('{count, plural, one {# match} other {# matches}} in {files, plural, one {# file} other {# files}}', { count: hits.length, files: groups.size })
                  : msg('{count, plural, one {# match} other {# matches}} on {pages, plural, one {# page} other {# pages}}', { count: hits.length, pages: new Set(hits.map((h) => h.pageIndex)).size })}
              {redactable.length > 0 && onRedactAll && (
                <button className="btn small" title={msg('Mark every match on this document\'s pages for redaction (Tools › Redaction › Apply Redactions removes them)')} onClick={() => onRedactAll(redactable)}>
                  {msg('Mark for redaction')}
                </button>
              )}
            </p>
          )}
          {hits && !progress && countablePages.length > 0 && (
            <div className="search-count-bar">
              <button className="btn small" type="button" onClick={() => setChecked(new Set([...checked, ...shownCountable]))}>
                {msg('Select All')}
              </button>
              <button className="btn small" type="button" onClick={() => setChecked(new Set([...checked].filter((i) => !shownCountable.includes(i))))}>
                {msg('Select None')}
              </button>
              {countablePages.length > 1 && (
                <select aria-label={msg('Show results on page')} value={pageFilter} onChange={(e) => setPageFilter(Number(e.target.value))}>
                  <option value={-1}>{msg('All pages')}</option>
                  {countablePages.map((p) => (
                    <option key={p} value={p}>
                      {sheets[p]?.number ?? msg('Page {number}', { number: p + 1 })}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn small"
                type="button"
                disabled={checkedCount === 0 || readOnly}
                title={readOnly ? msg('This document is read-only') : msg('Turn the checked results into a count')}
                onClick={() => setPickCount(true)}
              >
                {msg('Apply Count to Checked…')}
              </button>
            </div>
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
          {related.length > 0 && !progress && (
            <div className="search-related">
              <p className="search-related-head" title={msg('Pages about the search in other words (search by meaning)')}>
                {msg('Related pages')}
              </p>
              <ul>
                {related.map((h, i) => (
                  <li key={`${h.docId}:${h.pageIndex}:${i}`}>
                    <button className="search-hit related" onClick={() => openRelated(h)}>
                      <span className="num">{grouped ? `${h.docName} · ${where({ ...h, kind: 'text' })}` : where({ ...h, kind: 'text' })}</span>
                      <span className="snippet">{h.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {semantic?.available && options.meaning && semantic.total > 0 && semantic.done < semantic.total && hits && !progress && (
            <p className="empty search-meaning-progress">
              {msg('Reading pages for search by meaning: {done} of {total}', { done: semantic.done, total: semantic.total })}
            </p>
          )}
        </>
      )}
      {pickCount && (
        <CountToolDialog
          total={checkedCount}
          tools={countTools}
          onCancel={() => setPickCount(false)}
          onApply={(tool) => {
            setPickCount(false);
            onApplyCount?.(countHits(), tool);
            setChecked(new Set());
          }}
        />
      )}
    </div>
  );
}
