import type { ReportCell, ReportTable } from '@nb/markup/report';
import { buildWorkbook, type SheetSpec, type XlsxNumberFormat } from '../sheetsync/xlsx';
import type { TableCell } from '../sheetsync/table';

/** Report tables as Excel sheets and CSV files. Numbers stay numbers; only the PDF rounds them for the page. */

/** Floating point noise trimmed, so 0.1 + 0.2 reads 0.3. */
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

const cell = (v: ReportCell | undefined): TableCell => (v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isFinite(v) ? clean(v) : '') : v);

/** The table laid out for a sheet: header, then each group's heading, rows and subtotal, then the total. */
export function reportSheet(table: ReportTable, info: readonly (readonly string[])[] = []): SheetSpec {
  const keys = table.columns.map((c) => c.key);
  const rows: TableCell[][] = [table.columns.map((c) => c.label)];
  const bold = new Set<number>();
  for (const g of table.groups) {
    if (g.heading) {
      bold.add(rows.length);
      rows.push([g.heading, ...keys.slice(1).map(() => '')]);
    }
    for (const r of g.rows) rows.push(keys.map((k) => cell(r[k])));
    if (g.subtotal) {
      bold.add(rows.length);
      rows.push(keys.map((k) => cell(g.subtotal![k])));
    }
  }
  if (table.grandTotal) {
    bold.add(rows.length);
    rows.push(keys.map((k) => cell(table.grandTotal![k])));
  }
  // Notes and where the figures came from, under the table.
  const foot = [...info, ...(table.notes ?? []).map((n) => [n])];
  if (foot.length) rows.push([], ...foot.map((r) => [...r]));
  const formats = table.columns.map((c): XlsxNumberFormat | undefined => (c.format === 'text' ? undefined : c.format));
  return { name: table.title, table: rows, formats, boldRows: bold, filter: false };
}

/** One workbook with a sheet per report. `info` lines (project, scope, date) go under each table. */
export function reportsXlsx(tables: readonly ReportTable[], info: readonly (readonly string[])[] = []): Uint8Array {
  return buildWorkbook(tables.map((t) => reportSheet(t, info)));
}

/** A CSV field. Text a spreadsheet would read as a formula gets a leading apostrophe (as the Excel sync does). */
export function csvField(v: TableCell): string {
  if (typeof v === 'number') return String(v);
  const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The report as CSV (the caller adds a BOM for Excel): a header row, one row per line with its
 * group's heading in a leading Group column, then the total. Subtotals are left out so a column can
 * be summed; the Excel and PDF reports have them.
 */
export function reportCsv(table: ReportTable): string {
  const keys = table.columns.map((c) => c.key);
  const grouped = table.groups.some((g) => g.heading);
  const lines: TableCell[][] = [[...(grouped ? ['Group'] : []), ...table.columns.map((c) => c.label)]];
  for (const g of table.groups) for (const r of g.rows) lines.push([...(grouped ? [g.heading ?? ''] : []), ...keys.map((k) => cell(r[k]))]);
  if (table.grandTotal) lines.push([...(grouped ? [''] : []), ...keys.map((k) => cell(table.grandTotal![k]))]);
  return lines.map((l) => l.map(csvField).join(',')).join('\r\n');
}

/** A file name from a title: no characters Windows forbids. */
export function reportFileName(base: string, title: string, ext: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${clean(base.replace(/\.pdf$/i, '')) || 'Takeoff'} - ${clean(title)}.${ext}`;
}
