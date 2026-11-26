import { msg, msgParts } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { keyed } from '../i18n/keyed';
import { useState } from 'react';
import type { StoredFile } from '../storage/fileStore';
import type { DrawingSet } from '../storage/sets';
import type { FileGroup } from '../storage/fileGroups';
import type { ColourMode } from '../documents/process';
import type { HeaderFooterSpec } from '../documents/headerFooter';
import type { DigitalIdRecord } from '../documents/digitalIds';
import type { SavedSignature } from '../signatures/signatures';
import type { StampDef } from '@nb/markup';
import { PAGE_SIZES } from '../documents/pageSizes';
import { HeaderFooterDialog } from './HeaderFooterDialog';
import { LtvOption, savedLtv, saveLtv, savedTsa, saveTsa, TimestampOption, tsaUrl } from './DigitalSignatures';
import { recalledPassword } from '../documents/idPasswords';
import type { SplitSpec } from '../documents/pageTools';
import { DEFAULT_SPLIT, SplitOptions } from './SplitOptions';
import { commandPolicy } from '../commands/commandPolicy';

export type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/** Batch Sign & Seal: one Digital ID signs every file, with an optional seal picture. */
export interface BatchSign {
  idId: string;
  password: string;
  reason: string;
  location: string;
  certify: 0 | 1 | 2 | 3;
  /** A saved signature or seal picture shown in the signature, or none. */
  imageId: string | null;
  placement: 'invisible' | Corner;
  page: 'first' | 'last';
  timestampUrl: string | null;
  /** Add long-term validation data once signed. */
  ltv: boolean;
}

export type BatchCommand =
  | { kind: 'flatten'; recovery: boolean }
  | { kind: 'unflatten' }
  | { kind: 'reduce'; recompress: boolean; quality: number }
  | { kind: 'repair' }
  | { kind: 'colour'; mode: ColourMode }
  | { kind: 'ocr'; dpi: number }
  | { kind: 'removeHeaderFooter' }
  | { kind: 'summary'; format: 'csv' | 'xml' | 'pdf' }
  | { kind: 'print'; content: 'all' | 'document' | 'markups' }
  | { kind: 'link' }
  | { kind: 'stamp'; stampId: string; position: Corner | 'center'; pages: 'all' | 'first' | 'last'; width: number }
  | { kind: 'headerFooter'; spec: HeaderFooterSpec }
  | { kind: 'crop'; margins: { top: number; right: number; bottom: number; left: number } }
  | { kind: 'pageSetup'; size: { width: number; height: number }; fit: boolean }
  | ({ kind: 'split' } & SplitSpec)
  | { kind: 'sign'; sign: BatchSign }
  | { kind: 'pageLabels' };

export type BatchKind = BatchCommand['kind'];

export interface BatchSpec {
  command: BatchCommand;
  fileIds: string[];
  /** Files that change keep their contents before as a revision. */
  keepRevisions: boolean;
}

export interface BatchResult {
  fileId: string;
  name: string;
  ok: boolean;
  message: string;
}

/** The bulk operations in English, in menu order: revision notes are stored in English. */
export const BATCH_ENGLISH: Record<BatchKind, string> = {
  flatten: 'Flatten',
  unflatten: 'Unflatten',
  reduce: 'Reduce File Size',
  repair: 'Repair',
  colour: 'Colour Processing',
  ocr: 'OCR',
  removeHeaderFooter: 'Remove Headers & Footers',
  summary: 'Markup Summary',
  print: 'Print',
  link: 'Auto-Link Sheets',
  stamp: 'Apply Stamp',
  headerFooter: 'Headers & Footers',
  crop: 'Crop Pages',
  pageSetup: 'Page Setup',
  split: 'Split',
  sign: 'Sign & Seal',
  pageLabels: 'Page Labels (AutoMark)',
};

/** The bulk operations, in menu order. */
export const BATCH_KINDS = Object.keys(BATCH_ENGLISH) as BatchKind[];

