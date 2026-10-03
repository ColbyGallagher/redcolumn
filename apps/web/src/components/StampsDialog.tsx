import { useEffect, useRef, useState } from 'react';
import { DEFAULT_STYLES, drawMarkup, resolveStamp, STAMP_FIELDS, stampAspect, type Markup, type StampDef } from '@nb/markup';
import { stampLibrary, updateWorkspace, useWorkspace } from '../workspace/profiles';

interface Props {
  author: string;
  onPlace: (stamp: StampDef) => void;
  onClose: () => void;
}

/** A stamp drawn as it would be placed now (fields filled in with sample values). */
export function StampPreview({ stamp, author, width = 180 }: { stamp: Pick<StampDef, 'lines' | 'frame' | 'color'>; author: string; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const content = resolveStamp(stamp, { user: author, file: 'Drawing.pdf', page: 'A-101', now: new Date() });
  const height = Math.max(24, Math.round(width / stampAspect(content)));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const m: Markup = {
      id: 'preview',
      type: 'stamp',
      pageIndex: 0,
      points: [
        [2, 2],
        [width - 2, height - 2],
      ],
      style: { ...DEFAULT_STYLES.stamp, stroke: stamp.color, width: 2 },
      stamp: content,
      status: 'none',
      author: '',
      createdAt: 0,
      modifiedAt: 0,
    };
    drawMarkup(ctx, m, 1);
  });
  return <canvas ref={ref} className="stamp-preview" style={{ width, height }} />;
}

/** Tools › Stamp › Manage Stamps: the stamp library, with an editor for your own stamps. */
export function StampsDialog({ author, onPlace, onClose }: Props) {
  const ws = useWorkspace();
  const library = stampLibrary(ws);
  const [pickedId, setPickedId] = useState<string>(ws.lastStampId ?? library[0]!.id);
  const picked = library.find((s) => s.id === pickedId) ?? library[0]!;
  const [draft, setDraft] = useState<StampDef | null>(null);
  const linesRef = useRef<HTMLTextAreaElement>(null);

  const save = (def: StampDef) => {
    updateWorkspace((w) => ({ ...w, stamps: w.stamps.some((s) => s.id === def.id) ? w.stamps.map((s) => (s.id === def.id ? def : s)) : [...w.stamps, def] }));
    setPickedId(def.id);
    setDraft(null);
  };
  const insertField = (token: string) => {
    const el = linesRef.current;
    if (!el || !draft) return;
    const text = el.value.slice(0, el.selectionStart) + token + el.value.slice(el.selectionEnd);
    setDraft({ ...draft, lines: text.split('\n') });
    requestAnimationFrame(() => el.focus());
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal stamps-dialog" role="dialog" aria-label="Stamps" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && (draft ? setDraft(null) : onClose())}>
        <h3>Stamps</h3>
        {!draft ? (
          <>
            <ul className="stamp-list" role="listbox" aria-label="Stamp library">
              {library.map((s) => (
                <li key={s.id} role="option" aria-selected={s.id === picked.id} className={s.id === picked.id ? 'picked' : ''} onClick={() => setPickedId(s.id)} onDoubleClick={() => onPlace(s)}>
                  <StampPreview stamp={s} author={author} width={150} />
                  <span className="name">{s.name}</span>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn" onClick={() => setDraft({ id: crypto.randomUUID(), name: 'New Stamp', lines: ['CHECKED', 'By {User} on {Date}'], color: '#1d4ed8', frame: 'rounded' })}>
                New…
              </button>
              <button className="btn" onClick={() => setDraft(picked.builtIn ? { ...picked, id: crypto.randomUUID(), name: `${picked.name} (copy)`, builtIn: undefined } : { ...picked })}>
                {picked.builtIn ? 'Copy and Edit…' : 'Edit…'}
              </button>
              <button
                className="btn"
                disabled={!!picked.builtIn}
                title={picked.builtIn ? 'Built-in stamps cannot be deleted' : undefined}
                onClick={() => {
                  if (!confirm(`Delete the stamp "${picked.name}"?`)) return;
                  updateWorkspace((w) => ({ ...w, stamps: w.stamps.filter((s) => s.id !== picked.id), lastStampId: w.lastStampId === picked.id ? null : w.lastStampId }));
                  setPickedId(library[0]!.id);
                }}
              >
                Delete
              </button>
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                Close
              </button>
              <button className="btn primary" onClick={() => onPlace(picked)}>
                Place
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.name.trim() && draft.lines.some((l) => l.trim())) save({ ...draft, name: draft.name.trim() });
            }}
          >
            <div className="form-grid">
              <label htmlFor="stamp-name">Name</label>
              <input id="stamp-name" value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <label htmlFor="stamp-lines">Wording</label>
              <textarea id="stamp-lines" ref={linesRef} rows={3} value={draft.lines.join('\n')} onChange={(e) => setDraft({ ...draft, lines: e.target.value.split('\n') })} />
              <span />
              <div className="field-chips">
                {STAMP_FIELDS.map((f) => (
                  <button key={f.token} type="button" className="btn small" title={`Insert ${f.label.toLowerCase()}, filled in when placed`} onClick={() => insertField(f.token)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <label htmlFor="stamp-color">Colour</label>
              <input id="stamp-color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
              <label htmlFor="stamp-frame">Frame</label>
              <select id="stamp-frame" value={draft.frame} onChange={(e) => setDraft({ ...draft, frame: e.target.value as StampDef['frame'] })}>
                <option value="rounded">Rounded</option>
                <option value="box">Square</option>
                <option value="none">None</option>
              </select>
            </div>
            <p className="pref-hint">The first line is the headline. Fields such as {'{Date}'} are filled in when the stamp is placed.</p>
            <div className="stamp-preview-row">
              <StampPreview stamp={draft} author={author} width={240} />
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!draft.name.trim() || !draft.lines.some((l) => l.trim())}>
                Save Stamp
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
