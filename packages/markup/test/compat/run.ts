// Bluebeam compatibility checks. Runs redcolumn's own import, save and exchange code over the
// fixtures in manifest.json, writes compat-results.json, and regenerates docs/compatibility.md.
//
//   REDCOLUMN_COMPAT_DIR  folder with the Revu-made sample PDF and BAX (default: reference_data at the repo root)
//   REVU_SETTINGS_DIR     Revu's settings folder (.btx, .blx, .bhx, .bpx). Without it those files are not run.
//   REDCOLUMN_PYTHON      python with pypdf; PyMuPDF (fitz) is needed for the render check. Default: python.
//
//   pnpm --filter @nb/markup compat
//
// A fixture counts only for what it contains. Anything the run cannot check is shown as Not run,
// never as a pass.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { exportBax, parseBax, type BaxMarkup } from '../../src/bax.ts';
import { parseBhx } from '../../src/hatchSet.ts';
import { parseBlx } from '../../src/lineSet.ts';
import { parseBpx } from '../../src/bpx.ts';
import { parseBtx } from '../../src/toolchest.ts';
import { exportWithAnnotations, type Matrix } from '../../src/export.ts';
import { importAnnotations } from '../../src/import.ts';
import { importColumns } from '../../src/bluebeam.ts';
import { encodePng, readPdfExtras } from '../../src/pdfExtras.ts';
import { DEFAULT_STATUSES } from '../../src/columns.ts';
import { markupsFromXfdf, markupsToXfdf } from '../../src/xfdf.ts';
import type { Markup, MarkupStyle, MarkupType } from '../../src/model.ts';
import type { Dropped } from '../../src/diagnostics.ts';
import { DEFAULT_SCALE } from '../../../measure/src/index.ts';
import { renderMatrix, type Cell, type FixtureRecord, type Results, type Table } from './matrix.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const COMPAT_DIR = resolve(process.env.REDCOLUMN_COMPAT_DIR ?? join(REPO, 'reference_data'));
const SETTINGS_DIR = process.env.REVU_SETTINGS_DIR ? resolve(process.env.REVU_SETTINGS_DIR) : null;
const PYTHON = process.env.REDCOLUMN_PYTHON ?? 'python';
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// ---- Features ----------------------------------------------------------------------------------

export const ANNOTATION_ROWS = [
  'Shapes & lines',
  'Measurements',
  'Text markup',
  'Notes & text',
  'Stamps',
  'Images',
  'Attachments',
  'Form fields',
  'Pop-ups',
  'Other',
  'Document structure',
  'Page render',
];
export const ANNOTATION_COLUMNS = ['PDF save (unedited)', 'PDF save (edited)', 'BAX export', 'XFDF round trip'];
export const EXCHANGE_ROWS = ['.btx tool sets', '.blx line styles', '.bhx hatch sets', '.bpx profiles (markup list)'];
export const EXCHANGE_COLUMNS = ['Read', 'Write'];

const SHAPE_SUBTYPES = new Set(['Square', 'Circle', 'Polygon', 'PolyLine', 'Line', 'Ink']);
const TEXT_SUBTYPES = new Set(['Highlight', 'StrikeOut', 'Underline', 'Squiggly']);
const MEASURE_IT = /Count|Radius|Angle|Volume|Dimension|SketchToScale|Perimeter|Polylength/;

/** The row a PDF annotation belongs to. Measured annotations are measurements whatever their subtype. */
export function featureOfAnnotation(a: { subtype: string; it: string; measured: boolean; image: boolean }): string {
  if (a.subtype === 'Widget') return 'Form fields';
  if (a.subtype === 'Popup') return 'Pop-ups';
  if (a.measured) return 'Measurements';
  if (a.subtype === 'Square' && a.image) return 'Images';
  if (a.subtype === 'Stamp') return 'Stamps';
  if (a.subtype === 'FileAttachment') return 'Attachments';
  if (TEXT_SUBTYPES.has(a.subtype)) return 'Text markup';
  if (a.subtype === 'Text' || a.subtype === 'FreeText') return 'Notes & text';
  if (SHAPE_SUBTYPES.has(a.subtype)) return 'Shapes & lines';
  return 'Other';
}

