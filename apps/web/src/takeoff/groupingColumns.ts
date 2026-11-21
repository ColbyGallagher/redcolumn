import type { CustomColumn, GroupingAssignment, GroupingProposal, MarkupStore, RuleContext } from '@nb/markup';

/**
 * Grouping columns an AI client (or a grouping tool) proposed, as a person works through them in
 * Review AI Takeoff. They only group: a column is text or a drop-down, never a number, so it never
 * feeds a formula or changes a quantity. Accepting writes the column and each markup's value as one
 * undo step; until then the document's columns and markups are untouched.
 */

const lower = (s: string) => s.trim().toLowerCase();

export function groupingById(store: MarkupStore, id: string): GroupingProposal | undefined {
  return store.aiReview().columns.find((g) => g.id === id);
}

/** Saves a person's change; a proposal they start changing is in review. */
function save(store: MarkupStore, g: GroupingProposal) {
  store.changeAiReview({ columns: [{ ...g, status: g.status === 'proposed' ? 'review' : g.status }] });
}

/** Renames it, or changes its type or drop-down choices, before accepting. */
export function editGrouping(store: MarkupStore, id: string, patch: Partial<Pick<GroupingProposal, 'name' | 'type' | 'options'>>) {
  const g = groupingById(store, id);
  if (!g || g.status === 'accepted' || g.status === 'rejected') return;
  save(store, { ...g, ...patch });
}

/** Moves one markup to another group (empty takes it out of the column). The AI's value is kept beside it. */
export function regroup(store: MarkupStore, id: string, markupId: string, value: string) {
  const g = groupingById(store, id);
  if (!g || g.status === 'accepted' || g.status === 'rejected') return;
  const at = g.assignments.findIndex((a) => a.markupId === markupId);
  const assignments = [...g.assignments];
  if (at < 0) assignments.push({ markupId, value, edited: { from: '' } });
  else {
    const a = assignments[at]!;
    const from = a.edited?.from ?? a.value;
    const next: GroupingAssignment = { ...a, value };
    if (value === from) delete next.edited;
    else next.edited = { from };
    assignments[at] = next;
  }
  save(store, { ...g, assignments });
}

/** The values a grouping uses, in order of first use (for its drop-down). */
export function groupValues(g: Pick<GroupingProposal, 'assignments' | 'options'>): string[] {
  return [...new Set([...(g.options ?? []), ...g.assignments.map((a) => a.value).filter(Boolean)])];
}

/**
 * Accepts a grouping as one undo step: the column (one of the same name is reused, so a tool run
 * again fills the same column) and each markup's value. Markups that are gone, locked or someone
 * else's are skipped. Returns how many markups got a value, or null when nothing could be done.
 */
export function acceptGrouping(store: MarkupStore, id: string, by: string): { columnId: string; written: number; skipped: number } | null {
  const g = groupingById(store, id);
  if (!g || g.status === 'accepted' || store.readOnly || !g.name.trim()) return null;
  const set = store.columnSet();
  const existing = set.columns.find((c) => lower(c.name) === lower(g.name));
  if (existing && existing.type !== 'text' && existing.type !== 'choice') throw new Error(`The document already has a “${existing.name}” column that is not text or a drop-down. Rename this one first.`);
  const values = groupValues(g);
  const column: CustomColumn = existing
    ? existing.type === 'choice'
      ? { ...existing, options: [...new Set([...(existing.options ?? []), ...values])] }
      : existing
    : { id: `ai-${crypto.randomUUID()}`, name: g.name.trim(), type: g.type, ...(g.type === 'choice' ? { options: values } : {}) };
  let written = 0;
  let skipped = 0;
  store.checkpoint();
  store.batch(() => {
    store.setColumnSet({ ...set, columns: existing ? set.columns.map((c) => (c.id === column.id ? column : c)) : [...set.columns, column] });
    for (const a of g.assignments) {
      const m = store.get(a.markupId);
      if (!m || m.locked || !store.mayEdit(m)) {
        skipped++;
        continue;
      }
      const fields = { ...m.fields };
      if (a.value) fields[column.id] = a.value;
      else delete fields[column.id];
      store.update(m.id, { fields: Object.keys(fields).length ? fields : undefined });
      written++;
    }
    store.changeAiReview({ columns: [{ ...g, status: 'accepted', accepted: { by, at: Date.now(), columnId: column.id } }] });
  });
  return { columnId: column.id, written, skipped };
}

export function rejectGrouping(store: MarkupStore, id: string, by: string) {
  const g = groupingById(store, id);
  if (!g || g.status === 'accepted') return;
  store.changeAiReview({ columns: [{ ...g, status: 'rejected', rejected: { by, at: Date.now() } }] });
}

/** Back to review after a rejection. */
export function reopenGrouping(store: MarkupStore, id: string) {
  const g = groupingById(store, id);
  if (!g || g.status !== 'rejected') return;
  const { rejected: _r, ...rest } = g;
  store.changeAiReview({ columns: [{ ...rest, status: 'review' }] });
}

/**
 * Deletes a grouping. An accepted one's column is deleted too (with `withColumn`), as one undo
 * step; the markups keep their stored values, as when a column is deleted by hand.
 */
export function deleteGrouping(store: MarkupStore, id: string, withColumn: boolean) {
  const g = groupingById(store, id);
  if (!g) return;
  store.checkpoint();
  store.batch(() => {
    if (withColumn && g.accepted) {
      const set = store.columnSet();
      store.setColumnSet({ ...set, columns: set.columns.filter((c) => c.id !== g.accepted!.columnId) });
    }
    store.changeAiReview({ remove: { columns: [id] } });
  });
}

/** The document's sheets and columns, for a rule. */
export function ruleContext(store: MarkupStore): RuleContext {
  return { columns: store.columnSet().columns, sheets: store.allSheets() };
}
