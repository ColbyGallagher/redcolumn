import { useSyncExternalStore } from 'react';
import { aiEdits, isAiDraft, LOW_CONFIDENCE, MARKUP_LABELS, type CountProposal, type Markup, type MarkupDocument, type AiReviewFacet, type RejectedDraft, type SourceRef, type TakeoffProposal } from '@nb/markup';
import { stateOf as takeoffState } from '../assemblies/proposals';
import { countStateOf } from '../assemblies/countProposals';
import { liveFindings, needsDecision } from './reviewPass';

/**
 * Review AI Takeoff: everything an AI client produced for a document, in one list a person works
 * through. Three kinds: measurements it drew (AI drafts, `Markup.ai`), assemblies it proposed for
 * measurements, and counts of found symbols. Nothing counts towards the takeoff until a person
 * approves it here. The lowest confidence comes first, so the doubtful ones get looked at first.
 */

export type ReviewKind = 'draft' | 'assembly' | 'count';
export type ReviewState = 'pending' | 'approved' | 'rejected';

export interface ReviewItem {
  /** Unique across kinds: `kind:id`. */
  key: string;
  kind: ReviewKind;
  /** The draft's markup id, or the proposal's id. */
  id: string;
  state: ReviewState;
  /** What it is: the draft's or count's subject, or the measurement the assembly is for. */
  title: string;
  /** Where it is (0-based), when on one page. */
  pageIndex: number | null;
  confidence?: number;
  /** Below the confidence threshold (or none was given): look at it first. */
  low: boolean;
  /** The AI client's name, and when it proposed it. */
  source: string;
  at: number;
  reasoning?: string;
  sources: SourceRef[];
  /** The measurement on the drawing: the draft, or the one an assembly is proposed for. */
  markup?: Markup;
  takeoff?: TakeoffProposal;
  count?: CountProposal;
  rejected?: RejectedDraft;
  /** On an approved draft: what the person changed against what the AI made. */
  edits?: ReturnType<typeof aiEdits>;
}

const titleOf = (m: Markup | undefined) => (m ? (m.subject ?? MARKUP_LABELS[m.type]) : 'Deleted measurement');
const isLow = (c: number | undefined, threshold: number) => c === undefined || c < threshold;

/** Every AI result for the document, waiting ones first, then lowest confidence, then by page. */
export function reviewItems(store: MarkupDocument & AiReviewFacet, threshold = LOW_CONFIDENCE): ReviewItem[] {
  const review = store.aiReview();
  const items: ReviewItem[] = [];
  // Count markups an approved count placed are listed under that count, not one by one.
  const placed = new Set(review.counts.flatMap((c) => c.placed?.markupIds ?? []));
  for (const m of store.all()) {
    if (!m.ai || (placed.has(m.id) && !isAiDraft(m))) continue;
    const pending = isAiDraft(m);
    const edits = aiEdits(m);
    items.push({
      key: `draft:${m.id}`,
      kind: 'draft',
      id: m.id,
      state: pending ? 'pending' : 'approved',
      title: titleOf(m),
      pageIndex: m.pageIndex,
      confidence: m.ai.confidence,
      low: isLow(m.ai.confidence, threshold),
      source: m.ai.source,
      at: m.ai.at,
      ...(m.ai.reasoning ? { reasoning: m.ai.reasoning } : {}),
      sources: m.ai.sources ?? [],
      markup: m,
      ...(edits.length ? { edits } : {}),
    });
  }
  for (const r of review.rejected) {
    items.push({ key: `draft:${r.markup.id}`, kind: 'draft', id: r.markup.id, state: 'rejected', title: titleOf(r.markup), pageIndex: r.markup.pageIndex, confidence: r.markup.ai?.confidence, low: isLow(r.markup.ai?.confidence, threshold), source: r.markup.ai?.source ?? 'AI assistant', at: r.markup.ai?.at ?? r.at, ...(r.markup.ai?.reasoning ? { reasoning: r.markup.ai.reasoning } : {}), sources: r.markup.ai?.sources ?? [], rejected: r });
  }
  for (const p of review.takeoff) {
    const m = store.get(p.markupId);
    items.push({ key: `assembly:${p.id}`, kind: 'assembly', id: p.id, state: takeoffState(p, m), title: titleOf(m), pageIndex: m?.pageIndex ?? null, confidence: p.confidence, low: isLow(p.confidence, threshold), source: p.source, at: p.createdAt, reasoning: p.reasoning, sources: p.sources ?? [], ...(m ? { markup: m } : {}), takeoff: p });
  }
  for (const c of review.counts) {
    const pages = new Set(c.matches.map((x) => x.pageIndex));
    items.push({ key: `count:${c.id}`, kind: 'count', id: c.id, state: countStateOf(c, store), title: c.subject, pageIndex: pages.size === 1 ? [...pages][0]! : null, confidence: c.confidence, low: isLow(c.confidence, threshold), source: c.source, at: c.createdAt, reasoning: c.reasoning, sources: c.sources ?? [], count: c });
  }
  const rank = (s: ReviewState) => (s === 'pending' ? 0 : 1);
  return items.sort((a, b) => rank(a.state) - rank(b.state) || (a.confidence ?? -1) - (b.confidence ?? -1) || (a.pageIndex ?? 1e9) - (b.pageIndex ?? 1e9) || a.at - b.at);
}

