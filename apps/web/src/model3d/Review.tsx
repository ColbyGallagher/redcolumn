import { useEffect, useRef, useState } from 'react';
import { msg, msgc, msgParts } from '@nb/i18n';
import type { ModelControls, ModelState, QuantityTable, RevisionDiff, RevisionEntry } from '@nb/model3d';
import { BY_CLASS } from '@nb/model3d/controls';
import { keyed } from '../i18n/keyed';
import { lazy } from '../i18n/lazy';
import { buildXlsx } from '../sheetsync/xlsx';

/** IfcKerb for IFCKERB: how the classes read in the panel. */
export const prettyClass = (c: string) => (c.startsWith('IFC') ? `Ifc${c.slice(3, 4)}${c.slice(4).toLowerCase()}` : c);

interface CompareProps {
  controls: ModelControls;
  state: ModelState;
  onNotice: (text: string) => void;
}

/** What a comparison's colours mean, as the view draws them. */
const KINDS = lazy(() => [
  { key: 'added' as const, title: msg('Added'), hint: msg('Only in this model'), colour: '#2fb344' },
  { key: 'changed' as const, title: msg('Changed'), hint: msg('In both, with a different shape or properties'), colour: '#f59f00' },
  { key: 'removed' as const, title: msg('Removed'), hint: msg('Only in the other revision'), colour: '#e03131' },
]);

/**
 * Version compare: another revision of the model loaded beside it and compared element by element
 * (by GlobalId). The view colours what was added, changed and removed; the lists select them.
 */
