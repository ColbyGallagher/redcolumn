import { useMemo, useState } from 'react';
import { replyIndex } from '../sheetsync/keyed';
import { onByDefault, type CellChange, type MatchVia, type MergeResult } from '../sheetsync/merge';

interface Props {
  fileName: string;
  result: MergeResult;
  /** Per row key: the markup's ID and its sheet, to recognise the row by. */
  rowLabel: (rowKey: string) => { itemNo: string; sheet: string };
  /** A change this person may not make (someone else's markup in a Live Session). */
  blocked: (change: CellChange) => boolean;
  /** The name new replies are added under, to start with (who last saved the workbook). */
  replyAuthor: string;
  /** Other words for a column's choices, as mapped so far: column key → typed value (lower case) → option. */
  aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Maps a value the column does not offer to one it does ('' forgets the mapping). The result is worked out again. */
  onAlias: (columnKey: string, value: string, option: string) => void;
  onApply: (changes: CellChange[], replyAuthor: string) => void;
  onClose: () => void;
}

const VIA: Record<MatchVia, string> = {
  key: 'by row key',
  hidden: 'by Item No (key column removed)',
  itemNo: 'by Item No',
  text: 'by sheet and comment text',
};

const SKIPPED = {
  added: 'Added in Excel: not imported',
  gone: 'Its markup is no longer in the document',
  duplicate: 'A second row for the same markup',
  ambiguous: 'Matches more than one markup',
} as const;

const id = (c: CellChange) => `${c.rowKey}\n${c.column.key}`;

function note(c: CellChange, isBlocked: boolean): string {
  if (isBlocked) return 'Not your markup';
  if (c.kind === 'conflict') return 'Changed in both';
  if (c.via === 'text') return 'Row matched by its text';
  if (c.kind === 'replyAdd') return 'New reply';
  if (c.kind === 'replyEdit') return 'Rewrites a reply';
  return '';
}

function shown(c: CellChange, value: string): string {
  if (c.column.kind === 'check') return value === 'true' ? 'Yes' : 'No';
  return value;
}

