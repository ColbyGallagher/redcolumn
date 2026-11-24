import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useEffect, useRef, useState } from 'react';
import type { StoredFile } from '../storage/fileStore';
import { useDrawingSets } from '../storage/sets';
import { DEFAULT_COMPARE, type CompareOptions } from '../compare/compare';
import type { PagePair } from '../compare/pairing';
import { ComparePagePicker, type PagePreview } from './ComparePagePicker';

export type ComparePairing = { kind: 'sheet' } | { kind: 'order' } | { kind: 'one'; oldPage: number; newPage: number } | { kind: 'list'; pairs: PagePair[] };

export interface CompareSpec {
  oldId: string;
  newId: string;
  pairing: ComparePairing;
  options: CompareOptions;
  /** How differences are marked. */
  markup: { type: 'cloud' | 'rect'; color: string; markOld: boolean };
  /** Overlay Pages: the colour each revision is drawn in. */
  colors: { old: string; new: string };
  /**
   * Batch Compare and Batch Overlay: every sheet of the old files paired with the new files' by
   * sheet number (or order), across files; `oldId` and `newId` are then unused.
   */
  batch?: { oldIds: string[]; newIds: string[] };
}

interface Props {
  /** Compare Documents, or Overlay Pages (the same choice of documents and pages). */
  mode: 'compare' | 'overlay';
  files: readonly StoredFile[];
  /** Documents open in tabs, offered first. */
  openIds: readonly string[];
  /** The document in front: compared as the new revision by default. */
  currentId: string | null;
  currentPage: number;
  /** Renders a page for Align Pages and Select Region. */
  preview: (fileId: string, page: number) => Promise<PagePreview>;
  onRun: (spec: CompareSpec) => void;
  onCancel: () => void;
}

const KEY = 'nb.compare';

function saved(): Partial<Pick<CompareSpec, 'options' | 'markup' | 'colors'>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Document › Compare Documents: finds the differences between an old and a new revision of a
 * drawing and clouds them. Pages are lined up automatically, so a sheet re-plotted with a
 * different margin compares cleanly. Document › Overlay Pages uses the same dialog to stack the
 * two revisions in colour.
 */
