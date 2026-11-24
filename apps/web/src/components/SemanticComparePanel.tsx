import { msg } from '@nb/i18n';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { countKinds, type ChangeKind, type MatchBasis, type SemanticChange, type WordPart } from '../compare/semantic';
import { aiPrompt, AI_WAIT_MS, semanticCompare, useSemanticCompare } from '../compare/semanticStore';
import { assistantIsOn, subscribeAssistant } from '../desktop/assistantFlag';
import { desktop } from '../desktop/host';

interface Props {
  /** Documents open in tabs, the only ones whose text the app can read. */
  docs: readonly { id: string; name: string }[];
  /** The document in front: the new revision by default. */
  currentId: string | null;
  /** Reads both documents and starts the comparison. Throws a sentence a person can act on. */
  onRun: (oldId: string, newId: string) => Promise<void>;
  /** Shows a change in both revisions, side by side. */
  onGo: (change: SemanticChange) => void;
  onSideBySide: (oldId: string, newId: string) => void;
  onMessage: (text: string) => void;
}

const KINDS: { kind: ChangeKind; label: string }[] = [
  { kind: 'added', get label() { return msg('Added'); } },
  { kind: 'removed', get label() { return msg('Removed'); } },
  { kind: 'modified', get label() { return msg('Modified'); } },
  { kind: 'moved', get label() { return msg('Moved'); } },
  { kind: 'unchanged', get label() { return msg('Unchanged'); } },
];

const BASIS: Record<MatchBasis, { label: string; title: string }> = {
  exact: { get label() { return msg('Same text'); }, get title() { return msg('The two paragraphs have the same text. redcolumn checked.'); } },
  ai: { get label() { return msg('AI judgement'); }, get title() { return msg('An AI client matched these by meaning. It can be wrong: check it against the documents.'); } },
  text: { get label() { return msg('Text match'); }, get title() { return msg('Matched by how many words they share. No AI was involved.'); } },
};

/** Changes listed at first, and added by each Show more: thousands are listed a page at a time. */
const PAGE = 200;

/** Words of context kept either side of a change; longer unchanged runs are cut to this. */
const CONTEXT = 5;

/** A wording diff cut down to the changes with a few words around each. */
export function excerpt(parts: readonly WordPart[]): WordPart[] {
  const out: WordPart[] = [];
  parts.forEach((p, i) => {
    if (p.op !== 'same') return void out.push(p);
    const words = p.text.split(' ');
    const first = i === 0;
    const last = i === parts.length - 1;
    if (words.length <= CONTEXT * 2 + 1 || (first && words.length <= CONTEXT + 1) || (last && words.length <= CONTEXT + 1)) return void out.push(p);
    if (!first) out.push({ op: 'same', text: words.slice(0, CONTEXT).join(' ') });
    out.push({ op: 'same', text: '…' });
    if (!last) out.push({ op: 'same', text: words.slice(-CONTEXT).join(' ') });
  });
  return out;
}

const clip = (text: string, n = 220) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

/** One revision's side of a change: its text, with the words that changed marked when the wording differs. */
function Side({ side, change, full }: { side: 'old' | 'new'; change: SemanticChange; full: boolean }) {
  const paragraph = side === 'old' ? change.old : change.new;
  if (!paragraph) return <span className="sc-absent">{side === 'old' ? msg('Not in the old revision') : msg('Not in the new revision')}</span>;
  if (!change.wording) return <span className="sc-text">{full ? paragraph.text : clip(paragraph.text)}</span>;
  const mark = side === 'old' ? 'del' : 'ins';
  const parts = (full ? change.wording : excerpt(change.wording)).filter((p) => p.op === 'same' || p.op === mark);
  return (
    <span className="sc-text">
      {parts.map((p, k) => (p.op === 'del' ? <del key={k}>{p.text} </del> : p.op === 'ins' ? <ins key={k}>{p.text} </ins> : <span key={k}>{p.text} </span>))}
    </span>
  );
}

/**
 * The Compare section of the AI side panel (Document › AI Compare Documents): what changed in two revisions' text,
 * by meaning. Paragraphs that only moved, or were lightly reworded, are not reported as changes.
 * Each change shows the old revision's paragraph and the new one's; clicking it puts both revisions
 * side by side and takes each to its paragraph. The comparison is started here, or by an AI client
 * (start_comparison); the client reads the paragraphs and reports what it judges. Until it does,
 * and if it never does, the built-in text comparison stands, and the panel says which one this is.
 */
