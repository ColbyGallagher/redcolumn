import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useState } from 'react';
import type { PageText } from '@nb/sheets';
import type { Scale } from '@nb/measure';
import { parsePageRange, scaleFromRegions, textInRegion, type Region } from '../sheets/regions';
import { rangeText } from '../measure/scalePresets';

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
  onDraw: () => void;
  onChange: (regions: Region[]) => void;
  onApply: (scales: { page: number; scale: Scale | null }[]) => void;
  onClose: () => void;
}

/**
 * Bulk page scales from a page region: draw a box around the scale note in the title block; every
 * chosen page gets the scale read from the same box.
 */
export function ScaleRegionsPanel({ regions, drawing, pageCount, currentPage, texts, readOnly, initialPages, onDraw, onChange, onApply, onClose }: Props) {
  const single = initialPages?.length === 1 && initialPages[0] === currentPage;
  const [scope, setScope] = useState<'all' | 'current' | 'range'>(initialPages?.length ? (single ? 'current' : 'range') : 'all');
  const [range, setRange] = useState(initialPages?.length && !single ? rangeText(initialPages) : '');
  const words = texts?.[currentPage]?.words ?? [];
  const preview = texts ? scaleFromRegions(words, regions) : null;
  const pages = scope === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : scope === 'current' ? [currentPage] : parsePageRange(range, pageCount);

  return (
    <div className="label-regions" role="dialog" aria-label={msg('Page scales from regions')}>
      <div className="lr-head">
        <b>{msg('Bulk Apply Page Scale')}</b>
        <button className="btn small flat" onClick={onClose} title={msg('Close')} aria-label={msg('Close')}>
          ×
        </button>
      </div>
      <p className="hint">{msg('Draw a box around the scale note (e.g. 1/8" = 1\'-0" or 1:100). Each page gets the scale read from the same box.')}</p>
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
            <button className="btn small flat" onClick={() => onChange(regions.filter((_, j) => j !== i))} title={msg('Remove box')} aria-label={msg('Remove box')}>
              ×
            </button>
          </li>
        ))}
      </ol>
      <div className="lr-preview">
        {keyed(msgParts('Page {page}: {b}', { page: currentPage + 1, b: <b>{texts === null ? msg('reading text…') : preview?.label || msg('no scale found')}</b> }))}
      </div>
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
          disabled={readOnly || !texts || !regions.length || !pages.length}
          onClick={() => onApply(pages.map((page) => ({ page, scale: scaleFromRegions(texts![page]?.words ?? [], regions) })))}
        >
          {msg('Apply to {count, plural, one {# page} other {# pages}}', { count: pages.length })}
        </button>
      </div>
    </div>
  );
}