export function CompareDialog({ mode, files, openIds, currentId, currentPage, preview, onRun, onCancel }: Props) {
  const ordered = [...files].sort((a, b) => Number(openIds.includes(b.id)) - Number(openIds.includes(a.id)));
  const [newId, setNewId] = useState(currentId ?? ordered[0]?.id ?? '');
  const [oldId, setOldId] = useState(() => ordered.find((f) => f.id !== (currentId ?? ordered[0]?.id))?.id ?? '');
  const { sets } = useDrawingSets();
  const [source, setSource] = useState<'files' | 'sets'>('files');
  const [oldSet, setOldSet] = useState(sets[0]?.id ?? '');
  const [newSet, setNewSet] = useState(sets[1]?.id ?? sets[0]?.id ?? '');
  const batch = source === 'sets';
  const setFiles = (id: string) => (sets.find((x) => x.id === id)?.entries ?? []).map((e) => e.fileId).filter((f) => files.some((x) => x.id === f));
  const [pairing, setPairing] = useState<'sheet' | 'order' | 'one'>('sheet');
  const [oldPage, setOldPage] = useState(currentPage + 1);
  const [newPage, setNewPage] = useState(currentPage + 1);
  const [options, setOptions] = useState<CompareOptions>({
    ...DEFAULT_COMPARE,
    ...saved().options,
    region: null,
    transform: null,
  });
  useEffect(() => {
    if (batch && pairing === 'one') setPairing('sheet');
  }, [batch, pairing]);
  const [picking, setPicking] = useState<'points' | 'region' | null>(null);
  // Points picked on one pair of pages mean nothing on another.
  const pickedFor = useRef('');
  const pairKey = `${oldId}:${newId}:${pairing}:${oldPage}:${newPage}`;
  useEffect(() => {
    if (pickedFor.current && pickedFor.current !== pairKey) setOptions((o) => ({ ...o, transform: null }));
    pickedFor.current = pairKey;
  }, [pairKey]);
  const [markup, setMarkup] = useState<CompareSpec['markup']>({
    type: 'cloud',
    color: '#e02020',
    markOld: true,
    ...saved().markup,
  });
  const [colors, setColors] = useState<CompareSpec['colors']>({
    old: '#e02020',
    new: '#1a6cff',
    ...saved().colors,
  });
  const overlay = mode === 'overlay';
  const set = (patch: Partial<CompareOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const valid = (batch ? !!setFiles(oldSet).length && !!setFiles(newSet).length && oldSet !== newSet : !!oldId && !!newId && oldId !== newId) && (overlay || options.graphics || options.text);

  const picker = (value: string, onChange: (id: string) => void, label: string) => (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        {msg('Choose a document…')}
      </option>
      {ordered.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
          {openIds.includes(f.id) ? ' ' + msg('(open)') : ''}
        </option>
      ))}
    </select>
  );

  // Three points are picked on one pair of pages, so hand alignment is for a single page.
  const pickPage = pairing === 'one' ? newPage - 1 : currentPage;
  const pageTools = (
    <fieldset>
      <legend>{msg('Line up')}</legend>
      <label className="check" title={msg('A revision printed at another paper size (A1 and A3, say) is scaled to match')}>
        {keyed(msgParts('{input}Scale pages of another size to fit', { input: <input type="checkbox" checked={!!options.scaleToFit} onChange={(e) => set({ scaleToFit: e.target.checked })} /> }))}
      </label>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={batch || pairing !== 'one' || !valid}
          title={pairing === 'one' ? msg('Click the same three points on both pages') : msg('Choose one old page and one new page first')}
          onClick={() => setPicking('points')}
        >
          {msg('Align Pages…')}
        </button>
        {options.transform ? (
          <>
            <span>{msg('Aligned by three points')}</span>
            <button type="button" className="btn" onClick={() => set({ transform: null })}>
              {msg('Clear')}
            </button>
          </>
        ) : (
          <span className="print-hint">{pairing === 'one' ? msg('Three points, for drawings at another scale or turned') : msg('For one old page with one new page')}</span>
        )}
      </div>
      {!overlay && (
        <div className="row">
          <button type="button" className="btn" disabled={batch || !newId} onClick={() => setPicking('region')}>
            {msg('Select Region…')}
          </button>
          {options.region ? (
            <>
              <span>
                {msg('Only {round} × {round2} pt at ({round3}, {round4})', { round: Math.round(options.region.w), round2: Math.round(options.region.h), round3: Math.round(options.region.x), round4: Math.round(options.region.y) })}
              </span>
              <button type="button" className="btn" onClick={() => set({ region: null })}>
                {msg('Clear')}
              </button>
            </>
          ) : (
            <span className="print-hint">{msg('Whole page')}</span>
          )}
        </div>
      )}
    </fieldset>
  );

  if (picking === 'points')
    return (
      <ComparePagePicker
        mode="points"
        preview={preview}
        old={{ fileId: oldId, page: oldPage - 1 }}
        cur={{ fileId: newId, page: newPage - 1 }}
        onCancel={() => setPicking(null)}
        onDone={(transform) => {
          set({ transform });
          setPicking(null);
        }}
      />
    );
  if (picking === 'region')
    return (
      <ComparePagePicker
        mode="region"
        preview={preview}
        cur={{ fileId: newId, page: pickPage }}
        initial={options.region ?? null}
        onCancel={() => setPicking(null)}
        onDone={(region) => {
          set({ region });
          setPicking(null);
        }}
      />
    );

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal print-dialog compare-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          try {
            localStorage.setItem(
              KEY,
              JSON.stringify({
                options: { ...options, region: null, transform: null },
                markup,
                colors,
              }),
            );
          } catch {
            // Not remembered.
          }
          if (batch) {
            const oldIds = setFiles(oldSet);
            const newIds = setFiles(newSet);
            onRun({
              oldId: oldIds[0]!,
              newId: newIds[0]!,
              pairing: { kind: pairing === 'order' ? 'order' : 'sheet' },
              options: { ...options, transform: null },
              markup,
              colors,
              batch: { oldIds, newIds },
            });
            return;
          }
          onRun({
            oldId,
            newId,
            pairing: pairing === 'one' ? { kind: 'one', oldPage: oldPage - 1, newPage: newPage - 1 } : { kind: pairing },
            options,
            markup,
            colors,
          });
        }}
      >
        <h3>{overlay ? msg('Overlay Pages') : msg('Compare Documents')}</h3>
        {overlay && <p>{msg('Stacks the two revisions on one page in colour: what both have shows dark, what only one has shows in its colour. Makes a new PDF.')}</p>}
        <div className="row">
          <label className="check">
            {keyed(msgParts('{input}Two documents', { input: <input type="radio" checked={!batch} onChange={() => setSource('files')} /> }))}
          </label>
          <label className="check" title={sets.length ? msg('Bulk: every sheet of one set against the same sheet in another') : msg('Make Sets in the Sets panel first')}>
            {keyed(msgParts('{input}Two sets (batch)', { input: <input type="radio" checked={batch} disabled={!sets.length} onChange={() => setSource('sets')} /> }))}
          </label>
        </div>
        {batch ? (
          <>
            {(['Old', 'New'] as const).map((which) => (
              <label className="row" key={which}>
                {which} {msg('set')}
                <select aria-label={msg('{which} set', { which })} value={which === 'Old' ? oldSet : newSet} onChange={(e) => (which === 'Old' ? setOldSet : setNewSet)(e.target.value)}>
                  {sets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {msg('{name} ({count, plural, one {# file} other {# files}})', { name: x.name, count: setFiles(x.id).length })}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {oldSet === newSet && <p className="print-error">{msg('Choose two different sets.')}</p>}
            <p className="print-hint">{msg('Sheets are paired across all the files of both sets; each pair of files is {value}.', { value: overlay ? msg('overlaid into one PDF') : msg('compared and clouded') })}</p>
          </>
        ) : (
          <>
            <label className="row">{keyed(msgParts('Old revision {picker}', { picker: picker(oldId, setOldId, msg('Old revision')) }))}</label>
            <label className="row">{keyed(msgParts('New revision {picker}', { picker: picker(newId, setNewId, msg('New revision')) }))}</label>
            {oldId && oldId === newId && <p className="print-error">{msg('Choose two different documents.')}</p>}
          </>
        )}
        <fieldset>
          <legend>{msg('Pages')}</legend>
          <label className="row">
            {keyed(msgParts('{input}All pages, matched by sheet number', { input: <input type="radio" checked={pairing === 'sheet'} onChange={() => setPairing('sheet')} /> }))}
          </label>
          <label className="row">
            {keyed(msgParts('{input}All pages, in page order', { input: <input type="radio" checked={pairing === 'order'} onChange={() => setPairing('order')} /> }))}
          </label>
          {!batch && (
            <label className="row">
              {keyed(msgParts('{input}Old page{input2}with new page{input3}', { input: <input type="radio" checked={pairing === 'one'} onChange={() => setPairing('one')} />, input2: <input type="number" min={1} value={oldPage} style={{ width: 56 }} onFocus={() => setPairing('one')} onChange={(e) => setOldPage(Math.max(1, Math.round(Number(e.target.value)) || 1))} />, input3: <input type="number" min={1} value={newPage} style={{ width: 56 }} onFocus={() => setPairing('one')} onChange={(e) => setNewPage(Math.max(1, Math.round(Number(e.target.value)) || 1))} /> }))}
            </label>
          )}
        </fieldset>
        {overlay ? (
          <>
            <label className="row">
              {keyed(msgParts('Old revision in{input}New revision in{input2}', { input: <input type="color" value={colors.old} aria-label={msg('Old revision colour')} onChange={(e) => setColors((c) => ({ ...c, old: e.target.value }))} />, input2: <input type="color" value={colors.new} aria-label={msg('New revision colour')} onChange={(e) => setColors((c) => ({ ...c, new: e.target.value }))} /> }))}
            </label>
            <label className="check">
              {keyed(msgParts('{input}Align pages automatically', { input: <input type="checkbox" checked={options.align} onChange={(e) => set({ align: e.target.checked })} /> }))}
            </label>
            {pageTools}
          </>
        ) : (
          <>
            <fieldset>
              <legend>{msg('Compare')}</legend>
              <label className="check">
                {keyed(msgParts('{input}Graphics (everything drawn)', { input: <input type="checkbox" checked={options.graphics} onChange={(e) => set({ graphics: e.target.checked })} /> }))}
              </label>
              <label className="check">
                {keyed(msgParts('{input}Text (words added, removed or changed)', { input: <input type="checkbox" checked={options.text} onChange={(e) => set({ text: e.target.checked })} /> }))}
              </label>
              <label className="check">
                {keyed(msgParts('{input}Align pages automatically', { input: <input type="checkbox" checked={options.align} onChange={(e) => set({ align: e.target.checked })} /> }))}
              </label>
            </fieldset>
            {pageTools}
            <fieldset>
              <legend>{msg('Sensitivity')}</legend>
              <label className="row" title={msg('Lines that moved less than this are not a change')}>
                {msg('Tolerance')}
                <input
                  type="number"
                  min={0}
                  max={20}
                  step={0.5}
                  value={options.proximity}
                  style={{ width: 64 }}
                  onChange={(e) =>
                    set({
                      proximity: Math.min(20, Math.max(0, Number(e.target.value) || 0)),
                    })
                  }
                />
                {msg('pt')}
              </label>
              <label className="row" title={msg('Changes closer together than this are clouded as one')}>
                {msg('Cluster size')}
                <input
                  type="number"
                  min={4}
                  max={144}
                  value={options.cluster}
                  style={{ width: 64 }}
                  onChange={(e) =>
                    set({
                      cluster: Math.min(144, Math.max(4, Number(e.target.value) || 12)),
                    })
                  }
                />
                {msg('pt')}
              </label>
              <label className="row" title={msg('Changed pixels needed before a spot counts; raise it to ignore noise')}>
                {msg('Ignore specks under')}
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={options.sensitivity}
                  style={{ width: 64 }}
                  onChange={(e) =>
                    set({
                      sensitivity: Math.min(500, Math.max(1, Math.round(Number(e.target.value)) || 6)),
                    })
                  }
                />
                {msg('pixels')}
              </label>
              <label className="row">
                {msg('Resolution')}
                <select value={options.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })}>
                  <option value={72}>{msg('72 dpi (fast)')}</option>
                  <option value={100}>{msg('100 dpi')}</option>
                  <option value={150}>{msg('150 dpi (fine detail)')}</option>
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>{msg('Mark differences with')}</legend>
              <label className="row">
                <select
                  value={markup.type}
                  onChange={(e) =>
                    setMarkup((m) => ({
                      ...m,
                      type: e.target.value as 'cloud' | 'rect',
                    }))
                  }
                >
                  <option value="cloud">{msg('Clouds')}</option>
                  <option value="rect">{msg('Rectangles')}</option>
                </select>
                <input type="color" value={markup.color} aria-label={msg('Colour')} onChange={(e) => setMarkup((m) => ({ ...m, color: e.target.value }))} />
              </label>
              <label className="check">
                {keyed(msgParts('{input}Mark the old revision too', { input: <input type="checkbox" checked={markup.markOld} onChange={(e) => setMarkup((m) => ({ ...m, markOld: e.target.checked }))} /> }))}
              </label>
            </fieldset>
            <p className="print-hint">{msg('Markups from an earlier compare of the same pages are replaced.')}</p>
          </>
        )}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {overlay ? msg('Overlay') : msg('Compare')}
          </button>
        </div>
      </form>
    </div>
  );
}