export function SemanticComparePanel({ docs, currentId, onRun, onGo, onSideBySide, onMessage }: Props) {
  const state = useSemanticCompare();
  const assistantOn = useSyncExternalStore(subscribeAssistant, assistantIsOn, () => false);
  const [newId, setNewId] = useState(currentId ?? docs[0]?.id ?? '');
  const [oldId, setOldId] = useState(() => docs.find((d) => d.id !== (currentId ?? docs[0]?.id))?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<Set<ChangeKind>>(new Set(['added', 'removed', 'modified', 'moved']));
  const [at, setAt] = useState(-1);
  // The changes listed: from `start` up to `limit`, around the one gone to.
  const [start, setStart] = useState(0);
  const [limit, setLimit] = useState(PAGE);

  const changes = state?.result.changes ?? [];
  const counts = useMemo(() => countKinds(changes), [changes]);
  const list = changes.filter((c) => shown.has(c.kind));
  const valid = !!oldId && !!newId && oldId !== newId;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await onRun(oldId, newId);
      setAt(-1);
      setStart(0);
      setLimit(PAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const go = (i: number) => {
    if (!list.length) return;
    const n = (i + list.length) % list.length;
    setAt(n);
    // Going outside the listed changes lists the page of them it is on, not all up to it.
    if (n < start || n >= limit) {
      const from = Math.floor(n / PAGE) * PAGE;
      setStart(from);
      setLimit(from + PAGE);
    }
    onGo(list[n]!);
  };

  const copyPrompt = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(aiPrompt(state.request));
      onMessage(msg('Copied. Paste it into your AI client, which is connected to redcolumn.'));
    } catch {
      onMessage(msg('Could not copy. Ask your AI client to compare the two documents in redcolumn.'));
    }
  };

  const picker = (value: string, onChange: (id: string) => void, label: string) => (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        {msg('Choose a document…')}
      </option>
      {docs.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );

  if (!state) {
    return (
      <div className="semantic-compare sc-panel">
        <h3 className="panel-subhead sc-heading">{msg('Compare documents')}</h3>
        <p className="sc-intro">{msg('Compares what two revisions say, not where it sits. A paragraph that only moved, or was lightly reworded, is not reported as a change.')}</p>
        <label className="sc-field">
          {msg('Old revision')} {picker(oldId, setOldId, msg('Old revision'))}
        </label>
        <label className="sc-field">
          {msg('New revision')} {picker(newId, setNewId, msg('New revision'))}
        </label>
        {oldId && oldId === newId && <p className="print-error">{msg('Choose two different documents.')}</p>}
        {docs.length < 2 && <p className="print-error">{msg('Open both revisions in tabs first.')}</p>}
        {error && <p className="print-error">{error}</p>}
        <p className="sc-intro sc-privacy">
          {desktop()
            ? msg('The text of both documents is shared only with the AI client you connected to redcolumn, and only after you press Compare or allow its request. Without one you get a plain text comparison. You can also ask your AI client to compare two open documents.')
            : msg('This is the web app, which has no AI client to ask. You get a plain text comparison; the desktop app can ask your AI client to judge it by meaning.')}
        </p>
        <div className="sc-actions">
          <button className="btn small primary" disabled={!valid || busy} onClick={() => void run()}>
            {busy ? msg('Reading…') : msg('Compare')}
          </button>
        </div>
      </div>
    );
  }

  const { request, phase, source, failure, summary } = state;
  const reportWait = Math.round(AI_WAIT_MS / 60000);
  const unreported = state.result.unreported;
  return (
    <div className="semantic-compare sc-panel">
      <h3 className="panel-subhead sc-heading">{msg('Compare documents')}</h3>
      <p className="sc-docs" title={`${request.oldName} → ${request.newName}`}>
        <span>{request.oldName}</span> → <span>{request.newName}</span>
      </p>
      {phase === 'ai' && (
        <div className="sc-status ai" role="status">
          <b>{msg('AI-assisted.')}</b> {msg('{source} judged these by meaning. That is an opinion, not a fact: check what matters against the documents.', { source })}
          {failure ? ' ' + msg('It stopped early: {failure}', { failure }) : ''}
          {unreported > 0 ? ' ' + msg('{count, plural, one {# paragraph it did not judge was} other {# paragraphs it did not judge were}} compared by text instead (marked Text match).', { count: unreported }) : ''}
          {summary && <p className="sc-summary">{summary}</p>}
        </div>
      )}
      {phase === 'waiting' && (
        <div className="sc-status" role="status">
          {desktop() && assistantOn
            ? msg('Waiting for your AI client (up to {reportWait} minutes). Ask it to compare these in redcolumn, or copy the request for it. This plain text comparison shows meanwhile.', { reportWait })
            : desktop()
              ? msg('No AI client is connected. Turn on the assistant in File → Preferences → MCP to have one judge this by meaning. This plain text comparison shows meanwhile.')
              : msg('This is a plain text comparison. Moved paragraphs are matched by their words.')}
        </div>
      )}
      {phase === 'fallback' && (
        <div className="sc-status warn" role="status">
          <b>{msg('Basic text comparison.')}</b>{' '}
          {failure ? (source ? msg('{source} could not judge this: {failure}', { source, failure }) : msg('The AI client could not judge this: {failure}', { failure })) : msg('No AI client answered in {minutes} minutes.', { minutes: reportWait })}{' '}
          {msg('Paragraphs are matched by the words they share, so a heavily reworded one can show as removed plus added.')}
        </div>
      )}
      <div className="sc-kinds" role="group" aria-label={msg('Show')}>
        {KINDS.map(({ kind, label }) => (
          <label key={kind} className={`sc-kind ${kind}`}>
            <input
              type="checkbox"
              checked={shown.has(kind)}
              onChange={(e) => {
                setShown((s) => new Set(e.target.checked ? [...s, kind] : [...s].filter((k) => k !== kind)));
                setAt(-1);
                setStart(0);
                setLimit(PAGE);
              }}
            />
            {label} {counts[kind]}
          </label>
        ))}
      </div>
      <div className="sc-nav">
        <button className="btn small" disabled={!list.length} onClick={() => go(at < 0 ? -1 : at - 1)}>
          {msg('‹ Previous')}
        </button>
        <span>{at >= 0 ? msg('{current} of {total}', { current: at + 1, total: list.length }) : msg('{count} shown', { count: list.length })}</span>
        <button className="btn small" disabled={!list.length} onClick={() => go(at + 1)}>
          {msg('Next ›')}
        </button>
      </div>
      <ul className="sc-list">
        {!list.length && <li className="sc-empty">{changes.length ? msg('Nothing of the kinds ticked above.') : msg('No text found to compare. Scanned pages need OCR first.')}</li>}
        {start > 0 && (
          <li className="sc-more">
            <button className="btn small flat" onClick={() => setStart(Math.max(0, start - PAGE))}>
              {msg('Show {count} earlier of {start}', { count: Math.min(PAGE, start), start })}
            </button>
          </li>
        )}
        {list.slice(start, limit).map((c, j) => {
          const i = start + j;
          return (
            <li key={c.id}>
              <button className={`sc-item ${c.kind}${i === at ? ' active' : ''}`} onClick={() => go(i)} aria-current={i === at}>
                <span className="sc-item-head">
                  <span className={`sc-kind-tag ${c.kind}`}>{KINDS.find((k) => k.kind === c.kind)!.label}</span>
                  {c.reordered && (
                    <span className="sc-basis" title={msg('This paragraph also changed place')}>
                      {msg('moved too')}
                    </span>
                  )}
                  <span className={`sc-basis ${c.basis}`} title={BASIS[c.basis].title}>
                    {BASIS[c.basis].label}
                  </span>
                </span>
                <span className="sc-sides">
                  <span className="sc-side old">
                    <span className="sc-side-label">{c.old ? msg('Old · p.{page}', { page: c.old.page }) : msg('Old')}</span>
                    <Side side="old" change={c} full={i === at} />
                  </span>
                  <span className="sc-side new">
                    <span className="sc-side-label">{c.new ? msg('New · p.{page}', { page: c.new.page }) : msg('New')}</span>
                    <Side side="new" change={c} full={i === at} />
                  </span>
                </span>
                {c.note && <span className="sc-note">{c.note}</span>}
              </button>
            </li>
          );
        })}
        {list.length > limit && (
          <li className="sc-more">
            <button className="btn small flat" onClick={() => setLimit(limit + PAGE)}>
              {msg('Show {count} more of {count2}', { count: Math.min(PAGE, list.length - limit), count2: list.length - limit })}
            </button>
          </li>
        )}
      </ul>
      <div className="sc-actions">
        <button className="btn small" onClick={() => onSideBySide(request.oldId, request.newId)}>
          {msg('Show side by side')}
        </button>
        {phase !== 'ai' && desktop() && assistantOn && (
          <button className="btn small" onClick={() => void copyPrompt()}>
            {msg('Copy request for AI')}
          </button>
        )}
        <button className="btn small" onClick={() => semanticCompare.clear()}>
          {msg('New comparison')}
        </button>
      </div>
    </div>
  );
}
