import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_LINE_SETS,
  DEFAULT_STYLES,
  DRAFT_COMPONENT_KINDS,
  draftProblem,
  drawMarkup,
  fromDraft,
  newComponent,
  parseBlx,
  toDraft,
  uniqueName,
  writeBlx,
  type CustomLine,
  type Dropped,
  type DraftComponent,
  type DraftLine,
  type LineSet,
  type LineStyleDraft,
  type Markup,
  type Point,
  type SymbolPoint,
} from '@nb/markup';
import { updateWorkspace, useWorkspace } from '../workspace/profiles';

/** Opens the line style manager from anywhere (the pickers' "Manage…" entry). */
export const MANAGE_LINE_STYLES_EVENT = 'nb-manage-line-styles';
export const openLineStyles = () => window.dispatchEvent(new CustomEvent(MANAGE_LINE_STYLES_EVENT));

/** The set new and copied styles go into when the user has none of their own yet. */
const MY_SET = 'My Line Styles';

/** A set as the dialog lists it: built-in ones are read-only, the user's are at `index` in the profile. */
type SetRef = { builtIn: true; index: number } | { builtIn: false; index: number };

interface Editing {
  /** The user set the style goes in when saved (null: a new "My Line Styles", made on save). */
  setIndex: number | null;
  /** The style it replaces (null: added at the end). */
  styleIndex: number | null;
  draft: LineStyleDraft;
  /** The stored style being edited: saved back as it was when nothing is changed, so an imported pattern keeps every detail. */
  original?: CustomLine;
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '_')}.blx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A line style drawn along a straight run and a bend, as a markup in it would draw. */
export function LineStylePreview({ style, width = 220, height = 36, lineWidth = 1, color = '#1f2937' }: { style: CustomLine; width?: number; height?: number; lineWidth?: number; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const pad = Math.min(height / 2 - 2, 10);
    const points: Point[] = height > 60 ? [[pad, height - pad], [width * 0.45, height - pad], [width * 0.7, pad], [width - pad, pad]] : [[pad, height / 2], [width - pad, height / 2]];
    const m: Markup = {
      id: 'preview',
      type: 'polyline',
      pageIndex: 0,
      points,
      style: { ...DEFAULT_STYLES.polyline, stroke: color, width: lineWidth, lineStyle: style, dash: undefined, dashArray: undefined },
      status: 'none',
      author: '',
      createdAt: 0,
      modifiedAt: 0,
    };
    try {
      drawMarkup(ctx, m, 1);
    } catch {
      // A half-made pattern in the editor can fail to lay out; the preview just stays blank.
    }
  });
  return <canvas ref={ref} className="line-style-preview" style={{ width, height }} />;
}

