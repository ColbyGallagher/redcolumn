/**
 * Builds the Markup Summary report described by a .bcf: column choice and order,
 * filters, sort, page scope, and the Output tab's include options.
 */

import type { Markup, MarkupStatusDef, StatusChange } from '@nb/markup';
import { cellsFor, compareCells, statusName, type Cell, type CellContext } from '../columns/listColumns';
import { catalogColumns, describeColumn, includeMode, measureColumn, pagesInScope, readFilter, type BcfConfig, type PageScope, type SummaryColumnInfo } from './bcf';

export interface SummarySource {
  id: string;
  fileName: string;
  pageCount: number;
  /** 1-based page in front, for the Current Page scope. */
  currentPage: number;
  scope: PageScope;
  markups: readonly Markup[];
  ctx: CellContext;
}

export interface SummaryPdfPart {
  title: string;
  subtitle: string;
  columns: { label: string; width: number; align?: 'right' }[];
  rows: { cells: string[]; color?: string }[];
  totals: string[];
}

export interface SummaryFile {
  filename: string;
  mime: string;
  /** CSV or XML. */
  text?: string;
  pdf?: SummaryPdfPart;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const xmlEsc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Cells for one markup, including Layer (the list has no Layer column of its own). */
export function summaryCells(m: Markup, ctx: CellContext): Record<string, Cell> {
  return { ...cellsFor(m, ctx), layer: { text: m.layer ?? '', num: null } };
}

export function columnHasValues(key: string, markups: readonly Markup[], ctx: CellContext): boolean {
  return markups.some((m) => {
    if (key === 'status') return !!(statusName(m.status, ctx.statuses) || m.statusHistory?.length);
    return (summaryCells(m, ctx)[key]?.text ?? '') !== '';
  });
}

/** Latest status the way the Columns tab samples it: "Accepted set by Colby on 5/10/2026 at …". */
export function statusSample(m: Markup, statuses: readonly MarkupStatusDef[]): string {
  const history = m.statusHistory ?? [];
  const last = history[history.length - 1];
  if (last) return `${last.state} set by ${last.author || 'unknown'} on ${whenSet(last.at)}`;
  return statusName(m.status, statuses);
}

const whenSet = (at: number) => `${new Date(at).toLocaleDateString()} at ${new Date(at).toLocaleTimeString()}`;

function statusText(m: Markup, statuses: readonly MarkupStatusDef[], full: boolean, withAuthor: boolean): string {
  const history = m.statusHistory ?? [];
  const name = statusName(m.status, statuses) || history[history.length - 1]?.state || '';
  if (!full) return name;
  const line = (c: StatusChange) => (withAuthor ? `${c.state} set by ${c.author || 'unknown'} on ${whenSet(c.at)}` : c.state);
  return history.length ? history.map(line).join('\n') : name;
}

function replyText(m: Markup): string {
  return (m.replies ?? [])
    .map((r) => `${r.author}: ${r.text}`.trim())
    .filter((s) => s !== ':')
    .join('\n');
}

function parentId(m: Markup, all: readonly Markup[]): string {
  if (!m.groupId) return '';
  const group = all.filter((x) => x.groupId === m.groupId);
  const parent = group.reduce((a, b) => ((a.seq ?? Number.MAX_SAFE_INTEGER) <= (b.seq ?? Number.MAX_SAFE_INTEGER) ? a : b));
  if (parent.id === m.id) return '';
  return parent.seq ? String(parent.seq) : '';
}

interface Resolved {
  key: string;
  bcfKey: string;
  name: string;
  info: SummaryColumnInfo;
}

interface BuiltRow {
  fileName: string;
  markup: Markup;
  statuses: readonly MarkupStatusDef[];
  /** Plain cell text keyed by Bluebeam column Key, for filtering and sorting. */
  plain: Record<string, Cell>;
  color: string;
}

function inPages(m: Markup, scope: PageScope, pageCount: number, currentPage: number): boolean {
  const pages = pagesInScope(scope, pageCount, currentPage);
  return !pages || pages.includes(m.pageIndex);
}

function resolveList(config: BcfConfig, source: SummarySource): Resolved[] {
  const catalog = catalogColumns(source.ctx.columns, source.fileName);
  return config.Columns.map((column) => {
    const info = describeColumn(column, catalog);
    return { key: info.key, bcfKey: column.Key, name: column.Name || info.name, info };
  });
}

function buildRows(config: BcfConfig, sources: readonly SummarySource[]): { rows: BuiltRow[]; resolved: Map<string, Resolved> } {
  const resolved = new Map<string, Resolved>();
  const rows: BuiltRow[] = [];
  for (const source of sources) {
    const list = resolveList(config, source);
    for (const r of list) if (!resolved.has(r.bcfKey)) resolved.set(r.bcfKey, r);
    const markups = source.markups.filter((m) => inPages(m, source.scope, source.pageCount, source.currentPage));
    for (const markup of markups) {
      const cells = summaryCells(markup, source.ctx);
      const plain: Record<string, Cell> = {};
      for (const r of list) plain[r.bcfKey] = cells[r.key] ?? { text: '', num: null };
      rows.push({ fileName: source.fileName, markup, statuses: source.ctx.statuses, plain, color: markup.style.stroke });
    }
  }
  const filtered = rows.filter((row) =>
    config.Columns.every((column) => {
      const read = readFilter(column.Filter);
      if (read.custom || !read.values) return true;
      const text = row.plain[column.Key]?.text ?? '';
      return read.values.includes(text);
    }),
  );
  const sorts = config.Sorts.filter((s) => s.Item1);
  filtered.sort((a, b) => {
    for (const sort of sorts) {
      const c = compareCells(a.plain[sort.Item1], b.plain[sort.Item1]);
      if (c) return sort.Item2 ? c : -c;
    }
    return a.markup.pageIndex - b.markup.pageIndex || a.markup.createdAt - b.markup.createdAt;
  });
  return { rows: filtered, resolved };
}

interface OutColumn {
  id: string;
  label: string;
  align?: 'right';
  width: number;
  numeric?: boolean;
}

function displayText(row: BuiltRow, resolved: Resolved, config: BcfConfig): { text: string; num: number | null; unit: string } {
  const cell = row.plain[resolved.bcfKey] ?? { text: '', num: null };
  if (resolved.key === 'status') return { text: statusText(row.markup, row.statuses, config.IncludeFullStatusHistory, config.IncludeStatusAuthorAndTime), num: cell.num, unit: '' };
  let text = cell.error ? `#${cell.error}` : cell.text;
  let num = cell.num;
  const custom = resolved.info.custom;
  if ((custom?.type === 'number' || custom?.type === 'formula') && !config.FormatNumbers && num != null && !cell.error) {
    text = String(Math.round(num * 1e6) / 1e6);
  }
  if (resolved.key === 'comment' && config.IncludeReplies) {
    const replies = replyText(row.markup);
    if (replies) text = text ? `${text}\n${replies}` : replies;
  }
  let unit = '';
  if (config.IncludeUnits && (resolved.info.measure || measureColumn(resolved.key))) {
    const split = /^(.*\d)\s+(\S.*)$/.exec(text.trim());
    if (split) {
      text = split[1]!.trim();
      unit = split[2]!.trim();
    }
  }
  return { text, num, unit };
}

function outputColumns(config: BcfConfig, resolved: Map<string, Resolved>, rows: readonly BuiltRow[]): OutColumn[] {
  const chosen = config.Columns.filter((c) => !c.FilterOnly);
  const cols: OutColumn[] = [];
  const commentsIncluded = chosen.some((c) => resolved.get(c.Key)?.key === 'comment');
  for (const column of chosen) {
    const info = resolved.get(column.Key);
    if (!info) continue;
    if (!config.ShowEmptyColumns) {
      const any = rows.some((row) => {
        const shown = displayText(row, info, config);
        return shown.text !== '' || shown.unit !== '';
      });
      if (!any) continue;
    }
    cols.push({ id: column.Key, label: column.Name || info.name, width: info.info.width, numeric: info.info.measure || info.info.custom?.type === 'number' || info.info.custom?.type === 'formula', ...(info.info.align ? { align: info.info.align } : {}) });
    if (config.IncludeUnits && (info.info.measure || measureColumn(info.key))) {
      cols.push({ id: `${column.Key}\u0000unit`, label: `${column.Name || info.name} Unit`, width: 70 });
    }
  }
  if (config.IncludeReplies && !commentsIncluded && rows.some((r) => (r.markup.replies?.length ?? 0) > 0)) {
    cols.push({ id: '\u0000replies', label: 'Replies', width: 200 });
  }
  return cols;
}

function cellOut(row: BuiltRow, col: OutColumn, config: BcfConfig, resolved: Map<string, Resolved>, all: readonly Markup[]): { text: string; num: number | null } {
  if (col.id === '\u0000id') return { text: row.markup.seq ? String(row.markup.seq) : '', num: row.markup.seq ?? null };
  if (col.id === '\u0000parent') return { text: parentId(row.markup, all), num: null };
  if (col.id === '\u0000file') return { text: row.fileName, num: null };
  if (col.id === '\u0000replies') return { text: replyText(row.markup), num: null };
  if (col.id.endsWith('\u0000unit')) {
    const key = col.id.slice(0, -'\u0000unit'.length);
    const info = resolved.get(key);
    if (!info) return { text: '', num: null };
    return { text: displayText(row, info, config).unit, num: null };
  }
  const info = resolved.get(col.id);
  if (!info) return { text: '', num: null };
  const shown = displayText(row, info, config);
  return { text: shown.text, num: shown.num };
}

function leadingColumns(config: BcfConfig, severalFiles: boolean): OutColumn[] {
  const cols: OutColumn[] = [];
  if (severalFiles) cols.push({ id: '\u0000file', label: 'File', width: 160 });
  if (config.IncludeIDColumn && config.ExportFormat === 0) {
    cols.push({ id: '\u0000id', label: 'ID', width: 48, align: 'right', numeric: true });
    cols.push({ id: '\u0000parent', label: 'Parent', width: 60, align: 'right' });
  }
  return cols;
}

interface Table {
  columns: OutColumn[];
  rows: { texts: string[]; nums: (number | null)[]; color: string }[];
}

function project(config: BcfConfig, rows: readonly BuiltRow[], resolved: Map<string, Resolved>, severalFiles: boolean): Table {
  const all = rows.map((r) => r.markup);
  const columns = [...leadingColumns(config, severalFiles), ...outputColumns(config, resolved, rows)];
  return {
    columns,
    rows: rows.map((row) => {
      const cells = columns.map((col) => cellOut(row, col, config, resolved, all));
      return { texts: cells.map((c) => c.text), nums: cells.map((c) => c.num), color: row.color };
    }),
  };
}

function sumRow(label: string, table: Table, indexes: number[], labelAt: number): { texts: string[]; nums: (number | null)[]; color: string } {
  const texts = table.columns.map((col, i) => {
    if (i === labelAt) return label;
    // ID is numeric for alignment only; totals are for measurements and number columns.
    if (!col.numeric || col.id.startsWith('\u0000')) return '';
    const nums = indexes.map((r) => table.rows[r]!.nums[i]).filter((n): n is number => n != null);
    if (!nums.length) return '';
    const sum = nums.reduce((a, b) => a + b, 0);
    return String(Math.round(sum * 1e6) / 1e6);
  });
  const nums = texts.map((t, i) => (table.columns[i]?.numeric && t !== '' ? Number(t) : null));
  return { texts, nums, color: '' };
}

function withTotals(config: BcfConfig, rows: readonly BuiltRow[], table: Table): Table {
  const mode = includeMode(config);
  if (mode === 'markups') return table;
  const sortKey = config.Sorts.find((s) => s.Item1)?.Item1;
  const labelAt = Math.max(0, table.columns.findIndex((c) => c.id === sortKey));
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const label = sortKey ? (row.plain[sortKey]?.text ?? '') || '(blank)' : 'Total';
    const list = groups.get(label);
    if (list) list.push(i);
    else groups.set(label, [i]);
  });
  const out: Table['rows'] = [];
  for (const [label, indexes] of groups) {
    if (mode === 'both') for (const i of indexes) out.push(table.rows[i]!);
    out.push(sumRow(mode === 'both' ? `${label} total` : label, table, indexes, labelAt));
  }
  if (groups.size > 1) out.push(sumRow('Grand Total', table, rows.map((_, i) => i), labelAt));
  return { columns: table.columns, rows: out };
}

