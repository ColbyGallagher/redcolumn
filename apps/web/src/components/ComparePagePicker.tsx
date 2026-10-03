import { useEffect, useRef, useState } from 'react';
import { affineFromPoints, type Affine } from '../compare/affine';
import type { Box } from '../compare/diff';

/** A page drawn for picking on: the image and the page's size in points. */
export interface PagePreview {
  url: string;
  width: number;
  height: number;
}

type Point = [number, number];

interface Common {
  /** Renders a page of a library document (index from 0). */
  preview: (fileId: string, page: number) => Promise<PagePreview>;
  onCancel: () => void;
}

type Props =
  | (Common & { mode: 'points'; old: { fileId: string; page: number }; cur: { fileId: string; page: number }; onDone: (transform: Affine) => void })
  | (Common & { mode: 'region'; cur: { fileId: string; page: number }; initial: Box | null; onDone: (region: Box | null) => void });

const COLORS = ['#e02020', '#1a8a1a', '#1a6cff'];

/** One page, fitted to its box, reporting clicks and drags in page points. */
function PageSurface({ preview, marks, region, onPoint, onRegion, label }: { preview: PagePreview | null; marks: Point[]; region?: Box | null; onPoint?: (p: Point) => void; onRegion?: (r: Box) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const toPage = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * preview!.width, ((e.clientY - r.top) / r.height) * preview!.height];
  };
  const shown = drag ? boxOf(drag.start, drag.end) : region;
  if (!preview) return <div className="compare-pick-page loading">Drawing {label.toLowerCase()}…</div>;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <figure className="compare-pick">
      <figcaption>{label}</figcaption>
      <div
        ref={ref}
        className="compare-pick-page"
        style={{ aspectRatio: `${preview.width} / ${preview.height}`, width: `min(100%, calc(60vh * ${preview.width / preview.height}))` }}
        aria-label={label}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = toPage(e);
          if (onRegion) {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDrag({ start: p, end: p });
          } else onPoint?.(p);
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, end: toPage(e) })}
        onPointerUp={() => {
          if (!drag) return;
          const b = boxOf(drag.start, drag.end);
          setDrag(null);
          if (b.w > 4 && b.h > 4) onRegion?.(b);
        }}
      >
        <img src={preview.url} alt="" draggable={false} />
        {marks.map((p, i) => (
          <span key={i} className="compare-pick-mark" style={{ left: pct(p[0], preview.width), top: pct(p[1], preview.height), borderColor: COLORS[i] }}>
            {i + 1}
          </span>
        ))}
        {shown && <span className="compare-pick-region" style={{ left: pct(shown.x, preview.width), top: pct(shown.y, preview.height), width: pct(shown.w, preview.width), height: pct(shown.h, preview.height) }} />}
      </div>
    </figure>
  );
}

function boxOf(a: Point, b: Point): Box {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

/**
 * Compare and Overlay helpers on the pages themselves: Align Pages (click the same three points
 * on the old page and the new, for revisions drawn at another scale or turned) and Select Region
 * (drag the part of the new page to compare).
 */
export function ComparePagePicker(props: Props) {
  const [oldPreview, setOldPreview] = useState<PagePreview | null>(null);
  const [curPreview, setCurPreview] = useState<PagePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oldPts, setOldPts] = useState<Point[]>([]);
  const [curPts, setCurPts] = useState<Point[]>([]);
  const [region, setRegion] = useState<Box | null>(props.mode === 'region' ? props.initial : null);
  const oldKey = props.mode === 'points' ? `${props.old.fileId}:${props.old.page}` : '';
  const curKey = `${props.cur.fileId}:${props.cur.page}`;

  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    const load = async () => {
      try {
        const cur = await props.preview(props.cur.fileId, props.cur.page);
        urls.push(cur.url);
        if (live) setCurPreview(cur);
        if (props.mode === 'points') {
          const old = await props.preview(props.old.fileId, props.old.page);
          urls.push(old.url);
          if (live) setOldPreview(old);
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldKey, curKey]);

  const transform = props.mode === 'points' && oldPts.length === 3 && curPts.length === 3 ? affineFromPoints(oldPts, curPts) : null;
  const add = (set: typeof setOldPts) => (p: Point) => set((list) => (list.length >= 3 ? list : [...list, p]));
  const next = props.mode === 'points' ? (oldPts.length <= curPts.length ? (oldPts.length < 3 ? `Click point ${oldPts.length + 1} on the old page.` : '') : `Click point ${curPts.length} on the new page, at the same spot.`) : '';

  return (
    <div className="modal-backdrop" onMouseDown={props.onCancel}>
      <div
        className="modal print-dialog compare-pick-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') props.onCancel();
        }}
      >
        <h3>{props.mode === 'points' ? 'Align Pages' : 'Select Region'}</h3>
        <p>
          {props.mode === 'points'
            ? 'Click three points on the old page, then the same three on the new page (grid intersections or title block corners work well), alternating or in turn. The old revision is then scaled, turned and moved to match.'
            : 'Drag a rectangle over the part of the new page to compare. Only differences inside it are found.'}
        </p>
        {error && <p className="print-error">{error}</p>}
        <div className="compare-pick-pages">
          {props.mode === 'points' && <PageSurface label="Old page" preview={oldPreview} marks={oldPts} onPoint={oldPts.length <= curPts.length ? add(setOldPts) : undefined} />}
          <PageSurface
            label={props.mode === 'points' ? 'New page' : 'Page'}
            preview={curPreview}
            marks={curPts}
            region={region}
            onPoint={props.mode === 'points' && curPts.length < oldPts.length ? add(setCurPts) : undefined}
            onRegion={props.mode === 'region' ? setRegion : undefined}
          />
        </div>
        {props.mode === 'points' && <p className="print-hint">{transform ? 'Three pairs picked.' : oldPts.length === 3 && curPts.length === 3 ? 'Those points are in a line: pick points spread over the page.' : next}</p>}
        <div className="actions">
          {props.mode === 'points' ? (
            <button
              type="button"
              className="btn"
              disabled={!oldPts.length}
              onClick={() => {
                setOldPts([]);
                setCurPts([]);
              }}
            >
              Start over
            </button>
          ) : (
            <button type="button" className="btn" disabled={!region} onClick={() => setRegion(null)}>
              Whole page
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={props.mode === 'points' ? !transform : false} onClick={() => (props.mode === 'points' ? transform && props.onDone(transform) : props.onDone(region))}>
            {props.mode === 'points' ? 'Align' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