/** A number box that lets the user clear it while typing. */
function Num({ value, onChange, step = 0.5, min, label, width = 64 }: { value: number; onChange: (n: number) => void; step?: number; min?: number; label: string; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // Only an outside change resets what is typed.
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="number"
      aria-label={label}
      title={label}
      step={step}
      min={min}
      value={text}
      style={{ width }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        // Below the minimum is taken as a number still being typed (0 on the way to 0.5).
        if (e.target.value.trim() !== '' && Number.isFinite(n) && (min === undefined || n >= min)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
};

function RowButtons({ index, count, what, onMove, onRemove, extra }: { index: number; count: number; what: string; onMove: (to: number) => void; onRemove: () => void; extra?: ReactNode }) {
  return (
    <span className="ls-row-buttons">
      {extra}
      <button type="button" className="btn small flat" aria-label={`Move ${what} up`} title="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}>
        ↑
      </button>
      <button type="button" className="btn small flat" aria-label={`Move ${what} down`} title="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        ↓
      </button>
      <button type="button" className="btn small flat" aria-label={`Remove ${what}`} title="Remove" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

/**
 * A symbol's outline on a grid: click to add a point (snapped to half units), with the line it sits
 * on and the length it takes along it shown. y is up, as the pattern stores it.
 */
function SymbolCanvas({ c, onChange }: { c: Extract<DraftComponent, { kind: 'vector' }>; onChange: (c: Extract<DraftComponent, { kind: 'vector' }>) => void }) {
  const reach = Math.ceil(Math.max(4, c.left + 1, c.right + 1, ...c.points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) + 1)));
  const size = 180;
  const unit = size / (reach * 2);
  const toPx = (x: number, y: number) => [size / 2 + x * unit, size / 2 - y * unit] as const;
  const d = c.points
    .map((p, i) => {
      const [x, y] = toPx(p.x, p.y);
      if (i === 0 || p.type === 'start') return `M${x} ${y}`;
      if (p.type !== 'curve') return `L${x} ${y}`;
      // A curve is drawn once its third point is in; until then its points show joined.
      let run = 0;
      for (let k = i; k > 0 && c.points[k]!.type === 'curve'; k--) run++;
      if (run % 3) return '';
      const [a, b] = [c.points[i - 2]!, c.points[i - 1]!].map((q) => toPx(q.x, q.y));
      return `C${a![0]} ${a![1]} ${b![0]} ${b![1]} ${x} ${y}`;
    })
    .join(' ');
  const grid: ReactNode[] = [];
  for (let k = -reach; k <= reach; k++) {
    const [gx] = toPx(k, 0);
    const [, gy] = toPx(0, k);
    grid.push(<line key={`v${k}`} x1={gx} y1={0} x2={gx} y2={size} className={k === 0 ? 'axis' : ''} />, <line key={`h${k}`} x1={0} y1={gy} x2={size} y2={gy} className={k === 0 ? 'axis' : ''} />);
  }
  const [l0] = toPx(-c.left, 0);
  const [r0] = toPx(c.right, 0);
  return (
    <svg
      className="ls-symbol-canvas"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Symbol outline: click to add a point"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = Math.round((((e.clientX - box.left) / box.width) * size - size / 2) / unit / 0.5) * 0.5;
        const y = Math.round(((size / 2 - ((e.clientY - box.top) / box.height) * size) / unit) / 0.5) * 0.5;
        onChange({ ...c, points: [...c.points, { type: c.points.length && !e.shiftKey ? 'line' : 'start', x, y }] });
      }}
    >
      <rect x={Math.min(l0, r0)} y={0} width={Math.abs(r0 - l0)} height={size} className="extent" />
      <g className="grid">{grid}</g>
      <path d={d} className={c.fill ? 'shape filled' : 'shape'} />
      {c.points.map((p, i) => {
        const [x, y] = toPx(p.x, p.y);
        return <circle key={i} cx={x} cy={y} r={p.type === 'start' || i === 0 ? 3.5 : 2.5} className={p.type === 'curve' ? 'pt curve' : 'pt'} />;
      })}
    </svg>
  );
}

function ComponentFields({ c, onChange }: { c: DraftComponent; onChange: (c: DraftComponent) => void }) {
  switch (c.kind) {
    case 'dash':
    case 'space':
      return (
        <label className="ls-field">
          Length <Num label="Length" value={c.width} min={0} onChange={(width) => onChange({ ...c, width })} />
        </label>
      );
    case 'text':
      return (
        <>
          <label className="ls-field">
            Text <input aria-label="Text" value={c.text} style={{ width: 70 }} onChange={(e) => onChange({ ...c, text: e.target.value })} />
          </label>
          <label className="ls-field">
            Font
            <select aria-label="Font" value={/times/i.test(c.font) ? 'Times-Roman' : /courier/i.test(c.font) ? 'Courier' : 'Helvetica'} onChange={(e) => onChange({ ...c, font: e.target.value })}>
              <option value="Helvetica">Sans</option>
              <option value="Times-Roman">Serif</option>
              <option value="Courier">Mono</option>
            </select>
          </label>
          <label className="ls-field">
            Size <Num label="Font size" value={c.size} min={0.5} onChange={(size) => onChange({ ...c, size })} width={56} />
          </label>
          <label className="ls-check">
            <input type="checkbox" checked={c.bold} onChange={(e) => onChange({ ...c, bold: e.target.checked })} /> Bold
          </label>
          <label className="ls-check">
            <input type="checkbox" checked={c.italic} onChange={(e) => onChange({ ...c, italic: e.target.checked })} /> Italic
          </label>
          <label className="ls-check" title="Turn the text over on lines drawn right to left, so it never reads upside down">
            <input type="checkbox" checked={c.upright} onChange={(e) => onChange({ ...c, upright: e.target.checked })} /> Keep upright
          </label>
        </>
      );
    case 'vector':
      return (
        <div className="ls-symbol">
          <div className="ls-symbol-props">
            <label className="ls-field" title="Length along the line before the symbol's origin">
              Left <Num label="Length before the origin" value={c.left} min={0} onChange={(left) => onChange({ ...c, left })} />
            </label>
            <label className="ls-field" title="Length along the line after the symbol's origin">
              Right <Num label="Length after the origin" value={c.right} min={0} onChange={(right) => onChange({ ...c, right })} />
            </label>
            <label className="ls-field">
              Scale <Num label="Symbol scale" value={c.scale} min={0.05} step={0.1} onChange={(scale) => onChange({ ...c, scale })} />
            </label>
            <label className="ls-check">
              <input type="checkbox" checked={c.fill} onChange={(e) => onChange({ ...c, fill: e.target.checked })} /> Filled
            </label>
          </div>
          <div className="ls-symbol-body">
            <SymbolCanvas c={c} onChange={onChange} />
            <div className="ls-points">
              <table>
                <thead>
                  <tr>
                    <th>Point</th>
                    <th>X</th>
                    <th>Y</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {c.points.map((p, i) => {
                    const set = (patch: Partial<SymbolPoint>) => onChange({ ...c, points: c.points.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
                    return (
                      <tr key={i}>
                        <td>
                          <select aria-label={`Point ${i + 1} type`} value={i === 0 ? 'start' : p.type} disabled={i === 0} onChange={(e) => set({ type: e.target.value as SymbolPoint['type'] })}>
                            <option value="start">Move to</option>
                            <option value="line">Line to</option>
                            <option value="curve">Curve</option>
                          </select>
                        </td>
                        <td>
                          <Num label={`Point ${i + 1} x`} value={p.x} onChange={(x) => set({ x })} width={52} />
                        </td>
                        <td>
                          <Num label={`Point ${i + 1} y`} value={p.y} onChange={(y) => set({ y })} width={52} />
                        </td>
                        <td>
                          <button type="button" className="btn small flat" aria-label={`Remove point ${i + 1}`} onClick={() => onChange({ ...c, points: c.points.filter((_, j) => j !== i) })}>
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="pref-hint">Click the grid to add a point; Shift-click starts a new stroke. Curves take three points: two control points, then the end.</p>
              {c.points.length > 0 && (
                <button type="button" className="btn small" onClick={() => onChange({ ...c, points: [] })}>
                  Clear points
                </button>
              )}
            </div>
          </div>
        </div>
      );
  }
}

function LineEditor({ line, index, count, onChange, onMove, onRemove }: { line: DraftLine; index: number; count: number; onChange: (l: DraftLine) => void; onMove: (to: number) => void; onRemove: () => void }) {
  const [adding, setAdding] = useState<DraftComponent['kind']>('dash');
  const setComponents = (components: DraftComponent[]) => onChange({ ...line, components });
  return (
    <fieldset className="ls-line">
      <legend>
        Line {index + 1}
        <RowButtons index={index} count={count} what={`line ${index + 1}`} onMove={onMove} onRemove={onRemove} />
      </legend>
      <label className="ls-field" title="Distance to the left of the drawn path (negative: to the right)">
        Offset <Num label={`Line ${index + 1} offset`} value={line.offset} onChange={(offset) => onChange({ ...line, offset })} />
      </label>
      {line.components.length === 0 && <p className="pref-hint">No components: this line draws solid.</p>}
      <ol className="ls-components">
        {line.components.map((c, i) => (
          <li key={i}>
            <span className="ls-kind">{DRAFT_COMPONENT_KINDS.find((k) => k.kind === c.kind)!.label}</span>
            <ComponentFields c={c} onChange={(n) => setComponents(line.components.map((x, j) => (j === i ? n : x)))} />
            <RowButtons index={i} count={line.components.length} what={`component ${i + 1}`} onMove={(to) => setComponents(move(line.components, i, to))} onRemove={() => setComponents(line.components.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <div className="ls-add">
        <select aria-label="Component type to add" value={adding} onChange={(e) => setAdding(e.target.value as DraftComponent['kind'])}>
          {DRAFT_COMPONENT_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn small" onClick={() => setComponents([...line.components, newComponent(adding)])}>
          Add component
        </button>
      </div>
    </fieldset>
  );
}

function StyleEditor({ editing, takenNames, onSave, onCancel }: { editing: Editing; takenNames: string[]; onSave: (style: CustomLine) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(editing.draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(editing.draft);
  /** Leaves the editor, asking first when there are changes to lose. */
  const cancel = () => {
    if (!changed || confirm('Discard the changes to this line style?')) onCancel();
  };
  const [lineWidth, setLineWidth] = useState(2);
  const problem = draftProblem(draft) ?? (takenNames.includes(draft.name.trim()) ? 'Another line style in this set has that name.' : null);
  const preview = fromDraft(draft);
  const setLines = (lines: DraftLine[]) => setDraft({ ...draft, lines });
  return (
    <div className="modal-backdrop" onMouseDown={cancel}>
      <div className="modal line-styles-dialog" role="dialog" aria-label="Edit line style" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && cancel()}>
        <h3>{editing.styleIndex === null ? 'New line style' : 'Edit line style'}</h3>
        <form
          className="ls-editor"
          // The number boxes' steps are for the arrows only: any value is fine, and draftProblem says what is not.
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem) onSave(!changed && editing.original ? editing.original : fromDraft(draft));
          }}
        >
          <div className="form-grid">
            <label htmlFor="ls-name">Name</label>
            <input id="ls-name" value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <span />
            <label className="ls-check" title="Lengths, offsets and text sizes are multiples of the line width, so the pattern keeps its proportions on thicker lines">
              <input type="checkbox" checked={draft.scaleWithWidth} onChange={(e) => setDraft({ ...draft, scaleWithWidth: e.target.checked })} /> Scale with line width
            </label>
          </div>
          <div className="ls-preview-box">
            <LineStylePreview style={preview} width={420} height={90} lineWidth={lineWidth} />
            <label className="ls-field">
              Preview line width
              <input type="range" min={0.5} max={6} step={0.5} value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} aria-label="Preview line width" />
              <span>{lineWidth} pt</span>
            </label>
          </div>
          <div className="ls-lines">
            {draft.lines.map((l, i) => (
              <LineEditor
                key={i}
                line={l}
                index={i}
                count={draft.lines.length}
                onChange={(n) => setLines(draft.lines.map((x, j) => (j === i ? n : x)))}
                onMove={(to) => setLines(move(draft.lines, i, to))}
                onRemove={() => setLines(draft.lines.filter((_, j) => j !== i))}
              />
            ))}
            <button type="button" className="btn small" onClick={() => setLines([...draft.lines, { offset: draft.lines.length ? draft.lines[draft.lines.length - 1]!.offset - 2 : 0, components: [] }])}>
              Add line
            </button>
          </div>
          {problem && (
            <p className="pref-hint ls-problem" role="status">
              {problem}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
            <span className="spacer" />
            <button type="submit" className="btn primary" disabled={!!problem}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Line style sets: the built-in ones to copy from, and the user's own to add to, edit, rename,
 * import (.blx) and export. Styles saved here show in every Line style picker.
 */
export function LineStylesDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const userSets = ws.lineSets;
  const [setRef, setSetRef] = useState<SetRef>(userSets.length ? { builtIn: false, index: 0 } : { builtIn: true, index: 0 });
  const [picked, setPicked] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Set by Escape so the rename box's blur, as it goes, does not save what was typed. */
  const renameCancelled = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const set: LineSet | undefined = setRef.builtIn ? DEFAULT_LINE_SETS[setRef.index] : userSets[setRef.index];
  const style = set?.styles[picked];
  const titles = [...DEFAULT_LINE_SETS, ...userSets].map((s) => s.title);

  const selectSet = (ref: SetRef) => {
    setSetRef(ref);
    setPicked(0);
    setRenaming(null);
  };
  const editSet = (index: number, fn: (s: LineSet) => LineSet) => updateWorkspace((w) => ({ ...w, lineSets: w.lineSets.map((s, i) => (i === index ? fn(s) : s)) }));

  /** The user set a new or copied style goes in: the one picked, else the first, else (null) one made on save. */
  const targetSet = (): number | null => (!setRef.builtIn ? setRef.index : userSets.length ? 0 : null);
  const namesIn = (index: number | null) => (index === null ? [] : (userSets[index]?.styles ?? []).map((s) => s.name));

  const newSet = () => {
    const title = uniqueName('New Line Style Set', titles);
    updateWorkspace((w) => ({ ...w, lineSets: [...w.lineSets, { title, styles: [] }] }));
    selectSet({ builtIn: false, index: userSets.length });
    setRenaming(title);
  };

  const startNew = () => {
    const index = targetSet();
    setEditing({ setIndex: index, styleIndex: null, draft: { name: uniqueName('New Line Style', namesIn(index)), scaleWithWidth: true, lines: [{ offset: 0, components: [newComponent('dash'), newComponent('space')] }] } });
  };

  const startCopy = () => {
    if (!style) return;
    const index = targetSet();
    setEditing({ setIndex: index, styleIndex: null, draft: { ...toDraft(style), name: uniqueName(style.name, namesIn(index)) } });
  };

  const save = (saved: CustomLine) => {
    if (!editing) return;
    const { styleIndex } = editing;
    let setIndex = editing.setIndex;
    let title: string;
    let at: number;
    if (setIndex === null) {
      title = uniqueName(MY_SET, titles);
      setIndex = userSets.length;
      at = 0;
      updateWorkspace((w) => ({ ...w, lineSets: [...w.lineSets, { title, styles: [saved] }] }));
    } else {
      title = userSets[setIndex]?.title ?? MY_SET;
      at = styleIndex ?? userSets[setIndex]?.styles.length ?? 0;
      editSet(setIndex, (s) => ({ ...s, styles: styleIndex === null ? [...s.styles, saved] : s.styles.map((x, i) => (i === styleIndex ? saved : x)) }));
    }
    setEditing(null);
    setSetRef({ builtIn: false, index: setIndex });
    setPicked(at);
    setMessage(`Saved ${saved.name}. It is in the Line style pickers under ${title}.`);
  };

  if (editing) {
    const names = namesIn(editing.setIndex).filter((_, i) => i !== editing.styleIndex);
    return <StyleEditor editing={editing} takenNames={names} onSave={save} onCancel={() => setEditing(null)} />;
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal line-styles-dialog" role="dialog" aria-label="Line styles" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && renaming === null && onClose()}>
        <h3>Line styles</h3>
        <div className="ls-manager">
          <div className="ls-sets">
            <ul role="listbox" aria-label="Line style sets">
              {DEFAULT_LINE_SETS.map((s, i) => (
                <li key={`b${i}`} role="option" aria-selected={setRef.builtIn && setRef.index === i} className={setRef.builtIn && setRef.index === i ? 'picked' : ''} onClick={() => selectSet({ builtIn: true, index: i })}>
                  {s.title} <span className="ls-badge">built-in</span>
                </li>
              ))}
              {userSets.map((s, i) => {
                const on = !setRef.builtIn && setRef.index === i;
                return (
                  <li key={`u${i}`} role="option" aria-selected={on} className={on ? 'picked' : ''} onClick={() => selectSet({ builtIn: false, index: i })}>
                    {on && renaming !== null ? (
                      <input
                        aria-label="Set name"
                        autoFocus
                        value={renaming}
                        // Clicks in the box stay in it, rather than reselecting the row (which ends the rename).
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenaming(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            // Cancels the rename only; the dialog stays open.
                            e.stopPropagation();
                            renameCancelled.current = true;
                            setRenaming(null);
                          }
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        onFocus={() => (renameCancelled.current = false)}
                        onBlur={() => {
                          if (renameCancelled.current) return;
                          const title = renaming.trim();
                          if (title && title !== s.title) editSet(i, (x) => ({ ...x, title: uniqueName(title, titles.filter((t) => t !== s.title)) }));
                          setRenaming(null);
                        }}
                      />
                    ) : (
                      <>
                        {s.title} <span className="ls-badge">{s.styles.length}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="ls-set-actions">
              <button className="btn small" onClick={newSet}>
                New set
              </button>
              <button className="btn small" disabled={setRef.builtIn} onClick={() => set && setRenaming(set.title)}>
                Rename
              </button>
              <button className="btn small" onClick={() => importRef.current?.click()}>
                Import…
              </button>
              <button
                className="btn small"
                disabled={!set}
                title="Save this set as a .blx line style set file"
                onClick={() => {
                  if (!set) return;
                  const dropped: Dropped[] = [];
                  void writeBlx(set, dropped).then((xml) => {
                    download(xml, set.title);
                    setMessage(`Exported ${set.title}.blx.${dropped.length ? ` Not exported: ${dropped.map((d) => `${d.item} (${d.reason})`).join('; ')}.` : ''}`);
                  });
                }}
              >
                Export…
              </button>
              <button
                className="btn small"
                disabled={setRef.builtIn}
                onClick={() => {
                  if (!set || setRef.builtIn || !confirm(`Remove the line style set "${set.title}" and its ${set.styles.length} line styles?`)) return;
                  updateWorkspace((w) => ({ ...w, lineSets: w.lineSets.filter((_, i) => i !== setRef.index) }));
                  selectSet(userSets.length > 1 ? { builtIn: false, index: 0 } : { builtIn: true, index: 0 });
                }}
              >
                Remove
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".blx,application/xml,text/xml"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  void (async () => {
                    const out: string[] = [];
                    let sets = userSets;
                    for (const f of files) {
                      try {
                        const dropped: Dropped[] = [];
                        const parsed = await parseBlx(await f.text(), f.name.replace(/\.blx$/i, ''), dropped);
                        if (!parsed.styles.length) throw new Error('no line styles in it');
                        // A set of the same name may hold styles made here: the import goes beside it, never over it.
                        const imported = { ...parsed, title: uniqueName(parsed.title, [...DEFAULT_LINE_SETS, ...sets].map((s) => s.title)) };
                        sets = [...sets, imported];
                        updateWorkspace((w) => ({ ...w, lineSets: [...w.lineSets, imported] }));
                        out.push(`Imported ${parsed.styles.length} line style${parsed.styles.length === 1 ? '' : 's'} (${imported.title}).${dropped.length ? ` Left out: ${dropped.map((d) => `${d.item} (${d.reason})`).join('; ')}.` : ''}`);
                      } catch (err) {
                        out.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
                      }
                    }
                    if (sets !== userSets) selectSet({ builtIn: false, index: sets.length - 1 });
                    setMessage(out.join(' ') || null);
                  })();
                }}
              />
            </div>
          </div>
          <div className="ls-styles">
            <ul role="listbox" aria-label={`Line styles in ${set?.title ?? ''}`}>
              {set?.styles.map((s, i) => (
                <li
                  key={`${s.name}:${i}`}
                  role="option"
                  aria-selected={i === picked}
                  className={i === picked ? 'picked' : ''}
                  onClick={() => setPicked(i)}
                  onDoubleClick={() => (setRef.builtIn ? startCopy() : setEditing({ setIndex: setRef.index, styleIndex: i, draft: toDraft(s), original: s }))}
                >
                  <span className="name">{s.name}</span>
                  <LineStylePreview style={s} width={200} height={28} />
                </li>
              ))}
              {set && !set.styles.length && <li className="ls-empty">No line styles yet: add one with New.</li>}
            </ul>
            <div className="ls-style-actions">
              <button className="btn small" onClick={startNew}>
                New…
              </button>
              {setRef.builtIn ? (
                <button className="btn small" disabled={!style} title="Copy into one of your sets to change it" onClick={startCopy}>
                  Copy and Edit…
                </button>
              ) : (
                <>
                  <button className="btn small" disabled={!style} onClick={() => style && setEditing({ setIndex: setRef.index, styleIndex: picked, draft: toDraft(style), original: style })}>
                    Edit…
                  </button>
                  <button className="btn small" disabled={!style} onClick={startCopy}>
                    Duplicate
                  </button>
                  <button
                    className="btn small"
                    disabled={!style || picked === 0}
                    aria-label="Move line style up"
                    onClick={() => {
                      editSet(setRef.index, (s) => ({ ...s, styles: move(s.styles, picked, picked - 1) }));
                      setPicked(picked - 1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="btn small"
                    disabled={!style || picked >= (set?.styles.length ?? 0) - 1}
                    aria-label="Move line style down"
                    onClick={() => {
                      editSet(setRef.index, (s) => ({ ...s, styles: move(s.styles, picked, picked + 1) }));
                      setPicked(picked + 1);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="btn small"
                    disabled={!style}
                    onClick={() => {
                      if (!style || !confirm(`Delete the line style "${style.name}"? Markups already drawn with it keep it.`)) return;
                      editSet(setRef.index, (s) => ({ ...s, styles: s.styles.filter((_, i) => i !== picked) }));
                      setPicked(Math.max(0, picked - 1));
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        {message && (
          <p className="pref-hint" role="status" onClick={() => setMessage(null)}>
            {message}
          </p>
        )}
        <div className="actions">
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
