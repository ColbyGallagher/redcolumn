import { msg } from '@nb/i18n';
import { Fragment, useMemo, useState } from 'react';
import type { Assembly, Markup } from '@nb/markup';
import { rollup, rollupToCsv, type RollupBy, type RollupRow } from '../assemblies/quantities';
import { formatNumber, type CellContext } from '../columns/listColumns';

interface Props {
  markups: readonly Markup[];
  assemblies: readonly Assembly[];
  ctx: CellContext;
  pageLabel: (pageIndex: number) => string;
  /** Measurements without an assembly, and the action that opens the editor. */
  onManage: (() => void) | null;
  onExportCsv: (csv: string, by: RollupBy) => void;
  onClose: () => void;
}

const BY: { value: RollupBy; label: string }[] = [
  { value: 'item', get label() { return msg('Item (for ordering)'); } },
  { value: 'assembly', get label() { return msg('Assembly'); } },
  { value: 'page', get label() { return msg('Page'); } },
];

const n = (v: number | null, d = 2) => (v === null ? '' : formatNumber(v, d));

/** Tools › Takeoff › Takeoff Quantities: every measurement's assembly quantities, added up. */
export function QuantitiesDialog({ markups, assemblies, ctx, pageLabel, onManage, onExportCsv, onClose }: Props) {
  const [by, setBy] = useState<RollupBy>('item');
  const rows = useMemo(() => rollup(markups, assemblies, ctx, by, pageLabel), [markups, assemblies, ctx, by, pageLabel]);
  const groups = useMemo(() => {
    const out = new Map<string, RollupRow[]>();
    for (const r of rows) {
      const list = out.get(r.group) ?? [];
      list.push(r);
      out.set(r.group, list);
    }
    return [...out];
  }, [rows]);
  const withAssembly = markups.filter((m) => m.assemblyId && assemblies.some((a) => a.id === m.assemblyId)).length;
  const errors = rows.reduce((s, r) => s + r.errors, 0);
  const cost = rows.some((r) => r.cost !== null) ? rows.reduce((s, r) => s + (r.cost ?? 0), 0) : null;
  const sum = (list: RollupRow[]) => (list.some((r) => r.cost !== null) ? list.reduce((s, r) => s + (r.cost ?? 0), 0) : null);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal quantities-dialog" role="dialog" aria-label={msg('Takeoff quantities')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>{msg('Takeoff Quantities')}</h3>
        </div>
        <div className="qty-toolbar">
          <label>
            {msg('Total by')}{' '}
            <select aria-label={msg('Total by')} value={by} onChange={(e) => setBy(e.target.value as RollupBy)}>
              {BY.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <span className="hint-text">
            {msg('{count, plural, one {# measurement with an assembly} other {# measurements with an assembly}}', { count: withAssembly })}
            {errors ? <span className="warn"> {msg('· {errors} could not be worked out (check the formulas)', { errors })}</span> : null}
          </span>
        </div>
        {!rows.length ? (
          <p className="empty">
            {msg('No measurement has an assembly yet. Select measurements and pick an assembly for them in the Measurements panel{value}', { value: onManage ? msg(', or set some up first.') : '.' })}
          </p>
        ) : (
          <div className="qty-scroll">
            <table className="qty-table">
              <thead>
                <tr>
                  <th>{msg('Item')}</th>
                  <th>{msg('Unit')}</th>
                  <th className="num" title={msg('Measurements that contributed')}>{msg('Meas.')}</th>
                  <th className="num" title={msg('Before waste')}>{msg('Measured')}</th>
                  <th className="num">{msg('With waste')}</th>
                  <th className="num" title={msg('With waste, rounded up on the total where the item rounds')}>{msg('Total')}</th>
                  <th className="num">{msg('Unit cost')}</th>
                  <th className="num">{msg('Cost')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([group, list]) => (
                  <Fragment key={group}>
                    {group && (
                      <tr className="group">
                        <td colSpan={7}>{group}</td>
                        <td className="num">{n(sum(list))}</td>
                      </tr>
                    )}
                    {list.map((r) => (
                      <tr key={r.key}>
                        <td>
                          {r.item}
                          {r.errors > 0 && (
                            <span className="warn" title={msg('{errors, plural, one {# measurement could not be worked out and is left out} other {# measurements could not be worked out and are left out}}', { errors: r.errors })}>
                              {' '}
                              ⚠
                            </span>
                          )}
                          {r.setByHand > 0 && (
                            <span className="set-by-hand" title={msg('Set by hand for {setByHand, plural, one {# measurement} other {# measurements}} when approving a takeoff: it does not follow changes to the measurement', { setByHand: r.setByHand })}>
                              {' ' + msg('✎ set by hand{value}', { value: r.setByHand < r.measurements ? ' ' + msg('({setByHand} of {measurements})', { setByHand: r.setByHand, measurements: r.measurements }) : '' })}
                            </span>
                          )}
                        </td>
                        <td>{r.unit}</td>
                        <td className="num">{r.measurements}</td>
                        <td className="num">{n(r.base)}</td>
                        <td className="num">{n(r.quantity)}</td>
                        <td className="num">
                          <b>{Number.isInteger(r.total) ? r.total.toLocaleString() : n(r.total)}</b>
                        </td>
                        <td className="num">{n(r.unitCost)}</td>
                        <td className="num">{n(r.cost)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              {cost !== null && (
                <tfoot>
                  <tr>
                    <td colSpan={7}>{msg('Total cost')}</td>
                    <td className="num">{n(cost)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="hint-text">{msg('Quantities are in each page’s display units. Check them against the drawings before pricing or ordering.')}</p>
        <div className="actions">
          {onManage && (
            <button type="button" className="btn small" onClick={onManage}>
              {msg('Assemblies…')}
            </button>
          )}
          <button type="button" className="btn small" disabled={!rows.length} onClick={() => onExportCsv(rollupToCsv(rows, by), by)}>
            {msg('Export CSV')}
          </button>
          <span className="grow" />
          <button type="button" className="btn primary" onClick={onClose} autoFocus>
            {msg('Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
