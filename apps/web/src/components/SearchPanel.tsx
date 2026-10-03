import { useEffect, useRef, useState } from 'react';
import { searchText, type PageText, type SearchHit, type SheetInfo } from '@nb/sheets';

interface Props {
  /** Loads (or returns cached) text for every page; reports extraction progress. */
  loadText: (onProgress: (done: number, total: number) => void) => Promise<PageText[]>;
  sheets: Readonly<Record<number, SheetInfo>>;
  /** Focus the query box (Ctrl+F). */
  focusToken: number;
  onResults: (hits: SearchHit[]) => void;
  onOpen: (hit: SearchHit) => void;
  /** Matches in form field values and markup text (not part of the page's own text). */
  extraHits?: (query: string, wholeWord: boolean) => SearchHit[];
  /** Marks every match for redaction; unset when the document cannot be edited. */
  onRedactAll?: (hits: SearchHit[]) => void;
}

/** Find text across the whole document; results jump to the page and highlight the match. */
export function SearchPanel({ loadText, sheets, focusToken, onResults, onOpen, onRedactAll, extraHits }: Props) {
  const [withFields, setWithFields] = useState(true);
  /** Matches in the page's own text (only those can be marked for redaction). */
  const textHits = useRef(new Set<SearchHit>());
  const [query, setQuery] = useState('');
  const [wholeWord, setWholeWord] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const search = async () => {
    const id = ++run.current;
    if (!query.trim()) {
      setHits(null);
      onResults([]);
      return;
    }
    const pages = await loadText((done, total) => id === run.current && setProgress(`Reading text ${done}/${total}`));
    if (id !== run.current) return;
    setProgress(null);
    const inText = searchText(pages, query, { wholeWord });
    textHits.current = new Set(inText);
    const found = [...inText, ...(withFields && extraHits ? extraHits(query, wholeWord) : [])].sort((a, b) => a.pageIndex - b.pageIndex || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0));
    setHits(found);
    setSelected(found.length ? 0 : -1);
    onResults(found);
    if (found[0]) onOpen(found[0]);
  };

  const step = (delta: number) => {
    if (!hits?.length) return;
    const next = (selected + delta + hits.length) % hits.length;
    setSelected(next);
    onOpen(hits[next]!);
  };

  return (
    <div className="search">
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (hits && query.trim()) step(1);
          else void search();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Search text"
          onChange={(e) => {
            setQuery(e.target.value);
            setHits(null);
          }}
        />
        <button className="btn small" type="submit">
          {hits && query.trim() ? 'Next' : 'Find'}
        </button>
      </form>
      <label className="field search-opt">
        <input type="checkbox" checked={wholeWord} onChange={(e) => (setWholeWord(e.target.checked), setHits(null))} />
        Whole words
      </label>
      {extraHits && (
        <label className="field search-opt">
          <input type="checkbox" checked={withFields} onChange={(e) => (setWithFields(e.target.checked), setHits(null))} />
          Form fields and markups
        </label>
      )}
      {progress && <p className="empty">{progress}</p>}
      {hits && (
        <p className="empty">
          {hits.length === 0 ? 'No matches.' : `${hits.length}${hits.length >= 1000 ? '+' : ''} match${hits.length === 1 ? '' : 'es'} on ${new Set(hits.map((h) => h.pageIndex)).size} page(s)`}
          {hits.length > 0 && onRedactAll && (
            <button className="btn small" title="Mark every match for redaction (Tools › Redaction › Apply Redactions removes them)" onClick={() => onRedactAll(hits.filter((h) => textHits.current.has(h)))}>
              Mark for redaction
            </button>
          )}
        </p>
      )}
      <ul>
        {hits?.map((h, i) => (
          <li key={i}>
            <button
              className={`search-hit${i === selected ? ' active' : ''}`}
              onClick={() => {
                setSelected(i);
                onOpen(h);
              }}
            >
              <span className="num">{sheets[h.pageIndex]?.number ?? `Page ${h.pageIndex + 1}`}</span>
              <span className="snippet">
                {h.snippet.slice(0, h.matchStart)}
                <mark>{h.snippet.slice(h.matchStart, h.matchEnd)}</mark>
                {h.snippet.slice(h.matchEnd)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
