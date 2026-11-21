import { useState } from 'react';
import { checkAction, checkFilter, describeRuleAction, describeRuleFilter, toolRuns, type GroupingTool, type MarkupStore } from '@nb/markup';
import { runToolOn, toolLibrary, useToolLibrary } from '../takeoff/toolLibrary';

interface Props {
  store: MarkupStore;
  me: string;
  documentName: string;
  onMessage: (text: string) => void;
  /** After a run: show the grouping it proposed. */
  onRan: () => void;
}

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const STATUS: Record<GroupingTool['status'], string> = { proposed: 'Proposed', accepted: 'Accepted', rejected: 'Rejected' };

/**
 * Review AI Takeoff › Tools: the grouping tool library on this computer. Each tool shows what it
 * does, its rule in words, and why the AI made it. A person accepts or rejects it, edits it, turns
 * it off, or deletes it (groupings it already made stay). Only accepted, enabled tools run, and a run
 * proposes a grouping column for review.
 */
export function ToolLibraryReview({ store, me, documentName, onMessage, onRan }: Props) {
  const tools = useToolLibrary();
  // The whole library, those waiting for a decision first.
  const rank = (t: GroupingTool) => (t.status === 'proposed' ? 0 : t.status === 'accepted' ? 1 : 2);
  const shown = [...tools].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  if (!shown.length) return <p className="empty">No grouping tools yet. Your AI client can propose one (propose_grouping_tool), such as “doors by fire rating”.</p>;
  return (
    <>
      <p className="hint-text takeoff-review-note">Tools are rules, not code: which markups, and the value each gets in a column. They are kept on this computer for every takeoff. A tool never changes a quantity: running it proposes a grouping column for you to review.</p>
      {shown.map((t) => (
        <Tool key={t.id} t={t} store={store} me={me} documentName={documentName} onMessage={onMessage} onRan={onRan} />
      ))}
    </>
  );
}

function Tool({ t, store, me, documentName, onMessage, onRan }: { t: GroupingTool } & Props) {
  const [editing, setEditing] = useState(false);
  const run = () => {
    try {
      const p = runToolOn(store, t, me, documentName);
      onMessage(`“${t.name}” grouped ${p.assignments.length} markup${p.assignments.length === 1 ? '' : 's'}. Review the column before accepting it.`);
      onRan();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <article className={`takeoff-proposal ${t.status === 'accepted' ? 'approved' : t.status === 'rejected' ? 'rejected' : 'pending'}`} aria-label={`Tool: ${t.name}`}>
      <div className="tp-head">
        <span className="ar-kind tool">Tool</span>
        <b>{t.name}</b>
        <span className="grow" />
        {t.disabled && <span className="tp-state rejected">Off</span>}
        <span className={`tp-state ${t.status === 'accepted' ? 'approved' : t.status === 'rejected' ? 'rejected' : 'pending'}`}>{STATUS[t.status]}</span>
      </div>
      {editing ? (
        <ToolEditor t={t} onDone={() => setEditing(false)} onMessage={onMessage} />
      ) : (
        <>
          <p>{t.description}</p>
          <p className="hint-text">
            <b>Rule:</b> {describeRuleFilter(t.filter)} → {t.column}: {describeRuleAction(t.action)}
          </p>
          <blockquote className="tp-reason">
            <span className="hint-text">
              {t.source}, {when(t.createdAt)}:
            </span>{' '}
            {t.reasoning}
          </blockquote>
          {t.decided && (
            <p className="hint-text">
              {STATUS[t.status]} by {t.decided.by}, {when(t.decided.at)}.
            </p>
          )}
          {!!t.uses?.length && (
            <details className="hint-text">
              <summary>
                Used {t.uses.length} time{t.uses.length === 1 ? '' : 's'}
              </summary>
              <ul>
                {t.uses
                  .slice(-20)
                  .reverse()
                  .map((u) => (
                    <li key={u.proposalId}>
                      {u.documentName}: {u.markups} markup{u.markups === 1 ? '' : 's'}, {when(u.at)}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}
      {!editing && (
        <div className="tp-actions">
          <button type="button" className="btn small" onClick={() => window.confirm(`Delete the tool “${t.name}”? Groupings it already made stay as they are.`) && toolLibrary.delete(t.id)}>
            Delete
          </button>
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            Edit
          </button>
          {t.status === 'proposed' && (
            <>
              <button type="button" className="btn small" onClick={() => toolLibrary.reject(t.id, me)}>
                Reject
              </button>
              <button type="button" className="btn small primary" onClick={() => toolLibrary.accept(t.id, me)}>
                Accept Tool
              </button>
            </>
          )}
          {t.status === 'accepted' && (
            <>
              <button type="button" className="btn small" onClick={() => toolLibrary.setDisabled(t.id, !t.disabled)}>
                {t.disabled ? 'Turn On' : 'Turn Off'}
              </button>
              <button type="button" className="btn small primary" disabled={!toolRuns(t) || store.readOnly} onClick={run} title="Propose this tool's grouping for the document on screen">
                Run on This Document
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** Edits a tool: its name, description and column, and its rule as JSON (checked before saving). */
function ToolEditor({ t, onDone, onMessage }: { t: GroupingTool; onDone: () => void; onMessage: (text: string) => void }) {
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description);
  const [column, setColumn] = useState(t.column);
  const [filter, setFilter] = useState(JSON.stringify(t.filter, null, 2));
  const [action, setAction] = useState(JSON.stringify(t.action, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    try {
      const f = checkFilter(JSON.parse(filter || '{}'));
      const a = checkAction(JSON.parse(action));
      if (!name.trim() || !column.trim()) throw new Error('Give the tool a name and a column.');
      toolLibrary.edit(t.id, { name: name.trim(), description: description.trim(), column: column.trim(), filter: f, action: a });
      onMessage(t.status === 'accepted' ? `Saved “${name.trim()}”.` : `Saved “${name.trim()}”. It still needs accepting before it can run.`);
      onDone();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="ar-tool-edit">
      <label>
        Name <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Column <input value={column} onChange={(e) => setColumn(e.target.value)} />
      </label>
      <label>
        Which markups (filter)
        <textarea rows={4} spellCheck={false} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <label>
        Value (action)
        <textarea rows={4} spellCheck={false} value={action} onChange={(e) => setAction(e.target.value)} />
      </label>
      {problem && <p className="warn">{problem}</p>}
      <div className="tp-actions">
        <button type="button" className="btn small" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn small primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
