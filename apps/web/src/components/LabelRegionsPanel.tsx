import { useState } from 'react';
import type { PageText } from '@nb/sheets';
import { labelFromRegions, parsePageRange, textInRegion, type Region } from '../sheets/regions';

export type LabelTarget = 'number' | 'title';

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
  onApply: (labels: { page: number; label: string }[], target: LabelTarget) => void;
  onClose: () => void;
}

/**
 * Page labels from a page region: draw boxes around title-block text (sheet number,
 * title, ...); every chosen page is labelled with the text found in the same boxes, joined in
 * box order.
 */
export function LabelRegionsPanel({ regions, drawing, pageCount, currentPage, texts, readOnly, onDraw, onChange, onApply, onClose }: Props) {
  const [separator, setSeparator] = useState(' ');
  const [target, setTarget] = useState<LabelTarget>('number');
  const [scope, setScope] = useState<'all' | 'current' | 'range'>('all');
  const [range, setRange] = useState('');
  const words = texts?.[currentPage]?.words ?? [];
  const preview = texts ? labelFromRegions(words, regions, separator) : null;
  const pages = scope === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : scope === 'current' ? [currentPage] : parsePageRange(range, pageCount);
  const move = (i: number, d: number) => {
    const next = [...regions];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r!);
    onChange(next);
  };

  return (
    <div className="label-regions" role="dialog" aria-label="Page labels from regions">
      <div className="lr-head">
        <b>Page Labels from Regions</b>
        <button className="btn small flat" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>
      <p className="hint">Draw a box around the sheet number (and more boxes to add the title, revision…). Each page gets the text in the same boxes, joined in order.</p>
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
            <button className="btn small flat" disabled={i === 0} onClick={() => move(i, -1)} title="Move up" aria-label="Move up">
              ↑
            </button>
            <button className="btn small flat" disabled={i === regions.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label="Move down">
              ↓
            </button>
            <button className="btn small flat" onClick={() => onChange(regions.filter((_, j) => j !== i))} title="Remove box" aria-label="Remove box">
              ×
            </button>
          </li>
        ))}
      </ol>
      <label className="lr-row">
        Join with
        <select value={separator} onChange={(e) => setSeparator(e.target.value)}>
          <option value=" ">Space</option>
          <option value=" - ">" - "</option>
          <option value=" – ">" – "</option>
          <option value="_">_</option>
          <option value=": ">": "</option>
          <option value=" / ">" / "</option>
          <option value="">Nothing</option>
        </select>
      </label>
      <div className="lr-preview">
        Page {currentPage + 1}: <b>{preview === null ? 'reading text…' : preview || '—'}</b>
      </div>
      <fieldset className="lr-row">
        <legend>Set as</legend>
        <label>
          <input type="radio" checked={target === 'number'} onChange={() => setTarget('number')} /> Page label
        </label>
        <label>
          <input type="radio" checked={target === 'title'} onChange={() => setTarget('title')} /> Sheet title
        </label>
      </fieldset>
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
          onClick={() => onApply(pages.map((page) => ({ page, label: labelFromRegions(texts![page]?.words ?? [], regions, separator) })), target)}
        >
          Apply to {pages.length} page{pages.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
