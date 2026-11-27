import { msg } from '@nb/i18n';
import { CAD_ACCEPT } from '../cad/files';
import { useRef, useState } from 'react';

/** Where the chosen files land in the current document. */
export type BulkInsertWhere = 'after' | 'start' | 'end';

interface Props {
  /** Files already chosen from disk, in the order they were picked. */
  initial: File[];
  /** 1-based number of the current page, for the "after" option. */
  currentPage: number;
  onInsert: (files: File[], where: BulkInsertWhere) => void;
  onCancel: () => void;
}

/** Document → Insert → Bulk Insert PDFs: several files inserted into this document at once, in the order listed. */
export function BulkInsertDialog({ initial, currentPage, onInsert, onCancel }: Props) {
  const [items, setItems] = useState<File[]>(initial);
  const [where, setWhere] = useState<BulkInsertWhere>('after');
  const [picked, setPicked] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setItems(next);
    setPicked(j);
  };
  const valid = items.length >= 1;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal combine-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onInsert(items, where);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>{msg('Bulk Insert PDFs')}</h3>
        <p>{msg('All pages of each file are inserted into this document, in this order.')}</p>
        <ol className="combine-list" role="listbox" aria-label={msg('Files to insert')}>
          {items.map((f, i) => (
            <li key={`${f.name}-${i}`} role="option" aria-selected={i === picked} className={i === picked ? 'picked' : ''} onClick={() => setPicked(i)}>
              <span className="name">{f.name}</span>
            </li>
          ))}
          {!items.length && <li className="empty">{msg('Add PDFs or pictures to insert.')}</li>}
        </ol>
        <div className="row">
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            {msg('Add Files…')}
          </button>
          <button type="button" className="btn" disabled={!items.length} onClick={() => move(picked, -1)} title={msg('Move up')}>
            ↑
          </button>
          <button type="button" className="btn" disabled={!items.length} onClick={() => move(picked, 1)} title={msg('Move down')}>
            ↓
          </button>
          <button
            type="button"
            className="btn"
            disabled={!items.length}
            onClick={() => {
              setItems(items.filter((_, i) => i !== picked));
              setPicked(Math.max(0, picked - 1));
            }}
          >
            {msg('Remove')}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={`application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp,${CAD_ACCEPT}`}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) setItems([...items, ...files]);
          }}
        />
        <div className="form-grid">
          <label htmlFor="bulk-insert-where">{msg('Insert')}</label>
          <select id="bulk-insert-where" value={where} onChange={(e) => setWhere(e.target.value as BulkInsertWhere)}>
            <option value="after">{msg('After page {currentPage}', { currentPage })}</option>
            <option value="start">{msg('At the start')}</option>
            <option value="end">{msg('At the end')}</option>
          </select>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {msg('Insert')}
          </button>
        </div>
      </form>
    </div>
  );
}
