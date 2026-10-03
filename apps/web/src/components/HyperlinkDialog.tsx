import { useState } from 'react';
import { normalizeUrl, type LinkAction, type Place } from '@nb/markup';
import { ComparePagePicker, type PagePreview } from './ComparePagePicker';

interface Props {
  initial: LinkAction | undefined;
  pageCount: number;
  /** A page's label for the page list (e.g. "A-101 Ground floor plan", else "Page 3"). */
  pageLabel: (pageIndex: number) => string;
  places: readonly Place[];
  /** The page to suggest for a new link. */
  currentPage: number;
  onApply: (action: LinkAction) => void;
  onCancel: () => void;
  /** Removes the action (markups other than hyperlinks keep existing without one). */
  onRemove?: () => void;
  /** This document, and other library documents a link can open. */
  fileId: string;
  files: readonly { id: string; name: string }[];
  /** Renders a page, for choosing the area a link zooms to (Snapshot View). */
  preview: (fileId: string, page: number) => Promise<PagePreview>;
}

type Kind = LinkAction['kind'];

/**
 * Tools › Hyperlink › Define Action: where clicking the link goes. A page (whole, or a zoomed view
 * kept from the existing link), a Place (a named view that can move without breaking links), or a
 * web address.
 */
export function HyperlinkDialog({ initial, pageCount, pageLabel, places, currentPage, onApply, onCancel, onRemove, fileId, files, preview }: Props) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'page');
  const [page, setPage] = useState(initial?.kind === 'page' ? initial.pageIndex : Math.min(currentPage + 1, pageCount - 1));
  const [keepView, setKeepView] = useState(initial?.kind === 'page' && !!initial.rect);
  const [placeId, setPlaceId] = useState(initial?.kind === 'place' ? initial.placeId : (places[0]?.id ?? ''));
  const [url, setUrl] = useState(initial?.kind === 'url' ? initial.url : '');
  // Snapshot View: an area of the target page to zoom to.
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(initial?.kind === 'page' ? initial.rect : null);
  const [picking, setPicking] = useState(false);
  const others = files.filter((f) => f.id !== fileId);
  const [otherId, setOtherId] = useState(initial?.kind === 'file' ? initial.fileId : (others[0]?.id ?? ''));
  const [otherPage, setOtherPage] = useState(initial?.kind === 'file' ? initial.pageIndex + 1 : 1);

  const action = (): LinkAction | null => {
    if (kind === 'url') return url.trim() ? { kind: 'url', url: normalizeUrl(url) } : null;
    if (kind === 'place') return placeId ? { kind: 'place', placeId } : null;
    if (kind === 'file') {
      const f = files.find((x) => x.id === otherId);
      if (!f) return null;
      if (initial?.kind === 'file' && initial.fileId === f.id && initial.pageIndex === otherPage - 1) return initial;
      return { kind: 'file', fileId: f.id, name: f.name, pageIndex: Math.max(0, otherPage - 1), rect: null };
    }
    return { kind: 'page', pageIndex: page, rect: keepView ? view : null };
  };
  const ready = action();

  if (picking)
    return (
      <ComparePagePicker
        mode="region"
        preview={preview}
        cur={{ fileId, page }}
        initial={view}
        onCancel={() => setPicking(false)}
        onDone={(r) => {
          setView(r);
          setKeepView(!!r);
          setPicking(false);
        }}
      />
    );

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal hyperlink-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onApply(ready);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Action</h3>
        <label className="row">
          <input type="radio" name="kind" checked={kind === 'page'} onChange={() => setKind('page')} autoFocus={kind === 'page'} />
          Jump to page
          <select value={page} aria-label="Page" disabled={kind !== 'page'} onChange={(e) => setPage(Number(e.target.value))}>
            {Array.from({ length: pageCount }, (_, i) => (
              <option key={i} value={i}>
                {pageLabel(i)}
              </option>
            ))}
          </select>
        </label>
        {kind === 'page' && (
          <div className="row indent">
            <label className="check">
              <input type="checkbox" checked={keepView && !!view} disabled={!view} onChange={(e) => setKeepView(e.target.checked)} />
              Zoom to an area (Snapshot View)
            </label>
            <button type="button" className="btn small" onClick={() => setPicking(true)}>
              {view ? 'Change area…' : 'Choose area…'}
            </button>
          </div>
        )}
        <label className="row">
          <input type="radio" name="kind" checked={kind === 'place'} disabled={!places.length} onChange={() => setKind('place')} />
          Jump to Place
          <select value={placeId} aria-label="Place" disabled={kind !== 'place' || !places.length} onChange={(e) => setPlaceId(e.target.value)}>
            {!places.length && <option value="">No Places yet (add them on the Bookmarks panel)</option>}
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {pageLabel(p.pageIndex)}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <input type="radio" name="kind" checked={kind === 'file'} disabled={!others.length} onChange={() => setKind('file')} />
          Open document
          <select value={otherId} aria-label="Document" disabled={kind !== 'file' || !others.length} onChange={(e) => setOtherId(e.target.value)}>
            {!others.length && <option value="">No other documents in the library</option>}
            {others.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          page
          <input type="number" min={1} value={otherPage} aria-label="Page in that document" disabled={kind !== 'file'} style={{ width: 56 }} onChange={(e) => setOtherPage(Math.max(1, Math.round(Number(e.target.value)) || 1))} />
        </label>
        <label className="row">
          <input type="radio" name="kind" checked={kind === 'url'} onChange={() => setKind('url')} />
          Open web page
          <input
            type="text"
            value={url}
            aria-label="Web address"
            placeholder="https://…"
            autoFocus={kind === 'url'}
            onFocus={() => setKind('url')}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <div className="actions">
          {onRemove && initial && (
            <button type="button" className="btn" onClick={onRemove}>
              Remove Action
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
