import { normLabel } from '../documents/slipSheet';

export interface PagePair {
  oldPage: number;
  newPage: number;
}

/**
 * Pairs pages of an old and a new set: by sheet number where both pages have one (so inserted and
 * removed sheets don't shift everything), otherwise by position. Pages without a partner are left out.
 */
export function pairPages(oldLabels: readonly (string | null | undefined)[], newLabels: readonly (string | null | undefined)[], bySheet: boolean): PagePair[] {
  if (bySheet) {
    const oldByLabel = new Map<string, number>();
    oldLabels.forEach((l, i) => {
      const k = normLabel(l);
      if (k && !oldByLabel.has(k)) oldByLabel.set(k, i);
    });
    if (oldByLabel.size) {
      const pairs: PagePair[] = [];
      newLabels.forEach((l, newPage) => {
        const oldPage = oldByLabel.get(normLabel(l));
        if (oldPage !== undefined) pairs.push({ oldPage, newPage });
      });
      if (pairs.length) return pairs;
    }
  }
  return Array.from({ length: Math.min(oldLabels.length, newLabels.length) }, (_, i) => ({ oldPage: i, newPage: i }));
}
