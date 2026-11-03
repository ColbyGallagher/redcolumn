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
  { kind: 'added', label: 'Added' },
  { kind: 'removed', label: 'Removed' },
  { kind: 'modified', label: 'Modified' },
  { kind: 'moved', label: 'Moved' },
  { kind: 'unchanged', label: 'Unchanged' },
];

const BASIS: Record<MatchBasis, { label: string; title: string }> = {
  exact: { label: 'Same text', title: 'The two paragraphs have the same text. redcolumn checked.' },
  ai: { label: 'AI judgement', title: 'An AI client matched these by meaning. It can be wrong: check it against the documents.' },
  text: { label: 'Text match', title: 'Matched by how many words they share. No AI was involved.' },
};

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
  if (!paragraph) return <span className="sc-absent">{side === 'old' ? 'Not in the old revision' : 'Not in the new revision'}</span>;
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
    onGo(list[n]!);
  };

  const copyPrompt = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(aiPrompt(state.request));
      onMessage('Copied. Paste it into your AI client, which is connected to redcolumn.');
    } catch {
      onMessage('Could not copy. Ask your AI client to compare the two documents in redcolumn.');
    }
  };

  const picker = (value: string, onChange: (id: string) => void, label: string) => (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose a document…
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
        <h3 className="panel-subhead sc-heading">Compare documents</h3>
        <p className="sc-intro">Compares what two revisions say, not where it sits. A paragraph that only moved, or was lightly reworded, is not reported as a change.</p>
        <label className="sc-field">Old revision {picker(oldId, setOldId, 'Old revision')}</label>
        <label className="sc-field">New revision {picker(newId, setNewId, 'New revision')}</label>
        {oldId && oldId === newId && <p className="print-error">Choose two different documents.</p>}
        {docs.length < 2 && <p className="print-error">Open both revisions in tabs first.</p>}
        {error && <p className="print-error">{error}</p>}
        <p className="sc-intro sc-privacy">
          {desktop()
            ? 'The text of both documents is shared only with the AI client you connected to redcolumn, and only after you press Compare or allow its request. Without one you get a plain text comparison. You can also ask your AI client to compare two open documents.'
            : 'This is the web app, which has no AI client to ask. You get a plain text comparison; the desktop app can ask your AI client to judge it by meaning.'}
        </p>
        <div className="sc-actions">
          <button className="btn small primary" disabled={!valid || busy} onClick={() => void run()}>
            {busy ? 'Reading…' : 'Compare'}
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
      <h3 className="panel-subhead sc-heading">Compare documents</h3>
      <p className="sc-docs" title={`${request.oldName} → ${request.newName}`}>
        <span>{request.oldName}</span> → <span>{request.newName}</span>
      </p>
      {phase === 'ai' && (
        <div className="sc-status ai" role="status">
          <b>AI-assisted.</b> {source} judged these by meaning. That is an opinion, not a fact: check what matters against the documents.
          {failure ? ` It stopped early: ${failure}` : ''}
          {unreported > 0 ? ` ${unreported} paragraph${unreported === 1 ? '' : 's'} it did not judge ${unreported === 1 ? 'was' : 'were'} compared by text instead (marked Text match).` : ''}
          {summary && <p className="sc-summary">{summary}</p>}
        </div>
      )}
      {phase === 'waiting' && (
        <div className="sc-status" role="status">
          {desktop() && assistantOn
            ? `Waiting for your AI client (up to ${reportWait} minutes). Ask it to compare these in redcolumn, or copy the request for it. This plain text comparison shows meanwhile.`
            : desktop()
              ? 'No AI client is connected. Turn on the assistant in File → Preferences → MCP to have one judge this by meaning. This plain text comparison shows meanwhile.'
              : 'This is a plain text comparison. Moved paragraphs are matched by their words.'}
        </div>
      )}
      {phase === 'fallback' && (
        <div className="sc-status warn" role="status">
          <b>Basic text comparison.</b> {failure ? `${source ?? 'The AI client'} could not judge this: ${failure}` : `No AI client answered in ${reportWait} minutes.`} Paragraphs are matched by the words they share, so a heavily reworded one can show as removed plus added.
        </div>
      )}
      <div className="sc-kinds" role="group" aria-label="Show">
        {KINDS.map(({ kind, label }) => (
          <label key={kind} className={`sc-kind ${kind}`}>
            <input
              type="checkbox"
              checked={shown.has(kind)}
              onChange={(e) => {
                setShown((s) => new Set(e.target.checked ? [...s, kind] : [...s].filter((k) => k !== kind)));
                setAt(-1);
              }}
            />
            {label} {counts[kind]}
          </label>
        ))}
      </div>
      <div className="sc-nav">
        <button className="btn small" disabled={!list.length} onClick={() => go(at - 1)}>
          ‹ Previous
        </button>
        <span>{at >= 0 ? `${at + 1} of ${list.length}` : `${list.length} shown`}</span>
        <button className="btn small" disabled={!list.length} onClick={() => go(at + 1)}>
          Next ›
        </button>
      </div>
      <ul className="sc-list">
        {!list.length && <li className="sc-empty">{changes.length ? 'Nothing of the kinds ticked above.' : 'No text found to compare. Scanned pages need OCR first.'}</li>}
        {list.map((c, i) => (
          <li key={c.id}>
            <button className={`sc-item ${c.kind}${i === at ? ' active' : ''}`} onClick={() => go(i)} aria-current={i === at}>
              <span className="sc-item-head">
                <span className={`sc-kind-tag ${c.kind}`}>{KINDS.find((k) => k.kind === c.kind)!.label}</span>
                {c.reordered && (
                  <span className="sc-basis" title="This paragraph also changed place">
                    moved too
                  </span>
                )}
                <span className={`sc-basis ${c.basis}`} title={BASIS[c.basis].title}>
                  {BASIS[c.basis].label}
                </span>
              </span>
              <span className="sc-sides">
                <span className="sc-side old">
                  <span className="sc-side-label">Old{c.old ? ` · p.${c.old.page}` : ''}</span>
                  <Side side="old" change={c} full={i === at} />
                </span>
                <span className="sc-side new">
                  <span className="sc-side-label">New{c.new ? ` · p.${c.new.page}` : ''}</span>
                  <Side side="new" change={c} full={i === at} />
                </span>
              </span>
              {c.note && <span className="sc-note">{c.note}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="sc-actions">
        <button className="btn small" onClick={() => onSideBySide(request.oldId, request.newId)}>
          Show side by side
        </button>
        {phase !== 'ai' && desktop() && assistantOn && (
          <button className="btn small" onClick={() => void copyPrompt()}>
            Copy request for AI
          </button>
        )}
        <button className="btn small" onClick={() => semanticCompare.clear()}>
          New comparison
        </button>
      </div>
    </div>
  );
}
