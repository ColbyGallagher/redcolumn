import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useState } from 'react';
import type { PageText } from '@nb/sheets';
import { labelFromRegions, numberedLabels, parsePageRange, textInRegion, type Region } from '../sheets/regions';
import { rangeText } from '../measure/scalePresets';

/** What the text names: the page's sheet number, its sheet title, or its bookmark. */
export type LabelTarget = 'number' | 'title' | 'bookmark';
/** Where labels come from: text in boxes drawn on the page, or typed by the user. */
export type LabelSource = 'regions' | 'typed';

interface Props {
  regions: Region[];
  drawing: boolean;
  pageCount: number;
  currentPage: number;
  /** Every page's text, once loaded. */
  texts: PageText[] | null;
  readOnly: boolean;
  /** Pages to start with (e.g. those selected in the thumbnails) instead of all pages. */
  initialPages?: readonly number[];
  initialSource?: LabelSource;
  /** What to set when the panel opens (the Bookmarks panel opens it on bookmarks). */
  initialTarget?: LabelTarget;
  /** A page's current sheet number, title or bookmark name, to start the typed label from. */
  labelOf: (page: number, target: LabelTarget) => string;
  /** The source changed: drawing boxes only makes sense when reading them. */
  onSource: (source: LabelSource) => void;
  onDraw: () => void;
  onChange: (regions: Region[]) => void;
  onApply: (labels: { page: number; label: string }[], target: LabelTarget) => void;
  onClose: () => void;
}

/**
 * Page labels from a page region: draw boxes around title-block text (sheet number,
 * title, ...); every chosen page is labelled with the text found in the same boxes, joined in
 * box order. Labels can also be typed, numbered consecutively across the chosen pages. The same
 * text can name each page's bookmark instead.
 */
