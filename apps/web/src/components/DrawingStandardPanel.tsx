import { useEffect, useMemo, useRef, useState } from 'react';
import { TITLE_FIELDS, boxFromRegion, deriveTemplate, numberParts, readSheet, regionOfBox, standardCoverage, textInRegion, type PageText, type Region, type SheetHints, type TitleField } from '@nb/sheets';
import { rangeText } from '../measure/scalePresets';
import { newStandard, type DrawingStandard } from '../sheets/standards';

interface Props {
  standards: readonly DrawingStandard[];
  /** The standard this document is read with, if any. */
  current: string | null;
  /** The boxes on the page, in page space (drawn with the region tool). */
  regions: Region[];
  drawing: boolean;
  currentPage: number;
  pageSize: { width: number; height: number } | null;
  /** Every page's text, once loaded. */
  texts: PageText[] | null;
  readOnly: boolean;
  onDraw: () => void;
  onChange: (regions: Region[]) => void;
  onSave: (standard: DrawingStandard) => void;
  onDelete: (id: string) => void;
  /** Reads this document with a standard (or none). */
  onUse: (id: string | null) => void;
  onImport: (file: File) => void;
  onExport: (standard: DrawingStandard) => void;
  onClose: () => void;
}

const NEW = '';
/** The order new boxes take fields in: number first, then the rest; once all are used, ignore. */
const FIELD_ORDER: TitleField[] = ['number', 'title', 'revision', 'scale'];

function fieldsFor(count: number, chosen: readonly TitleField[]): TitleField[] {
  const out: TitleField[] = [];
  for (let i = 0; i < count; i++) out.push(chosen[i] ?? FIELD_ORDER.find((f) => !out.includes(f)) ?? 'ignore');
  return out;
}

/**
 * Drawing standards: one client's title block and drawing numbers, described once and chosen for
 * every set from that client. Boxes are drawn on the page like Page Labels from Region; each says
 * what it holds, and the panel shows how many pages of this set the standard reads.
 */
