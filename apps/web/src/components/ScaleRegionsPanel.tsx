import { useState } from 'react';
import type { PageText } from '@nb/sheets';
import type { Scale } from '@nb/measure';
import { parsePageRange, scaleFromRegions, textInRegion, type Region } from '../sheets/regions';

interface Props {
  regions: Region[];
  drawing: boolean;
  pageCount: number;
  currentPage: number;
  /** Every page's text, once loaded. */
  texts: PageText[] | null;
  readOnly: boolean;
  onDraw: () => void;
  onChange: (regions: Region[]) => void;
  onApply: (scales: { page: number; scale: Scale | null }[]) => void;
  onClose: () => void;
}

/**
 * Bulk page scales from a page region: draw a box around the scale note in the title block; every
 * chosen page gets the scale read from the same box.
 */
export function ScaleRegionsPanel({ regions, drawing, pageCount, currentPage, texts, readOnly, onDraw, onChange, onApply, onClose }: Props) {
  const [scope, setScope] = useState<'all' | 'current' | 'range'>('all');
  const [range, setRange] = useState('');
  const words = texts?.[currentPage]?.words ?? [];
  const preview = texts ? scaleFromRegions(words, regions) : null;
  const pages = scope === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : scope === 'current' ? [currentPage] : parsePageRange(range, pageCount);

  return (
    <div className="label-regions" role="dialog" aria-label="Page scales from regions">
      <div className="lr-head">
        <b>Bulk Apply Page Scale</b>
        <button className="btn small flat" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>
      <p className="hint">Draw a box around the scale note (e.g. 1/8" = 1'-0" or 1:100). Each page gets the scale read from the same box.</p>
      <button className={`btn small${drawing ? ' active' : ''}`} onClick={onDraw} disabled={readOnly}>
        {drawing ? 'Drawing: drag a box on the page' : '+ Draw box'}
      </button>
      <ol className="lr-list">
        {regions.length === 0 && <li className="empty">No boxes yet.</li>}
        {regions.map((r, i) => (
          <li key={`${r.x},${r.y},${r.w},${r.h}`}>
            <span className="lr-num">{i + 1}</span>
            <span className="lr-text" title="Text in this box on the current page">
              {texts ? textInRegion(words, r) || <i>no text on this page</i> : '…'}
            </span>
            <button className="btn small flat" onClick={() => onChange(regions.filter((_, j) => j !== i))} title="Remove box" aria-label="Remove box">
              ×
            </button>
          </li>
        ))}
      </ol>
      <div className="lr-preview">
        Page {currentPage + 1}: <b>{texts === null ? 'reading text…' : preview?.label || 'no scale found'}</b>
      </div>
      <fieldset className="lr-row">
        <legend>Pages</legend>
        <label>
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All ({pageCount})
        </label>
        <label>
          <input type="radio" checked={scope === 'current'} onChange={() => setScope('current')} /> Current
        </label>
        <label>
          <input type="radio" checked={scope === 'range'} onChange={() => setScope('range')} />
          <input className="lr-range" value={range} placeholder="1-5, 8" onFocus={() => setScope('range')} onChange={(e) => setRange(e.target.value)} aria-label="Page range" />
        </label>
      </fieldset>
      <div className="lr-actions">
        <button className="btn small" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn small primary"
          disabled={readOnly || !texts || !regions.length || !pages.length}
          onClick={() => onApply(pages.map((page) => ({ page, scale: scaleFromRegions(texts![page]?.words ?? [], regions) })))}
        >
          Apply to {pages.length} page{pages.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
