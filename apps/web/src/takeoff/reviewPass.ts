import { msg } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import type { MarkupDocument, AiReviewFacet, ReviewFinding } from '@nb/markup';

/**
 * The optional AI review pass, as the person drives it: off by default, turned on per document,
 * or asked for once. The review itself runs in the person's AI client, in a fresh context (see
 * `desktop/assistantReviewPass.ts`); its findings wait here, never applied, for the person to
 * accept or dismiss each one.
 */

/** Findings that still need a person: open, and not just the reviewer agreeing. */
export const needsDecision = (f: ReviewFinding) => f.status === 'open' && f.severity !== 'ok';

/** Whether the item a finding is about is still in the review list (it may be rejected and cleared, or deleted). */
export function findingItemExists(store: MarkupDocument & AiReviewFacet, item: string): boolean {
  const review = store.aiReview();
  const [kind, id] = [item.slice(0, item.indexOf(':')), item.slice(item.indexOf(':') + 1)];
  if (kind === 'draft') return !!store.get(id)?.ai || review.rejected.some((r) => r.markup.id === id);
  if (kind === 'assembly') return review.takeoff.some((p) => p.id === id);
  if (kind === 'count') return review.counts.some((c) => c.id === id);
  if (kind === 'column') return review.columns.some((g) => g.id === id);
  return false;
}

/**
 * The findings there is something to act on: about an item still listed, or a missed item. Those
 * about an item that is gone are left out (and of the count waiting); Clear Decided forgets them.
 */
export function liveFindings(store: MarkupDocument & AiReviewFacet): ReviewFinding[] {
  return store.aiReview().findings.filter((f) => !f.item || findingItemExists(store, f.item));
}

/** Findings by the review item they are about (`draft:<id>`...), and those about nothing listed (missed). */
export function findingsByItem(store: MarkupDocument & AiReviewFacet): { byItem: Map<string, ReviewFinding[]>; missed: ReviewFinding[] } {
  const byItem = new Map<string, ReviewFinding[]>();
  const missed: ReviewFinding[] = [];
  for (const f of liveFindings(store)) {
    if (!f.item) missed.push(f);
    else byItem.set(f.item, [...(byItem.get(f.item) ?? []), f]);
  }
  return { byItem, missed };
}

/** Accepts or dismisses findings: a record of the person's decision. Nothing on the drawing changes. */
export function decideFindings(store: MarkupDocument & AiReviewFacet, ids: readonly string[], status: 'accepted' | 'dismissed' | 'open', by: string) {
  const at = Date.now();
  const list = store.aiReview().findings.filter((f) => ids.includes(f.id));
  if (!list.length) return;
  store.changeAiReview({ findings: list.map(({ decided: _d, ...f }) => (status === 'open' ? { ...f, status } : { ...f, status, decided: { by, at } })) });
}

/** Forgets every finding a person has decided, and those about an item that is gone. */
export function clearDecidedFindings(store: MarkupDocument & AiReviewFacet) {
  const live = new Set(liveFindings(store).map((f) => f.id));
  const gone = store.aiReview().findings.filter((f) => f.status !== 'open' || !live.has(f.id)).map((f) => f.id);
  if (gone.length) store.changeAiReview({ remove: { findings: gone } });
}

export function setReviewPassEnabled(store: MarkupDocument & AiReviewFacet, enabled: boolean) {
  store.setReviewPass({ ...store.reviewPass(), enabled });
}

/** Asks for a review pass now: the AI client sees the request in get_review_packet and list_takeoff_proposals. */
export function requestReviewPass(store: MarkupDocument & AiReviewFacet, by: string) {
  store.setReviewPass({ ...store.reviewPass(), requested: { by, at: Date.now() } });
}

export function cancelReviewRequest(store: MarkupDocument & AiReviewFacet) {
  const { requested: _r, ...rest } = store.reviewPass();
  store.setReviewPass(rest);
}

export const FINDING_KIND_LABEL = lazy((): Record<ReviewFinding['kind'], string> => ({
  quantity: msg('Quantity'),
  missed: msg('Missed'),
  'wrong-item': msg('Wrong item'),
  scale: msg('Scale'),
  grouping: msg('Grouping'),
  duplicate: msg('Counted twice'),
  other: msg('Other'),
}));