export function DrawingStandardPanel({ standards, current, regions, drawing, currentPage, pageSize, texts, readOnly, onDraw, onChange, onSave, onDelete, onUse, onImport, onExport, onClose }: Props) {
  const [editing, setEditing] = useState<string>(current ?? standards[0]?.id ?? NEW);
  const [draft, setDraft] = useState<DrawingStandard>(() => standards.find((s) => s.id === editing) ?? newStandard('New standard'));
  const [chosen, setChosen] = useState<TitleField[]>(() => draft.sheets.boxes.map((b) => b.field));
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // Choosing another standard to edit shows its boxes on the page.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!pageSize || shown.current === editing) return;
    shown.current = editing;
    const s = standards.find((x) => x.id === editing) ?? newStandard('New standard');
    setDraft(s);
    setChosen(s.sheets.boxes.map((b) => b.field));
    setMessage(null);
    onChange(s.sheets.boxes.map((b) => regionOfBox(b, pageSize)));
  }, [editing, pageSize, standards, onChange]);

  const fields = fieldsFor(regions.length, chosen);
  const hints: SheetHints = useMemo(
    () => ({ ...draft.sheets, boxes: pageSize ? regions.map((r, i) => boxFromRegion(r, pageSize, fields[i]!)) : [] }),
    // `fields` comes from `chosen` and the region count.
    [draft.sheets, regions, pageSize, chosen],
  );
  const coverage = useMemo(() => (texts && hints.boxes.some((b) => b.field === 'number') ? standardCoverage(texts, hints) : null), [texts, hints]);
  const here = texts?.[currentPage] ? readSheet(texts[currentPage]!, hints) : null;
  /** The numbers the boxes read across the set, whether or not they fit the template. */
  const numbers = useMemo(() => (texts ? texts.flatMap((p) => readSheet(p, { ...hints, template: null })?.number ?? []) : []), [texts, hints]);
  const sample = here?.number ?? numbers[0] ?? null;
  const part = draft.sheets.disciplinePart;
  const codes = useMemo(() => (part === null ? [] : [...new Set(numbers.map((n) => numberParts(n)[part]).filter((c): c is string => !!c))].sort()), [numbers, part]);
  const words = texts?.[currentPage]?.words ?? [];
  const saved = standards.some((s) => s.id === draft.id);
  const hasNumberBox = hints.boxes.some((b) => b.field === 'number');

  const setSheets = (patch: Partial<SheetHints>) => setDraft((d) => ({ ...d, sheets: { ...d.sheets, ...patch } }));
  const finished = (): DrawingStandard => ({ ...draft, name: draft.name.trim() || 'Drawing standard', sheets: hints, updatedAt: Date.now() });
  const save = () => {
    const s = finished();
    // A new standard, once saved, is the one being edited (its boxes stay on the page).
    shown.current = s.id;
    setEditing(s.id);
    onSave(s);
    return s;
  };
  const remove = (i: number) => {
    onChange(regions.filter((_, j) => j !== i));
    setChosen(fields.filter((_, j) => j !== i));
  };
  const workOut = () => {
    const template = deriveTemplate(numbers);
    if (template) setSheets({ template });
    setMessage(template ? null : numbers.length ? 'The numbers in the box are not all built the same way. Type the template instead.' : 'The number box has no number in it on any page yet.');
  };

  return (
    <div className="label-regions drawing-standard" role="dialog" aria-label="Drawing standards">
      <div className="lr-head">
        <b>Drawing Standards</b>
        <button className="btn small flat" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>
      <label className="lr-row">
        This document
        <select value={current ?? ''} disabled={readOnly} onChange={(e) => onUse(e.target.value || null)} aria-label="Drawing standard for this document">
          <option value="">None (read from the text)</option>
          {standards.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="lr-row ds-pick">
        <select value={saved ? draft.id : NEW} onChange={(e) => setEditing(e.target.value)} aria-label="Standard to edit">
          {standards.map((s) => (
            <option key={s.id} value={s.id}>
              Edit: {s.name}
            </option>
          ))}
          <option value={NEW}>New standard…</option>
        </select>
        <button className="btn small" onClick={() => importRef.current?.click()} title="Add a standard someone shared (.rcstandard)">
          Import…
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".rcstandard,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImport(file);
          }}
        />
      </div>

      <label className="ds-field">
        Name
        <input className="lr-typed" value={draft.name} placeholder="Client or consultant" onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </label>

      <h4 className="ds-section">Title block</h4>
      <p className="hint">Box each field of the title block and say what it holds. Smaller prints of the same sheets read from the same place.</p>
      <button className={`btn small${drawing ? ' active' : ''}`} onClick={onDraw}>
        {drawing ? 'Drawing: drag a box on the page' : '+ Draw box'}
      </button>
      <ol className="lr-list">
        {regions.length === 0 && <li className="empty">No boxes yet.</li>}
        {regions.map((r, i) => (
          <li key={`${r.x},${r.y},${r.w},${r.h}`}>
            <select
              value={fields[i]}
              aria-label={`Box ${i + 1} holds`}
              onChange={(e) => {
                const next = [...fields];
                next[i] = e.target.value as TitleField;
                setChosen(next);
              }}
            >
              {(Object.keys(TITLE_FIELDS) as TitleField[]).map((f) => (
                <option key={f} value={f}>
                  {TITLE_FIELDS[f]}
                </option>
              ))}
            </select>
            <span className="lr-text" title="Text in this box on the current page">
              {texts ? textInRegion(words, r) || <i>no text on this page</i> : '…'}
            </span>
            <button className="btn small flat" onClick={() => remove(i)} title="Remove box" aria-label="Remove box">
              ×
            </button>
          </li>
        ))}
      </ol>

      {/* Numbers and the preview need a number box first; until then the panel stays short, clear of the title block being boxed. */}
      {hasNumberBox ? (
        <>
        <h4 className="ds-section">Drawing numbers</h4>
        <label className="ds-field">
          Template
          <input
            className="lr-typed"
            value={draft.sheets.template ?? ''}
            onChange={(e) => setSheets({ template: e.target.value || null })}
            onKeyDown={(e) => e.stopPropagation()}
            aria-describedby="ds-template-help"
          />
        </label>
        <p className="hint" id="ds-template-help">
          # a digit, @ a letter, ? either, * any run of them. Empty: any number shape.{' '}
          <button className="btn small flat" onClick={workOut} disabled={!texts}>
            Work out from this set
          </button>
        </p>
        {message && <p className="hint ds-message">{message}</p>}
        <label className="lr-row">
          Discipline
          <select value={part ?? -1} onChange={(e) => setSheets({ disciplinePart: Number(e.target.value) < 0 ? null : Number(e.target.value) })} aria-label="Part of the number naming the discipline">
            <option value={-1}>Letters at the start (C-101: Civil)</option>
            {(sample ? numberParts(sample) : []).map((p, i) => (
              <option key={i} value={i}>
                Part {i + 1}: {p}
              </option>
            ))}
          </select>
        </label>
        {part !== null && codes.length > 0 && (
          <table className="ds-codes">
            <tbody>
              {codes.slice(0, 60).map((code) => (
                <tr key={code}>
                  <td>{code}</td>
                  <td>
                    <input
                      value={draft.sheets.disciplines[code] ?? ''}
                      placeholder={code}
                      aria-label={`Discipline name for ${code}`}
                      onChange={(e) => {
                        const disciplines = { ...draft.sheets.disciplines };
                        if (e.target.value) disciplines[code] = e.target.value;
                        else delete disciplines[code];
                        setSheets({ disciplines });
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="lr-preview" aria-live="polite">
          {!texts ? (
            'Reading text…'
          ) : !coverage ? (
            'Draw a box around the sheet number.'
          ) : (
            <>
              Page {currentPage + 1}: <b>{here ? [here.number, here.title, here.revision && `rev ${here.revision}`].filter(Boolean).join(' · ') : 'not read'}</b>
              <br />
              Sheet number read on {coverage.read.length} of {texts.length} pages
              {coverage.missed.length > 0 && coverage.missed.length < texts.length && <> (not on {rangeText(coverage.missed.slice(0, 40))})</>}.
            </>
          )}
        </div>
        </>
      ) : (
        <p className="hint">Start with a box around the sheet number.</p>
      )}

      <div className="lr-actions">
        {saved && (
          <>
            <button className="btn small" onClick={() => onExport(finished())} title="Save as a .rcstandard file to share">
              Export…
            </button>
            <button
              className="btn small"
              onClick={() => {
                if (!confirm(`Delete the drawing standard "${draft.name}"? Documents read with it keep their sheet numbers.`)) return;
                onDelete(draft.id);
                setEditing(standards.find((s) => s.id !== draft.id)?.id ?? NEW);
              }}
            >
              Delete
            </button>
          </>
        )}
        <button className="btn small" disabled={!hasNumberBox} onClick={save}>
          Save
        </button>
        <button
          className="btn small primary"
          disabled={readOnly || !hasNumberBox}
          onClick={() => onUse(save().id)}
        >
          Save and use
        </button>
      </div>
    </div>
  );
}