export function LabelRegionsPanel({ regions, drawing, pageCount, currentPage, texts, readOnly, initialPages, initialSource = 'regions', initialTarget = 'number', labelOf, onSource, onDraw, onChange, onApply, onClose }: Props) {
  const [source, setSource] = useState<LabelSource>(initialSource);
  const [separator, setSeparator] = useState(' ');
  const [target, setTarget] = useState<LabelTarget>(initialTarget);
  const single = initialPages?.length === 1 && initialPages[0] === currentPage;
  const [scope, setScope] = useState<'all' | 'current' | 'range'>(initialPages?.length ? (single ? 'current' : 'range') : 'all');
  const [range, setRange] = useState(initialPages?.length && !single ? rangeText(initialPages) : '');
  const pages = scope === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : scope === 'current' ? [currentPage] : parsePageRange(range, pageCount);
  const [typed, setTyped] = useState(() => labelOf(pages[0] ?? currentPage, initialTarget));
  const [consecutive, setConsecutive] = useState(true);
  const words = texts?.[currentPage]?.words ?? [];
  const preview = texts ? labelFromRegions(words, regions, separator) : null;
  const label = typed.trim();
  const numbered = /\d\D*$/.test(label);
  const typedLabels = numberedLabels(pages, label, consecutive && pages.length > 1);
  const typedPreview = typedLabels.map((l) => l.label);
  const chooseSource = (next: LabelSource) => {
    setSource(next);
    onSource(next);
  };
  const chooseTarget = (next: LabelTarget) => {
    // A typed label left as it was follows the target, so it starts from the page's title or number.
    if (source === 'typed' && label === labelOf(pages[0] ?? currentPage, target).trim()) setTyped(labelOf(pages[0] ?? currentPage, next));
    setTarget(next);
  };
  const move = (i: number, d: number) => {
    const next = [...regions];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r!);
    onChange(next);
  };

  return (
    <div className="label-regions" role="dialog" aria-label={msg('Page labels from regions')}>
      <div className="lr-head">
        <b>{msg('Page Labels from Regions')}</b>
        <button className="btn small flat" onClick={onClose} title={msg('Close')} aria-label={msg('Close')}>
          ×
        </button>
      </div>
      <fieldset className="lr-row">
        <legend>{msg('Label')}</legend>
        <label>
          {keyed(msgParts('{input} From boxes', { input: <input type="radio" checked={source === 'regions'} onChange={() => chooseSource('regions')} /> }))}
        </label>
        <label>
          {keyed(msgParts('{input} Type it', { input: <input type="radio" checked={source === 'typed'} onChange={() => chooseSource('typed')} /> }))}
        </label>
      </fieldset>
      {source === 'typed' ? (
        <>
          <input
            className="lr-typed"
            autoFocus
            aria-label={target === 'number' ? msg('Page label') : target === 'title' ? msg('Sheet title') : msg('Bookmark name')}
            placeholder={target === 'number' ? 'A-101' : target === 'title' ? msg('Floor plan') : msg('A-101 Floor plan')}
            value={typed}
            disabled={readOnly}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && label && pages.length && !readOnly) onApply(typedLabels, target);
            }}
          />
          {pages.length > 1 && (
            <label className="lr-row" title={numbered ? undefined : msg('End the label with a number to count up from it')}>
              {keyed(msgParts('{input}Number consecutively', { input: <input type="checkbox" checked={consecutive} disabled={!numbered} onChange={(e) => setConsecutive(e.target.checked)} /> }))}
            </label>
          )}
          <div className="lr-preview">
            {label ? (
              <>
                {pages.length > 1 ? msg('Pages {rangeText}', { rangeText: rangeText(pages) }) : msg('Page {page}', { page: (pages[0] ?? currentPage) + 1 })}:{' '}
                <b>{typedPreview.length > 4 ? `${typedPreview.slice(0, 3).join(', ')}, … ${typedPreview.at(-1)}` : typedPreview.join(', ')}</b>
              </>
            ) : (
              msg('Type a label.')
            )}
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            {target === 'bookmark'
              ? msg('Draw a box around the sheet number, and another around the sheet title. Each page gets a bookmark named by the text in the same boxes, joined in order.')
              : msg('Draw a box around the sheet number (and more boxes to add the title, revision…). Each page gets the text in the same boxes, joined in order.')}
          </p>
          <button className={`btn small${drawing ? ' active' : ''}`} onClick={onDraw} disabled={readOnly}>
            {drawing ? msg('Drawing: drag a box on the page') : msg('+ Draw box')}
          </button>
          <ol className="lr-list">
            {regions.length === 0 && <li className="empty">{msg('No boxes yet.')}</li>}
            {regions.map((r, i) => (
              <li key={`${r.x},${r.y},${r.w},${r.h}`}>
                <span className="lr-num">{i + 1}</span>
                <span className="lr-text" title={msg('Text in this box on the current page')}>
                  {texts ? textInRegion(words, r) || <i>{msg('no text on this page')}</i> : '…'}
                </span>
                <button className="btn small flat" disabled={i === 0} onClick={() => move(i, -1)} title={msg('Move up')} aria-label={msg('Move up')}>
                  ↑
                </button>
                <button className="btn small flat" disabled={i === regions.length - 1} onClick={() => move(i, 1)} title={msg('Move down')} aria-label={msg('Move down')}>
                  ↓
                </button>
                <button className="btn small flat" onClick={() => onChange(regions.filter((_, j) => j !== i))} title={msg('Remove box')} aria-label={msg('Remove box')}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          <label className="lr-row">
            {keyed(msgParts('Join with{select}', { select: <select value={separator} onChange={(e) => setSeparator(e.target.value)}> <option value=" ">{msg('Space')}</option> <option value=" - ">" - "</option> <option value=" – ">" – "</option> <option value="_">_</option> <option value=": ">": "</option> <option value=" / ">" / "</option> <option value="">{msg('Nothing')}</option> </select> }))}
          </label>
          <div className="lr-preview">
            {keyed(msgParts('Page {page}: {b}', { page: currentPage + 1, b: <b>{preview === null ? msg('reading text…') : preview || '—'}</b> }))}
          </div>
        </>
      )}
      <fieldset className="lr-row">
        <legend>{msg('Set as')}</legend>
        <label>
          {keyed(msgParts('{input} Page label', { input: <input type="radio" checked={target === 'number'} onChange={() => chooseTarget('number')} /> }))}
        </label>
        <label>
          {keyed(msgParts('{input} Sheet title', { input: <input type="radio" checked={target === 'title'} onChange={() => chooseTarget('title')} /> }))}
        </label>
        <label title={msg('Name each page\'s bookmark, adding one for a page that has none')}>
          {keyed(msgParts('{input} Bookmark', { input: <input type="radio" checked={target === 'bookmark'} onChange={() => chooseTarget('bookmark')} /> }))}
        </label>
      </fieldset>
      <fieldset className="lr-row">
        <legend>{msg('Pages')}</legend>
        <label>
          {keyed(msgParts('{input} All ({pageCount})', { input: <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />, pageCount }))}
        </label>
        <label>
          {keyed(msgParts('{input} Current', { input: <input type="radio" checked={scope === 'current'} onChange={() => setScope('current')} /> }))}
        </label>
        <label>
          <input type="radio" checked={scope === 'range'} onChange={() => setScope('range')} />
          <input className="lr-range" value={range} placeholder="1-5, 8" onFocus={() => setScope('range')} onChange={(e) => setRange(e.target.value)} aria-label={msg('Page range')} />
        </label>
      </fieldset>
      <div className="lr-actions">
        <button className="btn small" onClick={onClose}>
          {msg('Cancel')}
        </button>
        <button
          className="btn small primary"
          disabled={readOnly || !pages.length || (source === 'typed' ? !label : !texts || !regions.length)}
          onClick={() => onApply(source === 'typed' ? typedLabels : pages.map((page) => ({ page, label: labelFromRegions(texts![page]?.words ?? [], regions, separator) })), target)}
        >
          {msg('Apply to {count, plural, one {# page} other {# pages}}', { count: pages.length })}
        </button>
      </div>
    </div>
  );
}
