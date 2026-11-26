import { msg, msgParts } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { keyed } from '../i18n/keyed';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LOW_CONFIDENCE, MARKUP_LABELS, type Assembly, type Markup, type MarkupDocument, type TakeoffFacet, type AiReviewFacet, type SourceRef } from '@nb/markup';
import { itemQuantities } from '../assemblies/quantities';
import { approveProposals, takeoffProposals, type ApprovalEdit, type TakeoffProposal } from '../assemblies/proposals';
import { approveCountProposal, countProposals } from '../assemblies/countProposals';
import { CountMatches } from './CountReview';
import { cellsFor, formatNumber, type CellContext } from '../columns/listColumns';
import { GroupingReview, isWaitingGrouping } from './GroupingReview';
import { ToolLibraryReview } from './ToolLibraryReview';
import { useToolLibrary } from '../takeoff/toolLibrary';
import { ReviewFindings } from './ReviewFindings';
import { cancelReviewRequest, findingsByItem, liveFindings, needsDecision, requestReviewPass, setReviewPassEnabled } from '../takeoff/reviewPass';
import { reviewerInstructions } from '../desktop/assistantReviewPass';
import type { ReviewFinding } from '@nb/markup';
import { approveDrafts, clearDecided, rejectDrafts, reopenDrafts, reviewItems, waitingCount, type ReviewItem, type ReviewState } from '../takeoff/aiReview';

interface Props {
  store: MarkupDocument & TakeoffFacet & AiReviewFacet;
  /** Who approves: the name markups are authored under. */
  me: string;
  ctx: CellContext;
  pageLabel: (pageIndex: number) => string;
  /** Selects the measurement on the sheet and brings it into view. */
  onShow: (m: Markup) => void;
  /** Brings part of a page into view. */
  onShowRect: (pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void;
  /** Goes to a page. */
  onShowPage: (pageIndex: number) => void;
  onMessage: (text: string) => void;
  onClose: () => void;
  /** The document's name, recorded against a grouping tool's use. */
  documentName: string;
}

type Tab = 'takeoff' | 'columns' | 'tools';
type Show = 'pending' | 'low' | 'all';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatNumber(v, 2));
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const pct = (c: number) => `${Math.round(c * 100)}%`;
const KIND_LABEL = lazy((): Record<ReviewItem['kind'], string> => ({ draft: msg('Drawn'), assembly: msg('Assembly'), count: msg('Count') }));
const STATE_LABEL = lazy((): Record<ReviewState, string> => ({ pending: msg('Waiting'), approved: msg('Approved'), rejected: msg('Rejected') }));

/**
 * Takeoff › Review AI Takeoff: every measurement an AI client drew, every assembly it proposed for
 * a measurement, and every count of found symbols, in one list beside the sheet. Waiting ones come
 * first, lowest confidence first, with those below the threshold flagged. Each shows its quantity,
 * where it came from (click to see it on the drawing) and why, to approve, edit or reject on its
 * own or in bulk. Keys: A approve, R reject, E edit, N / P next and previous.
 */