const MEASURE_TYPES = new Set<string>(['length', 'polylength', 'area', 'perimeter', 'count', 'angle', 'diameter', 'radius', 'arcLength', 'volume', 'dimension']);
const TEXT_MARKUP_TYPES = new Set<string>(['highlighter', 'textHighlight', 'underline', 'strikeout', 'squiggly', 'replaceText']);
const NOTE_TYPES = new Set<string>(['text', 'callout', 'typewriter', 'note', 'flag', 'flagLabel']);
const SHAPE_TYPES = new Set<string>(['line', 'arrow', 'polyline', 'arc', 'rect', 'ellipse', 'polygon', 'cloud', 'polygonCloud', 'ellipticalArc', 'pen']);

/** The row a markup belongs to, by its type. */
export function featureOfMarkup(type: MarkupType): string {
  if (MEASURE_TYPES.has(type)) return 'Measurements';
  if (TEXT_MARKUP_TYPES.has(type)) return 'Text markup';
  if (NOTE_TYPES.has(type)) return 'Notes & text';
  if (SHAPE_TYPES.has(type)) return 'Shapes & lines';
  if (type === 'stamp') return 'Stamps';
  if (type === 'image' || type === 'signature') return 'Images';
  if (type === 'attachment') return 'Attachments';
  return 'Other';
}

/** The row for a Revu/PDF annotation dictionary as text (BAX holds them as PDF syntax). */
function featureOfText(text: string): string {
  const subtype = /\/Subtype\s*\/(\w+)/.exec(text)?.[1] ?? '';
  const it = /\/IT\s*\/(\w+)/.exec(text)?.[1] ?? '';
  return featureOfAnnotation({ subtype, it, measured: MEASURE_IT.test(it) || /\/Measure\b|\/MeasurementTypes\b/.test(text), image: /\/Image\b/.test(text) });
}

// ---- Accumulating counts -----------------------------------------------------------------------

const newTable = (rows: string[], columns: string[]): Table => ({ rows, columns, cells: {}, notRun: {} });

function cellOf(t: Table, row: string, col: string): Cell {
  const byCol = (t.cells[row] ??= {});
  return (byCol[col] ??= { items: 0, revuItems: 0, failed: [], failedCount: 0, extra: [], extraCount: 0 });
}

/**
 * Adds `items` for a row and column. `failed` names the items that did not come through; `extra`
 * names what came out without a source item. Each is counted once, and only the first few are kept.
 */
function add(t: Table, row: string, col: string, items: number, failed: string[], revu: boolean, extra: string[] = []) {
  const c = cellOf(t, row, col);
  c.items += items;
  if (revu) c.revuItems += items;
  c.failedCount += failed.length;
  for (const f of failed) if (c.failed.length < 5) c.failed.push(f);
  c.extraCount += extra.length;
  for (const f of extra) if (c.extra.length < 5) c.extra.push(f);
}

/** A fixture that threw: every row of its column shows Error, since the column's items are unknown. */
const failColumn = (t: Table, col: string, error: string) => t.rows.forEach((row) => (cellOf(t, row, col).error = error));
/** A row that could not be read: its cell shows Error. */
const failRow = (t: Table, row: string, col: string, error: string) => (cellOf(t, row, col).error = error);
/** Why a column (or one row of it) could not run at all. Shown only where the cell has no items. */
const notRun = (t: Table, col: string, reason: string, row?: string) => (t.notRun[row ? `${row}|${col}` : col] = reason);

// ---- Fixtures ----------------------------------------------------------------------------------

interface ManifestEntry {
  id: string;
  format: 'pdf' | 'bax' | 'xfdf' | 'btx' | 'blx' | 'bhx' | 'bpx';
  base: 'compat' | 'settings';
  /** A file in the base folder. */
  path?: string;
  /** Every file in the base folder with this extension, instead of one path. */
  ext?: string;
  /** For a BAX file: the id of the manifest entry for the PDF it was exported from. */
  pair?: string;
  /** The rows a fixture was made to cover: while it is missing, only they read Not run (test/compat/revu-fixtures.md says how to make it). */
  covers?: string[];
  source: 'revu' | 'synthetic';
}

