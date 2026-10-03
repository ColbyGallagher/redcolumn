import { useState } from 'react';
import type { StoredStitchGroup } from '@nb/markup';
import type { SheetInfo } from '@nb/sheets';
import type { IndexProgress } from '../sheets/indexer';

interface Props {
  pageCount: number;
  currentPage: number;
  sheets: Readonly<Record<number, SheetInfo>>;
  progress: IndexProgress | null;
  /** Detected title-block scales that could be applied to pages without a scale. */
  applicableScales: number;
  onGoTo: (pageIndex: number) => void;
  onEdit: (pageIndex: number, patch: { number?: string | null; title?: string | null }) => void;
  onDetect: () => void;
  onAiIndex: () => void;
  onApplyScales: () => void;
  onCancel: () => void;
  stitchGroups: StoredStitchGroup[];
  onOpenStitch: (group: StoredStitchGroup) => void;
  onRestitch: () => void;
}

const SOURCE_BADGE: Record<SheetInfo['source'], string> = { text: 'auto', ai: 'AI', manual: 'edited' };

const PHASE_LABEL: Record<IndexProgress['phase'], string> = {
  annotations: 'Importing markups',
  text: 'Reading text',
  ai: 'AI reading title blocks',
  links: 'Finding links',
  stitch: 'Stitching match lines',
};

/** Sheet index: number and title per page, from the title block (offline) or AI, editable. */
export function SheetsPanel({ pageCount, currentPage, sheets, progress, applicableScales, onGoTo, onEdit, onDetect, onAiIndex, onApplyScales, onCancel, stitchGroups, onOpenStitch, onRestitch }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const unidentified = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !sheets[i]?.number).length;

  return (
    <div className="sheets">
      <div className="sheet-actions">
        <button className="btn small" disabled={!pageCount || !!progress} onClick={onDetect} title="Read sheet numbers and titles from the text layer (works offline)">
          Detect
        </button>
        <button className="btn small primary" disabled={!pageCount || !!progress} onClick={onAiIndex} title="Read title blocks with Claude (needs internet)">
          AI index
        </button>
        {applicableScales > 0 && (
          <button className="btn small" disabled={!!progress} onClick={onApplyScales} title="Set page scales from the scale printed in each title block">
            Apply {applicableScales} scale{applicableScales > 1 ? 's' : ''}
          </button>
        )}
      </div>
      {progress && (
        <div className="sheet-progress">
          <span>
            {PHASE_LABEL[progress.phase]} {progress.done}/{progress.total}
          </span>
          <button className="btn small" onClick={onCancel}>
            Stop
          </button>
          <progress max={progress.total} value={progress.done} />
        </div>
      )}
      {!progress && unidentified > 0 && Object.keys(sheets).length > 0 && (
        <p className="empty">{unidentified} page{unidentified > 1 ? 's' : ''} not identified — try AI index.</p>
      )}
      {stitchGroups.length > 0 && (
        <div className="stitch-groups">
          <h3>
            Stitched sets
            <button className="btn small" disabled={!!progress} onClick={onRestitch} title="Find match lines and align sheets again">
              Re-stitch
            </button>
          </h3>
          {stitchGroups.map((g, gi) => {
            const approximate = g.edges.filter((e) => e.votes === 0).length;
            return (
              <button key={gi} className="stitch-group" onClick={() => onOpenStitch(g)} title="Open as one continuous view">
                <span>{g.placements.map((p) => sheets[p.pageIndex]?.number ?? `p. ${p.pageIndex + 1}`).join(' → ')}</span>
                {approximate > 0 && <span className="badge low">{approximate} approximate</span>}
              </button>
            );
          })}
        </div>
      )}
      <ul>
        {Array.from({ length: pageCount }, (_, i) => {
          const s = sheets[i];
          const lowConfidence = s && s.source !== 'manual' && s.confidence < 0.5;
          return (
            <li key={i} className={i === currentPage ? 'active' : ''}>
              {editing === i ? (
                <form
                  className="sheet-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    onEdit(i, { number: String(data.get('number') ?? '').trim() || null, title: String(data.get('title') ?? '').trim() || null });
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                >
                  <input name="number" defaultValue={s?.number ?? ''} placeholder="Number" autoFocus />
                  <input name="title" defaultValue={s?.title ?? ''} placeholder="Title" />
                  <button className="btn small" type="submit">
                    Save
                  </button>
                </form>
              ) : (
                <button className="sheet" onClick={() => onGoTo(i)} onDoubleClick={() => setEditing(i)} title="Click to open, double-click to edit">
                  <span className="num">{s?.number ?? `p. ${i + 1}`}</span>
                  <span className="name">{s?.title ?? (s ? 'Untitled' : '')}</span>
                  {s && (
                    <span className={`badge ${s.source}${lowConfidence ? ' low' : ''}`} title={lowConfidence ? 'Low confidence — please check' : undefined}>
                      {lowConfidence ? '?' : SOURCE_BADGE[s.source]}
                    </span>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