export function TakeoffReview({ store, me, ctx, pageLabel, onShow, onShowRect, onShowPage, onMessage, onClose, documentName }: Props) {
  const [tab, setTab] = useState<Tab>('takeoff');
  const tools = useToolLibrary();
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
  const [threshold, setThreshold] = useState(LOW_CONFIDENCE);
  const items = reviewItems(store, threshold);
  const assemblies = store.resolvedAssemblies();
  const [show, setShow] = useState<Show>('pending');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, ApprovalEdit>>({});
  // Matches a person turned off, per count proposal (indexes into its matches).
  const [off, setOff] = useState<Record<string, Set<number>>>({});
  const list = useRef<HTMLDivElement>(null);
  const editFocus = useRef<string | null>(null);
  const readOnly = store.readOnly;

  const { byItem, missed } = findingsByItem(store);
  // A decided item the review pass has an open finding on still waits: for the finding.
  const findingWaits = (key: string) => (byItem.get(key) ?? []).some(needsDecision);
  const shown = items.filter((i) => show === 'all' || (i.state === 'pending' && (show === 'pending' || i.low)) || findingWaits(i.key));
  const pending = items.filter((i) => i.state === 'pending');
  const pickedPending = pending.filter((i) => picked.has(i.key));
  const sure = pending.filter((i) => !i.low);
  const cur = shown.find((i) => i.key === current) ?? null;

  const unpick = (keys: string[]) => setPicked((s) => new Set([...s].filter((k) => !keys.includes(k))));

  const showItem = (i: ReviewItem) => {
    if (i.markup) onShow(i.markup);
    else if (i.count?.matches[0]) onShowRect(i.count.matches[0].pageIndex, i.count.matches[0].rect);
    else if (i.rejected) onShowPage(i.rejected.markup.pageIndex);
  };
  const showSource = (s: SourceRef) => (s.rect ? onShowRect(s.pageIndex, s.rect) : onShowPage(s.pageIndex));
  const shownMissed = show === 'all' ? missed : missed.filter(needsDecision);
  const pass = store.reviewPass();
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(reviewerInstructions(documentName));
      onMessage(msg('Copied. Paste it into a new conversation (or ask your AI client for a subagent) so the review starts fresh.'));
    } catch {
      onMessage(msg('Could not copy to the clipboard.'));
    }
  };

  /** Approves items of every kind; each kind is its own undo step. */
  const approve = (list: ReviewItem[]) => {
    const drafts = list.filter((i) => i.kind === 'draft' && i.state === 'pending').map((i) => i.id);
    const props = list.flatMap((i) => (i.kind === 'assembly' && i.state === 'pending' && i.takeoff ? [i.takeoff] : []));
    const counts = list.filter((i) => i.kind === 'count' && i.state === 'pending' && i.count);
    let done = 0;
    let skipped = 0;
    if (drafts.length) {
      const r = approveDrafts(store, drafts, me);
      done += r.approved.length;
      skipped += r.skipped.length;
    }
    if (props.length) {
      const r = approveProposals(store, props, me, edits);
      done += r.approved.length;
      skipped += r.skipped.length;
    }
    for (const i of counts) {
      if (approveCountProposal(store, i.count!, me, off[i.id] ?? new Set())) done++;
      else skipped++;
    }
    unpick(list.map((i) => i.key));
    onMessage(msg('Approved {count, plural, one {# AI result} other {# AI results}}{value}. Undo takes it back.', { count: done, value: skipped ? msg('; {skipped} could not be (gone, locked, someone else\'s or read-only)', { skipped }) : '' }));
  };

  const reject = (list: ReviewItem[]) => {
    const drafts = list.filter((i) => i.kind === 'draft' && i.state === 'pending').map((i) => i.id);
    const props = list.filter((i) => i.kind === 'assembly' && i.state === 'pending').map((i) => i.id);
    const counts = list.filter((i) => i.kind === 'count' && i.state === 'pending').map((i) => i.id);
    store.checkpoint();
    store.batch(() => {
      if (drafts.length) rejectDrafts(store, drafts, me);
      if (props.length) takeoffProposals.reject(store, props, me);
      for (const id of counts) countProposals.reject(store, id, me);
    });
    unpick(list.map((i) => i.key));
  };

  const reopen = (i: ReviewItem) => {
    if (i.kind === 'draft') reopenDrafts(store, [i.id]);
    else if (i.kind === 'assembly') takeoffProposals.reopen(store, [i.id]);
    else countProposals.reopen(store, i.id);
  };

  const move = (by: number) => {
    if (!shown.length) return;
    const at = cur ? shown.indexOf(cur) : -1;
    const next = shown[Math.max(0, Math.min(shown.length - 1, at + by))]!;
    setCurrent(next.key);
    showItem(next);
  };

  // The current item stays in view in the list.
  useEffect(() => {
    if (!current) return;
    list.current?.querySelector(`[data-key="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'nearest' });
    if (editFocus.current === current) {
      editFocus.current = null;
      list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(current)}"] [data-edit]`)?.focus();
    }
  }, [current]);

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    // Typing in a field (a tool's rule, a column name): its keys are its own, Escape included.
    if (t.closest('input, select, textarea')) return;
    if (e.key === 'Escape') {
      onClose();
      e.preventDefault();
      return;
    }
    if (tab !== 'takeoff') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n' || k === 'j' || e.key === 'ArrowDown') move(1);
    else if (k === 'p' || k === 'k' || e.key === 'ArrowUp') move(-1);
    else if (k === 'a' && cur?.state === 'pending' && !readOnly) {
      approve([cur]);
      move(1);
    } else if (k === 'r' && cur?.state === 'pending') {
      reject([cur]);
      move(1);
    } else if (k === 'e' && cur) {
      showItem(cur);
      editFocus.current = cur.key;
      list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(cur.key)}"] [data-edit]`)?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <aside className="takeoff-review" role="complementary" aria-label={msg('Review AI takeoff')} tabIndex={-1} onKeyDown={onKey}>
      <header className="takeoff-review-head">
        <h3>{msg('Review AI Takeoff')}</h3>
        <span className="hint-text">{msg('{count} waiting', { count: waitingCount(store) + tools.filter((t) => t.status === 'proposed').length })}</span>
        <span className="grow" />
        <select aria-label={msg('Show')} value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="pending">{msg('Waiting for review')}</option>
          <option value="low">{msg('Waiting, low confidence')}</option>
          <option value="all">{msg('All, with decisions')}</option>
        </select>
        <button type="button" className="link-preview-btn" aria-label={msg('Close takeoff review')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ar-tabs" role="tablist" aria-label={msg('What to review')}>
        {(
          [
            ['takeoff', msg('Takeoff'), pending.length + liveFindings(store).filter((f) => needsDecision(f) && !f.item?.startsWith('column:')).length],
            ['columns', msg('Columns'), store.aiReview().columns.filter(isWaitingGrouping).length + liveFindings(store).filter((f) => needsDecision(f) && !!f.item?.startsWith('column:')).length],
            ['tools', msg('Tools'), tools.filter((t) => t.status === 'proposed').length],
          ] as const
        ).map(([id, label, count]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`ar-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
            {count ? <span className="ar-count">{count}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'columns' && (
        <div className="takeoff-review-list">
          <GroupingReview store={store} me={me} waitingOnly={show !== 'all'} pageLabel={pageLabel} onShow={onShow} onMessage={onMessage} findings={byItem} onShowSource={showSource} />
        </div>
      )}
      {tab === 'tools' && (
        <div className="takeoff-review-list">
          <ToolLibraryReview store={store} me={me} documentName={documentName} onMessage={onMessage} onRan={() => setTab('columns')} />
        </div>
      )}
      {tab === 'takeoff' && (
        <>
      <p className="hint-text takeoff-review-note">
        {msg('An AI client made these through the local assistant. Nothing counts towards the takeoff until you approve it: drawn ones are dashed and left out of quantities until then. Check each against its source.')}
      </p>
      <div className="ar-bar">
        <label>
          {keyed(msgParts('Flag below {input}% confidence', { input: <input type="number" min={0} max={100} step={5} aria-label={msg('Flag below confidence (%)')} value={Math.round(threshold * 100)} onChange={(e) => setThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)} /> }))}
        </label>
        <span className="grow" />
        <span className="hint-text">{msg('A approve · R reject · E edit · N / P next')}</span>
      </div>
      <div className="ar-bar ar-pass" aria-label={msg('AI review pass')}>
        <label title={msg('Off by default. When on, the AI client is asked to have each takeoff checked again in a fresh context.')}>
          {keyed(msgParts('{input} Review pass after each AI takeoff', { input: <input type="checkbox" checked={pass.enabled} disabled={readOnly} onChange={(e) => setReviewPassEnabled(store, e.target.checked)} /> }))}
        </label>
        <span className="grow" />
        {pass.requested ? (
          <>
            <span className="hint-text">{msg('Requested by {by}: waiting for your AI client', { by: pass.requested.by })}</span>
            <button type="button" className="btn small" disabled={readOnly} onClick={() => cancelReviewRequest(store)}>
              {msg('Cancel')}
            </button>
          </>
        ) : (
          <button type="button" className="btn small" disabled={readOnly || (!items.length && !store.aiReview().columns.length)} onClick={() => requestReviewPass(store, me)} title={msg('Ask your AI client for a second review, in a fresh context')}>
            {msg('Request Review Pass')}
          </button>
        )}
        <button type="button" className="btn small" onClick={copyPrompt} title={msg('Copy the reviewer\'s instructions, to paste into a new conversation with your AI client')}>
          {msg('Copy Reviewer Prompt')}
        </button>
      </div>
      <div className="takeoff-review-list" ref={list}>
        {!!shownMissed.length && (
          <section className="takeoff-proposal ar-missed" aria-label={msg('Possibly missed')}>
            <div className="tp-head">
              <b>{msg('Possibly missed')}</b>
              <span className="hint-text">{msg('items the AI review says the takeoff does not have')}</span>
            </div>
            <ReviewFindings store={store} me={me} findings={shownMissed} pageLabel={pageLabel} onShowSource={showSource} />
          </section>
        )}
        {!shown.length && <p className="empty">{items.length ? msg('Nothing waiting for review.') : msg('Nothing yet. Ask your AI client (connected to redcolumn) to take off quantities.')}</p>}
        {shown.map((i) => (
          <Item
            key={i.key}
            item={i}
            open={i.key === current}
            picked={picked.has(i.key)}
            readOnly={readOnly}
            store={store}
            assemblies={assemblies}
            ctx={ctx}
            edit={edits[i.id] ?? {}}
            off={off[i.id] ?? NO_OFF}
            pageLabel={pageLabel}
            onOpen={() => {
              setCurrent(i.key === current ? null : i.key);
              if (i.key !== current) showItem(i);
            }}
            onPick={(on) => setPicked((s) => (on ? new Set([...s, i.key]) : new Set([...s].filter((x) => x !== i.key))))}
            onEdit={(patch) => setEdits((all) => ({ ...all, [i.id]: patch(all[i.id] ?? {}) }))}
            onToggleMatch={(m) =>
              setOff((all) => {
                const next = new Set(all[i.id] ?? []);
                if (next.has(m)) next.delete(m);
                else next.add(m);
                return { ...all, [i.id]: next };
              })
            }
            onShowRect={onShowRect}
            onShowSource={showSource}
            onShow={() => showItem(i)}
            onApprove={() => approve([i])}
            onReject={() => reject([i])}
            onReopen={() => reopen(i)}
            findings={byItem.get(i.key) ?? NO_FINDINGS}
            me={me}
          />
        ))}
      </div>
      <footer className="takeoff-review-foot">
        <label className="tp-select-all">
          <input type="checkbox" checked={!!pending.length && pickedPending.length === pending.length} onChange={(e) => setPicked(e.target.checked ? new Set(pending.map((i) => i.key)) : new Set())} disabled={!pending.length} />
          <span>{msg('Select all waiting')}</span>
        </label>
        <span className="grow" />
        {show === 'all' && items.some((i) => i.state !== 'pending') && (
          <button type="button" className="btn small" disabled={readOnly} onClick={() => clearDecided(store)} title={msg('Forget rejected drafts and decided proposals')}>
            {msg('Clear Decided')}
          </button>
        )}
        <button type="button" className="btn small" disabled={readOnly || !sure.length} title={msg('Approve every waiting result at or above {pct} confidence', { pct: pct(threshold) })} onClick={() => approve(sure)}>
          {msg('Approve {count} at {pct}+', { count: sure.length, pct: pct(threshold) })}
        </button>
        <button type="button" className="btn small" disabled={!pickedPending.length} onClick={() => reject(pickedPending)}>
          {msg('Reject Selected ({count})', { count: pickedPending.length })}
        </button>
        <button type="button" className="btn small primary" disabled={readOnly || !pickedPending.length} onClick={() => approve(pickedPending)}>
          {msg('Approve Selected ({count})', { count: pickedPending.length })}
        </button>
      </footer>
        </>
      )}
    </aside>
  );
}

const NO_OFF = new Set<number>();
const NO_FINDINGS: ReviewFinding[] = [];

interface ItemProps {
  item: ReviewItem;
  open: boolean;
  picked: boolean;
  readOnly: boolean;
  store: MarkupDocument & TakeoffFacet & AiReviewFacet;
  assemblies: readonly Assembly[];
  ctx: CellContext;
  edit: ApprovalEdit;
  off: ReadonlySet<number>;
  pageLabel: (pageIndex: number) => string;
  onOpen: () => void;
  onPick: (on: boolean) => void;
  onEdit: (patch: (e: ApprovalEdit) => ApprovalEdit) => void;
  onToggleMatch: (i: number) => void;
  onShowRect: (pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void;
  onShowSource: (s: SourceRef) => void;
  onShow: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReopen: () => void;
  /** What the AI review pass said about it. */
  findings: readonly ReviewFinding[];
  me: string;
}

function quantityText(i: ReviewItem, ctx: CellContext, off: ReadonlySet<number>): string {
  if (i.count) return i.state === 'approved' && i.count.placed ? `${i.count.placed.count}` : `${i.count.matches.length - [...off].filter((k) => k < i.count!.matches.length).length} of ${i.count.matches.length}`;
  const m = i.markup ?? i.rejected?.markup;
  return m ? (cellsFor(m, ctx).measurement?.text ?? '') : '';
}

/** An assembly proposal needs its measurement and an assembly that still exists. */
function approvable({ item: i, assemblies, edit }: ItemProps): boolean {
  if (i.kind !== 'assembly' || !i.takeoff) return true;
  const id = edit.assemblyId ?? i.takeoff.assemblyId;
  return !!i.markup && assemblies.some((a) => a.id === id);
}

function Item(props: ItemProps) {
  const { item: i, open, picked, readOnly, pageLabel, onOpen, onPick, onShowSource, onApprove, onReject, onReopen } = props;
  const pending = i.state === 'pending';
  const conf = i.confidence;
  return (
    <article data-key={i.key} className={`takeoff-proposal ${i.state}${open ? ' current' : ''}${pending && i.low ? ' low' : ''}`} aria-label={`${KIND_LABEL()[i.kind]}: ${i.title}`} aria-current={open || undefined}>
      <div className="tp-head">
        {pending && <input type="checkbox" aria-label={msg('Select')} checked={picked} onChange={(e) => onPick(e.target.checked)} />}
        <span className={`ar-conf${i.low ? ' low' : ''}`} title={conf === undefined ? msg('The AI did not say how sure it is') : msg('The AI is {pct} sure', { pct: pct(conf) })}>
          {i.low && pending ? '⚑ ' : ''}
          {conf === undefined ? '?' : pct(conf)}
        </span>
        <span className={`ar-kind ${i.kind}`}>{KIND_LABEL()[i.kind]}</span>
        <button type="button" className="tp-measure" title={msg('Show it on the sheet, and its details')} onClick={onOpen} aria-expanded={open}>
          {i.title}
          {i.pageIndex !== null ? ` · ${pageLabel(i.pageIndex)}` : ''}
        </button>
        <span className="tp-value">{quantityText(i, props.ctx, props.off)}</span>
        <span className="grow" />
        {props.findings.some(needsDecision) && (
          <span className="ar-kind review" title={msg('The AI review pass has something to say about this')}>
            {msg('AI review: {count}', { count: props.findings.filter(needsDecision).length })}
          </span>
        )}
        {i.edits && <span className="ar-edited" title={msg('Changed by a person: {edits}', { edits: i.edits.join(', ') })}>{msg('edited')}</span>}
        <span className={`tp-state ${i.state}`}>{STATE_LABEL()[i.state]}</span>
      </div>
      {open && (
        <div className="ar-detail">
          {i.kind === 'draft' && <DraftDetail {...props} />}
          {i.kind === 'assembly' && i.takeoff && <AssemblyDetail {...props} p={i.takeoff} />}
          {i.kind === 'count' && i.count && <CountMatches p={i.count} pageLabel={pageLabel} off={props.off} editable={pending} onToggle={props.onToggleMatch} onShow={props.onShowRect} />}
          {!!i.sources.length && (
            <ul className="ar-sources" aria-label={msg('Sources')}>
              {i.sources.map((s, k) => (
                <li key={k}>
                  <button type="button" className="rc-linkish" onClick={() => onShowSource(s)} title={msg('Show it on the drawing')}>
                    {pageLabel(s.pageIndex)}
                    {s.kind ? ` · ${s.kind}` : ''}
                  </button>
                  {s.text ? <span> “{s.text}”</span> : null}
                </li>
              ))}
            </ul>
          )}
          {!i.sources.length && <p className="hint-text">{msg('No source given: check it against the drawing.')}</p>}
          {i.reasoning && (
            <blockquote className="tp-reason">
              <span className="hint-text">
                {i.source}, {when(i.at)}:
              </span>{' '}
              {i.reasoning}
            </blockquote>
          )}
          <ReviewFindings store={props.store} me={props.me} findings={props.findings} pageLabel={pageLabel} onShowSource={onShowSource} />
          <Decision {...props} />
          {pending && (
            <div className="tp-actions">
              <button type="button" className="btn small" onClick={onReject}>
                {msg('Reject')}
              </button>
              <button type="button" className="btn small primary" disabled={readOnly || !approvable(props)} title={approvable(props) ? undefined : msg('Its measurement or assembly is gone: choose another assembly, or reject it')} onClick={onApprove}>
                {msg('Approve')}
              </button>
            </div>
          )}
          {i.state === 'rejected' && (
            <div className="tp-actions">
              <button type="button" className="btn small" disabled={readOnly} onClick={onReopen}>
                {msg('Review Again')}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** Who decided, when, and what the person changed against what the AI made. */
function Decision({ item: i, assemblies }: ItemProps) {
  const name = (id: string | undefined) => assemblies.find((a) => a.id === id)?.name ?? 'none';
  if (i.kind === 'draft' && i.markup?.ai?.review) {
    const o = i.markup.ai.original;
    return (
      <p className="hint-text">
        {msg('Approved by {by}, {when}.{value}', { by: i.markup.ai.review.by, when: when(i.markup.ai.review.at), value: i.edits?.length ? ' ' + msg('Changed by a person since the AI drew it: {edits}{value}{value2}.', { edits: i.edits.join(', '), value: i.edits.includes('subject') ? ' ' + msg('(AI: “{value}”)', { value: o.subject ?? '' }) : '', value2: i.edits.includes('assembly') ? ' ' + msg('(AI: {name})', { name: name(o.assemblyId) }) : '' }) : ' ' + msg('As the AI drew it.') })}
      </p>
    );
  }
  if (i.kind === 'draft' && i.edits?.length) return <p className="hint-text">{msg('You changed: {edits}. The AI\'s version is kept with it.', { edits: i.edits.join(', ') })}</p>;
  if (i.kind === 'draft' && i.rejected) return <p className="hint-text">{msg('Rejected by {by}, {when}: it is off the drawing.', { by: i.rejected.by, when: when(i.rejected.at) })}</p>;
  if (i.kind === 'assembly' && i.state === 'approved' && i.markup?.takeoffApproval) {
    const a = i.markup.takeoffApproval;
    return (
      <p className="hint-text">
        {msg('Approved by {by}, {when}{value}.', { by: a.by, when: when(a.at), value: a.edited ? msg(', edited before approving{value}', { value: a.proposedAssemblyId ? ' ' + msg('(the AI proposed {name})', { name: name(a.proposedAssemblyId) }) : '' }) : '' })}
      </p>
    );
  }
  if (i.kind === 'assembly' && i.takeoff?.rejected) return <p className="hint-text">{msg('Rejected by {by}, {when}.', { by: i.takeoff.rejected.by, when: when(i.takeoff.rejected.at) })}</p>;
  if (i.kind === 'count' && i.state === 'approved' && i.count?.placed) return <p className="hint-text">{msg('Approved by {by}, {when}. Undo takes the counts back.', { by: i.count.placed.by, when: when(i.count.placed.at) })}</p>;
  if (i.kind === 'count' && i.count?.rejected) return <p className="hint-text">{msg('Rejected by {by}, {when}.', { by: i.count.rejected.by, when: when(i.count.rejected.at) })}</p>;
  return null;
}

/** A measurement the AI drew: its subject and assembly can be changed here, its shape on the sheet. */
function DraftDetail({ item: i, store, assemblies, ctx, readOnly, onShow }: ItemProps) {
  const m = i.markup;
  if (!m) return null;
  const pending = i.state === 'pending';
  const assembly = assemblies.find((a) => a.id === m.assemblyId);
  const cells = cellsFor(m, ctx);
  const items = assembly ? itemQuantities(m, assembly, cells, ctx.columns) : [];
  return (
    <>
      <div className="tp-assembly">
        <span className="hint-text">{MARKUP_LABELS[m.type]}</span>
        {pending ? (
          <input data-edit aria-label={msg('Subject')} className="ar-subject" value={m.subject ?? ''} placeholder={msg('Subject')} disabled={readOnly} onChange={(e) => store.update(m.id, { subject: e.target.value || undefined })} />
        ) : (
          <b>{m.subject ?? ''}</b>
        )}
        <button type="button" className="btn small" onClick={onShow} title={msg('Select it on the sheet to move or reshape it')}>
          {msg('Edit Shape')}
        </button>
      </div>
      <div className="tp-assembly">
        <span className="hint-text">{msg('Assembly')}</span>
        {pending ? (
          <select aria-label={msg('Assembly')} value={m.assemblyId ?? ''} disabled={readOnly} onChange={(e) => store.update(m.id, { assemblyId: e.target.value || undefined })}>
            <option value="">{msg('None')}</option>
            {assemblies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === m.ai?.original.assemblyId ? ' ' + msg('(AI)') : ''}
              </option>
            ))}
          </select>
        ) : (
          <b>{assembly?.name ?? msg('none')}</b>
        )}
      </div>
      <ItemsTable items={items} expected={m.ai?.expected} />
      {!items.length && m.ai?.expected?.length ? <p className="hint-text">{msg('AI expected: {list}', { list: m.ai.expected.map((e) => `${e.item} ${formatNumber(e.quantity, 2)}${e.unit ? ` ${e.unit}` : ''}`).join(', ') })}</p> : null}
    </>
  );
}

/** An assembly the AI proposed for a measurement: another can be chosen, and quantities set by hand, before approving. */
function AssemblyDetail({ item: i, p, assemblies, ctx, edit, onEdit }: ItemProps & { p: TakeoffProposal }) {
  const m = i.markup;
  const pending = i.state === 'pending';
  const assemblyId = i.state === 'approved' ? (m?.assemblyId ?? p.assemblyId) : (edit.assemblyId ?? p.assemblyId);
  const assembly = assemblies.find((a) => a.id === assemblyId);
  const proposed = assemblies.find((a) => a.id === p.assemblyId);
  const cells = m ? cellsFor(m, ctx) : null;
  const overrides = i.state === 'approved' ? m?.assemblyOverrides : edit.overrides;
  const items = m && assembly && cells ? itemQuantities({ ...m, assemblyOverrides: overrides }, assembly, cells, ctx.columns) : [];
  return (
    <>
      <div className="tp-assembly">
        <span className="hint-text">{msg('Assembly')}</span>
        {pending ? (
          <select data-edit aria-label={msg('Assembly')} value={assemblyId} onChange={(e) => onEdit((x) => ({ ...x, assemblyId: e.target.value === p.assemblyId ? undefined : e.target.value, overrides: undefined }))}>
            {assemblies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === p.assemblyId ? ' ' + msg('(proposed)') : ''}
              </option>
            ))}
          </select>
        ) : (
          <b>{assembly?.name ?? msg('deleted assembly')}</b>
        )}
        {assemblyId !== p.assemblyId && <span className="warn">{msg('changed from {value}', { value: proposed?.name ?? msg('the proposal') })}</span>}
      </div>
      {!m && <p className="warn">{msg('The measurement it was for is gone.')}</p>}
      {assembly && assembly.variables.length > 0 && <div className="hint-text tp-vars">{msg('Variables: {list}', { list: assembly.variables.map((v) => `${v.name} = ${formatNumber(v.value, 4)}`).join(', ') })}</div>}
      <ItemsTable
        items={items}
        expected={p.expected}
        overrides={overrides}
        onOverride={
          pending
            ? (id, v) =>
                onEdit((x) => {
                  const next = { ...x.overrides };
                  if (v === undefined || !Number.isFinite(v)) delete next[id];
                  else next[id] = v;
                  return { ...x, overrides: next };
                })
            : undefined
        }
      />
    </>
  );
}

/** An assembly's quantities for a measurement, beside what the AI expected. */
function ItemsTable({ items, expected, overrides, onOverride }: { items: ReturnType<typeof itemQuantities>; expected?: { item: string; quantity: number; unit?: string }[]; overrides?: Record<string, number>; onOverride?: (itemId: string, v: number | undefined) => void }) {
  if (!items.length) return null;
  const expectedOf = (name: string) => expected?.find((e) => e.item.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <table className="qty-table tp-items">
      <thead>
        <tr>
          <th>{msg('Item')}</th>
          <th>{msg('Formula')}</th>
          <th className="num">{msg('Quantity')}</th>
          <th className="num">{msg('With waste')}</th>
          <th className="num">{msg('AI expected')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((q) => {
          const exp = expectedOf(q.item.name);
          const differs = exp && q.rounded !== null && Math.abs(exp.quantity - q.rounded) > Math.max(0.01, Math.abs(q.rounded) * 0.01);
          const set = overrides?.[q.item.id];
          return (
            <tr key={q.item.id}>
              <td>
                {q.item.name} <span className="hint-text">{q.item.unit}</span>
              </td>
              <td>
                <code>{q.item.formula}</code>
                {q.error && <span className="warn"> {q.error}</span>}
              </td>
              <td className="num">
                {onOverride ? (
                  <input
                    type="number"
                    step="any"
                    aria-label={msg('{name} quantity', { name: q.item.name })}
                    className={set !== undefined ? 'tp-set' : undefined}
                    title={set !== undefined ? msg('Set by hand (clear it to use the formula)') : msg('From the formula; type to set it by hand')}
                    value={set ?? (q.base !== null ? Number(q.base.toFixed(4)) : '')}
                    onChange={(e) => onOverride(q.item.id, e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                ) : (
                  <>
                    {n(q.base)}
                    {set !== undefined && <span className="hint-text"> {msg('(set)')}</span>}
                  </>
                )}
              </td>
              <td className="num">
                <b>{n(q.rounded)}</b>
              </td>
              <td className={`num${differs ? ' warn' : ''}`} title={differs ? msg('Differs from what the assembly works out') : undefined}>
                {exp ? `${formatNumber(exp.quantity, 2)}${differs ? ' ⚠' : ''}` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
