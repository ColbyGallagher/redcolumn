import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { LOW_CONFIDENCE, MARKUP_LABELS, type Assembly, type Markup, type MarkupStore, type SourceRef } from '@nb/markup';
import { itemQuantities } from '../assemblies/quantities';
import { approveProposals, takeoffProposals, type ApprovalEdit, type TakeoffProposal } from '../assemblies/proposals';
import { approveCountProposal, countProposals } from '../assemblies/countProposals';
import { CountMatches } from './CountReview';
import { cellsFor, formatNumber, type CellContext } from '../columns/listColumns';
import { GroupingReview, isWaitingGrouping } from './GroupingReview';
import { ToolLibraryReview } from './ToolLibraryReview';
import { useToolLibrary } from '../takeoff/toolLibrary';
import { approveDrafts, clearDecided, rejectDrafts, reopenDrafts, reviewItems, type ReviewItem, type ReviewState } from '../takeoff/aiReview';

interface Props {
  store: MarkupStore;
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
const KIND_LABEL: Record<ReviewItem['kind'], string> = { draft: 'Drawn', assembly: 'Assembly', count: 'Count' };
const STATE_LABEL: Record<ReviewState, string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' };
const plural = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

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

  const shown = useMemo(() => items.filter((i) => show === 'all' || (i.state === 'pending' && (show === 'pending' || i.low))), [items, show]);
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
    onMessage(`Approved ${plural(done, 'AI result')}${skipped ? `; ${skipped} could not be (gone, locked, someone else's or read-only)` : ''}. Undo takes it back.`);
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
    if (e.key === 'Escape') {
      onClose();
      e.preventDefault();
      return;
    }
    if (tab !== 'takeoff') return;
    const t = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, select, textarea')) return;
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
    <aside className="takeoff-review" role="complementary" aria-label="Review AI takeoff" tabIndex={-1} onKeyDown={onKey}>
      <header className="takeoff-review-head">
        <h3>Review AI Takeoff</h3>
        <span className="hint-text">{pending.length + store.aiReview().columns.filter(isWaitingGrouping).length + tools.filter((t) => t.status === 'proposed').length} waiting</span>
        <span className="grow" />
        <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="pending">Waiting for review</option>
          <option value="low">Waiting, low confidence</option>
          <option value="all">All, with decisions</option>
        </select>
        <button type="button" className="link-preview-btn" aria-label="Close takeoff review" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ar-tabs" role="tablist" aria-label="What to review">
        {(
          [
            ['takeoff', 'Takeoff', pending.length],
            ['columns', 'Columns', store.aiReview().columns.filter(isWaitingGrouping).length],
            ['tools', 'Tools', tools.filter((t) => t.status === 'proposed').length],
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
          <GroupingReview store={store} me={me} waitingOnly={show !== 'all'} pageLabel={pageLabel} onShow={onShow} onMessage={onMessage} />
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
        An AI client made these through the local assistant. Nothing counts towards the takeoff until you approve it: drawn ones are dashed and left out of quantities until then. Check each against its source.
      </p>
      <div className="ar-bar">
        <label>
          Flag below{' '}
          <input type="number" min={0} max={100} step={5} aria-label="Flag below confidence (%)" value={Math.round(threshold * 100)} onChange={(e) => setThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)} />% confidence
        </label>
        <span className="grow" />
        <span className="hint-text">A approve · R reject · E edit · N / P next</span>
      </div>
      <div className="takeoff-review-list" ref={list}>
        {!shown.length && <p className="empty">{items.length ? 'Nothing waiting for review.' : 'Nothing yet. Ask your AI client (connected to redcolumn) to take off quantities.'}</p>}
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
          />
        ))}
      </div>
      <footer className="takeoff-review-foot">
        <label className="tp-select-all">
          <input type="checkbox" checked={!!pending.length && pickedPending.length === pending.length} onChange={(e) => setPicked(e.target.checked ? new Set(pending.map((i) => i.key)) : new Set())} disabled={!pending.length} />
          <span>Select all waiting</span>
        </label>
        <span className="grow" />
        {show === 'all' && items.some((i) => i.state !== 'pending') && (
          <button type="button" className="btn small" disabled={readOnly} onClick={() => clearDecided(store)} title="Forget rejected drafts and decided proposals">
            Clear Decided
          </button>
        )}
        <button type="button" className="btn small" disabled={readOnly || !sure.length} title={`Approve every waiting result at or above ${pct(threshold)} confidence`} onClick={() => approve(sure)}>
          Approve {sure.length} at {pct(threshold)}+
        </button>
        <button type="button" className="btn small" disabled={!pickedPending.length} onClick={() => reject(pickedPending)}>
          Reject Selected ({pickedPending.length})
        </button>
        <button type="button" className="btn small primary" disabled={readOnly || !pickedPending.length} onClick={() => approve(pickedPending)}>
          Approve Selected ({pickedPending.length})
        </button>
      </footer>
        </>
      )}
    </aside>
  );
}