/** A bulk operation's name. */
export function batchLabel(kind: BatchKind): string {
  const labels: Record<BatchKind, string> = {
    flatten: msg('Flatten'),
    unflatten: msg('Unflatten'),
    reduce: msg('Reduce File Size'),
    repair: msg('Repair'),
    colour: msg('Colour Processing'),
    ocr: msg('OCR'),
    removeHeaderFooter: msg('Remove Headers & Footers'),
    summary: msg('Markup Summary'),
    print: msg('Print'),
    link: msg('Auto-Link Sheets'),
    stamp: msg('Apply Stamp'),
    headerFooter: msg('Headers & Footers'),
    crop: msg('Crop Pages'),
    pageSetup: msg('Page Setup'),
    split: msg('Split'),
    sign: msg('Sign & Seal'),
    pageLabels: msg('Page Labels (AutoMark)'),
  };
  return labels[kind];
}

const HINTS = lazy((): Record<BatchKind, string> => ({
  flatten: msg('Burns each file’s markups into its pages. Links stay interactive.'),
  unflatten: msg('Brings back markups flattened with recovery on.'),
  reduce: msg('Drops unused objects and packs each file more tightly.'),
  repair: msg('Reads each file and writes a clean copy.'),
  colour: msg('Turns each file’s vector content grey or black.'),
  ocr: msg('Makes the scanned pages of each file searchable (pages that already have text are skipped).'),
  removeHeaderFooter: msg('Removes headers, footers and page numbers added here.'),
  summary: msg('One report of every markup in the files, with the file each is in: a CSV table, XML, or a PDF summary.'),
  stamp: msg('Places a stamp from your library on the pages of each file, as a markup (dynamic fields such as \'{\'File\'}\' and \'{\'Page\'}\' are filled in per page).'),
  headerFooter: msg('Adds headers and footers (page numbers, Bates numbers, file name, date) to every page of each file.'),
  crop: msg('Crops every page of each file by the same margins; markups stay where they were on the drawing.'),
  pageSetup: msg('Resizes every page of each file to one paper size (landscape pages stay landscape).'),
  split: msg('Splits each file into parts, downloaded together as one ZIP file.'),
  pageLabels: msg('Reads each file’s sheet numbers from its title blocks (where not already known) and writes them into the file as page labels, which other PDF readers show too.'),
  sign: msg('Signs each file with a Digital ID (certifying it if asked), with an optional seal or signature picture and a trusted time stamp.'),
  print: msg('Prints the files one after another, in the order listed, through one print dialog.'),
  link: msg('Finds sheet and detail references across the files and links them to the sheets in the other files. Links within a file are found when it is opened.'),
}));

/** Commands that write the files (and so can keep revisions). */
const WRITES: ReadonlySet<BatchKind> = new Set(['flatten', 'unflatten', 'reduce', 'repair', 'colour', 'ocr', 'removeHeaderFooter', 'headerFooter', 'crop', 'pageSetup', 'sign', 'pageLabels']);

const CORNERS = lazy((): [Corner, string][] => [
  ['topLeft', msg('Top left')],
  ['topRight', msg('Top right')],
  ['bottomLeft', msg('Bottom left')],
  ['bottomRight', msg('Bottom right')],
]);

interface Props {
  initial: BatchKind;
  files: readonly StoredFile[];
  sets: readonly DrawingSet[];
  groups: readonly FileGroup[];
  /** Files to start with (e.g. the one in front). */
  selected: readonly string[];
  /** Runs the batch; `onResult` is called as each file finishes. */
  onRun: (spec: BatchSpec, onResult: (r: BatchResult) => void) => Promise<void>;
  onClose: () => void;
  /** The stamp library, for Apply Stamp. */
  stamps: readonly StampDef[];
  /** Digital IDs and saved pictures, for Sign & Seal. */
  ids: readonly DigitalIdRecord[];
  pictures: readonly SavedSignature[];
}