export function Compare({ controls, state, onNotice }: CompareProps) {
  const [diff, setDiff] = useState<RevisionDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The comparison ended (in the view, or another revision replaced it): its lists go too.
  useEffect(() => {
    if (!state.comparing) setDiff(null);
  }, [state.comparing]);

  const compare = async (file: File) => {
    setBusy(true);
    try {
      setDiff(await controls.compare(new Uint8Array(await file.arrayBuffer()), file.name));
    } catch (err) {
      onNotice(msg('That file could not be compared: {error}', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };
  const select = (e: RevisionEntry) => controls.run({ type: 'selectItems', items: { [e.modelId]: [e.localId] }, fit: true });

  return (
    <details className="m3d-section" open>
      <summary>{msg('Compare')}</summary>
      <div className="m3d-body">
        <div className="panel-toolbar">
          <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()} title={msg('Load another revision of this model (an IFC file) and show what changed')}>
            {busy ? msg('Comparing…') : msg('Compare with revision…')}
          </button>
          {state.comparing && (
            <button type="button" className="btn small" onClick={() => controls.run({ type: 'endCompare' })}>
              {msg('End comparison')}
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept=".ifc"
            aria-label={msg('Compare with revision')}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void compare(f);
            }}
          />
        </div>
        {!diff && !busy && <p className="empty">{msg('Shows what was added, changed and removed since another revision of this model.')}</p>}
        {diff && (
          <>
            <p className="m3d-note">
              {keyed(msgParts('Against {other}: {count} unchanged.', { other: <strong>{diff.other}</strong>, count: diff.unchanged.toLocaleString() }))}
            </p>
            {KINDS().map((k) => {
              const list = diff[k.key];
              return (
                <details key={k.key} className="m3d-compare" open={list.length > 0 && list.length <= 50}>
                  <summary title={k.hint}>
                    <span className="m3d-swatch" style={{ background: k.colour }} />
                    {k.title}
                    <span className="m3d-count">{list.length}</span>
                  </summary>
                  <ul className="m3d-list" aria-label={k.title}>
                    {list.map((e) => (
                      <li key={e.guid} className="m3d-row">
                        <button type="button" className="m3d-name" title={[`${e.name} (${prettyClass(e.category)})`, ...(e.geometry ? [msg('Shape or position changed')] : []), ...(e.changes ?? [])].join('\n')} onClick={() => select(e)}>
                          {e.name}
                        </button>
                        {k.key === 'changed' && <span className="m3d-class">{[e.geometry && msgc('what changed in an element', 'shape'), e.changes?.length && msgc('what changed in an element', 'properties')].filter(Boolean).join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </>
        )}
      </div>
    </details>
  );
}

interface QuantitiesProps {
  controls: ModelControls;
  state: ModelState;
  onSaveFile: (name: string, data: Blob) => void;
}

const num = (v: number) => (v ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '');
const round = (v: number) => Math.round(v * 1000) / 1000;

/** The quantities table: elements grouped by class or a property, with their count, length, area and volume. */
export function Quantities({ controls, state, onSaveFile }: QuantitiesProps) {
  const [groupBy, setGroupBy] = useState(BY_CLASS);
  const [scope, setScope] = useState<'all' | 'selection'>('all');
  const [table, setTable] = useState<QuantityTable | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setTable(await controls.quantities(groupBy.trim() || BY_CLASS, scope));
    } finally {
      setBusy(false);
    }
  };
  const label = (key: string) => (table?.groupBy === BY_CLASS ? prettyClass(key) : key || msg('(none)'));
  // Grouping by class is named in the interface language; BY_CLASS itself is what the box holds and is compared with.
  const groupTitle = table?.groupBy === BY_CLASS ? msg('Class') : (table?.groupBy ?? '');
  const total = (table?.rows ?? []).reduce((t, r) => ({ count: t.count + r.count, length: t.length + r.length, area: t.area + r.area, volume: t.volume + r.volume }), { count: 0, length: 0, area: 0, volume: 0 });

  const exportXlsx = () => {
    if (!table) return;
    const rows = [
      [groupTitle, msg('Count'), msg('Length (m)'), msg('Area (m²)'), msg('Volume (m³)'), msg('Volume from')],
      ...table.rows.map((r) => [label(r.key), r.count, round(r.length), round(r.area), round(r.volume), r.measuredVolume ? msg('Shapes') : msg('Quantity sets')]),
      [msg('Total'), total.count, round(total.length), round(total.area), round(total.volume), ''],
    ];
    onSaveFile('quantities.xlsx', new Blob([buildXlsx(rows, msg('Quantities')) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  };

  return (
    <details className="m3d-section" open>
      <summary>{msg('Quantities')}</summary>
      <div className="m3d-body">
        <form
          className="m3d-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input aria-label={msg('Group quantities by')} list="m3d-qty-props" value={groupBy} title={msg('Class, or any property name')} onChange={(e) => setGroupBy(e.target.value)} />
          <datalist id="m3d-qty-props">
            {(table?.properties ?? [BY_CLASS]).map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <select aria-label={msg('Quantities of')} value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'selection')}>
            <option value="all">{msg('All')}</option>
            <option value="selection" disabled={!state.selected}>
              {msg('Selection')}
            </option>
          </select>
          <button type="submit" className="btn small" disabled={busy}>
            {busy ? msg('Totalling…') : msgc('button: work out the quantities', 'Total')}
          </button>
        </form>
        {table && (
          <>
            <table className="m3d-qty" aria-label={msg('Quantities')}>
              <thead>
                <tr>
                  <th>{groupTitle}</th>
                  <th>{msg('Count')}</th>
                  <th title={msg('Metres')}>{msg('Length')}</th>
                  <th title={msg('Square metres')}>{msg('Area')}</th>
                  <th title={msg('Cubic metres')}>{msg('Volume')}</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.key} onClick={() => controls.run({ type: 'selectItems', items: r.items })} title={msg('Select these elements')}>
                    <td>{label(r.key)}</td>
                    <td>{r.count.toLocaleString()}</td>
                    <td>{num(r.length)}</td>
                    <td>{num(r.area)}</td>
                    <td title={r.measuredVolume ? msg('Measured from the shapes (no quantity set gave a volume)') : undefined}>
                      {r.measuredVolume && r.volume ? '≈ ' : ''}
                      {num(r.volume)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{msg('Total')}</td>
                  <td>{total.count.toLocaleString()}</td>
                  <td>{num(total.length)}</td>
                  <td>{num(total.area)}</td>
                  <td>{num(total.volume)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="panel-toolbar">
              <button type="button" className="btn small" disabled={!table.rows.length} onClick={exportXlsx}>
                {msg('Export to Excel…')}
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