const NO_OFF = new Set<number>();

interface ItemProps {
  item: ReviewItem;
  open: boolean;
  picked: boolean;
  readOnly: boolean;
  store: MarkupStore;
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
}

function quantityText(i: ReviewItem, ctx: CellContext, off: ReadonlySet<number>): string {
  if (i.count) return i.state === 'approved' && i.count.placed ? `${i.count.placed.count}` : `${i.count.matches.length - [...off].filter((k) => k < i.count!.matches.length).length} of ${i.count.matches.length}`;
  const m = i.markup ?? i.rejected?.markup;
  return m ? (cellsFor(m, ctx).measurement?.text ?? '') : '';
}

function Item(props: ItemProps) {
  const { item: i, open, picked, readOnly, pageLabel, onOpen, onPick, onShowSource, onApprove, onReject, onReopen } = props;
  const pending = i.state === 'pending';
  const conf = i.confidence;
  return (
    <article data-key={i.key} className={`takeoff-proposal ${i.state}${open ? ' current' : ''}${pending && i.low ? ' low' : ''}`} aria-label={`${KIND_LABEL[i.kind]}: ${i.title}`} aria-current={open || undefined}>
      <div className="tp-head">
        {pending && <input type="checkbox" aria-label="Select" checked={picked} onChange={(e) => onPick(e.target.checked)} />}
        <span className={`ar-conf${i.low ? ' low' : ''}`} title={conf === undefined ? 'The AI did not say how sure it is' : `The AI is ${pct(conf)} sure`}>
          {i.low && pending ? '⚑ ' : ''}
          {conf === undefined ? '?' : pct(conf)}
        </span>
        <span className={`ar-kind ${i.kind}`}>{KIND_LABEL[i.kind]}</span>
        <button type="button" className="tp-measure" title="Show it on the sheet, and its details" onClick={onOpen} aria-expanded={open}>
          {i.title}
          {i.pageIndex !== null ? ` · ${pageLabel(i.pageIndex)}` : ''}
        </button>
        <span className="tp-value">{quantityText(i, props.ctx, props.off)}</span>
        <span className="grow" />
        {i.edits && <span className="ar-edited" title={`Changed by a person: ${i.edits.join(', ')}`}>edited</span>}
        <span className={`tp-state ${i.state}`}>{STATE_LABEL[i.state]}</span>
      </div>
      {open && (
        <div className="ar-detail">
          {i.kind === 'draft' && <DraftDetail {...props} />}
          {i.kind === 'assembly' && i.takeoff && <AssemblyDetail {...props} p={i.takeoff} />}
          {i.kind === 'count' && i.count && <CountMatches p={i.count} pageLabel={pageLabel} off={props.off} editable={pending} onToggle={props.onToggleMatch} onShow={props.onShowRect} />}
          {!!i.sources.length && (
            <ul className="ar-sources" aria-label="Sources">
              {i.sources.map((s, k) => (
                <li key={k}>
                  <button type="button" className="rc-linkish" onClick={() => onShowSource(s)} title="Show it on the drawing">
                    {pageLabel(s.pageIndex)}
                    {s.kind ? ` · ${s.kind}` : ''}
                  </button>
                  {s.text ? <span> “{s.text}”</span> : null}
                </li>
              ))}
            </ul>
          )}
          {!i.sources.length && <p className="hint-text">No source given: check it against the drawing.</p>}
          {i.reasoning && (
            <blockquote className="tp-reason">
              <span className="hint-text">
                {i.source}, {when(i.at)}:
              </span>{' '}
              {i.reasoning}
            </blockquote>
          )}
          <Decision {...props} />
          {pending && (
            <div className="tp-actions">
              <button type="button" className="btn small" onClick={onReject}>
                Reject
              </button>
              <button type="button" className="btn small primary" disabled={readOnly} onClick={onApprove}>
                Approve
              </button>
            </div>
          )}
          {i.state === 'rejected' && (
            <div className="tp-actions">
              <button type="button" className="btn small" disabled={readOnly} onClick={onReopen}>
                Review Again
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
        Approved by {i.markup.ai.review.by}, {when(i.markup.ai.review.at)}.
        {i.edits?.length ? ` Changed by a person since the AI drew it: ${i.edits.join(', ')}${i.edits.includes('subject') ? ` (AI: “${o.subject ?? ''}”)` : ''}${i.edits.includes('assembly') ? ` (AI: ${name(o.assemblyId)})` : ''}.` : ' As the AI drew it.'}
      </p>
    );
  }
  if (i.kind === 'draft' && i.edits?.length) return <p className="hint-text">You changed: {i.edits.join(', ')}. The AI's version is kept with it.</p>;
  if (i.kind === 'draft' && i.rejected) return <p className="hint-text">Rejected by {i.rejected.by}, {when(i.rejected.at)}: it is off the drawing.</p>;
  if (i.kind === 'assembly' && i.state === 'approved' && i.markup?.takeoffApproval) {
    const a = i.markup.takeoffApproval;
    return (
      <p className="hint-text">
        Approved by {a.by}, {when(a.at)}
        {a.edited ? `, edited before approving${a.proposedAssemblyId ? ` (the AI proposed ${name(a.proposedAssemblyId)})` : ''}` : ''}.
      </p>
    );
  }
  if (i.kind === 'assembly' && i.takeoff?.rejected) return <p className="hint-text">Rejected by {i.takeoff.rejected.by}, {when(i.takeoff.rejected.at)}.</p>;
  if (i.kind === 'count' && i.state === 'approved' && i.count?.placed) return <p className="hint-text">Approved by {i.count.placed.by}, {when(i.count.placed.at)}. Undo takes the counts back.</p>;
  if (i.kind === 'count' && i.count?.rejected) return <p className="hint-text">Rejected by {i.count.rejected.by}, {when(i.count.rejected.at)}.</p>;
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
          <input data-edit aria-label="Subject" className="ar-subject" value={m.subject ?? ''} placeholder="Subject" disabled={readOnly} onChange={(e) => store.update(m.id, { subject: e.target.value || undefined })} />
        ) : (
          <b>{m.subject ?? ''}</b>
        )}
        <button type="button" className="btn small" onClick={onShow} title="Select it on the sheet to move or reshape it">
          Edit Shape
        </button>
      </div>
      <div className="tp-assembly">
        <span className="hint-text">Assembly</span>
        {pending ? (
          <select aria-label="Assembly" value={m.assemblyId ?? ''} disabled={readOnly} onChange={(e) => store.update(m.id, { assemblyId: e.target.value || undefined })}>
            <option value="">None</option>
            {assemblies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === m.ai?.original.assemblyId ? ' (AI)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <b>{assembly?.name ?? 'none'}</b>
        )}
      </div>
      <ItemsTable items={items} expected={m.ai?.expected} />
      {!items.length && m.ai?.expected?.length ? <p className="hint-text">AI expected: {m.ai.expected.map((e) => `${e.item} ${formatNumber(e.quantity, 2)}${e.unit ? ` ${e.unit}` : ''}`).join(', ')}</p> : null}
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
        <span className="hint-text">Assembly</span>
        {pending ? (
          <select data-edit aria-label="Assembly" value={assemblyId} onChange={(e) => onEdit((x) => ({ ...x, assemblyId: e.target.value === p.assemblyId ? undefined : e.target.value, overrides: undefined }))}>
            {assemblies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === p.assemblyId ? ' (proposed)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <b>{assembly?.name ?? 'deleted assembly'}</b>
        )}
        {assemblyId !== p.assemblyId && <span className="warn">changed from {proposed?.name ?? 'the proposal'}</span>}
      </div>
      {!m && <p className="warn">The measurement it was for is gone.</p>}
      {assembly && assembly.variables.length > 0 && <div className="hint-text tp-vars">Variables: {assembly.variables.map((v) => `${v.name} = ${formatNumber(v.value, 4)}`).join(', ')}</div>}
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
          <th>Item</th>
          <th>Formula</th>
          <th className="num">Quantity</th>
          <th className="num">With waste</th>
          <th className="num">AI expected</th>
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
                    aria-label={`${q.item.name} quantity`}
                    className={set !== undefined ? 'tp-set' : undefined}
                    title={set !== undefined ? 'Set by hand (clear it to use the formula)' : 'From the formula; type to set it by hand'}
                    value={set ?? (q.base !== null ? Number(q.base.toFixed(4)) : '')}
                    onChange={(e) => onOverride(q.item.id, e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                ) : (
                  <>
                    {n(q.base)}
                    {set !== undefined && <span className="hint-text"> (set)</span>}
                  </>
                )}
              </td>
              <td className="num">
                <b>{n(q.rounded)}</b>
              </td>
              <td className={`num${differs ? ' warn' : ''}`} title={differs ? 'Differs from what the assembly works out' : undefined}>
                {exp ? `${formatNumber(exp.quantity, 2)}${differs ? ' ⚠' : ''}` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