interface Fixture extends ManifestEntry {
  file: string;
  name: string;
}

function expand(entries: ManifestEntry[], skipped: string[]): Fixture[] {
  const out: Fixture[] = [];
  for (const e of entries) {
    const dir = e.base === 'compat' ? COMPAT_DIR : SETTINGS_DIR;
    if (!dir) {
      skipped.push(`${e.id}: REVU_SETTINGS_DIR is not set`);
      continue;
    }
    if (e.ext) {
      const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.toLowerCase().endsWith(e.ext!)).sort() : [];
      if (!names.length) skipped.push(`${e.id}: no ${e.ext} files in ${dir}`);
      for (const n of names) out.push({ ...e, file: join(dir, n), name: n });
    } else if (e.path) {
      out.push({ ...e, file: join(dir, e.path), name: basename(e.path) });
    }
  }
  return out;
}

// ---- The PDF pipeline: the app's import and save path, headless -------------------------------

let engine: Promise<(req: Record<string, unknown>) => Promise<any>> | undefined;

/** PDFium's worker, run in this process the way the app runs it (see pdf-core/src/worker.ts). */
function worker() {
  engine ??= (async () => {
    const g = globalThis as any;
    const pending = new Map<number, { res: (m: any) => void; rej: (e: Error) => void }>();
    let nid = 1;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (u: any, ...r: any[]) => (String(u).startsWith('file:') ? new Response(readFileSync(new URL(u))) : origFetch(u, ...r))) as typeof fetch;
    g.self = globalThis;
    g.postMessage = (msg: any) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.ok ? p.res(msg) : p.rej(new Error(msg.error));
    };
    await import(new URL('../../../pdf-core/src/worker.ts', import.meta.url).href);
    return (req) =>
      new Promise((res, rej) => {
        const id = nid++;
        pending.set(id, { res, rej });
        g.onmessage({ data: { ...req, id } });
      });
  })();
  return engine;
}

interface Pipeline {
  markups: Markup[];
  roundtrip: Uint8Array;
  edited: Uint8Array;
}

/** Opens, reads annotations as the app does, imports them, and saves unedited and edited copies. */
async function pipeline(bytes: Uint8Array): Promise<Pipeline> {
  const call = await worker();
  const ab = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const raw = await readPdfExtras(ab());
  const open = await call({ type: 'open', bytes: ab() });
  const outline = (await call({ type: 'outline', docId: open.docId })).outline;
  const annots: any[][] = [];
  for (let i = 0; i < open.pages.length; i++) annots.push((await call({ type: 'annotations', docId: open.docId, pageIndex: i })).annotations);
  const labels = (await call({ type: 'pageLabels', docId: open.docId })).labels;
  // Other tools' stamps and attachments are imported as pictures, as the app's indexer does.
  if (raw) raw.appearances = new Map();
  for (const [i, list] of annots.entries())
    for (const a of list) {
      if (!raw || (a.subtype !== 'Stamp' && a.subtype !== 'FileAttachment') || a.appData || a.flags & 35) continue;
      const { image } = await call({ type: 'annotImage', docId: open.docId, pageIndex: i, index: a.index, scale: 3 });
      if (image) raw.appearances.set(`${i}:${a.index}`, `data:image/png;base64,${Buffer.from(await encodePng(image.width, image.height, image.rgba)).toString('base64')}`);
    }

  const markups: Markup[] = [];
  const imported: Record<number, unknown[]> = {};
  const importedSpaces: Record<number, number[]> = {};
  const pageScales: Record<number, unknown> = {};
  const viewports: unknown[] = [];
  const statesSet = new Set<string>();
  annots.forEach((list, i) => {
    const r = importAnnotations(i, list, () => null, raw);
    markups.push(...r.markups);
    if (r.imported.length) imported[i] = r.imported;
    if (r.scale) pageScales[i] = r.scale;
    viewports.push(...(r.viewports ?? []));
    for (const s of r.statuses ?? []) statesSet.add(s);
    const sp = r.markups.flatMap((m) => (m.pdfAnnot?.space ? [m.pdfAnnot.index] : []));
    if (sp.length) importedSpaces[i] = sp;
  });
  const columns = raw ? importColumns(raw.columns) : [];
  const bookmarks = (items: any[]): any[] => items.map((o) => ({ id: crypto.randomUUID(), title: o.title, pageIndex: o.pageIndex ?? 0, rect: o.rect, ...(o.zoom ? { zoom: o.zoom } : {}), children: bookmarks(o.children) }));
  void labels;
  const options = () => ({
    scaleFor: (i: number) => (pageScales[i] as any) ?? DEFAULT_SCALE,
    viewports,
    imported,
    importedSpaces,
    pageScales,
    columns,
    statuses: DEFAULT_STATUSES,
    bookmarks: bookmarks(outline),
  });
  const roundtrip = await exportWithAnnotations(ab(), markups, options() as any);

  // Edit pass: move every imported markup 2 pt, add a reply to the first, change its status and one column value.
  const edited = markups.map((m, i) => ({
    ...m,
    points: m.points.map(([x, y]) => [x + 2, y] as [number, number]),
    ...(m.holes ? { holes: m.holes.map((h) => h.map(([x, y]) => [x + 2, y] as [number, number])) } : {}),
    ...(i === 0
      ? { replies: [...(m.replies ?? []), { id: 'new-reply', author: 'Tester', text: 'Edited in redcolumn', createdAt: Date.now() }], status: 'completed', fields: { ...m.fields, 'bluebeam:CUSTOM COLUMN 1': 'EDITED' } }
      : {}),
  }));
  const editedBytes = await exportWithAnnotations(ab(), edited, options() as any);
  return { markups, roundtrip, edited: editedBytes };
}

