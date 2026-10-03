/**
 * Pages grouped into rows: one per row, or two side by side. With a cover page the first page sits
 * alone (on the right, as a book's cover does) and the spreads pair 2–3, 4–5, …
 */
export function spreadRows(count: number, columns: 1 | 2, cover: boolean): number[][] {
  const rows: number[][] = [];
  if (columns === 1) {
    for (let i = 0; i < count; i++) rows.push([i]);
    return rows;
  }
  let i = 0;
  if (cover && count) rows.push([i++]);
  for (; i < count; i += 2) rows.push(i + 1 < count ? [i, i + 1] : [i]);
  return rows;
}
