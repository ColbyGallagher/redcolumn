import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_STYLES, drawMarkup, fillStampFieldsNow, onImageLoad, resolveStamp, setStampField, STAMP_FIELDS, stampAspect, stampFieldValues, stampFormColor, type Markup, type StampDef, type StampField, type StampOption } from '@nb/markup';
import { importRevuStamps } from '../stamps/revuStamps';
import { stampLibrary, updateWorkspace, useWorkspace } from '../workspace/profiles';

interface Props {
  author: string;
  onPlace: (stamp: StampDef) => void;
  onClose: () => void;
  /** Open straight into the editor for a new stamp. */
  creating?: boolean;
}

function blankStamp(): StampDef {
  return { id: crypto.randomUUID(), name: 'New Stamp', lines: ['CHECKED', 'By {User} on {Date}'], color: '#1d4ed8', frame: 'rounded' };
}

/** A stamp drawn as it would be placed now (fields filled in with sample values, or `values`). */
export function StampPreview({ stamp, author, width = 180, values }: { stamp: Pick<StampDef, 'lines' | 'frame' | 'color' | 'art' | 'fields'>; author: string; width?: number; values?: Record<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // A stamp's picture loads after the first draw.
  const [, setLoaded] = useState(0);
  useEffect(() => onImageLoad(() => setLoaded((n) => n + 1)), []);
  const content = resolveStamp(stamp, { user: author, file: 'Drawing.pdf', page: 'A-101', now: new Date() }, values);
  const color = content.form ? stampFormColor(content.form.fields, content.form.values, stamp.color) : stamp.color;
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
      style: { ...DEFAULT_STYLES.stamp, stroke: color, width: 2 },
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

/**
 * A stamp's fields to fill in: each list of boxes as checkboxes (one ticked at a time), each blank
 * as a text box. Ticking a box fills in whatever it is set to fill in, straight away.
 */
export function StampFieldsForm({ fields, values, disabled, onChange }: { fields: StampField[]; values: Record<string, string>; disabled?: boolean; onChange: (values: Record<string, string>) => void }) {
  const set = (id: string, value: string) => onChange(setStampField(fields, values, id, value));
  return (
    <div className="stamp-fields-form">
      {fields
        .filter((f) => f.label.trim())
        .map((f) =>
          f.kind === 'choice' ? (
            <fieldset key={f.id} className="stamp-choice">
              <legend>{f.label}</legend>
              {(f.options ?? [])
                .filter((o) => o.label.trim())
                .map((o) => (
                  <label key={o.label} className="stamp-option" title={optionHint(fields, o)}>
                    <input type="checkbox" checked={values[f.id] === o.label} disabled={disabled} onChange={() => set(f.id, o.label)} />
                    {o.color && <span className="stamp-option-swatch" style={{ background: o.color }} aria-hidden="true" />}
                    <span>{o.label}</span>
                  </label>
                ))}
            </fieldset>
          ) : (
            <label key={f.id} className="stamp-text-field">
              <span>{f.label}</span>
              <input value={values[f.id] ?? ''} disabled={disabled} onChange={(e) => set(f.id, e.target.value)} />
            </label>
          ),
        )}
    </div>
  );
}

/** What ticking a box also does, in words, for its tooltip. */
function optionHint(fields: StampField[], o: StampOption): string | undefined {
  const parts = Object.entries(o.sets ?? {})
    .map(([id, v]) => {
      const f = fields.find((x) => x.id === id);
      if (!f) return '';
      if (f.kind === 'choice') return v ? `ticks “${v}”` : `clears ${f.label}`;
      return v ? `sets ${f.label} to “${v}”` : `clears ${f.label}`;
    })
    .filter(Boolean);
  return parts.length ? `Also ${parts.join(', ')}` : undefined;
}

/**
 * Fill in a stamp's fields, before it is placed or (on a placed stamp) to change them. The preview
 * follows every tick.
 */
export function FillStampDialog({
  stamp,
  author,
  initial,
  title,
  applyLabel,
  onApply,
  onCancel,
}: {
  stamp: Pick<StampDef, 'name' | 'lines' | 'frame' | 'color' | 'fields'>;
  author: string;
  initial?: Record<string, string>;
  title: string;
  applyLabel: string;
  onApply: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const fields = stamp.fields ?? [];
  // Before placing, {User} and {Date} show as what they will be.
  const [values, setValues] = useState<Record<string, string>>(() => (initial ? { ...stampFieldValues(fields), ...initial } : fillStampFieldsNow(fields, stampFieldValues(fields), author)));
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal stamps-dialog fill-stamp"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(values);
        }}
      >
        <h3>{title}</h3>
        <div className="fill-stamp-body">
          <StampFieldsForm fields={fields} values={values} onChange={setValues} />
          <div className="stamp-preview-row">
            <StampPreview stamp={stamp} author={author} width={260} values={values} />
          </div>
        </div>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" autoFocus>
            {applyLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/** For the editor's preview: lists of boxes with none ticked to start show their first ticked. */
function sampleValues(fields: StampField[] | undefined): Record<string, string> | undefined {
  if (!fields?.length) return undefined;
  let values = stampFieldValues(fields);
  for (const f of fields) if (f.kind === 'choice' && !values[f.id] && f.options?.[0]?.label) values = setStampField(fields, values, f.id, f.options[0].label);
  return values;
}

const OPTION_COLOURS = ['#15803d', '#1d4ed8', '#b45309', '#b91c1c', '#6b7280'];

/**
 * The editor's Fields section: lists of boxes and blanks, and for each box what ticking it does
 * (the stamp's colour, other fields' values). No scripting: every rule is a row in a table.
 */
function StampFieldsBuilder({ fields, onChange, onInsert }: { fields: StampField[]; onChange: (fields: StampField[]) => void; onInsert: (token: string) => void }) {
  const update = (i: number, patch: Partial<StampField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setOption = (i: number, k: number, patch: Partial<StampOption>) => update(i, { options: (fields[i]!.options ?? []).map((o, j) => (j === k ? { ...o, ...patch } : o)) });
  const move = (i: number, by: number) => {
    const next = [...fields];
    const [f] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, f!);
    onChange(next);
  };
  const add = (kind: StampField['kind']) =>
    onChange([
      ...fields,
      kind === 'choice'
        ? { id: crypto.randomUUID(), label: fields.some((f) => f.label === 'Action') ? `Boxes ${fields.length + 1}` : 'Action', kind, options: [{ label: 'Approved', color: '#15803d' }, { label: 'Rejected', color: '#b91c1c' }] }
        : { id: crypto.randomUUID(), label: `Field ${fields.length + 1}`, kind, value: '' },
    ]);
  return (
    <div className="stamp-fields-builder">
      {fields.map((f, i) => {
        const others = fields.filter((o) => o.id !== f.id && o.label.trim());
        return (
          <div key={f.id} className="stamp-field-card">
            <div className="stamp-field-head">
              <span className="stamp-field-kind">{f.kind === 'choice' ? 'Tick boxes' : 'Text'}</span>
              <input aria-label="Field name" value={f.label} placeholder="Field name" onChange={(e) => update(i, { label: e.target.value })} />
              <button type="button" className="btn small" title={`Use this field in the wording as {${f.label}}`} onClick={() => onInsert(`{${f.label.trim()}}`)}>
                In wording
              </button>
              <button type="button" className="btn small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="btn small" aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="btn small" aria-label={`Remove ${f.label}`} onClick={() => onChange(fields.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            {f.kind === 'text' ? (
              <label className="stamp-field-row">
                <span>Starts as</span>
                <input value={f.value ?? ''} placeholder="Blank, or e.g. {User} or {Date}" onChange={(e) => update(i, { value: e.target.value })} />
              </label>
            ) : (
              <table className="stamp-options">
                <thead>
                  <tr>
                    <th title="Ticked when the stamp is placed">Start</th>
                    <th>Box</th>
                    <th title="Ticking it turns the stamp this colour">Colour</th>
                    {others.map((o) => (
                      <th key={o.id} title={`What ticking the box puts in ${o.label} (left alone when blank)`}>
                        Sets {o.label}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(f.options ?? []).map((o, k) => (
                    <tr key={k}>
                      <td>
                        <input type="radio" name={`start-${f.id}`} aria-label={`Start with ${o.label} ticked`} checked={!!o.label && f.value === o.label} onChange={() => update(i, { value: o.label })} onClick={() => f.value === o.label && update(i, { value: '' })} />
                      </td>
                      <td>
                        <input
                          aria-label="Box label"
                          value={o.label}
                          onChange={(e) => {
                            const label = e.target.value;
                            update(i, { value: f.value === o.label ? label : f.value, options: (f.options ?? []).map((x, j) => (j === k ? { ...x, label } : x)) });
                          }}
                        />
                      </td>
                      <td className="stamp-option-colour">
                        <input type="checkbox" aria-label="Recolour the stamp" checked={!!o.color} onChange={(e) => setOption(i, k, { color: e.target.checked ? OPTION_COLOURS[k % OPTION_COLOURS.length] : undefined })} />
                        {o.color && <input type="color" aria-label="Colour" value={o.color} onChange={(e) => setOption(i, k, { color: e.target.value })} />}
                      </td>
                      {others.map((other) => {
                        const v = o.sets?.[other.id];
                        const setTo = (value: string | undefined) => {
                          const sets = { ...o.sets };
                          if (value === undefined) delete sets[other.id];
                          else sets[other.id] = value;
                          setOption(i, k, { sets: Object.keys(sets).length ? sets : undefined });
                        };
                        return (
                          <td key={other.id}>
                            {other.kind === 'choice' ? (
                              <select aria-label={`Sets ${other.label}`} value={v === undefined ? '\u0000' : v} onChange={(e) => setTo(e.target.value === '\u0000' ? undefined : e.target.value)}>
                                <option value={'\u0000'}>—</option>
                                <option value="">Untick all</option>
                                {(other.options ?? []).filter((x) => x.label.trim()).map((x) => (
                                  <option key={x.label} value={x.label}>
                                    Tick {x.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input aria-label={`Sets ${other.label}`} value={v ?? ''} placeholder="—" onChange={(e) => setTo(e.target.value || undefined)} />
                            )}
                          </td>
                        );
                      })}
                      <td>
                        <button type="button" className="btn small" aria-label={`Remove ${o.label}`} disabled={(f.options ?? []).length < 2} onClick={() => update(i, { options: (f.options ?? []).filter((_, j) => j !== k), value: f.value === o.label ? '' : f.value })}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {f.kind === 'choice' && (
              <button type="button" className="btn small" onClick={() => update(i, { options: [...(f.options ?? []), { label: `Option ${(f.options ?? []).length + 1}` }] })}>
                Add Box
              </button>
            )}
          </div>
        );
      })}
      <div className="stamp-fields-add">
        <button type="button" className="btn small" onClick={() => add('choice')}>
          Add Tick Boxes
        </button>
        <button type="button" className="btn small" onClick={() => add('text')}>
          Add Text Field
        </button>
      </div>
    </div>
  );
}

/** Tools › Stamp › Manage Stamps: the stamp library, with an editor for your own stamps. */
export function StampsDialog({ author, onPlace, onClose, creating = false }: Props) {
  const ws = useWorkspace();
  const library = stampLibrary(ws);
  const [pickedId, setPickedId] = useState<string>(ws.lastStampId ?? library[0]!.id);
  const picked = library.find((s) => s.id === pickedId) ?? library[0]!;
  const [draft, setDraft] = useState<StampDef | null>(() => (creating ? blankStamp() : null));
  const linesRef = useRef<HTMLTextAreaElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

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
            {message && (
              <p className="pref-hint" role="status" onClick={() => setMessage(null)}>
                {message}
              </p>
            )}
            <div className="actions">
              <button className="btn" onClick={() => setDraft(blankStamp())}>
                New…
              </button>
              <button className="btn" title="Import stamps from Bluebeam® Revu® (the PDFs in its Stamps folder)" onClick={() => importRef.current?.click()}>
                Import…
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (!files.length) return;
                  setMessage('Importing…');
                  void importRevuStamps(files).then(({ added, failed }) => {
                    if (added[0]) setPickedId(added[0].id);
                    setMessage([added.length ? `Imported ${added.length} stamp${added.length === 1 ? '' : 's'}.` : '', ...failed].filter(Boolean).join(' ') || 'Nothing to import.');
                  });
                }}
              />
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
              {draft.art ? (
                draft.art.texts.map((t, i) => (
                  <Fragment key={i}>
                    <label htmlFor={`stamp-text-${i}`}>Text {draft.art!.texts.length > 1 ? i + 1 : ''}</label>
                    <input
                      id={`stamp-text-${i}`}
                      value={t.text}
                      onChange={(e) => {
                        const texts = draft.art!.texts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x));
                        setDraft({ ...draft, art: { ...draft.art!, texts }, lines: texts.map((x) => x.text) });
                      }}
                    />
                  </Fragment>
                ))
              ) : (
                <>
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
                  <label>Fields</label>
                  <StampFieldsBuilder fields={draft.fields ?? []} onChange={(fields) => setDraft({ ...draft, fields: fields.length ? fields : undefined })} onInsert={insertField} />
                </>
              )}
            </div>
            <p className="pref-hint">
              {draft.art
                ? 'This stamp is a picture with text on it. Change the text here; fields such as {Date} are filled in when it is placed.'
                : 'The first line is the headline. Fields such as {Date} are filled in when the stamp is placed. Tick boxes and text fields are filled in when you place the stamp, and can be changed later by double-clicking it.'}
            </p>
            <div className="stamp-preview-row">
              <StampPreview stamp={draft} author={author} width={240} values={sampleValues(draft.fields)} />
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

/** Where the stamp menu sits: under the toolbar button, kept on screen. */
function menuBox(button: HTMLElement, menu: HTMLElement): { left: number; top: number; maxHeight: number } {
  const r = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
  const top = r.bottom + 4;
  return { left, top, maxHeight: Math.max(160, window.innerHeight - top - 8) };
}

/**
 * The toolbar's Stamp button. Clicking it opens every stamp in the library, each drawn as it
 * will look on the page. Choosing one arms the Stamp tool with it.
 */
export function StampMenu({
  icon,
  disabled,
  active,
  title,
  author,
  currentId,
  onPlace,
  onNew,
  onManage,
}: {
  icon: ReactNode;
  disabled: boolean;
  /** The Stamp tool is the one in use. */
  active: boolean;
  title: string;
  author: string;
  /** Library id of the stamp the tool is armed with. */
  currentId: string | null;
  onPlace: (stamp: StampDef) => void;
  onNew: () => void;
  onManage: () => void;
}) {
  const ws = useWorkspace();
  const library = stampLibrary(ws);
  const marked = currentId ?? ws.lastStampId;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const next = menuBox(buttonRef.current, menuRef.current);
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight ? p : next));
  }, [open, library.length]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      focused.current = false;
      return;
    }
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onResize = () => {
      if (buttonRef.current && menuRef.current) {
        const next = menuBox(buttonRef.current, menuRef.current);
        setPos(next);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open || !pos || focused.current) return;
    focused.current = true;
    const menu = menuRef.current;
    const current = menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (current ?? menu?.querySelector<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]'))?.focus();
  }, [open, pos]);

  const choose = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i < 0 ? 0 : (i + 1) % items.length) : i <= 0 ? items.length - 1 : i - 1;
    items[next]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn tool${active || open ? ' active' : ''}`}
        data-toolbar-tool="stamp"
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {icon}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="stamp-menu"
            role="menu"
            aria-label="Stamps"
            style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}
            onKeyDown={onMenuKey}
          >
            <div className="stamp-menu-list">
              {library.map((s) => (
                <button key={s.id} type="button" role="menuitemradio" aria-checked={s.id === marked} className={`stamp-menu-item${s.id === marked ? ' current' : ''}`} onClick={() => choose(() => onPlace(s))}>
                  <span className="stamp-menu-preview" aria-hidden="true">
                    <StampPreview stamp={s} author={author} width={156} />
                  </span>
                  <span className="name">{s.name}</span>
                </button>
              ))}
            </div>
            <div className="menu-sep" role="separator" />
            <button type="button" role="menuitem" className="menu-item" onClick={() => choose(onNew)}>
              <span className="check" />
              <span className="label">New Stamp…</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => choose(onManage)}>
              <span className="check" />
              <span className="label">Manage Stamps…</span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
