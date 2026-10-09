import { useMemo, useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import * as Y from 'yjs';
import { NEEDS_PASSWORD, PdfEngine, type OutlineItem, type PageOp, type PdfDocument } from '@nb/pdf-core';
import { autoSizedPoints, bluebeamColumnId, markupDigest, canAutoSize, canRoundCorners, cssFont, defaultCornerRadius, markupColours, recolouredStyle, shapeBounds } from '@nb/markup';
import { actionTarget, boundsOf, cloudRadius, DEFAULT_STYLES, drawMarkup, ROTATABLE, canOffset, insertBookmark, resolveStamp, stampAspect, type Bookmark, type LinkAction, type StampDef, isImageType, isMeasureKind, isTextType, MARKUP_LABELS, MarkupStore, measureProps, moved, planPageOps, scaleOfMarkup, translated, viewportAt, type ColumnSet, type Markup, type StoredLink, type StoredStitchGroup } from '@nb/markup';
import { DEFAULT_SCALE, formatMeasure, measureValue, METERS_PER_UNIT, parseScaleText, SnapIndex, type MeasureKind, type Scale } from '@nb/measure';
import { TileViewer, type PagePoint, type ViewerStats, type ViewState } from './viewer/TileViewer';
import { TileDiagnostics } from './components/TileDiagnostics';
import { isMarkupTool, MarkupTools, toolLabel, type FormWidgetHit, type Tool } from './markup/MarkupTools';
import { useBookmarks, useColumnSet, useLinks, usePlaces, useViewports, useMarkups, useScales, useSheets, useStitch, useToolsState } from './markup/hooks';
import { cacheFile, keepRevision, listFiles, readFile, removeFile, removeRevision, renameFile, replaceFileContent, saveFile, touchFile, type FileRevision, type StoredFile } from './storage/fileStore';
import { DriveSession, rememberedSeat } from './studio/drive/DriveSession';
import { DriveAuthError } from './studio/drive/DriveApi';
import { GoogleDrive, googleConfigured, googleSignInConfigured, googleUser, pickSessionFolder, signInWithGoogle } from './studio/drive/google';
import { microsoftUser, OneDrive, subscribeMicrosoftUser, oneDriveConfigured, parseOneDriveInvite, signInWithMicrosoft } from './studio/drive/onedrive';
import { currentSessions, type SessionRef } from './studio/local';
import { allows, canAddMarkups, type RecordEntry } from './studio/protocol';
import { myAccess, recordToCsv, type CollabSession, type StudioSnapshot } from './studio/types';
import { Library } from './components/Library';
import { MarkupList } from './components/MarkupList';
import { SheetSyncDialog } from './components/SheetSyncDialog';
import { toTable } from './sheetsync/table';
import { useSheetSync } from './sheetsync/useSheetSync';
import { askText, AskTextHost } from './components/AskText';
import { TOOL_DRAG_TYPE, ToolChestPanel } from './components/ToolChest';
import { SignaturesPanel } from './components/SignaturesPanel';
import { ColumnsDialog } from './components/ColumnsDialog';
import { ExportDialog, type ExportRequest } from './components/ExportDialog';
import { ProfilesDialog } from './components/ProfilesDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { settings, useSettings } from './settings/settings';
import { buildRows, listColumns, resolveLayout, rowsToCsv, type CellContext, type ListColumn, type ListRowData } from './columns/listColumns';
import { addToToolSet, createToolSet, DEFAULT_TOOLBAR_TOOLS, profiles, RECENT_TOOLS_ID, rememberRecentTool, stampLibrary, updateWorkspace, useProfiles, useWorkspace, type ToolChestItem } from './workspace/profiles';
import { documentDigest, signatures, type SavedSignature } from './signatures/signatures';
import { TextEditor } from './components/TextEditor';
import { setTemplate } from './storage/fileStore';
import { attachmentBlob, fileToAttachment, imageToDataUrl, pickAttachment, pickImage } from './markup/pickImage';
import { SoundDialog } from './components/SoundDialog';
import { UndoHistoryDialog } from './components/UndoHistoryDialog';
import { invertAffine, mapBox } from './compare/affine';
import { SpellCheckDialog } from './components/SpellCheckDialog';
import { WhatsNewDialog } from './components/WhatsNewDialog';
import { PublishDialog, type PublishRequest } from './components/PublishDialog';
import { CameraDialog } from './components/CameraDialog';
import { ApplyRedactionsDialog, contrastOn, type RedactOptions } from './components/ApplyRedactionsDialog';
import type { ExportOptions } from '@nb/markup/export';
import type { PdfLayer } from './documents/layers';
import { logFile } from './help/logs';
import { PROJECT_URL } from './help/whatsNew';
import { BookmarksPanel, type ViewTarget } from './components/BookmarksPanel';
import { HyperlinkDialog } from './components/HyperlinkDialog';
import { PrintDialog } from './components/PrintDialog';
import { SpacesPanel } from './components/SpacesPanel';
import { SketchBar } from './components/SketchBar';
import { GEOMETRY_TYPES } from './components/ShapeGeometry';
import { PageToolsDialog, type PageToolKind, type PageToolSpec } from './components/PageToolsDialog';
import { HeaderFooterDialog } from './components/HeaderFooterDialog';
import { PROCESS_TITLES, ProcessDialog, type ProcessKind, type ProcessSpec } from './components/ProcessDialog';
import { OcrDialog } from './components/OcrDialog';
import { CompareDialog, type ComparePairing, type CompareSpec } from './components/CompareDialog';
import type { OverlayPageSpec } from './documents/overlay';
import type { PagePair } from './compare/pairing';
import { SlipSheetDialog, type SlipSheetSpec } from './components/SlipSheetDialog';
import { RevisionsDialog } from './components/RevisionsDialog';
import { SetsPanel } from './components/SetsPanel';
import { SecurityDialog } from './components/SecurityDialog';
import { DigitalIdsDialog, DigitalSignaturesSection, SignDialog, type SignChoice } from './components/DigitalSignatures';
import { digitalIds, type DigitalIdRecord } from './documents/digitalIds';
import type { SignatureCheck } from './documents/pdfSign';
import { FormsPanel, type NewFieldType } from './components/FormsPanel';
import { FieldEditor } from './components/FieldEditor';
import type { FieldChanges, FormField, FormModel } from './documents/forms';
import { BatchDialog, BATCH_LABELS, type BatchKind, type BatchResult, type BatchSpec } from './components/BatchDialog';
import { drawingSets } from './storage/sets';
import { fileGroups } from './storage/fileGroups';
import { CompareResultsPanel, type CompareResults, type CompareStop } from './components/CompareResultsPanel';
import { JobsBar } from './components/JobsBar';
import { isAbort, runJob, startJob, useJobRunning, type JobContext } from './jobs/jobs';
import { VisualSearchPanel, type VisualSearchAction, type VisualSearchHit } from './components/VisualSearchPanel';
import { MARKUP_TOOLS, MEASURE_TOOLS, ToolBar, toolShortcut } from './components/ToolBar';
import { buildCommands, type Command, type CommandActions } from './commands/appCommands';
import { comboOf, keyMap } from './commands/keys';
import { shortcutLabel } from './commands/shortcuts';
import { ContextMenu, SEP, type ContextMenuState, type MenuEntry } from './components/ContextMenu';
import { CommentDialog } from './components/CommentDialog';
import { MultiplyDialog } from './components/MultiplyDialog';
import { ChangeColoursDialog } from './components/ChangeColoursDialog';
import { MENU_ICONS } from './components/menuIcons';
import { parsePageRange } from './sheets/regions';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { StampsDialog } from './components/StampsDialog';
import { NewPdfDialog } from './components/NewPdfDialog';
import { CombineDialog, type CombineSource } from './components/CombineDialog';
import { DocumentPropertiesDialog } from './components/DocumentPropertiesDialog';
import { imageToPdf, isImageFile } from './documents/imagePdf';
import { setDocumentInfo, type EditableInfo } from './documents/docInfo';
import { LabelRegionsPanel } from './components/LabelRegionsPanel';
import { ScaleRegionsPanel } from './components/ScaleRegionsPanel';
import type { Region } from './sheets/regions';
import type { PageText, SheetInfo } from '@nb/sheets';
import type { IncomingPage } from './documents/slipSheet';
import { migrateLegacyToolSets } from './toolchest/toolSets';
import { CalibrateDialog } from './components/CalibrateDialog';
import { ScaleControl } from './components/ScaleControl';
import { PagesPanel } from './components/PagesPanel';
import { SearchPanel } from './components/SearchPanel';
import { MenuBar, LEFT_TITLES, type BottomTab, type LeftTab } from './components/MenuBar';
import { PageNav } from './components/PageNav';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SessionsPanel } from './components/SessionsPanel';
import { ProjectsPanel, type UploadProgress } from './components/ProjectsPanel';
import { idFromText, onProjectOpened, openProject, openProjects, projectAuthor, projectById } from './studio/projects/store';
import { isUnreachable, noteText, projectQueue } from './studio/projects/queue';
import { knownProjects, libraryCopyOf, linkOf, setLink } from './studio/projects/local';
import type { Project } from './studio/projects/Project';
import type { ProjectFile } from './studio/projects/model';
import { EndSessionDialog, type DocumentSource, type EndProgress, type EndSessionChoice, type StartRequest } from './components/sessions/SessionDialogs';
import { InviteDialog } from './components/sessions/InviteDialog';
import { forgetSession as forgetRoundtrip, rememberSource, sourceOf } from './studio/roundtrip';
import {
  FlagsPanel,
  LayersPanel,
  MeasurementsPanel,
} from './components/SidePanels';
import type { SearchHit } from '@nb/sheets';
import { LinksPanel } from './components/LinksPanel';
import { forgetText, fromOtherTools, importPdfAnnotations, readPdfAnnotations, indexFromText, linkFromText, loadPageTexts, stitchFromText, type IndexProgress } from './sheets/indexer';
import { requireOnline } from './offline/network';
import { updateGate } from './offline/updates';
import { InstallDialog } from './components/InstallDialog';
import { canPromptInstall, promptInstall } from './offline/install';
import { droppedPdfs, handleOf, pickFilesToOpen, recallHandle, rememberHandle, saveAsWithPicker, writeToHandle } from './storage/diskHandles';
import { consumeLaunchFiles, parseLaunch, stripLaunchQuery, takeSharedFiles } from './offline/launch';
import { addBusyCheck } from './offline/updates';
import { runningJobs } from './jobs/jobs';

interface Controllers {
  engine: PdfEngine;
  viewer: TileViewer;
  tools: MarkupTools;
}

interface OpenFile {
  file: StoredFile;
  doc: PdfDocument;
  store: MarkupStore;
}

/** What each open document looked like when it was opened or last saved, to tell if it has unsaved changes. */
const savedState = new WeakMap<MarkupStore, { edits: number; hash: string }>();
function markSaved(t: OpenFile) {
  savedState.set(t.store, { edits: t.store.editCount, hash: t.file.hash });
}
function hasUnsavedChanges(t: OpenFile) {
  let base = savedState.get(t.store);
  if (!base) {
    markSaved(t);
    base = savedState.get(t.store)!;
  }
  return t.store.editCount !== base.edits || t.file.hash !== base.hash;
}

/** A tab's file name, followed by * when the document has changes that are not saved to its file. */
function TabName({ t, saved }: { t: OpenFile; saved: number }) {
  void saved;
  useSyncExternalStore(
    (l) => t.store.subscribe(l),
    () => t.store.editCount,
  );
  return <span className="name">{t.file.name}{!studioDocOf(t.file.id) && hasUnsavedChanges(t) ? '*' : ''}</span>;
}

const AUTHOR_KEY = 'nb.author';

function loadAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) || 'Me';
  } catch {
    return 'Me';
  }
}

/** Asks which template to start from. */
async function pickTemplate(templates: readonly StoredFile[]): Promise<StoredFile | null> {
  const id = await askText('New PDF from Template', templates[0]!.id, { label: 'Start from which template?', confirm: 'Next', choices: templates.map((t) => ({ value: t.id, label: t.name })) });
  return templates.find((t) => t.id === id) ?? null;
}

/** Asks the user for one file of the given types; null if they cancel. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Opens a file attachment's file in a new tab when the browser can show it, else saves it. */
function openAttachment(m: Markup) {
  const a = m.attachment;
  if (!a) return;
  const blob = attachmentBlob(a);
  if (/^(application\/pdf|image\/|text\/plain|audio\/|video\/)/.test(a.mime)) {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (win) return;
  }
  download(a.name, blob);
}

/** Turns markups by `degrees` (or to it, with `absolute`), locked ones excepted, as one undo step. */
function turnMarkups(store: MarkupStore, ms: readonly Markup[], degrees: number, absolute = false) {
  store.checkpoint();
  store.batch(() => {
    for (const m of ms) {
      if (m.locked || !store.mayEdit(m)) continue;
      const next = ((((absolute ? 0 : (m.rotation ?? 0)) + degrees) % 360) + 360) % 360;
      store.update(m.id, { rotation: next || undefined });
    }
  });
}

/** Text written to the system clipboard when markups are copied, so pasting knows they are ours. */
const MARKUP_CLIP = 'redcolumn markups';

function download(name: string, blob: Blob) {
  // Browsers with the File System Access API show a Save As dialog; others download.
  void saveAsWithPicker(name, blob.type, blob).then((r) => {
    if (r === 'unsupported') anchorDownload(name, blob);
  });
}

function anchorDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Stops PDFium drawing annotations that were imported as editable markups. */
async function hideImported(doc: PdfDocument, store: MarkupStore) {
  await Promise.all(Object.entries(store.importedAnnotations()).map(([page, indices]) => doc.hideAnnotations(Number(page), indices)));
}

/** Library-style ids for documents opened from a Live Session: `studio:<session>:<doc>`. */
function studioFileId(sessionId: string, docId: string) {
  return `studio:${sessionId}:${docId}`;
}

function studioDocOf(fileId: string | undefined): { sessionId: string; docId: string } | null {
  const m = fileId ? /^studio:([^:]+):(.+)$/.exec(fileId) : null;
  return m ? { sessionId: m[1]!, docId: m[2]! } : null;
}

const STUDIO_HASHES = 'nb.studio.docs';

/** Where a session document's bytes are cached on this device, so it reopens offline. */
function cachedStudioHash(fileId: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(STUDIO_HASHES) ?? '{}') as Record<string, string>)[fileId] ?? null;
  } catch {
    return null;
  }
}

function rememberStudioHash(fileId: string, hash: string) {
  try {
    const map = JSON.parse(localStorage.getItem(STUDIO_HASHES) ?? '{}') as Record<string, string>;
    localStorage.setItem(STUDIO_HASHES, JSON.stringify({ ...map, [fileId]: hash }));
  } catch {
    // Not cached; the document is downloaded again next time.
  }
}

const noSubscribe = () => () => {};

/** Values new markups start with in the document's custom columns. */
function defaultFieldsFor(store: MarkupStore | undefined): Record<string, string> | undefined {
  const cols = store?.columnSet().columns ?? [];
  const fields = cols.filter((c) => c.defaultValue && c.type !== 'formula').map((c) => [c.id, c.defaultValue!] as const);
  return fields.length ? Object.fromEntries(fields) : undefined;
}

/** A markup, with the rest of its group, saved as a Tool Library tool: its look, and the markups themselves so the tool can place exact copies. */
function toolChestItemOf(group: Markup | readonly Markup[], store?: MarkupStore | null): Omit<ToolChestItem, 'id'> {
  const ms = Array.isArray(group) ? [...(group as readonly Markup[])] : [group as Markup];
  ms.sort((x, y) => x.createdAt - y.createdAt);
  const m = ms[0]!;
  const b = boundsOf(ms.flatMap((x) => x.points));
  const templates: Markup[] = ms.map((x) => ({ ...structuredClone(x), id: '', pageIndex: 0, ...moved(x, -b.x, -b.y), status: 'none', author: '', createdAt: 0, modifiedAt: 0 }));
  const snippet = isTextType(m.type) && m.text?.trim() ? m.text.trim().split('\n')[0]!.slice(0, 40) : '';
  return {
    type: m.type,
    style: m.style,
    label: m.subject || snippet || MARKUP_LABELS[m.type],
    ...(m.subject ? { subject: m.subject } : {}),
    ...(m.image ? { image: m.image } : {}),
    markups: templates,
    // The page scale it was drawn at, so sets that scale to the page keep its real size.
    ...(store?.hasScale(m.pageIndex) ? { metersPerPoint: store.scaleOf(m).metersPerPoint } : {}),
  };
}

/** Markups as Tool Library tools: the members of a group (a Cloud+, say) become one tool, not one each. */
function toolChestItemsOf(ms: readonly Markup[], store?: MarkupStore | null): Omit<ToolChestItem, 'id'>[] {
  const groups = new Map<string, Markup[]>();
  const items: Omit<ToolChestItem, 'id'>[] = [];
  const order: (Markup | string)[] = [];
  for (const m of ms) {
    if (!m.groupId) order.push(m);
    else if (groups.has(m.groupId)) groups.get(m.groupId)!.push(m);
    else {
      groups.set(m.groupId, [m]);
      order.push(m.groupId);
    }
  }
  for (const o of order) items.push(toolChestItemOf(typeof o === 'string' ? groups.get(o)! : o, store));
  return items;
}

// Tool sets imported by earlier versions join the active profile's Tool Library.
migrateLegacyToolSets();

/** The stamp the Stamp tool places when none is picked: the last one used, else the first. */
function lastStamp(): StampDef {
  const ws = profiles.active().state;
  const library = stampLibrary(ws);
  return library.find((s) => s.id === ws.lastStampId) ?? library[0]!;
}

/** A stamp's {File} and {Page}: the document's name and the page's sheet number (or page number). */
function stampValuesFor(o: OpenFile | null, pageIndex: number): { file: string; page: string } {
  return { file: o?.file.name ?? '', page: o?.store.allSheets()[pageIndex]?.number ?? String(pageIndex + 1) };
}

/** Recent Tools: every look the user draws with (signatures and images excepted: they need their picture). */
function recordRecent(m: Markup) {
  if (isImageType(m.type)) return;
  rememberRecentTool({ type: m.type, style: m.style, label: m.subject || MARKUP_LABELS[m.type], ...(m.subject ? { subject: m.subject } : {}) });
}

/** A revision's time for a file name: 2026-09-29 0758 (local time, no characters files can't have). */
function revisionStamp(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

/** A page's name in lists: its sheet number and title, else its page number. */
function pageLabelFor(o: OpenFile | null, pageIndex: number): string {
  const sheet = o?.store.allSheets()[pageIndex];
  return sheet?.number ? `${sheet.number}${sheet.title ? ` ${sheet.title}` : ''}` : `Page ${pageIndex + 1}`;
}

/** The PDF's outline as bookmarks (entries without a destination here go to the first page). */
function outlineBookmarks(items: readonly OutlineItem[]): Bookmark[] {
  return items.map((o) => ({ id: crypto.randomUUID(), title: o.title, pageIndex: o.pageIndex ?? 0, rect: o.rect, ...(o.zoom ? { zoom: o.zoom } : {}), children: outlineBookmarks(o.children) }));
}

/**
 * Zooms in on a markup so it fills about half the view. Small ones (a count, a note) get a
 * minimum area, so the drawing around them still shows rather than zooming all the way in.
 */
function zoomToMarkup(viewer: TileViewer, m: Markup) {
  const b = boundsOf(m.points);
  const size = viewer.pageSize(m.pageIndex);
  const min = Math.max(48, 0.04 * Math.max(size?.width ?? 0, size?.height ?? 0));
  const w = Math.max(b.w, min);
  const h = Math.max(b.h, min);
  viewer.zoomToRect({ x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }, 2, m.pageIndex);
}

/** The page area a viewer shows (the whole page when it all fits). */
function visibleView(viewer: TileViewer, canvas: HTMLCanvasElement | null): ViewTarget {
  const pageIndex = viewer.getView().pageIndex;
  const size = viewer.pageSize(pageIndex);
  if (!canvas || !size) return { pageIndex, rect: null };
  const r = canvas.getBoundingClientRect();
  const corners = [viewer.clientToPage(r.left, r.top, pageIndex), viewer.clientToPage(r.right, r.top, pageIndex), viewer.clientToPage(r.left, r.bottom, pageIndex), viewer.clientToPage(r.right, r.bottom, pageIndex)];
  const x0 = Math.max(0, Math.min(...corners.map((c) => c[0])));
  const y0 = Math.max(0, Math.min(...corners.map((c) => c[1])));
  const x1 = Math.min(size.width, Math.max(...corners.map((c) => c[0])));
  const y1 = Math.min(size.height, Math.max(...corners.map((c) => c[1])));
  // Most of the page in view: just the page.
  if ((x1 - x0) * (y1 - y0) > size.width * size.height * 0.8 || x1 <= x0 || y1 <= y0) return { pageIndex, rect: null };
  return { pageIndex, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** A JPEG re-encoded at `quality` through a canvas; null if the browser cannot decode it. */
/**
 * Certificate services (time stamp servers, OCSP responders, revocation lists), reached straight from
 * the browser. Many do not allow that (CORS); then the step fails with a clear reason and signing or
 * validating carries on without it.
 */
async function pkiFetch(url: string, body?: Uint8Array, type?: string): Promise<Uint8Array> {
  requireOnline('Time stamps and revocation checks');
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, body ? { method: 'POST', body: body as BodyInit, headers: { 'content-type': type ?? 'application/octet-stream' } } : {});
  } catch {
    throw new Error(`${host} cannot be reached from the browser (many certificate services do not allow it)`);
  }
  if (!res.ok) throw new Error(`${host} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Tablets upright and phones, where side panels are drawers over the drawing (see offline.css). */
const narrowScreen = () => !!window.matchMedia?.('(max-width: 1000px)').matches;

/** Progress within one of `count` steps of a job, as part of the whole. */
const partOf = (ctx: JobContext, step: number, count: number, label: string): JobContext => ({
  signal: ctx.signal,
  progress: (done, total, status) => ctx.progress(step * 1000 + (total ? (done / total) * 1000 : 0), count * 1000, `${label}: ${status ?? ''}`),
});

/** The pages of two documents to compare or overlay, as the dialog (or a batch) chose them. */
function pairsFor(
  pairing: ComparePairing,
  o: OpenFile,
  n: OpenFile,
  labels: (x: OpenFile) => (string | null)[],
  pairPages: (a: (string | null)[], b: (string | null)[], bySheet: boolean) => PagePair[],
): PagePair[] {
  const fit = (p: PagePair) => ({ oldPage: Math.min(p.oldPage, o.doc.pages.length - 1), newPage: Math.min(p.newPage, n.doc.pages.length - 1) });
  if (pairing.kind === 'one') return [fit(pairing)];
  if (pairing.kind === 'list') return pairing.pairs.filter((p) => p.oldPage < o.doc.pages.length && p.newPage < n.doc.pages.length);
  return pairPages(labels(o), labels(n), pairing.kind === 'sheet');
}

/** A JPEG picture made grey, or black and white, through a canvas. */
async function recolourJpeg(jpeg: Uint8Array, mode: 'grayscale' | 'black'): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let v = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
      if (mode === 'black') v = v > 242 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

async function recompressJpeg(jpeg: Uint8Array, quality: number): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** The document with its markups written as PDF annotations. */
async function annotatedBytes(
  cur: OpenFile,
  options: { links?: boolean; markups?: readonly Markup[]; embedFont?: ExportOptions['embedFont'] } = {},
): Promise<Uint8Array> {
  // pdf-lib is only needed here; load it on demand (the service worker still precaches it).
  const { exportWithAnnotations } = await import('@nb/markup/export');
  return exportWithAnnotations(await readFile(cur.file.hash), options.markups ?? cur.store.all(), {
    ...(options.embedFont ? { embedFont: options.embedFont } : {}),
    scaleFor: (i) => cur.store.scaleFor(i),
    viewports: cur.store.allViewports(),
    links: options.links === false ? [] : cur.store.allLinks(),
    imported: cur.store.importedAnnotations(),
    importedSpaces: cur.store.importedSpaces(),
    pageScales: cur.store.allScales(),
    columns: cur.store.columnSet().columns,
    statuses: cur.store.columnSet().statuses,
    places: cur.store.places(),
    // Sheet numbers become the PDF's page labels, so other readers show them too.
    pageLabels: cur.doc.pages.map((_, i) => cur.store.allSheets()[i]?.number || null),
    // Until the file's own outline has been read in, leave it as it is.
    ...(cur.store.outlineImported() ? { bookmarks: cur.store.bookmarks() } : {}),
  });
}

/**
 * The PDF a Project check-in uploads: the library copy's file as it is. Its markups are not written
 * in, as they are shared live already (as in a Live Session) and would otherwise come back twice.
 */
async function projectCopyBytes(libraryId: string): Promise<ArrayBuffer> {
  const file = (await listFiles()).find((f) => f.id === libraryId);
  if (!file) throw new Error('Your copy is no longer in the library.');
  return readFile(file.hash);
}

type Pane = 'a' | 'b';

const TABS_KEY = 'nb.tabs';

/** The library documents open in tabs, reopened on the next visit (session documents rejoin with their session). */
function savedTabs(): { ids: string[]; active: string | null } {
  try {
    return (JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null') as { ids: string[]; active: string | null } | null) ?? { ids: [], active: null };
  } catch {
    return { ids: [], active: null };
  }
}

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/** Re-renders whenever any of the joined sessions changes, and returns their snapshots. */
function useSnapshots(sessions: CollabSession[]): StudioSnapshot[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const offs = sessions.map((s) => s.subscribe(bump));
    return () => offs.forEach((off) => off());
  }, [sessions]);
  return sessions.map((s) => s.getSnapshot());
}

const driveApi = new GoogleDrive();
/** Signs in with Google: Drive access plus who the person is (their email identifies them in sessions). */
const authorizeGoogle = async () => {
  await signInWithGoogle();
};
const googleEmail = () => googleUser()?.email ?? null;
const oneDriveApi = new OneDrive();
/** Signs in with Microsoft: OneDrive access plus who the person is. */
const authorizeMicrosoft = async () => {
  await signInWithMicrosoft();
};
const microsoftEmail = () => microsoftUser()?.email ?? null;

function readOnlyReason(o: OpenFile, snaps: readonly StudioSnapshot[]): string {
  const doc = studioDocOf(o.file.id);
  const snap = doc ? snaps.find((s) => s.meta.id === doc.sessionId) : undefined;
  if (!doc || !snap) return 'Read-only: join its Live Session to markup this document.';
  if (snap.denied) return 'Read-only: the host has removed your access to this session.';
  if (snap.removed || snap.meta.ended) return 'Read-only: the host ended this Live Session and removed its files.';
  if (snap.meta.status === 'finished') return 'Read-only: this Live Session has closed.';
  if (snap.viewOnly) return 'Read-only: the session folder is shared with you view-only.';
  if (myAccess(snap) === 'view') return 'Read-only: you have view access in this session.';
  return 'Read-only: the session host has locked markups.';
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Drag data for reordering document tabs. */
const TAB_DRAG_TYPE = 'application/x-nb-tab';

const INDEX_PHASES: Record<IndexProgress['phase'], string> = { annotations: 'Importing markups', text: 'Reading text', links: 'Finding links', stitch: 'Stitching sheets' };

/** Jobs that rewrite a document's pages; while one runs, page operations are turned off. */
const PAGES_JOB = { kind: 'pages', cancellable: false } as const;

/**
 * Whether to go on with `what`, which writes the file again rather than appending to it: always
 * for an unsigned file; for a signed one only if the user accepts that its signatures break.
 */
async function rewriteSigned(doc: PdfDocument, what: string): Promise<boolean> {
  const { signatures } = await doc.info();
  return !signatures || confirm(`This file is digitally signed. ${what} writes the file again, so its ${signatures === 1 ? 'signature' : `${signatures} signatures`} will no longer be valid. Continue?`);
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const [ctl, setCtl] = useState<Controllers | null>(null);
  const [ctlB, setCtlB] = useState<{ viewer: TileViewer; tools: MarkupTools } | null>(null);
  const prefs = useSettings();
  // Preference changes apply to the open panes straight away (new panes read them on creation).
  const ctlsRef = useRef<(MarkupTools | undefined)[]>([]);
  ctlsRef.current = [ctl?.tools, ctlB?.tools];
  useEffect(() => ctlsRef.current.forEach((t) => t?.setSnap(prefs.snapToGeometry)), [prefs.snapToGeometry]);
  useEffect(() => ctlsRef.current.forEach((t) => t?.setShowLinks(prefs.showHyperlinks)), [prefs.showHyperlinks]);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const openRef = useRef<OpenFile | null>(null);
  const [openB, setOpenB] = useState<OpenFile | null>(null);
  const openBRef = useRef<OpenFile | null>(null);
  /** Every document open in each pane, shown as tabs; `open`/`openB` is the one in front. */
  const [tabsA, setTabsA] = useState<OpenFile[]>([]);
  /** Counts Projects opened, so what depends on the open Projects runs again. */
  const [projectsOpened, setProjectsOpened] = useState(0);
  const tabsARef = useRef<OpenFile[]>([]);
  const [tabsB, setTabsB] = useState<OpenFile[]>([]);
  const tabsBRef = useRef<OpenFile[]>([]);
  /** Where each tab was scrolled to, restored when it comes back to the front. */
  const savedViews = useRef(new Map<string, ViewState>());
  const [library, setLibrary] = useState<StoredFile[]>([]);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [statsB, setStatsB] = useState<ViewerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A passing confirmation (e.g. how many pages were labelled); clears itself. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const [dragOver, setDragOver] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<{ pageIndex: number; lengthPoints: number; at: [number, number] } | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('files');
  const [leftOpen, setLeftOpen] = useState(() => !narrowScreen());
  const [leftWidth, setLeftWidth] = useState(250);
  // The rail names its panels (Thumbnails, File Access...) until the user collapses it to icons.
  const [railLabels, setRailLabels] = useState(() => {
    try {
      return localStorage.getItem('nb.railLabels') !== '0';
    } catch {
      return true;
    }
  });
  const toggleRailLabels = () =>
    setRailLabels((on) => {
      try {
        localStorage.setItem('nb.railLabels', on ? '0' : '1');
      } catch {
        /* storage off limits: the choice lasts for this session */
      }
      return !on;
    });
  const ws = useWorkspace();
  const { profiles: profileList, activeId: activeProfileId } = useProfiles();
  const showTools = ws.showToolbar;
  const toggleToolbar = () => updateWorkspace((w) => ({ ...w, showToolbar: !w.showToolbar }));
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const [railDrag, setRailDrag] = useState<{ id: LeftTab; over: LeftTab | null; after: boolean } | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState<{ rows: ListRowData[]; columns: ListColumn[] } | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const exportBusy = useJobRunning('export');
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [docDigest, setDocDigest] = useState<string | null>(null);
  // On a phone the Markups list is a drawer over the drawing, so it starts closed there.
  const [showBottom, setShowBottom] = useState(() => !window.matchMedia?.('(max-width: 720px)').matches);
  const [bottomTab, setBottomTab] = useState<BottomTab>('markups');
  const [dockHeight, setDockHeight] = useState(180);
  const [split, setSplit] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  /** Split Horizontal: the second pane below the first rather than beside it. */
  const [splitHorizontal, setSplitHorizontal] = useState(false);
  /** Synchronised panes: both show the same page number ('document') or keep their page offset ('page'). */
  const [sync, setSync] = useState<'document' | 'page' | null>(null);
  /** Side-by-Side (two pages per row) and Show Cover Page, in both panes. */
  const [spread, setSpread] = useState<{ columns: 1 | 2; cover: boolean }>({ columns: 1, cover: false });
  const [magnifier, setMagnifier] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [undoHistoryOpen, setUndoHistoryOpen] = useState(false);
  const [spellOpen, setSpellOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [redactFor, setRedactFor] = useState<{ pane: Pane; count: number } | null>(null);
  /** Each document's PDF layers (by contents hash), and the ones hidden (by document id). */
  const [pdfLayers, setPdfLayers] = useState<Record<string, PdfLayer[]>>({});
  const [hiddenPdfLayers, setHiddenPdfLayers] = useState<Record<string, string[]>>({});
  /** Markup layers switched off, by document id ('' is markups on no layer). */
  const [hiddenMarkupLayers, setHiddenMarkupLayers] = useState<Record<string, string[]>>({});
  const [publishFor, setPublishFor] = useState<'pdf' | 'images' | null>(null);
  const publishing = useJobRunning('publish');
  // A newer version of the app is ready (the service worker found one). It loads by itself once
  // nothing is in progress (src/offline/updates.ts); until then the notice says what it waits for.
  const updateWaitingFor = useRef('');
  useEffect(() => {
    const ready = (e: Event) => {
      const reasons = ((e as CustomEvent<string[]>).detail ?? []).join(', ');
      if (!reasons || reasons === updateWaitingFor.current) return;
      updateWaitingFor.current = reasons;
      setNotice(`A new version of redcolumn is ready. It loads when you are done (${reasons}); Help › Check for Updates loads it now.`);
    };
    window.addEventListener('nb-update-ready', ready);
    return () => window.removeEventListener('nb-update-ready', ready);
  }, []);
  const [installOpen, setInstallOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [activePane, setActivePane] = useState<'a' | 'b'>('a');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [headerFooter, setHeaderFooter] = useState<{ mode: 'headerFooter' | 'number'; hasExisting: boolean } | null>(null);
  const [processKind, setProcessKind] = useState<ProcessKind | null>(null);
  /** OCR dialog, with the pages that have no text. */
  const [ocrFor, setOcrFor] = useState<number[] | null>(null);
  const [compareOpen, setCompareOpen] = useState<'compare' | 'overlay' | null>(null);
  const [slipSheetOpen, setSlipSheetOpen] = useState(false);
  const [indexingSets, setIndexingSets] = useState(false);
  const [batchOpen, setBatchOpen] = useState<BatchKind | null>(null);
  /** The revision of each session document open in a tab, to reload it when the host updates it. */
  const loadedVersions = useRef(new Map<string, number>());
  const [endFor, setEndFor] = useState<{ sessionId: string; authors: string[] } | null>(null);
  const [endProgress, setEndProgress] = useState<EndProgress | null>(null);
  // Email invitations to a session.
  const [inviteSession, setInviteSession] = useState<string | null>(null);
  // Bookmarks › Action…: the bookmark whose action is being set.
  const [bookmarkAction, setBookmarkAction] = useState<string | null>(null);
  // Symbol Search › Hyperlinks…: the copies found, waiting for where their links go.
  const [vsLinks, setVsLinks] = useState<{ pane: Pane; hits: VisualSearchHit[] } | null>(null);
  const [markupAlert, setMarkupAlert] = useState<{ sessionId: string; entry: RecordEntry } | null>(null);
  const seenAlerts = useRef<Set<string> | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  /** Checked digital signatures, by the hash of the document's contents. */
  const [sigChecks, setSigChecks] = useState<Record<string, SignatureCheck[]>>({});
  const [idList, setIdList] = useState<DigitalIdRecord[]>(() => digitalIds.list());
  const [trustedCerts, setTrustedCerts] = useState<string[]>(() => digitalIds.trusted());
  const [idsOpen, setIdsOpen] = useState(false);
  const [signFor, setSignFor] = useState<{ fieldName: string | null } | null>(null);
  /** Signing waits for its box to be drawn on the page. */
  const pendingSign = useRef<SignChoice | null>(null);
  /** The library document whose kept revisions are listed. */
  const [revisionsOf, setRevisionsOf] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<(CompareResults & { oldId: string; newId: string }) | null>(null);
  /** Library files being opened, so a double click opens them once. */
  const openingFiles = useRef(new Map<string, Promise<void>>());
  const openSetSheetRef = useRef<(fileId: string, page: number) => Promise<void>>(async () => {});
  const sideBySideRef = useRef<(oldId: string, newId: string) => Promise<void>>(async () => {});
  /** An open page tool dialog; crop keeps a rectangle drawn on the page. */
  const [pageTool, setPageTool] = useState<{ kind: PageToolKind; drawnRect: { x: number; y: number; w: number; h: number } | null } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);
  /** The current commands by id, for the keyboard handler (rebuilt every render). */
  const commandsRef = useRef<ReadonlyMap<string, Command>>(new Map());
  const [prefsOpen, setPrefsOpen] = useState(false);
  const pendingSplit = useRef<File | null>(null);
  /** A library file or a tab waiting for the right pane to exist (Open in Split View, Move to Right Pane). */
  const pendingSplitStored = useRef<{ file: StoredFile; bytes: ArrayBuffer } | null>(null);
  const pendingMove = useRef<OpenFile | null>(null);
  const moveTabRef = useRef<(from: Pane, t: OpenFile) => void>(() => {});
  const canvasMenuRef = useRef<(e: MouseEvent, pane: Pane) => void>(() => {});
  /** Where the pointer last was over a page, for pasting at the cursor. */
  const lastPointer = useRef<{ x: number; y: number; viewer: TileViewer } | null>(null);
  /** Markups copied or cut, pasted into any open document. */
  const clipboard = useRef<Markup[]>([]);
  /** How many markups are on the clipboard; state so menus and shortcuts see copies at once. */
  const [clipboardCount, setClipboardCount] = useState(0);
  const [commentEdit, setCommentEdit] = useState<{ pane: Pane; id: string } | null>(null);
  const [hyperlinkEdit, setHyperlinkEdit] = useState<{ pane: Pane; id: string } | null>(null);
  /** Symbol Search: the symbol box the user drew, and in which pane. */
  const [visualSearchBox, setVisualSearchBox] = useState<{ pane: Pane; pageIndex: number; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  const followHyperlinkRef = useRef<(m: Markup) => void>(() => {});
  const eraseRef = useRef<(pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void>(() => {});
  const editTextRef = useRef<(pageIndex: number, at: [number, number]) => void>(() => {});
  const formFieldRef = useRef<(pane: Pane, w: FormWidgetHit) => void>(() => {});
  const editLabelRef = useRef<(pane: Pane, id: string) => void>(() => {});
  const snapshotRef = useRef<(pane: Pane, pageIndex: number, rect: { x: number; y: number; w: number; h: number }, withMarkups?: boolean) => Promise<void>>(async () => {});
  const pasteImageRef = useRef<(file: Blob) => void>(() => {});
  /** The markups the Markups list's filter keeps (null: not filtering). */
  const [listKept, setListKept] = useState<ReadonlySet<string> | null>(null);
  /** The Markups list's Hide All: no markup is drawn on the page (they stay in the list and the file). */
  const [allMarkupsHidden, setAllMarkupsHidden] = useState(false);
  const toggleAllMarkupsHidden = useCallback(() => setAllMarkupsHidden((h) => !h), []);
  const formDrawnRef = useRef<(pane: Pane, pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void>(() => {});
  /** Each document's form, by the hash of its contents (re-read after every change). */
  const [formModels, setFormModels] = useState<Record<string, FormModel>>({});
  const [formFieldEdit, setFormFieldEdit] = useState<{ pane: Pane; name: string; widget: number } | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [newFieldType, setNewFieldType] = useState<NewFieldType>('text');
  const formBusy = useJobRunning('form');
  /** A Space was just drawn: ask for its name. */
  const nameSpaceRef = useRef<(o: OpenFile | null, id: string) => void>(() => {});
  nameSpaceRef.current = (o, id) => {
    if (!o) return;
    const n = o.store.all().filter((m) => m.type === 'space').length;
    void askText('Name the Space', `Space ${n}`, { label: 'Name', confirm: 'Save' }).then((name) => {
      if (name?.trim()) o.store.update(id, { subject: name.trim() });
    });
  };
  /** The markup a reply is being written to. */
  const [replyTo, setReplyTo] = useState<{ pane: Pane; id: string } | null>(null);
  /** Edit → Multiply is open for this pane's selection. */
  const [multiplyFor, setMultiplyFor] = useState<Pane | null>(null);
  /** Right-click › Change Colours: the markups whose colours are being changed. */
  const [changeColoursFor, setChangeColoursFor] = useState<{ pane: Pane; ids: string[] } | null>(null);
  /** Right-click › Capture › View Capture: the picture shown. */
  const [captureView, setCaptureView] = useState<string | null>(null);
  /** File → New PDF, or Document → Insert → Blank Pages. */
  const [blankPdf, setBlankPdf] = useState<'new' | 'blank' | null>(null);
  const [combineOpen, setCombineOpen] = useState(false);
  const [docPropsOpen, setDocPropsOpen] = useState(false);
  const [revealFile, setRevealFile] = useState<{ id: string; token: number } | null>(null);
  const [startSession, setStartSession] = useState<{ token: number; fileIds: string[] } | null>(null);
  /** Page labels from regions: the boxes drawn, on which pane's document, and its page text. */
  const [labelMode, setLabelMode] = useState<{ pane: Pane; regions: Region[]; kind: 'label' | 'scale' } | null>(null);
  const [labelTexts, setLabelTexts] = useState<PageText[] | null>(null);
  const regionRef = useRef<(rect: Region) => void>(() => {});
  const [searchFocus, setSearchFocus] = useState(0);
  const busyPages = useJobRunning('pages');
  const searchHits = useRef<SearchHit[]>([]);
  const indexing = useJobRunning('index');
  const indexAbort = useRef<AbortController | null>(null);
  const openFileRef = useRef<HTMLInputElement>(null);
  const insertFileRef = useRef<HTMLInputElement>(null);
  const splitFileRef = useRef<HTMLInputElement>(null);
  /** Views to return to after following hyperlinks (Alt+Left). */
  const history = useRef<ViewState[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);
  /** Views Back left behind, for Forward (Alt+Right); cleared by any new navigation. */
  const future = useRef<ViewState[]>([]);
  const [canGoForward, setCanGoForward] = useState(false);
  const followLinkRef = useRef<(link: StoredLink) => void>(() => {});
  const viewportRef = useRef<(pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void>(() => {});
  const [author, setAuthor] = useState(loadAuthor);
  const authorRef = useRef(author);
  authorRef.current = author;
  // Recorded with every status change, in each document's status history.
  MarkupStore.author = author;
  const activePaneRef = useRef(activePane);
  activePaneRef.current = activePane;
  /** Every Live Session this browser is in; documents from several can be open at once. */
  const [sessions, setSessions] = useState<CollabSession[]>([]);
  const sessionsRef = useRef<CollabSession[]>([]);
  sessionsRef.current = sessions;
  const sessionById = (id: string) => sessionsRef.current.find((s) => s.id === id) ?? null;
  /** The session shown in detail on the Sessions panel (null: the list of sessions). */
  const [focusedSession, setFocusedSession] = useState<string | null>(null);
  /** A Google Drive invite from the URL; joining opens Google's popups, so it waits for a click. */
  const [studioInvite, setStudioInvite] = useState<SessionRef | null>(null);
  /** A Project from a `?project=` link, waiting for a click to open (it signs in). */
  const [projectInvite, setProjectInvite] = useState<string | null>(null);
  const studioBusy = useJobRunning('studio');
  const [studioError, setStudioError] = useState<string | null>(null);
  /** Markups to carry into session documents on their first open (the uploader's own markups). */
  const studioSeeds = useRef(new Map<string, Uint8Array>());
  const studioRemovedRef = useRef<(sessionId: string, docId: string) => void>(() => {});
  const snapshots = useSnapshots(sessions);

  const toolsStateA = useToolsState(ctl?.tools ?? null);
  const toolsStateB = useToolsState(ctlB?.tools ?? null);
  const markupsA = useMarkups(open?.store ?? null);
  const markupsB = useMarkups(openB?.store ?? null);
  const scalesA = useScales(open?.store ?? null);
  const scalesB = useScales(openB?.store ?? null);
  const sheetsA = useSheets(open?.store ?? null);
  const sheetsB = useSheets(openB?.store ?? null);
  const activeStore = (split && activePane === 'b' ? openB : open)?.store ?? null;
  const bookmarks = useBookmarks(activeStore);
  const places = usePlaces(activeStore);
  const linksA = useLinks(open?.store ?? null);
  const linksB = useLinks(openB?.store ?? null);
  const stitchA = useStitch(open?.store ?? null);
  const stitchB = useStitch(openB?.store ?? null);
  const columnsA = useColumnSet(open?.store ?? null);
  const columnsB = useColumnSet(openB?.store ?? null);

  const paneB = split && activePane === 'b';
  const toolsState = paneB ? toolsStateB : toolsStateA;
  const markups = paneB ? markupsB : markupsA;
  const scales = paneB ? scalesB : scalesA;
  const sheets = paneB ? sheetsB : sheetsA;
  const links = paneB ? linksB : linksA;
  const stitchGroups = paneB ? stitchB : stitchA;
  const columnSet = paneB ? columnsB : columnsA;
  const viewports = useViewports(activeStore);
  /** The scale a markup in the active pane is measured at: its viewport's, else its page's. */
  const scaleOf = useCallback((m: Markup) => scaleOfMarkup(m, scales[m.pageIndex] ?? DEFAULT_SCALE, viewports), [scales, viewports]);

  const [libraryReady, setLibraryReady] = useState(false);
  const refreshLibrary = useCallback(
    () =>
      listFiles()
        .then((files) => {
          setLibrary(files);
          setLibraryReady(true);
        })
        .catch(console.error),
    [],
  );

  /** A pane's markup tools. Every callback goes through refs or stable setters, so the effects creating them need no dependencies. */
  const createTools = (pane: Pane, viewer: TileViewer) => {
    const front = () => (pane === 'b' ? openBRef : openRef).current;
    return new MarkupTools(viewer, {
      author: () => authorRef.current,
      onEditText: setEditingText,
      onCalibrate: (pageIndex, lengthPoints, at) => setCalibration({ pageIndex, lengthPoints, at }),
      onViewport: (pageIndex, rect) => viewportRef.current(pageIndex, rect),
      onFollowLink: (link) => followLinkRef.current(link),
      defaultFields: () => defaultFieldsFor(front()?.store),
      onCreated: recordRecent,
      onRegion: (_pageIndex, rect) => regionRef.current(rect),
      onEditComment: (id) => setCommentEdit({ pane, id }),
      onEditHyperlink: (id) => setHyperlinkEdit({ pane, id }),
      onSpaceDrawn: (id) => nameSpaceRef.current(front(), id),
      onNotice: (text) => setNotice(text),
      onVisualSearch: (pageIndex, rect) => setVisualSearchBox({ pane, pageIndex, rect }),
      onCropArea: (_pageIndex, rect) => setPageTool({ kind: 'crop', drawnRect: rect }),
      onEraseContent: (pageIndex, rect) => eraseRef.current(pageIndex, rect),
      onEditPdfText: (pageIndex, at) => editTextRef.current(pageIndex, at),
      onFormField: (w) => formFieldRef.current(pane, w),
      onFormFieldDrawn: (pageIndex, rect) => formDrawnRef.current(pane, pageIndex, rect),
      onTextSelected: (text) => {
        void navigator.clipboard?.writeText(text).then(
          () => setNotice(`Copied ${text.length} character${text.length === 1 ? '' : 's'}.`),
          () => setNotice('The browser did not allow copying to the clipboard.'),
        );
      },
      onFollowHyperlink: (m) => followHyperlinkRef.current(m),
      requestImage: pickImage,
      defaultStamp: lastStamp,
      stampValues: (pageIndex) => stampValuesFor(front(), pageIndex),
      requestAttachment: pickAttachment,
      onOpenAttachment: openAttachment,
      onEditLabel: (id) => editLabelRef.current(pane, id),
      onSnapshot: (pageIndex, rect) => snapshotRef.current(pane, pageIndex, rect),
      onCutContent: (pageIndex, rect) => {
        // The copy is made before the content is erased.
        void snapshotRef.current(pane, pageIndex, rect, false).then(() => eraseRef.current(pageIndex, rect));
      },
    });
  };

  useEffect(() => {
    const engine = new PdfEngine();
    const viewer = new TileViewer(canvasRef.current!, setStats);
    const tools = createTools('a', viewer);
    viewer.setOverlay(tools);
    setCtl({ engine, viewer, tools });
    // Debugging handle for the browser console in development builds.
    if (import.meta.env.DEV) Object.assign(window, { __nb: { engine, viewer, tools } });
    return () => {
      viewer.destroy();
      engine.terminate();
    };
  }, []);

  useEffect(() => {
    if (!split || !ctl) return;
    const canvas = canvasBRef.current;
    if (!canvas) return;
    const viewer = new TileViewer(canvas, setStatsB);
    const tools = createTools('b', viewer);
    viewer.setOverlay(tools);
    setCtlB({ viewer, tools });
    return () => {
      viewer.destroy();
      setCtlB(null);
    };
  }, [split, ctl]);

  const ctlOf = (pane: Pane) => (pane === 'b' ? ctlB : ctl);
  const openRefOf = (pane: Pane) => (pane === 'b' ? openBRef : openRef);
  const tabsRefOf = (pane: Pane) => (pane === 'b' ? tabsBRef : tabsARef);
  const paneParts = (pane: Pane) => ({ c: ctlOf(pane), o: openRefOf(pane).current });

  const setTabs = useCallback((pane: Pane, tabs: OpenFile[]) => {
    (pane === 'b' ? tabsBRef : tabsARef).current = tabs;
    (pane === 'b' ? setTabsB : setTabsA)(tabs);
  }, []);

  /** The pane's front document, in its ref and its state. */
  const setFront = useCallback((pane: Pane, packed: OpenFile | null) => {
    (pane === 'b' ? openBRef : openRef).current = packed;
    (pane === 'b' ? setOpenB : setOpen)(packed);
  }, []);

  /** Puts a document (or nothing) in front in a pane, remembering where the previous one was scrolled. */
  const showInPane = useCallback(
    (pane: Pane, packed: OpenFile | null) => {
      const c = pane === 'b' ? ctlB : ctl;
      const cur = openRefOf(pane).current;
      if (cur === packed) return;
      if (cur && c) savedViews.current.set(cur.file.id, c.viewer.getView());
      setFront(pane, packed);
      if (pane === 'a') {
        // Per-document state of the front document.
        indexAbort.current?.abort();
        setEditingText(null);
        setCalibration(null);
        history.current = [];
        setCanGoBack(false);
        future.current = [];
        setCanGoForward(false);
        searchHits.current = [];
      }
      if (!c) return;
      c.tools.setHighlights([]);
      if (!packed) {
        c.tools.setStore(null);
        c.viewer.clearDocument();
        return;
      }
      c.tools.setStore(packed.store);
      c.tools.setSnapSource(async (pageIndex) => new SnapIndex((await packed.doc.geometry(pageIndex)).segments));
      c.tools.setTextSource((pageIndex) => packed.doc.text(pageIndex));
      c.viewer.setDocument(packed.doc);
      const view = savedViews.current.get(packed.file.id);
      // A stitched view's camera only makes sense with its stitch layout, so just return to its page.
      if (view?.mode === 'stitch') c.viewer.goToPage(view.pageIndex);
      else if (view) c.viewer.setView(view);
    },
    [ctl, ctlB],
  );

  /** Brings a tab to the front of its pane. */
  const activateTab = useCallback(
    (pane: Pane, packed: OpenFile) => {
      if (pane === 'b') setSplit(true);
      setActivePane(pane);
      showInPane(pane, packed);
    },
    [showInPane],
  );

  const disposeOpen = (o: OpenFile) => {
    savedViews.current.delete(o.file.id);
    void o.doc.close();
    void o.store.destroy();
  };

  /** Opens bytes already in the library (or just added to it) in a new tab; `target` is the split pane. */
  const openStored = useCallback(
    async (file: StoredFile, bytes: ArrayBuffer, target: Pane = 'a') => {
      if (!ctl) return;
      const inA = tabsARef.current.find((t) => t.file.id === file.id);
      if (inA) {
        activateTab('a', inA);
        return;
      }
      const inB = tabsBRef.current.find((t) => t.file.id === file.id);
      if (inB) {
        activateTab('b', inB);
        return;
      }
      const pane: Pane = target === 'b' && ctlB ? 'b' : 'a';
      setError(null);
      const [doc, store] = await Promise.all([ctl.engine.open(bytes), MarkupStore.open(file.id)]);
      // Session documents sync their markups with everyone else in their session.
      const sessionDoc = studioDocOf(file.id);
      const session = sessionDoc ? sessionsRef.current.find((s) => s.id === sessionDoc.sessionId) : null;
      if (sessionDoc && session) {
        await session.attach(sessionDoc.docId, store);
        const seed = studioSeeds.current.get(file.id);
        if (seed) {
          studioSeeds.current.delete(file.id);
          if (session.canMarkup) Y.applyUpdate(store.doc, seed, 'seed');
        }
      } else if (sessionDoc) {
        store.setReadOnly(true);
      } else {
        // A Project file's markups are shared live with everyone who has it open.
        const link = linkOf(file.id);
        const project = link ? projectById(link.projectId) : null;
        if (link && project) await project.attachMarkups(link.fileId, store).catch((err: unknown) => console.warn('Project markups:', err));
      }
      // Documents without their own custom columns start with the profile's.
      const template = profiles.active().state.columnTemplate;
      // Not shared documents: one person's profile would become everyone's.
      if (template && !sessionDoc && !linkOf(file.id) && !store.readOnly && !store.hasColumnSet()) store.setColumnSet(template);
      await hideImported(doc, store);
      const packed = { file, doc, store };
      // The new tab goes just after the one in front.
      const tabs = pane === 'b' ? tabsBRef.current : tabsARef.current;
      const front = pane === 'b' ? openBRef.current : openRef.current;
      const at = front ? tabs.indexOf(front) + 1 : tabs.length;
      setTabs(pane, [...tabs.slice(0, at), packed, ...tabs.slice(at)]);
      activateTab(pane, packed);
      if (pane === 'a') {
        // Stay on Sessions or Sets when opening from them (or joining from an invite link).
        setLeftTab((tab) => (tab === 'sessions' || tab === 'projects' || tab === 'sets' ? tab : 'pages'));
        // On narrow screens the panel covers the drawing, so it opens only when asked.
        if (!narrowScreen()) setLeftOpen(true);
      }
    },
    [ctl, ctlB, activateTab, setTabs],
  );

  /**
   * Runs a background indexing job with progress and cancellation (from the jobs bar, or by
   * another document coming to the front). Jobs read the file from device storage themselves,
   * when they need it (the PDF engine takes ownership of the buffer it is given).
   */
  const runIndexJob = useCallback(async (cur: OpenFile | null, job: (cur: OpenFile, signal: AbortSignal, report: (p: IndexProgress) => void) => Promise<void>) => {
    if (!cur) return;
    indexAbort.current?.abort();
    const abort = new AbortController();
    indexAbort.current = abort;
    const { signal, progress, end } = startJob(`Reading · ${cur.file.name}`, { kind: 'index' });
    signal.addEventListener('abort', () => abort.abort());
    try {
      await job(cur, abort.signal, (p) => progress(p.done, p.total, INDEX_PHASES[p.phase]));
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      end();
      if (indexAbort.current === abort) indexAbort.current = null;
    }
  }, []);

  /**
   * Everything the app works out about a newly opened document, in dependency order: its own
   * markups and links, then sheets, then hyperlinks, then stitching. Steps already done (stored
   * in the document) are skipped, so reopening is instant.
   */
  const analyseDocument = useCallback(
    (doc: OpenFile | null = openRef.current) =>
      runIndexJob(doc, async (cur, signal, report) => {
        const fresh = () => readFile(cur.file.hash);
        // Sheets first: importing the PDF's links needs sheet numbers to resolve links to files.
        if (Object.keys(cur.store.allSheets()).length === 0) await indexFromText(await fresh(), cur.store, report, signal);
        if (!cur.store.annotationsImported()) {
          // A Project file whose markups are already shared takes them from there, not from its PDF.
          const link = linkOf(cur.file.id);
          const project = link ? projectById(link.projectId) : null;
          const shared = link && project ? await project.hasSharedMarkups(link.fileId).catch(() => false) : false;
          await importPdfAnnotations(fresh, cur.store, report, signal, shared ? fromOtherTools : undefined);
          await hideImported(cur.doc, cur.store);
          ctl?.viewer.clearCache();
          // Detected links that duplicate imported ones are dropped on re-detection.
          await linkFromText(fresh, cur.store, report, signal);
        } else if (!cur.store.linksDetected()) {
          await linkFromText(fresh, cur.store, report, signal);
        }
        if (!cur.store.outlineImported()) cur.store.importOutline(outlineBookmarks(await cur.doc.outline()));
        if (!cur.store.stitchDetected()) await stitchFromText(fresh, cur.store, report, signal);
      }),
    [runIndexJob, ctl],
  );

  const redetectLinks = useCallback(
    (doc: OpenFile | null = openRef.current) => runIndexJob(doc, (cur, signal, report) => linkFromText(() => readFile(cur.file.hash), cur.store, report, signal)),
    [runIndexJob],
  );

  /** Moves the camera, remembering where we were so Back can return. */
  const navigate = useCallback(
    (pageIndex: number, rect: { x: number; y: number; w: number; h: number } | null) => {
      const useB = activePaneRef.current === 'b' && ctlB;
      const viewer = useB ? ctlB.viewer : ctl?.viewer;
      const tools = useB ? ctlB.tools : ctl?.tools;
      if (!viewer || !tools) return;
      history.current.push(viewer.getView());
      if (history.current.length > 50) history.current.shift();
      setCanGoBack(true);
      future.current = [];
      setCanGoForward(false);
      viewer.goToPage(pageIndex);
      if (rect) {
        viewer.zoomToRect(rect, rect.w < 200 ? 6 : 1.3);
        tools.flash(pageIndex, rect);
      }
    },
    [ctl, ctlB],
  );

  followLinkRef.current = (link: StoredLink) => navigate(link.targetPage, link.targetRect);
  /** Runs a link action (of a markup or a bookmark): a web page, another document, a Place or a page. */
  const followAction = (link: LinkAction) => {
    if (link.kind === 'url') {
      window.open(link.url, '_blank', 'noopener');
      return;
    }
    if (link.kind === 'file') {
      const { fileId, pageIndex, rect } = link;
      void openSetSheetRef.current(fileId, pageIndex).then(() => {
        if (rect && rect.w > 0) navigate(pageIndex, rect);
      });
      return;
    }
    const store = (activePaneRef.current === 'b' ? openBRef.current : openRef.current)?.store;
    const target = actionTarget(link, store?.places() ?? []);
    if (target) goToTarget(target);
  };
  followHyperlinkRef.current = (m: Markup) => {
    if (m.link) followAction(m.link);
  };
  /** Bookmarks and Places: a zoomed view, a point (scrolled to), or the whole page. */
  const goToTarget = (t: ViewTarget) => navigate(t.pageIndex, t.rect && t.rect.w > 0 ? t.rect : null);

  /** Shows one search match: its page, zoomed in, highlighted as the current match. */
  const openSearchHit = useCallback(
    (hit: SearchHit) => {
      const useB = activePaneRef.current === 'b' && ctlB;
      const viewer = useB ? ctlB.viewer : ctl?.viewer;
      const tools = useB ? ctlB.tools : ctl?.tools;
      if (!viewer || !tools) return;
      const xs = hit.rects.flatMap((r) => [r.x, r.x + r.w]);
      const ys = hit.rects.flatMap((r) => [r.y, r.y + r.h]);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      viewer.goToPage(hit.pageIndex);
      // Enough context to read the match in its surroundings.
      viewer.zoomToRect({ x: rect.x - 150, y: rect.y - 100, w: rect.w + 300, h: rect.h + 200 }, 1, hit.pageIndex);
      tools.setHighlights(searchHits.current, searchHits.current.indexOf(hit));
    },
    [ctl, ctlB],
  );

  const goBack = useCallback(() => {
    const view = history.current.pop();
    const useB = activePaneRef.current === 'b' && ctlB;
    const viewer = useB ? ctlB.viewer : ctl?.viewer;
    if (view && viewer) {
      future.current.push(viewer.getView());
      viewer.setView(view);
    }
    setCanGoBack(history.current.length > 0);
    setCanGoForward(future.current.length > 0);
  }, [ctl, ctlB]);

  const goForward = useCallback(() => {
    const view = future.current.pop();
    const useB = activePaneRef.current === 'b' && ctlB;
    const viewer = useB ? ctlB.viewer : ctl?.viewer;
    if (view && viewer) {
      history.current.push(viewer.getView());
      viewer.setView(view);
    }
    setCanGoBack(history.current.length > 0);
    setCanGoForward(future.current.length > 0);
  }, [ctl, ctlB]);

  const detectSheetsOffline = useCallback(
    (doc: OpenFile | null = openRef.current) =>
      runIndexJob(doc, async (cur, signal, report) => {
        await indexFromText(await readFile(cur.file.hash), cur.store, report, signal);
        await stitchFromText(() => readFile(cur.file.hash), cur.store, report, signal);
      }),
    [runIndexJob],
  );

  const restitch = useCallback(
    (doc: OpenFile | null = openRef.current) => runIndexJob(doc, (cur, signal, report) => stitchFromText(() => readFile(cur.file.hash), cur.store, report, signal)),
    [runIndexJob],
  );

  const openStitch = useCallback(
    (group: StoredStitchGroup | null, focusPage?: number) => {
      const useB = activePaneRef.current === 'b' && ctlB;
      const viewer = useB ? ctlB.viewer : ctl?.viewer;
      if (!viewer) return;
      history.current.push(viewer.getView());
      setCanGoBack(true);
      future.current = [];
      setCanGoForward(false);
      viewer.setStitch(group?.placements ?? null, focusPage);
    },
    [ctl, ctlB],
  );

  /** Opens PDFs from disk, one tab each. */
  /**
   * A protected PDF, unlocked: asks for its password if it has one, and returns it without its
   * security so every tool can work on it (a protected copy is saved from Document › Security).
   * Unprotected files come back as they are.
   */
  const unlockBytes = useCallback(
    async (bytes: ArrayBuffer, name: string): Promise<ArrayBuffer> => {
      if (!ctl) return bytes;
      let password = '';
      for (let attempt = 0; ; attempt++) {
        try {
          const open = await ctl.engine.unlock(bytes.slice(0), password);
          if (!open) return bytes;
          setNotice(`${name} was protected. This device keeps it unprotected so it can be worked on; Document › Security saves a protected copy.`);
          return open;
        } catch (err) {
          if (!(err instanceof Error) || err.message !== NEEDS_PASSWORD) throw err;
          const typed = await askText(attempt ? 'Wrong password' : 'Password', '', { label: `${name} is protected. Type its password to open it.`, confirm: 'Open', password: true });
          if (typed === null) throw new Error(`${name} was not opened: it needs its password.`);
          password = typed;
        }
      }
    },
    [ctl],
  );

  const openNewFile = useCallback(
    async (f: File | File[], target: Pane = 'a') => {
      for (const file of Array.isArray(f) ? f : [f]) {
        try {
          // Pictures open as one-page PDFs at their real size.
          const image = isImageFile(file);
          const raw = image ? null : await file.arrayBuffer();
          const bytes = image ? await imageToPdf(file) : await unlockBytes(raw!, file.name);
          const name = image ? file.name.replace(/\.[^.]+$/, '') + '.pdf' : file.name;
          // The engine takes ownership of the buffer it is given, so store a copy first.
          const stored = await saveFile(name, bytes.slice(0));
          // Save writes back over the file it came from, except pictures and protected PDFs
          // (which are kept unprotected here and must not replace the original).
          const source = handleOf(file);
          if (source && bytes === raw) await rememberHandle(stored.id, source);
          await openStored(stored, bytes, target);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      void refreshLibrary();
    },
    [openStored, refreshLibrary, unlockBytes],
  );

  /** The system Open dialog where the browser has one (so Save can write back to the file), else the file input. */
  const openFromDisk = useCallback(() => {
    void pickFilesToOpen().then((files) => {
      if (files === null) openFileRef.current?.click();
      else if (files.length) void openNewFile(files, split && activePaneRef.current === 'b' ? 'b' : 'a');
    });
  }, [openNewFile, split]);

  /** Opens a PDF made here (new or combined) as a new document in the active pane. */
  const openCreated = useCallback(
    async (name: string, bytes: ArrayBuffer) => {
      const stored = await saveFile(name, bytes.slice(0));
      await openStored(stored, bytes, split && activePaneRef.current === 'b' ? 'b' : 'a');
      void refreshLibrary();
    },
    [openStored, refreshLibrary, split],
  );

  // Preferences › Interface › Reopen the documents that were open: the tabs are remembered, and
  // reopened once when the app starts (after the engine and library are ready).
  const restoredTabs = useRef(false);
  useEffect(() => {
    if (!restoredTabs.current) return;
    try {
      const ids = (tabs: OpenFile[]) => tabs.filter((t) => !studioDocOf(t.file.id)).map((t) => t.file.id);
      localStorage.setItem('nb.openTabs', JSON.stringify({ a: ids(tabsA), b: ids(tabsB) }));
    } catch {
      // Not remembered.
    }
  }, [tabsA, tabsB]);
  /** File → Combine: the listed documents (open ones with their markups) joined into a new PDF. */
  const combineDocuments = useCallback(
    async (sources: CombineSource[], name: string) => {
      if (!ctl) return;
      setCombineOpen(false);
      const job = startJob(`Combine · ${name}`, PAGES_JOB);
      try {
        const tabs = [...tabsARef.current, ...tabsBRef.current];
        const parts: ArrayBuffer[] = [];
        for (const src of sources) {
          if (src.kind === 'open') {
            const tab = tabs.find((t) => t.file.id === src.id);
            if (!tab) throw new Error(`${src.name} is no longer open.`);
            const bytes = await annotatedBytes(tab);
            parts.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
          } else {
            parts.push(isImageFile(src.file) ? await imageToPdf(src.file) : await unlockBytes(await src.file.arrayBuffer(), src.file.name));
          }
        }
        const [first, ...rest] = parts;
        if (!first) return;
        // Each insert lands past the end, so the documents follow each other in order.
        const combined = rest.length ? await ctl.engine.editPdf(first, rest.map((_, i) => ({ type: 'insert' as const, source: i, at: Number.MAX_SAFE_INTEGER })), rest) : first;
        await openCreated(name, combined);
      } catch (err) {
        setError(`Combine failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        job.end();
      }
    },
    [ctl, openCreated, unlockBytes],
  );

  const openFromLibrary = useCallback(
    async (file: StoredFile, target?: Pane) => {
      try {
        for (const pane of ['a', 'b'] as const) {
          const tab = (pane === 'b' ? tabsBRef.current : tabsARef.current).find((t) => t.file.id === file.id);
          if (tab) return activateTab(pane, tab);
        }
        // A second click while the file is still opening waits for the first instead of opening it twice.
        const pending = openingFiles.current.get(file.id);
        if (pending) return await pending;
        const opening = (async () => {
          await openStored(file, await readFile(file.hash), target ?? (split && activePane === 'b' ? 'b' : 'a'));
          await touchFile(file.id);
          void refreshLibrary();
        })();
        openingFiles.current.set(file.id, opening);
        try {
          await opening;
        } finally {
          openingFiles.current.delete(file.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [openStored, activateTab, refreshLibrary, split, activePane],
  );

  useEffect(() => {
    if (restoredTabs.current || !ctl || !libraryReady) return;
    restoredTabs.current = true;
    if (!settings.get().restoreTabs) return;
    let saved: { a?: string[]; b?: string[] } = {};
    try {
      saved = JSON.parse(localStorage.getItem('nb.openTabs') ?? '{}') ?? {};
    } catch {
      // Nothing to reopen.
    }
    void (async () => {
      for (const [pane, ids] of [
        ['a', saved.a ?? []],
        ['b', saved.b ?? []],
      ] as const)
        for (const id of ids) {
          const file = library.find((f) => f.id === id);
          if (file) await openFromLibrary(file, pane);
        }
    })();
  }, [ctl, libraryReady, library, openFromLibrary]);

  useEffect(() => {
    if (!ctlB) return;
    const stored = pendingSplitStored.current;
    pendingSplitStored.current = null;
    if (stored) void openStored(stored.file, stored.bytes, 'b');
    const moving = pendingMove.current;
    pendingMove.current = null;
    if (moving) moveTabRef.current('a', moving);
    const f = pendingSplit.current;
    if (!f) return;
    pendingSplit.current = null;
    void openNewFile(f, 'b');
  }, [ctlB, openNewFile, openStored]);

  // Load the library and reopen the tabs from last time (or the most recent file), so the app
  // resumes where it left off offline.
  const restored = useRef(false);
  useEffect(() => {
    if (!ctl || restored.current) return;
    restored.current = true;
    void listFiles().then(async (files) => {
      setLibrary(files);
      if (openRef.current) return;
      const saved = savedTabs();
      const tabs = saved.ids.map((id) => files.find((f) => f.id === id)).filter((f): f is StoredFile => !!f);
      if (!tabs.length && files[0]) tabs.push(files[0]);
      for (const f of tabs) await openFromLibrary(f, 'a');
      const front = tabs.find((f) => f.id === saved.active);
      if (front && tabs.length > 1) await openFromLibrary(front, 'a');
    });
  }, [ctl, openFromLibrary]);

  // Remember the library documents open in tabs for next time.
  useEffect(() => {
    if (!restored.current) return;
    const ids = [...tabsA, ...tabsB].map((t) => t.file.id).filter((id) => !studioDocOf(id));
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ ids, active: (activePane === 'b' ? openB : open)?.file.id ?? null }));
    } catch {
      // Not remembered; the most recent file opens next time.
    }
  }, [tabsA, tabsB, open, openB, activePane]);

  useEffect(() => {
    if (open) void analyseDocument(open);
  }, [open, analyseDocument]);

  // Keep an open stitched view in step with re-stitching.
  const stitchSeen = useRef(new WeakMap<TileViewer, readonly StoredStitchGroup[]>());
  useEffect(() => {
    for (const [c, groups] of [
      [ctl, stitchA],
      [ctlB, stitchB],
    ] as const) {
      if (!c || stitchSeen.current.get(c.viewer) === groups) continue;
      stitchSeen.current.set(c.viewer, groups);
      if (!c.viewer.isStitched) continue;
      const focus = c.viewer.currentPageIndex;
      const group = groups.find((g) => g.placements.some((p) => p.pageIndex === focus));
      c.viewer.setStitch(group?.placements ?? null, focus);
    }
  }, [ctl, ctlB, stitchA, stitchB]);

  /**
   * Applies page operations to the open document: the file is rewritten, everything attached to
   * its pages follows the pages, and the viewer reopens on the same sheet.
   */
  /**
   * Shows `next` in place of the tab `cur` in a pane (same markups) and closes `cur`'s document.
   * `keep` restores the view as it was, or says which page to show given the one that was showing.
   */
  const reopenInPane = useCallback(
    async (cur: OpenFile, pane: Pane, next: OpenFile, keep: 'view' | ((was: number) => number)) => {
      const c = ctlOf(pane);
      if (!c) {
        void next.doc.close();
        return;
      }
      await hideImported(next.doc, cur.store);
      setTabs(pane, tabsRefOf(pane).current.map((t) => (t === cur ? next : t)));
      setFront(pane, next);
      const { tools, viewer } = c;
      tools.setSnapSource(async (pageIndex) => new SnapIndex((await next.doc.geometry(pageIndex)).segments));
      tools.setTextSource((pageIndex) => next.doc.text(pageIndex));
      const view = viewer.getView();
      viewer.setDocument(next.doc);
      if (keep === 'view') viewer.setView(view);
      else viewer.goToPage(keep(view.pageIndex));
      void cur.doc.close();
    },
    [ctl, ctlB, setTabs, setFront],
  );

  /**
   * Replaces an open document's file with `edited` and reopens it in place; its markups stay.
   * `remap` runs once the new file is stored (to move markups with their pages, or to note what is
   * already known about the new contents), and `pageFor` says which page to show given the one
   * that was showing. `edited` is transferred to the PDF engine.
   */
  const swapDocument = useCallback(
    async (cur: OpenFile, intoB: boolean, edited: ArrayBuffer, remap?: (file: StoredFile) => void, pageFor: (was: number) => number = (was) => was) => {
      const pane: Pane = intoB ? 'b' : 'a';
      if (!ctl || !ctlOf(pane)) return;
      // Session documents live in the session, not the library: only cached on this device.
      const file = studioDocOf(cur.file.id)
        ? await (async () => {
            const hash = await cacheFile(edited);
            rememberStudioHash(cur.file.id, hash);
            return { ...cur.file, hash, size: edited.byteLength };
          })()
        : await replaceFileContent(cur.file.id, edited);
      remap?.(file);
      forgetText(cur.file.id);

      // Both writes above have finished with `edited`, so the engine can take it.
      const doc = await ctl.engine.open(edited);
      await reopenInPane(cur, pane, { file, doc, store: cur.store }, pageFor);
      void refreshLibrary();
    },
    [ctl, ctlB, refreshLibrary, reopenInPane],
  );

  /**
   * Shows a document with some of its PDF layers hidden: the view is reopened from a copy whose
   * default layer states hide them. The stored file is not changed.
   */
  const showPdfLayers = useCallback(
    async (cur: OpenFile, hidden: ReadonlySet<string>) => {
      const pane: Pane = tabsBRef.current.includes(cur) ? 'b' : 'a';
      if (!ctl || !ctlOf(pane)) return;
      const { withLayersShown } = await import('./documents/layers');
      const bytes = await withLayersShown(await readFile(cur.file.hash), hidden);
      const doc = await ctl.engine.open(bytes.slice().buffer);
      await reopenInPane(cur, pane, { ...cur, doc }, 'view');
    },
    [ctl, ctlB, reopenInPane],
  );

  /**
   * Writes new contents for a document whether or not it is open: an open tab is swapped in place,
   * a library file is replaced on the device. `remap` updates its markups for the change. With a
   * note, the contents before are kept as a revision.
   */
  const commitDocument = useCallback(
    async (cur: OpenFile, edited: ArrayBuffer, remap?: (file: StoredFile) => void, revisionNote?: string) => {
      if (revisionNote) await keepRevision(cur.file.id, revisionNote);
      if (tabsARef.current.includes(cur)) return swapDocument(cur, false, edited, remap);
      if (tabsBRef.current.includes(cur)) return swapDocument(cur, true, edited, remap);
      remap?.(await replaceFileContent(cur.file.id, edited));
      forgetText(cur.file.id);
    },
    [swapDocument],
  );

  const applyPageOps = useCallback(
    async (ops: PageOp[], inserts: ArrayBuffer[] = []) => {
      const intoB = activePaneRef.current === 'b';
      const cur = intoB ? openBRef.current : openRef.current;
      const tools = intoB ? ctlB?.tools : ctl?.tools;
      const viewer = intoB ? ctlB?.viewer : ctl?.viewer;
      if (!cur || !ctl || !tools || !viewer) return;
      if (studioDocOf(cur.file.id)) {
        setError('Pages of a Live Session document cannot be changed: everyone in the session shares the same file.');
        return;
      }
      const job = startJob(`Pages · ${cur.file.name}`, PAGES_JOB);
      try {
        const oldSizes = cur.doc.pages.map((p) => ({ width: p.width, height: p.height }));
        // Page counts of inserted documents, needed to work out the new page numbering.
        const insertCounts: number[] = [];
        for (const b of inserts) {
          const probe = await ctl.engine.open(b.slice(0));
          insertCounts.push(probe.pages.length);
          void probe.close();
        }
        const edited = await ctl.engine.editPdf(await readFile(cur.file.hash), ops, inserts);
        const plan = planPageOps(oldSizes.length, ops, insertCounts);
        await swapDocument(
          cur,
          intoB,
          edited,
          () => cur.store.remapPages(plan, oldSizes),
          (was) => plan.oldToNew[was] ?? 0,
        );
        // Inserted pages have no sheet information yet; the tab now holds the new file.
        if (ops.some((op) => op.type === 'insert')) void detectSheetsOffline(openRefOf(intoB ? 'b' : 'a').current);
      } catch (err) {
        setError(`Page operation failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        job.end();
      }
    },
    [ctl, ctlB, detectSheetsOffline, swapDocument],
  );

  /** OCR as a job: each page is rendered, read by Tesseract, and the words added as invisible text. */
  /** OCR of pages of a document (open or not); resolves with how many words were found. */
  const ocrDocument = useCallback(
    async (cur: OpenFile, pages: number[], dpi: number, { signal, progress }: JobContext, revisionNote?: string) => {
      const { addTextLayer, recognise, setOcrLanguages } = await import('./documents/ocr');
      setOcrLanguages(settings.get().ocrLanguages);
      const words = new Map<number, Awaited<ReturnType<typeof recognise>>>();
      for (let k = 0; k < pages.length; k++) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const p = pages[k]!;
        const size = cur.doc.pages[p]!;
        const scale = Math.min(dpi / 72, 7000 / Math.max(size.width, size.height));
        progress(k, pages.length, `Page ${p + 1}: rendering`);
        const w = Math.ceil(size.width * scale);
        const h = Math.ceil(size.height * scale);
        const { bitmap } = await cur.doc.renderTile(p, scale, 0, 0, w, h);
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const image = await canvas.convertToBlob({ type: 'image/png' });
        progress(k, pages.length, `Page ${p + 1}: reading text (${k + 1} of ${pages.length})`);
        words.set(p, await recognise(image, scale));
      }
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      progress(pages.length, pages.length, 'Adding the text');
      const bytes = await addTextLayer(await readFile(cur.file.hash), words);
      await commitDocument(cur, bytes.slice().buffer, undefined, revisionNote);
      return [...words.values()].reduce((n, l) => n + l.length, 0);
    },
    [commitDocument],
  );

  const runOcr = useCallback(
    async (cur: OpenFile, pages: number[], dpi: number) => {
      if (studioDocOf(cur.file.id)) {
        setError('A Live Session document is shared with others, so its content cannot be changed here.');
        return;
      }
      try {
        const count = await runJob(`OCR · ${cur.file.name}`, (ctx) => ocrDocument(cur, pages, dpi, ctx));
        setNotice(`OCR found ${count} word${count === 1 ? '' : 's'} on ${pages.length} page${pages.length === 1 ? '' : 's'}; they can now be searched and selected.`);
      } catch (err) {
        if (isAbort(err)) setNotice('OCR cancelled; the document was not changed.');
        else setError(`OCR failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [ocrDocument],
  );


  /**
   * A library document for work across files (compare, batch): the open tab when it is open, else
   * opened without a view. `release` closes what was opened here.
   */
  const acquireDocument = useCallback(
    async (fileId: string): Promise<{ open: OpenFile; release: () => void }> => {
      if (!ctl) throw new Error('The PDF engine is not ready');
      const tab = [...tabsARef.current, ...tabsBRef.current].find((t) => t.file.id === fileId);
      if (tab) return { open: tab, release: () => {} };
      const file = (await listFiles()).find((f) => f.id === fileId);
      if (!file) throw new Error('That document is no longer in the library');
      const [doc, store] = await Promise.all([ctl.engine.open(await readFile(file.hash)), MarkupStore.open(file.id)]);
      await hideImported(doc, store);
      return {
        open: { file, doc, store },
        release: () => {
          void doc.close();
          void store.destroy();
        },
      };
    },
    [ctl],
  );

  /** A page of a library document as an image, for picking points and regions on. */
  const previewPage = useCallback(
    async (fileId: string, page: number) => {
      const { open, release } = await acquireDocument(fileId);
      try {
        const index = Math.min(Math.max(0, page), open.doc.pages.length - 1);
        const size = open.doc.pages[index]!;
        const scale = 1400 / Math.max(size.width, size.height);
        const width = Math.ceil(size.width * scale);
        const height = Math.ceil(size.height * scale);
        const { bitmap } = await open.doc.renderTile(index, scale, 0, 0, width, height);
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return { url: URL.createObjectURL(blob), width: size.width, height: size.height };
      } finally {
        release();
      }
    },
    [acquireDocument],
  );

  /**
   * Compare Documents: each pair of pages is rendered, lined up and diffed; differences are clouded
   * in the new revision (and the old one, if asked), replacing clouds from an earlier compare.
   */
  const compareFiles = useCallback(
    async (spec: CompareSpec, { signal, progress }: JobContext) => {
          const { comparePages, pairPages } = await import('./compare/compare');
          const older = await acquireDocument(spec.oldId);
          let newer: Awaited<ReturnType<typeof acquireDocument>> | null = null;
          try {
            newer = await acquireDocument(spec.newId);
            const o = older.open;
            const n = newer.open;
            const labels = (x: OpenFile) => x.doc.pages.map((_, i) => x.store.allSheets()[i]?.number ?? null);
            const pairs = pairsFor(spec.pairing, o, n, labels, pairPages);
            const pages = [];
            for (let k = 0; k < pairs.length; k++) {
              if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
              progress(k, pairs.length, `${pageLabelFor(n, pairs[k]!.newPage)} (${k + 1} of ${pairs.length})`);
              pages.push(await comparePages(o.doc, n.doc, pairs[k]!, spec.options));
            }
            const now = Date.now();
            const mark = (pageIndex: number, r: { x: number; y: number; w: number; h: number }, kind: string): Markup => ({
              id: crypto.randomUUID(),
              type: spec.markup.type,
              pageIndex,
              points: [
                [r.x, r.y],
                [r.x + r.w, r.y + r.h],
              ],
              style: { ...DEFAULT_STYLES[spec.markup.type], stroke: spec.markup.color, ...(spec.markup.type === 'cloud' ? { arcRadius: Math.min(12, Math.max(3, Math.min(r.w, r.h) / 5)) } : {}) },
              subject: 'Compare',
              comment: kind[0]!.toUpperCase() + kind.slice(1),
              status: 'none',
              author: authorRef.current,
              createdAt: now,
              modifiedAt: now,
            });
            const replace = (x: OpenFile, marks: Markup[], pagesDone: Set<number>) => {
              if (x.store.readOnly) return;
              x.store.batch(() => {
                x.store.remove(x.store.all().filter((m) => m.subject === 'Compare' && pagesDone.has(m.pageIndex)).map((m) => m.id));
                for (const m of marks) x.store.add(m);
              });
            };
            replace(
              n,
              pages.flatMap((p) => p.differences.map((d) => mark(p.newPage, d, d.kind))),
              new Set(pages.map((p) => p.newPage)),
            );
            if (spec.markup.markOld)
              replace(
                o,
                pages.flatMap((p) => p.differences.map((d) => mark(p.oldPage, mapBox(invertAffine(p.transform), d), d.kind))),
                new Set(pages.map((p) => p.oldPage)),
              );
            const oldLabels = o.doc.pages.map((_, i) => pageLabelFor(o, i));
            const newLabels = n.doc.pages.map((_, i) => pageLabelFor(n, i));
            return {
              oldId: spec.oldId,
              newId: spec.newId,
              oldName: o.file.name,
              newName: n.file.name,
              pages,
              oldLabel: (i: number) => oldLabels[i] ?? `Page ${i + 1}`,
              newLabel: (i: number) => newLabels[i] ?? `Page ${i + 1}`,
            };
          } finally {
            newer?.release();
            older.release();
          }
    },
    [acquireDocument],
  );

  /**
   * Batch Compare and Batch Overlay: the sheets of each side's files (sheet numbers from the Sets
   * index, else read from the file), paired across files and grouped by pair of files.
   */
  const pairBatch = useCallback(
    async (batch: NonNullable<CompareSpec['batch']>, bySheet: boolean, { signal, progress }: JobContext) => {
      const { pairAcross } = await import('./compare/batch');
      const all = [...batch.oldIds, ...batch.newIds];
      const refs = new Map<string, { fileId: string; page: number; label: string | null }[]>();
      for (let k = 0; k < all.length; k++) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const id = all[k]!;
        if (refs.has(id)) continue;
        progress(k, all.length, `Reading sheets: ${library.find((f) => f.id === id)?.name ?? ''}`);
        const known = drawingSets.index()[id];
        if (known) {
          refs.set(id, Array.from({ length: known.pageCount }, (_, page) => ({ fileId: id, page, label: known.sheets[page]?.number ?? null })));
          continue;
        }
        const held = await acquireDocument(id);
        try {
          const { doc, store } = held.open;
          let sheets = store.allSheets();
          if (bySheet && !Object.keys(sheets).length) {
            const { detectSheets } = await import('@nb/sheets');
            const texts: PageText[] = [];
            for (let i = 0; i < doc.pages.length; i++) texts.push({ ...doc.pages[i]!, words: await doc.text(i) });
            sheets = Object.fromEntries(detectSheets(texts).map((info, i) => [i, info]));
          }
          refs.set(id, doc.pages.map((_, page) => ({ fileId: id, page, label: sheets[page]?.number ?? null })));
        } finally {
          held.release();
        }
      }
      return pairAcross(
        batch.oldIds.flatMap((id) => refs.get(id) ?? []),
        batch.newIds.flatMap((id) => refs.get(id) ?? []),
        bySheet,
      );
    },
    [acquireDocument, library],
  );

  const runCompare = useCallback(
    async (spec: CompareSpec) => {
      if (spec.batch) {
        const batch = spec.batch;
        try {
          const done = await runJob('Batch Compare', async (ctx) => {
            const groups = await pairBatch(batch, spec.pairing.kind !== 'order', ctx);
            const results = [];
            for (let g = 0; g < groups.length; g++) {
              const { oldId, newId, pairs } = groups[g]!;
              const name = library.find((f) => f.id === newId)?.name ?? '';
              results.push(await compareFiles({ ...spec, oldId, newId, pairing: { kind: 'list', pairs } }, partOf(ctx, g, groups.length, name)));
            }
            return results;
          });
          const sheets = done.reduce((n, r) => n + r.pages.length, 0);
          const found = done.reduce((n, r) => n + r.pages.reduce((m, p) => m + p.differences.length, 0), 0);
          if (!done.length) {
            setNotice('No sheets in the two sets matched.');
            return;
          }
          setNotice(`Batch Compare: ${sheets} sheet${sheets === 1 ? '' : 's'} in ${done.length} pair${done.length === 1 ? '' : 's'} of files, ${found} difference${found === 1 ? '' : 's'} clouded. Showing the pair with the most.`);
          const most = done.reduce((a, b) => (b.pages.reduce((m, p) => m + p.differences.length, 0) > a.pages.reduce((m, p) => m + p.differences.length, 0) ? b : a));
          setCompareResults(most);
          await sideBySideRef.current(most.oldId, most.newId);
        } catch (err) {
          if (isAbort(err)) setNotice('Batch Compare cancelled.');
          else setError(`Batch Compare failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      try {
        const results = await runJob('Compare Documents', (ctx) => compareFiles(spec, ctx));
        setCompareResults(results);
        await sideBySideRef.current(results.oldId, results.newId);
      } catch (err) {
        if (isAbort(err)) setNotice('Compare cancelled.');
        else setError(`Compare failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [compareFiles, pairBatch, library],
  );

  /**
   * Overlay Pages: each pair of pages stacked in colour on a page of a new PDF (the old revision
   * lined up with the new one), which opens in a new tab.
   */
  /** Overlay Pages for one pair of files: the pages to stack, the old file's layers as source `base`, the new one's as `base + 1`. */
  const overlayPlan = useCallback(
    async (spec: CompareSpec, { signal, progress }: JobContext, base = 0) => {
          const { comparePages, pairPages } = await import('./compare/compare');
          const older = await acquireDocument(spec.oldId);
          let newer: Awaited<ReturnType<typeof acquireDocument>> | null = null;
          try {
            newer = await acquireDocument(spec.newId);
            const o = older.open;
            const n = newer.open;
            const labels = (x: OpenFile) => x.doc.pages.map((_, i) => x.store.allSheets()[i]?.number ?? null);
            const pairs = pairsFor(spec.pairing, o, n, labels, pairPages);
            const pages: OverlayPageSpec[] = [];
            for (let k = 0; k < pairs.length; k++) {
              if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
              const pair = pairs[k]!;
              progress(k, pairs.length, `${pageLabelFor(n, pair.newPage)}: lining up (${k + 1} of ${pairs.length})`);
              const fitted = spec.options.align || spec.options.scaleToFit || spec.options.transform;
              const transform = fitted ? (await comparePages(o.doc, n.doc, pair, { ...spec.options, graphics: false, text: false })).transform : undefined;
              pages.push({
                size: n.doc.pages[pair.newPage]!,
                layers: [
                  { source: base, page: pair.oldPage, offset: [0, 0], transform },
                  { source: base + 1, page: pair.newPage, offset: [0, 0] },
                ],
              });
            }
            return { pages, oldFile: o.file, newFile: n.file };
          } finally {
            newer?.release();
            older.release();
          }
    },
    [acquireDocument],
  );

  const runOverlay = useCallback(
    async (spec: CompareSpec) => {
      try {
        const made = await runJob(spec.batch ? 'Batch Overlay' : 'Overlay Pages', async (ctx) => {
          const { overlayPages, rgbOf } = await import('./documents/overlay');
          if (spec.batch) {
            // Every pair of files stacked into one PDF.
            const groups = await pairBatch(spec.batch, spec.pairing.kind !== 'order', ctx);
            if (!groups.length) throw new Error('No sheets in the two sets matched');
            const pages: OverlayPageSpec[] = [];
            const sources = [];
            for (let g = 0; g < groups.length; g++) {
              const { oldId, newId, pairs } = groups[g]!;
              const plan = await overlayPlan({ ...spec, oldId, newId, pairing: { kind: 'list', pairs } }, partOf(ctx, g, groups.length, library.find((f) => f.id === newId)?.name ?? ''), g * 2);
              pages.push(...plan.pages);
              sources.push({ bytes: await readFile(plan.oldFile.hash), color: rgbOf(spec.colors.old) }, { bytes: await readFile(plan.newFile.hash), color: rgbOf(spec.colors.new) });
            }
            ctx.progress(1, 1, 'Making the overlay');
            const bytes = await overlayPages(sources, pages);
            return { name: `Batch Overlay ${new Date().toISOString().slice(0, 10)}.pdf`, bytes, count: pages.length };
          }
          const plan = await overlayPlan(spec, ctx);
          ctx.progress(1, 1, 'Making the overlay');
          const bytes = await overlayPages(
            [
              { bytes: await readFile(plan.oldFile.hash), color: rgbOf(spec.colors.old) },
              { bytes: await readFile(plan.newFile.hash), color: rgbOf(spec.colors.new) },
            ],
            plan.pages,
          );
          const base = (name: string) => name.replace(/\.pdf$/i, '');
          return { name: `Overlay - ${base(plan.newFile.name)} over ${base(plan.oldFile.name)}.pdf`, bytes, count: plan.pages.length };
        });
        await openCreated(made.name, made.bytes.slice().buffer);
        setNotice(`Overlaid ${made.count} page${made.count === 1 ? '' : 's'}: dark lines are in both revisions, coloured lines only in the revision drawn in that colour.`);
      } catch (err) {
        if (isAbort(err)) setNotice('Overlay cancelled.');
        else setError(`Overlay failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [overlayPlan, pairBatch, library, openCreated],
  );

  /**
   * Redaction and Erase Content: the content under the areas is removed from the file (text,
   * lines and shapes, picture pixels). Redaction also covers the areas in black and removes the
   * redaction marks and any markups over them. Afterwards the pages' text is read again to check
   * nothing is left inside the areas.
   */
  const runRedact = useCallback(
    async (cur: OpenFile, intoB: boolean, mode: 'redact' | 'erase', areas: { pageIndex: number; rect: { x: number; y: number; w: number; h: number } }[], options?: RedactOptions) => {
      if (!ctl || !areas.length) return;
      if (studioDocOf(cur.file.id)) throw new Error('A Live Session document is shared with others, so its content cannot be changed here.');
      const regions = [...new Set(areas.map((a) => a.pageIndex))].map((pageIndex) => ({ pageIndex, rects: areas.filter((a) => a.pageIndex === pageIndex).map((a) => a.rect) }));
      const redacting = mode === 'redact';
      if (!(await rewriteSigned(cur.doc, redacting ? 'Redaction' : 'Erase Content'))) return;
      const hex = options?.fill ?? '#000000';
      const n = parseInt(hex.slice(1), 16);
      const fill: [number, number, number] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      const redacted = await ctl.engine.redact(await readFile(cur.file.hash), {
        regions,
        fill: redacting ? fill : null,
        imageFill: redacting ? fill : [1, 1, 1],
        ...(redacting && options?.text ? { overlayText: options.text, overlayTextColor: contrastOn(hex) } : {}),
      });
      const report = redacted.report;
      let bytes = redacted.bytes;
      if (redacting && options?.stripMetadata) {
        const { stripMetadata } = await import('./documents/process');
        bytes = (await stripMetadata(bytes)).slice().buffer;
      }
      const overlaps = (m: Markup) => {
        const b = boundsOf(m.points);
        return areas.some((a) => a.pageIndex === m.pageIndex && b.x < a.rect.x + a.rect.w && b.x + b.w > a.rect.x && b.y < a.rect.y + a.rect.h && b.y + b.h > a.rect.y);
      };
      const gone = redacting ? cur.store.all().filter((m) => m.type === 'redaction' || overlaps(m)) : [];
      await swapDocument(cur, intoB, bytes, () => gone.length && cur.store.remove(gone.map((m) => m.id)));
      // Search matches that were redacted no longer exist.
      if (redacting) {
        searchHits.current = [];
        (intoB ? ctlB : ctl)?.tools.setHighlights([]);
      }
      // Verify: no words left inside the areas.
      const doc = (intoB ? openBRef.current : openRef.current)?.doc;
      let left = 0;
      for (const { pageIndex, rects } of regions) {
        const words = (await doc?.text(pageIndex)) ?? [];
        // The overlay's own label is not left-over text.
        const label = new Set((options?.text ?? '').split(/\s+/).filter(Boolean));
        left += words.filter((w) => {
          if (redacting && label.has(w.text)) return false;
          const cx = (w.x0 + w.x1) / 2;
          const cy = (w.y0 + w.y1) / 2;
          return rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h);
        }).length;
      }
      const what = `${report.chars} character${report.chars === 1 ? '' : 's'}, ${report.paths} line${report.paths === 1 ? '' : 's'} or shape${report.paths === 1 ? '' : 's'}, ${report.images} picture${report.images === 1 ? '' : 's'}`;
      const markupNote = gone.filter((m) => m.type !== 'redaction').length ? `, and ${gone.filter((m) => m.type !== 'redaction').length} markup(s) over them` : '';
      if (left || report.skipped) setError(`${redacting ? 'Redaction' : 'Erase'} removed ${what}${markupNote}, but ${left ? `${left} word(s) can still be read inside the areas` : `${report.skipped} item(s) inside embedded forms could not be removed`}${redacting ? ' (they are covered by the black box)' : ''}. Check the file before sharing it.`);
      else setNotice(`${redacting ? 'Redacted' : 'Erased'}: removed ${what}${markupNote}. Checked: no text is left in the ${redacting ? 'redacted' : 'erased'} areas.`);
    },
    [ctl, ctlB, swapDocument],
  );
  /** Edit Text: the text object clicked is shown, its new text asked for, and replaced in the file. */
  editTextRef.current = (pageIndex, at) => {
    const cur = activeOpen;
    const c = paneB ? ctlB : ctl;
    if (!cur || !c || !ctl) return;
    if (studioDocOf(cur.file.id)) {
      setError('A Live Session document is shared with others, so its content cannot be changed here.');
      return;
    }
    void (async () => {
      const obj = await cur.doc.textObjectAt(pageIndex, at[0], at[1]);
      if (!obj) {
        // Clicking where there is no text adds new text to the page there.
        const text = await askText('Add Text', '', { label: 'New text for the page (Helvetica, 10 pt; Enter a line break as \\n). It becomes part of the PDF, not a markup.', confirm: 'Add' });
        if (!text) return;
        const bytes = await ctl.engine.addText(await readFile(cur.file.hash), pageIndex, at[0], at[1], text.replace(/\\n/g, '\n'));
        await swapDocument(cur, paneB, bytes);
        return;
      }
      c.tools.flash(pageIndex, obj.rect);
      const text = await askText('Edit text', obj.text, { label: 'Text', confirm: 'Replace' });
      if (text === null || text === obj.text) return;
      const { bytes, keptFont } = await ctl.engine.replaceText(await readFile(cur.file.hash), pageIndex, obj.index, text);
      await swapDocument(cur, paneB, bytes);
      if (!keptFont) setNotice("The text's own font does not have all the new characters, so it is set in Helvetica.");
    })().catch((err) => setError(`Edit text failed: ${err instanceof Error ? err.message : String(err)}`));
  };
  eraseRef.current = (pageIndex, rect) => {
    const cur = activeOpen;
    if (cur) void runRedact(cur, paneB, 'erase', [{ pageIndex, rect }]).catch((err) => setError(`Erase failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  /** Flatten, Unflatten, Repair, Reduce File Size and Colour Processing (Document menu). */
  const runProcess = useCallback(
    async (cur: OpenFile, spec: ProcessSpec | { kind: 'unflatten' } | { kind: 'repair' }, revisionNote?: string): Promise<string | null> => {
      if (studioDocOf(cur.file.id)) throw new Error('A Live Session document is shared with others, so it cannot be changed here.');
      const rewrites: Partial<Record<typeof spec.kind, string>> = { repair: 'Repair', reduce: 'Reduce File Size', colour: 'Colour Processing' };
      const rewriting = rewrites[spec.kind];
      if (rewriting && !(await rewriteSigned(cur.doc, rewriting))) return null;
      const p = await import('./documents/process');
      switch (spec.kind) {
        case 'flatten': {
          // Links (sheet links and hyperlink markups) stay interactive in the app and are written as
          // links on save, so they are neither burned in nor written here.
          const links = cur.store.all().filter((m) => m.type === 'hyperlink');
          const markups = cur.store.all().filter((m) => m.type !== 'hyperlink');
          const exported = await annotatedBytes(cur, { links: false, markups });
          const { bytes, count } = await p.flattenAnnotations(exported, spec.recovery ? JSON.stringify(markups) : null);
          await commitDocument(cur, bytes.slice().buffer, () => cur.store.resetMarkups(links), revisionNote);
          return `Flattened ${count} markup${count === 1 ? '' : 's'}${spec.recovery ? '; Document › Unflatten brings them back' : ''}.`;
        }
        case 'unflatten': {
          const { bytes, recovery } = await p.unflatten(await readFile(cur.file.hash));
          if (recovery === null) return 'This file has no flattened markups to recover.';
          const markups = JSON.parse(recovery) as Markup[];
          const kept = cur.store.all().filter((m) => !markups.some((r) => r.id === m.id));
          await commitDocument(cur, bytes.slice().buffer, () => cur.store.resetMarkups([...kept, ...markups]), revisionNote);
          return `Recovered ${markups.length} markup${markups.length === 1 ? '' : 's'}.`;
        }
        case 'repair': {
          if (!ctl) return null;
          // PDFium reads what it can of a damaged file; saving writes a clean copy.
          const bytes = await ctl.engine.editPdf(await readFile(cur.file.hash), [], [], { rewrite: true });
          await commitDocument(cur, bytes, undefined, revisionNote);
          return 'Repaired: the file was read and written again as a clean copy.';
        }
        case 'reduce': {
          const before = cur.file.size;
          const recompress = spec.recompress ? (jpeg: Uint8Array) => recompressJpeg(jpeg, spec.quality) : undefined;
          const { bytes, images } = await p.reduceFileSize(await readFile(cur.file.hash), recompress);
          if (bytes.length >= before) return 'The file is already as small as this can make it.';
          await commitDocument(cur, bytes.slice().buffer, undefined, revisionNote);
          const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
          return `Reduced from ${mb(before)} to ${mb(bytes.length)}${images ? ` (${images} picture${images === 1 ? '' : 's'} recompressed)` : ''}.`;
        }
        case 'colour': {
          const bytes = await p.recolourPages(await readFile(cur.file.hash), spec.pages, spec.mode, recolourJpeg);
          await commitDocument(cur, bytes.slice().buffer, undefined, revisionNote);
          return `Changed the colours of ${spec.pages.length} page${spec.pages.length === 1 ? '' : 's'}.`;
        }
      }
    },
    [ctl, commitDocument],
  );

  /** Extract, Split, Replace, Crop and Page Setup (Document menu). */
  /**
   * Slip Sheet: pages of new revision files replace the pages with the same sheet numbers (or in
   * page order); unmatched sheets can be added at the end. Markups stay on their pages, moved to
   * line up with the new sheets if asked. The set as it was is kept as a revision.
   */
  const runSlipSheet = useCallback(
    async (cur: OpenFile, intoB: boolean, spec: SlipSheetSpec) => {
      if (!ctl) return;
      if (studioDocOf(cur.file.id)) {
        setError('Pages of a Live Session document cannot be changed: everyone in the session shares the same file.');
        return;
      }
      // The Slip Sheet job below shows progress; this one keeps page operations off until the end.
      const job = startJob('Slip Sheet', { ...PAGES_JOB, shown: false });
      try {
        const report = await runJob(`Slip Sheet · ${cur.file.name}`, async ({ signal, progress }) => {
          const { detectSheets } = await import('@nb/sheets');
          const { planSlipSheet } = await import('./documents/slipSheet');
          const tools = await import('./documents/pageTools');
          const { comparePages, DEFAULT_COMPARE } = await import('./compare/compare');
          const cancelled = () => {
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          };
          const library = await listFiles();
          const opened: { name: string; bytes: ArrayBuffer; doc: PdfDocument; sheets: (SheetInfo | undefined)[] }[] = [];
          try {
            const incoming: IncomingPage[] = [];
            for (let s = 0; s < spec.sources.length; s++) {
              cancelled();
              const src = spec.sources[s]!;
              const name = src.kind === 'file' ? src.file.name : src.name;
              progress(s, spec.sources.length, `Reading ${name}`);
              const stored = src.kind === 'library' ? library.find((f) => f.id === src.id) : null;
              if (src.kind === 'library' && !stored) throw new Error(`${name} is no longer in the library`);
              const bytes = src.kind === 'file' ? await src.file.arrayBuffer() : await readFile(stored!.hash);
              // The engine takes the buffer it is given, so it gets a copy.
              const doc = await ctl.engine.open(bytes.slice(0));
              const texts: PageText[] = [];
              for (let i = 0; i < doc.pages.length; i++) texts.push({ ...doc.pages[i]!, words: await doc.text(i) });
              const sheets = detectSheets(texts);
              opened.push({ name, bytes, doc, sheets });
              doc.pages.forEach((_, page) => incoming.push({ source: s, page, label: sheets[page]?.number ?? null }));
            }
            const targetLabels = cur.doc.pages.map((_, i) => cur.store.allSheets()[i]?.number ?? null);
            const plan = planSlipSheet(targetLabels, incoming, spec.mode, spec.addUnmatched);
            const labelOf = (p: IncomingPage) => p.label ?? `${opened[p.source]!.name} p${p.page + 1}`;
            if (!plan.replace.length && !plan.add.length) return { plan, labelOf };

            const moves = new Map<number, { scale: number; dx: number; dy: number }>();
            if (spec.alignMarkups)
              for (let k = 0; k < plan.replace.length; k++) {
                cancelled();
                const r = plan.replace[k]!;
                progress(k, plan.replace.length, `Lining up ${labelOf(r.incoming)}`);
                // A sheet reissued at another paper size is scaled to it as well.
                const { transform: t } = await comparePages(cur.doc, opened[r.incoming.source]!.doc, { oldPage: r.target, newPage: r.incoming.page }, { ...DEFAULT_COMPARE, graphics: false, text: false, scaleToFit: true });
                if (Math.hypot(t[4], t[5]) > 0.5 || Math.abs(t[0] - 1) > 0.001) moves.set(r.target, { scale: t[0], dx: t[4], dy: t[5] });
              }
            cancelled();
            progress(1, 1, 'Replacing sheets');
            let bytes: ArrayBuffer | Uint8Array = await readFile(cur.file.hash);
            for (let s = 0; s < opened.length; s++) {
              const reps = plan.replace.filter((r) => r.incoming.source === s);
              if (reps.length)
                bytes = await tools.replacePages(
                  bytes,
                  opened[s]!.bytes,
                  reps.map((r) => r.target),
                  reps.map((r) => r.incoming.page),
                );
            }
            for (const p of plan.add) bytes = await tools.appendPages(bytes, opened[p.source]!.bytes, [p.page]);
            const replacedLabels = plan.replace.map((r) => labelOf(r.incoming));
            await keepRevision(cur.file.id, `Before Slip Sheet: ${[...replacedLabels, ...plan.add.map(labelOf)].slice(0, 6).join(', ')}${plan.replace.length + plan.add.length > 6 ? '…' : ''}`);
            const first = cur.doc.pages.length;
            await swapDocument(cur, intoB, bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0), () => {
              cur.store.forgetImported(plan.replace.map((r) => r.target));
              cur.store.transformPages(moves);
              cur.store.setDetectedSheets(plan.add.flatMap((p, k) => (opened[p.source]!.sheets[p.page] ? [[first + k, opened[p.source]!.sheets[p.page]!] as [number, SheetInfo]] : [])));
            });
            return { plan, labelOf };
          } finally {
            for (const o of opened) void o.doc.close();
          }
        });
        const { plan, labelOf } = report;
        const list = (items: IncomingPage[]) => items.slice(0, 8).map(labelOf).join(', ') + (items.length > 8 ? ` and ${items.length - 8} more` : '');
        const parts = [
          plan.replace.length ? `replaced ${plan.replace.length} sheet${plan.replace.length === 1 ? '' : 's'} (${list(plan.replace.map((r) => r.incoming))})` : '',
          plan.add.length ? `added ${plan.add.length} (${list(plan.add)})` : '',
          plan.skipped.length ? `left out ${plan.skipped.length} with no match (${list(plan.skipped)})` : '',
        ].filter(Boolean);
        setNotice(plan.replace.length || plan.add.length ? `Slip Sheet ${parts.join('; ')}. The set as it was is kept under Document › Revisions.` : `Slip Sheet found no matching sheets${parts.length ? `: ${parts.join('; ')}` : ''}.`);
        void refreshLibrary();
      } catch (err) {
        if (isAbort(err)) setNotice('Slip Sheet cancelled; the document was not changed.');
        else setError(`Slip Sheet failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        job.end();
      }
    },
    [ctl, swapDocument, refreshLibrary],
  );

  /** Revisions: a kept version made the document's contents again (the current one is kept too). */
  const restoreRevision = useCallback(
    async (fileId: string, r: FileRevision) => {
      try {
        await keepRevision(fileId, `Before restoring the version of ${new Date(r.savedAt).toLocaleString()}`);
        const bytes = await readFile(r.hash);
        const inA = tabsARef.current.find((t) => t.file.id === fileId);
        const inB = tabsBRef.current.find((t) => t.file.id === fileId);
        const tab = inA ?? inB;
        if (tab) {
          await swapDocument(tab, !inA, bytes, () => {
            tab.store.forgetImported(tab.doc.pages.map((_, i) => i));
          });
        } else {
          await replaceFileContent(fileId, bytes);
          forgetText(fileId);
        }
        setNotice('Restored. The version before it is kept as a revision.');
        void refreshLibrary();
      } catch (err) {
        setError(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [swapDocument, refreshLibrary],
  );

  // Sets list sheets without opening files: each open document's sheets are remembered.
  useEffect(() => {
    for (const [o, sheets] of [
      [open, sheetsA],
      [openB, sheetsB],
    ] as const)
      if (o && !studioDocOf(o.file.id)) drawingSets.setIndex(o.file.id, { pageCount: o.doc.pages.length, sheets: o.doc.pages.map((_, i) => (sheets[i] ? { ...(sheets[i].number ? { number: sheets[i].number } : {}), ...(sheets[i].title ? { title: sheets[i].title } : {}) } : null)) });
  }, [open, openB, sheetsA, sheetsB]);

  /** Sets: reads the sheet numbers of files that have not been opened (from their text if never detected). */
  const indexSetFiles = useCallback(
    async (fileIds: string[]) => {
      setIndexingSets(true);
      try {
        await runJob('Reading sheets', async ({ signal, progress }) => {
          const { detectSheets } = await import('@nb/sheets');
          for (let k = 0; k < fileIds.length; k++) {
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            progress(k, fileIds.length, library.find((f) => f.id === fileIds[k])?.name ?? '');
            let held: Awaited<ReturnType<typeof acquireDocument>>;
            try {
              held = await acquireDocument(fileIds[k]!);
            } catch {
              continue; // No longer in the library.
            }
            try {
              const { doc, store, file } = held.open;
              if (!Object.keys(store.allSheets()).length && !store.readOnly) {
                const texts: PageText[] = [];
                for (let i = 0; i < doc.pages.length; i++) texts.push({ ...doc.pages[i]!, words: await doc.text(i) });
                store.setDetectedSheets(detectSheets(texts).map((info, i) => [i, info] as [number, SheetInfo]));
              }
              const sheets = store.allSheets();
              drawingSets.setIndex(file.id, { pageCount: doc.pages.length, sheets: doc.pages.map((_, i) => (sheets[i] ? { ...(sheets[i].number ? { number: sheets[i].number } : {}), ...(sheets[i].title ? { title: sheets[i].title } : {}) } : null)) });
            } finally {
              held.release();
            }
          }
        });
      } catch (err) {
        if (!isAbort(err)) setError(`Reading sheets failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIndexingSets(false);
      }
    },
    [acquireDocument, library],
  );

  /** Sets: opens a sheet's file (or brings its tab to the front) at the sheet's page. */
  const openSetSheet = useCallback(
    async (fileId: string, page: number) => {
      const file = library.find((f) => f.id === fileId);
      if (!file) {
        setError('That file is no longer in the library.');
        return;
      }
      await openFromLibrary(file);
      const viewer = openBRef.current?.file.id === fileId && activePaneRef.current === 'b' ? ctlB?.viewer : openRef.current?.file.id === fileId ? ctl?.viewer : ctlB?.viewer;
      viewer?.goToPage(page);
    },
    [library, openFromLibrary, ctl, ctlB],
  );
  openSetSheetRef.current = openSetSheet;

  /**
   * The Batch menu: a document command run over library files one at a time (open ones in their
   * tabs, the rest headless), reporting each file's result. Auto-Link Sheets works on the files together.
   */
  const runBatch = useCallback(
    async (spec: BatchSpec, onResult: (r: BatchResult) => void) => {
      const label = BATCH_LABELS[spec.command.kind];
      const note = spec.keepRevisions ? `Before Batch ${label}` : undefined;
      const nameOf = (id: string) => library.find((f) => f.id === id)?.name ?? id;
      const fail = (fileId: string, err: unknown) => onResult({ fileId, name: nameOf(fileId), ok: false, message: err instanceof Error ? err.message : String(err) });
      try {
        await runJob(`Batch ${label}`, async (ctx) => {
          const { signal, progress } = ctx;
          const cancelled = () => {
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          };
          const command = spec.command;
          if (command.kind === 'link') {
            const { detectSheets } = await import('@nb/sheets');
            const { crossFileLinks } = await import('./documents/batchLink');
            const held: Awaited<ReturnType<typeof acquireDocument>>[] = [];
            try {
              const files = [];
              for (let k = 0; k < spec.fileIds.length; k++) {
                cancelled();
                const id = spec.fileIds[k]!;
                progress(k, spec.fileIds.length, `Reading ${nameOf(id)}`);
                try {
                  const h = await acquireDocument(id);
                  held.push(h);
                  const { doc, store, file } = h.open;
                  const pages: PageText[] = [];
                  for (let i = 0; i < doc.pages.length; i++) pages.push({ ...doc.pages[i]!, words: await doc.text(i) });
                  let sheets = store.allSheets();
                  if (!Object.keys(sheets).length && !store.readOnly) {
                    store.setDetectedSheets(detectSheets(pages).map((info, i) => [i, info] as [number, SheetInfo]));
                    sheets = store.allSheets();
                  }
                  files.push({ fileId: file.id, name: file.name, pages, numbers: pages.map((_, i) => sheets[i]?.number ?? null), store });
                } catch (err) {
                  fail(id, err);
                }
              }
              progress(spec.fileIds.length, spec.fileIds.length, 'Finding references');
              const links = crossFileLinks(files);
              const now = Date.now();
              for (const f of files) {
                const mine = links.filter((l) => l.fileId === f.fileId);
                if (f.store.readOnly) {
                  onResult({ fileId: f.fileId, name: f.name, ok: false, message: 'Read-only here (a shared document someone else controls).' });
                  continue;
                }
                // Links from an earlier run are replaced (older documents label them 'Batch Link').
                f.store.remove(f.store.all().filter((m) => m.type === 'hyperlink' && (m.subject === 'Auto-Link Sheets' || m.subject === 'Batch Link')).map((m) => m.id));
                for (const l of mine)
                  f.store.add({
                    id: crypto.randomUUID(),
                    type: 'hyperlink',
                    pageIndex: l.pageIndex,
                    points: [
                      [l.rect.x, l.rect.y],
                      [l.rect.x + l.rect.w, l.rect.y + l.rect.h],
                    ],
                    style: { ...DEFAULT_STYLES.hyperlink },
                    link: { kind: 'file', fileId: l.target.fileId, name: l.target.name, pageIndex: l.target.pageIndex, rect: l.target.rect, ...(l.target.label ? { label: l.target.label } : {}) },
                    subject: 'Auto-Link Sheets',
                    comment: l.label,
                    status: 'none',
                    author: authorRef.current,
                    createdAt: now,
                    modifiedAt: now,
                  });
                const targets = [...new Set(mine.map((l) => l.target.name))];
                onResult({ fileId: f.fileId, name: f.name, ok: true, message: mine.length ? `${mine.length} link${mine.length === 1 ? '' : 's'} to ${targets.join(', ')}` : 'No references to the other files' });
              }
            } finally {
              for (const h of held) h.release();
            }
            return;
          }

          const csv: string[] = [];
          const printed: Uint8Array[] = [];
          // Markup Summary as XML or PDF: rows gathered across the files.
          const xml: string[] = [];
          const summaryRows: { cells: string[]; color?: string }[] = [];
          let summaryCols: { key: string; label: string; width: number; align?: 'right' }[] = [];
          // Split: every part of every file, zipped together at the end.
          const splitParts: { name: string; data: Uint8Array }[] = [];
          // Headers & Footers: Bates numbers carry on across the files.
          let batesDone = 0;
          // Sign & Seal: the ID is unlocked (and its password checked) before any file changes.
          let signer: { id: import('./documents/digitalIds').UnlockedId; image?: Uint8Array } | null = null;
          if (command.kind === 'sign') {
            const record = digitalIds.list().find((r) => r.id === command.sign.idId);
            if (!record) throw new Error('That Digital ID is no longer on this device');
            const id = (await import('./documents/digitalIds')).unlockId(record, command.sign.password);
            const picture = command.sign.imageId ? signatures.get().find((x) => x.id === command.sign.imageId) : undefined;
            signer = { id, ...(picture ? { image: new Uint8Array(await (await fetch(picture.image)).arrayBuffer()) } : {}) };
          }
          const stampDef = command.kind === 'stamp' ? stampLibrary(profiles.active().state).find((x) => x.id === command.stampId) : null;
          if (command.kind === 'stamp' && !stampDef) throw new Error('That stamp is no longer in the library');
          for (let k = 0; k < spec.fileIds.length; k++) {
            cancelled();
            const id = spec.fileIds[k]!;
            progress(k, spec.fileIds.length, nameOf(id));
            let h: Awaited<ReturnType<typeof acquireDocument>>;
            try {
              h = await acquireDocument(id);
            } catch (err) {
              fail(id, err);
              continue;
            }
            const cur = h.open;
            try {
              if (command.kind !== 'summary' && command.kind !== 'print' && command.kind !== 'split' && studioDocOf(cur.file.id)) throw new Error('A Live Session document is shared with others, so it cannot be changed here.');
              const allPages = cur.doc.pages.map((_, i) => i);
              let message: string;
              switch (command.kind) {
                case 'summary': {
                  const set = cur.store.columnSet();
                  const scales = cur.store.allScales();
                  const viewports = cur.store.allViewports();
                  const all = cur.store.all();
                  const ctxCells: CellContext = {
                    scaleOf: (m) => scaleOfMarkup(m, scales[m.pageIndex] ?? DEFAULT_SCALE, viewports),
                    sheets: cur.store.allSheets(),
                    spaces: all.filter((m) => m.type === 'space'),
                    statuses: set.statuses,
                    columns: [],
                  };
                  const cols = listColumns([]);
                  const rows = buildRows(all, ctxCells, {}, null);
                  const text = (r: (typeof rows)[number], key: string) => {
                    const v = r.cells[key];
                    return v?.error ? `#${v.error}` : (v?.text ?? '');
                  };
                  if (command.format === 'csv') {
                    const lines = rowsToCsv(rows, cols).split('\r\n');
                    const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
                    if (!csv.length) csv.push(`File,${lines[0]}`);
                    for (const line of lines.slice(1)) csv.push(`${cell(cur.file.name)},${line}`);
                  } else if (command.format === 'xml') {
                    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    xml.push(`  <File name="${esc(cur.file.name)}" pages="${cur.doc.pages.length}">`);
                    for (const r of rows) {
                      xml.push(`    <Markup id="${esc(r.markup.id)}" type="${esc(r.markup.type)}" page="${r.markup.pageIndex + 1}">`);
                      for (const c of cols) {
                        const v = text(r, c.key);
                        if (v) xml.push(`      <Column name="${esc(c.label)}">${esc(v)}</Column>`);
                      }
                      xml.push('    </Markup>');
                    }
                    xml.push('  </File>');
                  } else {
                    summaryCols = cols.map((c) => ({ key: c.key, label: c.label, width: c.defaultWidth, ...(c.align ? { align: c.align } : {}) }));
                    for (const r of rows) summaryRows.push({ cells: [cur.file.name, ...cols.map((c) => text(r, c.key))], color: r.markup.style.stroke });
                  }
                  message = `${all.length} markup${all.length === 1 ? '' : 's'}`;
                  break;
                }
                case 'print': {
                  const { printablePdf } = await import('./documents/printPdf');
                  const source = command.content === 'document' ? await readFile(cur.file.hash) : await annotatedBytes(cur);
                  printed.push(await printablePdf(source, command.content, cur.doc.pages.map((_, i) => i)));
                  message = `${cur.doc.pages.length} page${cur.doc.pages.length === 1 ? '' : 's'}`;
                  break;
                }
                case 'ocr': {
                  const texts = await Promise.all(cur.doc.pages.map((_, i) => cur.doc.text(i)));
                  const pages = texts.flatMap((w, i) => (w.length ? [] : [i]));
                  if (!pages.length) {
                    message = 'Every page already has text';
                    break;
                  }
                  const count = await ocrDocument(cur, pages, command.dpi, { signal, progress: (d, t, st) => progress(k, spec.fileIds.length, `${nameOf(id)}: ${st ?? `${d}/${t}`}`) }, note);
                  message = `${count} word${count === 1 ? '' : 's'} on ${pages.length} page${pages.length === 1 ? '' : 's'}`;
                  break;
                }
                case 'stamp': {
                  if (cur.store.readOnly) throw new Error('Read-only here (a shared document someone else controls).');
                  const def = stampDef!;
                  const pages = command.pages === 'all' ? allPages : [command.pages === 'first' ? 0 : allPages.length - 1];
                  const now = Date.now();
                  const margin = 36;
                  for (const pageIndex of pages) {
                    const size = cur.doc.pages[pageIndex]!;
                    const content = resolveStamp(def, { user: authorRef.current, now: new Date(now), ...stampValuesFor(cur, pageIndex) });
                    const w = Math.min(command.width, size.width - margin * 2);
                    const h = w / stampAspect(content);
                    const x = command.position === 'center' ? (size.width - w) / 2 : command.position.endsWith('Left') ? margin : size.width - margin - w;
                    const y = command.position === 'center' ? (size.height - h) / 2 : command.position.startsWith('top') ? margin : size.height - margin - h;
                    cur.store.add({
                      id: crypto.randomUUID(),
                      type: 'stamp',
                      pageIndex,
                      points: [
                        [x, y],
                        [x + w, y + h],
                      ],
                      style: { ...DEFAULT_STYLES.stamp, stroke: def.color, width: 2 },
                      stamp: content,
                      subject: def.name,
                      status: 'none',
                      author: authorRef.current,
                      createdAt: now,
                      modifiedAt: now,
                    });
                  }
                  message = `${def.name} on ${pages.length} page${pages.length === 1 ? '' : 's'}`;
                  break;
                }
                case 'headerFooter': {
                  const { addHeaderFooter } = await import('./documents/headerFooter');
                  const date = new Date().toLocaleDateString();
                  const spec = { ...command.spec, bates: { ...command.spec.bates, start: command.spec.bates.start + batesDone } };
                  const bytes = await addHeaderFooter(await readFile(cur.file.hash), allPages, spec, (i) => ({ label: cur.store.allSheets()[i]?.number || String(i + 1), file: cur.file.name, date }));
                  await commitDocument(cur, bytes.slice().buffer, undefined, note);
                  batesDone += allPages.length;
                  message = `${allPages.length} page${allPages.length === 1 ? '' : 's'}`;
                  break;
                }
                case 'crop': {
                  const tools = await import('./documents/pageTools');
                  const crops = new Map<number, { x: number; y: number; w: number; h: number }>();
                  for (const i of allPages) {
                    const r = tools.marginRect(cur.doc.pages[i]!, command.margins);
                    if (r) crops.set(i, r);
                  }
                  if (!crops.size) throw new Error('Nothing would be left of the pages: use smaller margins.');
                  const { bytes, transforms } = await tools.cropPages(await readFile(cur.file.hash), crops);
                  await commitDocument(cur, bytes.slice().buffer, () => cur.store.transformPages(transforms), note);
                  message = `${crops.size} page${crops.size === 1 ? '' : 's'} cropped`;
                  break;
                }
                case 'pageSetup': {
                  const tools = await import('./documents/pageTools');
                  // Landscape pages get the paper turned.
                  const { width, height } = command.size;
                  const wide = allPages.filter((i) => cur.doc.pages[i]!.width > cur.doc.pages[i]!.height);
                  const tall = allPages.filter((i) => !wide.includes(i));
                  let bytes: Uint8Array = new Uint8Array(await readFile(cur.file.hash));
                  const transforms = new Map<number, { scale: number; dx: number; dy: number }>();
                  for (const [pages, size] of [
                    [tall, { width: Math.min(width, height), height: Math.max(width, height) }],
                    [wide, { width: Math.max(width, height), height: Math.min(width, height) }],
                  ] as const) {
                    if (!pages.length) continue;
                    const out = await tools.resizePages(bytes, pages, size, command.fit);
                    bytes = out.bytes;
                    for (const [k, v] of out.transforms) transforms.set(k, v);
                  }
                  await commitDocument(cur, bytes.slice().buffer, () => cur.store.transformPages(transforms), note);
                  message = `${allPages.length} page${allPages.length === 1 ? '' : 's'} resized`;
                  break;
                }
                case 'split': {
                  const tools = await import('./documents/pageTools');
                  const count = cur.doc.pages.length;
                  const marks = cur.store.bookmarks().sort((a, b) => a.pageIndex - b.pageIndex);
                  if (command.parts === 'bookmarks' && !marks.length) throw new Error('No bookmarks to split at');
                  const ranges = command.parts === 'bookmarks' ? tools.rangesFromStarts(count, marks.map((b) => b.pageIndex)) : tools.chunkPages(count, command.count);
                  const parts = await tools.splitPdf(await annotatedBytes(cur), ranges);
                  const base = cur.file.name.replace(/\.pdf$/i, '');
                  const safe = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '-').trim();
                  parts.forEach((data, i) => {
                    const title = command.parts === 'bookmarks' ? marks.find((b) => b.pageIndex === ranges[i]![0])?.title : undefined;
                    splitParts.push({ name: `${safe(base)}/${safe(base)} ${String(i + 1).padStart(2, '0')}${title ? ` ${safe(title)}` : ` p${ranges[i]![0]! + 1}-${ranges[i]!.at(-1)! + 1}`}.pdf`, data });
                  });
                  message = `${parts.length} part${parts.length === 1 ? '' : 's'}`;
                  break;
                }
                case 'sign': {
                  const { signPdf } = await import('./documents/pdfSign');
                  const c = command.sign;
                  const pageIndex = c.page === 'first' ? 0 : allPages.length - 1;
                  const size = cur.doc.pages[pageIndex]!;
                  const w = Math.min(216, size.width - 72);
                  const h = 72;
                  const area =
                    c.placement === 'invisible'
                      ? undefined
                      : { pageIndex, rect: { x: c.placement.endsWith('Left') ? 36 : size.width - 36 - w, y: c.placement.startsWith('top') ? 36 : size.height - 36 - h, w, h } };
                  const bytes = await signPdf(new Uint8Array(await readFile(cur.file.hash)), signer!.id, {
                    ...(area ? { area } : {}),
                    ...(c.reason ? { reason: c.reason } : {}),
                    ...(c.location ? { location: c.location } : {}),
                    ...(c.certify ? { certify: c.certify } : {}),
                    ...(signer!.image ? { image: signer!.image } : {}),
                    ...(c.timestampUrl ? { timestamp: async (value: Uint8Array) => (await import('./documents/pki')).fetchTimestamp(c.timestampUrl!, value, pkiFetch) } : {}),
                  });
                  await commitDocument(cur, bytes.slice().buffer, undefined, note);
                  message = `Signed${c.certify ? ' and certified' : ''}${c.timestampUrl ? ', time stamped' : ''}`;
                  break;
                }
                case 'pageLabels': {
                  // AutoMark: sheet numbers from the title blocks, then written as /PageLabels.
                  let sheets = cur.store.allSheets();
                  if (!Object.keys(sheets).length && !cur.store.readOnly) {
                    const { detectSheets } = await import('@nb/sheets');
                    const texts: PageText[] = [];
                    for (let i = 0; i < cur.doc.pages.length; i++) texts.push({ ...cur.doc.pages[i]!, words: await cur.doc.text(i) });
                    cur.store.setDetectedSheets(detectSheets(texts).map((info, i) => [i, info] as [number, SheetInfo]));
                    sheets = cur.store.allSheets();
                  }
                  const labels = allPages.map((i) => sheets[i]?.number || null);
                  const n = labels.filter(Boolean).length;
                  if (!n) {
                    message = 'No sheet numbers found';
                    break;
                  }
                  const [{ PDFDocument }, { writePageLabels }] = await Promise.all([import('pdf-lib'), import('@nb/markup/export')]);
                  const pdf = await PDFDocument.load(await readFile(cur.file.hash), { updateMetadata: false });
                  writePageLabels(pdf, labels);
                  await commitDocument(cur, (await pdf.save()).slice().buffer, undefined, note);
                  drawingSets.setIndex(cur.file.id, { pageCount: cur.doc.pages.length, sheets: cur.doc.pages.map((_, i) => (sheets[i] ? { ...(sheets[i].number ? { number: sheets[i].number } : {}), ...(sheets[i].title ? { title: sheets[i].title } : {}) } : null)) });
                  message = `${n} of ${allPages.length} page${allPages.length === 1 ? '' : 's'} labelled (${labels.filter(Boolean).slice(0, 3).join(', ')}${n > 3 ? '…' : ''})`;
                  break;
                }
                case 'removeHeaderFooter': {
                  const { hasHeaderFooter, removeHeaderFooter } = await import('./documents/headerFooter');
                  const bytes = await readFile(cur.file.hash);
                  if (!(await hasHeaderFooter(bytes))) {
                    message = 'No headers or footers added here';
                    break;
                  }
                  await commitDocument(cur, (await removeHeaderFooter(bytes)).slice().buffer, undefined, note);
                  message = 'Headers and footers removed';
                  break;
                }
                case 'colour':
                  message = (await runProcess(cur, { kind: 'colour', mode: command.mode, pages: cur.doc.pages.map((_, i) => i) }, note)) ?? 'Done';
                  break;
                case 'flatten':
                  if (!cur.store.all().some((m) => m.type !== 'hyperlink')) {
                    message = 'No markups to flatten';
                    break;
                  }
                  message = (await runProcess(cur, command, note)) ?? 'Done';
                  break;
                default:
                  message = (await runProcess(cur, command, note)) ?? 'Done';
              }
              onResult({ fileId: id, name: cur.file.name, ok: true, message });
            } catch (err) {
              if (isAbort(err)) throw err;
              fail(id, err);
            } finally {
              h.release();
            }
          }
          if (csv.length) download('Markup summary.csv', new Blob(['\uFEFF' + csv.join('\r\n')], { type: 'text/csv' }));
          if (xml.length) download('Markup summary.xml', new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<MarkupSummary created="${new Date().toISOString()}" author="${authorRef.current.replace(/[<>&"]/g, '')}">\n${xml.join('\n')}\n</MarkupSummary>\n`], { type: 'application/xml' }));
          if (command.kind === 'summary' && command.format === 'pdf' && summaryCols.length) {
            const { summaryPdf } = await import('@nb/markup/summary');
            // Only columns some markup has a value in (File always).
            const used = summaryCols.map((_, i) => summaryRows.some((r) => r.cells[i + 1]?.trim()));
            summaryCols = summaryCols.filter((_, i) => used[i]);
            for (const r of summaryRows) r.cells = [r.cells[0]!, ...r.cells.slice(1).filter((_, i) => used[i])];
            const out = await summaryPdf({
              title: 'Markup Summary',
              subtitle: `${spec.fileIds.length} file${spec.fileIds.length === 1 ? '' : 's'} · ${summaryRows.length} markup${summaryRows.length === 1 ? '' : 's'} · ${new Date().toLocaleString()} by ${authorRef.current}`,
              columns: [{ label: 'File', width: 160 }, ...summaryCols.map(({ key: _, ...c }) => c)],
              rows: summaryRows,
            });
            download('Markup summary.pdf', new Blob([out as BlobPart], { type: 'application/pdf' }));
          }
          if (splitParts.length) {
            const { zipFiles } = await import('./documents/zip');
            download('Split files.zip', new Blob([zipFiles(splitParts) as BlobPart], { type: 'application/zip' }));
          }
          if (printed.length) {
            // One document, so one print dialog prints them all.
            const [{ PDFDocument }, { printPdfBytes }] = await Promise.all([import('pdf-lib'), import('./documents/printPdf')]);
            const all = await PDFDocument.create();
            for (const bytes of printed) {
              const part = await PDFDocument.load(bytes, { ignoreEncryption: true });
              for (const page of await all.copyPages(part, part.getPageIndices())) all.addPage(page);
            }
            printPdfBytes(await all.save());
          }
        });
      } catch (err) {
        if (!isAbort(err)) setError(`Batch ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
        else setNotice(`Batch ${label} cancelled; files already done keep their changes.`);
      }
      void refreshLibrary();
    },
    [library, acquireDocument, runProcess, ocrDocument, commitDocument, refreshLibrary],
  );

  // --- Forms ---------------------------------------------------------------------------------

  // Each open document's form is read from its file (and read again after every change, as the
  // contents' hash changes).
  const formReading = useRef(new Set<string>());
  useEffect(() => {
    for (const o of [open, openB]) {
      if (!o || formModels[o.file.hash] || formReading.current.has(o.file.hash)) continue;
      const hash = o.file.hash;
      formReading.current.add(hash);
      void (async () => {
        let model: FormModel = { fields: [], calcOrder: [] };
        try {
          const { readForm } = await import('./documents/forms');
          model = await readForm(await readFile(hash));
        } catch {
          // A form that can't be read shows as no form.
        }
        setFormModels((cur) => ({ ...cur, [hash]: model }));
        formReading.current.delete(hash);
      })();
    }
  }, [open, openB, formModels]);

  // Widgets go to each pane's tools, for clicking to fill in.
  useEffect(() => {
    for (const [o, c] of [
      [open, ctl],
      [openB, ctlB],
    ] as const) {
      if (!c) continue;
      const model = o ? formModels[o.file.hash] : undefined;
      const locked = !!o && !!studioDocOf(o.file.id);
      c.tools.setFormWidgets(
        (model?.fields ?? []).flatMap((f) =>
          f.type === 'button' && !f.action ? [] : f.widgets.map((w) => ({ name: f.name, pageIndex: w.pageIndex, rect: w.rect, ...(w.onValue !== undefined ? { onValue: w.onValue } : {}), readOnly: f.type === 'button' ? false : locked || f.readOnly || !!f.calculation })),
        ),
      );
    }
  }, [open, openB, ctl, ctlB, formModels]);

  /** Form edits run one after another, each on the document's current contents. */
  const formQueue = useRef<Promise<unknown>>(Promise.resolve());
  const editForm = useCallback(
    (fileId: string, what: string, edit: (bytes: ArrayBuffer) => Promise<Uint8Array | { bytes: Uint8Array; model: FormModel }>, revisionNote?: string): Promise<boolean> => {
      const run = formQueue.current
        .then(async () => {
          const cur = [...tabsARef.current, ...tabsBRef.current].find((t) => t.file.id === fileId);
          if (!cur) return false;
          if (studioDocOf(fileId)) throw new Error('A Live Session document is shared with others, so it cannot be changed here.');
          return runJob(
            what,
            async () => {
              const out = await edit(await readFile(cur.file.hash));
              const { bytes, model } = out instanceof Uint8Array ? { bytes: out, model: null } : out;
              // A known form is noted for the new contents before the tab shows them, so it is not read again.
              const seed = model ? (file: StoredFile) => setFormModels((all) => ({ ...all, [file.hash]: model })) : undefined;
              await commitDocument(cur, bytes.slice().buffer, seed, revisionNote);
              return true;
            },
            { kind: 'form', cancellable: false, shown: false },
          );
        })
        .catch((err) => {
          setError(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        });
      formQueue.current = run;
      return run;
    },
    [commitDocument],
  );

  const fillFields = useCallback(
    (fileId: string, values: Record<string, string>) =>
      editForm(fileId, 'Filling in the form', async (bytes) => (await import('./documents/forms')).fillForm(bytes, values, { validate: true })),
    [editForm],
  );

  formFieldRef.current = (pane, w) => {
    const o = pane === 'b' ? openBRef.current : openRef.current;
    const field = o ? formModels[o.file.hash]?.fields.find((f) => f.name === w.name) : undefined;
    if (!o || !field) return;
    setSelectedField(field.name);
    if (w.readOnly) return;
    switch (field.type) {
      case 'checkbox':
        void fillFields(o.file.id, { [field.name]: field.value !== 'Off' && field.value !== '' ? 'Off' : (w.onValue ?? 'Yes') });
        return;
      case 'radio':
        if (w.onValue && w.onValue !== field.value) void fillFields(o.file.id, { [field.name]: w.onValue });
        return;
      case 'text':
      case 'dropdown':
      case 'list': {
        const widget = field.widgets.findIndex((x) => x.pageIndex === w.pageIndex && x.rect.x === w.rect.x && x.rect.y === w.rect.y);
        setFormFieldEdit({ pane, name: field.name, widget: Math.max(0, widget) });
        return;
      }
      case 'signature':
        if (field.value) {
          setLeftTab('signatures');
          setLeftOpen(true);
        } else setSignFor({ fieldName: field.name });
        return;
      case 'button':
        void runButton(o, field);
        return;
      default:
    }
  };

  /** A form button's action: a web page, a page, Reset, Print, or submitting the form's data. */
  const runButton = async (o: OpenFile, field: FormField) => {
    const a = field.action;
    if (!a) return;
    switch (a.kind) {
      case 'url':
        if (/^(https?|mailto):/i.test(a.url)) window.open(a.url, '_blank', 'noopener');
        else setError(`The button’s address is not a web address: ${a.url}`);
        return;
      case 'page':
        navigate(Math.min(a.pageIndex, o.doc.pages.length - 1), null);
        return;
      case 'reset':
        void editForm(o.file.id, 'Resetting the form', async (bytes) => (await import('./documents/forms')).resetForm(bytes));
        return;
      case 'print':
        setPrintOpen(true);
        return;
      case 'submit': {
        const { toXfdf } = await import('./documents/forms');
        const xfdf = toXfdf(formModels[o.file.hash]?.fields ?? [], o.file.name);
        if (/^mailto:/i.test(a.url)) {
          // Mail apps take no attachments from a link: the data is downloaded to attach.
          download(`${o.file.name.replace(/\.pdf$/i, '')} form data.xfdf`, new Blob([xfdf], { type: 'application/vnd.adobe.xfdf' }));
          window.open(`${a.url}${a.url.includes('?') ? '&' : '?'}subject=${encodeURIComponent(`Form data: ${o.file.name}`)}&body=${encodeURIComponent('The form data is attached (XFDF).')}`, '_blank');
          setNotice('The form data was saved as an XFDF file; attach it to the email that opened.');
          return;
        }
        try {
          const res = await fetch(a.url, { method: 'POST', headers: { 'content-type': 'application/vnd.adobe.xfdf' }, body: xfdf });
          setNotice(res.ok ? `Form submitted to ${new URL(a.url).host}.` : `Submitting failed: ${new URL(a.url).host} answered ${res.status}.`);
        } catch {
          setError(`Could not submit the form to ${a.url} (the server may not accept requests from this app).`);
        }
        return;
      }
    }
  };

  const FIELD_BASE: Record<NewFieldType, string> = { text: 'Text', checkbox: 'Check Box', radio: 'Radio Group', dropdown: 'Dropdown', list: 'List', button: 'Button', signature: 'Signature' };
  formDrawnRef.current = (pane, pageIndex, rect) => {
    const o = pane === 'b' ? openBRef.current : openRef.current;
    if (!o) return;
    const signing = pendingSign.current;
    if (signing) {
      // The box for a signature being made: sign there.
      pendingSign.current = null;
      (pane === 'b' ? ctlB : ctl)?.tools.setTool('select');
      void runSign(o.file.id, signing, { area: { pageIndex, rect } }).catch((err) => setError(`Signing failed: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    const model = formModels[o.file.hash];
    const names = (model?.fields ?? []).map((f) => f.name);
    const selected = model?.fields.find((f) => f.name === selectedField);
    void (async () => {
      const { createFields, uniqueName } = await import('./documents/forms');
      // A radio button drawn while a radio group is selected joins that group.
      const joining = newFieldType === 'radio' && selected?.type === 'radio';
      const name = joining ? selected.name : uniqueName(FIELD_BASE[newFieldType], names);
      const options = newFieldType === 'radio' ? [uniqueName('Choice', joining ? selected.options : [])] : undefined;
      await editForm(o.file.id, 'Adding the field', (bytes) => createFields(bytes, [{ type: newFieldType, name, pageIndex, rect, ...(options ? { options } : {}) }]));
      setSelectedField(name);
      setLeftTab('forms');
      setLeftOpen(true);
    })();
  };

  // --- Digital signatures --------------------------------------------------------------------

  // The front document's signatures are checked while the Signatures panel is showing.
  const checkingSigs = useRef(new Set<string>());
  useEffect(() => {
    const o = split && activePane === 'b' ? openB : open;
    if (!o || leftTab !== 'signatures' || sigChecks[o.file.hash] || checkingSigs.current.has(o.file.hash)) return;
    const hash = o.file.hash;
    checkingSigs.current.add(hash);
    void (async () => {
      let checks: SignatureCheck[] = [];
      try {
        const { checkSignatures } = await import('./documents/pdfSign');
        checks = await checkSignatures(new Uint8Array(await readFile(hash)));
      } catch {
        // Unreadable: shown as no signatures.
      }
      setSigChecks((cur) => ({ ...cur, [hash]: checks }));
      checkingSigs.current.delete(hash);
    })();
  }, [open, openB, split, activePane, leftTab, sigChecks]);

  /** Signs the document (an empty field, a drawn box, or invisibly) and keeps the version before as a revision. */
  const runSign = useCallback(
    async (fileId: string, c: SignChoice, target: { fieldName?: string; area?: { pageIndex: number; rect: { x: number; y: number; w: number; h: number } } }) => {
      const record = digitalIds.list().find((r) => r.id === c.idId);
      if (!record) throw new Error('That Digital ID is no longer on this device');
      const { unlockId } = await import('./documents/digitalIds');
      const { signPdf } = await import('./documents/pdfSign');
      const id = unlockId(record, c.password);
      const picture = c.imageId ? signatures.get().find((p) => p.id === c.imageId) : undefined;
      const image = picture ? new Uint8Array(await (await fetch(picture.image)).arrayBuffer()) : undefined;
      const ok = await editForm(
        fileId,
        'Signing',
        async (bytes) =>
          signPdf(new Uint8Array(bytes), id, {
            ...target,
            ...(c.reason ? { reason: c.reason } : {}),
            ...(c.location ? { location: c.location } : {}),
            ...(c.certify ? { certify: c.certify } : {}),
            ...(image ? { image } : {}),
            ...(c.timestampUrl ? { timestamp: async (value: Uint8Array) => (await import('./documents/pki')).fetchTimestamp(c.timestampUrl!, value, pkiFetch) } : {}),
          }),
        'Before signing',
      );
      if (!ok) return;
      setNotice(`Signed by ${record.name}${c.certify ? ' and certified' : ''}. The version before signing is kept under Document › Revisions.`);
      setLeftTab('signatures');
      setLeftOpen(true);
    },
    [editForm],
  );

  /** Shows a field's first widget. */
  const goToField = (f: FormField) => {
    const w = f.widgets[0];
    if (!w) return;
    const pad = 40;
    navigate(w.pageIndex, { x: w.rect.x - pad, y: w.rect.y - pad, w: w.rect.w + pad * 2, h: w.rect.h + pad * 2 });
  };

  const runPageTool = useCallback(
    async (cur: OpenFile, intoB: boolean, spec: PageToolSpec) => {
      const tools = await import('./documents/pageTools');
      const base = cur.file.name.replace(/\.pdf$/i, '');
      const writes = spec.kind === 'replace' || spec.kind === 'crop' || spec.kind === 'setup';
      if (writes && studioDocOf(cur.file.id)) throw new Error('Pages of a Live Session document cannot be changed: everyone in the session shares the same file.');
      const zipDownload = async (name: string, parts: Uint8Array[], names: (i: number) => string) => {
        const { zipFiles } = await import('./documents/zip');
        download(name, new Blob([zipFiles(parts.map((data, i) => ({ name: names(i), data }))) as BlobPart], { type: 'application/zip' }));
      };
      switch (spec.kind) {
        case 'extract': {
          // With their markups.
          const bytes = await annotatedBytes(cur);
          if (spec.oneFilePerPage) {
            const parts = await tools.splitPdf(bytes, spec.pages.map((p) => [p]));
            await zipDownload(`${base} (pages).zip`, parts, (i) => `${base} p${spec.pages[i]! + 1}.pdf`);
          } else {
            const [part] = await tools.splitPdf(bytes, [spec.pages]);
            const label = spec.pages.length === 1 ? `page ${spec.pages[0]! + 1}` : `${spec.pages.length} pages`;
            download(`${base} (${label}).pdf`, new Blob([part! as BlobPart], { type: 'application/pdf' }));
          }
          if (spec.deleteAfter && spec.pages.length < cur.doc.pages.length) await applyPageOps([{ type: 'delete', pages: spec.pages }]);
          return;
        }
        case 'split': {
          const count = cur.doc.pages.length;
          const ranges = spec.parts === 'bookmarks' ? tools.rangesFromStarts(count, cur.store.bookmarks().map((b) => b.pageIndex)) : tools.chunkPages(count, spec.count);
          const titles = spec.parts === 'bookmarks' ? cur.store.bookmarks().sort((a, b) => a.pageIndex - b.pageIndex) : [];
          const parts = await tools.splitPdf(await annotatedBytes(cur), ranges);
          const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();
          await zipDownload(`${base} (split).zip`, parts, (i) => {
            const title = titles.find((b) => b.pageIndex === ranges[i]![0])?.title;
            return `${base} ${String(i + 1).padStart(2, '0')}${title ? ` ${safe(title)}` : ` p${ranges[i]![0]! + 1}-${ranges[i]!.at(-1)! + 1}`}.pdf`;
          });
          setNotice(`Split into ${parts.length} files.`);
          return;
        }
        case 'replace': {
          const bytes = await tools.replacePages(await readFile(cur.file.hash), await spec.file.arrayBuffer(), spec.targetPages, spec.sourcePages);
          await swapDocument(cur, intoB, bytes.slice().buffer, () => cur.store.forgetImported(spec.targetPages));
          return;
        }
        case 'crop': {
          const viewer = (intoB ? ctlB : ctl)?.viewer;
          const crops = new Map<number, { x: number; y: number; w: number; h: number }>();
          for (const p of spec.pages) {
            const size = viewer?.pageSize(p) ?? cur.doc.pages[p]!;
            let r = spec.rect ?? (spec.margins ? tools.marginRect(size, spec.margins) : null);
            if (!r) continue;
            // A drawn rectangle is clipped to each page.
            const x0 = Math.max(0, r.x);
            const y0 = Math.max(0, r.y);
            r = { x: x0, y: y0, w: Math.min(size.width, r.x + r.w) - x0, h: Math.min(size.height, r.y + r.h) - y0 };
            if (r.w > 1 && r.h > 1) crops.set(p, r);
          }
          if (!crops.size) throw new Error('Nothing would be left of the pages: use smaller margins.');
          const { bytes, transforms } = await tools.cropPages(await readFile(cur.file.hash), crops);
          await swapDocument(cur, intoB, bytes.slice().buffer, () => cur.store.transformPages(transforms));
          return;
        }
        case 'setup': {
          const { bytes, transforms } = await tools.resizePages(await readFile(cur.file.hash), spec.pages, spec.size, spec.fit);
          await swapDocument(cur, intoB, bytes.slice().buffer, () => cur.store.transformPages(transforms));
          return;
        }
      }
    },
    [applyPageOps, swapDocument, ctl, ctlB],
  );

  const extractPages = useCallback(async (pages: number[]) => {
    const intoB = activePaneRef.current === 'b';
    const cur = intoB ? openBRef.current : openRef.current;
    if (!cur || !ctl) return;
    const job = startJob(`Extract · ${cur.file.name}`, PAGES_JOB);
    try {
      const out = await ctl.engine.extractPages(await readFile(cur.file.hash), pages);
      const label = pages.length === 1 ? `page ${pages[0]! + 1}` : `${pages.length} pages`;
      download(`${cur.file.name.replace(/\.pdf$/i, '')} (${label}).pdf`, new Blob([out], { type: 'application/pdf' }));
    } catch (err) {
      setError(`Extract failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      job.end();
    }
  }, [ctl]);

  /**
   * Save writes the document with its markups as PDF annotations over the file it was opened from
   * (asking once for permission). Documents with no file on disk, and Save As, ask where to put it.
   */
  const [savedTick, setSavedTick] = useState(0);
  const saveDocument = useCallback(async (saveAs: boolean) => {
    const intoB = activePaneRef.current === 'b';
    const cur = intoB ? openBRef.current : openRef.current;
    if (!cur) return;
    const pane: Pane = intoB ? 'b' : 'a';
    // Marks the document saved and gives its tab the name of the file it was saved to.
    const saved = async (fileName: string) => {
      markSaved(cur);
      let now = cur;
      if (fileName !== cur.file.name) {
        const renamed = await renameFile(cur.file.id, fileName);
        if (renamed) {
          now = { ...cur, file: renamed };
          markSaved(now);
          setTabs(pane, tabsRefOf(pane).current.map((t) => (t === cur ? now : t)));
          if (openRefOf(pane).current === cur) setFront(pane, now);
          void refreshLibrary();
        }
      }
      setSavedTick((n) => n + 1);
      setNotice(`Saved ${fileName}.`);
    };
    try {
      const out = await annotatedBytes(cur);
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      const target = saveAs ? null : await recallHandle(cur.file.id);
      if (target) {
        if (await writeToHandle(target, blob)) await saved(target.name);
        else setError(`${target.name} was not saved: the browser did not allow writing to it.`);
        return;
      }
      const picked = await saveAsWithPicker(cur.file.name.endsWith('.pdf') ? cur.file.name : `${cur.file.name}.pdf`, 'application/pdf', blob);
      if (picked === 'unsupported') anchorDownload(cur.file.name.replace(/\.pdf$/i, '') + ' (markups).pdf', blob);
      else if (picked) {
        await rememberHandle(cur.file.id, picked);
        await saved(picked.name);
      }
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setTabs, setFront, refreshLibrary]);
  const exportPdf = useCallback(() => saveDocument(false), [saveDocument]);

  /**
   * Closes one tab. The next tab comes to the front; when the left pane runs out of tabs while
   * the right pane has some, the right pane's tabs move across and the split closes.
   */
  const closeTab = useCallback(
    (pane: Pane, fileId: string) => {
      const tabs = pane === 'b' ? tabsBRef.current : tabsARef.current;
      const idx = tabs.findIndex((t) => t.file.id === fileId);
      if (idx < 0) return;
      const closing = tabs[idx]!;
      const rest = tabs.filter((_, i) => i !== idx);
      setTabs(pane, rest);
      const front = pane === 'b' ? openBRef.current : openRef.current;
      if (front === closing) {
        const next = rest[Math.min(idx, rest.length - 1)] ?? null;
        if (next) showInPane(pane, next);
        else if (pane === 'b') {
          showInPane('b', null);
          setSplit(false);
          setActivePane('a');
        } else if (tabsBRef.current.length) {
          const moved = tabsBRef.current;
          const bFront = openBRef.current ?? moved[0]!;
          setTabs('b', []);
          showInPane('b', null);
          setTabs('a', moved);
          showInPane('a', bFront);
          setSplit(false);
          setActivePane('a');
        } else {
          showInPane('a', null);
          setLeftTab((tab) => (tab === 'sessions' || tab === 'projects' ? tab : 'files'));
          setLeftOpen(true);
        }
      }
      disposeOpen(closing);
    },
    [setTabs, showInPane],
  );

  /** Closes the split; the right pane's tabs join the left pane's. */
  const unsplit = useCallback(() => {
    const moved = tabsBRef.current;
    const bFront = openBRef.current;
    showInPane('b', null);
    setTabs('b', []);
    setTabs('a', [...tabsARef.current, ...moved]);
    if (!openRef.current && bFront) showInPane('a', bFront);
    setSplit(false);
    setActivePane('a');
  }, [setTabs, showInPane]);

  /** Closes the tab in front of the active pane. */
  const closeDocument = useCallback(() => {
    const pane: Pane = activePaneRef.current === 'b' && openBRef.current ? 'b' : 'a';
    const front = pane === 'b' ? openBRef.current : openRef.current;
    if (front) closeTab(pane, front.file.id);
    else if (pane === 'a' && split) unsplit();
  }, [closeTab, unsplit, split]);

  /** Closes the tabs showing documents from one Live Session (all of them, or one document). */
  const closeStudioDocs = useCallback(
    (sessionId: string, docId?: string) => {
      for (const pane of ['b', 'a'] as const) {
        for (const t of pane === 'b' ? tabsBRef.current : tabsARef.current) {
          const d = studioDocOf(t.file.id);
          if (d && d.sessionId === sessionId && (!docId || d.docId === docId)) closeTab(pane, t.file.id);
        }
      }
    },
    [closeTab],
  );

  studioRemovedRef.current = (sessionId, docId) => {
    const name = sessionById(sessionId)?.meta.documents.find((d) => d.id === docId)?.name;
    const fileId = studioFileId(sessionId, docId);
    const wasOpen = [...tabsARef.current, ...tabsBRef.current].some((t) => t.file.id === fileId);
    closeStudioDocs(sessionId, docId);
    if (wasOpen) setError(`${name ?? 'A document'} was removed from the session.`);
  };

  /** Opens a session document in a tab: downloads it (or uses this device's copy offline) and syncs its markups. */
  const openSessionDocument = useCallback(
    async (sessionId: string, docId: string, seed?: Uint8Array | null) => {
      const session = sessionById(sessionId);
      const info = session?.meta.documents.find((d) => d.id === docId);
      if (!session || !info) return;
      const fileId = studioFileId(session.id, docId);
      try {
        let bytes: ArrayBuffer;
        let hash: string;
        try {
          bytes = await session.fetchDocument(docId);
          hash = await cacheFile(bytes.slice(0));
          rememberStudioHash(fileId, hash);
        } catch (err) {
          const cached = cachedStudioHash(fileId);
          if (!cached) throw err;
          hash = cached;
          bytes = await readFile(cached);
        }
        if (seed) studioSeeds.current.set(fileId, seed);
        loadedVersions.current.set(fileId, info.version ?? 1);
        const file: StoredFile = { id: fileId, hash, name: info.name, size: info.size, addedAt: info.addedAt, lastOpenedAt: Date.now() };
        await openStored(file, bytes, split && activePaneRef.current === 'b' ? 'b' : 'a');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [openStored, split],
  );

  /** Runs a session action with the panel's busy state; resolves false (and shows why) if it failed. */
  const runStudio = useCallback(async (job: () => Promise<void>): Promise<boolean> => {
    setStudioError(null);
    try {
      await runJob('Live Session', job, { kind: 'studio', cancellable: false, shown: false });
      return true;
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  /** Adds a joined session alongside any others (replacing an older copy of the same one) and shows it. */
  const enterStudio = useCallback((session: CollabSession) => {
    const old = sessionsRef.current.find((s) => s.id === session.id);
    old?.destroy();
    sessionsRef.current = [...sessionsRef.current.filter((s) => s !== old), session];
    setSessions(sessionsRef.current);
    setFocusedSession(session.id);
  }, []);

  /** Removed-document callbacks for a session whose id is only known once it has been created. */
  const removedHandler = () => {
    const holder = { id: '' };
    return { holder, onRemoved: (docId: string) => studioRemovedRef.current(holder.id, docId) };
  };

  /**
   * Joins a session (as well as any already joined). For Google Drive, `interactive` (from a
   * click) signs in and, the first time, asks the user to pick the session folder in Google's
   * Picker, which is what grants this app access to it. Without a click (rejoining on page load)
   * it reads at once and asks to reconnect.
   */
  const joinStudio = useCallback(
    (ref: SessionRef | { backend: 'drive'; id: null }, interactive = true) =>
      runStudio(async () => {
        if (ref.id && sessionById(ref.id)) {
          setFocusedSession(ref.id);
          return;
        }
        const { holder, onRemoved } = removedHandler();
        if (ref.backend === 'onedrive') {
          holder.id = ref.id;
          if (interactive) await signInWithMicrosoft();
          const join = () => DriveSession.join(oneDriveApi, ref.id, authorRef.current, { authorize: authorizeMicrosoft, onRemoved, interactive, email: microsoftEmail(), identify: microsoftEmail });
          let session: DriveSession;
          try {
            session = await join();
          } catch (err) {
            // Opening someone else's folder can need more access (once or twice): ask, and try again.
            if (!(err instanceof DriveAuthError) || !interactive) throw err;
            await signInWithMicrosoft();
            try {
              session = await join();
            } catch (again) {
              if (!(again instanceof DriveAuthError)) throw again;
              await signInWithMicrosoft();
              session = await join();
            }
          }
          enterStudio(session);
          setStudioInvite(null);
          return;
        }
        let folderId = ref.id;
        if (interactive && (!folderId || !rememberedSeat(folderId))) {
          const picked = await pickSessionFolder(folderId ?? undefined);
          if (!picked) throw new Error('No session folder was chosen.');
          folderId = picked.id;
        }
        if (!folderId) return;
        if (sessionById(folderId)) {
          setFocusedSession(folderId);
          return;
        }
        holder.id = folderId;
        if (interactive) await signInWithGoogle();
        enterStudio(await DriveSession.join(driveApi, folderId, authorRef.current, { authorize: authorizeGoogle, onRemoved, interactive, email: googleEmail(), identify: googleEmail }));
        setStudioInvite(null);
      }),
    [runStudio, enterStudio],
  );

  /** The bytes of a document offered to a new session, and the markups already on it. */
  const documentSourceBytes = useCallback(
    async (d: DocumentSource): Promise<{ bytes: ArrayBuffer; seed: Uint8Array | null }> => {
      if (d.kind === 'upload') return { bytes: await d.file.arrayBuffer(), seed: null };
      const open = [...tabsARef.current, ...tabsBRef.current].find((t) => t.file.id === d.fileId);
      if (open) return { bytes: await readFile(open.file.hash), seed: Y.encodeStateAsUpdate(open.store.doc) };
      const stored = library.find((f) => f.id === d.fileId);
      if (!stored) throw new Error(`${d.name} is no longer in the library.`);
      const store = await MarkupStore.open(stored.id);
      const seed = Y.encodeStateAsUpdate(store.doc);
      await store.destroy();
      return { bytes: await readFile(stored.hash), seed };
    },
    [library],
  );

  /**
   * Adds documents to a session and opens each in a tab, bringing their markups along. A local tab
   * whose document went into the session is replaced by the session copy.
   */
  const addToStudio = useCallback(
    async (sessionId: string, sources: DocumentSource[]) => {
      const session = sessionById(sessionId);
      if (!session) return;
      for (const d of sources) {
        const { bytes, seed } = await documentSourceBytes(d);
        const added = await session.addDocument(d.name, bytes);
        // Session Roundtrip: a library document can be sent back when the session finishes.
        if (d.kind === 'file') rememberSource(sessionId, added.id, { kind: 'file', fileId: d.fileId, name: d.name });
        await openSessionDocument(sessionId, added.id, seed);
        if (d.kind === 'file') {
          if (tabsARef.current.some((t) => t.file.id === d.fileId)) closeTab('a', d.fileId);
          if (tabsBRef.current.some((t) => t.file.id === d.fileId)) closeTab('b', d.fileId);
        }
      }
    },
    [documentSourceBytes, openSessionDocument, closeTab],
  );

  /** Adds the document in front (a local one) to a session and opens the session copy in its place. */
  const addOpenToStudio = useCallback(
    (sessionId: string) =>
      runStudio(async () => {
        const cur = activePaneRef.current === 'b' ? openBRef.current : openRef.current;
        if (!cur || studioDocOf(cur.file.id)) return;
        await addToStudio(sessionId, [{ kind: 'file', fileId: cur.file.id, name: cur.file.name }]);
      }),
    [runStudio, addToStudio],
  );

  /** Starts a session from the Start dialog: creates it, invites people, and adds its documents. */
  const startStudio = useCallback(
    (req: StartRequest) =>
      runStudio(async () => {
        const { holder, onRemoved } = removedHandler();
        const permissions = { markup: canAddMarkups(req.access.default), addDocuments: req.addDocuments, saveCopy: req.saveCopy, invite: req.invite };
        const session: CollabSession =
          req.backend === 'onedrive'
            ? await (async () => {
                await signInWithMicrosoft();
                const create = () =>
                  DriveSession.create(oneDriveApi, req.name, authorRef.current, permissions, {
                    authorize: authorizeMicrosoft,
                    onRemoved,
                    linkCanEdit: req.linkCanEdit,
                    access: req.access,
                    expiresAt: req.expiresAt,
                    email: microsoftEmail(),
                    identify: microsoftEmail,
                  });
                try {
                  return await create();
                } catch (err) {
                  // Sharing the folder can need more than the app folder: ask, and try again.
                  if (!(err instanceof DriveAuthError)) throw err;
                  await signInWithMicrosoft();
                  return await create();
                }
              })()
            : await (async () => {
                await signInWithGoogle();
                return DriveSession.create(driveApi, req.name, authorRef.current, permissions, {
                  authorize: authorizeGoogle,
                  onRemoved,
                  linkCanEdit: req.linkCanEdit,
                  access: req.access,
                  expiresAt: req.expiresAt,
                  email: googleEmail(),
                  identify: googleEmail,
                });
              })();
        holder.id = session.id;
        enterStudio(session);
        const emails = req.access.people.map((p) => p.name).filter(isEmail);
        if (session.invite && emails.length) await session.invite(emails);
        await addToStudio(session.id, req.documents);
      }),
    [runStudio, enterStudio, addToStudio],
  );

  /**
   * A session document's markups: from its tab when open, else synced into a store opened just for
   * this (closed again afterwards).
   */
  const withSessionMarkups = useCallback(async <T,>(session: CollabSession, docId: string, use: (store: MarkupStore) => T): Promise<T> => {
    const fileId = studioFileId(session.id, docId);
    const tab = [...tabsARef.current, ...tabsBRef.current].find((t) => t.file.id === fileId);
    if (tab) return use(tab.store);
    const store = await MarkupStore.open(fileId);
    try {
      await session.attach(docId, store);
      return use(store);
    } finally {
      await store.destroy();
    }
  }, []);

  /** Session Report as a PDF: documents, attendees, every markup, the Record. */
  const sessionReportBytes = useCallback(
    async (session: CollabSession) => {
      const snap = session.getSnapshot();
      const { sessionReportPdf } = await import('./studio/report');
      const docs = [];
      for (const d of snap.meta.documents) {
        const { markups, sheets } = await withSessionMarkups(session, d.id, (store) => ({ markups: store.all(), sheets: store.allSheets() }));
        docs.push({
          name: d.name,
          markups,
          describe: (m: Markup) => m.subject || MARKUP_LABELS[m.type] || 'Markup',
          pageLabel: (i: number) => sheets[i]?.number || `Page ${i + 1}`,
        });
      }
      return sessionReportPdf(snap.meta, snap.record, docs);
    },
    [withSessionMarkups],
  );

  const sessionReport = useCallback(
    async (sessionId: string) => {
      const session = sessionById(sessionId);
      if (!session) return;
      const bytes = await sessionReportBytes(session);
      download(`${session.meta.name} session report.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    },
    [sessionReportBytes],
  );

  /** Every markup in a session as one CSV: a Document column, then the Markups list's main columns. */
  const sessionMarkupsCsv = useCallback(
    async (session: CollabSession) => {
      const keep = new Set(['seq', 'subject', 'page', 'sheet', 'measurement', 'author', 'date', 'status', 'comment', 'type']);
      let columns: ListColumn[] | null = null;
      const rows: ListRowData[] = [];
      for (const d of session.meta.documents) {
        await withSessionMarkups(session, d.id, (store) => {
          const set = store.columnSet();
          columns ??= listColumns(set.columns).filter((c) => keep.has(c.key) || c.key.startsWith('custom:'));
          const ctx: CellContext = { scaleOf: (m) => store.scaleOf(m), sheets: store.allSheets(), spaces: store.all().filter((m) => m.type === 'space'), statuses: set.statuses, columns: set.columns };
          for (const r of buildRows(store.all(), ctx, {}, null)) rows.push({ ...r, cells: { document: { text: d.name, num: null }, ...r.cells } });
        });
      }
      return rowsToCsv(rows, [{ key: 'document', label: 'Document', defaultWidth: 160 }, ...(columns ?? listColumns([]).filter((c) => keep.has(c.key)))]);
    },
    [withSessionMarkups],
  );

  /**
   * End: saves the chosen files (documents with markups, markups CSV, record, report) to this
   * computer, OneDrive or a Project, and only once all of them are saved removes the session and
   * its files for everyone. Asks for the folder or sign-in first, while the click still counts.
   */
  const endSession = useCallback(
    async (sessionId: string, choice: EndSessionChoice, onProgress: (p: EndProgress) => void = () => {}) => {
      const session = sessionById(sessionId);
      if (!session?.end) return;
      const meta = session.meta;
      const saving = choice.pdfs || choice.markupsCsv || choice.recordCsv || choice.reportPdf;
      // Each file is made, then saved; then documents go back to the library; then the session is removed.
      const made = (choice.pdfs ? meta.documents.length : 0) + (choice.markupsCsv && meta.documents.length ? 1 : 0) + (choice.recordCsv ? 1 : 0) + (choice.reportPdf ? 1 : 0);
      const total = made * 2 + meta.documents.filter((d) => choice.sendBack.includes(d.id)).length + 1;
      let done = 0;
      const step = (label: string) => onProgress({ done: done++, total, label });
      const safe = (n: string) => n.replace(/["*:<>?/\\|\u0000-\u001f]/g, '_').trim() || 'file';
      const stamp = new Date().toISOString().slice(0, 10);

      // Where the files go, settled before the (slow) exports so pickers and sign-in still open.
      type Dir = { getFileHandle: (name: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };
      let dir: Dir | null = null;
      let project: Project | null = null;
      if (saving && choice.destination === 'local') {
        const pick = (window as unknown as { showDirectoryPicker?: (o: { id?: string; mode: 'readwrite' }) => Promise<Dir> }).showDirectoryPicker;
        if (pick) {
          try {
            dir = await pick({ id: 'end-session', mode: 'readwrite' });
          } catch {
            throw new Error('No folder was chosen, so the session was not ended.');
          }
        }
      } else if (saving && choice.destination === 'onedrive') await authorizeMicrosoft();
      else if (saving && choice.destination === 'project' && choice.projectId) project = projectById(choice.projectId) ?? (await openProject(choice.projectId, authorRef.current, true, false));

      const files: { name: string; blob: Blob }[] = [];
      if (choice.pdfs && meta.documents.length) {
        const { exportWithAnnotations } = await import('@nb/markup/export');
        for (const d of meta.documents) {
          step(`Preparing ${d.name}`);
          const bytes = await session.fetchDocument(d.id);
          const out = await withSessionMarkups(session, d.id, (store) =>
            exportWithAnnotations(
              bytes.slice(0),
              store.all().filter((m) => choice.authors.includes(m.author)),
              {
                scaleFor: (i) => store.scaleFor(i),
                viewports: store.allViewports(),
                links: store.allLinks(),
                imported: store.importedAnnotations(),
                importedSpaces: store.importedSpaces(),
                pageScales: store.allScales(),
                columns: store.columnSet().columns,
                statuses: store.columnSet().statuses,
                places: store.places(),
              },
            ),
          );
          files.push({ name: safe(`${d.name.replace(/\.pdf$/i, '')} (${meta.name}).pdf`), blob: new Blob([out.slice().buffer], { type: 'application/pdf' }) });
        }
      }
      if (choice.markupsCsv && meta.documents.length) step('Preparing the markups CSV');
      if (choice.markupsCsv && meta.documents.length) files.push({ name: safe(`${meta.name} markups.csv`), blob: new Blob(['﻿' + (await sessionMarkupsCsv(session))], { type: 'text/csv' }) });
      if (choice.recordCsv) {
        step('Preparing the session record');
        const snap = session.getSnapshot();
        files.push({ name: safe(`${meta.name} session record.csv`), blob: new Blob(['﻿' + recordToCsv(snap.meta, snap.record)], { type: 'text/csv' }) });
      }
      if (choice.reportPdf) step('Preparing the session report');
      if (choice.reportPdf) files.push({ name: safe(`${meta.name} session report.pdf`), blob: new Blob([(await sessionReportBytes(session)) as BlobPart], { type: 'application/pdf' }) });

      let where = '';
      if (files.length) {
        if (choice.destination === 'local') {
          if (dir) {
            for (const f of files) {
              step(`Saving ${f.name}`);
              const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
              await w.write(f.blob);
              await w.close();
            }
            where = 'the folder you chose';
          } else {
            for (const f of files) {
              step(`Saving ${f.name}`);
              download(f.name, f.blob);
            }
            where = 'your Downloads';
          }
        } else if (choice.destination === 'onedrive') {
          const folder = `${meta.name} (ended ${stamp})`;
          const folderId = await oneDriveApi.createFolder(folder);
          for (const f of files) {
            step(`Uploading ${f.name} to OneDrive`);
            await oneDriveApi.createFile(folderId, f.name, f.blob.type, f.blob, {});
          }
          where = `OneDrive, Apps/redcolumn/${folder}`;
        } else {
          if (!project) throw new Error('Choose a Project to save to.');
          const taken = new Set(project.getSnapshot().folders.filter((f) => f.parentId === null).map((f) => f.name.toLowerCase()));
          let folder = `${safe(meta.name)} (ended ${stamp})`;
          for (let n = 2; taken.has(folder.toLowerCase()); n++) folder = `${safe(meta.name)} (ended ${stamp}) ${n}`;
          const { id } = await project.addFolder(folder, null);
          for (const f of files) {
            step(`Uploading ${f.name} to the Project`);
            await project.addFile(f.name, id, await f.blob.arrayBuffer());
          }
          where = `the Project “${project.getSnapshot().manifest.name}”, folder ${folder}`;
        }
      }

      // Session Roundtrip: library documents take the session's markups (and its newer revision, if the host updated it).
      const sentBack: string[] = [];
      for (const d of meta.documents) {
        const back = choice.sendBack.includes(d.id) ? sourceOf(sessionId, d.id) : null;
        if (!back) continue;
        step(`Sending ${d.name} back to your library`);
        const bytes = await session.fetchDocument(d.id);
        const chosen = await withSessionMarkups(session, d.id, (store) => store.all().filter((m) => choice.authors.includes(m.author)));
        const tab = [...tabsARef.current, ...tabsBRef.current].find((t) => t.file.id === back.fileId);
        const held = tab ? null : await acquireDocument(back.fileId);
        const target: OpenFile = tab ?? held!.open;
        try {
          if ((d.version ?? 1) > 1) await commitDocument(target, bytes.slice(0), () => target.store.forgetImported(target.doc.pages.map((_, i) => i)), `Before the Session “${meta.name}”`);
          target.store.checkpoint?.();
          target.store.batch(() => {
            target.store.remove(target.store.all().map((m) => m.id));
            for (const m of chosen) target.store.add(m);
          });
        } finally {
          held?.release();
        }
        sentBack.push(back.name);
      }
      if (sentBack.length) void refreshLibrary();

      // Everything is saved: only now does the session go.
      step('Removing the session and its files');
      await session.end();
      closeStudioDocs(sessionId);
      forgetRoundtrip(sessionId);
      sessionsRef.current = sessionsRef.current.filter((s) => s.id !== sessionId);
      setSessions(sessionsRef.current);
      setFocusedSession((f) => (f === sessionId ? null : f));
      setNotice(`Ended “${meta.name}” and removed its files.${files.length ? ` Saved ${files.length} file${files.length === 1 ? '' : 's'} to ${where}.` : ''}${sentBack.length ? ` Sent back: ${sentBack.join(', ')}.` : ''}`);
    },
    [withSessionMarkups, sessionMarkupsCsv, sessionReportBytes, closeStudioDocs, acquireDocument, commitDocument, refreshLibrary],
  );

  // Session documents the host updated to a new revision reload in their tabs (markups stay).
  useEffect(() => {
    for (const snap of snapshots) {
      for (const d of snap.meta.documents) {
        const fileId = studioFileId(snap.meta.id, d.id);
        const loaded = loadedVersions.current.get(fileId);
        const version = d.version ?? 1;
        if (loaded === undefined || loaded >= version) continue;
        loadedVersions.current.set(fileId, version);
        const inA = tabsARef.current.find((t) => t.file.id === fileId);
        const tab = inA ?? tabsBRef.current.find((t) => t.file.id === fileId);
        const session = sessionById(snap.meta.id);
        if (!tab || !session) continue;
        void session
          .fetchDocument(d.id)
          .then((bytes) => swapDocument(tab, !inA, bytes, () => tab.store.forgetImported(tab.doc.pages.map((_, i) => i))))
          .then(() => setNotice(`${d.name} was updated to revision ${version}; markups are on the same pages.`))
          .catch((err) => setError(`Could not load the new revision of ${d.name}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }, [snapshots, swapDocument]);

  // Markup Alerts from others pop up (once each; alerts already there when joining don't).
  useEffect(() => {
    const all = snapshots.flatMap((snap) => snap.record.filter((e) => e.kind === 'alert').map((entry) => ({ sessionId: snap.meta.id, entry, me: snap.me })));
    if (!seenAlerts.current) {
      seenAlerts.current = new Set(all.map((a) => a.entry.id));
      return;
    }
    for (const a of all) {
      if (seenAlerts.current.has(a.entry.id)) continue;
      seenAlerts.current.add(a.entry.id);
      if (a.entry.author !== a.me) setMarkupAlert({ sessionId: a.sessionId, entry: a.entry });
    }
  }, [snapshots]);

  /** Leaves one session: its tabs close, and any other sessions carry on. */
  const leaveStudio = useCallback(
    (sessionId: string) => {
      const session = sessionById(sessionId);
      closeStudioDocs(sessionId);
      session?.leave();
      sessionsRef.current = sessionsRef.current.filter((s) => s.id !== sessionId);
      setSessions(sessionsRef.current);
      setFocusedSession((f) => (f === sessionId ? null : f));
    },
    [closeStudioDocs],
  );

  /** Shows a page of a session document, opening it first if needed (Record lines, attendee locations). */
  const goToStudioPage = useCallback(
    async (sessionId: string, docId: string, page: number | null) => {
      const fileId = studioFileId(sessionId, docId);
      let pane: Pane | null = null;
      for (const p of ['a', 'b'] as const) {
        const tab = (p === 'b' ? tabsBRef.current : tabsARef.current).find((t) => t.file.id === fileId);
        if (tab) {
          activateTab(p, tab);
          pane = p;
        }
      }
      if (!pane) {
        await openSessionDocument(sessionId, docId);
        pane = tabsBRef.current.some((t) => t.file.id === fileId) ? 'b' : 'a';
      }
      const viewer = pane === 'b' ? ctlB?.viewer : ctl?.viewer;
      if (page != null) viewer?.goToPage(page);
    },
    [ctl, ctlB, activateTab, openSessionDocument],
  );

  // --- Projects (shared folders of PDFs in OneDrive) ---------------------------------------------

  /** Opens a Project file: its library copy (brought up to the latest revision), or an older revision on its own. */
  const openProjectFile = useCallback(
    async (project: Project, file: ProjectFile, rev?: number) => {
      const latest = file.revisions[file.revisions.length - 1]?.n ?? 0;
      if (rev && rev !== latest) {
        const { bytes } = await project.download(file.id, rev);
        await openCreated(`${file.name.replace(/\.pdf$/i, '')} (revision ${rev}).pdf`, bytes);
        return;
      }
      const copyId = libraryCopyOf(project.id, file.id);
      const stored = copyId ? (await listFiles()).find((f) => f.id === copyId) : undefined;
      if (stored && copyId) {
        const link = linkOf(copyId)!;
        if (link.rev < latest) {
          const got = await project.download(file.id).catch((err) => {
            // Offline: the copy on this device opens as it is.
            if (!(err instanceof TypeError)) throw err;
            setNotice(`Offline: opened your copy of ${file.name} (revision ${link.rev}); the Project has revision ${latest}.`);
            return null;
          });
          if (!got) return void (await openFromLibrary(stored));
          const tab = [...tabsARef.current, ...tabsBRef.current].find((t) => t.file.id === copyId);
          const held = tab ? null : await acquireDocument(copyId);
          const target: OpenFile = tab ?? held!.open;
          try {
            // The new revision's own annotations: ones this app wrote are already shared live (hidden
            // here, so they are not drawn twice); other tools' markups are brought in.
            const found = await readPdfAnnotations(got.bytes.slice(0), target.store);
            await commitDocument(target, got.bytes, () => target.store.importAnnotations(found.markups.filter(fromOtherTools), found.links, found.imported, found.extras), `Before Project revision ${got.revision.n}`);
          } finally {
            held?.release();
          }
          setLink(copyId, { ...link, rev: got.revision.n });
          setNotice(`${file.name}: updated to revision ${got.revision.n} from the Project.`);
        }
        await openFromLibrary((await listFiles()).find((f) => f.id === copyId)!);
        return;
      }
      const { bytes, revision } = await project.download(file.id);
      const saved = await saveFile(file.name, bytes.slice(0));
      setLink(saved.id, { projectId: project.id, fileId: file.id, rev: revision.n, name: file.name });
      await openFromLibrary(saved);
      void refreshLibrary();
    },
    [openCreated, openFromLibrary, acquireDocument, commitDocument, refreshLibrary],
  );

  const addToProject = useCallback(async (project: Project, folderId: string | null, sources: { name: string; bytes: ArrayBuffer; libraryId?: string }[], onProgress?: (p: UploadProgress) => void) => {
    for (const [i, s] of sources.entries()) {
      onProgress?.({ done: i, total: sources.length, name: s.name });
      const file = await project.addFile(s.name, folderId, s.bytes);
      if (s.libraryId) setLink(s.libraryId, { projectId: project.id, fileId: file.id, rev: 1, name: s.name });
    }
    setNotice(`Added ${sources.map((s) => s.name).join(', ')} to the Project.`);
  }, []);

  /**
   * Checks the library copy in as a new revision of the PDF. With OneDrive out
   * of reach the check-in is queued (the copy is read when it is sent) and goes when it is back.
   */
  const checkInProjectFile = useCallback(
    async (project: Project, file: ProjectFile, comment: string) => {
      const copyId = libraryCopyOf(project.id, file.id);
      if (!copyId) throw new Error('Open the file from the Project first, then make your changes.');
      const link = linkOf(copyId)!;
      const queue = () => {
        projectQueue().add({ kind: 'checkin', projectId: project.id, fileId: file.id, fileName: file.name, by: authorRef.current, libraryId: copyId, baseRev: link.rev, comment, keep: false });
        setNotice(`${file.name} will be checked in when OneDrive can be reached.`);
      };
      if (!navigator.onLine) return queue();
      try {
        const rev = await project.checkIn(file.id, await projectCopyBytes(copyId), comment);
        setLink(copyId, { ...link, rev: rev.n });
        setNotice(`Checked in ${file.name} as revision ${rev.n}.`);
      } catch (err) {
        if (!isUnreachable(err)) throw err;
        queue();
      }
    },
    [],
  );

  // Tabs reopened before their Project was (on page load, or offline) share markups once it opens.
  useEffect(
    () =>
      onProjectOpened((project) => {
        for (const tab of [...tabsARef.current, ...tabsBRef.current]) {
          const link = linkOf(tab.file.id);
          if (link?.projectId === project.id) void project.attachMarkups(link.fileId, tab.store).catch((err: unknown) => console.warn('Project markups:', err));
        }
        setProjectsOpened((n) => n + 1);
      }),
    [],
  );

  // Reopen (without a sign-in prompt) the Projects of files in tabs, so their markups sync again
  // after a reload. Each is tried once; one that needs a sign-in waits for a click in the panel.
  const triedProjects = useRef(new Set<string>());
  useEffect(() => {
    for (const tab of [...tabsA, ...tabsB]) {
      const id = linkOf(tab.file.id)?.projectId;
      if (!id || projectById(id) || triedProjects.current.has(id)) continue;
      triedProjects.current.add(id);
      void openProject(id, authorRef.current, false).catch(() => {});
    }
  }, [tabsA, tabsB]);

  /** Sends check-ins and notes made offline, in order (src/studio/projects/queue.ts). */
  const sendQueuedProjectChanges = useCallback(async () => {
    const queue = projectQueue();
    if (!queue.all().length || !navigator.onLine) return;
    const r = await queue.send(async (c) => {
      const project = projectById(c.projectId) ?? (await openProject(c.projectId, authorRef.current, false));
      await project.poll();
      if (c.kind === 'note') return void (await project.note('file', noteText(c), { fileId: c.fileId }));
      const file = project.getSnapshot().files.find((f) => f.id === c.fileId);
      if (!file) throw new Error('It is no longer in the Project.');
      if (!project.heldByMe(file)) throw new Error(file.checkout ? `${file.checkout.by} has it checked out.` : 'It is no longer checked out to you. Check it out again, then retry.');
      const latest = file.revisions[file.revisions.length - 1]!.n;
      if (latest > c.baseRev) throw new Error(`Someone checked in revision ${latest} after your copy (revision ${c.baseRev}).`);
      const rev = await project.checkIn(file.id, await projectCopyBytes(c.libraryId), c.comment);
      const link = linkOf(c.libraryId);
      if (link) setLink(c.libraryId, { ...link, rev: rev.n });
    });
    if (r.sent.length) setNotice(`Sent ${r.sent.length} Project change${r.sent.length === 1 ? '' : 's'} made offline.`);
    if (r.failed.length) setError(`Not sent: ${r.failed.map((c) => `${c.fileName} (${c.error})`).join('; ')}. Retry or discard them in the Projects panel.`);
  }, []);
  const sendQueuedRef = useRef(sendQueuedProjectChanges);
  sendQueuedRef.current = sendQueuedProjectChanges;
  useEffect(() => {
    const send = () => void sendQueuedRef.current().catch(() => {});
    window.addEventListener('online', send);
    // Also on a timer: the network can come back without an 'online' event.
    const timer = setInterval(send, 30_000);
    send();
    return () => {
      window.removeEventListener('online', send);
      clearInterval(timer);
    };
  }, []);

  // Rejoin the sessions this browser was in, or offer to join one from an invite link:
  // `?gdrive=<folder id>` (Google Drive) or `?onedrive=<share id>` (OneDrive), which wait for a click
  // to sign in. Links to redcolumn server sessions (`?studio=`) are dropped.
  useEffect(() => {
    if (!ctl) return;
    const params = new URLSearchParams(window.location.search);
    const gdrive = params.get('gdrive')?.match(/^[\w-]{10,}$/)?.[0] ?? null;
    const onedrive = parseOneDriveInvite(params.get('onedrive') ?? '');
    const driveInvite = gdrive ?? onedrive;
    const inviteBackend = gdrive ? 'drive' : 'onedrive';
    const projectLink = idFromText(params.get('project') ?? '');
    if (params.has('project')) {
      params.delete('project');
      window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`);
      if (projectLink) {
        setProjectInvite(projectLink);
        setLeftTab('projects');
        setLeftOpen(true);
      }
    }
    if (params.has('studio') || driveInvite) {
      params.delete('studio');
      params.delete('gdrive');
      params.delete('onedrive');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
      setLeftTab('sessions');
      setLeftOpen(true);
    }
    const current = currentSessions();
    void (async () => {
      for (const ref of current) await joinStudio(ref, false);
      if (driveInvite && !current.some((r) => r.id === driveInvite)) setStudioInvite({ backend: inviteBackend, id: driveInvite });
      else if (driveInvite) setFocusedSession(driveInvite);
      // After rejoining several, start on the list rather than whichever joined last.
      if (!driveInvite && current.length > 1) setFocusedSession(null);
    })();
    // Once, when the viewer is ready.
  }, [ctl]);

  useEffect(() => {
    const retry = () => sessionsRef.current.forEach((s) => s.retry());
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  // What a reload for a new version would interrupt (see src/offline/updates.ts).
  const ctlBRef = useRef(ctlB);
  ctlBRef.current = ctlB;
  useEffect(() => {
    if (!ctl) return;
    const offs = [
      addBusyCheck('jobs', () => (runningJobs().length ? `${runningJobs()[0]!.label.toLowerCase()} is running` : null)),
      addBusyCheck('projects', () => (projectQueue().busy ? 'Project changes are being sent' : null)),
      addBusyCheck('drawing', () => (ctl.tools.inProgress || ctlBRef.current?.tools.inProgress ? 'a markup is being drawn' : null)),
    ];
    return () => offs.forEach((o) => o());
  }, [ctl]);

  // Launches with something to open: a shortcut (?action=open or new), PDFs shared from another
  // app (?action=shared), and PDFs opened from the file manager (launchQueue), now and later.
  const [launchOpen, setLaunchOpen] = useState(false);
  const openNewFileRef = useRef(openNewFile);
  openNewFileRef.current = openNewFile;
  useEffect(() => {
    if (!ctl) return;
    const launch = parseLaunch(window.location.search);
    if (launch.action) stripLaunchQuery();
    consumeLaunchFiles((files) => void openNewFileRef.current(files, 'a'));
    if (launch.action === 'new') setBlankPdf('new');
    else if (launch.action === 'open') setLaunchOpen(true);
    else if (launch.action === 'shared') {
      void (async () => {
        const files = await takeSharedFiles().catch(() => []);
        if (files.length) return openNewFileRef.current(files, 'a');
        if (launch.url) {
          const res = await fetch(launch.url).catch(() => null);
          const blob = res?.ok ? await res.blob() : null;
          if (blob && (blob.type === 'application/pdf' || /\.pdf($|\?)/i.test(launch.url))) return openNewFileRef.current([new File([blob], decodeURIComponent(new URL(launch.url).pathname.split('/').pop() || 'Shared.pdf'), { type: 'application/pdf' })], 'a');
          return setError(`Could not open the shared link ${launch.url}. Download the PDF and share the file instead.`);
        }
        setError(launch.error ? 'The shared file could not be received.' : 'Nothing to open was shared: share a PDF file.');
      })();
    }
    // Once, when the viewer is ready.
  }, [ctl]);

  useEffect(() => {
    if (!ctl) return;
    let pasteFallback = 0;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const tools = activePaneRef.current === 'b' && ctlB ? ctlB.tools : ctl.tools;
      // Keys that mean something while clicking out a measurement or drawing.
      const measuring = tools.getState().measuring;
      if (e.key === 'Enter' && measuring) tools.finish();
      else if ((e.key === 'Backspace' || e.key === 'Delete') && measuring) tools.removeLastPoint();
      else if (e.key === 'Escape') tools.cancel();
      else {
        // Everything else runs a command through the active profile's shortcuts.
        const combo = comboOf(e);
        const all = commandsRef.current;
        const id = combo ? keyMap([...all.keys()], profiles.active().state.shortcuts).get(combo) : undefined;
        const command = id ? all.get(id) : undefined;
        if (!command) return;
        // Paste arrives as the browser's paste event instead, which carries the system clipboard;
        // browsers that send none outside text fields get the app's own paste shortly after.
        if (id === 'edit.paste') {
          clearTimeout(pasteFallback);
          pasteFallback = window.setTimeout(() => command.enabled && command.run(), 80);
          return;
        }
        if (command.enabled) command.run();
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      clearTimeout(pasteFallback);
      const data = e.clipboardData;
      const text = data?.getData('text/plain') ?? '';
      const image = [...(data?.files ?? [])].find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (image && !text.startsWith(MARKUP_CLIP)) pasteImageRef.current(image);
      else {
        const paste = commandsRef.current.get('edit.paste');
        if (paste?.enabled) paste.run();
      }
    };
    window.addEventListener('paste', onPaste);
    const bindDbl = (canvas: HTMLCanvasElement, viewer: TileViewer, tools: MarkupTools, pane: Pane) => {
      const onDblClick = (e: MouseEvent) => {
        const page = viewer.pageNearClient(e.clientX, e.clientY);
        tools.doubleClick(viewer.clientToPage(e.clientX, e.clientY, page), page);
      };
      // Right-drag pans; only a right-click that stayed put opens the menu.
      let rightDown: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => {
        if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
      };
      const onMove = (e: PointerEvent) => {
        lastPointer.current = { x: e.clientX, y: e.clientY, viewer };
      };
      const onLeave = () => {
        if (lastPointer.current?.viewer === viewer) lastPointer.current = null;
      };
      const onMenu = (e: MouseEvent) => {
        e.preventDefault();
        const moved = rightDown && Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) > 4;
        rightDown = null;
        if (!moved) canvasMenuRef.current(e, pane);
      };
      canvas.addEventListener('dblclick', onDblClick);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('contextmenu', onMenu);
      return () => {
        canvas.removeEventListener('dblclick', onDblClick);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('contextmenu', onMenu);
      };
    };
    const unA = canvasRef.current ? bindDbl(canvasRef.current, ctl.viewer, ctl.tools, 'a') : () => {};
    const unB = ctlB && canvasBRef.current ? bindDbl(canvasBRef.current, ctlB.viewer, ctlB.tools, 'b') : () => {};
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
      unA();
      unB();
    };
  }, [ctl, ctlB, goBack, split, unsplit, exportPdf]);

  const selectFromList = useCallback(
    (m: Markup, additive = false) => {
      const useB = activePaneRef.current === 'b' && ctlB;
      const viewer = useB ? ctlB.viewer : ctl?.viewer;
      const tools = useB ? ctlB.tools : ctl?.tools;
      if (!viewer || !tools) return;
      if (viewer.currentPageIndex !== m.pageIndex) viewer.goToPage(m.pageIndex);
      // Adding to a selection keeps the view; picking one markup focuses on it.
      if (!additive) zoomToMarkup(viewer, m);
      tools.setTool('select');
      if (additive) {
        const next = new Set(tools.getState().selected);
        if (next.has(m.id)) next.delete(m.id);
        else next.add(m.id);
        tools.select(next);
      } else {
        tools.select([m.id]);
      }
    },
    [ctl, ctlB],
  );

  // Stable handlers for the Markups list, so it re-renders only when its data changes.
  const listRowMenuRef = useRef<(m: Markup, x: number, y: number) => void>(() => {});
  listRowMenuRef.current = (m, x, y) => {
    const pane: Pane = paneB ? 'b' : 'a';
    const tools = paneParts(pane).c?.tools;
    if (!tools) return;
    let ids = [...tools.getState().selected];
    if (!ids.includes(m.id)) {
      selectFromList(m);
      ids = [m.id];
    }
    setCtxMenu({ x, y, items: markupMenu(pane, ids) });
  };
  const onListRowMenu = useCallback((m: Markup, x: number, y: number) => listRowMenuRef.current(m, x, y), []);
  const onManageColumns = useCallback(() => setColumnsOpen(true), []);
  const onExportList = useCallback((rows: ListRowData[], columns: ListColumn[]) => setExportOpen({ rows, columns }), []);

  // Style controls edit the active tool's style, or the selected markups' type in select mode.
  const selectedTypes = new Set(markups.filter((m) => toolsState.selected.has(m.id)).map((m) => m.type));
  const styleType =
    toolsState.tool === 'cloudPlus'
      ? 'cloud'
      : isMarkupTool(toolsState.tool)
        ? toolsState.tool
        : toolsState.tool !== 'select'
          ? null
          : selectedTypes.size === 1
            ? [...selectedTypes][0]!
            : null;
  // A Cloud+ is a cloud with a callout, so selecting or drawing one also offers the callout's text options.
  const textType = styleType === 'cloud' || styleType === null ? (toolsState.tool === 'cloudPlus' || (toolsState.tool === 'select' && selectedTypes.has('callout')) ? 'callout' : null) : styleType;
  const selectedText = textType && toolsState.tool === 'select' ? markups.find((m) => m.type === textType && toolsState.selected.has(m.id)) : undefined;
  // Cloud bubble size: shown while drawing a cloud, or when the selection includes one (a Cloud+ is a cloud and its callout).
  // `value` is the selected cloud's size, else the default for new ones (undefined: sized to the zoom).
  const selectedCloud = markups.find((m) => m.type === 'cloud' && toolsState.selected.has(m.id));
  const cloudBubble =
    toolsState.tool === 'cloud' || toolsState.tool === 'cloudPlus' || (toolsState.tool === 'select' && selectedCloud)
      ? { value: selectedCloud && toolsState.tool === 'select' ? cloudRadius(selectedCloud) : toolsState.styles.cloud.arcRadius }
      : null;
  // Draw to Scale: a single selected shape's sizes are edited in the toolbar.
  const selectedShape =
    prefs.sketchToScale && toolsState.tool === 'select' && toolsState.selected.size === 1
      ? markups.find((m) => GEOMETRY_TYPES.has(m.type) && m.points.length >= 2 && toolsState.selected.has(m.id))
      : undefined;
  const pageIndex = (paneB ? statsB : stats)?.pageIndex ?? 0;
  const pageCount = (paneB ? statsB : stats)?.pageCount ?? 0;
  // A calibration line drawn inside a viewport calibrates that viewport.
  const calibrationViewport = calibration ? viewportAt(viewports, calibration.pageIndex, calibration.at) : null;
  // A dimension's text, or a Replace Text markup's new wording.
  editLabelRef.current = (pane, id) => {
    const store = paneParts(pane).o?.store;
    const m = store?.get(id);
    if (!store || !m) return;
    const replace = m.type === 'replaceText';
    void askText(replace ? 'Replace Text' : 'Dimension Text', m.text ?? '', {
      label: replace ? `Replacing "${m.comment ?? ''}" with:` : 'Shown along the dimension line.',
      confirm: 'OK',
    }).then((text) => {
      if (text !== null && text !== (m.text ?? '')) {
        store.checkpoint();
        store.update(id, { text });
      }
    });
  };
  /**
   * Part of a page as a picture, with its markups unless `withMarkups` is false. `pixels(w, h)`
   * gives the scale (pixels per point) for the area's size. Null when the area is off the page.
   */
  const renderRegion = async (o: OpenFile, pageIndex: number, rect: { x: number; y: number; w: number; h: number }, pixels: (w: number, h: number) => number, withMarkups = true) => {
    const size = o.doc.pages[pageIndex];
    if (!size) return null;
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const w = Math.min(size.width, rect.x + rect.w) - x0;
    const h = Math.min(size.height, rect.y + rect.h) - y0;
    if (w <= 0 || h <= 0) return null;
    const scale = pixels(w, h);
    const { bitmap } = await o.doc.renderTile(pageIndex, scale, Math.floor(x0 * scale), Math.floor(y0 * scale), Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)), { transparent: true });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    bitmap.close();
    g.scale(scale, scale);
    g.translate(-x0, -y0);
    const store = o.store;
    const legends = { all: () => store.all(), scaleFor: (p: number) => store.scaleFor(p), scaleOf: (m: Markup) => store.scaleOf(m) };
    if (withMarkups) for (const m of store.forPage(pageIndex).sort((a, b) => a.createdAt - b.createdAt)) drawMarkup(g, m, scale, store.scaleOf(m), legends);
    return { canvas, x0, y0, w, h };
  };

  // Snapshot: the area as a picture (with its markups) on the clipboard; Ctrl+V pastes it as an image markup.
  snapshotRef.current = (pane, pageIndex, rect, withMarkups = true) => {
    const { o } = paneParts(pane);
    if (!o) return Promise.resolve();
    return (async () => {
      // The resolution set in Preferences › Snapshot, within 4096 px on the longest side.
      const region = await renderRegion(o, pageIndex, rect, (w, h) => Math.min(settings.get().snapshotDpi / 72, 4096 / Math.max(w, h)), withMarkups);
      if (!region) return;
      const { canvas, x0, y0, w, h } = region;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) return;
      const now = Date.now();
      // Also on the app's own clipboard, so pasting works where the system clipboard is off limits.
      clipboard.current = [
        { id: 'snapshot', type: 'image', pageIndex, points: [[x0, y0], [x0 + w, y0 + h]], style: { ...DEFAULT_STYLES.image }, image: canvas.toDataURL('image/png'), subject: 'Snapshot', status: 'none', author: authorRef.current, createdAt: now, modifiedAt: now },
      ];
      setClipboardCount(1);
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setNotice('Snapshot copied to the clipboard. Ctrl+V pastes it as an image.');
      } catch {
        setNotice('Snapshot copied. Ctrl+V pastes it as an image here.');
      }
    })().catch((err) => setError(`Snapshot failed: ${err instanceof Error ? err.message : String(err)}`));
  };
  // An image pasted from another app becomes an image markup at the pointer (or the view's centre).
  pasteImageRef.current = (file) => {
    const pane: Pane = activePaneRef.current;
    const { c, o } = paneParts(pane);
    if (!c || !o || o.store.readOnly) return;
    void imageToDataUrl(file).then(({ image, aspect }) => {
      const viewer = c.viewer;
      const at = lastPointer.current?.viewer === viewer ? lastPointer.current : null;
      const page = at ? viewer.pageNearClient(at.x, at.y) : viewer.currentPageIndex;
      const r = (pane === 'b' ? canvasBRef.current : canvasRef.current)?.getBoundingClientRect();
      const centre = at ? viewer.clientToPage(at.x, at.y, page) : r ? viewer.clientToPage(r.left + r.width / 2, r.top + r.height / 2, page) : ([0, 0] as PagePoint);
      const size = o.doc.pages[page];
      // A comfortable on-screen size, no larger than the page, kept on it.
      const w = Math.min(240 / viewer.zoomFor(page), size ? size.width : Infinity, size ? size.height * aspect : Infinity);
      const h = w / aspect;
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      if (size) {
        centre[0] = clamp(centre[0], w / 2, size.width - w / 2);
        centre[1] = clamp(centre[1], h / 2, size.height - h / 2);
      }
      const now = Date.now();
      const m: Markup = { id: 'pasted', type: 'image', pageIndex: page, points: [[0, 0], [w, h]], style: { ...DEFAULT_STYLES.image }, image, status: 'none', author: authorRef.current, createdAt: now, modifiedAt: now };
      c.tools.paste([m], page, [centre[0] - w / 2, centre[1] - h / 2]);
    });
  };
  viewportRef.current = (pageIndex, rect) => {
    const store = (paneB ? openB : open)?.store;
    if (!store) return;
    const n = store.allViewports().filter((x) => x.pageIndex === pageIndex).length + 1;
    // Only the part on the page counts.
    const size = (paneB ? ctlB : ctl)?.viewer.pageSize(pageIndex);
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = size ? Math.min(size.width, rect.x + rect.w) : rect.x + rect.w;
    const y1 = size ? Math.min(size.height, rect.y + rect.h) : rect.y + rect.h;
    if (x1 <= x0 || y1 <= y0) return;
    store.setViewport({ id: crypto.randomUUID(), pageIndex, name: `Viewport ${n}`, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, scale: store.scaleFor(pageIndex) });
    setLeftTab('measurements');
    setLeftOpen(true);
  };
  const setPageScale = (scale: Scale, allPages: boolean) => {
    const dest = paneB ? openB : open;
    dest?.store.setScale(allPages ? Array.from({ length: pageCount }, (_, i) => i) : [pageIndex], scale);
  };
  // Title-block scales that can fill pages nobody has scaled yet (never overriding a set scale).
  const detectedScales = Object.entries(sheets)
    .map(([i, s]) => [Number(i), s.scaleText ? parseScaleText(s.scaleText) : null] as const)
    .filter((e): e is readonly [number, Scale] => e[1] !== null && !scales[e[0]]);
  const currentSheet = sheets[pageIndex];
  const currentStitch = stitchGroups.find((g) => g.placements.some((p) => p.pageIndex === pageIndex)) ?? null;
  const editing = editingText && (paneB ? openB : open) ? (paneB ? openB : open)!.store.get(editingText) : undefined;
  const v = paneB && ctlB ? ctlB.viewer : ctl?.viewer;
  const activeOpen = paneB && openB ? openB : open;
  const activeTools = paneB && ctlB ? ctlB.tools : ctl?.tools;

  // The Markups list's filter dims or hides what it leaves out, on the active pane's pages.
  useEffect(() => {
    const active = paneB ? ctlB?.tools : ctl?.tools;
    for (const tools of [ctl?.tools, ctlB?.tools]) {
      if (!tools) continue;
      if (allMarkupsHidden) tools.setFilterView(() => true, 'hide');
      else tools.setFilterView(tools === active && listKept ? (m) => !listKept.has(m.id) : null, prefs.filteredMarkups);
    }
  }, [listKept, prefs.filteredMarkups, paneB, ctl, ctlB, allMarkupsHidden]);

  // Page layout, page colours and line weights, in both panes.
  useEffect(() => {
    for (const viewer of [ctl?.viewer, ctlB?.viewer]) {
      if (!viewer) continue;
      viewer.setPageFilter(prefs.pageFilter);
      viewer.setThinLines(prefs.thinLines);
      const cur = viewer.spread;
      if (cur.columns !== spread.columns || cur.cover !== spread.cover) viewer.setSpread(spread.columns, spread.cover);
    }
  }, [prefs.pageFilter, prefs.thinLines, spread, ctl, ctlB]);

  // Read each open document's PDF layers once; layers the file starts with off count as hidden.
  useEffect(() => {
    for (const o of [open, openB]) {
      if (!o || pdfLayers[o.file.hash]) continue;
      const { hash, id } = o.file;
      setPdfLayers((all) => ({ ...all, [hash]: [] }));
      void Promise.all([readFile(hash), import('./documents/layers')])
        .then(([bytes, { readLayers }]) => readLayers(bytes))
        .then((layers) => {
          setPdfLayers((all) => ({ ...all, [hash]: layers }));
          setHiddenPdfLayers((all) => (all[id] ? all : { ...all, [id]: layers.filter((l) => !l.on).map((l) => l.id) }));
        })
        .catch(() => {});
    }
  }, [open, openB, pdfLayers]);

  // Markup layers switched off stay off for each pane's document.
  useEffect(() => {
    ctl?.tools.setHiddenLayers(new Set(open ? (hiddenMarkupLayers[open.file.id] ?? []) : []));
    ctlB?.tools.setHiddenLayers(new Set(openB ? (hiddenMarkupLayers[openB.file.id] ?? []) : []));
  }, [hiddenMarkupLayers, open, openB, ctl, ctlB]);

  // The magnifier follows the active pane.
  useEffect(() => {
    ctl?.viewer.setMagnifier(magnifier && !paneB ? 2.5 : 0);
    ctlB?.viewer.setMagnifier(magnifier && paneB ? 2.5 : 0);
  }, [magnifier, paneB, ctl, ctlB]);

  // Full screen: the browser's full screen with the interface hidden; Esc leaves it.
  useEffect(() => {
    const onChange = () => setFullScreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement.requestFullscreen().catch(() => {
        // Without the Fullscreen API (or when refused), hide the interface in the window instead.
        setFullScreen((f) => !f);
      });
  };

  // Synchronised views: moving either pane moves the other, by page number or keeping the offset
  // between their pages when sync was turned on.
  useEffect(() => {
    if (!split || !sync || !ctl || !ctlB) return;
    const a = ctl.viewer;
    const b = ctlB.viewer;
    const offset = sync === 'page' ? b.currentPageIndex - a.currentPageIndex : 0;
    const follow = (from: TileViewer, to: TileViewer, delta: number) => () => {
      const view = from.pageView();
      to.setPageView({ ...view, pageIndex: view.pageIndex + delta });
    };
    const offA = a.onViewChange(follow(a, b, offset));
    const offB = b.onViewChange(follow(b, a, -offset));
    follow(activePaneRef.current === 'b' ? b : a, activePaneRef.current === 'b' ? a : b, activePaneRef.current === 'b' ? -offset : offset)();
    return () => {
      offA();
      offB();
    };
  }, [split, sync, ctl, ctlB]);
  useEffect(() => {
    if (!split) setSync(null);
  }, [split]);

  // Rulers (in each page's drawing scale) and the crosshair, in both panes.
  useEffect(() => {
    const panes: [TileViewer | undefined, OpenFile | null][] = [
      [ctl?.viewer, open],
      [ctlB?.viewer, openB],
    ];
    for (const [viewer, o] of panes) {
      if (!viewer) continue;
      viewer.setCrosshair(prefs.crosshair);
      viewer.setRulers(
        prefs.showRulers
          ? (pageIndex) => {
              const scale = o?.store.scaleFor(pageIndex) ?? DEFAULT_SCALE;
              return { perPoint: scale.metersPerPoint / METERS_PER_UNIT[scale.unit], unit: scale.unit };
            }
          : null,
      );
    }
  }, [prefs.showRulers, prefs.crosshair, ctl, ctlB, open, openB]);
  const pageSize = activeOpen?.doc.pages[pageIndex] ?? null;
  const activeStudioDoc = studioDocOf(activeOpen?.file.id);
  const activeReadOnly = useSyncExternalStore(activeOpen ? (l) => activeOpen.store.subscribe(l) : noSubscribe, () => activeOpen?.store.readOnly ?? false);

  // The document's fingerprint, for checking signatures (debounced while markups change).
  useEffect(() => {
    if (!activeOpen) {
      setDocDigest(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void documentDigest(activeOpen.file.hash, markups).then((d) => {
        if (live) setDocDigest(d);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [activeOpen, markups]);

  const cellContext: CellContext = {
    scaleOf,
    sheets,
    spaces: markups.filter((m) => m.type === 'space'),
    statuses: columnSet.statuses,
    columns: columnSet.columns,
  };
  const listLayout = resolveLayout(ws.list.columns, listColumns(columnSet.columns));
  const visibleListColumns = listLayout.filter((c) => !c.hidden);

  /** Arms the signature tool with a saved signature; the document is fingerprinted as signed now. */
  const placeSignature = async (sig: SavedSignature, reason: string) => {
    const cur = activeOpen;
    const tools = activeTools;
    if (!cur || !tools) return;
    const digest = await documentDigest(cur.file.hash, cur.store.all());
    tools.setTool('signature', {
      image: sig.image,
      aspect: sig.aspect,
      subject: sig.kind === 'initials' ? 'Initials' : 'Signature',
      signature: { signer: authorRef.current, signedAt: Date.now(), digest, ...(reason ? { reason } : {}) },
    });
  };

  /** Draws with a tool library tool. */
  const useToolItem = (item: ToolChestItem, mode: 'copy' | 'style' = settings.get().toolChestMode) => {
    const tools = activeTools;
    if (!tools) return;
    if (item.markups?.length && mode === 'copy') {
      // Sets that scale to the page grow or shrink saved tools so they keep their real-world size.
      const set = profiles.active().state.toolChests.find((t) => t.items.some((i) => i.id === item.id));
      const store = activeOpen?.store;
      const k = set?.scaleToPage && item.metersPerPoint && store?.hasScale(pageIndex) ? item.metersPerPoint / store.scaleFor(pageIndex).metersPerPoint : 1;
      const template = k === 1 ? item.markups : item.markups.map((m) => ({ ...m, points: m.points.map(([x, y]) => [x * k, y * k] as [number, number]) }));
      tools.setTool(item.type, { id: item.id, template, ...(item.subject ? { subject: item.subject } : {}), ...(item.sequence ? { sequence: item.sequence } : {}), once: !settings.get().toolChestSticky });
      return;
    }
    if (item.type === 'signature') {
      if (!item.image) return;
      const img = new Image();
      img.onload = () => tools.setTool('signature', { id: item.id, image: item.image, aspect: img.naturalWidth / img.naturalHeight || 3, subject: item.subject, once: true });
      img.src = item.image;
      return;
    }
    tools.setTool(item.tool ?? item.type, { id: item.id, style: item.style, ...(item.subject ? { subject: item.subject } : {}) });
  };

  /** Takeoff totals as text lines for the summary. */
  const takeoffTotals = (list: readonly Markup[]): string[] => {
    const totals = new Map<MeasureKind, { value: number; scale: Scale; n: number }>();
    for (const m of list) {
      if (!isMeasureKind(m.type) || m.type === 'angle') continue;
      const scale = scaleOf(m);
      const t = totals.get(m.type) ?? { value: 0, scale, n: 0 };
      t.value += measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m));
      t.n++;
      totals.set(m.type, t);
    }
    return [...totals].map(([kind, t]) => `Total ${MARKUP_LABELS[kind]} (${t.n}): ${formatMeasure(kind, t.value, t.scale)}`);
  };

  const runExport = async (req: ExportRequest) => {
    const cur = activeOpen;
    const shown = exportOpen;
    if (!cur || !shown) return;
    const cols = req.columnKeys.map((k) => listLayout.find((c) => c.key === k)).filter((c): c is (typeof listLayout)[number] => !!c);
    const rows = req.scope === 'shown' ? shown.rows : buildRows(markups, cellContext, {}, listSort);
    const base = cur.file.name.replace(/\.pdf$/i, '');
    const job = startJob(`Export markups · ${cur.file.name}`, { kind: 'export', cancellable: false });
    try {
      if (req.format === 'csv') {
        download(`${base} markups.csv`, new Blob(['\uFEFF' + rowsToCsv(rows, cols)], { type: 'text/csv' }));
      } else {
        const { summaryPdf } = await import('@nb/markup/summary');
        const out = await summaryPdf(
          {
            title: req.title,
            subtitle: `${cur.file.name} · ${rows.length} markup${rows.length === 1 ? '' : 's'} · exported ${new Date().toLocaleString()} by ${author}`,
            columns: cols.map((c) => ({ label: c.label, width: c.width, ...(c.align ? { align: c.align } : {}) })),
            rows: rows.map((r) => ({
              cells: cols.map((c) => {
                const v = r.cells[c.key];
                return v?.error ? `#${v.error}` : (v?.text ?? '');
              }),
              color: r.markup.style.stroke,
            })),
            totals: takeoffTotals(rows.map((r) => r.markup)),
          },
          req.layout === 'append' ? await annotatedBytes(cur) : undefined,
        );
        download(`${base} ${req.layout === 'append' ? '(markups + summary)' : 'markup summary'}.pdf`, new Blob([out as BlobPart], { type: 'application/pdf' }));
      }
      setExportOpen(null);
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      job.end();
    }
  };

  /** The list's filter and sort, limited to columns this document has. */
  const listKeys = new Set(listLayout.map((c) => c.key));
  const listFilters = Object.fromEntries(Object.entries(ws.list.filters).filter(([k]) => listKeys.has(k)));
  const listSort = ws.list.sort && listKeys.has(ws.list.sort.key) ? ws.list.sort : null;
  const openSummaryExport = () => setExportOpen({ rows: buildRows(markups, cellContext, listFilters, listSort, ws.list.advanced), columns: visibleListColumns });

  // Keep a spreadsheet in step with the Markups list, when this document has one connected.
  const sheetSync = useSheetSync(activeOpen?.file.name ?? null);
  const syncTable = useMemo(
    () => (sheetSync.link || syncOpen ? toTable(buildRows(markups.filter((m) => m.type !== 'space'), cellContext, listFilters, listSort, ws.list.advanced), visibleListColumns) : null),
    // The context and layout are rebuilt every render; these are what they depend on.
    [sheetSync.link, syncOpen, markups, scaleOf, sheets, columnSet, ws.list],
  );
  const pushSyncTable = sheetSync.update;
  useEffect(() => {
    if (syncTable && sheetSync.link) pushSyncTable(syncTable);
  }, [syncTable, sheetSync.link, pushSyncTable]);

  // Tell the others in the session which document and page this attendee is on.
  useEffect(() => {
    for (const s of sessions) {
      const docId = activeStudioDoc?.sessionId === s.id ? activeStudioDoc.docId : null;
      s.setPresence(docId, docId ? pageIndex : null);
    }
  }, [sessions, activeStudioDoc?.sessionId, activeStudioDoc?.docId, pageIndex]);

  // And tell everyone on a Project which of its files (and page) is in front of this person.
  const activeProjectLink = activeOpen && !activeStudioDoc ? linkOf(activeOpen.file.id) : null;
  // Markups (and replies) on a Project file are by the person's Microsoft email, as the Project
  // knows them, rather than the app's own author name: everyone sees who made them, and editors'
  // right to change their own markups matches.
  useSyncExternalStore(subscribeMicrosoftUser, microsoftUser);
  authorRef.current = activeProjectLink ? projectAuthor(author) : author;
  useEffect(() => {
    for (const p of openProjects()) {
      const here = activeProjectLink?.projectId === p.id;
      p.setPresence(here ? activeProjectLink.fileId : null, here ? pageIndex : null);
    }
  }, [activeProjectLink?.projectId, activeProjectLink?.fileId, pageIndex, projectsOpened]);

  const persistAuthor = (value: string) => {
    setAuthor(value);
    try {
      localStorage.setItem(AUTHOR_KEY, value);
    } catch {
      // Storage unavailable; the name lasts for this session.
    }
  };

  const showLeft = (tab: LeftTab) => {
    setLeftTab(tab);
    setLeftOpen(true);
    if (tab === 'search') setSearchFocus((n) => n + 1);
  };

  const showBottomPanel = (tab: BottomTab) => {
    setBottomTab(tab);
    setShowBottom(true);
  };

  const downloadCsv = (csv: string) => {
    if (!activeOpen) return;
    // Byte-order mark so Excel reads the CSV as UTF-8.
    download(activeOpen.file.name.replace(/\.pdf$/i, '') + ' markups.csv', new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
  };

  const currentPageOps = () => [v?.currentPageIndex ?? pageIndex];

  const onDockSplit = (e: { preventDefault(): void; clientY: number }) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = dockHeight;
    const move = (ev: PointerEvent) => {
      setDockHeight(Math.max(80, Math.min(window.innerHeight * 0.5, startH + (startY - ev.clientY))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onLeftResize = (e: { preventDefault(): void; clientX: number }) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth;
    const move = (ev: PointerEvent) => {
      setLeftWidth(Math.max(180, Math.min(480, startW + (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onSplitResize = (e: { preventDefault(): void; clientX: number; clientY: number }) => {
    e.preventDefault();
    const startX = splitHorizontal ? e.clientY : e.clientX;
    const start = splitRatio;
    const panes = document.querySelector('.panes');
    const width = (splitHorizontal ? panes?.clientHeight : panes?.clientWidth) || 1;
    const move = (ev: PointerEvent) => {
      setSplitRatio(Math.max(0.2, Math.min(0.8, start + ((splitHorizontal ? ev.clientY : ev.clientX) - startX) / width)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startSplit = () => {
    if (split) return;
    splitFileRef.current?.click();
  };

  /** Swaps the two panes' tabs. */
  const swapPanes = () => {
    const a = openRef.current;
    const b = openBRef.current;
    if (!a || !b || !ctl || !ctlB) return;
    const tabs = tabsARef.current;
    savedViews.current.set(a.file.id, ctl.viewer.getView());
    savedViews.current.set(b.file.id, ctlB.viewer.getView());
    setTabs('a', tabsBRef.current);
    setTabs('b', tabs);
    showInPane('a', b);
    showInPane('b', a);
  };

  /** One pane's row of document tabs: click to bring forward, × or middle-click to close. */
  const docTabs = (pane: Pane) => {
    const tabs = pane === 'b' ? tabsB : tabsA;
    const front = pane === 'b' ? openB : open;
    return (
      <div className="doc-tabs" role="tablist" aria-label={pane === 'b' ? 'Right pane documents' : 'Documents'}>
        {tabs.map((t) => {
          const session = studioDocOf(t.file.id);
          const sessionName = session ? snapshots.find((s) => s.meta.id === session.sessionId)?.meta.name : null;
          return (
            <div
              key={t.file.id}
              role="tab"
              aria-selected={t === front}
              className={`doc-tab${t === front ? ' active' : ''}`}
              title={session ? `${t.file.name} · Live Session ${sessionName ?? session.sessionId}` : t.file.name}
              onClick={() => activateTab(pane, t)}
              onContextMenu={(e) => showMenu(e, tabMenu(pane, t))}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify({ pane, id: t.file.id }));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(TAB_DRAG_TYPE)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData(TAB_DRAG_TYPE);
                if (!raw) return;
                e.preventDefault();
                e.stopPropagation();
                const from = JSON.parse(raw) as { pane: Pane; id: string };
                // Reorder within the pane: the dragged tab takes this tab's place.
                if (from.pane !== pane || from.id === t.file.id) return;
                const list = [...(pane === 'b' ? tabsBRef.current : tabsARef.current)];
                const moved = list.find((x) => x.file.id === from.id);
                if (!moved) return;
                const rest = list.filter((x) => x !== moved);
                rest.splice(rest.indexOf(t) + (list.indexOf(moved) < list.indexOf(t) ? 1 : 0), 0, moved);
                setTabs(pane, rest);
              }}
              onMouseDown={(e) => {
                // Middle-click closes, as in browsers.
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(pane, t.file.id);
              }}
            >
              {session && (
                <span className="studio-badge" title={`Live Session document${sessionName ? ` (${sessionName})` : ''}: markups sync with everyone in the session`}>
                  Live
                </span>
              )}
              <TabName t={t} saved={savedTick} />
              <button
                type="button"
                className="close"
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(pane, t.file.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        {tabs.length === 0 && <div className="doc-tab empty">No document</div>}
        <button
          type="button"
          className="doc-tab-add"
          title="Open a PDF in a new tab"
          onClick={() => {
            setActivePane(pane);
            activePaneRef.current = pane;
            openFromDisk();
          }}
        >
          +
        </button>
      </div>
    );
  };

  const activeStats = paneB ? statsB : stats;
  const activeMode = activeStats?.mode;

  // --- Right-click menus -----------------------------------------------------------------

  const showMenu = (e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  /**
   * A Tool Library tool dragged onto a page: a saved markup lands as an exact copy under the pointer;
   * a style-only tool is armed to draw with. Returns false when the drag was not a tool.
   */
  const dropTool = (e: ReactDragEvent, pane: Pane): boolean => {
    const id = e.dataTransfer.getData(TOOL_DRAG_TYPE);
    if (!id) return false;
    e.preventDefault();
    setDragOver(false);
    const item = profiles.active().state.toolChests.flatMap((t) => t.items).find((i) => i.id === id);
    const { c, o } = paneParts(pane);
    if (!item || !c || !o || o.store.readOnly) return true;
    setActivePane(pane);
    if (item.markups?.length) {
      const page = c.viewer.pageNearClient(e.clientX, e.clientY);
      c.tools.placeTemplate(item.markups, page, c.viewer.clientToPage(e.clientX, e.clientY, page), false, item.sequence);
    } else {
      useToolItem(item, 'style');
    }
    return true;
  };

  /** Tool picks for the page menu, grouped like the Markup and Measure menus. */
  const toolEntries = (tools: MarkupTools, list: { tool: Tool }[]): MenuEntry[] =>
    list.map(({ tool }) => ({
      label: isMarkupTool(tool) ? MARKUP_LABELS[tool] : tool === 'select' ? 'Select' : 'Calibrate',
      shortcut: toolShortcut(tool),
      checked: tools.getState().tool === tool,
      onClick: () => tools.setTool(tool),
    }));

  /** Right-click › Auto-size Text Box: each selected text box fitted to its text. */
  const autoSizeTextBoxes = (store: MarkupStore, ms: readonly Markup[]) => {
    const g = document.createElement('canvas').getContext('2d');
    if (!g) return;
    const sized = ms.flatMap((m) => {
      if (m.locked || !store.mayEdit(m)) return [];
      // As text boxes draw it: the font at its size in points.
      g.font = cssFont(m.style, m.style.fontSize ?? 12);
      const points = autoSizedPoints(m, (t) => g.measureText(t).width);
      return points ? [{ id: m.id, points }] : [];
    });
    if (!sized.length) return;
    store.checkpoint();
    store.batch(() => sized.forEach(({ id, points }) => store.update(id, { points })));
  };

  /** Right-click › Round All Corners: rounds (or, when all are rounded, squares) rectangles', polygons' and polylines' corners. */
  const roundCorners = (store: MarkupStore, ms: readonly Markup[], round: boolean) => {
    const targets = ms.filter((m) => canRoundCorners(m) && !m.locked && store.mayEdit(m));
    if (!targets.length) return;
    store.checkpoint();
    store.batch(() =>
      targets.forEach((m) => {
        const { cornerRadius: _radius, ...square } = m.style;
        store.update(m.id, { style: round ? { ...square, cornerRadius: m.style.cornerRadius || defaultCornerRadius(m) } : square });
      }),
    );
  };

  /**
   * Right-click › Capture: a picture of each markup with the drawing around it, kept with the markup
   * (the Markups list's Capture column). Small JPEGs, as they travel with the document.
   */
  const captureMarkups = async (o: OpenFile, ms: readonly Markup[]) => {
    const store = o.store;
    const pictures: { id: string; capture: string }[] = [];
    for (const m of ms) {
      if (!store.mayEdit(m)) continue;
      const b = shapeBounds(m);
      const pad = Math.max(24, Math.max(b.w, b.h) * 0.25);
      const region = await renderRegion(o, m.pageIndex, { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, (w, h) => Math.min(3, 640 / Math.max(w, h)));
      if (!region) continue;
      // JPEG has no transparency: paper white behind the drawing.
      const flat = document.createElement('canvas');
      flat.width = region.canvas.width;
      flat.height = region.canvas.height;
      const g = flat.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, flat.width, flat.height);
      g.drawImage(region.canvas, 0, 0);
      pictures.push({ id: m.id, capture: flat.toDataURL('image/jpeg', 0.8) });
    }
    if (!pictures.length) return;
    store.checkpoint();
    store.batch(() => pictures.forEach(({ id, capture }) => store.update(id, { capture })));
    setNotice(`Captured ${pictures.length} markup${pictures.length === 1 ? '' : 's'}. The Capture column in the Markups list shows ${pictures.length === 1 ? 'it' : 'them'}.`);
  };

  /**
   * Right-click › Flatten: burns the selected markups into their pages; the rest stay markups. The
   * file as it was is kept as a revision first.
   */
  const flattenSelected = async (pane: Pane, ms: readonly Markup[]) => {
    const { c, o } = paneParts(pane);
    if (!o) return;
    if (studioDocOf(o.file.id)) {
      setError('A Live Session document is shared with others, so its markups cannot be flattened here.');
      return;
    }
    const store = o.store;
    // Links stay interactive and Spaces are not drawn, so neither is flattened.
    const targets = ms.filter((m) => m.type !== 'hyperlink' && m.type !== 'space' && !m.locked && store.mayEdit(m));
    if (!targets.length) return;
    const n = `${targets.length} markup${targets.length === 1 ? '' : 's'}`;
    if (!confirm(`Flatten ${n} into the page? ${targets.length === 1 ? 'It becomes' : 'They become'} part of the drawing and can no longer be edited. The file as it is now is kept as a revision.`)) return;
    try {
      // The PDF's own annotations the targets stand for (with their replies and states) go too.
      const imported = store.importedAnnotations();
      const drop: Record<number, number[]> = {};
      for (const m of targets) {
        const l = m.pdfAnnot;
        if (!l || l.space || (l.id ?? m.id) !== m.id || !imported[m.pageIndex]?.includes(l.index)) continue;
        (drop[m.pageIndex] ??= []).push(l.index, ...(l.owned ?? []), ...(l.members?.slice(1) ?? []));
      }
      // Each target is written once as a new annotation (no replies or states, which have nothing to draw).
      const fresh: Markup[] = targets.map(({ pdfAnnot: _link, replies: _replies, checked: _checked, ...m }) => ({ ...m, status: 'none' }));
      const { exportWithAnnotations } = await import('@nb/markup/export');
      const exported = await exportWithAnnotations(await readFile(o.file.hash), fresh, { scaleFor: (i) => store.scaleFor(i), viewports: store.allViewports() });
      const { flattenSelection } = await import('./documents/process');
      const { bytes, count } = await flattenSelection(exported, new Set(fresh.map((m) => m.id)), drop);
      c?.tools.select([]);
      await commitDocument(o, bytes.slice().buffer, () => store.removeFlattened(targets.map((m) => m.id), drop), `Before flattening ${n}`);
      setNotice(`Flattened ${count} markup${count === 1 ? '' : 's'} into the page. File › Revisions has the file as it was.`);
    } catch (err) {
      setError(`Flatten failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * Right-click on markups, in Bluebeam's order: clipboard and delete; type-specific edits; layer,
   * order, alignment, action, capture, flatten, group, lock, hide and legend; review; Tool Library;
   * defaults and properties.
   */
  const markupMenu = (pane: Pane, ids: string[]): MenuEntry[] => {
    const { c, o } = paneParts(pane);
    if (!c || !o) return [];
    const store = o.store;
    const ms = ids.map((id) => store.get(id)).filter((m): m is Markup => !!m);
    const first = ms[0];
    if (!first) return [];
    const ro = store.readOnly;
    const one = ms.length === 1;
    // A callout (alone, or with its cloud in a Cloud+) can take extra leaders.
    const callouts = ms.filter((m) => m.type === 'callout');
    const callout = callouts.length === 1 ? callouts[0] : undefined;
    const status = one ? first.status : null;
    const setStatus = (s: string) => {
      store.checkpoint();
      store.batch(() => ms.forEach((m) => store.update(m.id, { status: s })));
    };
    const setAll = (patch: (m: Markup) => Partial<Markup>) => {
      store.checkpoint();
      store.batch(() => ms.forEach((m) => store.update(m.id, patch(m))));
    };
    const anyLocked = ms.some((m) => m.locked);
    // Someone else's markups, in a Live Session where this person may edit only their own: like
    // locked ones, they keep only their status and replies open.
    const theirs = ms.some((m) => !store.mayEdit(m));
    const allLocked = ms.every((m) => m.locked || !store.mayEdit(m));
    const grouped = ms.some((m) => m.groupId);
    const roundable = ms.filter((m) => canRoundCorners(m));
    const allRound = roundable.length > 0 && roundable.every((m) => m.style.cornerRadius);
    const pageCount = o.doc.pages.length;
    const session = studioDocOf(o.file.id);
    return [
      { label: 'Cut', icon: MENU_ICONS.cut, shortcut: shortcutLabel('edit.cut'), disabled: ro || allLocked, onClick: () => cutMarkups(pane) },
      { label: 'Copy', icon: MENU_ICONS.copy, shortcut: shortcutLabel('edit.copy'), onClick: () => copyMarkups(pane) },
      { label: 'Paste', icon: MENU_ICONS.paste, shortcut: shortcutLabel('edit.paste'), disabled: ro || !clipboard.current.length, onClick: () => c.tools.paste(clipboard.current, first.pageIndex, null) },
      { label: 'Multiply…', icon: MENU_ICONS.multiply, shortcut: shortcutLabel('edit.multiply'), disabled: ro || allLocked, onClick: () => setMultiplyFor(pane) },
      { label: 'Format Painter', icon: MENU_ICONS.painter, shortcut: shortcutLabel('edit.formatPainter'), disabled: ro || !one, onClick: () => c.tools.setTool('painter') },
      { label: 'Delete', icon: MENU_ICONS.delete, shortcut: 'Del', disabled: ro || allLocked, onClick: () => c.tools.deleteSelected() },
      SEP,
      { label: 'Round All Corners', checked: allRound, disabled: ro || !roundable.some((m) => !m.locked && store.mayEdit(m)), onClick: () => roundCorners(store, ms, !allRound) },
      { label: 'Change Colours…', disabled: ro || allLocked, onClick: () => setChangeColoursFor({ pane, ids }) },
      { label: 'Auto-size Text Box', shortcut: shortcutLabel('edit.autoSize'), disabled: ro || allLocked || !ms.some(canAutoSize), onClick: () => autoSizeTextBoxes(store, ms) },
      // What only some kinds of markup have.
      ...(one && isTextType(first.type) ? [{ label: 'Edit Text', disabled: ro || theirs || !!first.locked, onClick: () => setEditingText(first.id) }] : []),
      ...(one && !isTextType(first.type) ? [{ label: first.comment ? 'Edit Comment…' : 'Add Comment…', disabled: ro || theirs, onClick: () => setCommentEdit({ pane, id: first.id }) }] : []),
      ...(ms.every((m) => ROTATABLE.has(m.type))
        ? [
            {
              label: 'Rotate',
              disabled: ro || allLocked,
              items: [
                { label: 'Rotate 90° Clockwise', onClick: () => turnMarkups(store, ms, 90) },
                { label: 'Rotate 90° Counterclockwise', onClick: () => turnMarkups(store, ms, -90) },
                {
                  label: 'Rotate…',
                  onClick: () =>
                    void askText('Rotate', String(first.rotation ?? 0), { label: 'Angle in degrees, clockwise (drag the round handle above a selected markup to turn it freely).', confirm: 'Rotate' }).then((t) => {
                      const deg = Number(t);
                      if (t !== null && Number.isFinite(deg)) turnMarkups(store, ms, deg, true);
                    }),
                },
                { label: 'Reset Rotation', disabled: !ms.some((m) => m.rotation), onClick: () => turnMarkups(store, ms, 0, true) },
              ],
            },
          ]
        : []),
      ...(callout
        ? [
            { label: 'Add Leader', disabled: ro || !!callout.locked, onClick: () => c.tools.addCalloutLeader(callout.id) } as MenuEntry,
            ...(callout.points.length >= 6 ? [{ label: 'Remove Last Leader', disabled: ro || !!callout.locked, onClick: () => c.tools.removeCalloutLeader(callout.id) } as MenuEntry] : []),
          ]
        : []),
      ...(one && first.attachment
        ? [
            { label: 'Open Attachment', onClick: () => openAttachment(first) },
            { label: 'Save Attachment…', onClick: () => download(first.attachment!.name, attachmentBlob(first.attachment!)) },
          ]
        : []),
      SEP,
      {
        label: 'Layer',
        disabled: ro,
        items: [
          ...[...new Set(store.all().flatMap((m) => (m.layer ? [m.layer] : [])))].sort().map((name) => ({
            label: name,
            checked: ms.every((m) => m.layer === name),
            onClick: () => setAll(() => ({ layer: name })),
          })),
          { label: 'No Layer', checked: ms.every((m) => !m.layer), onClick: () => setAll(() => ({ layer: undefined })) },
          SEP,
          {
            label: 'New Layer…',
            onClick: () =>
              void askText('New Markup Layer', '', { label: 'The selected markups move to it. Layers show and hide in the Layers panel, and are PDF layers in saved files.', confirm: 'Create' }).then((name) => {
                if (name) setAll(() => ({ layer: name }));
              }),
          },
        ],
      },
      {
        label: 'Order',
        disabled: ro,
        items: [
          { label: 'Bring to Front', shortcut: shortcutLabel('edit.bringToFront'), onClick: () => c.tools.arrange(ids, 'front') },
          { label: 'Bring Forward', shortcut: shortcutLabel('edit.bringForward'), onClick: () => c.tools.arrange(ids, 'forward') },
          { label: 'Send Backward', shortcut: shortcutLabel('edit.sendBackward'), onClick: () => c.tools.arrange(ids, 'backward') },
          { label: 'Send to Back', shortcut: shortcutLabel('edit.sendToBack'), onClick: () => c.tools.arrange(ids, 'back') },
        ],
      },
      {
        label: 'Alignment',
        disabled: ro || allLocked,
        items: [
          { label: 'Align Left', shortcut: shortcutLabel('edit.alignLeft'), disabled: one, onClick: () => c.tools.alignSelected('left') },
          { label: 'Align Center', shortcut: shortcutLabel('edit.alignCenter'), disabled: one, onClick: () => c.tools.alignSelected('center') },
          { label: 'Align Right', shortcut: shortcutLabel('edit.alignRight'), disabled: one, onClick: () => c.tools.alignSelected('right') },
          { label: 'Align Top', shortcut: shortcutLabel('edit.alignTop'), disabled: one, onClick: () => c.tools.alignSelected('top') },
          { label: 'Align Middle', shortcut: shortcutLabel('edit.alignMiddle'), disabled: one, onClick: () => c.tools.alignSelected('middle') },
          { label: 'Align Bottom', shortcut: shortcutLabel('edit.alignBottom'), disabled: one, onClick: () => c.tools.alignSelected('bottom') },
          SEP,
          { label: 'Distribute Horizontally', disabled: ms.length < 3, onClick: () => c.tools.distributeSelected('horizontal') },
          { label: 'Distribute Vertically', disabled: ms.length < 3, onClick: () => c.tools.distributeSelected('vertical') },
          SEP,
          { label: 'Flip Horizontal', shortcut: shortcutLabel('edit.flipHorizontal'), onClick: () => c.tools.flipSelected('horizontal') },
          { label: 'Flip Vertical', shortcut: shortcutLabel('edit.flipVertical'), onClick: () => c.tools.flipSelected('vertical') },
        ],
      },
      // Any markup can carry an action (a flag that opens a detail, a cloud that opens an RFI page).
      { label: 'Edit Action…', shortcut: shortcutLabel('edit.editAction'), disabled: ro || theirs || !one, onClick: () => setHyperlinkEdit({ pane, id: first.id }) },
      {
        label: 'Capture',
        disabled: ro,
        items: [
          {
            label: ms.some((m) => m.capture) ? 'Capture Again' : 'Capture',
            disabled: theirs,
            onClick: () => void captureMarkups(o, ms).catch((err) => setError(`Capture failed: ${err instanceof Error ? err.message : String(err)}`)),
          },
          { label: 'View Capture', disabled: !one || !first.capture, onClick: () => setCaptureView(first.capture ?? null) },
          { label: 'Remove Capture', disabled: theirs || !ms.some((m) => m.capture), onClick: () => setAll(() => ({ capture: undefined })) },
        ],
      },
      { label: 'Flatten', icon: MENU_ICONS.flatten, disabled: ro || allLocked || !!session || ms.every((m) => m.type === 'hyperlink' || m.type === 'space'), onClick: () => void flattenSelected(pane, ms) },
      grouped
        ? { label: 'Ungroup', shortcut: shortcutLabel('edit.ungroup'), disabled: ro || allLocked, onClick: () => c.tools.ungroup() }
        : { label: 'Group', shortcut: shortcutLabel('edit.group'), disabled: ro || one || allLocked, onClick: () => c.tools.group() },
      { label: anyLocked ? 'Unlock' : 'Lock', shortcut: shortcutLabel('edit.lock'), disabled: ro || theirs, onClick: () => c.tools.setLocked(!anyLocked) },
      {
        label: ms.every((m) => m.hidden) ? 'Show' : 'Hide',
        icon: MENU_ICONS.hide,
        disabled: ro,
        onClick: () => {
          const hide = !ms.every((m) => m.hidden);
          setAll(() => ({ hidden: hide || undefined }));
          if (hide) c.tools.select([]);
        },
      },
      {
        label: 'Legend',
        icon: MENU_ICONS.legend,
        disabled: ro,
        items: [
          {
            label: 'Show in Legends',
            checked: ms.every((m) => !m.legendHidden),
            disabled: theirs,
            onClick: () => {
              const show = !ms.every((m) => !m.legendHidden);
              setAll(() => ({ legendHidden: show ? undefined : true }));
            },
          },
          { label: 'New Legend', onClick: () => c.tools.setTool('legend') },
          ...(one && first.type === 'legend'
            ? [
                SEP,
                ...(['page', 'document'] as const).map((scope) => ({
                  label: scope === 'page' ? 'Lists Markups on This Page' : 'Lists Markups in the Document',
                  checked: (first.legend?.scope ?? 'page') === scope,
                  onClick: () => store.update(first.id, { legend: { scope } }),
                })),
              ]
            : []),
        ],
      },
      SEP,
      { label: 'Reply', icon: MENU_ICONS.reply, disabled: ro || !one, onClick: () => setReplyTo({ pane, id: first.id }) },
      {
        label: 'Set Status',
        disabled: ro,
        items: store.columnSet().statuses.map((s) => ({
          label: s.id === 'none' ? 'None' : s.name,
          checked: status === s.id,
          onClick: () => setStatus(s.id),
        })),
      },
      {
        label: 'Check',
        checked: ms.every((m) => m.checked),
        disabled: ro,
        onClick: () => {
          const check = !ms.every((m) => m.checked);
          setAll(() => ({ checked: check || undefined }));
        },
      },
      {
        label: ms.every((m) => m.flagged) ? 'Unflag' : 'Flag',
        disabled: ro,
        onClick: () => {
          const flag = !ms.every((m) => m.flagged);
          setAll(() => ({ flagged: flag || undefined }));
        },
      },
      ...(session
        ? [
            {
              label: 'Send Markup Alert…',
              disabled: !one || sessionById(session.sessionId)?.meta.status !== 'active',
              onClick: () =>
                void askText('Send Markup Alert', first.comment ?? '', { label: 'Everyone in the session is shown this markup, with your message.', confirm: 'Send' }).then((text) => {
                  if (text) sessionById(session.sessionId)?.sendAlert(session.docId, first.id, first.pageIndex, text);
                }),
            },
          ]
        : []),
      SEP,
      {
        label: 'Add to Tool Library',
        items: [
          ...profiles
            .active()
            .state.toolChests.filter((t) => t.id !== RECENT_TOOLS_ID)
            .map((t) => ({ label: t.name, onClick: () => toolChestItemsOf(ms, store).forEach((item) => addToToolSet(t.id, item)) })),
          SEP,
          {
            label: 'New Tool Set…',
            onClick: () =>
              void askText('New Tool Set', 'My Tools', { confirm: 'Create' }).then((name) => {
                if (name) {
                  const id = createToolSet(name);
                  toolChestItemsOf(ms, store).forEach((item) => addToToolSet(id, item));
                }
              }),
          },
        ],
      },
      SEP,
      { label: 'Set as Default', disabled: !one, onClick: () => c.tools.setDefaultStyle(first.type, first.style) },
      {
        label: 'Apply to Pages…',
        disabled: ro || allLocked || pageCount < 2,
        onClick: () =>
          void askText('Apply to Pages', `1-${pageCount}`, { label: 'Pages to copy the selection onto, at the same place: for example 1-3, 5, 8- (each markup’s own page is skipped).', confirm: 'Apply' }).then((text) => {
            const pages = text === null ? [] : parsePageRange(text, pageCount);
            if (pages.length) c.tools.applyToPages(pages);
          }),
      },
      { label: 'Properties', icon: MENU_ICONS.properties, onClick: () => showLeft('properties') },
    ];
  };

  /** Right-click on an empty part of a page: tools, paste, navigation, zoom, page operations. */
  const pageMenu = (pane: Pane, page: number, pt: PagePoint): MenuEntry[] => {
    const { c, o } = paneParts(pane);
    if (!c) return [];
    if (!o) return [{ label: 'Open…', shortcut: 'Ctrl+O', onClick: () => openFromDisk() }];
    const ro = o.store.readOnly;
    const v = c.viewer;
    const mode = (pane === 'b' ? statsB : stats)?.mode;
    const count = o.doc.pages.length;
    const shared = !!studioDocOf(o.file.id);
    const pageOps = shared || busyPages;
    return [
      ...toolEntries(c.tools, MARKUP_TOOLS.filter((t) => t.tool === 'select')),
      { label: 'Markup', disabled: ro, items: toolEntries(c.tools, MARKUP_TOOLS.filter((t) => t.tool !== 'select')) },
      { label: 'Measure', disabled: ro, items: toolEntries(c.tools, MEASURE_TOOLS) },
      SEP,
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: ro || !clipboard.current.length, onClick: () => c.tools.paste(clipboard.current, page, pt) },
      { label: 'Select All Markups', shortcut: 'Ctrl+A', onClick: () => c.tools.select(o.store.all().map((m) => m.id)) },
      SEP,
      { label: 'Previous View', shortcut: 'Alt+←', disabled: !canGoBack, onClick: goBack },
      { label: 'Previous Page', shortcut: 'PgUp', disabled: page <= 0, onClick: () => v.prevPage() },
      { label: 'Next Page', shortcut: 'PgDn', disabled: page >= count - 1, onClick: () => v.nextPage() },
      SEP,
      { label: 'Zoom In', shortcut: '+', onClick: () => v.zoomSteps(settings.get().buttonZoomStep, 1) },
      { label: 'Zoom Out', shortcut: '−', onClick: () => v.zoomSteps(settings.get().buttonZoomStep, -1) },
      { label: 'Fit Page', shortcut: 'Ctrl+9', onClick: () => v.fit() },
      { label: 'Fit Width', shortcut: 'Ctrl+0', onClick: () => v.fitToWidth() },
      { label: 'Actual Size', shortcut: 'Ctrl+8', onClick: () => v.actualSize() },
      { label: 'Single Page', shortcut: 'Ctrl+4', checked: mode === 'single', onClick: () => v.setPageMode('single') },
      { label: 'Continuous', shortcut: 'Ctrl+5', checked: mode === 'continuous', onClick: () => v.setPageMode('continuous') },
      SEP,
      {
        label: 'Rotate Page',
        disabled: pageOps,
        items: [
          { label: 'Clockwise', onClick: () => void applyPageOps([{ type: 'rotate', pages: [page], quarterTurns: 1 }]) },
          { label: 'Counterclockwise', onClick: () => void applyPageOps([{ type: 'rotate', pages: [page], quarterTurns: 3 }]) },
          { label: '180°', onClick: () => void applyPageOps([{ type: 'rotate', pages: [page], quarterTurns: 2 }]) },
        ],
      },
      { label: 'Insert Pages…', disabled: pageOps, onClick: () => insertFileRef.current?.click() },
      { label: 'Extract Page…', disabled: busyPages, onClick: () => void extractPages([page]) },
      {
        label: 'Delete Page…',
        disabled: pageOps || count < 2,
        onClick: () => {
          if (confirm(`Delete page ${page + 1}? Markups on it are deleted too.`)) void applyPageOps([{ type: 'delete', pages: [page] }]);
        },
      },
      SEP,
      { label: 'Page Labels from Region…', disabled: ro, onClick: () => startLabelRegions(pane) },
      { label: 'Bulk Apply Page Scale…', disabled: ro, onClick: () => startLabelRegions(pane, 'scale') },
      { label: 'Thumbnails', onClick: () => showLeft('pages') },
      { label: 'Properties', onClick: () => showLeft('properties') },
    ];
  };

  canvasMenuRef.current = (e: MouseEvent, pane: Pane) => {
    const { c, o } = paneParts(pane);
    if (!c) return;
    setActivePane(pane);
    activePaneRef.current = pane;
    const page = c.viewer.pageNearClient(e.clientX, e.clientY);
    const pt = c.viewer.clientToPage(e.clientX, e.clientY, page);
    const hit = o ? c.tools.markupAt(pt, page) : undefined;
    if (!hit) {
      showMenu(e, pageMenu(pane, page, pt));
      return;
    }
    // Right-clicking outside the selection selects what was clicked.
    let ids = [...c.tools.getState().selected];
    if (!ids.includes(hit.id)) {
      c.tools.setTool('select');
      c.tools.select([hit.id]);
      ids = [hit.id];
    }
    showMenu(e, markupMenu(pane, ids));
  };

  const copyMarkups = (pane: Pane) => {
    const tools = paneParts(pane).c?.tools;
    const copied = tools?.copySelected() ?? [];
    if (copied.length) {
      clipboard.current = copied;
      setClipboardCount(copied.length);
      // Mark the system clipboard, so a later paste takes these rather than an older picture there.
      void navigator.clipboard?.writeText(`${MARKUP_CLIP} (${copied.length})`).catch(() => {});
    }
    return copied.length > 0;
  };

  const cutMarkups = (pane: Pane) => {
    if (copyMarkups(pane)) paneParts(pane).c?.tools.deleteSelected();
  };

  /** Moves a tab to the other pane, splitting the view first if needed. */
  const moveTab = (from: Pane, t: OpenFile) => {
    const to: Pane = from === 'a' ? 'b' : 'a';
    if (to === 'b' && !ctlB) {
      pendingMove.current = t;
      setSplit(true);
      return;
    }
    const rest = (from === 'b' ? tabsBRef.current : tabsARef.current).filter((x) => x !== t);
    const front = from === 'b' ? openBRef.current : openRef.current;
    setTabs(from, rest);
    if (front === t) showInPane(from, rest[0] ?? null);
    setTabs(to, [...(to === 'b' ? tabsBRef.current : tabsARef.current), t]);
    activateTab(to, t);
    if (from === 'b' && !rest.length) setSplit(false);
  };
  moveTabRef.current = moveTab;

  /** Shows the new revision on the left and the old one on the right (Compare, Overlay). */
  const showSideBySide = async (oldId: string, newId: string) => {
    const files = await listFiles();
    const newFile = files.find((f) => f.id === newId);
    const oldFile = files.find((f) => f.id === oldId);
    if (!newFile || !oldFile) return;
    const newInB = tabsBRef.current.find((t) => t.file.id === newId);
    if (newInB) moveTab('b', newInB);
    else await openFromLibrary(newFile, 'a');
    const oldInA = tabsARef.current.find((t) => t.file.id === oldId);
    const oldInB = tabsBRef.current.find((t) => t.file.id === oldId);
    if (oldInA) moveTab('a', oldInA);
    else if (oldInB) activateTab('b', oldInB);
    else {
      const bytes = await readFile(oldFile.hash);
      if (!ctlB) {
        pendingSplitStored.current = { file: oldFile, bytes };
        setSplit(true);
      } else await openStored(oldFile, bytes, 'b');
    }
    setActivePane('a');
  };
  sideBySideRef.current = showSideBySide;

  /** Shows one difference in both revisions. */
  const goToDifference = ({ page, diff }: CompareStop) => {
    if (!compareResults) return;
    const pad = Math.max(diff.w, diff.h) * 0.6 + 24;
    const around = (x: number, y: number) => ({ x: x - pad, y: y - pad, w: diff.w + pad * 2, h: diff.h + pad * 2 });
    for (const [o, c] of [
      [openRef.current, ctl],
      [openBRef.current, ctlB],
    ] as const) {
      if (!o || !c) continue;
      if (o.file.id === compareResults.newId) c.viewer.zoomToRect(around(diff.x, diff.y), 1, page.newPage);
      else if (o.file.id === compareResults.oldId) {
        const b = mapBox(invertAffine(page.transform), diff);
        const padOld = Math.max(b.w, b.h) * 0.6 + 24;
        c.viewer.zoomToRect({ x: b.x - padOld, y: b.y - padOld, w: b.w + padOld * 2, h: b.h + padOld * 2 }, 1, page.oldPage);
      }
    }
  };

  /** Right-click on a document tab: close, save, add to a session, show where it lives, move pane. */
  const tabMenu = (pane: Pane, t: OpenFile): MenuEntry[] => {
    const tabs = pane === 'b' ? tabsB : tabsA;
    const idx = tabs.indexOf(t);
    const sessionDoc = studioDocOf(t.file.id);
    const snap = sessionDoc ? snapshots.find((s) => s.meta.id === sessionDoc.sessionId) : null;
    const closeMany = (which: OpenFile[]) => which.forEach((x) => closeTab(pane, x.file.id));
    const withTab = (fn: () => void) => () => {
      activateTab(pane, t);
      fn();
    };
    const addable = sessions.filter((s) => s.canAddDocuments);
    return [
      { label: 'Close', onClick: () => closeTab(pane, t.file.id) },
      { label: 'Close All', onClick: () => closeMany(tabs) },
      { label: 'Close All But This', disabled: tabs.length < 2, onClick: () => closeMany(tabs.filter((x) => x !== t)) },
      { label: 'Close Tabs to the Right', disabled: idx === tabs.length - 1, onClick: () => closeMany(tabs.slice(idx + 1)) },
      SEP,
      { label: 'Save', shortcut: 'Ctrl+S', onClick: withTab(() => void saveDocument(false)) },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', onClick: withTab(() => void saveDocument(true)) },
      {
        label: 'Save a Copy of the Original…',
        onClick: () => void readFile(t.file.hash).then((bytes) => download(t.file.name, new Blob([bytes], { type: 'application/pdf' }))),
      },
      SEP,
      sessionDoc
        ? { label: 'Show in Session', onClick: () => { showLeft('sessions'); setFocusedSession(sessionDoc.sessionId); } }
        : {
            label: 'Add to Session',
            items: [
              ...addable.map((s) => ({
                label: s.meta.name,
                onClick: () => void runStudio(() => addToStudio(s.id, [{ kind: 'file', fileId: t.file.id, name: t.file.name }])),
              })),
              ...(addable.length ? [SEP] : []),
              { label: 'Start New Session…', onClick: () => { showLeft('sessions'); setStartSession({ token: Date.now(), fileIds: [t.file.id] }); } },
            ],
          },
      sessionDoc
        ? { label: snap?.backend === 'onedrive' ? 'Open in OneDrive' : 'Open in Google Drive', disabled: !snap?.folderUrl, onClick: () => snap?.folderUrl && window.open(snap.folderUrl, '_blank', 'noopener') }
        : { label: 'Show in File Access', onClick: () => { showLeft('files'); setRevealFile({ id: t.file.id, token: Date.now() }); } },
      { label: 'Copy File Name', onClick: () => void navigator.clipboard?.writeText(t.file.name) },
      SEP,
      { label: pane === 'a' ? (split ? 'Move to Right Pane' : 'Open in Split View') : 'Move to Left Pane', onClick: () => moveTab(pane, t) },
    ];
  };

  /** The panel rail's panels in the profile's order (unlisted ones keep their default place at the end). */
  const orderedRail = [...RAIL].sort((a, b) => {
    const ia = ws.panelOrder.indexOf(a.id);
    const ib = ws.panelOrder.indexOf(b.id);
    return (ia < 0 ? RAIL.length + RAIL.indexOf(a) : ia) - (ib < 0 ? RAIL.length + RAIL.indexOf(b) : ib);
  });

  /** Moves a panel next to another on the rail. */
  const moveRailPanel = (id: LeftTab, target: LeftTab, after: boolean) => {
    if (id === target) return;
    const ids = orderedRail.map((r) => r.id).filter((x) => x !== id);
    ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, id);
    updateWorkspace((w) => ({ ...w, panelOrder: ids }));
  };

  /** Right-click on the markup toolbar: add any tool to it as a button, or take one off. */
  const toolbarMenu = (e: { target: EventTarget | null }): MenuEntry[] => {
    const clicked = (e.target as HTMLElement).closest<HTMLElement>('[data-toolbar-tool]')?.dataset.toolbarTool as Tool | undefined;
    const all = [...MARKUP_TOOLS, ...MEASURE_TOOLS].map((t) => t.tool);
    const onToolbar = (tool: Tool) => !ws.toolbarTools || ws.toolbarTools.includes(tool);
    const toggle = (tool: Tool) =>
      updateWorkspace((w) => {
        const cur = w.toolbarTools ?? all;
        const next = cur.includes(tool) ? cur.filter((t) => t !== tool) : all.filter((t) => t === tool || cur.includes(t));
        return { ...w, toolbarTools: next.length === all.length ? null : next };
      });
    const list = (tools: { tool: Tool; icon: string }[]): MenuEntry[] =>
      tools.map(({ tool, icon }) => ({ label: `${icon}  ${toolLabel(tool)}`, checked: onToolbar(tool), onClick: () => toggle(tool) }));
    return [
      ...(clicked ? [{ label: `Remove ${toolLabel(clicked)} from Toolbar`, onClick: () => toggle(clicked) } as MenuEntry, SEP] : []),
      { label: 'Toolbar Tools', items: [{ label: 'Markup', items: list(MARKUP_TOOLS) }, { label: 'Measure', items: list(MEASURE_TOOLS) }] },
      {
        label: 'Reset Toolbar to Defaults',
        disabled: ws.toolbarTools?.length === DEFAULT_TOOLBAR_TOOLS.length && DEFAULT_TOOLBAR_TOOLS.every((t) => ws.toolbarTools?.includes(t)),
        onClick: () => updateWorkspace((w) => ({ ...w, toolbarTools: [...DEFAULT_TOOLBAR_TOOLS] })),
      },
      SEP,
      ...layoutMenu(),
    ];
  };

  /** Right-click on the panel rail: turn each panel on or off, or restore the default order. */
  const panelsMenu = (): MenuEntry[] => [
    ...orderedRail.map(({ id, title, experimental }): MenuEntry => ({
      label: experimental ? `${title} (Experimental)` : title,
      checked: !ws.hiddenPanels.includes(id),
      disabled: id === 'files',
      onClick: () => {
        const hide = !ws.hiddenPanels.includes(id);
        updateWorkspace((w) => ({ ...w, hiddenPanels: hide ? [...w.hiddenPanels, id] : w.hiddenPanels.filter((x) => x !== id) }));
        if (hide && leftTab === id) setLeftOpen(false);
      },
    })),
    SEP,
    { label: 'Reset Panel Order', disabled: !ws.panelOrder.length, onClick: () => updateWorkspace((w) => ({ ...w, panelOrder: [] })) },
  ];

  /** Right-click on the menu bar, toolbars, panel rail or status bar: which parts of the window show. */
  const layoutMenu = (): MenuEntry[] => [
    { label: 'Markup Toolbar', checked: showTools, onClick: toggleToolbar },
    { label: 'Panels', checked: leftOpen, onClick: () => setLeftOpen((s) => !s) },
    { label: 'Markups List', checked: showBottom, onClick: () => setShowBottom((s) => !s) },
    { label: split ? 'Unsplit' : 'Split View', shortcut: 'Ctrl+2', disabled: !split && !activeOpen, onClick: () => (split ? unsplit() : startSplit()) },
    SEP,
    { label: 'Keyboard Shortcuts', onClick: () => setShortcutsOpen(true) },
  ];

  /** Right-click on a library file (File Access). */
  const libraryMenu = (f: StoredFile): MenuEntry[] => [
    { label: 'Open', onClick: () => void openFromLibrary(f, 'a') },
    { label: `Revisions (${f.revisions?.length ?? 0})…`, onClick: () => setRevisionsOf(f.id) },
    { label: 'Open in Split View', onClick: () => void readFile(f.hash).then(async (bytes) => {
        if (!ctlB) {
          pendingSplitStored.current = { file: f, bytes };
          setSplit(true);
        } else await openStored(f, bytes, 'b');
      }) },
    {
      label: 'Add to Session',
      disabled: !sessions.some((s) => s.canAddDocuments),
      items: sessions
        .filter((s) => s.canAddDocuments)
        .map((s) => ({ label: s.meta.name, onClick: () => void runStudio(() => addToStudio(s.id, [{ kind: 'file', fileId: f.id, name: f.name }])) })),
    },
    SEP,
    { label: 'Save a Copy…', onClick: () => void readFile(f.hash).then((bytes) => download(f.name, new Blob([bytes], { type: 'application/pdf' }))) },
    { label: 'Use as Template', checked: !!f.template, onClick: () => void setTemplate(f.id, !f.template).then(refreshLibrary) },
    { label: 'Copy File Name', onClick: () => void navigator.clipboard?.writeText(f.name) },
    SEP,
    {
      label: 'Remove from Device…',
      danger: true,
      onClick: () => {
        if (confirm(`Remove "${f.name}" from this device? Its markups are kept and return if you open it again.`)) {
          fileGroups.forget(f.id);
          drawingSets.forget(f.id);
          void removeFile(f).then(refreshLibrary);
        }
      },
    },
  ];

  /** Starts drawing page-label boxes on a pane's document (Document → Page Labels → From Page Region). */
  const startLabelRegions = (pane: Pane = paneB ? 'b' : 'a', kind: 'label' | 'scale' = 'label') => {
    const { c, o } = paneParts(pane);
    if (!c || !o) return;
    setActivePane(pane);
    setLabelMode((m) => (m?.pane === pane && m.kind === kind ? m : { pane, regions: [], kind }));
    c.tools.setTool('labelRegion');
    setLabelTexts(null);
    void runJob(`Reading · ${o.file.name}`, ({ signal, progress }) => loadPageTexts(() => readFile(o.file.hash), o.store, (p) => progress(p.done, p.total, INDEX_PHASES[p.phase]), signal), { kind: 'index' })
      .then((texts) => {
        if ((pane === 'b' ? openBRef.current : openRef.current) === o) setLabelTexts(texts);
      })
      .catch((err) => {
        if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err));
      });
  };

  useEffect(() => {
    const tools = [ctl?.tools, ctlB?.tools];
    tools.forEach((t, i) => t?.setRegions(labelMode && labelMode.pane === (i ? 'b' : 'a') ? labelMode.regions : []));
    if (!labelMode) for (const t of tools) if (t?.getState().tool === 'labelRegion') t.setTool('select');
  }, [labelMode, ctl, ctlB]);

  const labelDocId = labelMode ? (labelMode.pane === 'b' ? openB : open)?.file.id : null;
  const labelDocRef = useRef(labelDocId);
  useEffect(() => {
    if (labelDocRef.current && labelDocId !== labelDocRef.current) setLabelMode(null);
    labelDocRef.current = labelDocId;
  }, [labelDocId]);

  regionRef.current = (rect) => setLabelMode((m) => (m ? { ...m, regions: [...m.regions, rect] } : m));

  const labelPaneParts = labelMode ? paneParts(labelMode.pane) : null;

  const pageNav = (which: 'a' | 'b') => {
    const s = which === 'b' ? statsB : stats;
    const viewer = which === 'b' ? ctlB?.viewer : ctl?.viewer;
    const o = which === 'b' ? openB : open;
    const sc = which === 'b' ? scalesB : scalesA;
    const sh = which === 'b' ? sheetsB : sheetsA;
    const idx = s?.pageIndex ?? 0;
    const count = s?.pageCount ?? 0;
    const size = o?.doc.pages[idx] ?? null;
    return (
      <PageNav
        pageIndex={idx}
        pageCount={count}
        disabled={!o || !count}
        zoom={s?.zoom ?? 1}
        continuous={s?.mode === 'continuous'}
        onZoomIn={() => viewer?.zoomSteps(settings.get().buttonZoomStep, 1)}
        onZoomOut={() => viewer?.zoomSteps(settings.get().buttonZoomStep, -1)}
        onFit={() => viewer?.fit()}
        onFitWidth={() => viewer?.fitToWidth()}
        onToggleContinuous={() => viewer?.setPageMode(s?.mode === 'continuous' ? 'single' : 'continuous')}
        sheetLabel={sh[idx]?.number ?? undefined}
        sheetTitle={sh[idx]?.title ?? undefined}
        pageWidthPt={size?.width ?? null}
        pageHeightPt={size?.height ?? null}
        scaleControl={
          <ScaleControl
            scale={sc[idx] ?? null}
            pageCount={count}
            disabled={!o}
            onPreset={(scale) => o?.store.setScale([idx], scale)}
            onApplyAll={() => {
              const cur = sc[idx];
              if (cur) o?.store.setScale(Array.from({ length: count }, (_, i) => i), cur);
            }}
          />
        }
        onFirst={() => viewer?.goToPage(0)}
        onPrev={() => viewer?.prevPage()}
        onNext={() => viewer?.nextPage()}
        onLast={() => viewer?.goToPage(Math.max(0, count - 1))}
        onGoTo={(i) => viewer?.goToPage(i)}
        onZoomTo={(z) => viewer && viewer.zoomBy(z / viewer.currentZoom)}
        onBack={goBack}
        onForward={goForward}
        canBack={canGoBack}
        canForward={canGoForward}
      />
    );
  };

  // --- commands: one table behind the menus, shortcuts and command palette ------------------
  const pane: Pane = paneB ? 'b' : 'a';
  const selectedMarkups = activeOpen ? [...toolsState.selected].map((id) => activeOpen.store.get(id)).filter((m): m is Markup => !!m) : [];
  /** Arms the Stamp tool with a library stamp, remembered as the one to use next time. */
  const placeStamp = (s: StampDef) => {
    updateWorkspace((w) => ({ ...w, lastStampId: s.id }));
    activeTools?.setTool('stamp', { stamp: s, once: !settings.get().toolChestSticky });
  };

  const commandActions: CommandActions = {
    open: () => openFromDisk(),
    newFromTemplate: () => void newFromTemplate(),
    fromCamera: () => setCameraOpen(true),
    newPdf: () => setBlankPdf('new'),
    combine: () => setCombineOpen(true),
    close: closeDocument,
    closeAll: () => {
      for (const pane of ['b', 'a'] as const) for (const t of [...(pane === 'b' ? tabsBRef.current : tabsARef.current)]) closeTab(pane, t.file.id);
    },
    saveAll: () =>
      void (async () => {
        for (const t of [...tabsARef.current, ...tabsBRef.current]) {
          try {
            const out = await annotatedBytes(t);
            download(t.file.name.replace(/\.pdf$/i, '') + ' (markups).pdf', new Blob([out as BlobPart], { type: 'application/pdf' }));
          } catch (err) {
            setError(`Saving ${t.file.name} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      })(),
    revert: () => {
      const store = activeOpen?.store;
      const n = store?.undoHistory().length ?? 0;
      if (store && n && confirm(`Revert ${activeOpen!.file.name}? The ${n} change${n === 1 ? '' : 's'} made since it was opened are undone (Redo brings them back).`)) store.undoSteps(n);
    },
    publish: (mode) => setPublishFor(mode),
    share: () => void shareDocument(),
    markupsXfdf: (dir) => void markupsXfdf(dir),
    importMarkupsFromPdf: () => void importMarkupsFromPdf(),
    exportBax: () => void exportMarkupsBax(),
    importBax: () => void importMarkupsBax(),
    save: () => void saveDocument(false),
    saveAs: () => void saveDocument(true),
    exportCsv: () => downloadCsv(rowsToCsv(buildRows(markups, cellContext, listFilters, listSort, ws.list.advanced), visibleListColumns)),
    exportSummary: openSummaryExport,
    print: () => setPrintOpen(true),
    preferences: () => setPrefsOpen(true),
    manageProfiles: () => setProfilesOpen(true),
    shortcuts: () => setShortcutsOpen(true),
    about: () =>
      alert(
        [
          'redcolumn: PDF markup and takeoff for construction drawings.',
          'Open source under the Apache License 2.0. Third-party notices: ' + `${PROJECT_URL}/blob/master/THIRD_PARTY_NOTICES.md`,
          'Your documents stay in this browser; there is no redcolumn server or account. Privacy policy: ' + `${PROJECT_URL}/blob/master/PRIVACY.md`,
          'Measurements and quantities depend on the scale you set: check them before relying on them. redcolumn comes with no warranty.',
          'redcolumn is not affiliated with or endorsed by Bluebeam, Inc. or Nemetschek. Bluebeam and Revu are their trademarks.',
        ].join('\n\n'),
      ),
    undo: () => activeOpen?.store.undo(),
    redo: () => activeOpen?.store.redo(),
    cut: () => cutMarkups(pane),
    copy: () => void copyMarkups(pane),
    paste: () => {
      if (!v || !activeTools) return;
      // At the cursor when it is over the page, else nudged from where the markups were copied.
      const at = lastPointer.current;
      const over = at && at.viewer === v;
      const page = over ? v.pageNearClient(at.x, at.y) : v.currentPageIndex;
      activeTools.paste(clipboard.current, page, over ? v.clientToPage(at.x, at.y, page) : null);
    },
    pasteInPlace: () => v && activeTools?.paste(clipboard.current, v.currentPageIndex, 'inPlace'),
    multiply: () => setMultiplyFor(pane),
    deleteSelection: () => {
      const n = toolsState.selected.size;
      if (n && (!settings.get().confirmDelete || confirm(`Delete ${n} markup${n === 1 ? '' : 's'}?`))) activeTools?.deleteSelected();
    },
    selectAll: () => activeTools?.select(markups.map((m) => m.id)),
    sound: () => setSoundOpen(true),
    undoHistory: () => setUndoHistoryOpen(true),
    checkSpelling: () => setSpellOpen(true),
    autoFields: () =>
      void (async () => {
        const cur = activeOpen;
        if (!cur) return;
        const { detectFields } = await import('./documents/fieldDetect');
        const { createFields, uniqueName } = await import('./documents/forms');
        const existing = formModels[cur.file.hash]?.fields ?? [];
        const names = new Set(existing.map((f) => f.name));
        const specs: { type: 'text' | 'checkbox'; name: string; pageIndex: number; rect: { x: number; y: number; w: number; h: number } }[] = [];
        for (let i = 0; i < cur.doc.pages.length; i++) {
          const [{ segments }, words] = await Promise.all([cur.doc.geometry(i), cur.doc.text(i)]);
          const taken = existing.flatMap((f) => f.widgets.filter((w) => w.pageIndex === i).map((w) => w.rect));
          for (const f of detectFields(segments, words, taken)) {
            const name = names.has(f.name) ? uniqueName(f.name, names) : f.name;
            names.add(name);
            specs.push({ type: f.type, name, pageIndex: i, rect: f.rect });
          }
        }
        if (!specs.length) {
          setNotice('No fill-in lines, boxes or check boxes were found that are not fields already.');
          return;
        }
        if (!confirm(`Create ${specs.length} form field${specs.length === 1 ? '' : 's'} (${specs.filter((s) => s.type === 'checkbox').length} check boxes) where the page has fill-in lines and boxes? They can be renamed or deleted in the Forms panel.`)) return;
        const ok = await editForm(cur.file.id, 'Creating fields', (bytes) => createFields(bytes, specs));
        if (ok) {
          showLeft('forms');
          setNotice(`Created ${specs.length} field${specs.length === 1 ? '' : 's'}.`);
        }
      })().catch((err) => setError(`Finding fields failed: ${err instanceof Error ? err.message : String(err)}`)),
    archivePdfA: () =>
      void (async () => {
        const cur = activeOpen;
        if (!cur || !(await rewriteSigned(cur.doc, 'An archive copy (PDF/A)'))) return;
        const { archiveAsPdfA } = await import('./documents/pdfa');
        const { embedFontFile } = await import('./documents/archiveFonts');
        const base = cur.file.name.replace(/\.pdf$/i, '');
        // Markup text carries its fonts (PDF/A does not allow the standard ones unembedded), and
        // hidden markups are left out: the archive shows what is shown.
        const markups = cur.store.all().filter((m) => !m.hidden);
        const { bytes, changes, blocking } = await archiveAsPdfA(await annotatedBytes(cur, { markups, embedFont: embedFontFile }), base);
        const done = changes.length ? ` ${changes.join(' ')}` : '';
        if (!blocking.length) {
          download(`${base} (PDF-A).pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
          setNotice(`Saved ${base} (PDF-A).pdf as PDF/A-2b.${done}`);
          return;
        }
        // It would not pass a validator, so it is not marked PDF/A; saving it is the user's choice.
        if (!confirm(`${cur.file.name} cannot be made a valid PDF/A:\n\n${blocking.join('\n\n')}\n\nSave an archive copy anyway? It will not be marked as PDF/A.`)) return;
        download(`${base} (archive).pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
        setError(`Saved ${base} (archive).pdf, not marked as PDF/A: ${blocking.join(' ')}${done}`);
      })().catch((err) => setError(`PDF/A failed: ${err instanceof Error ? err.message : String(err)}`)),
    install: () => setInstallOpen(true),
    help: (what) => {
      const open = (path: string) => window.open(`${PROJECT_URL}${path}`, '_blank', 'noopener');
      if (what === 'docs') window.open(`${import.meta.env.BASE_URL}help/index.html`, '_blank', 'noopener');
      else if (what === 'community') open('/discussions');
      else if (what === 'support') open('/issues/new?labels=bug&title=Problem%3A%20');
      else if (what === 'suggest') open('/issues/new?labels=enhancement&title=Suggestion%3A%20');
      else if (what === 'whatsNew') setWhatsNewOpen(true);
      else if (what === 'logs') download(`redcolumn log ${new Date().toISOString().slice(0, 10)}.txt`, logFile());
      else if (what === 'updates') {
        const gate = updateGate();
        if (gate?.waiting) return gate.applyNow();
        void navigator.serviceWorker
          ?.getRegistration()
          .then(async (reg) => {
            if (!reg) return setNotice('Updates are checked automatically when the app is installed.');
            await reg.update();
            setNotice(reg.waiting || reg.installing ? 'A new version is downloading; it loads by itself when you are not in the middle of something.' : 'You have the latest version.');
          })
          .catch(() => setNotice('Could not check for updates (offline?).'));
      }
    },
    hideSelection: () => {
      const store = activeOpen?.store;
      if (!store) return;
      store.checkpoint();
      store.batch(() => toolsState.selected.forEach((id) => store.update(id, { hidden: true })));
      activeTools?.select([]);
    },
    showHidden: () => {
      const store = activeOpen?.store;
      if (!store) return;
      store.checkpoint();
      store.batch(() => store.all().forEach((m) => m.hidden && store.update(m.id, { hidden: undefined })));
    },
    formatPainter: () => activeTools?.setTool('painter'),
    offset: () => activeTools?.setTool('offset'),
    group: () => activeTools?.group(),
    ungroup: () => activeTools?.ungroup(),
    lock: (locked) => activeTools?.setLocked(locked),
    autoSize: () => {
      const store = activeOpen?.store;
      const ids = activeTools ? [...activeTools.getState().selected] : [];
      if (store) autoSizeTextBoxes(store, ids.map((id) => store.get(id)).filter((m): m is Markup => !!m));
    },
    editAction: () => {
      const ids = activeTools ? [...activeTools.getState().selected] : [];
      if (ids.length === 1) setHyperlinkEdit({ pane: activePane, id: ids[0]! });
    },
    find: () => {
      setLeftTab('search');
      setLeftOpen(true);
      setSearchFocus((n) => n + 1);
    },
    fit: () => v?.fit(),
    fitWidth: () => v?.fitToWidth(),
    actualSize: () => v?.actualSize(),
    zoomIn: () => v?.zoomSteps(settings.get().buttonZoomStep, 1),
    zoomOut: () => v?.zoomSteps(settings.get().buttonZoomStep, -1),
    singlePage: () => v?.setPageMode('single'),
    continuous: () => v?.setPageMode('continuous'),
    spread: (columns, cover, continuous) => {
      setSpread({ columns, cover });
      v?.setPageMode(continuous ? 'continuous' : 'single');
    },
    splitHorizontal: () => {
      setSplitHorizontal(true);
      startSplit();
    },
    sync: setSync,
    magnifier: () => setMagnifier((m) => !m),
    fullScreen: toggleFullScreen,
    stitch: () => openStitch(activeMode === 'stitch' ? null : currentStitch, pageIndex),
    split: () => {
      setSplitHorizontal(false);
      startSplit();
    },
    unsplit,
    switchPanes: swapPanes,
    balance: () => setSplitRatio(0.5),
    rotateView: (q) => v?.rotateView(q),
    setSettings: (patch) => settings.set(patch),
    snapContent: (on) => activeTools?.setSnap(on),
    showLinks: (show) => activeTools?.setShowLinks(show),
    back: goBack,
    forward: goForward,
    goToPage: (which) => {
      if (!v) return;
      if (which === 'next') v.nextPage();
      else if (which === 'prev') v.prevPage();
      else v.goToPage(which === 'first' ? 0 : pageCount - 1);
    },
    documentProperties: () => setDocPropsOpen(true),
    rotatePages: (quarterTurns) => {
      showLeft('pages');
      void applyPageOps([{ type: 'rotate', pages: currentPageOps(), quarterTurns }]);
    },
    insertPages: () => {
      showLeft('pages');
      insertFileRef.current?.click();
    },
    insertBlank: () => setBlankPdf('blank'),
    extractPages: () => setPageTool({ kind: 'extract', drawnRect: null }),
    pageTool: (kind) => setPageTool({ kind, drawnRect: null }),
    headerFooter: (mode) => {
      const cur = activeOpen;
      if (!cur) return;
      void readFile(cur.file.hash)
        .then((b) => import('./documents/headerFooter').then((m) => m.hasHeaderFooter(b)))
        .then((hasExisting) => setHeaderFooter({ mode, hasExisting }));
    },
    process: (kind) => setProcessKind(kind),
    unflatten: () => {
      const cur = activeOpen;
      if (cur) void runProcess(cur, { kind: 'unflatten' }, 'Before Unflatten').then((msg) => msg && setNotice(msg)).catch((err) => setError(`Unflatten failed: ${err instanceof Error ? err.message : String(err)}`));
    },
    compare: () => setCompareOpen('compare'),
    batch: (kind) => setBatchOpen(kind),
    security: () => setSecurityOpen(true),
    showPanel: (tab) => showLeft(tab),
    focusPanel: (id) => {
      if (id === 'markups' || id === 'links') showBottomPanel(id);
      else showLeft(id);
    },
    togglePanels: () => {
      const open = leftOpen || showBottom;
      setLeftOpen(!open);
      setShowBottom(!open);
    },
    addBookmark: () => {
      const cur = activeOpen;
      if (!cur || !v) return;
      const view = visibleView(v, paneB ? canvasBRef.current : canvasRef.current);
      const mark: Bookmark = { id: crypto.randomUUID(), title: pageLabelFor(cur, view.pageIndex), pageIndex: view.pageIndex, rect: view.rect, children: [] };
      cur.store.setBookmarks(insertBookmark(cur.store.bookmarks(), mark));
      showLeft('bookmarks');
    },
    cycleDocument: (dir) => {
      const tabs = pane === 'b' ? tabsBRef.current : tabsARef.current;
      const front = pane === 'b' ? openBRef.current : openRef.current;
      if (tabs.length < 2 || !front) return;
      const i = tabs.findIndex((t) => t.file.id === front.file.id);
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      if (next) activateTab(pane, next);
    },
    align: (how) => activeTools?.alignSelected(how),
    flip: (axis) => activeTools?.flipSelected(axis),
    arrange: (where) => activeTools && activeTools.arrange(activeTools.getState().selected, where),
    sign: () => {
      showLeft('signatures');
      setSignFor({ fieldName: null });
    },
    digitalIds: () => setIdsOpen(true),
    slipSheet: () => setSlipSheetOpen(true),
    revisions: () => activeOpen && setRevisionsOf(activeOpen.file.id),
    overlay: () => setCompareOpen('overlay'),
    ocr: () => {
      const cur = activeOpen;
      if (!cur) return;
      void Promise.all(cur.doc.pages.map((_, i) => cur.doc.text(i).then((w) => (w.length ? -1 : i)))).then((r) => setOcrFor(r.filter((i) => i >= 0)));
    },
    applyRedactions: () => {
      const cur = activeOpen;
      if (!cur) return;
      const marks = cur.store.all().filter((m) => m.type === 'redaction');
      if (!marks.length) {
        setNotice('Nothing is marked for redaction: use Tools › Redaction › Mark for Redaction, or Search › Mark for redaction.');
        return;
      }
      setRedactFor({ pane: paneB ? 'b' : 'a', count: marks.length });
    },
    repair: () => {
      const cur = activeOpen;
      if (cur) void runProcess(cur, { kind: 'repair' }, 'Before Repair').then((msg) => msg && setNotice(msg)).catch((err) => setError(`Repair failed: ${err instanceof Error ? err.message : String(err)}`));
    },
    deletePages: () => {
      const pages = currentPageOps();
      if (!confirm(`Delete page ${pages[0]! + 1}? Markups on it are deleted too.`)) return;
      showLeft('pages');
      void applyPageOps([{ type: 'delete', pages }]);
    },
    labelRegions: () => startLabelRegions(),
    scaleRegions: () => startLabelRegions(undefined, 'scale'),
    thumbnails: () => showLeft('pages'),
    setTool: (tool) => activeTools?.setTool(tool),
    manageColumns: () => setColumnsOpen(true),
    signatures: () => showLeft('signatures'),
    toggleToolbar,
    toggleLeft: () => setLeftOpen((s) => !s),
    toggleBottom: () => setShowBottom((s) => !s),
    commandPalette: () => setPaletteOpen(true),
    manageStamps: () => setStampsOpen(true),
  };
  /** File › New PDF from Template: a copy of a template document (its markups too) under a new name. */
  const newFromTemplate = async () => {
    const templates = library.filter((f) => f.template);
    if (!templates.length) return;
    const choice = templates.length === 1 ? templates[0]! : await pickTemplate(templates);
    if (!choice) return;
    const name = await askText('New PDF from Template', choice.name.replace(/\.pdf$/i, '') + ' copy.pdf', { label: `A new document from the template "${choice.name}".`, confirm: 'Create' });
    if (!name) return;
    try {
      const { PDFDocument } = await import('pdf-lib');
      // Written again with its own title and date, so the copy is a document of its own (not the template's twin).
      const pdf = await PDFDocument.load(await readFile(choice.hash), { ignoreEncryption: true });
      pdf.setTitle(name.replace(/\.pdf$/i, ''));
      pdf.setCreationDate(new Date());
      pdf.setModificationDate(new Date());
      const bytes = (await pdf.save()).slice().buffer;
      const file = await saveFile(/\.pdf$/i.test(name) ? name : `${name}.pdf`, bytes);
      // The template's markups come along (new ids).
      const [from, to] = await Promise.all([MarkupStore.open(choice.id), MarkupStore.open(file.id)]);
      const now = Date.now();
      to.batch(() => from.all().forEach((m) => to.add({ ...m, id: crypto.randomUUID(), author: authorRef.current, createdAt: now, modifiedAt: now })));
      if (from.hasColumnSet()) to.setColumnSet(from.columnSet());
      await Promise.all([from.destroy(), to.destroy()]);
      await openStored(file, bytes, activePaneRef.current);
      void refreshLibrary();
    } catch (err) {
      setError(`New from template failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** File › Share / Email: the PDF with markups to the system share sheet (mail, messages…), else a download and a new mail. */
  const shareDocument = async () => {
    const cur = activeOpen;
    if (!cur) return;
    try {
      const out = await annotatedBytes(cur);
      const name = cur.file.name.replace(/\.pdf$/i, '') + ' (markups).pdf';
      const file = new File([out as BlobPart], name, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: cur.file.name, text: `${cur.file.name}, with markups` });
        return;
      }
      download(name, file);
      window.location.href = `mailto:?subject=${encodeURIComponent(cur.file.name)}&body=${encodeURIComponent(`Attached: ${name}\n`)}`;
      setNotice(`Saved ${name}; attach it to the new email.`);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(`Sharing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Each page's matrix (page space → PDF user space), for XFDF. */
  const pageMatrices = async (cur: OpenFile) => {
    const [{ PDFDocument }, { pageMatrix }] = await Promise.all([import('pdf-lib'), import('@nb/markup/export')]);
    const pdf = await PDFDocument.load(await readFile(cur.file.hash), { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPages().map((p) => pageMatrix(p));
  };

  /** Markups out to, or in from, an XFDF file (Acrobat, Revu and others read and write it). */
  const markupsXfdf = async (dir: 'export' | 'import') => {
    const cur = activeOpen;
    if (!cur) return;
    const { markupsToXfdf, markupsFromXfdf, invertMatrix } = await import('@nb/markup/xfdf');
    try {
      const matrices = await pageMatrices(cur);
      if (dir === 'export') {
        const xml = markupsToXfdf(cur.store.all(), (i) => matrices[i] ?? [1, 0, 0, -1, 0, 0], cur.file.name);
        download(cur.file.name.replace(/\.pdf$/i, '') + '.xfdf', new Blob([xml], { type: 'application/vnd.adobe.xfdf' }));
        return;
      }
      const file = await pickFile('.xfdf,.xml,application/vnd.adobe.xfdf,application/xml,text/xml');
      if (!file) return;
      const found = markupsFromXfdf(await file.text(), (i) => (matrices[i] ? invertMatrix(matrices[i]) : null)).filter((m) => m.pageIndex < cur.doc.pages.length);
      addImported(cur, found, file.name);
    } catch (err) {
      setError(`XFDF ${dir} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** File › Import › Markups from Another PDF: its markups onto the same pages of this one. */
  const importMarkupsFromPdf = async () => {
    const cur = activeOpen;
    if (!cur || !ctl) return;
    const file = await pickFile('application/pdf,.pdf');
    if (!file) return;
    try {
      const { importAnnotations } = await import('@nb/markup');
      const doc = await ctl.engine.open(await unlockBytes(await file.arrayBuffer(), file.name));
      const found: Markup[] = [];
      try {
        for (let i = 0; i < Math.min(doc.pages.length, cur.doc.pages.length); i++) found.push(...importAnnotations(i, await doc.annotations(i)).markups);
      } finally {
        void doc.close();
      }
      addImported(cur, found, file.name);
    } catch (err) {
      setError(`Importing markups failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Page labels as Bluebeam knows the pages: their sheet numbers (page labels), else none. */
  const baxLabels = (cur: OpenFile) => cur.doc.pages.map((_, i) => cur.store.allSheets()[i]?.number || null);

  /** File › Export › Markups as Bluebeam BAX: every markup, for Revu's Markups › Import Markups. */
  const exportMarkupsBax = async () => {
    const cur = activeOpen;
    if (!cur) return;
    try {
      const { exportBax } = await import('@nb/markup/bax');
      // The markups as saving writes them; links stay out, as Revu leaves them out of BAX.
      const xml = await exportBax(await annotatedBytes(cur, { links: false }), { pageLabels: baxLabels(cur) });
      download(`${cur.file.name.replace(/\.pdf$/i, '')}.bax`, new Blob([xml], { type: 'application/xml' }));
      setNotice('Markups exported as a Bluebeam BAX file. In Revu: Markups › Import Markups.');
    } catch (err) {
      setError(`Exporting markups failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * File › Import › Markups from Bluebeam BAX (from Revu's Markups › Export Markups). Markups the
   * document already has, those of the PDF itself or imported before, are updated in place, so a
   * reviewer's file brings in their statuses, replies and column values; the rest are added.
   */
  const importMarkupsBax = async () => {
    const cur = activeOpen;
    if (!cur) return;
    const file = await pickFile('.bax,application/xml,text/xml');
    if (!file) return;
    try {
      const { parseBax, injectBax, baxColumnTag } = await import('@nb/markup/bax');
      const bax = await parseBax(await file.text());
      // The file's markups are added to a copy of the PDF and read by the PDF import, like its own.
      const inj = await injectBax(await readFile(cur.file.hash), bax, baxLabels(cur));
      const store = cur.store;
      const found = await readPdfAnnotations(inj.bytes.slice().buffer, store);
      const mine = found.markups.filter((m) => m.pdfAnnot && inj.added[m.pageIndex]?.includes(m.pdfAnnot.index));
      if (!mine.length) {
        setNotice(`${file.name} has no markups for this document${inj.offPage ? ` (${inj.offPage} are on pages it does not have)` : ''}.`);
        return;
      }
      // Column values by name, onto this document's columns (missing ones added as text columns).
      const set = store.columnSet();
      const columns = [...set.columns];
      const fieldsOf = (custom: Record<string, string> | undefined) => {
        const fields: Record<string, string> = {};
        for (const [tag, value] of Object.entries(custom ?? {})) {
          let col = columns.find((c) => baxColumnTag(c.name) === tag);
          if (!col) columns.push((col = { id: bluebeamColumnId(tag.replace(/_/g, ' ')), name: tag.replace(/_/g, ' '), type: 'text' }));
          // Calculations are worked out here from their formula.
          if (col.type === 'formula') continue;
          const date = /^D:(\d{4})(\d{2})(\d{2})/.exec(value);
          fields[col.id] = col.type === 'checkmark' ? String(value.toLowerCase() === 'true') : col.type === 'date' && date ? `${date[1]}-${date[2]}-${date[3]}` : value;
        }
        return Object.keys(fields).length ? fields : undefined;
      };
      const statusIds = new Set(set.statuses.map((x) => x.id));
      const statuses = [...set.statuses, ...(found.extras.statuses ?? []).filter((x) => !statusIds.has(x.id))];
      // Groups keep together, under ids of their own (another import must not join them).
      const groupIds = new Map<string, string>();
      let added = 0;
      let updated = 0;
      let same = 0;
      store.checkpoint();
      store.batch(() => {
        for (const m of mine) {
          const index = m.pdfAnnot!.index;
          const nm = inj.nms[m.pageIndex]?.[index];
          const fields = fieldsOf(inj.custom[m.pageIndex]?.[index]);
          const { pdfAnnot: _link, seq: _seq, ...rest } = m;
          const content: Markup = {
            ...rest,
            ...(fields ? { fields: { ...m.fields, ...fields } } : {}),
            ...(m.groupId ? { groupId: groupIds.get(m.groupId) ?? groupIds.set(m.groupId, `bax-group-${nm ?? crypto.randomUUID()}`).get(m.groupId)! } : {}),
          };
          // One of the PDF's own markups, or one imported or made here before: updated in place.
          const own = inj.same[m.pageIndex]?.[index];
          const existing =
            (own !== undefined ? store.all().find((x) => x.pageIndex === m.pageIndex && x.pdfAnnot?.index === own && !x.pdfAnnot.space) : undefined) ??
            store.get(m.id) ??
            (nm ? store.get(`bax-${nm}`) : undefined);
          if (existing) {
            const { id: _id, createdAt: _created, ...patch } = content;
            const next = { ...patch, groupId: existing.groupId };
            // A markup the file has as it is here stays untouched (so saving leaves its annotation as it was).
            if (markupDigest({ ...existing, ...next }) === markupDigest(existing)) same++;
            else {
              store.update(existing.id, next);
              updated++;
            }
          } else {
            // New here: its status history is written into the file when it is saved.
            store.add({ ...content, id: m.id.startsWith('pdf-') ? `bax-${nm ?? crypto.randomUUID()}` : m.id, statusHistory: m.statusHistory?.map(({ nm: _nm, ...c }) => c) });
            added++;
          }
        }
      });
      if (columns.length !== set.columns.length || statuses.length !== set.statuses.length) store.setColumnSet({ columns, statuses });
      const parts = [added && `${added} added`, updated && `${updated} updated`, same && `${same} already up to date`].filter(Boolean).join(', ');
      setNotice(`Imported ${file.name}: ${parts}${inj.offPage ? `; ${inj.offPage} on pages this document does not have were left out` : ''}.`);
    } catch (err) {
      setError(`Importing ${file.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Adds imported markups as one undo step: new ids, except where the same markup is already here (updated instead). */
  const addImported = (cur: OpenFile, found: readonly Markup[], from: string) => {
    if (!found.length) {
      setNotice(`${from} has no markups to import.`);
      return;
    }
    const store = cur.store;
    store.checkpoint();
    let updated = 0;
    for (const found1 of found) {
      // Markups from another file stand for none of this file's annotations.
      const { pdfAnnot: _other, ...m } = found1;
      if (store.get(m.id)) {
        store.update(m.id, m);
        updated++;
      } else store.add(m);
    }
    setNotice(`Imported ${found.length} markup${found.length === 1 ? '' : 's'} from ${from}${updated ? ` (${updated} updated in place)` : ''}.`);
  };

  /** File › Publish and Export › Page Images. */
  const runPublish = async (req: PublishRequest) => {
    const cur = activeOpen;
    if (!cur) return;
    const job = startJob(`${req.kind === 'pdf' ? 'Publish' : 'Page images'} · ${cur.file.name}`, { kind: 'publish', cancellable: false });
    const base = cur.file.name.replace(/\.pdf$/i, '');
    try {
      if (req.kind === 'pdf') {
        const p = await import('./documents/process');
        let bytes: Uint8Array = await annotatedBytes(cur);
        if (req.flatten) bytes = (await p.flattenAnnotations(bytes, null)).bytes;
        if (req.reduce) bytes = (await p.reduceFileSize(bytes, (jpeg) => recompressJpeg(jpeg, req.quality))).bytes;
        else if (req.clean) {
          const { PDFDocument } = await import('pdf-lib');
          bytes = await (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).save({ useObjectStreams: true });
        }
        download(`${base} (published).pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      } else {
        const { renderPageImages } = await import('./documents/pageImages');
        const store = cur.store;
        const legends = { all: () => store.all(), scaleFor: (p: number) => store.scaleFor(p), scaleOf: (m: Markup) => store.scaleOf(m) };
        const images = await renderPageImages(cur.doc, req.pages, {
          dpi: req.dpi,
          format: req.format,
          ...(req.markups
            ? {
                drawMarkups: (ctx: OffscreenCanvasRenderingContext2D, pageIndex: number, zoom: number) => {
                  for (const m of store.forPage(pageIndex).sort((a, b) => a.createdAt - b.createdAt)) drawMarkup(ctx as unknown as CanvasRenderingContext2D, m, zoom, store.scaleOf(m), legends);
                },
              }
            : {}),
        });
        const ext = req.format === 'png' ? 'png' : 'jpg';
        const label = (i: number) => {
          const p = req.pages[i]!;
          return (cur.store.allSheets()[p]?.number || `page ${p + 1}`).replace(/[\\/:*?"<>|]+/g, '_');
        };
        if (images.length === 1) download(`${base} ${label(0)}.${ext}`, new Blob([images[0] as BlobPart], { type: `image/${req.format}` }));
        else {
          const { zipFiles } = await import('./documents/zip');
          download(`${base} images.zip`, new Blob([zipFiles(images.map((data, i) => ({ name: `${base} ${label(i)}.${ext}`, data }))) as BlobPart], { type: 'application/zip' }));
        }
      }
      setPublishFor(null);
    } catch (err) {
      setError(`${req.kind === 'pdf' ? 'Publish' : 'Export'} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      job.end();
    }
  };

  const commands = buildCommands(commandActions, {
    hasDocument: !!activeOpen,
    editable: !!activeOpen && !activeReadOnly,
    pagesEditable: !!activeOpen && pageCount > 0 && !busyPages,
    pageCount,
    pageIndex,
    libraryCount: library.length,
    templateCount: library.filter((f) => f.template).length,
    canSaveCopy: (() => {
      const d = studioDocOf(activeOpen?.file.id);
      const snap = d ? snapshots.find((x) => x.meta.id === d.sessionId) : undefined;
      return !snap || snap.isHost || allows(snap.meta, 'saveCopy');
    })(),
    selectionCount: toolsState.selected.size,
    hiddenCount: markups.filter((m) => m.hidden).length,
    selectionLocked: selectedMarkups.some((m) => m.locked),
    selectionGrouped: selectedMarkups.some((m) => m.groupId),
    selectionOffsettable: selectedMarkups.length === 1 && canOffset(selectedMarkups[0]!),
    canPaste: clipboardCount > 0,
    canGoBack,
    canGoForward,
    canUndo: !!activeOpen && activeOpen.store.undoHistory().length > 0,
    split,
    splitHorizontal,
    sync,
    columns: spread.columns,
    cover: spread.cover,
    magnifier,
    fullScreen,
    continuous: activeMode === 'continuous',
    stitched: activeMode === 'stitch',
    canStitch: !!currentStitch,
    showLinks: toolsState.showLinks,
    snap: toolsState.snap,
    showToolbar: showTools,
    showLeft: leftOpen,
    showBottom,
    tool: toolsState.tool,
    settings: prefs,
    openTabCount: (pane === 'b' ? tabsB : tabsA).length,
    leftTab,
    bottomTab,
  });
  const commandMap = new Map(commands.map((c) => [c.id, c]));
  commandsRef.current = commandMap;

  return (
    <div
      className={`app${fullScreen ? ' fullscreen' : ''}`}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        // Text fields keep the browser's own menu (spelling, copy and paste).
        if (target.closest('input, textarea, select, [contenteditable]')) return;
        if (target.closest('.rail')) showMenu(e, panelsMenu());
        else if (target.closest('.toolbar.tools')) showMenu(e, toolbarMenu(e));
        else if (target.closest('.menubar, .toolbar,.statusbar, .doc-tabs, .tabs, .panel.left > h2')) showMenu(e, layoutMenu());
        else if (!target.closest('.modal, .ctx-root, a')) e.preventDefault();
      }}
    >
      <input
        ref={openFileRef}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) void openNewFile(files, split && activePaneRef.current === 'b' ? 'b' : 'a');
          e.target.value = '';
        }}
      />
      <input
        ref={insertFileRef}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !open) return;
          const at = (v?.currentPageIndex ?? pageIndex) + 1;
          void applyPageOps([{ type: 'insert', source: 0, at }], [isImageFile(file) ? await imageToPdf(file) : await file.arrayBuffer()]);
        }}
      />
      <input
        ref={splitFileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          pendingSplit.current = f;
          setSplit(true);
          setActivePane('b');
        }}
      />
      <MenuBar
        commands={commandMap}
        author={author}
        onAuthorChange={persistAuthor}
        recents={library
          .filter((f) => !prefs.recentDays || Date.now() - f.lastOpenedAt < prefs.recentDays * 86_400_000)
          .slice(0, prefs.recentCount)
          .map((f) => ({ id: f.id, name: f.name }))}
        profiles={profileList.map((p) => ({ id: p.id, name: p.name }))}
        activeProfileId={activeProfileId}
        hiddenPanels={ws.hiddenPanels}
        panels={{ showLeft: leftOpen, showBottom, leftTab, bottomTab }}
        stamps={stampLibrary(ws).map((s) => ({ id: s.id, name: s.name }))}
        on={{
          placeStamp: (id) => {
            const s = stampLibrary(ws).find((x) => x.id === id);
            if (s) placeStamp(s);
          },
          openRecent: (id) => {
            const f = library.find((x) => x.id === id);
            if (f) void openFromLibrary(f);
          },
          switchProfile: (id) => profiles.switchTo(id),
          showLeft,
          showBottom: showBottomPanel,
          install: () => {
            if (!canPromptInstall()) return setInstallOpen(true);
            void promptInstall().then((ok) => ok && setNotice('redcolumn is installed. Open it from its icon.'));
          },
        }}
      />
      {activeTools && showTools && (
        <ToolBar
          tools={activeTools}
          state={toolsState}
          styleType={styleType}
          cloudBubble={cloudBubble}
          geometry={selectedShape && activeOpen ? { markup: selectedShape, scale: activeOpen.store.scaleOf(selectedShape), store: activeOpen.store, readOnly: activeReadOnly || !!selectedShape.locked || !activeOpen.store.mayEdit(selectedShape) } : null}
          textType={textType}
          textMarkupStyle={selectedText?.style}
          enabled={!!activeOpen && !activeReadOnly}
          visibleTools={ws.toolbarTools}
          onUndo={() => activeOpen?.store.undo()}
          onRedo={() => activeOpen?.store.redo()}
        />
      )}
      {!split && docTabs('a')}
      <div className="body">
        <nav className={railLabels ? 'rail labelled' : 'rail'} aria-label="Panels">
          <button
            type="button"
            className="rail-toggle"
            title={railLabels ? 'Collapse the panel names' : 'Show the panel names'}
            aria-label={railLabels ? 'Collapse the panel names' : 'Show the panel names'}
            aria-pressed={railLabels}
            onClick={toggleRailLabels}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="1.6" d={railLabels ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
            </svg>
            <span className="rail-label">Collapse</span>
          </button>
          {orderedRail.filter(({ id }) => !ws.hiddenPanels.includes(id)).map(({ id, title, icon, experimental }) => (
            <button
              key={id}
              type="button"
              className={[
                leftOpen && leftTab === id ? 'active' : '',
                railDrag?.id === id ? 'dragging' : '',
                railDrag?.over === id ? (railDrag.after ? 'drop-after' : 'drop-before') : '',
                experimental ? 'experimental' : '',
              ].filter(Boolean).join(' ')}
              title={experimental ? `${title} (Experimental)` : title}
              aria-pressed={leftOpen && leftTab === id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
                setRailDrag({ id, over: null, after: false });
              }}
              onDragOver={(e) => {
                if (!railDrag || railDrag.id === id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (railDrag.over !== id || railDrag.after !== after) setRailDrag({ ...railDrag, over: id, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (railDrag) moveRailPanel(railDrag.id, id, railDrag.after);
                setRailDrag(null);
              }}
              onDragEnd={() => setRailDrag(null)}
              onClick={() => {
                if (leftOpen && leftTab === id) setLeftOpen(false);
                else showLeft(id);
              }}
            >
              {icon}
              <span className="rail-label">{title}</span>
              {experimental && <span className="rail-exp">Exp</span>}
            </button>
          ))}
        </nav>
        {leftOpen && (
          <aside className="panel left" style={{ width: leftWidth }}>
            <h2>
              {LEFT_TITLES[leftTab]}
              <button className="drawer-close" aria-label="Close the panel" title="Close" onClick={() => setLeftOpen(false)}>
                ×
              </button>
            </h2>
            {leftTab === 'search' ? (
              <SearchPanel
                key={activeOpen ? `${activeOpen.file.id}:${activeOpen.file.hash}` : 'none'}
                focusToken={searchFocus}
                sheets={sheets}
                loadText={async (report) => {
                  const cur = paneB ? openBRef.current : openRef.current;
                  if (!cur) return [];
                  return loadPageTexts(() => readFile(cur.file.hash), cur.store, (p) => report(p.done, p.total));
                }}
                extraHits={(query, wholeWord) => {
                  const cur = activeOpen;
                  if (!cur) return [];
                  const esc = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc, 'iu');
                  const hit = (pageIndex: number, rect: { x: number; y: number; w: number; h: number }, label: string, text: string) => {
                    const m = re.exec(text);
                    if (!m) return [];
                    const snippet = `${label}: ${text.replace(/\s+/g, ' ')}`.slice(0, 120);
                    const at = snippet.toLowerCase().indexOf(m[0].toLowerCase(), label.length + 2);
                    return [{ pageIndex, rects: [rect], snippet, matchStart: Math.max(0, at), matchEnd: Math.max(0, at) + m[0].length }];
                  };
                  const fields = (formModels[cur.file.hash]?.fields ?? []).flatMap((f) => (f.value && f.widgets[0] ? hit(f.widgets[0].pageIndex, f.widgets[0].rect, f.name, f.value) : []));
                  const marks = cur.store.all().flatMap((m) => {
                    const text = [m.text, m.comment, ...(m.replies ?? []).map((r) => r.text)].filter(Boolean).join(' · ');
                    return text ? hit(m.pageIndex, boundsOf(m.points), m.subject || MARKUP_LABELS[m.type], text) : [];
                  });
                  return [...fields, ...marks];
                }}
                onRedactAll={
                  activeOpen && !activeReadOnly
                    ? (hits) => {
                        const store = activeOpen.store;
                        const now = Date.now();
                        const style = { ...(activeTools?.getState().styles.redaction ?? DEFAULT_STYLES.redaction) };
                        store.checkpoint();
                        for (const h of hits)
                          for (const r of h.rects)
                            store.add({ id: crypto.randomUUID(), type: 'redaction', pageIndex: h.pageIndex, points: [[r.x - 1, r.y - 1], [r.x + r.w + 1, r.y + r.h + 1]], style, subject: 'Search redaction', status: 'none', author: authorRef.current, createdAt: now, modifiedAt: now });
                        setNotice(`Marked ${hits.length} match${hits.length === 1 ? '' : 'es'} for redaction. Tools › Redaction › Apply Redactions removes them.`);
                      }
                    : undefined
                }
                onResults={(hits) => {
                  searchHits.current = hits;
                  activeTools?.setHighlights(hits);
                }}
                onOpen={openSearchHit}
              />
            ) : leftTab === 'pages' ? (
              <PagesPanel
                doc={activeOpen?.doc ?? null}
                currentPage={pageIndex}
                sheets={sheets}
                scales={scales}
                busy={busyPages || indexing}
                onGoTo={(i) => v?.goToPage(i)}
                onPageOps={(ops, inserts) => void applyPageOps(ops, inserts)}
                onExtract={(pages) => void extractPages(pages)}
                onSetScale={(pages, scale) => activeOpen?.store.setScale(pages, scale)}
                onSetLabel={(pages, label) => {
                  for (const i of pages) activeOpen?.store.editSheet(i, { number: label });
                }}
              />
            ) : leftTab === 'forms' ? (
              <FormsPanel
                model={activeOpen ? (formModels[activeOpen.file.hash] ?? null) : null}
                editable={!!activeOpen && !studioDocOf(activeOpen.file.id) && !formBusy}
                selected={selectedField}
                onSelect={setSelectedField}
                newType={newFieldType}
                onNewType={setNewFieldType}
                drawing={toolsState.tool === 'formField'}
                onDraw={() => activeTools?.setTool(toolsState.tool === 'formField' ? 'select' : 'formField')}
                onGo={goToField}
                onFill={(name, value) => activeOpen && void fillFields(activeOpen.file.id, { [name]: value })}
                onUpdate={async (name, changes: FieldChanges) => {
                  if (!activeOpen) return;
                  await editForm(activeOpen.file.id, 'Changing the field', async (bytes) => (await import('./documents/forms')).updateField(bytes, name, changes));
                  if (changes.name) setSelectedField(changes.name);
                }}
                onDelete={(name) => {
                  if (!activeOpen || !confirm(`Delete the field "${name}"?`)) return;
                  void editForm(activeOpen.file.id, 'Deleting the field', async (bytes) => (await import('./documents/forms')).removeFields(bytes, [name]));
                  setSelectedField(null);
                }}
                onReorder={(names) => activeOpen && void editForm(activeOpen.file.id, 'Changing the tab order', async (bytes) => (await import('./documents/forms')).setTabOrder(bytes, names))}
                onReset={() => {
                  if (!activeOpen || !confirm('Clear every field of this form?')) return;
                  void editForm(activeOpen.file.id, 'Resetting the form', async (bytes) => (await import('./documents/forms')).resetForm(bytes));
                }}
                onExport={(format) => {
                  const model = activeOpen && formModels[activeOpen.file.hash];
                  if (!model) return;
                  void import('./documents/forms').then(({ toCsv, toXfdf }) => {
                    const base = activeOpen.file.name.replace(/\.pdf$/i, '');
                    if (format === 'xfdf') download(`${base}.xfdf`, new Blob([toXfdf(model.fields, activeOpen.file.name)], { type: 'application/vnd.adobe.xfdf' }));
                    else download(`${base} form data.csv`, new Blob(['\uFEFF' + toCsv(model.fields)], { type: 'text/csv' }));
                  });
                }}
                onImport={(file) => {
                  const model = activeOpen && formModels[activeOpen.file.hash];
                  if (!model) return;
                  void (async () => {
                    const { fromCsv, fromXfdf } = await import('./documents/forms');
                    const text = await file.text();
                    let data: Record<string, string>;
                    try {
                      data = /\.csv$/i.test(file.name) ? fromCsv(text) : /\.json$/i.test(file.name) ? Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.join('\n') : String(v ?? '')])) : fromXfdf(text);
                    } catch {
                      setError(`${file.name} could not be read as form data.`);
                      return;
                    }
                    const known = new Set(model.fields.filter((f) => f.type !== 'button' && f.type !== 'signature').map((f) => f.name));
                    const values = Object.fromEntries(Object.entries(data).filter(([k]) => known.has(k)));
                    const n = Object.keys(values).length;
                    if (!n) {
                      setNotice(`None of the fields in ${file.name} are in this form.`);
                      return;
                    }
                    await fillFields(activeOpen.file.id, values);
                    setNotice(`Filled in ${n} field${n === 1 ? '' : 's'} from ${file.name}.`);
                  })();
                }}
              />
            ) : leftTab === 'sets' ? (
              <SetsPanel
                library={library}
                current={activeOpen && !studioDocOf(activeOpen.file.id) ? { fileId: activeOpen.file.id, page: pageIndex } : null}
                indexing={indexingSets}
                onIndex={(ids) => void indexSetFiles(ids)}
                onOpenSheet={(fileId, page) => void openSetSheet(fileId, page)}
              />
            ) : leftTab === 'properties' ? (
              <PropertiesPanel
                markups={markups}
                selected={toolsState.selected}
                store={activeOpen?.store ?? null}
                scales={scales}
                tools={activeTools ?? null}
                toolsState={toolsState}
                readOnly={!activeOpen || activeReadOnly}
                cellContext={cellContext}
              />
            ) : leftTab === 'bookmarks' ? (
              <BookmarksPanel
                bookmarks={bookmarks}
                places={places}
                pageCount={pageCount}
                currentPage={pageIndex}
                pageLabel={(i) => pageLabelFor(activeOpen, i)}
                editable={!!activeOpen && !activeReadOnly}
                onBookmarks={(tree) => activeOpen?.store.setBookmarks(tree)}
                onPlaces={(list) => activeOpen?.store.setPlaces(list)}
                onGo={(t) => ('action' in t && t.action ? followAction(t.action as LinkAction) : goToTarget(t))}
                onEditAction={(id) => setBookmarkAction(id)}
                currentView={() => (v ? visibleView(v, paneB ? canvasBRef.current : canvasRef.current) : { pageIndex, rect: null })}
              />
            ) : leftTab === 'layers' ? (
              <LayersPanel
                pdfLayers={activeOpen ? (pdfLayers[activeOpen.file.hash] ?? []) : []}
                hiddenPdf={new Set(activeOpen ? (hiddenPdfLayers[activeOpen.file.id] ?? []) : [])}
                onPdfLayer={(id, show) => {
                  const cur = activeOpen;
                  if (!cur) return;
                  const was = hiddenPdfLayers[cur.file.id] ?? [];
                  const next = show ? was.filter((x) => x !== id) : [...was, id];
                  setHiddenPdfLayers((all) => ({ ...all, [cur.file.id]: next }));
                  void showPdfLayers(cur, new Set(next)).catch((err) => setError(`Showing layers failed: ${err instanceof Error ? err.message : String(err)}`));
                }}
                markupLayers={(() => {
                  const counts = new Map<string, number>();
                  for (const m of markups) counts.set(m.layer ?? '', (counts.get(m.layer ?? '') ?? 0) + 1);
                  // Markups on no layer are listed only once some markup is on a layer.
                  if (counts.size === 1 && counts.has('')) return [];
                  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => (a.name === '' ? 1 : b.name === '' ? -1 : a.name.localeCompare(b.name)));
                })()}
                hiddenMarkup={new Set(activeOpen ? (hiddenMarkupLayers[activeOpen.file.id] ?? []) : [])}
                onMarkupLayer={(name, show) => {
                  const id = activeOpen?.file.id;
                  if (!id) return;
                  setHiddenMarkupLayers((all) => ({ ...all, [id]: show ? (all[id] ?? []).filter((x) => x !== name) : [...(all[id] ?? []), name] }));
                }}
                showLinks={toolsState.showLinks}
                onShowLinks={(show) => activeTools?.setShowLinks(show)}
              />
            ) : leftTab === 'toolchest' ? (
              <ToolChestPanel
                tool={toolsState.tool}
                presetId={toolsState.preset?.id ?? null}
                enabled={!!activeOpen && !activeReadOnly}
                onUse={useToolItem}
                onSetTool={(t) => activeTools?.setTool(t)}
                onAddSelected={
                  toolsState.selected.size
                    ? (setId) => {
                        for (const item of toolChestItemsOf(markups.filter((x) => toolsState.selected.has(x.id)), activeOpen?.store)) {
                          addToToolSet(setId, item);
                        }
                      }
                    : null
                }
              />
            ) : leftTab === 'measurements' ? (
              <MeasurementsPanel
                markups={markups}
                scales={scales}
                selected={toolsState.selected}
                onSelect={selectFromList}
                scaleOf={scaleOf}
                viewports={viewports.filter((x) => x.pageIndex === pageIndex)}
                onViewports={
                  activeOpen && !activeReadOnly
                    ? {
                        add: () => activeTools?.setTool('viewport'),
                        calibrate: () => activeTools?.setTool('calibrate'),
                        update: (x) => activeOpen.store.setViewport(x),
                        remove: (id) => activeOpen.store.removeViewport(id),
                      }
                    : null
                }
                pageIndex={pageIndex}
                onScale={activeOpen && !activeReadOnly ? (scale) => activeOpen.store.setScale([pageIndex], scale) : null}
              />
            ) : leftTab === 'spaces' ? (
              <SpacesPanel
                markups={markups}
                selected={toolsState.selected}
                pageLabel={(i) => pageLabelFor(activeOpen, i)}
                scaleOf={scaleOf}
                editable={!!activeOpen && !activeReadOnly}
                showSpaces={prefs.showSpaces}
                onShowSpaces={(showSpaces) => settings.set({ showSpaces })}
                onSelect={(m) => {
                  selectFromList(m);
                }}
                onAdd={() => activeTools?.setTool('space')}
                onRename={(id, name) => {
                  activeOpen?.store.checkpoint();
                  activeOpen?.store.update(id, { subject: name });
                }}
                onDelete={(id) => {
                  activeOpen?.store.checkpoint();
                  activeOpen?.store.remove([id]);
                }}
              />
            ) : leftTab === 'flags' ? (
              <FlagsPanel markups={markups} statuses={columnSet.statuses} selected={toolsState.selected} onSelect={selectFromList} onAdd={activeOpen && !activeReadOnly ? () => activeTools?.setTool('flag') : null} />
            ) : leftTab === 'projects' ? (
              <ProjectsPanel
                me={author}
                oneDriveAvailable={oneDriveConfigured}
                invite={projectInvite}
                onDismissInvite={() => setProjectInvite(null)}
                localDocName={activeOpen && !activeStudioDoc ? activeOpen.file.name : null}
                onOpenFile={openProjectFile}
                onAddFiles={async (project, folderId, files, onProgress) => {
                  onProgress({ done: 0, total: files.length, name: 'Reading files' });
                  return addToProject(project, folderId, await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await unlockBytes(await f.arrayBuffer(), f.name) }))), onProgress);
                }}
                onCheckIn={checkInProjectFile}
                onSendQueued={() => void sendQueuedProjectChanges().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
                onAddCurrent={async (project, folderId, onProgress) => {
                  const cur = activeOpen;
                  if (!cur) return;
                  onProgress({ done: 0, total: 1, name: cur.file.name });
                  const bytes = await annotatedBytes(cur);
                  await addToProject(project, folderId, [{ name: cur.file.name, bytes: bytes.slice().buffer, libraryId: cur.file.id }], onProgress);
                }}
              />
            ) : leftTab === 'sessions' ? (
              <SessionsPanel
                joined={sessions.map((session, i) => ({ session, snapshot: snapshots[i]! }))}
                focusedId={focusedSession}
                onFocus={setFocusedSession}
                me={author}
                busy={studioBusy}
                error={studioError}
                activeDoc={activeStudioDoc}
                openDocs={new Set([...tabsA, ...tabsB].map((t) => studioDocOf(t.file.id)).filter((d) => !!d).map((d) => `${d!.sessionId}:${d!.docId}`))}
                localDocName={activeOpen && !activeStudioDoc ? activeOpen.file.name : null}
                openFiles={[...tabsA, ...tabsB].filter((t) => !studioDocOf(t.file.id)).map((t) => ({ id: t.file.id, name: t.file.name }))}
                library={library.map((f) => ({ id: f.id, name: f.name }))}
                driveAvailable={googleConfigured}
                oneDriveAvailable={oneDriveConfigured}
                invite={studioInvite}
                onDismissInvite={() => setStudioInvite(null)}
                onStart={startStudio}
                startRequest={startSession}
                onJoin={(ref) => joinStudio(ref)}
                onLeave={leaveStudio}
                onAddCurrent={(id) => void addOpenToStudio(id)}
                onAddFiles={(id, files) => void runStudio(() => addToStudio(id, files.map((file) => ({ kind: 'upload', file, name: file.name }))))}
                onOpenDocument={(id, docId) => void openSessionDocument(id, docId)}
                onGoTo={(id, docId, page) => void goToStudioPage(id, docId, page)}
                onRun={(job) => void runStudio(job)}
                onReport={(id, format) => {
                  const snap = snapshots.find((x) => x.meta.id === id);
                  if (!snap) return;
                  if (format === 'pdf') {
                    void runStudio(() => sessionReport(id));
                    return;
                  }
                  const csv = recordToCsv(snap.meta, snap.record);
                  download(`${snap.meta.name} session record.csv`, new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
                }}
                onInviteEmail={(id) => setInviteSession(id)}
                onUpdateDocument={(id, docId, file) =>
                  void runStudio(async () => {
                    const session = sessionById(id);
                    if (!session) return;
                    await session.updateDocument(docId, await unlockBytes(await file.arrayBuffer(), file.name));
                  })
                }
                onEnd={(id) => {
                  const session = sessionById(id);
                  if (!session) return;
                  void (async () => {
                    const authors = new Set<string>();
                    for (const d of session.meta.documents) await withSessionMarkups(session, d.id, (store) => store.all().forEach((m) => m.author && authors.add(m.author)));
                    setStudioError(null);
                    setEndFor({ sessionId: id, authors: [...authors].sort() });
                  })().catch((err) => setStudioError(err instanceof Error ? err.message : String(err)));
                }}
              />
            ) : leftTab === 'signatures' ? (
              <div className="signatures-wrap">
              <DigitalSignaturesSection
                checks={activeOpen ? (sigChecks[activeOpen.file.hash] ?? null) : []}
                trusted={trustedCerts}
                canSign={!!activeOpen && !studioDocOf(activeOpen.file.id) && !formBusy}
                onSign={() => setSignFor({ fieldName: null })}
                onManageIds={() => setIdsOpen(true)}
                onGo={(name) => {
                  const f = activeOpen && formModels[activeOpen.file.hash]?.fields.find((x) => x.name === name);
                  if (f && f.widgets[0] && f.widgets[0].rect.w > 0) goToField(f);
                }}
                onTrust={(fp) => {
                  digitalIds.trust(fp);
                  setTrustedCerts(digitalIds.trusted());
                }}
                onCheckRevocation={async (c) => {
                  const { buildChain, checkRevocation } = await import('./documents/pki');
                  if (!c.certificates.length) throw new Error('The signature carries no certificate');
                  const chain = await buildChain(c.certificates[0]!, c.certificates);
                  const r = await checkRevocation(chain, pkiFetch);
                  const when = r.at ? ` (as of ${r.at.toLocaleString()})` : '';
                  const trust = r.verified ? '' : ' The answer’s signature could not be checked.';
                  return r.status === 'good'
                    ? `Not revoked, says the certificate authority’s ${r.via}${when}.${trust}`
                    : r.status === 'revoked'
                      ? `Revoked${r.revokedAt ? ` on ${r.revokedAt.toLocaleString()}` : ''} (${r.via}).${c.signedAt && r.revokedAt && c.signedAt < r.revokedAt ? ' It was signed before that.' : ''}${trust}`
                      : `The ${r.via} responder does not know this certificate.`;
                }}
                onOpenSignedVersion={(c) => {
                  if (!activeOpen) return;
                  void (async () => {
                    const bytes = new Uint8Array(await readFile(activeOpen.file.hash)).slice(0, c.signedLength);
                    await openCreated(`${activeOpen.file.name.replace(/\.pdf$/i, '')} (as signed by ${c.signer}).pdf`, bytes.buffer);
                  })();
                }}
              />
              <SignaturesPanel
                author={author}
                placed={markups.filter((m) => m.type === 'signature').sort((a, b) => (a.signature?.signedAt ?? a.createdAt) - (b.signature?.signedAt ?? b.createdAt))}
                canSign={!!activeOpen && !activeReadOnly}
                currentDigest={docDigest}
                selected={toolsState.selected}
                onPlace={(sig, reason) => void placeSignature(sig, reason)}
                onSelect={(m) => selectFromList(m)}
              />
              </div>
            ) : (
              <Library
                files={library}
                activeHash={activeOpen?.file.hash ?? null}
                onOpen={(f) => void openFromLibrary(f)}
                fileMenu={(f, groupEntries) => {
                  const base = libraryMenu(f);
                  // File Access groups go after the open and session actions.
                  const at = base.findIndex((x) => 'sep' in x);
                  return at < 0 ? [...base, SEP, ...groupEntries] : [...base.slice(0, at), SEP, ...groupEntries, ...base.slice(at)];
                }}
                reveal={revealFile}
                onRemove={(f) => void removeFile(f).then(refreshLibrary)}
              />
            )}
            <div className="panel-split" role="separator" aria-orientation="vertical" aria-label="Resize side panel" onPointerDown={onLeftResize} />
          </aside>
        )}
        <div className="workspace">
          <div className={`panes${split ? ' split' : ''}${split && splitHorizontal ? ' horizontal' : ''}`}>
            <div
              className={`pane${activePane === 'a' ? ' active' : ''}`}
              style={split ? { flex: splitRatio } : undefined}
              onPointerDown={() => setActivePane('a')}
            >
              {split && docTabs('a')}
              <main
                className={`stage${dragOver && activePane === 'a' ? ' drag' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.types.includes(TOOL_DRAG_TYPE)) {
                    e.dataTransfer.dropEffect = 'copy';
                    return;
                  }
                  setDragOver(true);
                  setActivePane('a');
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  if (dropTool(e, 'a')) return;
                  e.preventDefault();
                  setDragOver(false);
                  void droppedPdfs(e.dataTransfer).then((files) => {
                    if (files.length) void openNewFile(files, 'a');
                  });
                }}
              >
                <canvas ref={canvasRef} />
                {toolsStateA.sketch && open && ctl && (
                  <SketchBar
                    sketch={toolsStateA.sketch}
                    scale={open.store.scaleAt(toolsStateA.sketch.pageIndex, toolsStateA.sketch.from)}
                    onSegment={(len, angle) => ctl.tools.sketchSegment(len, angle)}
                    onBox={(w, h) => ctl.tools.sketchBox(w, h)}
                    onCircle={(r) => ctl.tools.sketchCircle(r)}
                    onCancel={() => (toolsStateA.sketch?.mode === 'box' ? ctl.tools.cancelSketch() : ctl.tools.cancel())}
                    onFinish={() => ctl.tools.finish()}
                  />
                )}
                {!open && (
                  <div className="hint">
                    <span>Drop a PDF here or choose File → Open</span>
                    <button className={`btn${launchOpen ? ' primary' : ''}`} autoFocus={launchOpen} onClick={() => openFromDisk()}>
                      Open a PDF…
                    </button>
                  </div>
                )}
                {open?.store.readOnly && <div className="readonly-banner">{readOnlyReason(open, snapshots)}</div>}
                {notice && (
                  <div className="notice" onClick={() => setNotice(null)}>
                    {notice}
                  </div>
                )}
                {error && !paneB && (
                  <div className="error" onClick={() => setError(null)}>
                    {error}
                  </div>
                )}
                {import.meta.env.DEV && ctl && open && <TileDiagnostics viewer={ctl.viewer} />}
              </main>
              {pageNav('a')}
            </div>
            {split && (
              <>
                <div
                  className={splitHorizontal ? 'split-h' : 'split-v'}
                  role="separator"
                  aria-orientation={splitHorizontal ? 'horizontal' : 'vertical'}
                  aria-label="Resize split"
                  onPointerDown={onSplitResize}
                />
                <div
                  className={`pane${activePane === 'b' ? ' active' : ''}`}
                  style={{ flex: 1 - splitRatio }}
                  onPointerDown={() => setActivePane('b')}
                >
                  {docTabs('b')}
                  <main
                    className={`stage${dragOver && activePane === 'b' ? ' drag' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.types.includes(TOOL_DRAG_TYPE)) {
                        e.dataTransfer.dropEffect = 'copy';
                        return;
                      }
                      setDragOver(true);
                      setActivePane('b');
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      if (dropTool(e, 'b')) return;
                      e.preventDefault();
                      setDragOver(false);
                      void droppedPdfs(e.dataTransfer).then((files) => {
                        if (files.length) void openNewFile(files, 'b');
                      });
                    }}
                  >
                    <canvas ref={canvasBRef} />
                    {!openB && <div className="hint">Drop a PDF here or File → Open Recent</div>}
                    {openB?.store.readOnly && <div className="readonly-banner">{readOnlyReason(openB, snapshots)}</div>}
                  </main>
                  {pageNav('b')}
                </div>
              </>
            )}
          </div>
          {labelMode?.kind === 'scale' && labelPaneParts?.o && (
            <ScaleRegionsPanel
              key={labelPaneParts.o.file.id}
              regions={labelMode.regions}
              drawing={(labelMode.pane === 'b' ? toolsStateB : toolsStateA).tool === 'labelRegion'}
              pageCount={labelPaneParts.o.doc.pages.length}
              currentPage={(labelMode.pane === 'b' ? statsB : stats)?.pageIndex ?? 0}
              texts={labelTexts}
              readOnly={labelPaneParts.o.store.readOnly}
              onDraw={() => labelPaneParts.c?.tools.setTool('labelRegion')}
              onChange={(regions) => setLabelMode({ ...labelMode, regions })}
              onClose={() => setLabelMode(null)}
              onApply={(scales) => {
                const store = labelPaneParts.o!.store;
                let done = 0;
                for (const { page, scale } of scales) {
                  if (!scale) continue;
                  store.setScale([page], scale);
                  done++;
                }
                const missed = scales.length - done;
                setNotice(`Set the scale on ${done} page${done === 1 ? '' : 's'}${missed ? `; ${missed} had no readable scale in the boxes and were left as they were` : ''}.`);
                setLabelMode(null);
              }}
            />
          )}
          {labelMode?.kind === 'label' && labelPaneParts?.o && (
            <LabelRegionsPanel
              key={labelPaneParts.o.file.id}
              regions={labelMode.regions}
              drawing={(labelMode.pane === 'b' ? toolsStateB : toolsStateA).tool === 'labelRegion'}
              pageCount={labelPaneParts.o.doc.pages.length}
              currentPage={(labelMode.pane === 'b' ? statsB : stats)?.pageIndex ?? 0}
              texts={labelTexts}
              readOnly={labelPaneParts.o.store.readOnly}
              onDraw={() => labelPaneParts.c?.tools.setTool('labelRegion')}
              onChange={(regions) => setLabelMode({ ...labelMode, regions })}
              onClose={() => setLabelMode(null)}
              onApply={(labels, target) => {
                const store = labelPaneParts.o!.store;
                let done = 0;
                store.checkpoint();
                for (const { page, label } of labels) {
                  if (!label) continue;
                  store.editSheet(page, target === 'number' ? { number: label } : { title: label });
                  done++;
                }
                const missed = labels.length - done;
                setNotice(`Labelled ${done} page${done === 1 ? '' : 's'}${missed ? `; ${missed} had no text in the boxes and were left as they were` : ''}.`);
                setLabelMode(null);
              }}
            />
          )}
          {showBottom && (
            <aside className="bottom-dock" style={{ height: dockHeight }}>
              <div className="dock-split" role="separator" aria-orientation="horizontal" aria-label="Resize markups panel" onPointerDown={onDockSplit} />
              <div className="tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={bottomTab === 'markups'}
                  className={bottomTab === 'markups' ? 'active' : ''}
                  onClick={() => setBottomTab('markups')}
                >
                  Markups
                </button>
                <button
                  role="tab"
                  aria-selected={bottomTab === 'links'}
                  className={bottomTab === 'links' ? 'active' : ''}
                  onClick={() => setBottomTab('links')}
                >
                  Links{links.some((l) => l.status === 'review') ? ' •' : ''}
                </button>
                <button className="drawer-close" aria-label="Close the Markups list" title="Close" onClick={() => setShowBottom(false)}>
                  ×
                </button>
              </div>
              <div className="dock-body">
                {bottomTab === 'links' ? (
                  <LinksPanel
                    links={links}
                    sheets={sheets}
                    currentPage={pageIndex}
                    showLinks={toolsState.showLinks}
                    busy={indexing}
                    onShowLinks={(show) => activeTools?.setShowLinks(show)}
                    onReveal={(l) => navigate(l.pageIndex, l.rect)}
                    onFollow={(l) => navigate(l.targetPage, l.targetRect)}
                    onStatus={(id, status) => activeOpen?.store.setLinkStatus(id, status)}
                    onRedetect={() => void redetectLinks()}
                  />
                ) : (
                  <MarkupList
                    markups={markups}
                    store={activeOpen?.store ?? null}
                    scaleOf={scaleOf}
                    sheets={sheets}
                    columnSet={columnSet}
                    readOnly={!activeOpen || activeReadOnly}
                    selected={toolsState.selected}
                    onSelect={selectFromList}
                    onRowMenu={onListRowMenu}
                    onManageColumns={onManageColumns}
                    onExport={onExportList}
                    onSync={() => setSyncOpen(true)}
                    syncing={!!sheetSync.link}
                    onFiltered={setListKept}
                    allHidden={allMarkupsHidden}
                    onToggleAllHidden={toggleAllMarkupsHidden}
                  />
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
      <StatusBar
        viewer={v ?? null}
        rotation={(paneB ? statsB : stats)?.rotation ?? 0}
        scaleFor={(pageIndex) => activeOpen?.store.scaleFor(pageIndex) ?? null}
        snapContent={toolsState.snap}
        onSnapContent={(on) => activeTools?.setSnap(on)}
        disabled={!activeOpen}
        {...(split ? { sync, onSync: setSync } : {})}
      />
      {redactFor && (
        <ApplyRedactionsDialog
          count={redactFor.count}
          onCancel={() => setRedactFor(null)}
          onApply={(options) => {
            const { pane } = redactFor;
            setRedactFor(null);
            const cur = paneParts(pane).o;
            if (!cur) return;
            const marks = cur.store.all().filter((m) => m.type === 'redaction');
            void runRedact(cur, pane === 'b', 'redact', marks.map((m) => ({ pageIndex: m.pageIndex, rect: boundsOf(m.points) })), options).catch((err) => setError(`Redaction failed: ${err instanceof Error ? err.message : String(err)}`));
          }}
        />
      )}
      {cameraOpen && (
        <CameraDialog
          onCancel={() => setCameraOpen(false)}
          onDone={(pages) => {
            setCameraOpen(false);
            void (async () => {
              const { PDFDocument } = await import('pdf-lib');
              const pdf = await PDFDocument.create();
              for (const p of pages) {
                // Letter width; the height follows the page's shape.
                const img = await pdf.embedJpg(p.jpeg);
                const w = 612;
                const h = (w * p.height) / p.width;
                pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
              }
              const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
              await openCreated(`Scan ${stamp}.pdf`, (await pdf.save()).slice().buffer);
              setNotice(`Created a ${pages.length}-page PDF from the camera. Document › OCR makes its text searchable.`);
            })().catch((err) => setError(`Creating the PDF failed: ${err instanceof Error ? err.message : String(err)}`));
          }}
        />
      )}
      {publishFor && activeOpen && (
        <PublishDialog mode={publishFor} pageCount={activeOpen.doc.pages.length} currentPage={pageIndex} busy={publishing} onRun={(req) => void runPublish(req)} onClose={() => setPublishFor(null)} />
      )}
      {whatsNewOpen && <WhatsNewDialog onClose={() => setWhatsNewOpen(false)} />}
      {spellOpen && activeOpen && (
        <SpellCheckDialog
          store={activeOpen.store}
          markups={markups}
          doc={activeOpen.doc}
          readOnly={activeReadOnly}
          onShowMarkup={(m) => {
            activeTools?.select([m.id]);
            v?.zoomToRect(boundsOf(m.points), 2.5, m.pageIndex);
          }}
          onShowText={(pageIndex, rect) => {
            v?.goToPage(pageIndex);
            v?.zoomToRect(rect, 6, pageIndex);
          }}
          onClose={() => setSpellOpen(false)}
        />
      )}
      {undoHistoryOpen && activeOpen && <UndoHistoryDialog store={activeOpen.store} onClose={() => setUndoHistoryOpen(false)} />}
      {soundOpen && (
        <SoundDialog
          onCancel={() => setSoundOpen(false)}
          onDone={(file) => {
            setSoundOpen(false);
            void fileToAttachment(file).then((attachment) => {
              activeTools?.setTool('attachment', { attachment, subject: 'Sound', once: true });
              setNotice('Click where the sound note goes.');
            });
          }}
        />
      )}
      {blankPdf && (
        <NewPdfDialog
          mode={blankPdf}
          current={
            blankPdf === 'blank' && activeOpen && v
              ? { index: v.currentPageIndex, count: activeOpen.doc.pages.length, ...activeOpen.doc.pages[v.currentPageIndex]! }
              : undefined
          }
          onCancel={() => setBlankPdf(null)}
          onApply={(req) => {
            const mode = blankPdf;
            setBlankPdf(null);
            if (mode === 'blank') void applyPageOps([{ type: 'blank', at: req.at, count: req.count, width: req.width, height: req.height }]);
            else if (ctl)
              void ctl.engine
                .createPdf(Array.from({ length: req.count }, () => ({ width: req.width, height: req.height })))
                .then((bytes) => openCreated('Untitled.pdf', bytes))
                .catch((err) => setError(`Creating the PDF failed: ${err instanceof Error ? err.message : String(err)}`));
          }}
        />
      )}
      {combineOpen && (
        <CombineDialog
          open={[...tabsA, ...tabsB].filter((t, i, all) => all.findIndex((x) => x.file.id === t.file.id) === i).map((t) => ({ id: t.file.id, name: t.file.name }))}
          onCancel={() => setCombineOpen(false)}
          onCombine={(sources, name) => void combineDocuments(sources, name)}
        />
      )}
      {docPropsOpen && activeOpen && (
        <DocumentPropertiesDialog
          fileName={activeOpen.file.name}
          doc={activeOpen.doc}
          bytes={activeOpen.file.size}
          readOnlyReason={studioDocOf(activeOpen.file.id) ? 'This is a Live Session document shared with others, so its properties cannot be changed here.' : null}
          onClose={() => setDocPropsOpen(false)}
          onSave={(info: EditableInfo) => {
            const cur = activeOpen;
            setDocPropsOpen(false);
            void readFile(cur.file.hash)
              .then((bytes) => setDocumentInfo(bytes, info))
              .then((bytes) => swapDocument(cur, paneB, bytes))
              .catch((err) => setError(`Saving document properties failed: ${err instanceof Error ? err.message : String(err)}`));
          }}
        />
      )}
      {multiplyFor &&
        (() => {
          const { c, o } = paneParts(multiplyFor);
          const first = o && c ? o.store.get([...c.tools.getState().selected][0] ?? '') : undefined;
          if (!c || !o || !first) return null;
          return (
            <MultiplyDialog
              scale={o.store.scaleFor(first.pageIndex)}
              onCancel={() => setMultiplyFor(null)}
              onApply={(rows, columns, gapX, gapY) => {
                c.tools.multiply(rows, columns, gapX, gapY);
                setMultiplyFor(null);
              }}
            />
          );
        })()}
      {changeColoursFor &&
        (() => {
          const store = paneParts(changeColoursFor.pane).o?.store;
          const ms = store ? changeColoursFor.ids.map((id) => store.get(id)).filter((m): m is Markup => !!m && !m.locked && store.mayEdit(m)) : [];
          if (!store || !ms.length) return null;
          return (
            <ChangeColoursDialog
              colours={markupColours(ms)}
              onCancel={() => setChangeColoursFor(null)}
              onApply={(map) => {
                store.checkpoint();
                store.batch(() =>
                  ms.forEach((m) => {
                    const style = recolouredStyle(m.style, map);
                    if (style) store.update(m.id, { style });
                  }),
                );
                setChangeColoursFor(null);
              }}
            />
          );
        })()}
      {captureView && (
        <div className="modal-backdrop" onMouseDown={() => setCaptureView(null)}>
          <div className="modal capture-view" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setCaptureView(null)}>
            <h3>Capture</h3>
            <img src={captureView} alt="The markup as captured" />
            <div className="actions">
              <button type="button" className="btn primary" autoFocus onClick={() => setCaptureView(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {replyTo &&
        (() => {
          const store = paneParts(replyTo.pane).o?.store;
          const m = store?.get(replyTo.id);
          if (!store || !m) return null;
          return (
            <CommentDialog
              title={`Reply to ${m.subject || MARKUP_LABELS[m.type]}`}
              initial=""
              onClose={() => setReplyTo(null)}
              onSave={(text) => {
                if (text.trim()) store.update(m.id, { replies: [...(m.replies ?? []), { id: crypto.randomUUID(), author: authorRef.current, text: text.trim(), createdAt: Date.now() }] });
                setReplyTo(null);
              }}
            />
          );
        })()}
      {headerFooter && activeOpen && (
        <HeaderFooterDialog
          mode={headerFooter.mode}
          pageCount={activeOpen.doc.pages.length}
          currentPage={pageIndex}
          hasExisting={headerFooter.hasExisting}
          onCancel={() => setHeaderFooter(null)}
          onApply={async (spec, pages) => {
            const cur = activeOpen;
            if (studioDocOf(cur.file.id)) throw new Error('A Live Session document is shared with others, so its pages cannot be changed here.');
            const { addHeaderFooter } = await import('./documents/headerFooter');
            const date = new Date().toLocaleDateString();
            const bytes = await addHeaderFooter(await readFile(cur.file.hash), pages, spec, (i) => ({ label: cur.store.allSheets()[i]?.number || String(i + 1), file: cur.file.name, date }));
            await swapDocument(cur, paneB, bytes.slice().buffer);
            setHeaderFooter(null);
          }}
          onRemove={async () => {
            const cur = activeOpen;
            const { removeHeaderFooter } = await import('./documents/headerFooter');
            await swapDocument(cur, paneB, (await removeHeaderFooter(await readFile(cur.file.hash))).slice().buffer);
            setHeaderFooter(null);
          }}
        />
      )}
      {compareOpen && (
        <CompareDialog
          mode={compareOpen}
          files={library}
          openIds={[...tabsA, ...tabsB].map((t) => t.file.id)}
          currentId={activeOpen?.file.id ?? null}
          currentPage={pageIndex}
          preview={previewPage}
          onCancel={() => setCompareOpen(null)}
          onRun={(spec) => {
            setCompareOpen(null);
            void (compareOpen === 'overlay' ? runOverlay(spec) : runCompare(spec));
          }}
        />
      )}
      {securityOpen && activeOpen && (
        <SecurityDialog
          name={activeOpen.file.name}
          onCancel={() => setSecurityOpen(false)}
          onSave={async (settings) => {
            if (!(await rewriteSigned(activeOpen.doc, 'A protected copy'))) return;
            const { encryptPdf } = await import('./documents/security');
            // With its markups, as a saved copy always has them.
            const bytes = await encryptPdf(await annotatedBytes(activeOpen), settings);
            download(`${activeOpen.file.name.replace(/\.pdf$/i, '')} (protected).pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
            setSecurityOpen(false);
            setNotice(`Saved a protected copy of ${activeOpen.file.name}${settings.openPassword ? ': it needs its password to open' : ''}.`);
          }}
        />
      )}
      {idsOpen && (
        <DigitalIdsDialog
          ids={idList}
          onClose={() => setIdsOpen(false)}
          onCreate={async (o) => {
            const { createSelfSignedId } = await import('./documents/digitalIds');
            digitalIds.add(await createSelfSignedId(o));
            setIdList(digitalIds.list());
            setTrustedCerts(digitalIds.trusted());
          }}
          onImport={async (file, password) => {
            const { importDigitalId } = await import('./documents/digitalIds');
            digitalIds.add(await importDigitalId(new Uint8Array(await file.arrayBuffer()), password));
            setIdList(digitalIds.list());
            setTrustedCerts(digitalIds.trusted());
          }}
          onExportCertificate={async (id, password) => {
            const { certificateOf } = await import('./documents/digitalIds');
            download(`${id.name}.cer`, new Blob([certificateOf(id, password) as BlobPart], { type: 'application/pkix-cert' }));
          }}
          onDelete={(id) => {
            digitalIds.remove(id.id);
            setIdList(digitalIds.list());
          }}
        />
      )}
      {signFor && activeOpen && (
        <SignDialog
          ids={idList}
          pictures={signatures.get()}
          fieldName={signFor.fieldName}
          alreadySigned={!!(sigChecks[activeOpen.file.hash]?.length || formModels[activeOpen.file.hash]?.fields.some((f) => f.type === 'signature' && f.value))}
          onManageIds={() => setIdsOpen(true)}
          onCancel={() => setSignFor(null)}
          onSign={async (c) => {
            // The password is checked before anything else happens.
            const record = digitalIds.list().find((r) => r.id === c.idId);
            if (!record) throw new Error('Choose a Digital ID');
            (await import('./documents/digitalIds')).unlockId(record, c.password);
            if (!signFor.fieldName && c.where === 'draw') {
              pendingSign.current = c;
              activeTools?.setTool('formField');
              setSignFor(null);
              setNotice('Drag a box on the page where the signature goes.');
              return;
            }
            await runSign(activeOpen.file.id, c, signFor.fieldName ? { fieldName: signFor.fieldName } : {});
            setSignFor(null);
          }}
        />
      )}
      {inviteSession &&
        (() => {
          const session = sessionById(inviteSession);
          const snap = snapshots.find((x) => x.meta.id === inviteSession);
          if (!session || !snap) return null;
          return (
            <InviteDialog
              title={`Invite to ${snap.meta.name}`}
              onCancel={() => setInviteSession(null)}
              onSend={async (emails) => {
                // Google Drive or OneDrive shares the session folder and emails the link.
                await session.invite?.(emails);
                setInviteSession(null);
                setNotice(`Shared the session with ${emails.join(', ')}.`);
              }}
            />
          );
        })()}
      {endFor &&
        (() => {
          const session = sessionById(endFor.sessionId);
          if (!session) return null;
          return (
            <EndSessionDialog
              name={session.meta.name}
              backend={session.backend}
              documents={session.meta.documents.length}
              authors={endFor.authors}
              projects={knownProjects()
                .filter((p) => !p.removed)
                .map((p) => ({ id: p.id, name: projectById(p.id)?.getSnapshot().manifest.name ?? p.name }))}
              oneDriveAvailable={oneDriveConfigured}
              sendBack={session.meta.documents.flatMap((d) => {
                const src = sourceOf(endFor.sessionId, d.id);
                return src ? [{ docId: d.id, name: d.name, target: `update ${src.name} in your library` }] : [];
              })}
              busy={studioBusy}
              progress={endProgress}
              error={studioError}
              onClose={() => setEndFor(null)}
              onEnd={(choice) => {
                const id = endFor.sessionId;
                // Runs straight from the click, so the folder picker and sign-in can open.
                setEndProgress(null);
                void runStudio(() => endSession(id, choice, setEndProgress)).then((ok) => ok && setEndFor(null));
              }}
            />
          );
        })()}
      {markupAlert &&
        (() => {
          const session = sessionById(markupAlert.sessionId);
          const e = markupAlert.entry;
          const docName = session?.meta.documents.find((d) => d.id === e.docId)?.name;
          return (
            <div className="markup-alert" role="alert">
              <b>⚠ Markup Alert from {e.author}</b>
              <span>{e.text}</span>
              {docName && <span className="hint">{docName}, page {(e.page ?? 0) + 1}</span>}
              <div className="row">
                {e.docId && (
                  <button
                    className="btn small primary"
                    onClick={() => {
                      setMarkupAlert(null);
                      void goToStudioPage(markupAlert.sessionId, e.docId!, e.page ?? null).then(() => {
                        const o = [openRef.current, openBRef.current].find((x) => x?.file.id === studioFileId(markupAlert.sessionId, e.docId!));
                        const m = e.markupId ? o?.store.get(e.markupId) : undefined;
                        if (m) navigate(m.pageIndex, boundsOf(m.points));
                      });
                    }}
                  >
                    Show
                  </button>
                )}
                <button className="btn small" onClick={() => setMarkupAlert(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          );
        })()}
      {batchOpen && (
        <BatchDialog
          initial={batchOpen}
          files={library}
          sets={drawingSets.get()}
          groups={fileGroups.get()}
          selected={activeOpen && !studioDocOf(activeOpen.file.id) ? [activeOpen.file.id] : []}
          onRun={runBatch}
          onClose={() => setBatchOpen(null)}
          stamps={stampLibrary(ws)}
          ids={digitalIds.list()}
          pictures={signatures.get()}
        />
      )}
      {slipSheetOpen && activeOpen && (
        <SlipSheetDialog
          targetName={activeOpen.file.name}
          files={library.filter((f) => f.id !== activeOpen.file.id)}
          onCancel={() => setSlipSheetOpen(false)}
          onRun={(spec) => {
            setSlipSheetOpen(false);
            void runSlipSheet(activeOpen, paneB, spec);
          }}
        />
      )}
      {revisionsOf &&
        (() => {
          const f = library.find((x) => x.id === revisionsOf);
          if (!f) return null;
          return (
            <RevisionsDialog
              file={f}
              onClose={() => setRevisionsOf(null)}
              onOpen={(r) => {
                setRevisionsOf(null);
                // The library keeps one entry per content: the same content is opened, not renamed.
                const same = library.find((x) => x.hash === r.hash);
                if (same) {
                  if (same.id === f.id) setNotice('That revision is the same as the current version.');
                  void openFromLibrary(same);
                  return;
                }
                void readFile(r.hash)
                  .then((bytes) => openCreated(`${f.name.replace(/\.pdf$/i, '')} (${revisionStamp(r.savedAt)}).pdf`, bytes))
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
              onRestore={(r) => {
                if (!confirm(`Go back to the version of ${new Date(r.savedAt).toLocaleString()}? Markups stay on their page numbers; the current version is kept as a revision.`)) return;
                setRevisionsOf(null);
                void restoreRevision(f.id, r);
              }}
              onDelete={(r) => {
                if (confirm('Delete this revision from the device?')) void removeRevision(f.id, r.hash).then(refreshLibrary);
              }}
            />
          );
        })()}
      {formFieldEdit &&
        (() => {
          const o = formFieldEdit.pane === 'b' ? openB : open;
          const c = formFieldEdit.pane === 'b' ? ctlB : ctl;
          const field = o ? formModels[o.file.hash]?.fields.find((f) => f.name === formFieldEdit.name) : undefined;
          const widget = field?.widgets[formFieldEdit.widget];
          if (!o || !c || !field || !widget) return null;
          return (
            <FieldEditor
              key={`${o.file.id}:${field.name}:${formFieldEdit.widget}`}
              field={field}
              widget={widget}
              viewer={c.viewer}
              onCancel={() => setFormFieldEdit(null)}
              onCommit={(value) => {
                setFormFieldEdit(null);
                void fillFields(o.file.id, { [field.name]: value });
              }}
            />
          );
        })()}
      {compareResults && (
        <CompareResultsPanel
          results={compareResults}
          onGo={goToDifference}
          onSideBySide={() => void showSideBySide(compareResults.oldId, compareResults.newId)}
          onClose={() => setCompareResults(null)}
        />
      )}
      {ocrFor && activeOpen && (
        <OcrDialog
          pageCount={activeOpen.doc.pages.length}
          currentPage={pageIndex}
          pagesWithoutText={ocrFor}
          onCancel={() => setOcrFor(null)}
          onRun={(pages, dpi) => {
            setOcrFor(null);
            void runOcr(activeOpen, pages, dpi);
          }}
        />
      )}
      <JobsBar />
      {processKind && activeOpen && (
        <ProcessDialog
          kind={processKind}
          pageCount={activeOpen.doc.pages.length}
          currentPage={pageIndex}
          markupCount={activeOpen.store.all().filter((m) => m.type !== 'hyperlink').length}
          fileSize={activeOpen.file.size}
          onCancel={() => setProcessKind(null)}
          onApply={async (spec) => {
            // The contents before are kept as a revision: these changes cannot be undone otherwise.
            const msg = await runProcess(activeOpen, spec, `Before ${PROCESS_TITLES[spec.kind]}`);
            const changed = (await listFiles()).find((f) => f.id === activeOpen.file.id)?.hash !== activeOpen.file.hash;
            if (msg) setNotice(changed ? `${msg} Document › Revisions brings back the version before.` : msg);
            setProcessKind(null);
          }}
        />
      )}
      {pageTool && activeOpen && (
        <PageToolsDialog
          kind={pageTool.kind}
          pageCount={activeOpen.doc.pages.length}
          currentPage={pageIndex}
          bookmarkStarts={activeOpen.store.bookmarks().map((b) => b.pageIndex)}
          drawnRect={pageTool.drawnRect}
          onDraw={() => {
            setPageTool(null);
            activeTools?.setTool('cropArea');
          }}
          onCancel={() => setPageTool(null)}
          onApply={async (spec) => {
            await runPageTool(activeOpen, paneB, spec);
            setPageTool(null);
          }}
        />
      )}
      {printOpen && activeOpen && (
        <PrintDialog
          pageCount={activeOpen.doc.pages.length}
          currentPage={pageIndex}
          onCancel={() => setPrintOpen(false)}
          filtering={!!listKept}
          onPrint={async (content, pages, options) => {
            const { printablePdf, printPdfBytes } = await import('./documents/printPdf');
            // Markups the list's filter leaves out print faint, if asked.
            const markups = options.dimFiltered && listKept ? activeOpen.store.all().map((m) => (listKept.has(m.id) ? m : { ...m, style: { ...m.style, opacity: m.style.opacity * 0.25 } })) : undefined;
            const source = content === 'document' ? await readFile(activeOpen.file.hash) : await annotatedBytes(activeOpen, markups ? { markups } : {});
            printPdfBytes(await printablePdf(source, content, pages, options));
            setPrintOpen(false);
          }}
        />
      )}
      {visualSearchBox &&
        (() => {
          const { c, o } = paneParts(visualSearchBox.pane);
          if (!c || !o) return null;
          const box = visualSearchBox;
          const close = () => {
            c.tools.setHighlights([]);
            setVisualSearchBox(null);
          };
          const highlight = (hits: readonly VisualSearchHit[], active = -1) => c.tools.setHighlights(hits.map((h) => ({ pageIndex: h.pageIndex, rects: [h.match.rect] })), active);
          return (
            <VisualSearchPanel
              key={`${box.pageIndex}:${box.rect.x}:${box.rect.y}`}
              pageCount={o.doc.pages.length}
              editable={!o.store.readOnly}
              onClose={close}
              onSearch={async ({ allPages, rotations, scales, image }) => {
                const { templateSegments, visualSearch, rasterSearch, toGray, crop } = await import('@nb/measure');
                const source = (await o.doc.geometry(box.pageIndex)).segments;
                const template = templateSegments(source, box.rect);
                const pages = allPages ? o.doc.pages.map((_, i) => i) : [box.pageIndex];
                const hits: VisualSearchHit[] = [];
                if (!image && template.length >= 2) {
                  for (const p of pages) {
                    const segs = p === box.pageIndex ? source : (await o.doc.geometry(p)).segments;
                    for (const match of visualSearch(segs, template, { rotations, scales })) hits.push({ pageIndex: p, match });
                  }
                } else {
                  // A scanned sheet (or asked for): match the pixels, at 100 dpi.
                  const k = 100 / 72;
                  const gray = async (p: number) => {
                    const size = o.doc.pages[p]!;
                    const w = Math.ceil(size.width * k);
                    const h = Math.ceil(size.height * k);
                    const { bitmap } = await o.doc.renderTile(p, k, 0, 0, w, h);
                    const canvas = new OffscreenCanvas(w, h);
                    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(bitmap, 0, 0);
                    bitmap.close();
                    return toGray(ctx.getImageData(0, 0, w, h).data, w, h);
                  };
                  const first = await gray(box.pageIndex);
                  const r = box.rect;
                  const tpl = crop(first, Math.max(0, Math.round(r.x * k)), Math.max(0, Math.round(r.y * k)), Math.max(4, Math.round(r.w * k)), Math.max(4, Math.round(r.h * k)));
                  for (const p of pages) {
                    for (const m of rasterSearch(p === box.pageIndex ? first : await gray(p), tpl, { rotations })) {
                      const rect = { x: m.x / k, y: m.y / k, w: m.w / k, h: m.h / k };
                      hits.push({ pageIndex: p, image: true, match: { center: [rect.x + rect.w / 2, rect.y + rect.h / 2], rect, angle: m.turns * 90, score: m.score, scale: 1 } });
                    }
                  }
                }
                highlight(hits);
                return hits;
              }}
              onGo={(hit, i, all) => {
                highlight(all, i);
                c.viewer.goToPage(hit.pageIndex);
                const r = hit.match.rect;
                c.viewer.zoomToRect({ x: r.x - r.w * 3, y: r.y - r.h * 3, w: r.w * 7, h: r.h * 7 }, 1, hit.pageIndex);
              }}
              onApply={(action: VisualSearchAction, hits) => {
                const now = Date.now();
                const styles = c.tools.getState().styles;
                const base = { status: 'none', author: authorRef.current, createdAt: now, modifiedAt: now, fields: defaultFieldsFor(o.store) };
                const made: Markup[] = [];
                if (action === 'hyperlink') {
                  // Where they all go is asked next.
                  setVsLinks({ pane: box.pane, hits: [...hits] });
                  close();
                  return;
                }
                if (action === 'count') {
                  const byPage = new Map<number, [number, number][]>();
                  for (const h of hits) byPage.set(h.pageIndex, [...(byPage.get(h.pageIndex) ?? []), h.match.center]);
                  for (const [pageIndex, points] of byPage) made.push({ ...base, id: crypto.randomUUID(), type: 'count', pageIndex, points, style: { ...styles.count }, subject: 'Symbol Search' });
                } else {
                  for (const h of hits) {
                    const r = h.match.rect;
                    const pad = Math.max(r.w, r.h) * 0.2;
                    made.push({ ...base, id: crypto.randomUUID(), type: action, pageIndex: h.pageIndex, points: [[r.x - pad, r.y - pad], [r.x + r.w + pad, r.y + r.h + pad]], style: { ...styles[action] } });
                  }
                }
                o.store.checkpoint();
                o.store.batch(() => made.forEach((m) => o.store.add(m)));
                setNotice(`Added ${made.length} markup${made.length === 1 ? '' : 's'} from Symbol Search.`);
                close();
              }}
            />
          );
        })()}
      {vsLinks &&
        (() => {
          const { o } = paneParts(vsLinks.pane);
          if (!o) return null;
          return (
            <HyperlinkDialog
              initial={undefined}
              pageCount={o.doc.pages.length}
              pageLabel={(i) => pageLabelFor(o, i)}
              places={o.store.places()}
              currentPage={vsLinks.hits[0]?.pageIndex ?? 0}
              onCancel={() => setVsLinks(null)}
              onApply={(link) => {
                const now = Date.now();
                o.store.checkpoint();
                for (const h of vsLinks.hits) {
                  const r = h.match.rect;
                  o.store.add({ id: crypto.randomUUID(), type: 'hyperlink', pageIndex: h.pageIndex, points: [[r.x, r.y], [r.x + r.w, r.y + r.h]], style: { ...DEFAULT_STYLES.hyperlink }, link, subject: 'Symbol Search', status: 'none', author: authorRef.current, createdAt: now, modifiedAt: now });
                }
                setNotice(`Added ${vsLinks.hits.length} hyperlink${vsLinks.hits.length === 1 ? '' : 's'} from Symbol Search.`);
                setVsLinks(null);
              }}
              fileId={o.file.id}
              files={library.map((f) => ({ id: f.id, name: f.name }))}
              preview={previewPage}
            />
          );
        })()}
      {bookmarkAction &&
        activeOpen &&
        (() => {
          const o = activeOpen;
          const find = (list: readonly Bookmark[]): Bookmark | null => {
            for (const b of list) {
              if (b.id === bookmarkAction) return b;
              const inner = find(b.children);
              if (inner) return inner;
            }
            return null;
          };
          const b = find(o.store.bookmarks());
          if (!b) return null;
          return (
            <HyperlinkDialog
              initial={b.action ?? { kind: 'page', pageIndex: b.pageIndex, rect: b.rect }}
              pageCount={o.doc.pages.length}
              pageLabel={(i) => pageLabelFor(o, i)}
              places={o.store.places()}
              currentPage={b.pageIndex}
              onCancel={() => setBookmarkAction(null)}
              onApply={async (link) => {
                const { updateBookmark } = await import('@nb/markup');
                o.store.setBookmarks(updateBookmark(o.store.bookmarks(), b.id, link.kind === 'page' ? { pageIndex: link.pageIndex, rect: link.rect, action: undefined } : { action: link }));
                setBookmarkAction(null);
              }}
              fileId={o.file.id}
              files={library.map((f) => ({ id: f.id, name: f.name }))}
              preview={previewPage}
            />
          );
        })()}
      {hyperlinkEdit &&
        (() => {
          const { o } = paneParts(hyperlinkEdit.pane);
          const m = o?.store.get(hyperlinkEdit.id);
          if (!o || !m) return null;
          const close = () => {
            setHyperlinkEdit(null);
            // A new hyperlink without an action is not kept.
            if (!m.link && m.type === 'hyperlink') o.store.remove([m.id]);
          };
          return (
            <HyperlinkDialog
              initial={m.link}
              pageCount={o.doc.pages.length}
              pageLabel={(i) => pageLabelFor(o, i)}
              places={o.store.places()}
              currentPage={m.pageIndex}
              onCancel={close}
              onApply={(link) => {
                o.store.update(m.id, { link });
                setHyperlinkEdit(null);
              }}
              onRemove={
                m.type === 'hyperlink'
                  ? undefined
                  : () => {
                      o.store.update(m.id, { link: undefined });
                      setHyperlinkEdit(null);
                    }
              }
              fileId={o.file.id}
              files={library.map((f) => ({ id: f.id, name: f.name }))}
              preview={previewPage}
            />
          );
        })()}
      {commentEdit &&
        (() => {
          const store = paneParts(commentEdit.pane).o?.store;
          const m = store?.get(commentEdit.id);
          if (!store || !m) return null;
          return (
            <CommentDialog
              title={`${MARKUP_LABELS[m.type]} comment`}
              initial={m.comment ?? ''}
              onClose={() => setCommentEdit(null)}
              onSave={(text) => {
                if (text !== (m.comment ?? '')) store.update(m.id, { comment: text });
                setCommentEdit(null);
              }}
            />
          );
        })()}
      {shortcutsOpen && (
        <ShortcutsDialog
          commands={commands}
          onDownload={(name, text) => download(name, new Blob([text], { type: 'application/json' }))}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {stampsOpen && (
        <StampsDialog
          author={author}
          onClose={() => setStampsOpen(false)}
          onPlace={(s) => {
            setStampsOpen(false);
            placeStamp(s);
          }}
        />
      )}
      {calibration && activeOpen && (
        <CalibrateDialog
          lengthPoints={calibration.lengthPoints}
          pageCount={pageCount}
          defaultAllPages={Object.keys(scales).length === 0}
          viewportName={calibrationViewport?.name}
          onCancel={() => setCalibration(null)}
          onApply={(scale, allPages) => {
            if (calibrationViewport) activeOpen.store.setViewport({ ...calibrationViewport, scale: { ...scale, label: `Calibrated (${calibrationViewport.name})` } });
            else setPageScale(scale, allPages);
            setCalibration(null);
            activeTools?.setTool('length');
          }}
        />
      )}
      {columnsOpen && activeOpen && (
        <ColumnsDialog
          initial={columnSet}
          readOnly={activeReadOnly}
          sample={markups.find((m) => toolsState.selected.has(m.id)) ?? markups[0] ?? null}
          cellContext={{ scaleOf, sheets }}
          profileTemplate={ws.columnTemplate}
          onSave={(set) => {
            activeOpen.store.setColumnSet(set);
            setColumnsOpen(false);
          }}
          onSaveTemplate={(set) => updateWorkspace((w) => ({ ...w, columnTemplate: structuredClone(set) }))}
          onExportXml={(xml) => download(`${activeOpen.file.name.replace(/\.pdf$/i, '')} columns.xml`, new Blob([xml], { type: 'application/xml' }))}
          onClose={() => setColumnsOpen(false)}
          list={ws.list}
          onListChange={(fn) => updateWorkspace((w) => ({ ...w, list: fn(w.list) }))}
        />
      )}
      {exportOpen && activeOpen && (
        <ExportDialog
          docName={activeOpen.file.name}
          shownCount={exportOpen.rows.length}
          totalCount={markups.length}
          columns={listLayout}
          visibleKeys={exportOpen.columns.map((c) => c.key)}
          busy={exportBusy}
          onExport={(req) => void runExport(req)}
          onClose={() => setExportOpen(null)}
        />
      )}
      {syncOpen && activeOpen && syncTable && (
        <SheetSyncDialog
          docName={activeOpen.file.name}
          link={sheetSync.link}
          status={sheetSync.status}
          rowCount={Math.max(0, syncTable.length - 1)}
          googleAvailable={googleSignInConfigured}
          oneDriveAvailable={oneDriveConfigured}
          onConnect={(provider, title) => void sheetSync.connect(provider, title, syncTable)}
          onSyncNow={() => void sheetSync.syncNow()}
          onStop={sheetSync.disconnect}
          onClose={() => setSyncOpen(false)}
        />
      )}
      {installOpen && <InstallDialog onClose={() => setInstallOpen(false)} onNotice={setNotice} />}
      {prefsOpen && <PreferencesDialog author={author} onAuthor={persistAuthor} onClose={() => setPrefsOpen(false)} />}
      {profilesOpen && (
        <ProfilesDialog
          documentColumns={activeOpen ? columnSet : null}
          canApplyToDocument={!!activeOpen && !activeReadOnly}
          onApplyToDocument={(set: ColumnSet) => activeOpen?.store.setColumnSet(structuredClone(set))}
          onDownload={(name, text) => download(name, new Blob([text], { type: 'application/json' }))}
          onClose={() => setProfilesOpen(false)}
        />
      )}
      {ctxMenu && <ContextMenu menu={ctxMenu} onClose={closeCtxMenu} />}
      <AskTextHost />
      {editing && activeOpen && v && activeTools && (
        <TextEditor key={editing.id} markup={editing} store={activeOpen.store} viewer={v} onDone={() => setEditingText(null)} />
      )}
    </div>
  );
}

const RAIL: { id: LeftTab; title: string; icon: ReactNode; experimental?: boolean }[] = [
  {
    id: 'files',
    title: 'File Access',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M3 2h6l2 2v10H3V2zm6 0v2h2" />
      </svg>
    ),
  },
  {
    id: 'pages',
    title: 'Thumbnails',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 2h5v6H2V2zm7 0h5v6H9V2zM2 9h5v5H2V9zm7 0h5v5H9V9z" />
      </svg>
    ),
  },
  {
    id: 'bookmarks',
    title: 'Bookmarks',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M4 2h8v12l-4-2-4 2V2z" />
      </svg>
    ),
  },
  {
    id: 'toolchest',
    title: 'Tool Library',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 6h12v8H2V6zm3-3h6l1 3H4l1-3z" />
      </svg>
    ),
  },
  {
    id: 'properties',
    title: 'Properties',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M3 3h10v2H3V3zm0 4h10v2H3V7zm0 4h7v2H3v-2z" />
      </svg>
    ),
  },
  {
    id: 'layers',
    title: 'Layers',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M8 2l7 4-7 4-7-4 7-4zm0 9 7-4v2l-7 4-7-4V7l7 4z" />
      </svg>
    ),
  },
  {
    id: 'measurements',
    title: 'Measurements',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 7h12v2H2V7zm0-4h2v10H2V3zm10 0h2v10h-2V3z" />
      </svg>
    ),
  },
  {
    id: 'signatures',
    title: 'Signatures',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 12c2-4 4-6 6-6s2 3 4 3 2-2 2-2v5H2v0z" />
      </svg>
    ),
  },
  {
    id: 'spaces',
    title: 'Spaces',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M2 2h12v12H2zM2 8h6V2M8 8v6" />
      </svg>
    ),
  },
  {
    id: 'flags',
    title: 'Flags',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M3 2h1v12H3V2zm2 0h8l-2 3 2 3H5V2z" />
      </svg>
    ),
  },
  {
    id: 'search',
    title: 'Search',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M7 2a5 5 0 0 1 3.9 8.1l2.5 2.5-1.4 1.4-2.5-2.5A5 5 0 1 1 7 2zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
      </svg>
    ),
  },
  {
    id: 'forms',
    title: 'Forms',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M2.5 3.5h11v3h-11zM2.5 9.5h11v3h-11z" />
        <path fill="currentColor" d="M4 4.5h1v1H4zM4 10.5h1v1H4z" />
      </svg>
    ),
  },
  {
    id: 'sets',
    title: 'Sets',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M5 2.5h8.5v10M3.5 4h8.5v10H3.5z" />
      </svg>
    ),
  },
  {
    id: 'projects',
    title: 'Projects',
    experimental: true,
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M2 4.5h4l1.2 1.5H14v6.5H2z" />
      </svg>
    ),
  },
  {
    id: 'sessions',
    title: 'Sessions',
    experimental: true,
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3 13c0-2.2 2.2-4 5-4s5 1.8 5 4v1H3v-1z" />
      </svg>
    ),
  },
];