/**
 * The Batch menu: one document command run over many library files, with a result for each.
 * Files can be picked one by one or all the files of a Set or a File Access group.
 */
export function BatchDialog({ initial, files, sets, groups, selected, onRun, onClose, stamps, ids, pictures }: Props) {
  const [kind, setKind] = useState<BatchKind>(initial);
  const [chosen, setChosen] = useState<string[]>(() => selected.filter((id) => files.some((f) => f.id === id)));
  const [recovery, setRecovery] = useState(true);
  const [recompress, setRecompress] = useState(true);
  const [quality, setQuality] = useState(0.7);
  const [mode, setMode] = useState<'grayscale' | 'black'>('grayscale');
  const [dpi, setDpi] = useState(200);
  const [printContent, setPrintContent] = useState<'all' | 'document' | 'markups'>('all');
  const [format, setFormat] = useState<'csv' | 'xml' | 'pdf'>('csv');
  const [stamp, setStamp] = useState({ stampId: stamps[0]?.id ?? '', position: 'topRight' as Corner | 'center', pages: 'first' as 'all' | 'first' | 'last', width: 180 });
  const [hf, setHf] = useState<HeaderFooterSpec | null>(null);
  const [hfOpen, setHfOpen] = useState(false);
  const [margins, setMargins] = useState({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 });
  const [paper, setPaper] = useState(PAGE_SIZES.find((p) => p.id === 'tabloid')!.id);
  const [fit, setFit] = useState(true);
  const [split, setSplit] = useState<SplitSpec>(DEFAULT_SPLIT);
  const [sign, setSign] = useState<Omit<BatchSign, 'timestampUrl' | 'ltv'>>({ idId: ids[0]?.id ?? '', password: (ids[0] && !ids[0].token && recalledPassword(ids[0].id)) || '', reason: msg('I am approving this document'), location: '', certify: 0, imageId: null, placement: 'bottomRight', page: 'first' });
  const [tsa, setTsa] = useState(savedTsa);
  const [ltv, setLtv] = useState(savedLtv);
  const [keepRevisions, setKeepRevisions] = useState(true);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const command = (): BatchCommand => {
    switch (kind) {
      case 'flatten':
        return { kind, recovery };
      case 'reduce':
        return { kind, recompress, quality };
      case 'colour':
        return { kind, mode };
      case 'ocr':
        return { kind, dpi };
      case 'print':
        return { kind, content: printContent };
      case 'summary':
        return { kind, format };
      case 'stamp':
        return { kind, ...stamp };
      case 'headerFooter':
        return { kind, spec: hf! };
      case 'crop':
        return { kind, margins: { top: margins.top * 72, right: margins.right * 72, bottom: margins.bottom * 72, left: margins.left * 72 } };
      case 'pageSetup': {
        const p = PAGE_SIZES.find((x) => x.id === paper)!;
        return { kind, size: { width: p.width, height: p.height }, fit };
      }
      case 'split':
        return { kind, ...split };
      case 'sign':
        return { kind, sign: { ...sign, timestampUrl: tsaUrl(tsa), ltv: ltv && !!tsaUrl(tsa) } };
      default:
        return { kind } as BatchCommand;
    }
  };
  const toggle = (id: string, on: boolean) => setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)));
  const ordered = files.filter((f) => chosen.includes(f.id)).map((f) => f.id);
  const card = ids.find((i) => i.id === sign.idId)?.token;
  const ready = kind === 'stamp' ? !!stamp.stampId : kind === 'headerFooter' ? !!hf : kind === 'sign' ? !!sign.idId && (!!card?.pinPad || !!sign.password) : true;
  const enough = (kind === 'link' ? ordered.length >= 2 : ordered.length >= 1) && ready;

  if (hfOpen)
    return (
      <HeaderFooterDialog
        mode="headerFooter"
        batch
        pageCount={1}
        currentPage={0}
        hasExisting={false}
        onApply={async (spec) => {
          setHf(spec);
          setHfOpen(false);
        }}
        onRemove={async () => {}}
        onCancel={() => setHfOpen(false)}
      />
    );

  return (
    <div className="modal-backdrop" onMouseDown={running ? undefined : onClose}>
      <form
        className="modal print-dialog batch-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !running) onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!enough || running) return;
          // The Command select offers every Bulk kind, so Run is where the kinds a host refuses are stopped.
          const refused = commandPolicy(`batch.${kind}`).disabledReason;
          if (refused) return void alert(refused);
          if (kind === 'sign') {
            saveTsa(tsa);
            saveLtv(ltv);
          }
          setRunning(true);
          setResults([]);
          void onRun({ command: command(), fileIds: ordered, keepRevisions }, (r) => setResults((list) => [...(list ?? []), r])).finally(() => setRunning(false));
        }}
      >
        <h3>{msg('Bulk · {operation}', { operation: batchLabel(kind) })}</h3>
        {results ? (
          <>
            <p>
              {running ? msg('Working… {count} of {count2}', { count: results.length, count2: ordered.length }) : msg('Done: {count} succeeded{value}.', { count: results.filter((r) => r.ok).length, value: results.some((r) => !r.ok) ? msg(', {count} failed', { count: results.filter((r) => !r.ok).length }) : '' })}
            </p>
            <ul className="batch-results">
              {results.map((r, i) => (
                <li key={i} className={r.ok ? 'ok' : 'failed'}>
                  <b>{r.ok ? '✓' : '✗'}</b> <span className="batch-file">{r.name}</span>
                  <div className="print-hint">{r.message}</div>
                </li>
              ))}
            </ul>
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="btn primary" disabled={running} onClick={onClose}>
                {msg('Close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="row">
              {msg('Command')}
              <select value={kind} onChange={(e) => setKind(e.target.value as BatchKind)}>
                {BATCH_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {batchLabel(k)}
                  </option>
                ))}
              </select>
            </label>
            <p className="print-hint">{HINTS()[kind]}</p>
            {kind === 'flatten' && (
              <label className="check">
                {keyed(msgParts('{input}Allow markup recovery (Unflatten brings them back)', { input: <input type="checkbox" checked={recovery} onChange={(e) => setRecovery(e.target.checked)} /> }))}
              </label>
            )}
            {kind === 'reduce' && (
              <label className="check">
                {keyed(msgParts('{input}Recompress JPEG pictures at quality{input2}', { input: <input type="checkbox" checked={recompress} onChange={(e) => setRecompress(e.target.checked)} />, input2: <input type="number" min={0.3} max={0.95} step={0.05} value={quality} disabled={!recompress} style={{ width: 64 }} onChange={(e) => setQuality(Math.min(0.95, Math.max(0.3, Number(e.target.value) || 0.7)))} /> }))}
              </label>
            )}
            {kind === 'colour' && (
              <label className="row">
                {msg('Convert to')}
                <select value={mode} onChange={(e) => setMode(e.target.value as 'grayscale' | 'black')}>
                  <option value="grayscale">{msg('Greyscale')}</option>
                  <option value="black">{msg('Black (everything but white)')}</option>
                </select>
              </label>
            )}
            {kind === 'print' && (
              <label className="row">
                {msg('Print')}
                <select value={printContent} onChange={(e) => setPrintContent(e.target.value as 'all' | 'document' | 'markups')}>
                  <option value="all">{msg('Document and markups')}</option>
                  <option value="document">{msg('Document only')}</option>
                  <option value="markups">{msg('Markups only')}</option>
                </select>
              </label>
            )}
            {kind === 'ocr' && (
              <label className="row">
                {msg('Resolution')}
                <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                  <option value={150}>{msg('150 dpi')}</option>
                  <option value={200}>{msg('200 dpi')}</option>
                  <option value={300}>{msg('300 dpi')}</option>
                </select>
              </label>
            )}
            {kind === 'summary' && (
              <label className="row">
                {msg('Format')}
                <select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xml' | 'pdf')}>
                  <option value="csv">{msg('CSV (spreadsheet)')}</option>
                  <option value="xml">{msg('XML')}</option>
                  <option value="pdf">{msg('PDF summary')}</option>
                </select>
              </label>
            )}
            {kind === 'stamp' && (
              <>
                <label className="row">
                  {msg('Stamp')}
                  <select value={stamp.stampId} onChange={(e) => setStamp({ ...stamp, stampId: e.target.value })}>
                    {stamps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row">
                  {msg('At')}
                  <select value={stamp.position} onChange={(e) => setStamp({ ...stamp, position: e.target.value as Corner | 'center' })}>
                    {CORNERS().map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                    <option value="center">{msg('Centre')}</option>
                  </select>
                  {msg('on')}
                  <select value={stamp.pages} onChange={(e) => setStamp({ ...stamp, pages: e.target.value as 'all' | 'first' | 'last' })}>
                    <option value="first">{msg('the first page')}</option>
                    <option value="last">{msg('the last page')}</option>
                    <option value="all">{msg('every page')}</option>
                  </select>
                </label>
                <label className="row">
                  {keyed(msgParts('Width{input}pt', { input: <input type="number" min={36} max={1000} value={stamp.width} style={{ width: 72 }} onChange={(e) => setStamp({ ...stamp, width: Math.min(1000, Math.max(36, Number(e.target.value) || 180)) })} /> }))}
                </label>
              </>
            )}
            {kind === 'headerFooter' && (
              <div className="row">
                <button type="button" className="btn" onClick={() => setHfOpen(true)}>
                  {hf ? msg('Change…') : msg('Set up…')}
                </button>
                <span className="print-hint">
                  {hf
                    ? Object.values(hf.text)
                        .filter((t) => t?.trim())
                        .join(' · ')
                    : msg('Choose what goes in the headers and footers.')}
                </span>
              </div>
            )}
            {kind === 'crop' && (
              <div className="row">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <label key={side}>
                    {side[0]!.toUpperCase() + side.slice(1)}
                    <input type="number" min={0} step={0.125} value={margins[side]} style={{ width: 60 }} onChange={(e) => setMargins({ ...margins, [side]: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>
                ))}
                <span>{msg('in')}</span>
              </div>
            )}
            {kind === 'pageSetup' && (
              <>
                <label className="row">
                  {msg('Paper')}
                  <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                    {PAGE_SIZES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  {keyed(msgParts('{input}Scale the content to fit (else keep its size, centred)', { input: <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> }))}
                </label>
              </>
            )}
            {kind === 'split' && <SplitOptions value={split} onChange={setSplit} />}
            {kind === 'sign' && (
              <fieldset>
                <legend>{msg('Signature')}</legend>
                {!ids.length && <p className="print-error">{msg('Make or import a Digital ID first (Signatures panel › Digital IDs).')}</p>}
                <label className="row">
                  {msg('Digital ID')}
                  <select
                  value={sign.idId}
                  onChange={(e) => {
                    // A password typed for one ID is never sent to another: to a card it would use up a PIN try.
                    const next = ids.find((i) => i.id === e.target.value);
                    setSign({ ...sign, idId: e.target.value, password: (next && !next.token && recalledPassword(next.id)) || '' });
                  }}
                >
                    {ids.map((id) => (
                      <option key={id.id} value={id.id}>
                        {id.name}
                      </option>
                    ))}
                  </select>
                  {!card?.pinPad && (
                    <>
                      {card ? msg('PIN') : msg('Password')}
                      <input type="password" autoComplete="off" value={sign.password} title={card ? msg('Sent to the card for each file’s signature while the batch runs; never stored') : undefined} onChange={(e) => setSign({ ...sign, password: e.target.value })} />
                    </>
                  )}
                </label>
                {card?.pinPad && <p className="print-hint">{msg('Enter the PIN on the card reader for each file when it asks.')}</p>}
                <label className="row">
                  {keyed(msgParts('Reason{input}Location{input2}', { input: <input value={sign.reason} onChange={(e) => setSign({ ...sign, reason: e.target.value })} />, input2: <input value={sign.location} onChange={(e) => setSign({ ...sign, location: e.target.value })} /> }))}
                </label>
                <label className="row">
                  <select value={sign.certify} onChange={(e) => setSign({ ...sign, certify: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
                    <option value={0}>{msg('Approve (sign)')}</option>
                    <option value={1}>{msg('Certify: no changes allowed')}</option>
                    <option value={2}>{msg('Certify: allow form filling and signing')}</option>
                    <option value={3}>{msg('Certify: also allow markups')}</option>
                  </select>
                </label>
                <label className="row">
                  {msg('Seal')}
                  <select value={sign.imageId ?? ''} onChange={(e) => setSign({ ...sign, imageId: e.target.value || null })}>
                    <option value="">{msg('None (name and date)')}</option>
                    {pictures.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || (p.kind === 'initials' ? msg('Initials') : msg('Signature'))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row">
                  {msg('Place it')}
                  <select value={sign.placement} onChange={(e) => setSign({ ...sign, placement: e.target.value as BatchSign['placement'] })}>
                    <option value="invisible">{msg('Invisibly')}</option>
                    {CORNERS().map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {sign.placement !== 'invisible' && (
                    <select value={sign.page} onChange={(e) => setSign({ ...sign, page: e.target.value as 'first' | 'last' })}>
                      <option value="first">{msg('of the first page')}</option>
                      <option value="last">{msg('of the last page')}</option>
                    </select>
                  )}
                </label>
                <TimestampOption value={tsa} onChange={setTsa} />
                <LtvOption value={ltv} onChange={setLtv} timestamped={!!tsaUrl(tsa)} />
              </fieldset>
            )}
            <fieldset>
              <legend>{msg('Files ({count})', { count: ordered.length })}</legend>
              <div className="row">
                <select
                  value=""
                  aria-label={msg('Choose the files of a set or group')}
                  onChange={(e) => {
                    const [type, id] = e.target.value.split(':');
                    const ids = type === 'set' ? sets.find((s) => s.id === id)?.entries.map((x) => x.fileId) : type === 'group' ? groups.find((g) => g.id === id)?.fileIds : type === 'all' ? files.map((f) => f.id) : type === 'none' ? [] : null;
                    if (ids) setChosen(ids.filter((x) => files.some((f) => f.id === x)));
                  }}
                >
                  <option value="">{msg('Choose…')}</option>
                  <option value="all:">{msg('All files')}</option>
                  <option value="none:">{msg('None')}</option>
                  {sets.map((s) => (
                    <option key={s.id} value={`set:${s.id}`}>
                      {msg('Set: {name}', { name: s.name })}
                    </option>
                  ))}
                  {groups.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {msg('Group: {name}', { name: g.name })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="batch-files">
                {files.map((f) => (
                  <label key={f.id} className="check">
                    <input type="checkbox" checked={chosen.includes(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
                    {f.name}
                  </label>
                ))}
              </div>
            </fieldset>
            {WRITES.has(kind) && (
              <label className="check">
                {keyed(msgParts('{input}Keep each file as it was as a revision (Document › Revisions)', { input: <input type="checkbox" checked={keepRevisions} onChange={(e) => setKeepRevisions(e.target.checked)} /> }))}
              </label>
            )}
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={onClose}>
                {msg('Cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={!enough}>
                {msg('Run on {count, plural, one {# file} other {# files}}', { count: ordered.length })}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
