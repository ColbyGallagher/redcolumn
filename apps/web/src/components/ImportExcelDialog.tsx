import { msg, msgParts } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { keyed } from '../i18n/keyed';
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

const VIA = lazy((): Record<MatchVia, string> => ({
  key: 'by row key',
  hidden: msg('by Item No (key column removed)'),
  itemNo: msg('by Item No'),
  text: 'by sheet and comment text',
}));

const SKIPPED = () => ({
  added: msg('Added in Excel: not imported'),
  gone: msg('Its markup is no longer in the document'),
  duplicate: msg('A second row for the same markup'),
  ambiguous: msg('Matches more than one markup'),
}) as const;

const id = (c: CellChange) => `${c.rowKey}\n${c.column.key}`;

function note(c: CellChange, isBlocked: boolean): string {
  if (isBlocked) return msg('Not your markup');
  if (c.kind === 'conflict') return msg('Changed in both');
  if (c.via === 'text') return msg('Row matched by its text');
  if (c.kind === 'replyAdd') return msg('New reply');
  if (c.kind === 'replyEdit') return msg('Rewrites a reply');
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
    return (Object.keys(VIA()) as MatchVia[]).filter((k) => n[k]).map((k) => `${n[k]} ${VIA()[k]}`);
  }, [result]);
  const count = (kind: CellChange['kind']) => result.changes.filter((c) => c.kind === kind).length;
  const replies = chosen.some((c) => c.kind === 'replyAdd');
  const stop = result.noTable || (result.wrongDocument && !anyway);
  const all = result.changes.filter((c) => !blocked(c));
  const setAll = (on: boolean) => setPicked(Object.fromEntries(all.map((c) => [id(c), on])));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal quantities-dialog import-excel-dialog" role="dialog" aria-label={msg('Import from Excel')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>{msg('Import from Excel · {fileName}', { fileName })}</h3>
        </div>
        {result.noTable && <p className="warn">{msg('No markups table was found in this workbook. Import a workbook exported from this document with File › Export › Markups for Excel.')}</p>}
        {!result.noTable && result.wrongDocument && !anyway && (
          <div className="warn">
            <p>{msg('This workbook was exported from another document. Its rows may not belong to the markups here.')}</p>
            <button type="button" className="btn small" onClick={() => setAnyway(true)}>
              {msg('Import anyway')}
            </button>
          </div>
        )}
        {!stop && (
          <>
            <p className="hint-text" data-testid="import-summary">
              {msg('{count4, plural, one {# row} other {# rows}} matched{value}. {count, plural, one {# cell} other {# cells}} to change, {count2, plural, one {# reply} other {# replies}} to add, {count3, plural, one {# conflict} other {# conflicts}}, {count5} unknown {count6, plural, one {value} other {values}}, {count7, plural, one {# row} other {# rows}} skipped.{value2}', { count4: result.matched.length, value: via.length ? ` (${via.join(', ')})` : '', count: count('edit'), count2: count('replyAdd'), count3: count('conflict'), count5: result.unknown.length, count6: result.unknown.length, count7: result.skipped.length, value2: !result.hasSnapshot && ' ' + msg('The workbook no longer has its export record, so every difference from the document is listed.') })}
            </p>
            {result.unknown.length > 0 && (
              <div className="import-unknown">
                {result.unknown.map((u) => {
                  const options = u.column.kind === 'choice' ? (u.column.options ?? []) : [];
                  return (
                    <p key={`${u.column.key}\n${u.value}`} className="warn">
                      {u.column.label}: “{u.value}{msg('” in')} {u.rows.length} {msg('row')}{u.rows.length === 1 ? '' : 's'} {msg('is not')} {options.length ? msg('one of this column’s values') : `a ${u.column.kind === 'check' ? msg('Yes or No') : u.column.kind}`}.{' '}
                      {options.length > 0 ? (
                        <label>
                          {msg('Map to')}{' '}
                          <select aria-label={msg('Map {value} to', { value: u.value })} value={aliases[u.column.key]?.[u.value.toLowerCase()] ?? ''} onChange={(e) => onAlias(u.column.key, u.value, e.target.value)}>
                            <option value="">{msg('(leave these cells alone)')}</option>
                            {options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        msg('These cells are left alone.')
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
                      <input type="checkbox" aria-label={msg('Tick every change')} checked={all.length > 0 && all.every(isOn)} disabled={!all.length} onChange={(e) => setAll(e.target.checked)} />
                    </th>
                    <th>{msg('ID')}</th>
                    <th>{msg('Sheet')}</th>
                    <th>{msg('Column')}</th>
                    <th>{msg('In the document')}</th>
                    <th>{msg('In the workbook')}</th>
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
                          <input type="checkbox" aria-label={msg('Apply {label} for {itemNo}', { label: c.column.label, itemNo: label.itemNo })} checked={isOn(c)} disabled={isBlocked} onChange={(e) => setPicked((p) => ({ ...p, [id(c)]: e.target.checked }))} />
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
              {!result.changes.length && <p className="empty">{msg('Nothing to change: the workbook and the document agree.')}</p>}
            </div>
            {(result.skipped.length > 0 || result.removed.length > 0) && (
              <details className="import-skipped">
                <summary>
                  {msg('{count, plural, one {# row} other {# rows}} skipped{value}', { count: result.skipped.length, value: result.removed.length ? `, ${result.removed.length} exported row${result.removed.length === 1 ? ' is' : 's are'} no longer in the sheet (${result.removed.length === 1 ? 'its markup is' : 'their markups are'} kept)` : '' })}
                </summary>
                <ul>
                  {result.skipped.map((s) => (
                    <li key={s.sheetRow}>
                      {keyed(msgParts('Row {number}: {sKIPPED}. {span}', { number: s.sheetRow + 1, sKIPPED: SKIPPED()[s.reason], span: <span className="hint-text">{s.text}</span> }))}
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
              {keyed(msgParts('Replies are from {input}', { input: <input type="text" aria-label={msg('Reply author')} value={author} onChange={(e) => setAuthor(e.target.value)} /> }))}
            </label>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            {msg('Cancel')}
          </button>
          <button type="button" className="btn primary" disabled={stop || !chosen.length || (replies && !author.trim())} onClick={() => onApply(chosen, author.trim())}>
            {msg('Apply {count, plural, one {# change} other {# changes}}', { count: chosen.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
