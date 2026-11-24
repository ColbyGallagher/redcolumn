import { msg } from '@nb/i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_STYLES, DYNAMIC_FIELD_NAMES, drawMarkup, fillStampFieldsNow, isDynamicFieldName, onImageLoad, removeFieldToken, renameFieldToken, resolveStamp, setStampField, STAMP_FIELDS, stampAspect, stampFieldValues, stampFormColor, type Markup, type StampArtText, type StampDef, type StampField, type StampOption } from '@nb/markup';
import { importStampFiles, STAMP_FILE_ACCEPT } from '../stamps/imageStamps';
import { stampLibrary, updateWorkspace, useWorkspace } from '../workspace/profiles';

interface Props {
  author: string;
  onPlace: (stamp: StampDef) => void;
  onClose: () => void;
  /** Open straight into the editor for a new stamp. */
  creating?: boolean;
}

function blankStamp(): StampDef {
  return { id: crypto.randomUUID(), name: msg('New Stamp'), lines: ['CHECKED', 'By {User} on {Date}'], color: '#1d4ed8', frame: 'rounded' };
}

/** How far in from the preview's edge the stamp is drawn, so its frame is not cut off. */
const PREVIEW_INSET = 2;

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
        [PREVIEW_INSET, PREVIEW_INSET],
        [width - PREVIEW_INSET, height - PREVIEW_INSET],
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
 * A picture stamp's preview with a handle over each of its texts: drag one (or focus it and use the
 * arrow keys) to move that text. Positions are fractions of the stamp's box, kept inside it.
 */
function ArtTextPositioner({ stamp, author, width, values, onMove }: { stamp: StampDef; author: string; width: number; values?: Record<string, string>; onMove: (i: number, x: number, y: number) => void }) {
  const art = stamp.art!;
  const height = Math.max(24, Math.round(width / art.aspect));
  const drag = useRef<{ i: number; x: number; y: number; cx: number; cy: number } | null>(null);
  const clamp = (v: number, size: number) => Math.max(0, Math.min(1 - Math.min(1, size), v));
  // The preview draws the stamp inset by PREVIEW_INSET on each side: the handles follow it.
  const w = width - PREVIEW_INSET * 2;
  const h = height - PREVIEW_INSET * 2;
  return (
    <div className="stamp-art-positioner" style={{ width, height }}>
      <StampPreview stamp={stamp} author={author} width={width} values={values} />
      {art.texts.map((t, i) => (
        <div
          key={i}
          role="button"
          tabIndex={0}
          className="stamp-art-handle"
          aria-label={msg('Move text {number}', { number: i + 1 })}
          title={msg('{text} (drag to move)', { text: t.text })}
          style={{ left: PREVIEW_INSET + t.x * w, top: PREVIEW_INSET + t.y * h, width: t.w * w, height: t.h * h }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            drag.current = { i, x: t.x, y: t.y, cx: e.clientX, cy: e.clientY };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.i !== i) return;
            onMove(i, clamp(d.x + (e.clientX - d.cx) / w, t.w), clamp(d.y + (e.clientY - d.cy) / h, t.h));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.05 : 0.01;
            const by = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
            if (!by) return;
            e.preventDefault();
            onMove(i, clamp(t.x + by[0], t.w), clamp(t.y + by[1], t.h));
          }}
        />
      ))}
    </div>
  );
}

/**
 * A stamp's fields to fill in: each list of boxes as checkboxes (one ticked at a time), each blank
 * as a text box. Ticking a box fills in whatever it is set to fill in, straight away.
 */
