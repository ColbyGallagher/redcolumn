import { useState } from 'react';
import type { ListColumn } from '../columns/listColumns';

export interface ExportRequest {
  format: 'csv' | 'pdf';
  /** Only the markups the list shows (filtered), or all of them. */
  scope: 'shown' | 'all';
  /** PDF: a summary on its own (comments only), or the document with the summary appended. */
  layout: 'summary' | 'append';
  columnKeys: string[];
  title: string;
}

interface Props {
  docName: string;
  shownCount: number;
  totalCount: number;
  columns: ListColumn[];
  visibleKeys: string[];
  busy: boolean;
  onExport: (req: ExportRequest) => void;
  onClose: () => void;
}

/** Export markups as CSV or a PDF summary. */
export function ExportDialog({ docName, shownCount, totalCount, columns, visibleKeys, busy, onExport, onClose }: Props) {
  const [format, setFormat] = useState<'csv' | 'pdf'>('pdf');
  const [scope, setScope] = useState<'shown' | 'all'>(shownCount < totalCount ? 'shown' : 'all');
  const [layout, setLayout] = useState<'summary' | 'append'>('summary');
  const [keys, setKeys] = useState<string[]>(visibleKeys);
  const [title, setTitle] = useState(docName.replace(/\.pdf$/i, ''));
  const ordered = [...columns].sort((a, b) => {
    const ia = visibleKeys.indexOf(a.key);
    const ib = visibleKeys.indexOf(b.key);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal export-dialog" role="dialog" aria-label="Export markups" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Export Markup Summary</h3>
        <div className="export-grid">
          <div>
            <h4>Format</h4>
            <div className="choice-cards">
              <button className={`choice-card${format === 'pdf' ? ' active' : ''}`} onClick={() => setFormat('pdf')}>
                <b>PDF</b>
                <span>A formatted report to print or share</span>
              </button>
              <button className={`choice-card${format === 'csv' ? ' active' : ''}`} onClick={() => setFormat('csv')}>
                <b>CSV</b>
                <span>For Excel and other spreadsheets</span>
              </button>
            </div>

            {format === 'pdf' && (
              <>
                <h4>Layout</h4>
                <div className="choice-cards">
                  <button className={`choice-card${layout === 'summary' ? ' active' : ''}`} onClick={() => setLayout('summary')}>
                    <b>Comments only</b>
                    <span>Just the markup table, without the drawings</span>
                  </button>
                  <button className={`choice-card${layout === 'append' ? ' active' : ''}`} onClick={() => setLayout('append')}>
                    <b>Original + summary</b>
                    <span>The marked-up document, with the summary appended at the end</span>
                  </button>
                </div>
                <label className="col-field">
                  <span>Title</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
              </>
            )}

            <h4>Markups</h4>
            <label className="radio">
              <input type="radio" checked={scope === 'shown'} onChange={() => setScope('shown')} disabled={shownCount === totalCount} /> Only those shown in the list ({shownCount})
            </label>
            <label className="radio">
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All markups ({totalCount})
            </label>
          </div>
          <div>
            <h4>
              Columns <small className="hint-text">({keys.length})</small>
            </h4>
            <ul className="export-cols">
              {ordered.map((c) => (
                <li key={c.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={keys.includes(c.key)}
                      onChange={(e) => setKeys((k) => (e.target.checked ? ordered.filter((x) => k.includes(x.key) || x.key === c.key).map((x) => x.key) : k.filter((x) => x !== c.key)))}
                    />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!keys.length || busy} onClick={() => onExport({ format, scope, layout, columnKeys: keys, title: title.trim() || docName })}>
            {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
