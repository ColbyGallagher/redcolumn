import { canon, canonOwn, plainText, replyIndex, type SyncColumn, type SyncRow, type SyncTable } from './keyed';
import { KEY_LABEL, readSnapshot, type Snapshot } from './syncWorkbook';
import { fromExcelSerial } from './xlsx';
import type { CellValue, ReadSheet, ReadWorkbook } from './xlsxRead';

/**
 * Works out what an edited workbook changes in the document. Nothing is applied here: the result is
 * a list of changes for the import preview.
 *
 * Rows are matched to markups by a ladder, strongest first: the hidden key column; the Item No
 * looked up on the hidden sheet; the Item No looked up in the document; and last an exact match on
 * sheet number and comment text, which is the only one that can be wrong and so needs confirming.
 *
 * Cells are merged three ways against the values the hidden sheet says were exported:
 *
 *   Excel same as exported                         → nothing
 *   Excel changed, document same as exported       → take the Excel value
 *   both changed to the same value                 → nothing
 *   both changed to different values               → conflict, the person picks
 *
 * A row removed in Excel never deletes a markup, and a row added in Excel never creates one; both
 * are reported.
 */

/** How a sheet row was matched to a markup. */
export type MatchVia = 'key' | 'hidden' | 'itemNo' | 'text';

export interface MatchedRow {
  /** The row's key in the document. */
  key: string;
  via: MatchVia;
  /** 0-based row of the sheet. */
  sheetRow: number;
}

export type ChangeKind =
  /** The cell changed in Excel only. */
  | 'edit'
  /** The cell changed in Excel and in the document, to different values. */
  | 'conflict'
  /** A thread column that was blank now has text: a new reply. */
  | 'replyAdd'
  /** A thread column that held a reply was rewritten. Off by default: rewriting an earlier answer is rarely meant. */
  | 'replyEdit';

export interface CellChange {
  rowKey: string;
  column: SyncColumn;
  sheetRow: number;
  via: MatchVia;
  kind: ChangeKind;
  /** The document's value now, and the workbook's, in the form `canon` gives. */
  from: string;
  to: string;
  /** The exported value, or null when the workbook no longer says. */
  base: string | null;
  /** For a new reply: who it is from, when the row's responder column says. */
  author?: string;
}

/** A value that does not fit its column: a status that is not one of the document's, text in a number column. */
export interface UnknownValue {
  column: SyncColumn;
  value: string;
  rows: MatchedRow[];
}

export interface SkippedRow {
  sheetRow: number;
  /**
   * `added`: no key and nothing to match it by. `gone`: its markup is no longer in the document.
   * `duplicate`: another row already matched the same markup. `ambiguous`: its sheet and comment
   * match more than one markup.
   */
  reason: 'added' | 'gone' | 'duplicate' | 'ambiguous';
  /** The row's first few cells, to recognise it by. */
  text: string;
}

export interface MergeResult {
  /** No table was found in the workbook: nothing else is filled in. */
  noTable: boolean;
  /** The workbook was exported from another document. */
  wrongDocument: boolean;
  /** The hidden sheet was there, so cells were merged three ways. Without it the document's value stands in as the base. */
  hasSnapshot: boolean;
  exportedAt: string | null;
  sheet: string;
  matched: MatchedRow[];
  changes: CellChange[];
  unknown: UnknownValue[];
  skipped: SkippedRow[];
  /** Rows that were exported and are no longer in the sheet. Their markups are left alone. */
  removed: string[];
}

export interface MergeOptions {
  docId: string;
  /** Per column key: other words for a choice (lower case) and the option each means. */
  aliases?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const norm = (v: CellValue | undefined) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());

