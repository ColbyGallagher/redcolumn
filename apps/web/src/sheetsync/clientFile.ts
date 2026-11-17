import type { ExcelFill } from '../desktop/host';
import { headerCells, rowLabel } from './merge';
import { cellRef, fieldKey, registerExtras, registerRecord, registerTable, uniqueColumns, type RegisterExport, type RegisterTemplate } from './register';
import { buildSyncSheets, readSnapshot } from './syncWorkbook';
import { HIDDEN_SHEET } from './xlsx';
import type { CellValue, ReadSheet, ReadWorkbook } from './xlsxRead';

/**
 * Filling the client's own register file. Many clients mandate their file: its title block, logos,
 * merged headings and styles. So the export does not rebuild it. The page reads the client's blank
 * file to work out where the rows go, and the desktop app has Excel write them into a copy
 * (apps/desktop/src/excel.ts), which keeps everything else in the file as it was.
 *
 * The client's file is outside data: it is read with the same limits as an import, nothing in it is
 * evaluated, and what goes to Excel is cell positions and values only.
 */

const blank = (v: CellValue | undefined) => v === null || v === undefined || v === '';
const filled = (row: readonly CellValue[] | undefined) => !!row?.some((v) => !blank(v));
/** A heading as it is compared: case, line breaks and runs of spaces do not count. */
const tidy = (v: CellValue | undefined) => (blank(v) ? '' : String(v).replace(/\s+/g, ' ').trim().toLowerCase());

/** Excel's last row and column. */
const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;
/** Rows below the table that an import passes over; a longer block is reported as rows added instead. */
const MAX_BELOW = 500;

export interface ClientFileCheck {
  /** The sheet of the client's file the register goes on. */
  sheet?: ReadSheet;
  /** Why the file cannot be filled with this template; empty when it can. */
  problems: string[];
}

/** The sheet the template names, or the file's only visible sheet. */
function clientSheet(book: ReadWorkbook, t: RegisterTemplate): ReadSheet | undefined {
  const visible = book.sheets.filter((s) => s.state === 'visible');
  const want = t.sheet.trim().toLowerCase();
  return visible.find((s) => s.name.toLowerCase() === want) ?? (visible.length === 1 ? visible[0] : undefined);
}

/** Whether the client's file has the template's table where the template says it is. */
export function checkClientFile(book: ReadWorkbook, t: RegisterTemplate): ClientFileCheck {
  if (readSnapshot(book) || book.sheets.some((s) => s.name === HIDDEN_SHEET)) return { problems: ['This file is a register that has already been filled in. Choose the client’s blank file.'] };
  const sheet = clientSheet(book, t);
  if (!sheet) {
    const names = book.sheets.filter((s) => s.state === 'visible').map((s) => `“${s.name}”`);
    return { problems: [`The file has no sheet named “${t.sheet}”. Its sheets are ${names.join(', ') || 'all hidden'}: set the template’s sheet name to the one the register is on.`] };
  }
  const head = headerCells(sheet, t.headerRow);
  const wrong = uniqueColumns(t).flatMap((c, i) => {
    const found = head[t.firstCol + i];
    return tidy(found) === tidy(c.header) ? [] : [`${cellRef(t.headerRow, t.firstCol + i)} ${blank(found) ? 'is blank' : `reads “${String(found).split('\n')[0]!.slice(0, 40)}”`} where the template has “${c.header}”`];
  });
  if (!wrong.length) return { sheet, problems: [] };
  const more = wrong.length > 3 ? `, and ${wrong.length - 3} more` : '';
  return { sheet, problems: [`The headings on row ${t.headerRow + 1} of “${sheet.name}” do not match the template: ${wrong.slice(0, 3).join('; ')}${more}. Check the template’s header row, first column and headings.`] };
}

export type FillPlan = { ok: true; fill: ExcelFill; sheet: string } | { ok: false; problem: string };

