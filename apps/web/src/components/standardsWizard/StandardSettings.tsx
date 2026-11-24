import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../../i18n/keyed';
import { useState } from 'react';
import { numberParts, type ChainageHints, type LinkHints } from '@nb/sheets';
import { MARK_KINDS } from '../../sheets/marks';
import type { DrawingStandard } from '../../sheets/standards';

/** The Project a document belongs to, when it does: its owner can choose a standard for all its files. */
export interface ProjectInfo {
  name: string;
  owner: boolean;
  standard: string | null;
}

interface Props {
  standard: DrawingStandard;
  standards: readonly DrawingStandard[];
  /** The standard the document is read with, if any. */
  current: string | null;
  /** A drawing number read in this set, to show the parts callouts can cite. */
  sample: string | null;
  readOnly: boolean;
  change: (f: (s: DrawingStandard) => DrawingStandard) => void;
  /** Reads the document with a standard, or from its text alone (null). */
  onUse: (id: string | null) => void;
  onExport: (s: DrawingStandard) => void;
  onDelete: (id: string) => void;
  /** Marks taught for every set (before standards kept their own), which can be moved into this one. */
  everySetMarks: number;
  onMoveMarks: (id: string) => void;
  onForgetMark: (id: string) => void;
  project: ProjectInfo | null;
  onProjectStandard: (s: DrawingStandard | null) => void;
}

const listOf = (text: string) =>
  text
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

type LinkList = 'ids' | 'section' | 'elevation' | 'enlargedPlan' | 'matchLine';
const LINK_LISTS = (): [LinkList, string, string][] => [
  ['ids', msg('Identifiers'), msg('Usual: 3, A, 3A, A-A, AA')],
  ['section', msg('Section titles'), 'SECTION'],
  ['elevation', msg('Elevation titles'), 'ELEVATION'],
  ['enlargedPlan', msg('Enlarged plan titles'), 'ENLARGED'],
  ['matchLine', msg('Match lines'), msg('MATCH LINE')],
];
const linkText = (l: LinkHints, k: LinkList) => (k === 'ids' ? (l.ids?.join(', ') ?? '') : k === 'matchLine' ? l.matchLine.join(', ') : l.titles[k].join(', '));

type ChainList = 'alignments' | 'prefixes' | 'planTitles' | 'sectionTitles';
const CHAIN_LISTS = (): [ChainList, string, string][] => [
  ['alignments', msg('Alignment names'), msg('MC01, RAMP A (empty: one alignment)')],
  ['prefixes', msg('Written before a chainage'), msg('STA, CH')],
  ['planTitles', msg('Plan sheet titles'), msg('PLAN AND LONGITUDINAL SECTION')],
  ['sectionTitles', msg('Cross-section sheet titles'), msg('CROSS SECTIONS')],
];