function toCsv(config: BcfConfig, table: Table): string {
  const lines: string[] = [];
  if (config.IncludeHeaders) lines.push(table.columns.map((c) => csvCell(c.label)).join(','));
  for (const row of table.rows) lines.push(row.texts.map((t) => csvCell(t)).join(','));
  return lines.join('\r\n');
}

function toXml(config: BcfConfig, table: Table, fileName: string): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<MarkupSummary title="${xmlEsc(config.Title)}" file="${xmlEsc(fileName)}">`];
  for (const row of table.rows) {
    lines.push('  <Markup>');
    table.columns.forEach((col, i) => {
      const v = row.texts[i] ?? '';
      if (v) lines.push(`    <Column name="${xmlEsc(col.label)}">${xmlEsc(v)}</Column>`);
    });
    lines.push('  </Markup>');
  }
  lines.push('</MarkupSummary>');
  return lines.join('\n');
}

function toPdf(config: BcfConfig, table: Table, subtitle: string): SummaryPdfPart {
  const totals = table.rows.filter((r) => r.texts[0]?.endsWith(' total') || r.texts[0] === 'Grand Total').map((r) => r.texts.filter(Boolean).join('  '));
  const data = includeMode(config) === 'totals' ? [] : table.rows.filter((r) => !r.texts[0]?.endsWith(' total') && r.texts[0] !== 'Grand Total');
  return {
    title: config.Title || 'Markup Summary',
    subtitle,
    columns: table.columns.map((c) => ({ label: c.label, width: c.width, ...(c.align ? { align: c.align } : {}) })),
    rows: data.map((r) => ({ cells: r.texts, ...(r.color ? { color: r.color } : {}) })),
    totals,
  };
}

function fileStem(config: BcfConfig, part?: string): string {
  let title = (config.Title.trim() || 'Markup summary').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (part) title += ` - ${part.replace(/[\\/:*?"<>|]/g, ' ').trim()}`;
  if (config.AppendDateToTitle) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    title += ` ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return title || 'Markup summary';
}

function extension(format: number): { ext: string; mime: string } {
  if (format === 1) return { ext: 'xml', mime: 'application/xml' };
  if (format === 2 || format === 3) return { ext: 'pdf', mime: 'application/pdf' };
  return { ext: 'csv', mime: 'text/csv' };
}

/**
 * One report, or one per primary-sort value when Create Multiple Reports is on.
 * Print is a single PDF of every part.
 */
export function buildSummary(config: BcfConfig, sources: readonly SummarySource[]): SummaryFile[] {
  const { rows, resolved } = buildRows(config, sources);
  const several = sources.length > 1;
  const ext = extension(config.ExportFormat);
  const groups = new Map<string, BuiltRow[]>();
  const sortKey = config.Sorts.find((s) => s.Item1)?.Item1;
  if (config.SplitReportOnPrimarySort && config.ExportFormat !== 3 && sortKey) {
    for (const row of rows) {
      const label = row.plain[sortKey]?.text || '(blank)';
      const list = groups.get(label);
      if (list) list.push(row);
      else groups.set(label, [row]);
    }
  } else groups.set('', rows);

  const subtitle = `${sources.map((s) => s.fileName).join(', ')} · ${rows.length} markup${rows.length === 1 ? '' : 's'}`;
  const files: SummaryFile[] = [];
  for (const [part, partRows] of groups) {
    const table = withTotals(config, partRows, project(config, partRows, resolved, several));
    const filename = `${fileStem(config, part || undefined)}.${ext.ext}`;
    if (config.ExportFormat === 1) files.push({ filename, mime: ext.mime, text: toXml(config, table, sources.map((s) => s.fileName).join(', ')) });
    else if (config.ExportFormat === 2 || config.ExportFormat === 3) files.push({ filename, mime: ext.mime, pdf: toPdf(config, table, subtitle) });
    else files.push({ filename, mime: ext.mime, text: toCsv(config, table) });
  }
  if (config.ExportFormat === 3 && files.length > 1) {
    const pdfs = files.flatMap((f) => (f.pdf ? [f.pdf] : []));
    return [
      {
        filename: `${fileStem(config)}.pdf`,
        mime: 'application/pdf',
        pdf: {
          title: config.Title || 'Markup Summary',
          subtitle,
          columns: pdfs[0]?.columns ?? [],
          rows: pdfs.flatMap((p) => p.rows),
          totals: pdfs.flatMap((p) => p.totals),
        },
      },
    ];
  }
  return files;
}

/** Distinct plain values of a column, for the Filter dropdown. Empty cells are included as "". */
export function distinctValues(info: SummaryColumnInfo, markups: readonly Markup[], ctx: CellContext): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of markups) {
    const text = info.key === 'status' ? statusName(m.status, ctx.statuses) : (summaryCells(m, ctx)[info.key]?.text ?? '');
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}
