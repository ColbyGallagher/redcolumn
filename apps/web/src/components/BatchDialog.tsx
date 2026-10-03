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
import { savedTsa, saveTsa, TimestampOption } from './DigitalSignatures';

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
  | { kind: 'split'; parts: 'pages' | 'bookmarks'; count: number }
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

export const BATCH_LABELS: Record<BatchKind, string> = {
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

const HINTS: Record<BatchKind, string> = {
  flatten: 'Burns each file’s markups into its pages. Links stay interactive.',
  unflatten: 'Brings back markups flattened with recovery on.',
  reduce: 'Drops unused objects and packs each file more tightly.',
  repair: 'Reads each file and writes a clean copy.',
  colour: 'Turns each file’s vector content grey or black.',
  ocr: 'Makes the scanned pages of each file searchable (pages that already have text are skipped).',
  removeHeaderFooter: 'Removes headers, footers and page numbers added here.',
  summary: 'One report of every markup in the files, with the file each is in: a CSV table, XML, or a PDF summary.',
  stamp: 'Places a stamp from your library on the pages of each file, as a markup (dynamic fields such as {File} and {Page} are filled in per page).',
  headerFooter: 'Adds headers and footers (page numbers, Bates numbers, file name, date) to every page of each file.',
  crop: 'Crops every page of each file by the same margins; markups stay where they were on the drawing.',
  pageSetup: 'Resizes every page of each file to one paper size (landscape pages stay landscape).',
  split: 'Splits each file into parts, downloaded together as one ZIP file.',
  pageLabels: 'Reads each file’s sheet numbers from its title blocks (where not already known) and writes them into the file as page labels, which other PDF readers show too.',
  sign: 'Signs each file with a Digital ID (certifying it if asked), with an optional seal or signature picture and a trusted time stamp.',
  print: 'Prints the files one after another, in the order listed, through one print dialog.',
  link: 'Finds sheet and detail references across the files and links them to the sheets in the other files. Links within a file are found when it is opened.',
};

/** Commands that write the files (and so can keep revisions). */
const WRITES: ReadonlySet<BatchKind> = new Set(['flatten', 'unflatten', 'reduce', 'repair', 'colour', 'ocr', 'removeHeaderFooter', 'headerFooter', 'crop', 'pageSetup', 'sign', 'pageLabels']);

const CORNERS: [Corner, string][] = [
  ['topLeft', 'Top left'],
  ['topRight', 'Top right'],
  ['bottomLeft', 'Bottom left'],
  ['bottomRight', 'Bottom right'],
];

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
  const [split, setSplit] = useState<{ parts: 'pages' | 'bookmarks'; count: number }>({ parts: 'pages', count: 1 });
  const [sign, setSign] = useState<Omit<BatchSign, 'timestampUrl'>>({ idId: ids[0]?.id ?? '', password: '', reason: 'I am approving this document', location: '', certify: 0, imageId: null, placement: 'bottomRight', page: 'first' });
  const [tsa, setTsa] = useState(savedTsa);
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
        return { kind, sign: { ...sign, timestampUrl: tsa.on && tsa.url.trim() ? tsa.url.trim() : null } };
      default:
        return { kind } as BatchCommand;
    }
  };
  const toggle = (id: string, on: boolean) => setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)));
  const ordered = files.filter((f) => chosen.includes(f.id)).map((f) => f.id);
  const ready = kind === 'stamp' ? !!stamp.stampId : kind === 'headerFooter' ? !!hf : kind === 'sign' ? !!sign.idId && !!sign.password : true;
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
          if (kind === 'sign') saveTsa(tsa);
          setRunning(true);
          setResults([]);
          void onRun({ command: command(), fileIds: ordered, keepRevisions }, (r) => setResults((list) => [...(list ?? []), r])).finally(() => setRunning(false));
        }}
      >
        <h3>Batch · {BATCH_LABELS[kind]}</h3>
        {results ? (
          <>
            <p>
              {running ? `Working… ${results.length} of ${ordered.length}` : `Done: ${results.filter((r) => r.ok).length} succeeded${results.some((r) => !r.ok) ? `, ${results.filter((r) => !r.ok).length} failed` : ''}.`}
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
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="row">
              Command
              <select value={kind} onChange={(e) => setKind(e.target.value as BatchKind)}>
                {(Object.keys(BATCH_LABELS) as BatchKind[]).map((k) => (
                  <option key={k} value={k}>
                    {BATCH_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <p className="print-hint">{HINTS[kind]}</p>
            {kind === 'flatten' && (
              <label className="check">
                <input type="checkbox" checked={recovery} onChange={(e) => setRecovery(e.target.checked)} />
                Allow markup recovery (Unflatten brings them back)
              </label>
            )}
            {kind === 'reduce' && (
              <label className="check">
                <input type="checkbox" checked={recompress} onChange={(e) => setRecompress(e.target.checked)} />
                Recompress JPEG pictures at quality
                <input type="number" min={0.3} max={0.95} step={0.05} value={quality} disabled={!recompress} style={{ width: 64 }} onChange={(e) => setQuality(Math.min(0.95, Math.max(0.3, Number(e.target.value) || 0.7)))} />
              </label>
            )}
            {kind === 'colour' && (
              <label className="row">
                Convert to
                <select value={mode} onChange={(e) => setMode(e.target.value as 'grayscale' | 'black')}>
                  <option value="grayscale">Greyscale</option>
                  <option value="black">Black (everything but white)</option>
                </select>
              </label>
            )}
            {kind === 'print' && (
              <label className="row">
                Print
                <select value={printContent} onChange={(e) => setPrintContent(e.target.value as 'all' | 'document' | 'markups')}>
                  <option value="all">Document and markups</option>
                  <option value="document">Document only</option>
                  <option value="markups">Markups only</option>
                </select>
              </label>
            )}
            {kind === 'ocr' && (
              <label className="row">
                Resolution
                <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                  <option value={150}>150 dpi</option>
                  <option value={200}>200 dpi</option>
                  <option value={300}>300 dpi</option>
                </select>
              </label>
            )}
            {kind === 'summary' && (
              <label className="row">
                Format
                <select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xml' | 'pdf')}>
                  <option value="csv">CSV (spreadsheet)</option>
                  <option value="xml">XML</option>
                  <option value="pdf">PDF summary</option>
                </select>
              </label>
            )}
            {kind === 'stamp' && (
              <>
                <label className="row">
                  Stamp
                  <select value={stamp.stampId} onChange={(e) => setStamp({ ...stamp, stampId: e.target.value })}>
                    {stamps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row">
                  At
                  <select value={stamp.position} onChange={(e) => setStamp({ ...stamp, position: e.target.value as Corner | 'center' })}>
                    {CORNERS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                    <option value="center">Centre</option>
                  </select>
                  on
                  <select value={stamp.pages} onChange={(e) => setStamp({ ...stamp, pages: e.target.value as 'all' | 'first' | 'last' })}>
                    <option value="first">the first page</option>
                    <option value="last">the last page</option>
                    <option value="all">every page</option>
                  </select>
                </label>
                <label className="row">
                  Width
                  <input type="number" min={36} max={1000} value={stamp.width} style={{ width: 72 }} onChange={(e) => setStamp({ ...stamp, width: Math.min(1000, Math.max(36, Number(e.target.value) || 180)) })} />
                  pt
                </label>
              </>
            )}
            {kind === 'headerFooter' && (
              <div className="row">
                <button type="button" className="btn" onClick={() => setHfOpen(true)}>
                  {hf ? 'Change…' : 'Set up…'}
                </button>
                <span className="print-hint">
                  {hf
                    ? Object.values(hf.text)
                        .filter((t) => t?.trim())
                        .join(' · ')
                    : 'Choose what goes in the headers and footers.'}
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
                <span>in</span>
              </div>
            )}
            {kind === 'pageSetup' && (
              <>
                <label className="row">
                  Paper
                  <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                    {PAGE_SIZES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />
                  Scale the content to fit (else keep its size, centred)
                </label>
              </>
            )}
            {kind === 'split' && (
              <label className="row">
                <select value={split.parts} onChange={(e) => setSplit({ ...split, parts: e.target.value as 'pages' | 'bookmarks' })}>
                  <option value="pages">Every</option>
                  <option value="bookmarks">At each top-level bookmark</option>
                </select>
                {split.parts === 'pages' && (
                  <>
                    <input type="number" min={1} value={split.count} style={{ width: 56 }} onChange={(e) => setSplit({ ...split, count: Math.max(1, Math.round(Number(e.target.value)) || 1) })} />
                    page{split.count === 1 ? '' : 's'}
                  </>
                )}
              </label>
            )}
            {kind === 'sign' && (
              <fieldset>
                <legend>Signature</legend>
                {!ids.length && <p className="print-error">Make or import a Digital ID first (Signatures panel › Digital IDs).</p>}
                <label className="row">
                  Digital ID
                  <select value={sign.idId} onChange={(e) => setSign({ ...sign, idId: e.target.value })}>
                    {ids.map((id) => (
                      <option key={id.id} value={id.id}>
                        {id.name}
                      </option>
                    ))}
                  </select>
                  Password
                  <input type="password" autoComplete="off" value={sign.password} onChange={(e) => setSign({ ...sign, password: e.target.value })} />
                </label>
                <label className="row">
                  Reason
                  <input value={sign.reason} onChange={(e) => setSign({ ...sign, reason: e.target.value })} />
                  Location
                  <input value={sign.location} onChange={(e) => setSign({ ...sign, location: e.target.value })} />
                </label>
                <label className="row">
                  <select value={sign.certify} onChange={(e) => setSign({ ...sign, certify: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
                    <option value={0}>Approve (sign)</option>
                    <option value={1}>Certify: no changes allowed</option>
                    <option value={2}>Certify: allow form filling and signing</option>
                    <option value={3}>Certify: also allow markups</option>
                  </select>
                </label>
                <label className="row">
                  Seal
                  <select value={sign.imageId ?? ''} onChange={(e) => setSign({ ...sign, imageId: e.target.value || null })}>
                    <option value="">None (name and date)</option>
                    {pictures.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || (p.kind === 'initials' ? 'Initials' : 'Signature')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row">
                  Place it
                  <select value={sign.placement} onChange={(e) => setSign({ ...sign, placement: e.target.value as BatchSign['placement'] })}>
                    <option value="invisible">Invisibly</option>
                    {CORNERS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {sign.placement !== 'invisible' && (
                    <select value={sign.page} onChange={(e) => setSign({ ...sign, page: e.target.value as 'first' | 'last' })}>
                      <option value="first">of the first page</option>
                      <option value="last">of the last page</option>
                    </select>
                  )}
                </label>
                <TimestampOption value={tsa} onChange={setTsa} />
              </fieldset>
            )}
            <fieldset>
              <legend>Files ({ordered.length})</legend>
              <div className="row">
                <select
                  value=""
                  aria-label="Choose the files of a set or group"
                  onChange={(e) => {
                    const [type, id] = e.target.value.split(':');
                    const ids = type === 'set' ? sets.find((s) => s.id === id)?.entries.map((x) => x.fileId) : type === 'group' ? groups.find((g) => g.id === id)?.fileIds : type === 'all' ? files.map((f) => f.id) : type === 'none' ? [] : null;
                    if (ids) setChosen(ids.filter((x) => files.some((f) => f.id === x)));
                  }}
                >
                  <option value="">Choose…</option>
                  <option value="all:">All files</option>
                  <option value="none:">None</option>
                  {sets.map((s) => (
                    <option key={s.id} value={`set:${s.id}`}>
                      Set: {s.name}
                    </option>
                  ))}
                  {groups.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      Group: {g.name}
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
                <input type="checkbox" checked={keepRevisions} onChange={(e) => setKeepRevisions(e.target.checked)} />
                Keep each file as it was as a revision (Document › Revisions)
              </label>
            )}
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!enough}>
                Run on {ordered.length} file{ordered.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
