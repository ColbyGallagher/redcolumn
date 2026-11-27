/** Selecting several rows of an ordered list and moving them together. Rows are known by id. */
export interface ListSelection {
  ids: ReadonlySet<number>;
  /** The row a Shift+click range starts from. */
  anchor: number | null;
}

/** The selection after a click on `id`: Shift takes the range from the anchor, Ctrl/Cmd toggles one row. */
export function clickSelect(order: readonly number[], sel: ListSelection, id: number, mods: { range: boolean; toggle: boolean }): ListSelection {
  const from = sel.anchor === null ? -1 : order.indexOf(sel.anchor);
  if (mods.range && from >= 0) {
    const to = order.indexOf(id);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    // With Ctrl/Cmd as well, the range is added to what is already selected.
    return { ids: new Set(mods.toggle ? [...sel.ids, ...range] : range), anchor: sel.anchor };
  }
  if (mods.toggle) {
    const ids = new Set(sel.ids);
    if (!ids.delete(id)) ids.add(id);
    return { ids, anchor: id };
  }
  return { ids: new Set([id]), anchor: id };
}

/** Moves every selected row one place up (-1) or down (1). Rows already against that end stay put. */
export function moveSelected<T>(items: readonly T[], isSelected: (item: T) => boolean, by: -1 | 1): T[] {
  const next = [...items];
  // Work from the end being moved towards, so a block of rows moves as one.
  for (let n = 0; n < next.length; n++) {
    const i = by < 0 ? n : next.length - 1 - n;
    const j = i + by;
    if (j >= 0 && j < next.length && isSelected(next[i]!) && !isSelected(next[j]!)) [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

/** The list with the dragged rows gathered together, in their own order, starting as near `start` as the list allows. */
export function placeBlock<T>(items: readonly T[], isDragged: (item: T) => boolean, start: number): T[] {
  const block = items.filter(isDragged);
  const next = items.filter((item) => !isDragged(item));
  next.splice(Math.max(0, Math.min(next.length, start)), 0, ...block);
  return next;
}

/** Pixels to scroll this frame for a drag at `y` over a view from `top` to `bottom`: faster the nearer the edge, or past it. */
export function edgeScroll(y: number, top: number, bottom: number, zone = 28, max = 14): number {
  const speed = (depth: number) => Math.ceil(Math.min(1, depth / zone) * max);
  if (y < top + zone) return -speed(top + zone - y);
  if (y > bottom - zone) return speed(y - (bottom - zone));
  return 0;
}

/**
 * The scroll position that shows the span `top`–`bottom` (in content coordinates) in a view `height` tall,
 * scrolling as little as possible. A span taller than the view shows the edge it is moving towards.
 */
export function revealScroll(scroll: number, height: number, top: number, bottom: number, by: -1 | 1): number {
  if (bottom - top > height) return by < 0 ? top : bottom - height;
  if (top < scroll) return top;
  if (bottom > scroll + height) return bottom - height;
  return scroll;
}
