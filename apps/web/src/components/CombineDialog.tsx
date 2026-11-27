import { msg } from '@nb/i18n';
import { CAD_ACCEPT } from '../cad/files';
import { useRef, useState } from 'react';
import { ReorderButtons, ReorderList, useReorderList } from './ReorderList';

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
  const [name, setName] = useState('Combined.pdf');
  const input = useRef<HTMLInputElement>(null);
  const files = useReorderList<CombineSource>(() => open.map((o) => ({ kind: 'open', id: o.id, name: o.name })));
  const valid = files.items.length >= 1 && name.trim() !== '';

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal combine-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCombine(files.items, /\.pdf$/i.test(name.trim()) ? name.trim() : `${name.trim()}.pdf`);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>{msg('Combine')}</h3>
        <p>{msg('Pages are joined in this order into a new PDF. The originals are not changed.')}</p>
        <ReorderList
          state={files}
          label={msg('Documents to combine')}
          empty={msg('Add PDFs or pictures to combine.')}
          nameOf={(source) => source.name}
          noteOf={(source) => (source.kind === 'open' ? msg('open') : msg('from disk'))}
        />
        <div className="row">
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            {msg('Add Files…')}
          </button>
          <ReorderButtons state={files} />
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={`application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp,${CAD_ACCEPT}`}
          onChange={(e) => {
            const chosen = [...(e.target.files ?? [])];
            e.target.value = '';
            if (chosen.length) files.add(chosen.map((file) => ({ kind: 'disk', file, name: file.name })));
          }}
        />
        <div className="form-grid">
          <label htmlFor="combine-name">{msg('File name')}</label>
          <input id="combine-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim()} />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {msg('Combine')}
          </button>
        </div>
      </form>
    </div>
  );
}