/** A comma-separated list typed into a field: kept as typed while focused, saved as a list. */
function ListField({ label, value, placeholder, disabled, onList }: { label: string; value: string; placeholder: string; disabled: boolean; onList: (list: string[]) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="sw-field">
      {label}
      <input
        value={text ?? value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          onList(listOf(e.target.value));
        }}
        onBlur={() => setText(null)}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

/**
 * The standard's own settings, at the end of the setup: its name and the words that pick it for a
 * set, which document reads with it, the word lists every step learned (to read or correct by
 * hand), the marks taught for it, and sharing it.
 */
export function StandardSettings(p: Props) {
  const s = p.standard;
  const ro = p.readOnly;
  const setLinks = (patch: Partial<LinkHints>) => p.change((x) => ({ ...x, links: { ...x.links, ...patch } }));
  const setChain = (patch: Partial<ChainageHints>) => p.change((x) => ({ ...x, chainage: { ...x.chainage, ...patch } }));
  const parts = p.sample ? numberParts(p.sample) : [];
  return (
    <div className="sw-settings">
      <label className="sw-field">
        {keyed(msgParts('Name{input}', { input: <input value={s.name} disabled={ro} onChange={(e) => p.change((x) => ({ ...x, name: e.target.value }))} onBlur={() => !s.name.trim() && p.change((x) => ({ ...x, name: msg('Drawing standard') }))} onKeyDown={(e) => e.stopPropagation()} /> }))}
      </label>
      <ListField
        label={msg('Words on this client\'s sheets')}
        value={s.identify.join(', ')}
        placeholder={msg('Client name, project code')}
        disabled={ro}
        onList={(identify) => p.change((x) => ({ ...x, identify }))}
      />
      <p className="sw-hint">{msg('Sets that print these words, or whose numbers fit the template, are offered this standard when they open.')}</p>

      <label className="sw-field">
        {msg('This document')}
        <select value={p.current ?? ''} disabled={ro} onChange={(e) => p.onUse(e.target.value || null)} aria-label={msg('Drawing standard for this document')}>
          <option value="">{msg('None (read from the text)')}</option>
          {p.standards.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {p.project && (
        <p className="sw-hint">
          {p.project.standard ? (
            <>
              {keyed(msgParts('Project {name} reads every file with {b}.', { name: p.project.name, b: <b>{p.project.standard}</b> }))}
            </>
          ) : (
            <>{msg('Project {name} has no drawing standard.', { name: p.project.name })}</>
          )}{' '}
          {p.project.owner && (
            <button type="button" className="btn small flat" onClick={() => p.onProjectStandard(s)} title={msg('Everyone\'s copy of the Project reads its files with this standard')}>
              {msg('Use {name} for the Project', { name: s.name })}
            </button>
          )}
          {p.project.owner && p.project.standard && (
            <button type="button" className="btn small flat" onClick={() => p.onProjectStandard(null)}>
              {msg('Stop')}
            </button>
          )}
        </p>
      )}

      <details className="sw-advanced">
        <summary>{msg('Advanced: words and marks')}</summary>
        <p className="sw-hint">{msg('What the steps learned, as lists separated by commas. Change them by hand only to fix a mistake: the steps add to them as you teach.')}</p>
        <label className="sw-field">
          {msg('Callouts cite')}
          <select value={s.links.calloutPart ?? -1} disabled={ro} onChange={(e) => setLinks({ calloutPart: Number(e.target.value) < 0 ? null : Number(e.target.value) })} aria-label={msg('Part of the number callouts cite')}>
            <option value={-1}>{msg('The last part, or the whole number')}</option>
            {parts.map((part, i) => (
              <option key={i} value={i}>
                {msg('Part {number}: {part}', { number: i + 1, part })}
              </option>
            ))}
          </select>
        </label>
        {LINK_LISTS().map(([key, label, placeholder]) => (
          <ListField
            key={key}
            label={label}
            value={linkText(s.links, key)}
            placeholder={placeholder}
            disabled={ro}
            onList={(list) => (key === 'ids' ? setLinks({ ids: list.length ? list : null }) : key === 'matchLine' ? setLinks({ matchLine: list }) : setLinks({ titles: { ...s.links.titles, [key]: list } }))}
          />
        ))}
        <p className="sw-hint">{msg('Identifiers use # for a digit and @ for a letter: @@ for AA, @# for A1.')}</p>
        {CHAIN_LISTS().map(([key, label, placeholder]) => (
          <ListField key={key} label={label} value={s.chainage[key].join(', ')} placeholder={placeholder} disabled={ro} onList={(list) => setChain({ [key]: list })} />
        ))}
        <label className="sw-field">
          {keyed(msgParts('Alignment names look like{input}', { input: <input value={s.chainage.alignmentTemplate ?? ''} placeholder={msg('MC## (# a digit, @ a letter)')} disabled={ro} onChange={(e) => setChain({ alignmentTemplate: e.target.value.trim().toUpperCase() || null })} onKeyDown={(e) => e.stopPropagation()} /> }))}
        </label>
        <h3>{msg('Marks ({count})', { count: s.marks.length })}</h3>
        <ol className="sw-marks">
          {s.marks.length === 0 && <li className="sw-hint">{msg('None taught for this client yet: the Sections, Elevations and Details steps teach them.')}</li>}
          {s.marks.map((m) => (
            <li key={m.id}>
              {m.name} <i>{MARK_KINDS[m.kind]}</i>
              <button type="button" className="btn small flat" disabled={ro} onClick={() => p.onForgetMark(m.id)} title={msg('Forget this mark')} aria-label={msg('Forget {name}', { name: m.name })}>
                ×
              </button>
            </li>
          ))}
        </ol>
        {p.everySetMarks > 0 && (
          <button type="button" className="btn small" disabled={ro} onClick={() => p.onMoveMarks(s.id)} title={msg('Look for the marks taught for every set only in sets read with this standard')}>
            {msg('Move {everySetMarks, plural, one {# mark} other {# marks}} taught for every set here', { everySetMarks: p.everySetMarks })}
          </button>
        )}
      </details>

      <div className="sw-row">
        <button type="button" className="btn small" onClick={() => p.onExport(s)} title={msg('Save as a .rcstandard file to share')}>
          {msg('Export…')}
        </button>
        <button
          type="button"
          className="btn small"
          disabled={ro}
          onClick={(e) => {
            const win = e.currentTarget.ownerDocument.defaultView ?? window;
            if (win.confirm(msg('Delete the drawing standard "{name}"? Documents read with it keep their sheet numbers.', { name: s.name }))) p.onDelete(s.id);
          }}
        >
          {msg('Delete')}
        </button>
      </div>
    </div>
  );
}