interface AnnotationItem {
  key: string;
  page: number;
  subtype: string;
  subj: string;
  feature: string;
}

const nameOf = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFName)?.decodeText() ?? '';
const textOf = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText() ?? '';

/** Every annotation on every page, keyed `p<page>#<position>` as compare.py labels them. */
async function annotationItems(bytes: Uint8Array): Promise<AnnotationItem[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: AnnotationItem[] = [];
  for (const [pi, page] of doc.getPages().entries()) {
    const refs = (page.node.Annots()?.asArray() ?? []) as any[];
    for (const [j, ref] of refs.entries()) {
      const d = doc.context.lookup(ref);
      if (!(d instanceof PDFDict)) continue;
      const subtype = nameOf(d, 'Subtype');
      const it = nameOf(d, 'IT');
      const measured = MEASURE_IT.test(it) || d.has(PDFName.of('Measure')) || d.has(PDFName.of('MeasurementTypes'));
      out.push({ key: `p${pi + 1}#${j}`, page: pi + 1, subtype, subj: textOf(d, 'Subj'), feature: featureOfAnnotation({ subtype, it, measured, image: d.has(PDFName.of('Image')) }) });
    }
  }
  return out;
}

export interface CompareReport {
  /** Annotation problems by key (`p1#0`), each with compare.py's text. */
  annotations: Map<string, string>;
  /** Pages whose render changed (unedited saves only). */
  renderFailed: number[];
  /** Whether the render check ran (PyMuPDF installed). */
  rendered: boolean;
  /** Catalog, bookmark and page-key problems. */
  structure: string[];
}

