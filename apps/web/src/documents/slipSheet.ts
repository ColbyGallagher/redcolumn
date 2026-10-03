/**
 * Slip Sheet: new revisions of sheets go into a drawing set in place of the old ones, matched by
 * sheet number (or by page order), so each sheet keeps its place and its markups. New sheets with
 * no match can be added at the end.
 */

/** A page of an incoming revision file. */
export interface IncomingPage {
  /** Which incoming file. */
  source: number;
  page: number;
  /** Its sheet number, when one was found. */
  label: string | null;
}

export interface SlipPlan {
  /** Target pages replaced by incoming pages. */
  replace: { target: number; incoming: IncomingPage }[];
  /** Incoming pages added at the end, in order. */
  add: IncomingPage[];
  /** Incoming pages left out (no match, and adding is off, or a sheet number seen twice). */
  skipped: IncomingPage[];
}

/** Sheet numbers compared without case, spaces, dashes, dots or underscores: A-101 is A101. */
export const normLabel = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s\-_.]+/g, '');

export function planSlipSheet(targetLabels: readonly (string | null | undefined)[], incoming: readonly IncomingPage[], mode: 'sheet' | 'order', addUnmatched: boolean): SlipPlan {
  const plan: SlipPlan = { replace: [], add: [], skipped: [] };
  const taken = new Set<number>();
  if (mode === 'order') {
    incoming.forEach((p, i) => {
      if (i < targetLabels.length) plan.replace.push({ target: i, incoming: p });
      else (addUnmatched ? plan.add : plan.skipped).push(p);
    });
    return plan;
  }
  const byLabel = new Map<string, number>();
  targetLabels.forEach((l, i) => {
    const k = normLabel(l);
    if (k && !byLabel.has(k)) byLabel.set(k, i);
  });
  const added = new Set<string>();
  for (const p of incoming) {
    const k = normLabel(p.label);
    const target = k ? byLabel.get(k) : undefined;
    if (target !== undefined && !taken.has(target)) {
      taken.add(target);
      plan.replace.push({ target, incoming: p });
    } else if (target === undefined && addUnmatched && !(k && added.has(k))) {
      if (k) added.add(k);
      plan.add.push(p);
    } else plan.skipped.push(p);
  }
  plan.replace.sort((a, b) => a.target - b.target);
  return plan;
}
