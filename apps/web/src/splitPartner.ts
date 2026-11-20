/**
 * Split View with no file picker: which open document goes beside the active one.
 *
 * `openIds` are the open documents in tab order, `recent` the document ids with the most recently
 * shown first. The partner is the most recently used other document; failing that, the tab beside
 * the active one. With nothing else open there is no partner (null): the caller shows the active
 * document on both sides.
 */
export function pickSplitPartner(openIds: readonly string[], activeId: string | null, recent: readonly string[] = []): string | null {
  const others = openIds.filter((id) => id !== activeId);
  if (!others.length) return null;
  for (const id of recent) if (others.includes(id)) return id;
  const at = activeId === null ? -1 : openIds.indexOf(activeId);
  const beside = openIds[at + 1];
  return beside !== undefined && beside !== activeId ? beside : others[0]!;
}

/** Moves a document to the front of the most-recently-shown list. */
export function touchRecent(recent: readonly string[], id: string, max = 20): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}