export function StampFieldsForm({ fields, values, disabled, onChange }: { fields: StampField[]; values: Record<string, string>; disabled?: boolean; onChange: (values: Record<string, string>) => void }) {
  const listId = useId();
  const set = (id: string, value: string) => onChange(setStampField(fields, values, id, value));
  return (
    <div className="stamp-fields-form">
      {fields
        .filter((f) => f.label.trim())
        .map((f, index) => {
          const choicesId = `${listId}-choices-${index}`;
          const choices = f.kind === 'text' ? choicesOf(f) : [];
          const value = values[f.id] ?? '';
          return f.kind === 'choice' ? (
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
              {choices.length && !f.editable ? (
                <select value={value} disabled={disabled} onChange={(e) => set(f.id, e.target.value)}>
                  <option value="" />
                  {/* A value not in the list (typed before the list was made) stays pickable. */}
                  {[...choices, ...(value && !choices.includes(value) ? [value] : [])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  {/* A list you can also type in: its choices are suggested. */}
                  <input value={value} disabled={disabled} list={choices.length ? choicesId : undefined} onChange={(e) => set(f.id, e.target.value)} />
                  {choices.length > 0 && (
                    <datalist id={choicesId}>
                      {choices.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
            </label>
          );
        })}
    </div>
  );
}

/** A text field's values to pick from, blanks dropped. */
const choicesOf = (f: StampField) => [...new Set((f.choices ?? []).map((c) => c.trim()).filter(Boolean))];

/** What ticking a box also does, in words, for its tooltip. */
function optionHint(fields: StampField[], o: StampOption): string | undefined {
  const parts = Object.entries(o.sets ?? {})
    .map(([id, v]) => {
      const f = fields.find((x) => x.id === id);
      if (!f) return '';
      if (f.kind === 'choice') return v ? `ticks “${v}”` : `clears ${f.label}`;
      return v ? msg('sets {field} to “{value}”', { field: f.label, value: v }) : msg('clears {field}', { field: f.label });
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
  stamp: Pick<StampDef, 'name' | 'lines' | 'frame' | 'color' | 'fields' | 'art'>;
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
            {msg('Cancel')}
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

/** Longest field name: its {Label} must stay short enough to be read in the wording. */
const MAX_FIELD_NAME = 256;

/**
 * What is wrong with a field's name, if anything: a dynamic field's name (filled in by itself), or
 * another field's. Either would make its {Label} in the wording mean something else.
 */
function fieldNameProblem(fields: readonly StampField[], f: StampField): string | null {
  const label = f.label.trim();
  if (!label) return null;
  if (isDynamicFieldName(label)) return msg('\'{\'{label}\'}\' is filled in by itself when the stamp is placed. Give this field another name.', { label });
  if (fields.some((o) => o.id !== f.id && o.label.trim().toLowerCase() === label.toLowerCase())) return msg('Another field is called {label}. Give this field another name.', { label });
  return null;
}

/** A stamp's fields with names that clash renamed (Date 2), for stamps made before such names were refused. The wording is left alone. */
function withUsableFieldNames(def: StampDef): StampDef {
  if (!def.fields?.length) return def;
  const taken = new Set(DYNAMIC_FIELD_NAMES.map((n) => n.toLowerCase()));
  const fields = def.fields.map((f) => {
    const base = f.label.trim();
    if (!base) return f;
    let label = base;
    for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${base} ${n}`;
    taken.add(label.toLowerCase());
    return label === base ? f : { ...f, label };
  });
  return { ...def, fields };
}

const OPTION_COLOURS = ['#15803d', '#1d4ed8', '#b45309', '#b91c1c', '#6b7280'];

/**
 * The editor's Fields section: lists of boxes and blanks, and for each box what ticking it does
 * (the stamp's colour, other fields' values). No scripting: every rule is a row in a table.
 */
function StampFieldsBuilder({
  fields,
  onChange,
  onInsert,
  onRename,
  onAdded,
  onRemoved,
}: {
  fields: StampField[];
  onChange: (fields: StampField[]) => void;
  onInsert: (token: string) => void;
  /** A field was renamed: its {Label} in the wording follows. */
  onRename: (from: string, to: string) => void;
  /** A field was added (a picture stamp gives it a place). */
  onAdded?: (field: StampField) => void;
  /** A field was removed: where its {Label} is used, it goes too. */
  onRemoved: (field: StampField, label: string | undefined) => void;
}) {
  /**
   * Each field's last usable name, by id: the one its {Label} in the wording has. A name cleared,
   * or one a dynamic field has, is not used, so the {Label} waits for the next usable name.
   */
  const named = useRef(new Map<string, string>());
  const usable = (f: StampField, label: string) => !!label.trim() && !fieldNameProblem(fields, { ...f, label });
  for (const f of fields) if (!named.current.has(f.id) && usable(f, f.label)) named.current.set(f.id, f.label);
  const rename = (f: StampField, label: string) => {
    const prev = named.current.get(f.id) ?? '';
    if (!usable(f, label)) return;
    named.current.set(f.id, label);
    if (prev && prev.trim().toLowerCase() !== label.trim().toLowerCase()) onRename(prev, label);
  };
  const update = (i: number, patch: Partial<StampField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setOption = (i: number, k: number, patch: Partial<StampOption>) => update(i, { options: (fields[i]!.options ?? []).map((o, j) => (j === k ? { ...o, ...patch } : o)) });
  const move = (i: number, by: number) => {
    const next = [...fields];
    const [f] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, f!);
    onChange(next);
  };
  const add = (kind: StampField['kind']) => {
    const field: StampField =
      kind === 'choice'
        ? { id: crypto.randomUUID(), label: fields.some((f) => f.label === 'Action') ? msg('Boxes {count}', { count: fields.length + 1 }) : msg('Action'), kind, options: [{ label: msg('Approved'), color: '#15803d' }, { label: msg('Rejected'), color: '#b91c1c' }] }
        : { id: crypto.randomUUID(), label: msg('Field {count}', { count: fields.length + 1 }), kind, value: '' };
    onChange([...fields, field]);
    onAdded?.(field);
  };
  return (
    <div className="stamp-fields-builder">
      {fields.map((f, i) => {
        const others = fields.filter((o) => o.id !== f.id && o.label.trim());
        const problem = fieldNameProblem(fields, f);
        return (
          <div key={f.id} className="stamp-field-card">
            <div className="stamp-field-head">
              <span className="stamp-field-kind">{f.kind === 'choice' ? msg('Tick boxes') : msg('Text')}</span>
              <input
                aria-label={msg('Field name')}
                value={f.label}
                placeholder={msg('Field name')}
                maxLength={MAX_FIELD_NAME}
                aria-invalid={!!problem || undefined}
                onChange={(e) => {
                  // Braces would end the field's {Label} in the wording.
                  const label = e.target.value.replace(/[{}]/g, '').slice(0, MAX_FIELD_NAME);
                  update(i, { label });
                  rename(f, label);
                }}
              />
              <button type="button" className="btn small" title={msg('Use this field in the wording as \'{\'{label}\'}\'', { label: f.label })} onClick={() => onInsert(`{${f.label.trim()}}`)}>
                {msg('In wording')}
              </button>
              <button type="button" className="btn small" aria-label={msg('Move up')} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="btn small" aria-label={msg('Move down')} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="btn small"
                aria-label={msg('Remove {label}', { label: f.label })}
                onClick={() => {
                  onChange(fields.filter((_, j) => j !== i));
                  // Only the name its {Label} has is taken out of the wording.
                  onRemoved(f, named.current.get(f.id));
                }}
              >
                ✕
              </button>
            </div>
            {problem && (
              <p className="stamp-field-warning" role="alert">
                {problem}
              </p>
            )}
            {f.kind === 'text' ? (
              <>
                <label className="stamp-field-row">
                  <span>{msg('Starts as')}</span>
                  <input value={f.value ?? ''} placeholder={msg('Blank, or e.g. \'{\'User\'}\' or \'{\'Date\'}\'')} onChange={(e) => update(i, { value: e.target.value })} />
                </label>
                <label className="stamp-field-row" title={msg('Leave blank to type anything; otherwise the value is picked from this list, one per line')}>
                  <span>{msg('Pick from')}</span>
                  <textarea
                    aria-label={msg('{label} choices', { label: f.label })}
                    rows={Math.min(4, Math.max(1, (f.choices?.length ?? 0) + 1))}
                    value={(f.choices ?? []).join('\n')}
                    placeholder={msg('Any text (or one choice per line)')}
                    onChange={(e) => {
                      const choices = e.target.value.split('\n');
                      update(i, { choices: choices.some((c) => c.trim()) ? choices : undefined, ...(choices.some((c) => c.trim()) ? {} : { editable: undefined }) });
                    }}
                  />
                </label>
                {!!f.choices?.some((c) => c.trim()) && (
                  <label className="stamp-field-row stamp-field-check">
                    <input type="checkbox" checked={!!f.editable} onChange={(e) => update(i, { editable: e.target.checked || undefined })} />
                    <span>{msg('Other text can be typed too')}</span>
                  </label>
                )}
              </>
            ) : (
              <table className="stamp-options">
                <thead>
                  <tr>
                    <th title={msg('Ticked when the stamp is placed')}>{msg('Start')}</th>
                    <th>{msg('Box')}</th>
                    <th title={msg('Ticking it turns the stamp this colour')}>{msg('Colour')}</th>
                    {others.map((o) => (
                      <th key={o.id} title={msg('What ticking the box puts in {label} (left alone when blank)', { label: o.label })}>
                        {msg('Sets {label}', { label: o.label })}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(f.options ?? []).map((o, k) => (
                    <tr key={k}>
                      <td>
                        <input type="radio" name={`start-${f.id}`} aria-label={msg('Start with {label} ticked', { label: o.label })} checked={!!o.label && f.value === o.label} onChange={() => update(i, { value: o.label })} onClick={() => f.value === o.label && update(i, { value: '' })} />
                      </td>
                      <td>
                        <input
                          aria-label={msg('Box label')}
                          value={o.label}
                          onChange={(e) => {
                            const label = e.target.value;
                            update(i, { value: f.value === o.label ? label : f.value, options: (f.options ?? []).map((x, j) => (j === k ? { ...x, label } : x)) });
                          }}
                        />
                      </td>
                      <td className="stamp-option-colour">
                        <input type="checkbox" aria-label={msg('Recolour the stamp')} checked={!!o.color} onChange={(e) => setOption(i, k, { color: e.target.checked ? OPTION_COLOURS[k % OPTION_COLOURS.length] : undefined })} />
                        {o.color && <input type="color" aria-label={msg('Colour')} value={o.color} onChange={(e) => setOption(i, k, { color: e.target.value })} />}
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
                              <select aria-label={msg('Sets {label}', { label: other.label })} value={v === undefined ? '\u0000' : v} onChange={(e) => setTo(e.target.value === '\u0000' ? undefined : e.target.value)}>
                                <option value={'\u0000'}>—</option>
                                <option value="">{msg('Untick all')}</option>
                                {(other.options ?? []).filter((x) => x.label.trim()).map((x) => (
                                  <option key={x.label} value={x.label}>
                                    {msg('Tick {label}', { label: x.label })}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input aria-label={msg('Sets {label}', { label: other.label })} value={v ?? ''} placeholder="—" onChange={(e) => setTo(e.target.value || undefined)} />
                            )}
                          </td>
                        );
                      })}
                      <td>
                        <button type="button" className="btn small" aria-label={msg('Remove {label}', { label: o.label })} disabled={(f.options ?? []).length < 2} onClick={() => update(i, { options: (f.options ?? []).filter((_, j) => j !== k), value: f.value === o.label ? '' : f.value })}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {f.kind === 'choice' && (
              <button type="button" className="btn small" onClick={() => update(i, { options: [...(f.options ?? []), { label: msg('Option {count}', { count: (f.options ?? []).length + 1 }) }] })}>
                {msg('Add Box')}
              </button>
            )}
          </div>
        );
      })}
      <div className="stamp-fields-add">
        <button type="button" className="btn small" onClick={() => add('choice')}>
          {msg('Add Tick Boxes')}
        </button>
        <button type="button" className="btn small" onClick={() => add('text')}>
          {msg('Add Text Field')}
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
  /** Which of a picture stamp's texts was typed in last, for inserting fields into it. */
  const [artFocus, setArtFocus] = useState<number | null>(null);

  const save = (raw: StampDef) => {
    const def = raw.fields ? { ...raw, fields: raw.fields.map((f) => (f.choices || f.editable ? { ...f, choices: choicesOf(f).length ? choicesOf(f) : undefined, editable: choicesOf(f).length && f.editable ? true : undefined } : f)) } : raw;
    updateWorkspace((w) => ({ ...w, stamps: w.stamps.some((s) => s.id === def.id) ? w.stamps.map((s) => (s.id === def.id ? def : s)) : [...w.stamps, def] }));
    setPickedId(def.id);
    setDraft(null);
  };
  /** A picture stamp's texts changed: its lines follow (its name when it has none). */
  const setArtTexts = (fn: (texts: StampArtText[]) => StampArtText[]) =>
    setDraft((d) => {
      if (!d?.art) return d;
      const texts = fn(d.art.texts);
      return { ...d, art: { ...d.art, texts }, lines: texts.length ? texts.map((t) => t.text) : [d.name] };
    });
  const setArtText = (i: number, patch: Partial<StampArtText>) => setArtTexts((texts) => texts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  /** A new text on a picture stamp, across its width, below the texts it has. */
  const addArtText = (text: string) => {
    setArtFocus(draft?.art?.texts.length ?? 0);
    setArtTexts((texts) => [...texts, { text, x: 0.1, y: Math.min(0.8, 0.1 + texts.length * 0.2), w: 0.8, h: 0.18, size: 0.14, color: '#000000', bold: false, italic: false, align: 'center' }]);
  };
  const removeArtText = (i: number) => {
    setArtTexts((texts) => texts.filter((_, j) => j !== i));
    // The text typed in last keeps its place in the list.
    setArtFocus((at) => (at === null || at === i ? null : at > i ? at - 1 : at));
  };
  /** A field removed: a text that only showed it goes, and its {Label} goes from the rest of the wording. */
  const removeField = (_f: StampField, label: string | undefined) => {
    // A field never usably named has no {Label} of its own in the wording: nothing to take out.
    if (!label?.trim()) return;
    if (draft?.art) setArtFocus(null);
    setDraft((d) => {
      if (!d) return d;
      const strip = (t: string) => removeFieldToken(t, label);
      // Lines and texts that showed only the field go; ones that were blank before stay.
      const lines = d.lines.map(strip).filter((l, k) => l.trim() || !d.lines[k]!.trim());
      if (!d.art) return { ...d, lines };
      const texts = d.art.texts.map((t) => ({ ...t, text: strip(t.text) })).filter((t, k) => t.text.trim() || !d.art!.texts[k]!.text.trim());
      return { ...d, art: { ...d.art, texts }, lines: texts.length ? texts.map((t) => t.text) : [d.name] };
    });
  };
  const setFields = (fields: StampField[]) => setDraft((d) => (d ? { ...d, fields: fields.length ? fields : undefined } : d));
  /** A field renamed: wherever its {Label} is used, the new name. */
  const renameField = (from: string, to: string) =>
    setDraft((d) => {
      if (!d) return d;
      const lines = d.lines.map((l) => renameFieldToken(l, from, to));
      return d.art ? { ...d, lines, art: { ...d.art, texts: d.art.texts.map((t) => ({ ...t, text: renameFieldToken(t.text, from, to) })) } } : { ...d, lines };
    });
  const insertField = (token: string) => {
    if (draft?.art) {
      // Into the text last typed in, else as a new text.
      const at = artFocus;
      const el = at !== null ? document.getElementById(`stamp-text-${at}`) : null;
      if (at === null || !(el instanceof HTMLInputElement) || !draft.art.texts[at]) return addArtText(token);
      setArtText(at, { text: el.value.slice(0, el.selectionStart ?? el.value.length) + token + el.value.slice(el.selectionEnd ?? el.value.length) });
      requestAnimationFrame(() => el.focus());
      return;
    }
    const el = linesRef.current;
    if (!el || !draft) return;
    const text = el.value.slice(0, el.selectionStart) + token + el.value.slice(el.selectionEnd);
    setDraft({ ...draft, lines: text.split('\n') });
    requestAnimationFrame(() => el.focus());
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal stamps-dialog" role="dialog" aria-label={msg('Stamps')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && (draft ? setDraft(null) : onClose())}>
        <h3>{msg('Stamps')}</h3>
        {!draft ? (
          <>
            <ul className="stamp-list" role="listbox" aria-label={msg('Stamp library')}>
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
                {msg('New…')}
              </button>
              <button className="btn" title={msg('Import stamps from Bluebeam® Revu® (the PDFs in its Stamps folder), or pictures (PNG, JPEG, GIF, BMP, WebP)')} onClick={() => importRef.current?.click()}>
                {msg('Import…')}
              </button>
              <input
                ref={importRef}
                type="file"
                accept={STAMP_FILE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (!files.length) return;
                  setMessage(msg('Importing…'));
                  void importStampFiles(files).then(({ added, failed }) => {
                    if (added[0]) setPickedId(added[0].id);
                    const parts = [added.length ? msg('Imported {count, plural, one {# stamp} other {# stamps}}', { count: added.length }) : '', ...failed].filter(Boolean).map((m) => m.replace(/[.;\s]+$/, ''));
                    setMessage(parts.length ? `${parts.join('; ')}.` : msg('Nothing to import.'));
                  });
                }}
              />
              <button className="btn" onClick={() => setDraft(withUsableFieldNames(picked.builtIn ? { ...picked, id: crypto.randomUUID(), name: `${picked.name} (copy)`, builtIn: undefined } : { ...picked }))}>
                {picked.builtIn ? msg('Copy and Edit…') : msg('Edit…')}
              </button>
              <button
                className="btn"
                disabled={!!picked.builtIn}
                title={picked.builtIn ? msg('Built-in stamps cannot be deleted') : undefined}
                onClick={() => {
                  if (!confirm(msg('Delete the stamp "{name}"?', { name: picked.name }))) return;
                  updateWorkspace((w) => ({ ...w, stamps: w.stamps.filter((s) => s.id !== picked.id), lastStampId: w.lastStampId === picked.id ? null : w.lastStampId }));
                  setPickedId(library[0]!.id);
                }}
              >
                {msg('Delete')}
              </button>
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                {msg('Close')}
              </button>
              <button className="btn primary" onClick={() => onPlace(picked)}>
                {msg('Place')}
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.name.trim() && draft.lines.some((l) => l.trim()) && !draft.fields?.some((f) => fieldNameProblem(draft.fields!, f))) save({ ...draft, name: draft.name.trim() });
            }}
          >
            <div className="form-grid">
              <label htmlFor="stamp-name">{msg('Name')}</label>
              <input id="stamp-name" value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              {draft.art ? (
                <>
                  <label>{msg('Texts')}</label>
                  <div className="stamp-art-texts">
                    {draft.art.texts.map((t, i) => (
                      <div key={i} className="stamp-art-text">
                        <input
                          id={`stamp-text-${i}`}
                          aria-label={msg('Text {number}', { number: i + 1 })}
                          value={t.text}
                          onFocus={() => setArtFocus(i)}
                          onChange={(e) => setArtText(i, { text: e.target.value })}
                        />
                        <input type="number" aria-label={msg('Text {number} size', { number: i + 1 })} title={msg('Size, as a percentage of the stamp\'s height')} min={2} max={100} step={1} value={Math.round(t.size * 100)} onChange={(e) => setArtText(i, { size: Math.max(0.02, Math.min(1, Number(e.target.value) / 100 || t.size)) })} />
                        <input type="color" aria-label={msg('Text {number} colour', { number: i + 1 })} value={t.color} onChange={(e) => setArtText(i, { color: e.target.value })} />
                        <select aria-label={msg('Text {number} alignment', { number: i + 1 })} value={t.align} onChange={(e) => setArtText(i, { align: e.target.value as StampArtText['align'] })}>
                          <option value="left">{msg('Left')}</option>
                          <option value="center">{msg('Centre')}</option>
                          <option value="right">{msg('Right')}</option>
                        </select>
                        <label className="stamp-art-bold" title={msg('Bold')}>
                          <input type="checkbox" aria-label={msg('Text {number} bold', { number: i + 1 })} checked={t.bold} onChange={(e) => setArtText(i, { bold: e.target.checked })} />B
                        </label>
                        <button type="button" className="btn small" aria-label={msg('Remove text {number}', { number: i + 1 })} onClick={() => removeArtText(i)}>
                          ✕
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn small" onClick={() => addArtText('Text')}>
                      {msg('Add Text')}
                    </button>
                  </div>
                  <span />
                  <div className="field-chips">
                    {STAMP_FIELDS.map((f) => (
                      <button key={f.token} type="button" className="btn small" title={msg('Insert {label}, filled in when placed', { label: f.label.toLowerCase() })} onClick={() => insertField(f.token)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <label>{msg('Fields')}</label>
                  <StampFieldsBuilder fields={draft.fields ?? []} onChange={setFields} onInsert={insertField} onRename={renameField} onRemoved={removeField} onAdded={(f) => addArtText(`{${f.label}}`)} />
                </>
              ) : (
                <>
                  <label htmlFor="stamp-lines">{msg('Wording')}</label>
                  <textarea id="stamp-lines" ref={linesRef} rows={3} value={draft.lines.join('\n')} onChange={(e) => setDraft({ ...draft, lines: e.target.value.split('\n') })} />
                  <span />
                  <div className="field-chips">
                    {STAMP_FIELDS.map((f) => (
                      <button key={f.token} type="button" className="btn small" title={msg('Insert {label}, filled in when placed', { label: f.label.toLowerCase() })} onClick={() => insertField(f.token)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="stamp-color">{msg('Colour')}</label>
                  <input id="stamp-color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                  <label htmlFor="stamp-frame">{msg('Frame')}</label>
                  <select id="stamp-frame" value={draft.frame} onChange={(e) => setDraft({ ...draft, frame: e.target.value as StampDef['frame'] })}>
                    <option value="rounded">{msg('Rounded')}</option>
                    <option value="box">{msg('Square')}</option>
                    <option value="none">{msg('None')}</option>
                  </select>
                  <label>{msg('Fields')}</label>
                  <StampFieldsBuilder fields={draft.fields ?? []} onChange={setFields} onInsert={insertField} onRename={renameField} onRemoved={removeField} />
                </>
              )}
            </div>
            <p className="pref-hint">
              {draft.art
                ? msg('This stamp is a picture with text on it. Drag each text in the preview to place it. Fields such as \'{\'Date\'}\' are filled in when it is placed; a field shows where a text names it, such as \'{\'Checked by\'}\'. Fields are filled in when you place the stamp, and can be changed later by double-clicking it.')
                : msg('The first line is the headline. Fields such as \'{\'Date\'}\' are filled in when the stamp is placed. Tick boxes and text fields are filled in when you place the stamp, and can be changed later by double-clicking it.')}
            </p>
            <div className="stamp-preview-row">
              {draft.art ? (
                <ArtTextPositioner stamp={draft} author={author} width={300} values={sampleValues(draft.fields)} onMove={(i, x, y) => setArtText(i, { x, y })} />
              ) : (
                <StampPreview stamp={draft} author={author} width={240} values={sampleValues(draft.fields)} />
              )}
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                {msg('Cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={!draft.name.trim() || !draft.lines.some((l) => l.trim()) || !!draft.fields?.some((f) => fieldNameProblem(draft.fields!, f))}>
                {msg('Save Stamp')}
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
            aria-label={msg('Stamps')}
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
              <span className="label">{msg('New Stamp…')}</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => choose(onManage)}>
              <span className="check" />
              <span className="label">{msg('Manage Stamps…')}</span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
