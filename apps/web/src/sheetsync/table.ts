import type { ListColumn, ListRowData } from '../columns/listColumns';

/** One spreadsheet cell: text, or a number a spreadsheet can total. */
export type TableCell = string | number;

/**
 * The Markups list as a grid for a spreadsheet: a header row, then one row per markup. Numeric
 * cells (lengths, areas, counts, number columns) go as numbers, so the sheet can sum them; the rest
 * as the text the list shows.
 */
export function toTable(rows: readonly ListRowData[], columns: readonly ListColumn[]): TableCell[][] {
  const header = columns.map((c) => c.label);
  const body = rows.map((r) =>
    columns.map((c): TableCell => {
      if (c.key === 'date') return new Date(r.markup.modifiedAt).toISOString().replace('T', ' ').slice(0, 19);
      const v = r.cells[c.key];
      if (!v) return '';
      if (v.error) return `#${v.error}`;
      // Page and page numbers read better as plain numbers too; text cells keep their units.
      return v.num !== null && c.key !== 'measurement' ? v.num : v.text;
    }),
  );
  return [header, ...body];
}

/** A cheap fingerprint, so an unchanged table is not sent again. */
export function tableKey(table: readonly (readonly TableCell[])[]): string {
  return JSON.stringify(table);
}
