import { msg, msgParts } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { keyed } from '../i18n/keyed';
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
const STATUS = lazy((): Record<GroupingTool['status'], string> => ({ proposed: msg('Proposed'), accepted: msg('Accepted'), rejected: msg('Rejected') }));

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
  if (!shown.length) return <p className="empty">{msg('No grouping tools yet. Your AI client can propose one (propose_grouping_tool), such as “doors by fire rating”.')}</p>;
  return (
    <>
      <p className="hint-text takeoff-review-note">{msg('Tools are rules, not code: which markups, and the value each gets in a column. They are kept on this computer for every takeoff. A tool never changes a quantity: running it proposes a grouping column for you to review.')}</p>
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
      onMessage(msg('“{name}” grouped {count, plural, one {# markup} other {# markups}}. Review the column before accepting it.', { name: t.name, count: p.assignments.length }));
      onRan();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <article className={`takeoff-proposal ${t.status === 'accepted' ? 'approved' : t.status === 'rejected' ? 'rejected' : 'pending'}`} aria-label={msg('Tool: {name}', { name: t.name })}>
      <div className="tp-head">
        <span className="ar-kind tool">{msg('Tool')}</span>
        <b>{t.name}</b>
        <span className="grow" />
        {t.disabled && <span className="tp-state rejected">{msg('Off')}</span>}
        <span className={`tp-state ${t.status === 'accepted' ? 'approved' : t.status === 'rejected' ? 'rejected' : 'pending'}`}>{STATUS()[t.status]}</span>
      </div>
      {editing ? (
        <ToolEditor t={t} onDone={() => setEditing(false)} onMessage={onMessage} />
      ) : (
        <>
          <p>{t.description}</p>
          <p className="hint-text">
            <b>{msg('Rule:')}</b> {describeRuleFilter(t.filter)} → {t.column}: {describeRuleAction(t.action)}
          </p>
          <blockquote className="tp-reason">
            <span className="hint-text">
              {t.source}, {when(t.createdAt)}:
            </span>{' '}
            {t.reasoning}
          </blockquote>
          {t.decided && (
            <p className="hint-text">
              {msg('{sTATUS} by {by}, {when}.', { sTATUS: STATUS()[t.status], by: t.decided.by, when: when(t.decided.at) })}
            </p>
          )}
          {!!t.uses?.length && (
            <details className="hint-text">
              <summary>
                {msg('Used {count, plural, one {# time} other {# times}}', { count: t.uses.length })}
              </summary>
              <ul>
                {t.uses
                  .slice(-20)
                  .reverse()
                  .map((u) => (
                    <li key={u.proposalId}>
                      {msg('{documentName}: {markups, plural, one {# markup} other {# markups}}, {when}', { documentName: u.documentName, markups: u.markups, when: when(u.at) })}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}
      {!editing && (
        <div className="tp-actions">
          <button type="button" className="btn small" onClick={() => window.confirm(msg('Delete the tool “{name}”? Groupings it already made stay as they are.', { name: t.name })) && toolLibrary.delete(t.id)}>
            {msg('Delete')}
          </button>
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            {msg('Edit')}
          </button>
          {t.status === 'proposed' && (
            <>
              <button type="button" className="btn small" onClick={() => toolLibrary.reject(t.id, me)}>
                {msg('Reject')}
              </button>
              <button type="button" className="btn small primary" onClick={() => toolLibrary.accept(t.id, me)}>
                {msg('Accept Tool')}
              </button>
            </>
          )}
          {t.status === 'accepted' && (
            <>
              <button type="button" className="btn small" onClick={() => toolLibrary.setDisabled(t.id, !t.disabled)}>
                {t.disabled ? msg('Turn On') : msg('Turn Off')}
              </button>
              <button type="button" className="btn small primary" disabled={!toolRuns(t) || store.readOnly} onClick={run} title={msg('Propose this tool\'s grouping for the document on screen')}>
                {msg('Run on This Document')}
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
      onMessage(t.status === 'accepted' ? msg('Saved “{name}”.', { name: name.trim() }) : msg('Saved “{name}”. It still needs accepting before it can run.', { name: name.trim() }));
      onDone();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="ar-tool-edit">
      <label>
        {keyed(msgParts('Name {input}', { input: <input value={name} onChange={(e) => setName(e.target.value)} /> }))}
      </label>
      <label>
        {keyed(msgParts('Description {input}', { input: <input value={description} onChange={(e) => setDescription(e.target.value)} /> }))}
      </label>
      <label>
        {keyed(msgParts('Column {input}', { input: <input value={column} onChange={(e) => setColumn(e.target.value)} /> }))}
      </label>
      <label>
        {keyed(msgParts('Which markups (filter){textarea}', { textarea: <textarea rows={4} spellCheck={false} value={filter} onChange={(e) => setFilter(e.target.value)} /> }))}
      </label>
      <label>
        {keyed(msgParts('Value (action){textarea}', { textarea: <textarea rows={4} spellCheck={false} value={action} onChange={(e) => setAction(e.target.value)} /> }))}
      </label>
      {problem && <p className="warn">{problem}</p>}
      <div className="tp-actions">
        <button type="button" className="btn small" onClick={onDone}>
          {msg('Cancel')}
        </button>
        <button type="button" className="btn small primary" onClick={save}>
          {msg('Save')}
        </button>
      </div>
    </div>
  );
}