/** The AI results waiting for a person, by `ReviewItem.key` (grouping columns as `column:id`). */
export function waitingKeys(store: MarkupDocument & AiReviewFacet): Set<string> {
  const review = store.aiReview();
  const out = new Set<string>();
  for (const m of store.all()) if (isAiDraft(m)) out.add(`draft:${m.id}`);
  for (const p of review.takeoff) if (takeoffState(p, store.get(p.markupId)) === 'pending') out.add(`assembly:${p.id}`);
  for (const c of review.counts) if (countStateOf(c, store) === 'pending') out.add(`count:${c.id}`);
  for (const g of review.columns) if (g.status === 'proposed' || g.status === 'review') out.add(`column:${g.id}`);
  // What the AI review pass found, until a person accepts or dismisses it.
  for (const f of liveFindings(store)) if (needsDecision(f)) out.add(`finding:${f.id}`);
  return out;
}

/** How many AI results are waiting for a person: drafts, proposals, grouping columns and review findings. */
export function waitingCount(store: MarkupDocument & AiReviewFacet): number {
  return waitingKeys(store).size;
}

const noop = () => () => {};
export function useWaitingCount(store: (MarkupDocument & AiReviewFacet) | null): number {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noop, () => (store ? waitingCount(store) : 0));
}

/** Approves AI drafts as one undo step. Drafts that are gone, locked or someone else's are skipped. */
export function approveDrafts(store: MarkupDocument & AiReviewFacet, ids: readonly string[], by: string): { approved: string[]; skipped: string[] } {
  const approved: string[] = [];
  const skipped: string[] = [];
  const at = Date.now();
  store.checkpoint();
  store.batch(() => {
    for (const id of ids) {
      const m = store.get(id);
      if (!m?.ai || !isAiDraft(m) || m.locked || !store.mayEdit(m)) {
        skipped.push(id);
        continue;
      }
      store.update(id, { ai: { ...m.ai, status: 'approved', review: { by, at } } });
      if (store.get(id)?.ai?.status === 'approved') approved.push(id);
      else skipped.push(id);
    }
  });
  return { approved, skipped };
}

/** Rejects AI drafts as one undo step: each comes off the drawing, kept in the review list to look at again. */
export function rejectDrafts(store: MarkupDocument & AiReviewFacet, ids: readonly string[], by: string): string[] {
  const at = Date.now();
  const gone = ids.flatMap((id) => {
    const m = store.get(id);
    return m?.ai && isAiDraft(m) && !m.locked && store.mayEdit(m) ? [m] : [];
  });
  if (!gone.length || store.readOnly) return [];
  store.checkpoint();
  store.batch(() => {
    store.remove(gone.map((m) => m.id));
    store.changeAiReview({ rejected: gone.map((markup) => ({ markup, by, at })) });
  });
  return gone.map((m) => m.id);
}

/** Puts rejected drafts back on the drawing, waiting for review again. One undo step. */
export function reopenDrafts(store: MarkupDocument & AiReviewFacet, ids: readonly string[]) {
  const back = store.aiReview().rejected.filter((r) => ids.includes(r.markup.id));
  if (!back.length || store.readOnly) return;
  store.checkpoint();
  store.batch(() => {
    for (const r of back) if (!store.get(r.markup.id)) store.add(r.markup);
    store.changeAiReview({ remove: { rejected: back.map((r) => r.markup.id) } });
  });
}

/** Forgets rejected drafts, decided proposals and decided review findings, leaving what is still waiting. */
export function clearDecided(store: MarkupDocument & AiReviewFacet) {
  const review = store.aiReview();
  // A decided item the review pass has a finding on that still needs a decision stays, with it.
  const waits = new Set(liveFindings(store).filter(needsDecision).flatMap((f) => (f.item ? [f.item] : [])));
  const rejected = review.rejected.map((r) => r.markup.id).filter((id) => !waits.has(`draft:${id}`));
  const takeoff = review.takeoff.filter((p) => takeoffState(p, store.get(p.markupId)) !== 'pending' && !waits.has(`assembly:${p.id}`)).map((p) => p.id);
  const counts = review.counts.filter((c) => countStateOf(c, store) !== 'pending' && !waits.has(`count:${c.id}`)).map((c) => c.id);
  // Findings about what is forgotten go with it, as do decided ones and those about an item already gone.
  const forgotten = new Set([...rejected.map((id) => `draft:${id}`), ...takeoff.map((id) => `assembly:${id}`), ...counts.map((id) => `count:${id}`)]);
  const live = new Set(liveFindings(store).map((f) => f.id));
  const findings = review.findings.filter((f) => f.status !== 'open' || !live.has(f.id) || (f.item && forgotten.has(f.item))).map((f) => f.id);
  store.changeAiReview({ remove: { rejected, takeoff, counts, findings } });
}
