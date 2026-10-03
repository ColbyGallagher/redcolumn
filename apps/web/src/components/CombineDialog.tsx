import { useRef, useState } from 'react';

/** A document to combine: an open tab (by file id) or a file chosen from disk. */
export type CombineSource = { kind: 'open'; id: string; name: string } | { kind: 'disk'; file: File; name: string };

interface Props {
  /** Documents open in tabs, listed first. */
  open: { id: string; name: string }[];
  onCombine: (sources: CombineSource[], name: string) => void;
  onCancel: () => void;
}

/** File → Combine: joins PDFs (and pictures) into one new PDF, in the order listed. */
export function CombineDialog({ open, onCombine, onCancel }: Props) {
  const [items, setItems] = useState<CombineSource[]>(() => open.map((o) => ({ kind: 'open', id: o.id, name: o.name })));
  const [name, setName] = useState('Combined.pdf');
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
  const valid = items.length >= 1 && name.trim() !== '';

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal combine-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCombine(items, /\.pdf$/i.test(name.trim()) ? name.trim() : `${name.trim()}.pdf`);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Combine</h3>
        <p>Pages are joined in this order into a new PDF. The originals are not changed.</p>
        <ol className="combine-list" role="listbox" aria-label="Documents to combine">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.name}-${i}`} role="option" aria-selected={i === picked} className={i === picked ? 'picked' : ''} onClick={() => setPicked(i)}>
              <span className="name">{it.name}</span>
              <span className="where">{it.kind === 'open' ? 'open' : 'from disk'}</span>
            </li>
          ))}
          {!items.length && <li className="empty">Add PDFs or pictures to combine.</li>}
        </ol>
        <div className="row">
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            Add Files…
          </button>
          <button type="button" className="btn" disabled={!items.length} onClick={() => move(picked, -1)} title="Move up">
            ↑
          </button>
          <button type="button" className="btn" disabled={!items.length} onClick={() => move(picked, 1)} title="Move down">
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
            Remove
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept="application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) setItems([...items, ...files.map((file) => ({ kind: 'disk' as const, file, name: file.name }))]);
          }}
        />
        <div className="form-grid">
          <label htmlFor="combine-name">File name</label>
          <input id="combine-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim()} />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            Combine
          </button>
        </div>
      </form>
    </div>
  );
}