/**
 * Where a register's rows go in the client's file, and what else is written with them: the row keys
 * in a hidden column beside the table, the details above it, and the hidden sheet an import reads.
 *
 * Rows go under the header. When the file has something further down (a sign-off block, totals), rows
 * are inserted above it so that it is moved down, never written over.
 */
export function planFill(book: ReadWorkbook, e: RegisterExport): FillPlan {
  const t = e.template;
  const check = checkClientFile(book, t);
  if (!check.sheet || check.problems.length) return { ok: false, problem: check.problems.join(' ') };
  const sheet = check.sheet;
  const table = registerTable(e.rows, e.columns, t, e.statuses);
  const fields = uniqueColumns(t);
  const count = table.rows.length;
  const head = t.headerRow;
  const first = head + 1;
  const c0 = t.firstCol;
  const n = table.columns.length;

  // The first row under the header that already holds something: the table's rows end above it.
  let below = -1;
  for (let r = first; r < sheet.rows.length; r++) {
    if (filled(sheet.rows[r])) {
      below = r;
      break;
    }
  }
  const under = below < 0 ? [] : sheet.rows.slice(below).filter(filled);
  if (Math.max(first, sheet.rows.length) + count > MAX_ROW) return { ok: false, problem: 'There are more comments than rows left on the client’s sheet.' };

  // The keys go in the column beside the table when the file has nothing there, else past everything it has.
  const width = sheet.rows.reduce((w, row) => Math.max(w, row.length), 0);
  const beside = c0 + n;
  const keyCol = sheet.rows.some((row) => !blank(row[beside])) ? Math.max(width, beside) : beside;
  if (keyCol >= MAX_COL) return { ok: false, problem: 'The client’s sheet has no free column for the row keys.' };

  const [visible, hidden] = buildSyncSheets(table, {
    sheet: sheet.name,
    docId: e.docId,
    exportedAt: e.exportedAt,
    origin: { row: head, col: c0 },
    keyAt: 'last',
    register: registerRecord(t),
    ...(under.length && under.length <= MAX_BELOW ? { ignore: under.map(rowLabel) } : {}),
  });
  const body = visible!.table.slice(1);
  const extras = registerExtras(e, table);
  const known = new Set(e.columns.map((c) => c.key));
  return {
    ok: true,
    sheet: sheet.name,
    fill: {
      sheet: sheet.name,
      headerRow: head + 1,
      firstRow: first + 1,
      count,
      // A column this document has nothing for is left as the client's file has it.
      columns: fields.flatMap((f, i) => (f.field.kind === 'column' && !known.has(fieldKey(f.field)) ? [] : [{ col: c0 + i + 1, cells: body.map((row) => row[i] ?? '') }])),
      key: { col: keyCol + 1, label: String(visible!.table[0]![n] ?? ''), cells: body.map((row) => String(row[n] ?? '')) },
      firstCol: c0 + 1,
      below: below + 1,
      cells: t.cells.flatMap((c) => {
        const value = c.value ? (e.values[c.value] ?? '').trim() : '';
        return value && c.row >= 0 && c.col >= 0 && c.row < head ? [{ row: c.row + 1, col: c.col + 1, value }] : [];
      }),
      hidden: { name: hidden!.name, table: hidden!.table.map((row) => [...row]) },
      validations: (visible!.validations ?? []).map((v) => (v.kind === 'list' ? { col: c0 + v.column + 1, type: 'list' as const, formula: `=${v.source}` } : { col: c0 + v.column + 1, type: v.kind })),
      dates: table.columns.flatMap((c, i) => (c.edit === 'editable' && c.kind === 'date' ? [c0 + i + 1] : [])),
      ...(extras.linkCol >= 0 && extras.links.some(Boolean) ? { links: { col: c0 + extras.linkCol + 1, urls: extras.links.map((u) => u ?? '') } } : {}),
    },
  };
}
