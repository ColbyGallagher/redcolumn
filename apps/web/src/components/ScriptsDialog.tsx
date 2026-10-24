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
  const [editing, setEditing] = useState<SavedScript>(() => saved[0] ?? { id: newId(), name: 'New script', source: EXAMPLES[0]!.source });
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
    setEditing(next ?? { id: newId(), name: 'New script', source: '' });
    setResult(null);
  };
  const changesShown = useMemo(() => result?.run?.changes.slice(0, 300) ?? [], [result]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal scripts-dialog" role="dialog" aria-label="Scripts" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Scripts</h3>
        </div>
        <div className="scripts-body">
          <aside className="scripts-list" aria-label="Saved scripts">
            <div className="hint-text">Saved in this profile</div>
            {saved.length === 0 && <p className="hint-text">None yet.</p>}
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
                setEditing({ id: newId(), name: 'New script', source: '' });
                setResult(null);
              }}
            >
              New
            </button>
            <div className="hint-text scripts-examples-title">Examples</div>
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
            <input aria-label="Script name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <textarea
              aria-label="Script"
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
              <summary>How scripts work</summary>
              <p>
                Each <code>where</code> line finds markups; the <code>set</code> lines under it change them. <code>every markup</code> finds them all, and <code>rename layer "Old" to "New"</code> renames a layer. Lines starting with <code>#</code> are notes.
              </p>
              <p>
                Find by {READ_FIELDS.join(', ')}, or <code>column "Name"</code>, with <code>is</code>, <code>is not</code>, <code>contains</code>, <code>starts with</code>, <code>ends with</code>, <code>matches /pattern/</code>, <code>is empty</code>, or <code>&lt;</code> <code>&gt;</code> for numbers; join with <code>and</code>, <code>or</code>, <code>not</code> and brackets.
              </p>
              <p>
                Change {SET_FIELDS.join(', ')}, or <code>column "Name"</code>. Locked markups are left alone. Nothing changes until you check the preview and click <b>Apply</b>, and <b>Undo</b> takes it all back in one step.
              </p>
            </details>
            <div className="scripts-result" role="status" aria-live="polite">
              {result?.errors.length ? (
                <ul className="scripts-errors">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.line ? `Line ${e.line}: ` : ''}
                      {e.message}
                    </li>
                  ))}
                </ul>
              ) : result?.run ? (
                <>
                  <p>
                    <b>
                      {result.run.changes.length} markup{result.run.changes.length === 1 ? '' : 's'} will change
                    </b>
                    {result.run.found.length > 1 ? ` (rules found ${result.run.found.join(', ')})` : ` (found ${result.run.found[0] ?? 0})`}
                    {result.run.skipped.length ? `. Locked, left alone: ${result.run.skipped.length}` : ''}
                    {stale ? '. The script has changed since: preview it again.' : '.'}
                  </p>
                  <ul className="scripts-changes">
                    {changesShown.map((c) => (
                      <li key={c.id}>
                        <span className="what">{c.what}</span> {c.changes.join(', ')}
                      </li>
                    ))}
                    {result.run.changes.length > changesShown.length && <li className="hint-text">…and {result.run.changes.length - changesShown.length} more</li>}
                  </ul>
                </>
              ) : (
                <p className="hint-text">Preview the script to see what it would change. Nothing changes until you apply it.</p>
              )}
            </div>
          </section>
        </div>
        <div className="actions">
          <button type="button" className="btn small" onClick={save} disabled={!dirty || !editing.name.trim()}>
            {isSaved ? 'Save' : 'Save to Profile'}
          </button>
          {isSaved && (
            <button type="button" className="btn small danger" onClick={() => confirm(`Delete the script "${editing.name}"?`) && remove()}>
              Delete
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn small" onClick={preview} title="Ctrl+Enter">
            Preview
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={readOnly || stale || !result?.run?.changes.length}
            title={readOnly ? 'This document is read-only' : stale ? 'Preview the script first' : undefined}
            onClick={() => {
              onApply(result!.run!.changes);
              setResult(null);
            }}
          >
            Apply
          </button>
          <button type="button" className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
