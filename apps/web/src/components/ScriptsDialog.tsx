import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useMemo, useState } from 'react';
import type { Markup } from '@nb/markup';
import { previewScript, READ_FIELDS, SET_FIELDS, type ScriptChange, type ScriptContext, type ScriptError, type ScriptRun } from '../scripts/script';
import { updateWorkspace, useWorkspace, type SavedScript } from '../workspace/profiles';

interface Props {
  markups: readonly Markup[];
  ctx: ScriptContext;
  readOnly: boolean;
  /** Applies the changes as one undo step. */
  onApply: (changes: readonly ScriptChange[]) => void;
  onClose: () => void;
}

/** Scripts to start from; copied into the editor, not saved until the user saves them. */
const EXAMPLES: { name: string; source: string }[] = [
  {
    name: 'Set a status on matching comments',
    source: `# Every markup whose comment mentions "lintel" is accepted.
where comment contains "lintel"
set status Accepted
`,
  },
  {
    name: 'Rename a layer',
    source: `rename layer "Old notes" to "Notes"
`,
  },
  {
    name: 'Colour markups by author',
    source: `where author is "Sam"
set color blue

where author is "Hana"
set color green
`,
  },
  {
    name: 'Tidy clouds on the first sheets',
    source: `where type is cloud and page <= 3
set width 2
set layer "Clouds"
`,
  },
];

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}`);

/** Tools › Scripts: short rules that find markups and change them. Nothing changes until a preview is applied. */
export function ScriptsDialog({ markups, ctx, readOnly, onApply, onClose }: Props) {
  const saved = useWorkspace().scripts ?? [];
  const [editing, setEditing] = useState<SavedScript>(() => saved[0] ?? { id: newId(), name: msg('New script'), source: EXAMPLES[0]!.source });
  const [result, setResult] = useState<{ run: ScriptRun | null; errors: ScriptError[]; source: string } | null>(null);
  const isSaved = saved.some((s) => s.id === editing.id);
  const dirty = !isSaved || saved.find((s) => s.id === editing.id)?.source !== editing.source || saved.find((s) => s.id === editing.id)?.name !== editing.name;
  // A preview is for the text it was made from; editing it again needs a new preview.
  const stale = !result || result.source !== editing.source;

  const preview = () => setResult({ ...previewScript(editing.source, markups, ctx), source: editing.source });
  const save = () => updateWorkspace((w) => ({ ...w, scripts: [...(w.scripts ?? []).filter((s) => s.id !== editing.id), editing].sort((a, b) => a.name.localeCompare(b.name)) }));
  const remove = () => {
    updateWorkspace((w) => ({ ...w, scripts: (w.scripts ?? []).filter((s) => s.id !== editing.id) }));
    const next = saved.find((s) => s.id !== editing.id);
    setEditing(next ?? { id: newId(), name: msg('New script'), source: '' });
    setResult(null);
  };
  const changesShown = useMemo(() => result?.run?.changes.slice(0, 300) ?? [], [result]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal scripts-dialog" role="dialog" aria-label={msg('Scripts')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>{msg('Scripts')}</h3>
        </div>
        <div className="scripts-body">
          <aside className="scripts-list" aria-label={msg('Saved scripts')}>
            <div className="hint-text">{msg('Saved in this profile')}</div>
            {saved.length === 0 && <p className="hint-text">{msg('None yet.')}</p>}
            {saved.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`scripts-row${s.id === editing.id ? ' on' : ''}`}
                onClick={() => {
                  setEditing(s);
                  setResult(null);
                }}
              >
                {s.name}
              </button>
            ))}
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setEditing({ id: newId(), name: msg('New script'), source: '' });
                setResult(null);
              }}
            >
              {msg('New')}
            </button>
            <div className="hint-text scripts-examples-title">{msg('Examples')}</div>
            {EXAMPLES.map((x) => (
              <button
                key={x.name}
                type="button"
                className="scripts-row example"
                onClick={() => {
                  setEditing({ id: newId(), name: x.name, source: x.source });
                  setResult(null);
                }}
              >
                {x.name}
              </button>
            ))}
          </aside>
          <section className="scripts-edit">
            <input aria-label={msg('Script name')} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <textarea
              aria-label={msg('Script')}
              spellCheck={false}
              value={editing.source}
              onChange={(e) => setEditing({ ...editing, source: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  preview();
                }
              }}
            />
            <details className="scripts-help">
              <summary>{msg('How scripts work')}</summary>
              <p>
                {/* translators: the words in {where}, {set}, {every} and {rename} are script syntax and stay in English. */}
                {keyed(
                  msgParts('Each {where} line finds markups; the {set} lines under it change them. {every} finds them all, and {rename} renames a layer. Lines starting with {hash} are notes.', {
                    where: <code>where</code>,
                    set: <code>set</code>,
                    every: <code>every markup</code>,
                    rename: <code>rename layer "Old" to "New"</code>,
                    hash: <code>#</code>,
                  }),
                )}
              </p>
              <p>
                {keyed(
                  msgParts('Find by {fields}, or {column}, with {tests}, or {compare} for numbers; join with {join} and brackets.', {
                    fields: READ_FIELDS.join(', '),
                    column: <code>column "Name"</code>,
                    tests: (
                      <>
                        <code>is</code>, <code>is not</code>, <code>contains</code>, <code>starts with</code>, <code>ends with</code>, <code>matches /pattern/</code>, <code>is empty</code>
                      </>
                    ),
                    compare: (
                      <>
                        <code>&lt;</code> <code>&gt;</code>
                      </>
                    ),
                    join: (
                      <>
                        <code>and</code>, <code>or</code>, <code>not</code>
                      </>
                    ),
                  }),
                )}
              </p>
              <p>
                {keyed(msgParts('Change {fields}, or {code}. Locked markups are left alone. Nothing changes until you check the preview and click {b}, and {b2} takes it all back in one step.', { fields: SET_FIELDS.join(', '), code: <code>column "Name"</code>, b: <b>{msg('Apply')}</b>, b2: <b>{msg('Undo')}</b> }))}
              </p>
            </details>
            <div className="scripts-result" role="status" aria-live="polite">
              {result?.errors.length ? (
                <ul className="scripts-errors">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.line ? msg('Line {line}: ', { line: e.line }) : ''}
                      {e.message}
                    </li>
                  ))}
                </ul>
              ) : result?.run ? (
                <>
                  <p>
                    <b>
                      {msg('{count, plural, one {# markup} other {# markups}} will change', { count: result.run.changes.length })}
                    </b>
                    {result.run.found.length > 1 ? ' ' + msg('(rules found {found})', { found: result.run.found.join(', ') }) : ` (found ${result.run.found[0] ?? 0})`}
                    {result.run.skipped.length ? '. ' + msg('Locked, left alone: {count}', { count: result.run.skipped.length }) : ''}
                    {stale ? '. The script has changed since: preview it again.' : '.'}
                  </p>
                  <ul className="scripts-changes">
                    {changesShown.map((c) => (
                      <li key={c.id}>
                        <span className="what">{c.what}</span> {c.changes.join(', ')}
                      </li>
                    ))}
                    {result.run.changes.length > changesShown.length && <li className="hint-text">{msg('…and {count} more', { count: result.run.changes.length - changesShown.length })}</li>}
                  </ul>
                </>
              ) : (
                <p className="hint-text">{msg('Preview the script to see what it would change. Nothing changes until you apply it.')}</p>
              )}
            </div>
          </section>
        </div>
        <div className="actions">
          <button type="button" className="btn small" onClick={save} disabled={!dirty || !editing.name.trim()}>
            {isSaved ? msg('Save') : msg('Save to Profile')}
          </button>
          {isSaved && (
            <button type="button" className="btn small danger" onClick={() => confirm(msg('Delete the script "{name}"?', { name: editing.name })) && remove()}>
              {msg('Delete')}
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn small" onClick={preview} title={msg('Ctrl+Enter')}>
            {msg('Preview')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={readOnly || stale || !result?.run?.changes.length}
            title={readOnly ? msg('This document is read-only') : stale ? msg('Preview the script first') : undefined}
            onClick={() => {
              onApply(result!.run!.changes);
              setResult(null);
            }}
          >
            {msg('Apply')}
          </button>
          <button type="button" className="btn small" onClick={onClose}>
            {msg('Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
