import { msg } from '@nb/i18n';
import { useState } from 'react';
import { scaleMismatches, type Point, type Portal } from '@nb/markup';

interface Props {
  pageCount: number;
  /** A page's name in the list (its sheet number, else "Page n"). */
  pageLabel: (pageIndex: number) => string;
  /** What a page's scale is, compared between pages: pages with the same key are calibrated alike. */
  scaleKey: (pageIndex: number) => string;
  /** A page's scale as people read it, for the warning. */
  scaleText: (pageIndex: number) => string;
  /** The document's portals (Portals… lists and edits these). */
  portals: readonly Portal[];
  /** A portal just outlined: its linked pages are chosen here. */
  draft?: { pageIndex: number; points: Point[] } | null;
  onSave: (portal: Portal) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/**
 * Takeoff › Define Portal and Portals… (Experimental): the pages a portal links. Markups drawn
 * wholly inside it on any of these pages are mirrored to the rest, at the same page coordinates.
 */
export function PortalDialog({ pageCount, pageLabel, scaleKey, scaleText, portals, draft, onSave, onRemove, onClose }: Props) {
  const [editing, setEditing] = useState<string>(draft ? '' : (portals[0]?.id ?? ''));
  const current = draft ? null : portals.find((p) => p.id === editing) ?? null;
  const sourcePage = draft ? draft.pageIndex : (current?.sourcePage ?? 0);
  const [name, setName] = useState(current?.name ?? `Portal ${portals.length + 1}`);
  const [pages, setPages] = useState<Set<number>>(new Set(draft ? [draft.pageIndex] : (current?.pages ?? [])));

  const pick = (id: string) => {
    setEditing(id);
    const p = portals.find((x) => x.id === id);
    setName(p?.name ?? '');
    setPages(new Set(p?.pages ?? []));
  };
  const toggle = (i: number) =>
    setPages((was) => {
      const next = new Set(was);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const chosen = [...pages].sort((a, b) => a - b);
  const mismatched = scaleMismatches({ pages: chosen, sourcePage }, scaleKey);
  const valid = chosen.length >= 2 && chosen.includes(sourcePage) && !!(draft || current);

  const save = () => {
    if (!valid) return;
    if (draft) onSave({ id: crypto.randomUUID(), name: name.trim() || 'Portal', points: draft.points, pages: chosen, sourcePage });
    else if (current) onSave({ ...current, name: name.trim() || current.name, pages: chosen });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal portal-dialog"
        role="dialog"
        aria-label={draft ? msg('Define Portal') : msg('Portals')}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{msg('{value} (Experimental)', { value: draft ? msg('Define Portal') : msg('Portals') })}</h3>
        <p className="pref-hint">
          {msg('Markups drawn wholly inside the portal on any linked page are copied to the other linked pages, at the same place on each, and kept in step. Markups that cross its edge stay on their own page.')}
        </p>
        {!draft && !portals.length && <p>{msg('This document has no portals. Use Define Portal to outline one.')}</p>}
        {!draft && portals.length > 0 && (
          <div className="form-grid">
            <label htmlFor="portal-pick">{msg('Portal')}</label>
            <select id="portal-pick" value={editing} onChange={(e) => pick(e.target.value)}>
              {portals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {(draft || current) && (
          <>
            <div className="form-grid">
              <label htmlFor="portal-name">{msg('Name')}</label>
              <input id="portal-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <fieldset className="portal-pages">
              <legend>{msg('Linked pages')}</legend>
              <div style={{ maxHeight: 240, overflow: 'auto' }}>
                {Array.from({ length: pageCount }, (_, i) => (
                  <label key={i} style={{ display: 'block' }}>
                    <input type="checkbox" checked={pages.has(i)} disabled={i === sourcePage} onChange={() => toggle(i)} /> {pageLabel(i)}
                    {i === sourcePage ? ' ' + msg('(outlined here)') : ''}
                  </label>
                ))}
              </div>
            </fieldset>
            {mismatched.length > 0 && (
              <p className="pref-hint portal-scale-warning" role="alert">
                {msg('Warning: {list} {value} a different scale from {pageLabel} ({scaleText}). Mirrored measurements will not match on {value2}.', { list: mismatched.map(pageLabel).join(', '), value: mismatched.length === 1 ? msg('has') : msg('have'), pageLabel: pageLabel(sourcePage), scaleText: scaleText(sourcePage), value2: mismatched.length === 1 ? msg('it') : msg('them') })}
              </p>
            )}
            {current && <p className="pref-hint">{msg('A page you link gets a copy of every markup already mirrored. A page you unlink keeps its copies, as ordinary markups.')}</p>}
            {chosen.length < 2 && <p className="pref-hint">{msg('Pick at least one other page.')}</p>}
          </>
        )}
        <div className="actions">
          {current && (
            <button type="button" className="btn danger" onClick={() => onRemove(current.id)}>
              {msg('Remove Portal')}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {draft || current ? msg('Cancel') : msg('Close')}
          </button>
          {(draft || current) && (
            <button type="submit" className="btn primary" disabled={!valid}>
              {draft ? msg('Create Portal') : msg('Save')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
