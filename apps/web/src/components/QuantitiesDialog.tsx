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
  { value: 'item', label: 'Item (for ordering)' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'page', label: 'Page' },
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
      <div className="modal quantities-dialog" role="dialog" aria-label="Takeoff quantities" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Takeoff Quantities</h3>
        </div>
        <div className="qty-toolbar">
          <label>
            Total by{' '}
            <select aria-label="Total by" value={by} onChange={(e) => setBy(e.target.value as RollupBy)}>
              {BY.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <span className="hint-text">
            {withAssembly} measurement{withAssembly === 1 ? '' : 's'} with an assembly
            {errors ? <span className="warn"> · {errors} could not be worked out (check the formulas)</span> : null}
          </span>
        </div>
        {!rows.length ? (
          <p className="empty">
            No measurement has an assembly yet. Select measurements and pick an assembly for them in the Measurements panel{onManage ? ', or set some up first.' : '.'}
          </p>
        ) : (
          <div className="qty-scroll">
            <table className="qty-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unit</th>
                  <th className="num" title="Measurements that contributed">Meas.</th>
                  <th className="num" title="Before waste">Measured</th>
                  <th className="num">With waste</th>
                  <th className="num" title="With waste, rounded up on the total where the item rounds">Total</th>
                  <th className="num">Unit cost</th>
                  <th className="num">Cost</th>
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
                            <span className="warn" title={`${r.errors} measurement(s) could not be worked out and are left out`}>
                              {' '}
                              ⚠
                            </span>
                          )}
                          {r.setByHand > 0 && (
                            <span className="set-by-hand" title={`Set by hand for ${r.setByHand} measurement${r.setByHand === 1 ? '' : 's'} when approving a takeoff: it does not follow changes to the measurement`}>
                              {' '}
                              ✎ set by hand{r.setByHand < r.measurements ? ` (${r.setByHand} of ${r.measurements})` : ''}
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
                    <td colSpan={7}>Total cost</td>
                    <td className="num">{n(cost)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="hint-text">Quantities are in each page’s display units. Check them against the drawings before pricing or ordering.</p>
        <div className="actions">
          {onManage && (
            <button type="button" className="btn small" onClick={onManage}>
              Assemblies…
            </button>
          )}
          <button type="button" className="btn small" disabled={!rows.length} onClick={() => onExportCsv(rollupToCsv(rows, by), by)}>
            Export CSV
          </button>
          <span className="grow" />
          <button type="button" className="btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