/** The header row: where the snapshot says, when the labels are still there; else the row within the first 200 that holds the most of them. */
function findHeader(sheet: ReadSheet, labels: readonly string[], hint: number | null): number {
  const want = new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean));
  const score = (r: number) => {
    const seen = new Set<string>();
    for (const v of sheet.rows[r] ?? []) {
      const t = norm(v);
      if (want.has(t)) seen.add(t);
    }
    return seen.size;
  };
  const enough = Math.min(2, want.size);
  if (hint !== null && score(hint) >= Math.max(enough, Math.ceil(want.size / 2))) return hint;
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(sheet.rows.length, 200); r++) {
    const s = score(r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return bestScore >= enough && bestScore > 0 ? best : -1;
}

/** A workbook cell as the text it is compared by, or null when it does not fit the column. */
function fromSheet(col: SyncColumn, value: CellValue | undefined, isDate: boolean, date1904: boolean, aliases: Readonly<Record<string, string>> | undefined): string | null {
  const v = value ?? null;
  // A real date cell is a serial number, whatever the column.
  if (typeof v === 'number' && (col.kind === 'date' || (isDate && col.kind === 'text'))) return new Date(fromExcelSerial(v, date1904)).toISOString().slice(0, 10);
  return canon(col, v, aliases);
}

function preview(row: readonly CellValue[]): string {
  return row
    .filter((v) => v !== null && v !== '')
    .slice(0, 4)
    .map((v) => String(v).split('\n')[0]!.slice(0, 40))
    .join(' | ');
}

/** What importing `book` would change in the document, whose rows are `current`. */
export function mergeWorkbook(book: ReadWorkbook, current: SyncTable, opts: MergeOptions): MergeResult {
  const snap: Snapshot | null = readSnapshot(book);
  const out: MergeResult = { noTable: true, wrongDocument: !!snap && snap.docId !== opts.docId, hasSnapshot: !!snap, exportedAt: snap?.exportedAt ?? null, sheet: '', matched: [], changes: [], unknown: [], skipped: [], removed: [] };
  const named = snap ? book.sheets.find((s) => s.name.toLowerCase() === snap.sheet.toLowerCase() && s.state === 'visible') : undefined;
  const known = snap ? snap.columns : current.columns.map((c) => ({ key: c.key, label: c.label }));
  // Without the snapshot (or its sheet, renamed) the table is looked for on every visible sheet.
  let sheet: ReadSheet | undefined = named;
  let header = named ? findHeader(named, known.map((c) => c.label), snap!.headerRow) : -1;
  if (header < 0) {
    for (const s of book.sheets) {
      if (s.state !== 'visible') continue;
      const at = findHeader(s, known.map((c) => c.label), null);
      if (at >= 0) {
        sheet = s;
        header = at;
        break;
      }
    }
  }
  if (!sheet || header < 0) return out;
  out.noTable = false;
  out.sheet = sheet.name;

  // Which sheet column holds which of the document's columns, by header text.
  const byKey = new Map(current.columns.map((c, i) => [c.key, { col: c, index: i }]));
  const byLabel = new Map<string, string>();
  for (const c of known) if (!byLabel.has(c.label.trim().toLowerCase())) byLabel.set(c.label.trim().toLowerCase(), c.key);
  let keyCol = -1;
  const sheetCols: { at: number; col: SyncColumn; index: number }[] = [];
  const placed = new Set<string>();
  (sheet.rows[header] ?? []).forEach((v, at) => {
    const label = norm(v);
    if (label === KEY_LABEL) {
      if (keyCol < 0) keyCol = at;
      return;
    }
    const key = byLabel.get(label);
    const found = key !== undefined ? byKey.get(key) : undefined;
    if (!found || placed.has(found.col.key)) return;
    placed.add(found.col.key);
    sheetCols.push({ at, col: found.col, index: found.index });
  });
  const colAt = (key: string) => sheetCols.find((c) => c.col.key === key)?.at ?? -1;
  const itemCol = colAt('seq');
  const sheetNoCol = colAt('sheet');
  const commentCol = colAt('comment');

  const rowByKey = new Map(current.rows.map((r) => [r.key, r]));
  const keyByItemHidden = new Map<number, string>();
  if (snap) for (const [key, r] of snap.rows) if (r.itemNo !== null && !key.includes('/')) keyByItemHidden.set(r.itemNo, key);
  const keyByItemDoc = new Map<number, string>();
  const keysByText = new Map<string, string[]>();
  for (const r of current.rows) {
    if (!r.match) continue;
    if (r.match.itemNo !== null) keyByItemDoc.set(r.match.itemNo, r.key);
    if (r.match.comment) {
      const k = `${r.match.sheet.trim().toLowerCase()}\n${r.match.comment}`;
      keysByText.set(k, [...(keysByText.get(k) ?? []), r.key]);
    }
  }

  const seen = new Set<string>();
  const unknown = new Map<string, UnknownValue>();
  for (let r = header + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    if (!cells.some((v) => v !== null && v !== '')) continue;
    const skip = (reason: SkippedRow['reason']) => void out.skipped.push({ sheetRow: r, reason, text: preview(cells) });
    // The ladder.
    let key = '';
    let via: MatchVia = 'key';
    const typedKey = keyCol >= 0 ? String(cells[keyCol] ?? '').trim() : '';
    const itemNo = itemCol >= 0 ? Number(cells[itemCol] ?? Number.NaN) : Number.NaN;
    if (typedKey) key = typedKey;
    else if (Number.isInteger(itemNo) && keyByItemHidden.has(itemNo)) [key, via] = [keyByItemHidden.get(itemNo)!, 'hidden'];
    else if (Number.isInteger(itemNo) && keyByItemDoc.has(itemNo)) [key, via] = [keyByItemDoc.get(itemNo)!, 'itemNo'];
    else if (commentCol >= 0 && String(cells[commentCol] ?? '').trim()) {
      const hits = keysByText.get(`${sheetNoCol >= 0 ? norm(cells[sheetNoCol]) : ''}\n${plainText(String(cells[commentCol]))}`) ?? [];
      // Without a sheet column, the comment alone has to be the only one of its kind.
      const all = sheetNoCol >= 0 ? hits : current.rows.filter((x) => x.match?.comment === plainText(String(cells[commentCol]))).map((x) => x.key);
      if (all.length > 1) {
        skip('ambiguous');
        continue;
      }
      if (all.length === 1) [key, via] = [all[0]!, 'text'];
    }
    if (!key) {
      skip('added');
      continue;
    }
    const row: SyncRow | undefined = rowByKey.get(key);
    if (!row) {
      skip(snap?.rows.has(key) || via !== 'key' ? 'gone' : 'added');
      continue;
    }
    if (seen.has(key)) {
      skip('duplicate');
      continue;
    }
    seen.add(key);
    const matched: MatchedRow = { key, via, sheetRow: r };
    out.matched.push(matched);
    if (row.locked) continue;
    const exported = snap?.rows.get(key);
    for (const { at, col, index } of sheetCols) {
      if (col.edit !== 'editable') continue;
      const raw = cells[at];
      const to = fromSheet(col, raw, sheet.dates.has(`${r},${at}`), book.date1904, opts.aliases?.[col.key]);
      if (to === null) {
        const value = String(raw).trim();
        const id = `${col.key}\n${value.toLowerCase()}`;
        const entry = unknown.get(id) ?? { column: col, value, rows: [] };
        entry.rows.push(matched);
        unknown.set(id, entry);
        continue;
      }
      const from = canonOwn(col, row.cells[index] ?? '');
      const base = exported?.values.has(col.key) ? exported.values.get(col.key)! : null;
      const change = (kind: ChangeKind) => void out.changes.push({ rowKey: key, column: col, sheetRow: r, via, kind, from, to, base });
      if (replyIndex(col.key) !== null) {
        // Clearing a response does not delete the reply, and a response that is already a reply is not added twice.
        if (to === '' || to === (base ?? from) || to === from || row.replies?.includes(to)) continue;
        if ((base ?? from) === '') change('replyAdd');
        else change(base !== null && from !== base ? 'conflict' : 'replyEdit');
        continue;
      }
      if (to === (base ?? from) || to === from) continue;
      change(base !== null && from !== base ? 'conflict' : 'edit');
    }
  }
  out.unknown = [...unknown.values()];
  if (snap) for (const key of snap.rows.keys()) if (!seen.has(key) && rowByKey.has(key)) out.removed.push(key);
  return out;
}

/** Whether a change is ticked in the preview before anyone looks: plain edits and new replies on rows matched by something firmer than their text. */
export function onByDefault(change: CellChange): boolean {
  return change.via !== 'text' && (change.kind === 'edit' || change.kind === 'replyAdd');
}
