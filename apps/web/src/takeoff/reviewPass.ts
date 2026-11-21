import type { MarkupStore, ReviewFinding } from '@nb/markup';

/**
 * The optional AI review pass, as the person drives it: off by default, turned on per document,
 * or asked for once. The review itself runs in the person's AI client, in a fresh context (see
 * `desktop/assistantReviewPass.ts`); its findings wait here, never applied, for the person to
 * accept or dismiss each one.
 */

/** Findings that still need a person: open, and not just the reviewer agreeing. */
export const needsDecision = (f: ReviewFinding) => f.status === 'open' && f.severity !== 'ok';

/** Findings by the review item they are about (`draft:<id>`...), and those about nothing listed (missed). */
export function findingsByItem(store: MarkupStore): { byItem: Map<string, ReviewFinding[]>; missed: ReviewFinding[] } {
  const byItem = new Map<string, ReviewFinding[]>();
  const missed: ReviewFinding[] = [];
  for (const f of store.aiReview().findings) {
    if (!f.item) missed.push(f);
    else byItem.set(f.item, [...(byItem.get(f.item) ?? []), f]);
  }
  return { byItem, missed };
}

/** Accepts or dismisses findings: a record of the person's decision. Nothing on the drawing changes. */
export function decideFindings(store: MarkupStore, ids: readonly string[], status: 'accepted' | 'dismissed' | 'open', by: string) {
  const at = Date.now();
  const list = store.aiReview().findings.filter((f) => ids.includes(f.id));
  if (!list.length) return;
  store.changeAiReview({ findings: list.map(({ decided: _d, ...f }) => (status === 'open' ? { ...f, status } : { ...f, status, decided: { by, at } })) });
}

/** Forgets every finding a person has decided. */
export function clearDecidedFindings(store: MarkupStore) {
  store.changeAiReview({ remove: { findings: store.aiReview().findings.filter((f) => f.status !== 'open').map((f) => f.id) } });
}

export function setReviewPassEnabled(store: MarkupStore, enabled: boolean) {
  store.setReviewPass({ ...store.reviewPass(), enabled });
}

/** Asks for a review pass now: the AI client sees the request in get_review_packet and list_takeoff_proposals. */
export function requestReviewPass(store: MarkupStore, by: string) {
  store.setReviewPass({ ...store.reviewPass(), requested: { by, at: Date.now() } });
}

export function cancelReviewRequest(store: MarkupStore) {
  const { requested: _r, ...rest } = store.reviewPass();
  store.setReviewPass(rest);
}

export const FINDING_KIND_LABEL: Record<ReviewFinding['kind'], string> = {
  quantity: 'Quantity',
  missed: 'Missed',
  'wrong-item': 'Wrong item',
  scale: 'Scale',
  grouping: 'Grouping',
  duplicate: 'Counted twice',
  other: 'Other',
};
