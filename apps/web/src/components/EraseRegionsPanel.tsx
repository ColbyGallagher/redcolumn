import { useEffect, useRef, useState } from 'react';
import type { PageText } from '@nb/sheets';
import { parsePageRange, textInRegion, type Region } from '../sheets/regions';
import { commonPageSize, findRepeatedRegions, pagesWithText, regionOnPage, type PageSize } from '../sheets/repeatedRegions';
import { rangeText } from '../measure/scalePresets';

export interface EraseRegionsSpec {
  /** Each region at its place on each chosen page. */
  areas: { pageIndex: number; rect: Region }[];
  /** Only characters go; lines, shapes and pictures in the boxes stay. */
  textOnly: boolean;
  /** Overlay colour (#rrggbb) drawn over each box, or null to leave the area blank. */
  cover: string | null;
  /** Markups inside the boxes are deleted too. */
  removeMarkups: boolean;
}

interface Props {
  regions: Region[];
  drawing: boolean;
  pageCount: number;
  currentPage: number;
  /** Every page's text, once loaded. */
  texts: PageText[] | null;
  /** Each page's size, for boxes on pages of another size. */
  pageSize: (page: number) => PageSize | null;
  readOnly: boolean;
  /** Start set to cover the boxes (Tools › Redaction › Redact Across Pages). */
  initialCover?: boolean;
  onDraw: () => void;
  onChange: (regions: Region[]) => void;
  onApply: (spec: EraseRegionsSpec) => void;
  onClose: () => void;
}

const key = (r: Region) => `${r.x},${r.y},${r.w},${r.h}`;

/**
 * Erase Across Pages: removes what is inside the same boxes on many pages at once, such as a
 * header, footer or note along the side that repeats on every page. Boxes are drawn on the page
 * or found from text that repeats at the same place; every page shows them, and each box says how
 * many of the chosen pages have text in it.
 */