/** Runs compare.py (pypdf and PyMuPDF) on a source and a saved copy. */
function compare(source: string, saved: string, edited: boolean): CompareReport {
  const res = spawnSync(PYTHON, [join(here, 'compare.py'), source, saved, ...(edited ? ['--edited'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error(`${PYTHON} did not run (set REDCOLUMN_PYTHON): ${res.error.message}`);
  if (res.status !== 0) throw new Error(`compare.py failed: ${(res.stderr || res.stdout).trim().split('\n').pop()}`);
  return parseCompare(res.stdout);
}

/** Reads compare.py's output: `p<page>#<position>` lines are annotation problems, the rest structure. */
export function parseCompare(text: string): CompareReport {
  const report: CompareReport = { annotations: new Map(), renderFailed: [], rendered: /pixels differ/.test(text), structure: [] };
  const problems = text.includes('PROBLEMS:') ? text.slice(text.indexOf('PROBLEMS:')).split('\n').slice(1).filter(Boolean) : [];
  for (const p of problems) {
    const a = /^p(\d+)#(\d+) /.exec(p);
    if (a) {
      report.annotations.set(`p${a[1]}#${a[2]}`, p.slice(p.indexOf(':') + 1).trim() || p);
      continue;
    }
    const r = /^page (\d+) renders differently/.exec(p);
    if (r) report.renderFailed.push(Number(r[1]));
    else report.structure.push(p);
  }
  return report;
}

/** Items in a BAX or the annotations of a PDF, grouped by row, for matching a Revu file against ours. */
function countByRow(texts: { page: number; feature: string }[]) {
  const m = new Map<string, number>();
  for (const t of texts) m.set(`${t.page}|${t.feature}`, (m.get(`${t.page}|${t.feature}`) ?? 0) + 1);
  return m;
}

/** Every markup in a BAX, nested replies, states, group members and pop-ups included. */
function* allBaxMarkups(ms: BaxMarkup[]): Generator<BaxMarkup> {
  for (const m of ms) {
    yield m;
    yield* allBaxMarkups([...m.replies, ...m.statuses, ...m.children, ...(m.popup ? [m.popup] : [])]);
  }
}

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

// The check for one PDF: unedited and edited saves, the XFDF round trip of its markups.
interface PdfRun {
  pipeline: Pipeline;
  items: AnnotationItem[];
  unedited: CompareReport;
  edited: CompareReport;
  pages: number;
}

const pdfRuns = new Map<string, PdfRun>();
async function pdfRun(file: string, bytes: Uint8Array): Promise<PdfRun> {
  const cached = pdfRuns.get(file);
  if (cached) return cached;
  const p = await pipeline(bytes);
  const dir = mkdtempSync(join(tmpdir(), 'redcolumn-compat-'));
  const rt = join(dir, 'roundtrip.pdf');
  const ed = join(dir, 'edited.pdf');
  writeFileSync(rt, p.roundtrip);
  writeFileSync(ed, p.edited);
  const run: PdfRun = {
    pipeline: p,
    items: await annotationItems(bytes),
    unedited: compare(file, rt, false),
    edited: compare(file, ed, true),
    pages: (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount(),
  };
  pdfRuns.set(file, run);
  return run;
}

function recordPdf(results: Results, fx: Fixture, run: PdfRun) {
  const revu = fx.source === 'revu';
  const t = results.annotations;
  const unedited = run.unedited;
  const edited = run.edited;
  for (const it of run.items) {
    const u = unedited.annotations.get(it.key);
    add(t, it.feature, 'PDF save (unedited)', 1, u ? [`${fx.name} · ${it.key} /${it.subtype}${it.subj ? ` ${it.subj}` : ''}: ${u}`] : [], revu);
    const e = edited.annotations.get(it.key);
    add(t, it.feature, 'PDF save (edited)', 1, e ? [`${fx.name} · ${it.key} /${it.subtype}${it.subj ? ` ${it.subj}` : ''}: ${e}`] : [], revu);
  }
  add(t, 'Document structure', 'PDF save (unedited)', 1, unedited.structure.length ? [`${fx.name}: ${unedited.structure.join('; ')}`] : [], revu);
  if (!unedited.rendered) notRun(t, 'PDF save (unedited)', 'PyMuPDF (fitz) is not installed', 'Page render');
  else add(t, 'Page render', 'PDF save (unedited)', run.pages, unedited.renderFailed.map((p) => `${fx.name} · page ${p} renders differently`), revu);
}

/**
 * Our BAX export of a PDF must hold every annotation of that PDF, per page and row. Widgets and
 * links are left out of BAX by design (Revu leaves them out too), so they are not counted. A
 * missing markup is a failure; a markup that is not in the PDF is an extra.
 */
async function recordBaxExport(results: Results, fx: Fixture, bytes: Uint8Array, items: AnnotationItem[]) {
  const t = results.annotations;
  const revu = fx.source === 'revu';
  const source = countByRow(items.filter((i) => !BAX_LEFT_OUT.has(i.subtype)).map((i) => ({ page: i.page, feature: i.feature })));
  const ours = countByRow(await markupsOfBax(await exportBax(bytes)));
  const perRow = new Map<string, { items: number; failed: string[]; extra: string[] }>();
  for (const key of new Set([...source.keys(), ...ours.keys()])) {
    const [page, feature] = key.split('|') as [string, string];
    const n = source.get(key) ?? 0;
    const got = ours.get(key) ?? 0;
    const row = perRow.get(feature) ?? { items: 0, failed: [], extra: [] };
    perRow.set(feature, row);
    row.items += n;
    for (let i = got; i < n; i++) row.failed.push(`${fx.name} · page ${page} ${feature}: not in the BAX export`);
    for (let i = n; i < got; i++) row.extra.push(`${fx.name} · page ${page} ${feature}: in the BAX export but not in the PDF`);
  }
  for (const [feature, row] of perRow) add(t, feature, 'BAX export', row.items, row.failed, revu, row.extra);
}

/** Subtypes BAX leaves out by design. */
const BAX_LEFT_OUT = new Set(['Widget', 'Link']);

/** Each markup in a BAX as its page and row. */
async function markupsOfBax(xml: string): Promise<{ page: number; feature: string }[]> {
  const bax = await parseBax(xml);
  const out: { page: number; feature: string }[] = [];
  for (const p of bax.pages) for (const m of allBaxMarkups(p.markups)) out.push({ page: p.index + 1, feature: featureOfText(latin1(m.raw)) });
  return out;
}

function recordXfdf(results: Results, fx: Fixture, markups: Markup[]) {
  const t = results.annotations;
  const back = markupsFromXfdf(markupsToXfdf(markups, () => IDENTITY), () => IDENTITY);
  const byId = new Map(back.map((m) => [m.id, m]));
  const revu = fx.source === 'revu';
  for (const m of markups) {
    const row = featureOfMarkup(m.type);
    const diff = differences(m, byId.get(m.id));
    add(t, row, 'XFDF round trip', 1, diff ? [`${fx.name} · ${m.type} ${m.id}: ${diff}`] : [], revu);
  }
}

/** What did not come back the same, or null when the markup came back as it was. */
function differences(a: Markup, b: Markup | undefined): string | null {
  if (!b) return 'not in the XFDF that came back';
  const d: string[] = [];
  if (a.type !== b.type) d.push(`type ${a.type} → ${b.type}`);
  if (a.pageIndex !== b.pageIndex) d.push('page');
  if (a.points.length !== b.points.length || a.points.some((p, i) => Math.abs(p[0] - b.points[i]![0]) > 0.01 || Math.abs(p[1] - b.points[i]![1]) > 0.01)) d.push('geometry');
  if (a.style.stroke.toLowerCase() !== b.style.stroke.toLowerCase()) d.push('colour');
  if (Math.abs(a.style.width - b.style.width) > 0.01) d.push('width');
  if ((a.text ?? '') !== (b.text ?? '')) d.push('text');
  if ((a.replies?.length ?? 0) !== (b.replies?.length ?? 0)) d.push('replies');
  if (!!a.checked !== !!b.checked) d.push('checked');
  if (a.status !== b.status) d.push('status');
  return d.length ? d.join(', ') : null;
}

// ---- Settings and exchange files ----------------------------------------------------------------

const TOOL_DEFAULT: MarkupStyle = { stroke: '#e11d48', fill: null, width: 1, opacity: 1 };
const DEFAULTS = new Proxy({} as Record<MarkupType, MarkupStyle>, { get: () => TOOL_DEFAULT });

/** Counts the XML units each reader works through, and the readers' own record of what it dropped. */
async function readSettings(fx: Fixture, xml: string): Promise<{ items: number; dropped: Dropped[] }> {
  const dropped: Dropped[] = [];
  switch (fx.format) {
    case 'btx':
      await parseBtx(xml, DEFAULTS, 'Imported tools', dropped);
      return { items: count(xml, /<ToolChestItem\b/g), dropped };
    case 'blx':
      await parseBlx(xml, 'Imported line styles', dropped);
      return { items: count(xml, /<LineStyle\b/g), dropped };
    case 'bhx':
      await parseBhx(xml, 'Imported hatches', dropped);
      return { items: count(xml, /<Hatch\b/g), dropped };
    case 'bpx':
      parseBpx(xml, 'Imported profile', dropped);
      return { items: count(xml, /<Column\b/g) + count(xml, /<BSIColumnItem\b/g), dropped };
    default:
      throw new Error(`no settings reader for ${fx.format}`);
  }
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** The exchange-table row for each settings format. */
const EXCHANGE_ROW_OF: Record<string, string> = {
  btx: '.btx tool sets',
  blx: '.blx line styles',
  bhx: '.bhx hatch sets',
  bpx: '.bpx profiles (markup list)',
};

async function recordSettings(results: Results, fx: Fixture) {
  const t = results.exchange;
  const row = EXCHANGE_ROW_OF[fx.format]!;
  const revu = fx.source === 'revu';
  const xml = readFileSync(fx.file, 'utf8');
  try {
    const { items, dropped } = await readSettings(fx, xml);
    // One failed item per top-level element that lost something, named with the first reason it gave.
    const firstReason = new Map<string, string>();
    for (const d of dropped) if (!firstReason.has(d.item)) firstReason.set(d.item, d.reason);
    const failed = [...firstReason].map(([item, reason]) => `${fx.name} · ${item}: ${reason}`);
    add(t, row, 'Read', items, failed, revu);
    // No writer exists yet for these formats, so every item is not yet written.
    add(t, row, 'Write', items, [], revu);
    cellOf(t, row, 'Write').writer = false;
  } catch (e) {
    failRow(t, row, 'Read', (e as Error).message);
  }
}

// ---- Run ----------------------------------------------------------------------------------------

async function main() {
  const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8')) as { fixtures: ManifestEntry[] };
  const skipped: string[] = [];
  const results: Results = { annotations: newTable(ANNOTATION_ROWS, ANNOTATION_COLUMNS), exchange: newTable(EXCHANGE_ROWS, EXCHANGE_COLUMNS), fixtures: [], skipped };
  if (!existsSync(COMPAT_DIR)) skipped.push(`REDCOLUMN_COMPAT_DIR not found: ${COMPAT_DIR}`);
  const fixtures = expand(manifest.fixtures, skipped);

  // Columns and rows that no fixture reached get a reason, so they read Not run rather than —.
  if (!existsSync(COMPAT_DIR)) for (const col of ['PDF save (unedited)', 'PDF save (edited)', 'BAX export', 'XFDF round trip']) notRun(results.annotations, col, 'REDCOLUMN_COMPAT_DIR not found');
  if (!SETTINGS_DIR)
    for (const e of manifest.fixtures.filter((m) => m.base === 'settings')) {
      const row = EXCHANGE_ROW_OF[e.format]!;
      notRun(results.exchange, 'Read', 'REVU_SETTINGS_DIR is not set', row);
      notRun(results.exchange, 'Write', 'REVU_SETTINGS_DIR is not set', row);
    }

  for (const fx of fixtures) {
    const rec: FixtureRecord = { id: fx.id, format: fx.format, source: fx.source, file: fx.name, status: 'ok', items: 0 };
    results.fixtures.push(rec);
    if (!existsSync(fx.file) && fx.covers) {
      rec.status = 'missing';
      rec.reason = 'file not found (see test/compat/revu-fixtures.md)';
      const cols = fx.format === 'pdf' ? ['PDF save (unedited)', 'PDF save (edited)', 'BAX export'] : fx.format === 'xfdf' ? ['XFDF round trip'] : [];
      // BAX leaves form fields out, as Revu does (a Known limit), so that cell stays a dash.
      for (const row of fx.covers) for (const col of cols) if (!(col === 'BAX export' && row === 'Form fields')) notRun(results.annotations, col, `${fx.name} not found`, row);
      continue;
    }
    if (!existsSync(fx.file)) {
      rec.status = 'missing';
      rec.reason = 'file not found';
      if (fx.format === 'pdf') for (const col of ['PDF save (unedited)', 'PDF save (edited)']) notRun(results.annotations, col, `${fx.name} not found`);
      // The XFDF column still runs on the markups of the PDF fixture; a missing XFDF only adds the Revu files it would have checked.
      if (fx.format === 'xfdf') results.skipped.push(`${fx.name} not found: no Revu-made XFDF is checked (add one to manifest.json)`);
      if (fx.format === 'btx' || fx.format === 'blx' || fx.format === 'bhx' || fx.format === 'bpx') {
        notRun(results.exchange, 'Read', `${fx.name} not found`, EXCHANGE_ROW_OF[fx.format]);
      }
      continue;
    }
    try {
      if (fx.format === 'pdf') {
        const bytes = new Uint8Array(readFileSync(fx.file));
        const run = await pdfRun(fx.file, bytes);
        recordPdf(results, fx, run);
        recordXfdf(results, fx, run.pipeline.markups);
        await recordBaxExport(results, fx, bytes, run.items);
        rec.items = run.items.length;
      } else if (fx.format === 'bax') {
        // Revu's own BAX is only a reference when it was exported from the PDF in the manifest. Check the
        // page count; the export check itself runs against the PDF (see recordBaxExport).
        const pdf = manifest.fixtures.find((m) => m.id === fx.pair);
        const pdfFile = pdf ? join(COMPAT_DIR, pdf.path ?? '') : '';
        const revuPages = (await parseBax(readFileSync(fx.file, 'utf8'))).pages.length;
        rec.items = (await markupsOfBax(readFileSync(fx.file, 'utf8'))).length;
        if (pdfFile && existsSync(pdfFile)) {
          const pdfPages = (await PDFDocument.load(new Uint8Array(readFileSync(pdfFile)), { updateMetadata: false })).getPageCount();
          if (pdfPages !== revuPages) results.skipped.push(`${fx.name}: has ${revuPages} pages, its PDF ${basename(pdfFile)} has ${pdfPages}. It was exported from another version of the PDF, so it is not used as a reference. Re-export the BAX from Revu for this PDF.`);
        }
      } else if (fx.format === 'xfdf') {
        const back = markupsFromXfdf(readFileSync(fx.file, 'utf8'), () => IDENTITY);
        recordXfdf(results, fx, back);
        rec.items = back.length;
      } else {
        await recordSettings(results, fx);
        rec.items = count(readFileSync(fx.file, 'utf8'), fx.format === 'btx' ? /<ToolChestItem\b/g : fx.format === 'blx' ? /<LineStyle\b/g : fx.format === 'bhx' ? /<Hatch\b/g : /<Column\b|<BSIColumnItem\b/g);
      }
    } catch (e) {
      rec.status = 'error';
      rec.reason = (e as Error).message;
      if (fx.format === 'pdf') for (const col of ['PDF save (unedited)', 'PDF save (edited)', 'XFDF round trip']) failColumn(results.annotations, col, rec.reason);
      else if (fx.format === 'bax') results.skipped.push(`${fx.name}: could not be read (${rec.reason})`);
      else if (fx.format === 'xfdf') failColumn(results.annotations, 'XFDF round trip', rec.reason);
      else failRow(results.exchange, EXCHANGE_ROW_OF[fx.format]!, 'Read', rec.reason);
    }
  }

  const outDir = existsSync(COMPAT_DIR) ? COMPAT_DIR : join(tmpdir(), 'redcolumn-compat');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'compat-results.json'), JSON.stringify(results, null, 1) + '\n');
  const docPath = join(REPO, 'docs', 'compatibility.md');
  writeFileSync(docPath, renderMatrix(results) + '\n');
  console.log(`results: ${join(outDir, 'compat-results.json')}`);
  console.log(`matrix:  ${docPath}`);
  for (const s of skipped) console.log(`NOT RUN: ${s}`);
  for (const f of results.fixtures) console.log(`${f.status.padEnd(7)} ${f.id} (${f.file})${f.reason ? ` — ${f.reason}` : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
  process.exit(0);
}