/** Import from Excel: what the workbook would change, before anything changes. */
export function ImportExcelDialog({ fileName, result, rowLabel, blocked, replyAuthor, aliases, onAlias, onApply, onClose }: Props) {
  const [anyway, setAnyway] = useState(false);
  // Ticks the person changed; the rest follow the default.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [author, setAuthor] = useState(replyAuthor);
  const isOn = (c: CellChange) => !blocked(c) && (picked[id(c)] ?? onByDefault(c));
  const chosen = result.changes.filter(isOn);
  const via = useMemo(() => {
    const n: Partial<Record<MatchVia, number>> = {};
    for (const m of result.matched) n[m.via] = (n[m.via] ?? 0) + 1;
    return (Object.keys(VIA) as MatchVia[]).filter((k) => n[k]).map((k) => `${n[k]} ${VIA[k]}`);
  }, [result]);
  const count = (kind: CellChange['kind']) => result.changes.filter((c) => c.kind === kind).length;
  const replies = chosen.some((c) => c.kind === 'replyAdd');
  const stop = result.noTable || (result.wrongDocument && !anyway);
  const all = result.changes.filter((c) => !blocked(c));
  const setAll = (on: boolean) => setPicked(Object.fromEntries(all.map((c) => [id(c), on])));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal quantities-dialog import-excel-dialog" role="dialog" aria-label="Import from Excel" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Import from Excel · {fileName}</h3>
        </div>
        {result.noTable && <p className="warn">No markups table was found in this workbook. Import a workbook exported from this document with File › Export › Markups for Excel.</p>}
        {!result.noTable && result.wrongDocument && !anyway && (
          <div className="warn">
            <p>This workbook was exported from another document. Its rows may not belong to the markups here.</p>
            <button type="button" className="btn small" onClick={() => setAnyway(true)}>
              Import anyway
            </button>
          </div>
        )}
        {!stop && (
          <>
            <p className="hint-text" data-testid="import-summary">
              {result.matched.length} row{result.matched.length === 1 ? '' : 's'} matched{via.length ? ` (${via.join(', ')})` : ''}. {count('edit')} cell{count('edit') === 1 ? '' : 's'} to change, {count('replyAdd')} repl
              {count('replyAdd') === 1 ? 'y' : 'ies'} to add, {count('conflict')} conflict{count('conflict') === 1 ? '' : 's'}, {result.unknown.length} unknown value{result.unknown.length === 1 ? '' : 's'}, {result.skipped.length} row
              {result.skipped.length === 1 ? '' : 's'} skipped.
              {!result.hasSnapshot && ' The workbook no longer has its export record, so every difference from the document is listed.'}
            </p>
            {result.unknown.length > 0 && (
              <div className="import-unknown">
                {result.unknown.map((u) => {
                  const options = u.column.kind === 'choice' ? (u.column.options ?? []) : [];
                  return (
                    <p key={`${u.column.key}\n${u.value}`} className="warn">
                      {u.column.label}: “{u.value}” in {u.rows.length} row{u.rows.length === 1 ? '' : 's'} is not {options.length ? 'one of this column’s values' : `a ${u.column.kind === 'check' ? 'Yes or No' : u.column.kind}`}.{' '}
                      {options.length > 0 ? (
                        <label>
                          Map to{' '}
                          <select aria-label={`Map ${u.value} to`} value={aliases[u.column.key]?.[u.value.toLowerCase()] ?? ''} onChange={(e) => onAlias(u.column.key, u.value, e.target.value)}>
                            <option value="">(leave these cells alone)</option>
                            {options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        'These cells are left alone.'
                      )}
                    </p>
                  );
                })}
              </div>
            )}
            <div className="qty-scroll">
              <table className="qty-table import-excel-table">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" aria-label="Tick every change" checked={all.length > 0 && all.every(isOn)} disabled={!all.length} onChange={(e) => setAll(e.target.checked)} />
                    </th>
                    <th>ID</th>
                    <th>Sheet</th>
                    <th>Column</th>
                    <th>In the document</th>
                    <th>In the workbook</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.changes.map((c) => {
                    const label = rowLabel(c.rowKey);
                    const isBlocked = blocked(c);
                    return (
                      <tr key={id(c)} className={c.kind === 'conflict' ? 'conflict' : undefined}>
                        <td>
                          <input type="checkbox" aria-label={`Apply ${c.column.label} for ${label.itemNo}`} checked={isOn(c)} disabled={isBlocked} onChange={(e) => setPicked((p) => ({ ...p, [id(c)]: e.target.checked }))} />
                        </td>
                        <td className="num">{label.itemNo}</td>
                        <td>{label.sheet}</td>
                        <td>{c.column.label}</td>
                        <td className="comment-text">{replyIndex(c.column.key) !== null && c.kind === 'replyAdd' ? '' : shown(c, c.from)}</td>
                        <td className="comment-text">{shown(c, c.to)}</td>
                        <td>{note(c, isBlocked)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!result.changes.length && <p className="empty">Nothing to change: the workbook and the document agree.</p>}
            </div>
            {(result.skipped.length > 0 || result.removed.length > 0) && (
              <details className="import-skipped">
                <summary>
                  {result.skipped.length} row{result.skipped.length === 1 ? '' : 's'} skipped
                  {result.removed.length ? `, ${result.removed.length} exported row${result.removed.length === 1 ? ' is' : 's are'} no longer in the sheet (${result.removed.length === 1 ? 'its markup is' : 'their markups are'} kept)` : ''}
                </summary>
                <ul>
                  {result.skipped.map((s) => (
                    <li key={s.sheetRow}>
                      Row {s.sheetRow + 1}: {SKIPPED[s.reason]}. <span className="hint-text">{s.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <div className="actions">
          {!stop && replies && (
            <label>
              Replies are from{' '}
              <input type="text" aria-label="Reply author" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={stop || !chosen.length || (replies && !author.trim())} onClick={() => onApply(chosen, author.trim())}>
            Apply {chosen.length} change{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