export function EraseRegionsPanel({ regions, drawing, pageCount, currentPage, texts, pageSize, readOnly, initialCover = false, onDraw, onChange, onApply, onClose }: Props) {
  const [scope, setScope] = useState<'all' | 'odd' | 'even' | 'range'>('all');
  const [range, setRange] = useState('');
  const [textOnly, setTextOnly] = useState(true);
  const [cover, setCover] = useState(initialCover);
  const [fill, setFill] = useState('#000000');
  const [removeMarkups, setRemoveMarkups] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [found, setFound] = useState<number | null>(null);
  const all = Array.from({ length: pageCount }, (_, i) => i);
  const pages = scope === 'all' ? all : scope === 'odd' ? all.filter((p) => p % 2 === 0) : scope === 'even' ? all.filter((p) => p % 2 === 1) : parsePageRange(range, pageCount);
  const sizes = Array.from({ length: pageCount }, (_, i) => pageSize(i) ?? undefined);
  // Boxes are drawn (and shown) in the size most chosen pages share.
  const ref = commonPageSize(sizes, pages.length ? pages : [currentPage]);

  const detect = () => {
    if (!texts) return;
    const hits = findRepeatedRegions(texts, pages);
    setFound(hits.length);
    if (!hits.length) return;
    const known = new Set(regions.map(key));
    const fresh = hits.filter((h) => !known.has(key(h.rect)));
    setNames((m) => new Map([...m, ...fresh.map((h) => [key(h.rect), h.name] as const)]));
    onChange([...regions, ...fresh.map((h) => h.rect)]);
  };
  // Repeated text is looked for once the pages' text is read, when no boxes are drawn yet.
  const detected = useRef(false);
  useEffect(() => {
    if (!texts || detected.current) return;
    detected.current = true;
    if (!regions.length) detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texts]);

  const here = pageSize(currentPage);
  const words = texts?.[currentPage]?.words ?? [];
  const onPage = (r: Region) => (ref && here ? regionOnPage(r, ref, here) : r);

  return (
    <div className="label-regions" role="dialog" aria-label="Erase across pages">
      <div className="lr-head">
        <b>Erase Across Pages</b>
        <button className="btn small flat" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>
      <p className="hint">Draw a box over the header, footer or side text, or find text that repeats at the same place. What is inside the boxes is removed from every chosen page.</p>
      <div className="lr-row">
        <button className={`btn small${drawing ? ' active' : ''}`} onClick={onDraw} disabled={readOnly}>
          {drawing ? 'Drawing: drag a box on the page' : '+ Draw box'}
        </button>
        <button className="btn small" onClick={detect} disabled={readOnly || !texts || pages.length < 2} title="Look for text at the same place near the edges of most chosen pages">
          Find repeated text
        </button>
      </div>
      {found === 0 && <p className="hint">No text repeats at the same place on most of the chosen pages.</p>}
      <ol className="lr-list">
        {regions.length === 0 && <li className="empty">No boxes yet.</li>}
        {regions.map((r, i) => {
          const name = names.get(key(r));
          const count = texts && ref ? pagesWithText(texts, pages, r, ref).length : null;
          const text = texts ? textInRegion(words, onPage(r)) : null;
          return (
            <li key={key(r)}>
              <span className="lr-num">{i + 1}</span>
              <span className="lr-text" title={`${name ? `${name}. ` : ''}Text in this box on page ${currentPage + 1}`}>
                {name && <b>{name}: </b>}
                {text === null ? '…' : text || <i>no text on this page</i>}
              </span>
              <span className="lr-count" title="Chosen pages with text in this box">
                {count === null ? '' : `${count}/${pages.length}`}
              </span>
              <button className="btn small flat" onClick={() => onChange(regions.filter((_, j) => j !== i))} title="Remove box" aria-label="Remove box">
                ×
              </button>
            </li>
          );
        })}
      </ol>
      <fieldset className="lr-row">
        <legend>Remove</legend>
        <label title="Lines, shapes and pictures in the boxes are left as they are">
          <input type="radio" checked={textOnly} onChange={() => setTextOnly(true)} /> Text only
        </label>
        <label title="Text, lines and shapes wholly inside, and the parts of pictures inside">
          <input type="radio" checked={!textOnly} onChange={() => setTextOnly(false)} /> Everything
        </label>
      </fieldset>
      <fieldset className="lr-row">
        <legend>Then</legend>
        <label>
          <input type="radio" checked={!cover} onChange={() => setCover(false)} /> Leave blank
        </label>
        <label>
          <input type="radio" checked={cover} onChange={() => setCover(true)} /> Cover with
          <input type="color" value={fill} aria-label="Cover colour" onChange={(e) => {
              setFill(e.target.value);
              setCover(true);
            }}
          />
        </label>
      </fieldset>
      <label className="lr-row">
        <input type="checkbox" checked={removeMarkups} onChange={(e) => setRemoveMarkups(e.target.checked)} />
        Also delete markups inside the boxes
      </label>
      <fieldset className="lr-row">
        <legend>Pages</legend>
        <label>
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All ({pageCount})
        </label>
        <label>
          <input type="radio" checked={scope === 'odd'} onChange={() => setScope('odd')} /> Odd
        </label>
        <label>
          <input type="radio" checked={scope === 'even'} onChange={() => setScope('even')} /> Even
        </label>
        <label>
          <input type="radio" checked={scope === 'range'} onChange={() => setScope('range')} />
          <input className="lr-range" value={range} placeholder="1-5, 8" onFocus={() => setScope('range')} onChange={(e) => setRange(e.target.value)} aria-label="Page range" />
        </label>
      </fieldset>
      <div className="lr-preview">
        {regions.length && pages.length ? (
          <>
            {regions.length} box{regions.length === 1 ? '' : 'es'} on {pages.length > 1 ? `pages ${rangeText(pages)}` : `page ${pages[0]! + 1}`}. Undo with Ctrl+Z.
          </>
        ) : (
          'Add a box and choose the pages.'
        )}
      </div>
      <div className="lr-actions">
        <button className="btn small" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn small primary danger"
          disabled={readOnly || !pages.length || !regions.length || !ref}
          onClick={() =>
            onApply({
              areas: pages.flatMap((p) => {
                const size = pageSize(p);
                return regions.map((r) => ({ pageIndex: p, rect: size && ref ? regionOnPage(r, ref, size) : r }));
              }),
              textOnly,
              cover: cover ? fill : null,
              removeMarkups,
            })
          }
        >
          {cover ? 'Redact' : 'Erase'} on {pages.length} page{pages.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
