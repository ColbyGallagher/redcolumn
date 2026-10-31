import { useEffect, useMemo, useRef, useState } from 'react';
import { TITLE_FIELDS, boxFromRegion, deriveTemplate, numberParts, readSheet, regionOfBox, standardCoverage, textInRegion, type ChainageHints, type LinkHints, type PageText, type Region, type SheetHints, type TitleField } from '@nb/sheets';
import { rangeText } from '../measure/scalePresets';
import { MARK_KINDS } from '../sheets/marks';
import { newStandard, withDefaults, type DrawingStandard } from '../sheets/standards';

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
  /** How many marks are taught for every set (they can be moved into a standard). */
  everySetMarks: number;
  /** Box an example mark on the sheet; it can be kept for the document's standard. */
  onTeach: () => void;
  /** Moves the marks taught for every set into a standard. */
  onMoveMarks: (standardId: string) => void;
  onForgetMark: (id: string) => void;
  onClose: () => void;
}

/** The link words as typed: comma-separated lists. */
type Lists = Record<'ids' | 'section' | 'elevation' | 'enlargedPlan' | 'matchLine', string>;

function listsOf(l: LinkHints): Lists {
  return { ids: l.ids?.join(', ') ?? '', section: l.titles.section.join(', '), elevation: l.titles.elevation.join(', '), enlargedPlan: l.titles.enlargedPlan.join(', '), matchLine: l.matchLine.join(', ') };
}

const listOf = (text: string) =>
  text
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

/** The chainage settings as typed: comma-separated lists. */
type ChainLists = Record<keyof ChainageHints, string>;

const chainListsOf = (c: ChainageHints): ChainLists => ({ prefixes: c.prefixes.join(', '), alignments: c.alignments.join(', '), planTitles: c.planTitles.join(', '), sectionTitles: c.sectionTitles.join(', ') });

const CHAIN_LABELS: [keyof ChainageHints, string, string][] = [
  ['alignments', 'Alignment names', 'MC01, RAMP A (empty: one alignment)'],
  ['prefixes', 'Written before a chainage', 'STA, CH'],
  ['planTitles', 'Plan sheet titles', 'PLAN AND LONGITUDINAL SECTION'],
  ['sectionTitles', 'Cross-section sheet titles', 'CROSS SECTIONS'],
];

const LIST_LABELS: [keyof Lists, string, string][] = [
  ['ids', 'Identifiers', 'Usual: 3, A, 3A, A-A, AA'],
  ['section', 'Section titles', 'SECTION'],
  ['elevation', 'Elevation titles', 'ELEVATION'],
  ['enlargedPlan', 'Enlarged plan titles', 'ENLARGED'],
  ['matchLine', 'Match lines', 'MATCH LINE'],
];

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
export function DrawingStandardPanel({ standards: stored, current, regions, drawing, currentPage, pageSize, texts, readOnly, onDraw, onChange, onSave, onDelete, onUse, onImport, onExport, everySetMarks, onTeach, onMoveMarks, onForgetMark, onClose }: Props) {
  const standards = useMemo(() => stored.map(withDefaults), [stored]);
  const [editing, setEditing] = useState<string>(current ?? standards[0]?.id ?? NEW);
  const [draft, setDraft] = useState<DrawingStandard>(() => standards.find((s) => s.id === editing) ?? newStandard('New standard'));
  const [lists, setLists] = useState<Lists>(() => listsOf(draft.links));
  const [chainLists, setChainLists] = useState<ChainLists>(() => chainListsOf(draft.chainage));
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
    setLists(listsOf(s.links));
    setChainLists(chainListsOf(s.chainage));
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

  /** Marks are taught, moved and forgotten straight into the saved standard, never through this draft. */
  const marks = standards.find((s) => s.id === draft.id)?.marks ?? [];

  const setSheets = (patch: Partial<SheetHints>) => setDraft((d) => ({ ...d, sheets: { ...d.sheets, ...patch } }));
  const setLinks = (patch: Partial<LinkHints>) => setDraft((d) => ({ ...d, links: { ...d.links, ...patch } }));
  const setList = (key: keyof Lists, text: string) => {
    setLists((l) => ({ ...l, [key]: text }));
    const list = listOf(text);
    if (key === 'ids') setLinks({ ids: list.length ? list : null });
    else if (key === 'matchLine') setLinks({ matchLine: list });
    else setLinks({ titles: { ...draft.links.titles, [key]: list } });
  };
  const setChainList = (key: keyof ChainageHints, text: string) => {
    setChainLists((l) => ({ ...l, [key]: text }));
    setDraft((d) => ({ ...d, chainage: { ...d.chainage, [key]: listOf(text) } }));
  };
  const finished = (): DrawingStandard => ({ ...draft, name: draft.name.trim() || 'Drawing standard', sheets: hints, marks, updatedAt: Date.now() });
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
          ) : !coverage ? null : (
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

      <details className="ds-more">
        <summary>Sheet links and marks</summary>
        <label className="lr-row">
          Callouts cite
          <select value={draft.links.calloutPart ?? -1} onChange={(e) => setLinks({ calloutPart: Number(e.target.value) < 0 ? null : Number(e.target.value) })} aria-label="Part of the number callouts cite">
            <option value={-1}>The last part, or the whole number</option>
            {(sample ? numberParts(sample) : []).map((p, i) => (
              <option key={i} value={i}>
                Part {i + 1}: {p}
              </option>
            ))}
          </select>
        </label>
        {LIST_LABELS.map(([key, label, placeholder]) => (
          <label key={key} className="ds-field">
            {label}
            <input className="lr-typed" value={lists[key]} placeholder={placeholder} onChange={(e) => setList(key, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        ))}
        <p className="hint">Separate words with commas. Identifiers use # for a digit and @ for a letter: @@ for AA, @# for A1.</p>
        <h4 className="ds-section">Alignments and chainage</h4>
        {CHAIN_LABELS.map(([key, label, placeholder]) => (
          <label key={key} className="ds-field">
            {label}
            <input className="lr-typed" value={chainLists[key]} placeholder={placeholder} onChange={(e) => setChainList(key, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        ))}
        <p className="hint">Chainages such as 12+00, 1+250.000 or CH 1250 link to the cross section drawn there, else to the plan sheet that covers them.</p>
        {saved && (
          <>
            <h4 className="ds-section">Marks ({marks.length})</h4>
            <ol className="lr-list">
              {marks.length === 0 && <li className="empty">None taught for this client yet.</li>}
              {marks.map((m) => (
                <li key={m.id}>
                  <span className="lr-text">
                    {m.name} <i>{MARK_KINDS[m.kind]}</i>
                  </span>
                  <button className="btn small flat" onClick={() => onForgetMark(m.id)} title="Forget this mark" aria-label={`Forget ${m.name}`}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
            <div className="lr-row">
              <button className="btn small" disabled={readOnly || current !== draft.id} onClick={onTeach} title={current === draft.id ? 'Box an example of a section mark, title or detail callout' : 'Use this standard for the document to teach its marks'}>
                Teach a mark…
              </button>
              {everySetMarks > 0 && (
                <button className="btn small" onClick={() => onMoveMarks(draft.id)} title="Look for the marks taught for every set only in sets read with this standard">
                  Move {everySetMarks} mark{everySetMarks === 1 ? '' : 's'} for every set here
                </button>
              )}
            </div>
          </>
        )}
      </details>

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
        <button className="btn small" onClick={save}>
          Save
        </button>
        <button
          className="btn small primary"
          disabled={readOnly}
          onClick={() => onUse(save().id)}
        >
          Save and use
        </button>
      </div>
    </div>
  );
}
