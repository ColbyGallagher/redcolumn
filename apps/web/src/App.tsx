import { msg, msgParts } from '@nb/i18n';
import { keyed } from './i18n/keyed';
import { lazy } from './i18n/lazy';
import { useMemo, useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import * as Y from 'yjs';
import { NEEDS_PASSWORD, PdfEngine, type OutlineItem, type PageOp, type PageRegion, type PdfDocument } from '@nb/pdf-core';
import { IMPORT_VERSION, bytesToBase64, markupBounds, type VectorPicture, autoSizedPoints, pointInPolygon, canBeCountSymbol, canConnect, canOffset, bluebeamColumnId, markupDigest, canAutoSize, cropOf, canRoundCorners, cssFont, defaultCornerRadius, markupColours, recolouredStyle, shapeBounds, symbolFromMarkups } from '@nb/markup';
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, MAX_TABLE_LINES, tableCellAt, tableOf, type PageClip, type Point, type TableEdit, viewportRectFromCorners } from '@nb/markup';
import { actionTarget, turnedTo, boundsOf, isAiDraft, measureKindOf, cloudRadius, DEFAULT_STYLES, drawMarkup, ROTATABLE, canCloud, canExplode, canJoin, canReverse, flattenBookmarks, insertBookmark, nameBookmarksByPage, formStamp, refillStamp, resolveStamp, stampAspect, stampColor, withFieldValues, type Bookmark, type LinkAction, type StampDef, isImageType, isMeasureKind, isTextType, MARKUP_LABELS, MarkupStore, DEFAULT_STATUSES, measureProps, moved, planPageOps, scaleOfMarkup, translated, viewportAt, type ColumnSet, type Markup, type StoredLink, type StoredMatchLine, type StoredStitchGroup } from '@nb/markup';
import { DEFAULT_SCALE, formatLatLon, formatMeasure, geoAt, measureValue, METERS_PER_UNIT, parseScaleText, regionCrs, SnapIndex, type MeasureKind, type Scale } from '@nb/measure';
import { EngineSupervisor } from './viewer/engineSupervisor';
import { TileViewer, type PagePoint, type ViewerStats, type ViewState } from './viewer/TileViewer';
import { TileDiagnostics } from './components/TileDiagnostics';
import { SlowDrawingPrompt } from './components/SlowDrawingPrompt';
import { hipValleySlope } from './markup/slopePicker';
import { cutoutBlocker, cutoutTargetOf } from './markup/cutoutTarget';
import { parseRotationInput } from './markup/rotationInput';
import { isMarkupTool, MarkupTools, toolLabel, type FormWidgetHit, type TableDraft, type Tool } from './markup/MarkupTools';
import { ApplyStitchingDialog } from './components/ApplyStitchingDialog';
import { applyStitching, stitchSourceSheets } from './documents/bulkStitch';
import { useAssemblies, useEstimating, useResolvedAssemblies, useBookmarks, useColumnSet, useLinks, usePlaces, useViewports, useManualStitch, useMarkups, useScales, useSheets, useStitch, useToolsState, useGeoRegions } from './markup/hooks';
import { adoptDetected, dragToShift, mergeStitch, moverLine, newMatchLine, lineProblem, nudgeToShift, pairOf, shiftLine, withViewportRegions } from './documents/stitching';
import { StitchPanel } from './components/StitchPanel';
import { GeospatialPanel, type GeoHandlers } from './components/GeospatialPanel';
import { cacheFile, contentHash, holdContents, keepRevision, keepRevisionOf, listFiles, readFile, releaseContents, removeFile, removeRevision, renameFile, replaceFileContent, saveFile, touchFile, type FileRevision, type StoredFile } from './storage/fileStore';
import { DriveSession } from './studio/drive/DriveSession';
import { studioFileId, studioDocOf } from './studio/documentId';
import { saveConfirmedArchiveFile } from './studio/archive';
import { DriveAuthError } from './studio/drive/DriveApi';
import { microsoftUser, OneDrive, subscribeMicrosoftUser, oneDriveSharingEnabled, parseOneDriveInvite, signInWithMicrosoft } from './studio/drive/onedrive';
import { currentSessions, type SessionRef } from './studio/local';
import { allows, canAddMarkups, policyOf, type RecordEntry } from './studio/protocol';
import { myAccess, recordToCsv, type CollabSession, type StudioSnapshot } from './studio/types';
import { Library } from './components/Library';
import { MarkupList } from './components/MarkupList';
import { SheetSyncDialog } from './components/SheetSyncDialog';
import { ReportsDialog, type ReportRequest } from './components/ReportsDialog';
import { ManualQuantityDialog, type ManualRequest } from './components/ManualQuantityDialog';
import { toTable } from './sheetsync/table';
import { exportListWorkbook, planImport } from './sheetsync/importExcel';
import { isOpenChange, patchesFor } from './sheetsync/apply';
import type { CellChange } from './sheetsync/merge';
import { READ_LIMITS, readWorkbook, type ReadWorkbook } from './sheetsync/xlsxRead';
import { ImportExcelDialog } from './components/ImportExcelDialog';
import { ExportRegisterDialog, RegisterTemplatesDialog, type RegisterScope } from './components/RegisterDialogs';
import { checkClientFile, planFill } from './sheetsync/clientFile';
import { checkMarkupLink, linkedFile, markupLinkUrl, parseMarkupQuery, stripMarkupQuery, type LinkBase, type MarkupLink } from './sheetsync/links';
import { closeOut, closedComments, closedStatuses, isComment, raisedRevisions } from './sheetsync/closeOut';
import { CloseOutDialog } from './components/CloseOutDialog';
import { THUMB_PX, type RegisterThumb } from './sheetsync/register';
import { exportRegisterWorkbook, exportTemplate, parseTemplateFile, starterTemplate, templateFileName, templateFor, wording, type RegisterTemplate, type RegisterValue } from './sheetsync/register';
import type { SheetSpec } from './sheetsync/xlsx';
import { isTwoWay, useSheetSync, type TwoWay } from './sheetsync/useSheetSync';
import { NEW_REPLY, replyColumn, toSyncTable } from './sheetsync/keyed';
import { NEW_REPLY_LABEL } from './sheetsync/importExcel';
import { localExcel } from './sheetsync/targets';
import { askText, AskTextHost } from './components/AskText';
import { parseSecret } from './studio/crypto/keys';
import { parseProjectKey, rememberProjectKey } from './studio/crypto/sealedDrive';
import { rememberSessionKeys } from './studio/crypto/store';
import { FirstUseHost, StepUpHost } from './components/StepUpDialog';
import { TOOL_DRAG_TYPE, ToolChestPanel } from './components/ToolChest';
import { SignaturesPanel } from './components/SignaturesPanel';
import { ColumnsDialog } from './components/ColumnsDialog';
import { AssembliesDialog } from './components/AssembliesDialog';
import { ItemsDialog } from './components/ItemsDialog';
import { ProductListsDialog } from './components/ProductListsDialog';
import { TemplatesDialog } from './components/TemplatesDialog';
import { addToLibrary, copyIntoDocument, documentFile, libraryFile } from './assemblies/estimatingLibrary';
import { estimatingFromJson, estimatingToJson, mergeAssemblies, mergeEstimating, referencedRecords, resolveAssemblies, type TakeoffTemplate } from '@nb/markup';
import { QuantitiesDialog } from './components/QuantitiesDialog';
import { CommentsTableDialog } from './components/CommentsTableDialog';
import { commentRows, type CommentRow } from './studio/comments';
import { LinkPreviews, type LinkPreviewWindow, type PreviewDrawing, type PreviewView } from './components/LinkPreview';
import { ScriptsDialog } from './components/ScriptsDialog';
import { TakeoffReview } from './components/TakeoffReview';
import { SheetScaleReview } from './components/SheetScaleReview';
import { isNotToScale, scaleReviewRows, type PageScan } from './measure/scaleReview';
import { pageReadings } from './measure/scaleCheck';
import { proposeViews } from './measure/viewScales';
import { migrateLocalProposals } from './assemblies/proposals';
import { waitingKeys as aiWaitingKeys } from './takeoff/aiReview';
import { toolLibrary } from './takeoff/toolLibrary';
import type { MeasureDefaults } from './components/MeasurementsPanel';
import { itemQuantities, rollup } from './assemblies/quantities';
import { MarkupSummaryDialog, type SummaryExportRequest } from './components/ExportDialog';
import { ProfilesDialog } from './components/ProfilesDialog';
import { PreferencesDialog, type Category as PrefCategory } from './components/PreferencesDialog';
import { scaleInDefaultUnits, settings, systemOf, useSettings, withDefaultUnits } from './settings/settings';
import { buildRows, cellsFor, listColumns, resolveLayout, rowsToCsv, withThreads, type CellContext, type ListColumn, type ListRowData } from './columns/listColumns';
import { clearLayout, DEFAULT_LAYOUT, fitWidths, loadLayout, saveLayout, serializeLayout } from './workspace/layoutState';
import { LAYOUT_RESET_EVENT, SECTION_KEYS } from './workspace/layoutPrefs';
import { addCountSymbol, addToToolSet, createToolSet, DEFAULT_TOOLBAR_TOOLS, profiles, RECENT_TOOLS_ID, rememberRecentTool, stampLibrary, updateWorkspace, useProfiles, useWorkspace, type ToolChestItem } from './workspace/profiles';
import { documentDigest, signatures, type SavedSignature } from './signatures/signatures';
import { TextEditor } from './components/TextEditor';
import { hideFromRecents, setTemplate } from './storage/fileStore';
import { recentFiles } from './storage/recents';
import { attachmentBlob, fileToAttachment, imageToDataUrl, pickAttachment, pickImage } from './markup/pickImage';
import { adjustPixels, polygonBox, polygonInPixels, recolourPixels, type PictureColours } from './markup/pictureColours';
import { SoundDialog } from './components/SoundDialog';
import { UndoHistoryDialog } from './components/UndoHistoryDialog';
import { invertAffine, mapBox } from './compare/affine';
import { counterpart, type Paragraph, type SemanticChange } from './compare/semantic';
import { semanticCompare } from './compare/semanticStore';
import { SemanticComparePanel } from './components/SemanticComparePanel';
import { SpellCheckDialog } from './components/SpellCheckDialog';
import { WhatsNewDialog } from './components/WhatsNewDialog';
import { PublishDialog, type PublishRequest } from './components/PublishDialog';
import { CameraDialog } from './components/CameraDialog';
import { ApplyRedactionsDialog, contrastOn, type RedactOptions } from './components/ApplyRedactionsDialog';
import type { ExportOptions } from '@nb/markup/export';
import type { PdfLayer } from './documents/layers';
import { markupLayersOfHiddenPdf } from './documents/layerMarkups';
import { logFile } from './help/logs';
import { PROJECT_URL } from './help/whatsNew';
import { APP_VERSION } from './version';
import { BookmarksPanel, type ViewTarget } from './components/BookmarksPanel';
import { HyperlinkDialog } from './components/HyperlinkDialog';
import { TableDialog } from './components/TableDialog';
import { TableCellEditor } from './components/TableCellEditor';
import { PrintDialog } from './components/PrintDialog';
import { SpacesPanel } from './components/SpacesPanel';
import { SketchBar } from './components/SketchBar';
import { CadBar } from './components/CadBar';
import { TextSelectionBar } from './components/TextSelectionBar';
import { RecoveredMarkupsBar } from './components/RecoveredMarkupsBar';
import { planDiscard } from './documents/discardUnsaved';
import { cadToolFits, isCadTool } from './markup/cadTools';
import { GEOMETRY_TYPES } from './components/ShapeGeometry';
import { PageToolsDialog, type PageToolKind, type PageToolSpec } from './components/PageToolsDialog';
import { HeaderFooterDialog } from './components/HeaderFooterDialog';
import { PROCESS_ENGLISH, PROCESS_TITLES, ProcessDialog, type ProcessKind, type ProcessSpec } from './components/ProcessDialog';
import { OcrDialog } from './components/OcrDialog';
import { CompareDialog, type ComparePairing, type CompareSpec } from './components/CompareDialog';
import type { PickerPageHandle } from './components/ComparePagePicker';
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
import { BatchDialog, BATCH_ENGLISH, batchLabel, type BatchKind, type BatchResult, type BatchSpec } from './components/BatchDialog';
import { drawingSets, type SetSheet, type SheetIndex } from './storage/sets';
import { fileGroups } from './storage/fileGroups';
import { CompareResultsPanel, type CompareResults, type CompareStop } from './components/CompareResultsPanel';
import { JobsBar } from './components/JobsBar';
import { ToolPreviewCard } from './components/ToolPreviewCard';
import { isAbort, runJob, startJob, useJobRunning, type JobContext } from './jobs/jobs';
import { VisualSearchPanel, type VisualSearchAction, type VisualSearchHit } from './components/VisualSearchPanel';
import { MARKUP_GROUPS, MARKUP_TOOLS, MEASURE_GROUPS, MEASURE_TOOLS, ToolBar, toolShortcut, type ToolBarProps, type ToolEntry, type ToolGroup } from './components/ToolBar';
import { Ribbon, ToolbarDisplayMenu } from './components/Ribbon';
import { buildCommands, type Command, type CommandActions } from './commands/appCommands';
import { commandPolicy } from './commands/commandPolicy';
import { comboOf, formatCombo, keyMap } from './commands/keys';
import { shortcutLabel } from './commands/shortcuts';
import { ContextMenu, SEP, type ContextMenuState, type MenuEntry } from './components/ContextMenu';
import { CommentDialog } from './components/CommentDialog';
import { DocTabStrip } from './components/DocTabStrip';
import { MultiplyDialog } from './components/MultiplyDialog';
import { anyLinked, PortalDialogHost, usePortalGuides, type PortalDialogState } from './takeoff/portalsUi';
import { ChangeColoursDialog } from './components/ChangeColoursDialog';
import { PictureColoursDialog } from './components/PictureColoursDialog';
import { AdjustImageDialog } from './components/AdjustImageDialog';
import { bakePicture } from './markup/pictureBake';
import { MENU_ICONS } from './components/menuIcons';
import { parsePageRange } from './sheets/regions';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { RevuMigrationDialog } from './components/RevuMigrationDialog';
import { FillStampDialog, StampsDialog } from './components/StampsDialog';
import { LineStylesDialog, MANAGE_LINE_STYLES_EVENT } from './components/LineStylesDialog';
import { CountSymbolsDialog, MANAGE_COUNT_SYMBOLS_EVENT } from './components/CountSymbolsDialog';
import { NewPdfDialog, type TemplateRequest } from './components/NewPdfDialog';
import { StartScreen } from './components/StartScreen';
import { BUILTIN_TEMPLATES } from './documents/builtinTemplates';
import { CombineDialog, type CombineSource } from './components/CombineDialog';
import { BulkInsertDialog, type BulkInsertWhere } from './components/BulkInsertDialog';
import { DocumentPropertiesDialog } from './components/DocumentPropertiesDialog';
import { imageToPdf, isImageFile } from './documents/imagePdf';
import { pdfNameFor, type CadOptions } from './cad/client';
import type { CadFile } from './cad/convert';
import { CAD_ACCEPT, isCadFile } from './cad/files';
import { MODEL_ACCEPT, isModelFile } from './model3d/files';
import { openModelView } from './model3d/host';
import { ModelStage } from './model3d/ModelStage';
import { modelLinework } from './model3d/onDrawing';
import { modelLayers, type ModelLayer } from './geospatial/modelOnSheet';
import type { GeoModel } from './geospatial/model';
import { Model3dPanel, Model3dPropertiesPanel } from './model3d/Model3dPanel';
import { gridAtPage, ringAround, type SheetHit } from './model3d/links';
import { useIssueSync } from './model3d/useIssueSync';
import type { SheetSource } from './model3d/sheetOverlays';
import { convertAsJob, convertFile } from './cad/open';
import { cadSession, useCadConversion } from './cad/session';
import { CadConvertDialog } from './components/CadConvertDialog';
import { CadReportBar } from './components/CadReportBar';
import { setDocumentInfo, type EditableInfo } from './documents/docInfo';
import { assertCertificationAllowsMarkups, assertKeepsSignatures, hasSignature } from './documents/signedBytes';
import { rememberPassword } from './documents/idPasswords';
import { LabelRegionsPanel } from './components/LabelRegionsPanel';
import { exportStandard, parseStandardFile, standardFileName, standardHash, standardOfProject, withDefaults, type DrawingStandard } from './sheets/standards';
import { standardFit } from '@nb/sheets';
import { EraseRegionsPanel, type EraseRegionsSpec } from './components/EraseRegionsPanel';
import { ScaleRegionsPanel } from './components/ScaleRegionsPanel';
import type { Region } from './sheets/regions';
import type { PageText, SheetInfo } from '@nb/sheets';
import type { IncomingPage } from './documents/slipSheet';
import { migrateLegacyToolSets } from './toolchest/toolSets';
import { CalibrateDialog } from './components/CalibrateDialog';
import { ScaleToLengthDialog } from './components/ScaleToLengthDialog';
import { SetScaleDialog } from './components/SetScaleDialog';
import { ScaleRequiredDialog } from './components/ScaleRequiredDialog';
import { ScaleControl } from './components/ScaleControl';
import { PagesPanel, resetThumbnails } from './components/PagesPanel';
import { SearchPanel, type DocHit, type SearchMemory } from './components/SearchPanel';
import { librarySource, openSource } from './search/sources';
import { countsFromHits, type CountTool } from './search/countFromHits';
import { MenuBar, LEFT_TABS, leftTitles, type BottomTab, type LeftTab } from './components/MenuBar';
import { PageNav } from './components/PageNav';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SessionsPanel } from './components/SessionsPanel';
import { DesktopOnlyNotice } from './components/studio/DesktopOnlyNotice';
import { PopOutWindow } from './components/PopOutWindow';
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
  MeasurementsPanel,
} from './components/SidePanels';
import { addedMarkupLayers, LayersPanel } from './components/LayersPanel';
import type { SearchHit } from '@nb/sheets';
import { LinksPanel } from './components/LinksPanel';
import { StandardsWizard } from './components/standardsWizard/StandardsWizard';
import type { WizardStepId } from './sheets/standardsWizard';
import { inked, type TaughtMark } from './sheets/marks';
import { forgetText, fromOtherTools, importPdfAnnotations, readGeoRegions, readPdfAnnotations, indexFromText, linkFromMarks, linkFromText, loadPageTexts, repairSquareImages, stitchFromText, type IndexProgress } from './sheets/indexer';
import { requireOnline } from './offline/network';
import { updateGate } from './offline/updates';
import { InstallDialog } from './components/InstallDialog';
import { LibraryDialog } from './components/LibraryDialog';
import { installPack } from './library/install';
import { describeCounts } from './library/pack';
import { droppedPdfs, forgetHandle, handleOf, hasFileLocation, pickFilesToOpen, primeFileLocations, recallHandle, rememberHandle, revealFileLocation, saveAsWithPicker, subscribeFileLocations, writeToHandle } from './storage/diskHandles';
import { desktop, type UpdateState } from './desktop/host';
import { managedPolicy } from './desktop/policy';
import { hostDocumentId } from './desktop/embedHost';
import { fileLocationToken, movedFiles, tokenOf } from './desktop/tokens';
import { SessionFolderDrive } from './studio/drive/folder';
import { confirmAssistant } from './desktop/assistantConfirm';
import { installAssistant } from './desktop/installAssistant';
import { AssistantConfirmDialog } from './components/AssistantConfirmDialog';
import { UnsavedChangesDialog, askSaveChanges } from './components/UnsavedChangesDialog';
import { setAssistantOn } from './desktop/assistantFlag';
import { assistantCall, beginComparison, type AssistantDocument, type AssistantStitching } from './desktop/assistant';
import type { AssistantStandards } from './desktop/assistantStandards';
import { apply as applyAffine, compose as composeAffine, invert as invertStitch, scaleOf as affineScale, visiblePolygon, type Affine } from '@nb/stitch';
import { consumeLaunchFiles, parseLaunch, stripLaunchQuery, takeSharedFiles } from './offline/launch';
import { addBusyCheck } from './offline/updates';
import { runningJobs } from './jobs/jobs';
import { pickSplitPartner, touchRecent } from './splitPartner';
import { pdfOf, pdfTabs, type OpenFile, type OpenModel, type OpenTab } from './documents/openTabs';
import { fontExport, markupsUseNamedFonts, missingFontsNotice, setFontNoticeSink, afterFontNotice } from './fonts/fontNotices';

interface Controllers {
  engine: PdfEngine;
  viewer: TileViewer;
  tools: MarkupTools;
}

/** What each open document looked like when it was opened or last saved, to tell if it has unsaved changes. */
const savedState = new WeakMap<MarkupStore, { edits: number; hash: string; undo?: number }>();
/** File contents an open document's undo history can bring back, kept stored until it closes. */
const heldContents = new WeakMap<MarkupStore, string[]>();
function holdFor(store: MarkupStore, hashes: string[]) {
  holdContents(hashes);
  heldContents.set(store, [...(heldContents.get(store) ?? []), ...hashes]);
}
function releaseFor(store: MarkupStore) {
  const hashes = heldContents.get(store);
  heldContents.delete(store);
  if (hashes) void releaseContents(hashes);
}
/** A short description of page operations for the Undo History, e.g. "Delete 3 pages". */
function pageOpsLabel(ops: readonly PageOp[]): string {
  const n = (k: number) => (k === 1 ? '1 page' : `${k} pages`);
  if (ops.length !== 1) return 'Change pages';
  const op = ops[0]!;
  switch (op.type) {
    case 'rotate':
      return `Rotate ${n(op.pages.length)}`;
    case 'delete':
      return `Delete ${n(op.pages.length)}`;
    case 'move':
      return `Move ${n(op.pages.length)}`;
    case 'insert':
      return 'Insert pages';
    case 'blank':
      return `Insert ${op.count === 1 ? 'a blank page' : msg('{count} blank pages', { count: op.count })}`;
  }
}

/** What a revision note ("Before flattening 3 markups") says the change was, for the Undo History. */
function stepLabel(revisionNote: string | undefined): string | undefined {
  const what = revisionNote?.replace(/^Before /, '');
  return what ? what[0]!.toUpperCase() + what.slice(1) : undefined;
}
/** Autosave waits this long after the last change, so a burst of edits is written once. */
const AUTOSAVE_DELAY_MS = 5000;
function markSaved(t: OpenFile) {
  // Later edits are their own undo steps, so Don't Save can undo just those.
  t.store.checkpoint();
  savedState.set(t.store, { edits: t.store.editCount, hash: t.file.hash, undo: t.store.undoHistory().length });
}
/** Documents that opened with unsaved markups kept from an earlier session, and those whose bar was answered with Keep. */
const recoveredOnOpen = new Set<string>();
const recoveredKept = new Set<string>();
/** Documents that arrived from another window with changes not yet saved to their file. */
const movedDirty = new Set<string>();
function hasUnsavedChanges(t: OpenTab) {
  // A 3D model is only viewed here, never changed, so it has nothing to save.
  if (t.kind === 'model') return false;
  let base = savedState.get(t.store);
  if (!base) {
    if (movedDirty.has(t.file.id)) savedState.set(t.store, { edits: -1, hash: t.file.hash });
    else
    // Document Recovery: changes kept from an earlier session that never reached the file.
    if (settings.get().documentRecovery && recoveredDocs().has(t.file.id)) {
      savedState.set(t.store, { edits: -1, hash: t.file.hash });
      recoveredOnOpen.add(t.file.id);
    } else markSaved(t);
    base = savedState.get(t.store)!;
  }
  return t.store.editCount !== base.edits || t.file.hash !== base.hash;
}

/** Pages longer than tabloid (17 in) are drawings, shown a sheet at a time; smaller ones scroll. */
const DRAWING_PAGE_PT = 17 * 72;

/** The window.__nb handle for the console and the end-to-end tests (e2e/): development and VITE_E2E builds only. */
const TEST_HOOK = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';

/** Preferences › Document › Page Layout, for a document shown for the first time this session. */
function applyPageLayout(viewer: TileViewer, doc: PdfDocument) {
  const layout = settings.get().pageLayout;
  const drawings = doc.pages.some((p) => Math.max(p.width, p.height) > DRAWING_PAGE_PT);
  const continuous = layout === 'continuous' || layout === 'continuousSideBySide' || (layout === 'auto' && !drawings);
  viewer.setSpread(layout === 'sideBySide' || layout === 'continuousSideBySide' ? 2 : 1, viewer.spread.cover);
  viewer.setPageMode(continuous ? 'continuous' : 'single');
}

/**
 * Preferences › Document › Enable Document Recovery: Library documents whose markups have changes
 * not saved to their file, remembered across sessions so they still show as unsaved after the app
 * is closed or crashes.
 */
const RECOVERY_KEY = 'nb.unsavedDocs';

/** True when this page load is the browser's Refresh (F5, Ctrl+R, the reload button). */
function pageWasReloaded(): boolean {
  try {
    return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
  } catch {
    return false;
  }
}
function recoveredDocs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function rememberUnsaved(changes: Map<string, boolean>) {
  const ids = recoveredDocs();
  for (const [id, unsaved] of changes) {
    if (unsaved) ids.add(id);
    else ids.delete(id);
  }
  try {
    if (ids.size) localStorage.setItem(RECOVERY_KEY, JSON.stringify([...ids]));
    else localStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Not remembered; the documents look saved next time.
  }
}

/** A tab's file name, followed by * when the document has changes that are not saved to its file. */
function TabName({ t, saved }: { t: OpenTab; saved: number }) {
  void saved;
  const store = pdfOf(t)?.store;
  useSyncExternalStore(
    (l) => store?.subscribe(l) ?? (() => {}),
    () => store?.editCount ?? 0,
  );
  const cut = useSettings().tabTruncation;
  const name = t.file.name;
  const dirty = !studioDocOf(t.file.id) && hasUnsavedChanges(t);
  // Long names are cut short at the end, the start or the middle (Preferences › General › Options).
  let shown = <span className="name">{name}</span>;
  if (cut === 'start') shown = <span className="name cut-start"><bdi>{name}</bdi></span>;
  else if (cut === 'middle' && name.length > 16) {
    shown = (
      <span className="name cut-middle">
        <span>{name.slice(0, -10)}</span>
        <span>{name.slice(-10)}</span>
      </span>
    );
  }
  // The * sits outside the name, so cutting a long name never hides it.
  return (
    <span className="tab-title">
      {shown}
      {dirty && <span className="dirty" title={msg('Unsaved changes')}>*</span>}
    </span>
  );
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
  const id = await askText(msg('New PDF from Template'), templates[0]!.id, { label: msg('Start from which template?'), confirm: msg('Next'), choices: templates.map((t) => ({ value: t.id, label: t.name })) });
  return templates.find((t) => t.id === id) ?? null;
}

/** One empty list, so a profile without templates gives the same value every render. */
const NO_REGISTER_TEMPLATES: RegisterTemplate[] = [];

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
      store.update(m.id, turnedTo(m, next));
    }
  });
}

/** Text written to the system clipboard when markups are copied, so pasting knows they are ours. */
const MARKUP_CLIP = 'redcolumn markups';

/** The drawing standard a document is read with, from this profile (none when it has none, or it was deleted here). */
function standardOf(store: MarkupStore): DrawingStandard | null {
  const chosen = store.drawingStandard();
  const found = chosen ? profiles.active().state.drawingStandards.find((s) => s.id === chosen.id) : undefined;
  return found ? withDefaults(found) : null;
}

/**
 * Keeps a Project's drawing standard in this profile, so its files read with it here too: added
 * when new, replaced when the Project's copy is newer.
 */
/** A saved standard is offered for a set when at least this share of its sheets fit it. */
const SUGGEST_FIT = 0.6;

function adoptStandard(standard: DrawingStandard) {
  const mine = profiles.active().state.drawingStandards.find((s) => s.id === standard.id);
  if (mine && mine.updatedAt >= standard.updatedAt) return;
  updateWorkspace((w) => ({ ...w, drawingStandards: [...w.drawingStandards.filter((s) => s.id !== standard.id), standard] }));
}

/** The taught marks to look for in a document: those for every set, and its drawing standard's own. */
/** A sheet as a set's index keeps it: its number, title and the custom fields its drawing standard read. */
function indexEntry(s: SheetInfo | undefined): SheetIndex['sheets'][number] {
  if (!s) return null;
  return { ...(s.number ? { number: s.number } : {}), ...(s.title ? { title: s.title } : {}), ...(s.fields ? { fields: s.fields } : {}) };
}

function marksFor(store: MarkupStore): TaughtMark[] {
  return [...profiles.active().state.taughtMarks, ...(standardOf(store)?.marks ?? [])];
}

function download(name: string, blob: Blob) {
  // Browsers with the File System Access API show a Save As dialog; others download.
  void saveAsWithPicker(name, blob.type, blob).then(
    (r) => {
      if (r === 'unsupported') anchorDownload(name, blob);
    },
    (err) => window.alert(err instanceof Error ? err.message : msg('{name} could not be saved.', { name })),
  );
}

/** Writes one summary report into a folder chosen on the Output tab. */
async function writeSummaryFile(dir: { getFileHandle(name: string, options: { create: boolean }): Promise<{ getFile(): Promise<File>; createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }> }, name: string, blob: Blob, overwrite: boolean) {
  let filename = name;
  if (!overwrite) {
    try {
      await dir.getFileHandle(filename, { create: false });
      const dot = filename.lastIndexOf('.');
      filename = `${dot > 0 ? filename.slice(0, dot) : filename} (2)${dot > 0 ? filename.slice(dot) : ''}`;
    } catch {
      // Not there yet: create it under the given name.
    }
  }
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
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
  const isSingleCount = ms.length === 1 && m.type === 'count';
  const templates: Markup[] = isSingleCount
    ? [{ ...structuredClone(m), id: '', pageIndex: 0, points: [[0, 0]], status: 'none', author: '', createdAt: 0, modifiedAt: 0 }]
    : ms.map((x) => ({ ...structuredClone(x), id: '', pageIndex: 0, ...moved(x, -b.x, -b.y), status: 'none', author: '', createdAt: 0, modifiedAt: 0 }));
  const snippet = isTextType(m.type) && m.text?.trim() ? m.text.trim().split('\n')[0]!.slice(0, 40) : '';
  return {
    type: m.type,
    style: m.style,
    label: m.subject || snippet || MARKUP_LABELS[m.type],
    ...(m.subject ? { subject: m.subject } : {}),
    ...(m.image ? { image: m.image } : {}),
    markups: templates,
    // Saved Count tools arm the Count tool in its look rather than pasting the original points.
    ...(isSingleCount ? { mode: 'style' as const } : {}),
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

/** True when the desktop app knows the file a document came from and it is gone from there (moved, renamed or deleted). */
async function movedAway(id: string): Promise<boolean> {
  const host = desktop();
  if (!host?.tokenExists) return false;
  const token = fileLocationToken(id) ?? tokenOf(await recallHandle(id));
  return !!token && !(await host.tokenExists(token).catch(() => true));
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
 * Certificate services (time stamp servers, OCSP responders, revocation lists), which the desktop
 * app reaches from its main process (apps/desktop/src/pki.ts). A browser cannot: the page's
 * security policy only allows its own site and Microsoft. The step then fails with that reason
 * and signing or validating carries on without it.
 */
async function pkiFetch(url: string, body?: Uint8Array, type?: string): Promise<Uint8Array> {
  const viaDesktop = desktop()?.pkiFetch;
  if (!viaDesktop) throw new Error(msg('Time stamps and revocation checks need the desktop app'));
  requireOnline(msg('Time stamps and revocation checks'));
  return viaDesktop(url, body, type);
}

/**
 * The roots LTV builds on: the desktop app's known roots (which also end chains whose CA publishes
 * no root address) and the certificates the user trusts. A time stamp counts only from a server under one.
 */
async function ltvTrust() {
  const { certificatesIn } = await import('./documents/pki');
  const roots = (await desktop()?.pkiRoots?.().catch(() => [])) ?? [];
  return { anchors: roots.flatMap((pem) => certificatesIn(new TextEncoder().encode(pem))), trusted: digitalIds.trusted() };
}

/** Adds long-term validation data to a PDF's signatures: those named, the newest, or all that lack it. */
async function addLtv(bytes: Uint8Array, which: { fields?: string[]; newest?: boolean } = {}) {
  const { addValidationData } = await import('./documents/pdfSign');
  return addValidationData(bytes, pkiFetch, { ...(await ltvTrust()), ...which });
}

/**
 * Adds long-term validation data to a freshly signed PDF. The signature stands without it, so
 * when it cannot be had (offline, a CA with no OCSP or CRL) the signed file is kept and `note` says why.
 */
async function withLtv(signed: Uint8Array): Promise<{ bytes: Uint8Array; note: string | null }> {
  try {
    // Only the signature just made: others in the file are their signers' to complete.
    const out = await addLtv(signed, { newest: true });
    return { bytes: out.bytes, note: out.problems.length ? msg('LTV added, but not for all of it: {problems}', { problems: out.problems.join('; ') }) : null };
  } catch (err) {
    return { bytes: signed, note: msg('Long-term validation not added: {value}', { value: err instanceof Error ? err.message : String(err) }) };
  }
}

/** Tablets upright and phones, where side panels are drawers over the drawing (see offline.css). */
const NARROW_QUERY = '(max-width: 1000px)';
const narrowScreen = () => !!window.matchMedia?.(NARROW_QUERY).matches;

type DockSide = 'left' | 'right';

/** Drag data of a side panel being moved (its rail button or title), so the drawing ignores it. */
const PANEL_DRAG_TYPE = 'application/x-rc-panel';

/** The side of the window a panel is docked on (the profile's choice). Narrow screens keep every panel in the left drawer. */
const panelSide = (id: LeftTab): DockSide => (!narrowScreen() && profiles.active().state.rightPanels.includes(id) ? 'right' : 'left');

/** The first panel the profile docks on a side, which that side panel starts on. */
const firstPanelOn = (side: DockSide): LeftTab | undefined => {
  const ws = profiles.active().state;
  // 3D panels come and go with models, so a side never starts on one.
  return RAIL().find(({ id, needsModel }) => !needsModel && panelSide(id) === side && !ws.hiddenPanels.includes(id) && (id !== 'markups' || ws.markupsDocked))?.id;
};

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

/**
 * The document with its markups written as PDF annotations. With `keepSigned`, a digitally signed
 * file keeps every byte: the markups are appended as an incremental update (none to write leaves
 * the file as it is), so its signatures stay valid.
 */
async function annotatedBytes(
  cur: OpenFile,
  options: { links?: boolean; markups?: readonly Markup[]; embedFont?: ExportOptions['embedFont']; keepSigned?: boolean } = {},
): Promise<Uint8Array> {
  // pdf-lib is only needed here; load it on demand (the service worker still precaches it).
  const { exportWithAnnotations } = await import('@nb/markup/export');
  // Preferences › Markup › Embed Fonts: markup text carries its font files, so every reader shows it alike.
  const embedFont = options.embedFont ?? (settings.get().embedFonts ? (await import('./documents/archiveFonts')).embedFontOrStandard : undefined);
  const stored = await readFile(cur.file.hash);
  const appending = options.keepSigned && hasSignature(new Uint8Array(stored));
  const fonts = await fontExport(options.markups ?? cur.store.all());
  const out = await exportWithAnnotations(stored, options.markups ?? cur.store.all(), {
    ...(embedFont ? { embedFont } : {}),
    // Installed fonts named by markups are embedded; any that cannot be are reported in one notice.
    ...(fonts.systemFonts ? { systemFonts: fonts.systemFonts } : {}),
    onFontFallback: fonts.onFontFallback,
    ...(appending ? { open: async (b: ArrayBuffer) => (await import('./documents/incremental')).openAppending(b) } : {}),
    // Greek and Cyrillic text would be question marks in the standard fonts: the Liberation fonts show it, and an installed font shows CJK.
    fallbackFont: async (doc, name, text) => (await import('./documents/archiveFonts')).embedFontForText(doc, name, text),
    scaleFor: (i) => cur.store.scaleFor(i),
    viewports: cur.store.allViewports(),
    links: options.links === false ? [] : cur.store.allLinks(),
    imported: cur.store.importedAnnotations(),
    importedSpaces: cur.store.importedSpaces(),
    pageScales: cur.store.allScales(),
    geo: cur.store.editedGeo(),
    columns: cur.store.columnSet().columns,
    statuses: cur.store.columnSet().statuses,
    assemblies: cur.store.assemblies(),
    estimating: cur.store.estimating(),
    portals: cur.store.portals(),
    aiReview: cur.store.aiReviewForSave(),
    places: cur.store.places(),
    // Sheet numbers become the PDF's page labels, so other readers show them too.
    pageLabels: cur.doc.pages.map((_, i) => cur.store.allSheets()[i]?.number || null),
    // Until the file's own outline has been read in, leave it as it is.
    ...(cur.store.outlineImported() ? { bookmarks: cur.store.bookmarks() } : {}),
  });
  fonts.done();
  return out;
}

/**
 * The PDF a Project check-in uploads: the library copy's file as it is. Its markups are not written
 * in, as they are shared live already (as in a Live Session) and would otherwise come back twice.
 */
async function projectCopyBytes(libraryId: string): Promise<ArrayBuffer> {
  const file = (await listFiles()).find((f) => f.id === libraryId);
  if (!file) throw new Error(msg('Your copy is no longer in the library.'));
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

const oneDriveApi = new OneDrive();
/** Signs in with Microsoft: OneDrive access plus who the person is. */
const authorizeMicrosoft = async () => {
  await signInWithMicrosoft();
};
const microsoftEmail = () => microsoftUser()?.email ?? null;
/** Sessions in a shared folder on this computer sign in to nothing: the sync client moves the files. */
const noSignIn = async () => {};
/** Whether Live Sessions can live in a shared folder on this computer (the desktop app only). */
const folderSessionsAvailable = () => !!desktop()?.folder;

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
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.getAttribute('role') === 'combobox');
}

/** Opens the editor on the selected table cell at once, so keys typed right after the first reach it. */
function startCellEdit(tools: MarkupTools, typed?: string): boolean {
  let started = false;
  flushSync(() => {
    started = tools.editSelectedCell(typed);
  });
  return started;
}

/** Drag data for reordering document tabs. */
const TAB_DRAG_TYPE = 'application/x-nb-tab';

const INDEX_PHASES = (): Record<IndexProgress['phase'], string> => ({ annotations: msg('Importing markups'), text: msg('Reading text'), links: msg('Finding links'), marks: msg('Finding taught marks'), stitch: msg('Stitching sheets') });

/** Jobs that rewrite a document's pages; while one runs, page operations are turned off. */
const PAGES_JOB = { kind: 'pages', cancellable: false } as const;

/**
 * Whether to go on with `what`, which writes the file again rather than appending to it: always
 * for an unsigned file; for a signed one only if the user accepts that its signatures break.
 */
async function rewriteSigned(doc: PdfDocument, what: string): Promise<boolean> {
  const { signatures } = await doc.info();
  return !signatures || confirm(msg('This file is digitally signed. {what} writes the file again, so its {value} will no longer be valid. Continue?', { what, value: signatures === 1 ? msg('signature') : msg('{signatures} signatures', { signatures }) }));
}

/** Largest vector Snapshot kept in a markup (its PDF); a larger one is copied as a picture only. */
const MAX_VECTOR_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const [ctl, setCtl] = useState<Controllers | null>(null);
  const [ctlB, setCtlB] = useState<{ viewer: TileViewer; tools: MarkupTools } | null>(null);
  /** The second pane's viewer and the problem pill's Retry, for the renderer supervisor. */
  const viewerBRef = useRef<TileViewer | null>(null);
  const retryRef = useRef<(() => void | Promise<void>) | undefined>(undefined);
  const prefs = useSettings();
  // Preference changes apply to the open panes straight away (new panes read them on creation).
  const ctlsRef = useRef<(MarkupTools | undefined)[]>([]);
  ctlsRef.current = [ctl?.tools, ctlB?.tools];
  useEffect(() => ctlsRef.current.forEach((t) => t?.setSnap(prefs.snapToGeometry)), [prefs.snapToGeometry]);
  useEffect(() => ctlsRef.current.forEach((t) => t?.setShowLinks(prefs.showHyperlinks)), [prefs.showHyperlinks]);
  useEffect(() => {
    if (ctl) ctl.engine.includeShxText = prefs.importShxText;
  }, [ctl, prefs.importShxText]);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const openRef = useRef<OpenFile | null>(null);
  const [openB, setOpenB] = useState<OpenFile | null>(null);
  const openBRef = useRef<OpenFile | null>(null);
  /** The 3D model tab in front of each pane, when a model rather than a PDF is in front (`open`/`openB` is then null). */
  const [modelA, setModelA] = useState<OpenModel | null>(null);
  const modelARef = useRef<OpenModel | null>(null);
  const [modelB, setModelB] = useState<OpenModel | null>(null);
  const modelBRef = useRef<OpenModel | null>(null);
  /** Every document open in each pane, shown as tabs; `open`/`openB` is the one in front. */
  const [tabsA, setTabsA] = useState<OpenTab[]>([]);
  /** Counts Projects opened, so what depends on the open Projects runs again. */
  const [projectsOpened, setProjectsOpened] = useState(0);
  const tabsARef = useRef<OpenTab[]>([]);
  /** Documents an autosave is writing right now, so one is never written twice at once. */
  const autosaving = useRef(new Set<string>());
  const [tabsB, setTabsB] = useState<OpenTab[]>([]);
  const tabsBRef = useRef<OpenTab[]>([]);
  /** Where each tab was scrolled to, restored when it comes back to the front. */
  const savedViews = useRef(new Map<string, ViewState>());
  const [library, setLibrary] = useState<StoredFile[]>([]);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [statsB, setStatsB] = useState<ViewerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A passing confirmation (e.g. how many pages were labelled); clears itself. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Convert Again for the PDF converted from a drawing with this id; and whether it is running. */
  const [cadAgain, setCadAgain] = useState<string | null>(null);
  const [cadBusy, setCadBusy] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  // Exports report the installed fonts they could not embed through the same notice line.
  useEffect(() => setFontNoticeSink(setNotice), []);
  // Installed fonts the open documents' markups use are loaded before they are drawn; a font this
  // computer lacks is shown in a similar one, and said so once per document.
  const fontWarned = useRef(new Set<string>());
  useEffect(() => {
    const docs = [open, openB].filter((d): d is OpenFile => !!d);
    if (!docs.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const run = async () => {
      for (const d of docs) {
        const markups = d.store.all();
        if (!markupsUseNamedFonts(markups)) continue;
        const fonts = await import('./fonts/documentFonts');
        if (cancelled) return;
        unsubscribe ??= fonts.onSystemFontsChanged(() => {
          ctl?.viewer.invalidate();
          ctlB?.viewer.invalidate();
        });
        const missing = await fonts.usedMissingFonts(markups);
        if (cancelled) return;
        const text = missingFontsNotice(missing);
        if (text && !fontWarned.current.has(d.file.id)) {
          fontWarned.current.add(d.file.id);
          setNotice((current) => afterFontNotice(current, text));
        }
      }
    };
    void run();
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 500);
    };
    const offs = docs.map((d) => d.store.subscribe(arm));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      offs.forEach((off) => off());
      unsubscribe?.();
    };
  }, [open, openB, ctl, ctlB]);
  const [dragOver, setDragOver] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  /** Pane whose Custom scale dialog is open (from the Scale dropdown in the page bar). */
  const [customScalePane, setCustomScalePane] = useState<'a' | 'b' | null>(null);
  /** The page Set Page Scale opens on when it isn't the current page (e.g. the page a measurement needed a scale on). */
  const [customScalePage, setCustomScalePage] = useState<number | null>(null);
  /** Scale to Length or a measuring tool was used on a page with no scale. */
  const [scaleNeeded, setScaleNeeded] = useState<{ pane: Pane; pageIndex: number; tool: Tool } | null>(null);
  const [calibration, setCalibration] = useState<{ pageIndex: number; lengthPoints: number; at: [number, number]; delta: [number, number] } | null>(null);
  /** Scale to Length: the reference points picked, waiting for the length they should be. */
  const [scaleAsk, setScaleAsk] = useState<{ pane: Pane; pageIndex: number; points: [[number, number], [number, number]] } | null>(null);
  /** Subject, label and assembly the Measurements panel gives the next measurement. */
  const [measureDefaults, setMeasureDefaults] = useState<MeasureDefaults>({ subject: '', label: '' });
  const measureDefaultsRef = useRef(measureDefaults);
  measureDefaultsRef.current = measureDefaults;
  // The side panels' open state and tab are remembered between sessions.
  const readSavedPanel = (side: DockSide) => {
    try {
      const saved = JSON.parse(localStorage.getItem(`nb.panel.${side}`) ?? 'null') as { tab?: string; open?: boolean } | null;
      const tab = saved?.tab && (LEFT_TABS as readonly string[]).includes(saved.tab) && panelSide(saved.tab as LeftTab) === side ? (saved.tab as LeftTab) : null;
      return { tab, open: typeof saved?.open === 'boolean' ? saved.open : null };
    } catch {
      return { tab: null, open: null };
    }
  };
  const [saved] = useState(() => ({ left: readSavedPanel('left'), right: readSavedPanel('right') }));
  const [leftTab, setLeftTab] = useState<LeftTab>(() => saved.left.tab ?? (panelSide('files') === 'left' ? 'files' : (firstPanelOn('left') ?? 'files')));
  // On narrow screens the panel covers the drawing, so it starts closed whatever was saved.
  const [leftOpen, setLeftOpen] = useState(() => (narrowScreen() ? false : (saved.left.open ?? true)));
  // Panel widths and the Markups list's state, kept between launches (see workspace/layoutState.ts).
  const [savedLayout] = useState(loadLayout);
  const [leftWidth, setLeftWidth] = useState(() => savedLayout?.leftWidth ?? DEFAULT_LAYOUT.leftWidth);
  // Panels docked on the right (the profile's rightPanels) open in a second side panel there.
  const [rightTab, setRightTab] = useState<LeftTab>(() => saved.right.tab ?? firstPanelOn('right') ?? 'properties');
  const [rightOpen, setRightOpen] = useState(() => saved.right.open ?? !!firstPanelOn('right'));
  useEffect(() => {
    try {
      localStorage.setItem('nb.panel.left', JSON.stringify({ tab: leftTab, open: leftOpen }));
      localStorage.setItem('nb.panel.right', JSON.stringify({ tab: rightTab, open: rightOpen }));
    } catch {
      /* storage off limits: the layout lasts for this session */
    }
  }, [leftTab, leftOpen, rightTab, rightOpen]);
  const [rightWidth, setRightWidth] = useState(() => savedLayout?.rightWidth ?? DEFAULT_LAYOUT.rightWidth);
  // Each side's rail names its panels (Thumbnails, File Access...) until the user collapses it to icons.
  const railLabelsKey = (side: DockSide) => (side === 'left' ? 'nb.railLabels' : 'nb.rightRailLabels');
  const [railLabels, setRailLabels] = useState<Record<DockSide, boolean>>(() => {
    const read = (side: DockSide) => {
      try {
        // The right rail once shared the left's setting, so it starts from that until set on its own.
        const saved = localStorage.getItem(railLabelsKey(side)) ?? localStorage.getItem(railLabelsKey('left'));
        return saved !== '0';
      } catch {
        return true;
      }
    };
    return { left: read('left'), right: read('right') };
  });
  const toggleRailLabels = (side: DockSide) =>
    setRailLabels((labels) => {
      const on = labels[side];
      try {
        localStorage.setItem(railLabelsKey(side), on ? '0' : '1');
      } catch {
        /* storage off limits: the choice lasts for this session */
      }
      return { ...labels, [side]: !on };
    });
  const ws = useWorkspace();
  const { profiles: profileList, activeId: activeProfileId } = useProfiles();
  const showTools = ws.showToolbar;
  const toggleToolbar = () => updateWorkspace((w) => ({ ...w, showToolbar: !w.showToolbar }));
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  /** The Markups list is shown in its own window instead of the bottom dock. */
  const [markupsPopped, setMarkupsPopped] = useState(false);
  /** The open right-click menu belongs to the pop-out window. */
  const [ctxInPopOut, setCtxInPopOut] = useState(false);
  /** A panel being dragged by its rail button or title: `over` is the panel it would drop beside, `side` the rail it would dock on. */
  const [railDrag, setRailDrag] = useState<{ id: LeftTab; over: LeftTab | null; after: boolean; side: DockSide | null } | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [assembliesOpen, setAssembliesOpen] = useState(false);
  const [quantitiesOpen, setQuantitiesOpen] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [productListsOpen, setProductListsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  /** The Comments table, for a Project or a Live Session; hidden while one of its rows is open. */
  const [commentsTable, setCommentsTable] = useState<{
    key: string;
    title: string;
    rows: CommentRow[] | null;
    progress: { done: number; total: number } | null;
    failed: string[];
    open: (row: CommentRow) => void;
    refresh: () => void;
    hidden?: boolean;
  } | null>(null);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [takeoffReviewOpen, setTakeoffReviewOpen] = useState(false);
  const [scaleReviewOpen, setScaleReviewOpen] = useState(false);
  /** Scale bars, dimensions and view titles read for Review Sheet Scales, by page, for one file. */
  const [scaleReadings, setScaleReadings] = useState<{ file: string; pages: Record<number, PageScan>; done: boolean } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  /** Import from Excel: the workbook being previewed, for which document, and the words mapped to choices so far. */
  const registerTemplates = ws.registerTemplates ?? NO_REGISTER_TEMPLATES;
  /** A link to a comment being followed: its document is opening, and the comment is gone to once its markups are there. */
  const [pendingLink, setPendingLink] = useState<{ fileId: string; markupId: string; since: number } | null>(null);
  /** Document › Close-out, and the register template whose closed statuses it counts by ('' is the usual ones; null follows the document's client). */
  const [closeOutOpen, setCloseOutOpen] = useState(false);
  const [closeOutTemplate, setCloseOutTemplate] = useState<string | null>(null);
  /** Export Comment Register, and the template editor (on one template, or the list). */
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerTemplatesOpen, setRegisterTemplatesOpen] = useState<{ id?: string } | null>(null);
  const [importExcel, setImportExcel] = useState<{ fileId: string; fileName: string; book: ReadWorkbook; aliases: Record<string, Record<string, string>> } | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsBusy, setReportsBusy] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  /** The typed quantity the next click on a page places (Takeoff › Manual Quantity). */
  const manualPendingRef = useRef<ManualRequest | null>(null);
  const exportBusy = useJobRunning('export');
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [docDigest, setDocDigest] = useState<string | null>(null);
  // On a phone the Markups list is a drawer over the drawing, so it starts closed there.
  const [showBottom, setShowBottom] = useState(() => !window.matchMedia?.('(max-width: 720px)').matches && !profiles.active().state.markupsDocked && (savedLayout?.showBottom ?? true));
  const [bottomTab, setBottomTab] = useState<BottomTab>(() => savedLayout?.bottomTab ?? 'markups');
  const [dockHeight, setDockHeight] = useState(() => savedLayout?.dockHeight ?? DEFAULT_LAYOUT.dockHeight);
  // Clicking the Markups list's top edge collapses it to a thin strip; clicking the strip opens it again.
  const [dockOpen, setDockOpen] = useState(() => savedLayout?.dockOpen ?? true);
  // Showing the list again (menu, shortcut) opens it rather than leaving the strip. Not on launch,
  // where the strip is how it was left.
  const lastShowBottom = useRef(showBottom);
  // The list was left off at launch by the window width or a profile, not by the user: what they chose
  // last time stays saved until they show or hide it themselves.
  const showBottomForced = useRef(narrowScreen() || profiles.active().state.markupsDocked);
  const layoutRef = useRef(savedLayout ?? DEFAULT_LAYOUT);
  const restoringBottom = useRef(false);
  useEffect(() => {
    // Not when it came back by itself (wider window, undocked profile): the strip stays a strip.
    if (showBottom && !lastShowBottom.current && !restoringBottom.current) setDockOpen(true);
    restoringBottom.current = false;
    if (showBottom !== lastShowBottom.current) showBottomForced.current = false;
    lastShowBottom.current = showBottom;
  }, [showBottom]);
  // Collapsed to its strip, the list counts as closed: menus show it unchecked and toggling opens it.
  const bottomOpen = showBottom && dockOpen;
  const toggleBottom = () => {
    if (bottomOpen) setShowBottom(false);
    else {
      setShowBottom(true);
      setDockOpen(true);
    }
  };
  // On narrow screens the list is a drawer over the drawing, so it stays inside the workspace.
  const [narrow, setNarrow] = useState(narrowScreen);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // Back from a phone-width window, or off a profile that docks the list, it returns as it was left.
  useEffect(() => {
    if (!narrow && !ws.markupsDocked && showBottomForced.current) {
      showBottomForced.current = false;
      restoringBottom.current = layoutRef.current.showBottom !== showBottom;
      setShowBottom(layoutRef.current.showBottom);
    }
  }, [narrow, ws.markupsDocked]);
  // The layout is saved a moment after it changes, so dragging a divider writes once. Nothing is written
  // on a phone (the panels are drawers), when nothing differs from what is saved, or for the list's
  // visibility while something other than the user is deciding it.
  useEffect(() => {
    if (narrow) return;
    const forced = showBottomForced.current || ws.markupsDocked;
    const next = { leftWidth, rightWidth, showBottom: forced ? layoutRef.current.showBottom : showBottom, dockOpen, bottomTab, dockHeight };
    if (serializeLayout(next) === serializeLayout(layoutRef.current)) return;
    const t = window.setTimeout(() => {
      layoutRef.current = next;
      saveLayout(next);
    }, 300);
    return () => window.clearTimeout(t);
  }, [narrow, ws.markupsDocked, leftWidth, rightWidth, showBottom, dockOpen, bottomTab, dockHeight]);
  /** The side panels as drawn: the saved widths, shrunk when both are open in a window too small for them. */
  const shownWidths = (() => {
    const [left, right] = leftOpen && rightOpen ? fitWidths(leftWidth, rightWidth, window.innerWidth) : [leftWidth, rightWidth];
    return { left, right };
  })();
  /**
   * Window > Reset Layout: side panel tabs, widths and rail labels, panel order and hidden panels, the
   * Markups list (shown, size, tab), ribbon and toolbar visibility, split view, and the remembered
   * Recents and Measurements sections. Documents, profiles and tools are untouched.
   */
  const resetLayout = () => {
    clearLayout();
    layoutRef.current = DEFAULT_LAYOUT;
    for (const k of ['nb.panel.left', 'nb.panel.right', 'nb.railLabels', 'nb.rightRailLabels', ...SECTION_KEYS]) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* nothing kept */
      }
    }
    window.dispatchEvent(new Event(LAYOUT_RESET_EVENT));
    updateWorkspace((w) => ({ ...w, hiddenPanels: [], panelOrder: [], showToolbar: true, ribbonCollapsed: false }));
    const docked = profiles.active().state.markupsDocked;
    showBottomForced.current = narrow || docked;
    setLeftWidth(DEFAULT_LAYOUT.leftWidth);
    setRightWidth(DEFAULT_LAYOUT.rightWidth);
    setDockHeight(DEFAULT_LAYOUT.dockHeight);
    setBottomTab(DEFAULT_LAYOUT.bottomTab);
    setShowBottom(!narrow && !docked);
    setDockOpen(true);
    setLeftTab(panelSide('files') === 'left' ? 'files' : (firstPanelOn('left') ?? 'files'));
    setRightTab(firstPanelOn('right') ?? 'properties');
    // On a phone the panels are drawers over the drawing, so they stay shut.
    setLeftOpen(!narrow);
    setRightOpen(!narrow && !!firstPanelOn('right'));
    setRailLabels({ left: true, right: true });
    setSplitRatio(0.5);
    setSplitHorizontal(false);
    if (split) unsplit();
  };
  const dockFull = ws.dockFullWidth && !narrow;
  const [split, setSplit] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  /** Split Horizontal: the second pane below the first rather than beside it. */
  const [splitHorizontal, setSplitHorizontal] = useState(false);
  /** Synchronised panes: both show the same page number ('document') or keep their page offset ('page'). */
  const [sync, setSync] = useState<'document' | 'page' | null>(null);
  /** Side-by-Side (two pages per row) and Show Cover Page, in both panes. */
  const [spread, setSpread] = useState<{ columns: 1 | 2; cover: boolean }>({ columns: 1, cover: false });
  const [magnifier, setMagnifier] = useState(false);
  const [soundOpen, setSoundOpen] = useState<false | 'sound' | 'video'>(false);
  const [undoHistoryOpen, setUndoHistoryOpen] = useState(false);
  const [spellOpen, setSpellOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [redactFor, setRedactFor] = useState<{ pane: Pane; count: number } | null>(null);
  /** Each document's PDF layers (by contents hash), and the ones hidden (by document id). */
  const [pdfLayers, setPdfLayers] = useState<Record<string, PdfLayer[]>>({});
  /** The PDF layers each page draws with, by contents hash. */
  const [pdfLayerPages, setPdfLayerPages] = useState<Record<string, string[][]>>({});
  const [hiddenPdfLayers, setHiddenPdfLayers] = useState<Record<string, string[]>>({});
  /** Markup layers switched off, by document id ('' is markups on no layer). */
  const [hiddenMarkupLayers, setHiddenMarkupLayers] = useState<Record<string, string[]>>({});
  /** Markup layers drawn faintly by the Layers Dial in Fade mode, by document. */
  const [fadedMarkupLayers, setFadedMarkupLayers] = useState<Record<string, string[]>>({});
  const [publishFor, setPublishFor] = useState<'pdf' | 'images' | null>(null);
  const publishing = useJobRunning('publish');
  const [locationTick, setLocationTick] = useState(0);
  useEffect(() => subscribeFileLocations(() => setLocationTick((n) => n + 1)), []);
  useEffect(() => {
    void primeFileLocations();
  }, []);
  // A newer version of the app is ready. It loads (or the desktop app restarts) once nothing is
  // in progress (src/offline/updates.ts); until then the notice says what it waits for.
  const updateWaitingFor = useRef('');
  useEffect(() => {
    const ready = (e: Event) => {
      const reasons = ((e as CustomEvent<string[]>).detail ?? []).join(', ');
      if (!reasons || reasons === updateWaitingFor.current) return;
      updateWaitingFor.current = reasons;
      const when = desktop() ? 'restarts' : 'loads';
      setNotice(msg('A new version of redcolumn is ready. It {when} when you are done ({reasons}); Help › Check for Updates {when2} it now.', { when, reasons, when2: when }));
    };
    window.addEventListener('nb-update-ready', ready);
    return () => window.removeEventListener('nb-update-ready', ready);
  }, []);
  const [installOpen, setInstallOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  useEffect(() => {
    const host = desktop();
    if (host) void host.assistantInfo().then((info) => setAssistantOn(info.enabled));
  }, []);
  // The desktop app checks for a newer version at every launch; the header shows what it found.
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const host = desktop();
    // Under the organisation's policy nothing is checked, and nothing about updates is shown.
    if (!host?.onUpdateState || managedPolicy().disableAutoUpdate) return;
    const off = host.onUpdateState(setUpdateState);
    void host.updateState().then((s) => setUpdateState((prev) => prev ?? s)).catch(() => undefined);
    return off;
  }, []);
  /** Restarts into a downloaded update. The desktop app refuses while documents have unsaved changes. */
  const restartIntoUpdate = () =>
    void desktop()
      ?.installUpdate()
      .then((r) => {
        if (!r.ok) setNotice(r.reason);
      })
      .catch(() => setNotice(msg('Could not restart to update. It installs when you close redcolumn.')));
  const onUpdateButton = () => {
    if (updateState?.status === 'ready') restartIntoUpdate();
    else if (updateState?.status === 'available' && updateState.url) window.open(updateState.url, '_blank', 'noopener');
  };
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
  /**
   * The drawing standards setup, on a pane's document: in its own window, or over the app when
   * pop-ups are blocked. `step` is where it opens; `n` changes when a command asks for a step.
   */
  const [setup, setSetup] = useState<{ pane: Pane; inline: boolean; step?: WizardStepId; n: number } | null>(null);
  /** Apply Stitching to Other Sheets is open (from the active document). */
  const [applyStitch, setApplyStitch] = useState(false);
  const [setupTexts, setSetupTexts] = useState<PageText[] | null>(null);
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
  /** Closes a tab, asking first about unsaved changes (set after it is defined, for the Sets panel). */
  const closeTabRef = useRef<(pane: Pane, fileId: string) => Promise<boolean>>(async () => false);
  const sideBySideRef = useRef<(oldId: string, newId: string) => Promise<void>>(async () => {});
  const semanticGoRef = useRef<(change: SemanticChange, shown?: boolean) => Promise<void>>(async () => {});
  /** An open page tool dialog; crop keeps a rectangle drawn on the page. */
  const [pageTool, setPageTool] = useState<{ kind: PageToolKind; drawnRect: { x: number; y: number; w: number; h: number } | null } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);
  const [lineStylesOpen, setLineStylesOpen] = useState(false);
  const [countSymbolsOpen, setCountSymbolsOpen] = useState(false);
  const [revuMigrationOpen, setRevuMigrationOpen] = useState(false);
  useEffect(() => {
    // The Line style pickers open the manager from wherever they sit.
    const open = () => setLineStylesOpen(true);
    window.addEventListener(MANAGE_LINE_STYLES_EVENT, open);
    return () => window.removeEventListener(MANAGE_LINE_STYLES_EVENT, open);
  }, []);
  useEffect(() => {
    const open = () => setCountSymbolsOpen(true);
    window.addEventListener(MANAGE_COUNT_SYMBOLS_EVENT, open);
    return () => window.removeEventListener(MANAGE_COUNT_SYMBOLS_EVENT, open);
  }, []);
  /** Manage Stamps opened on the new-stamp editor (the toolbar menu's New Stamp). */
  const [stampsCreating, setStampsCreating] = useState(false);
  /** The current commands by id, for the keyboard handler (rebuilt every render). */
  const commandsRef = useRef<ReadonlyMap<string, Command>>(new Map());
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsCategory, setPrefsCategory] = useState<{ category: PrefCategory; tab?: string; query?: string } | undefined>();
  useEffect(() => {
    const open = () => {
      setPrefsCategory({ category: 'mcp' });
      setPrefsOpen(true);
    };
    window.addEventListener('nb-assistant-open', open);
    return () => window.removeEventListener('nb-assistant-open', open);
  }, []);
  /** A library file or a tab waiting for the right pane to exist (Open in Split View, Move to Right Pane). */
  const pendingSplitStored = useRef<{ file: StoredFile; bytes: ArrayBuffer } | null>(null);
  const pendingMove = useRef<OpenTab | null>(null);
  /** Split View with one file open: once the right pane exists, show the front document in it too. */
  const pendingMirror = useRef(false);
  /**
   * The right pane is a tab-less second view of the left pane's front document, following it
   * (one document, one markup store, two views). It ends when the right pane is given its own document.
   */
  const mirrorRef = useRef(false);
  /** Where Split View took a tab from, so Unsplit puts it back in the same place. */
  const splitOrigin = useRef<{ id: string; index: number } | null>(null);
  /** Documents most recently shown first, for choosing the other side of a split. */
  const recentOpenIds = useRef<string[]>([]);
  const moveTabRef = useRef<(from: Pane, t: OpenTab) => void>(() => {});
  const canvasMenuRef = useRef<(e: MouseEvent, pane: Pane) => void>(() => {});
  /** Where the pointer last was over a page, for pasting at the cursor. */
  const lastPointer = useRef<{ x: number; y: number; viewer: TileViewer } | null>(null);
  /** Markups copied or cut, pasted into any open document. */
  const clipboard = useRef<Markup[]>([]);
  /** Pages cut or copied from the thumbnails, as a PDF of just those pages and what was on them, for Paste Pages. */
  const pageClipboard = useRef<{ bytes: ArrayBuffer; clips: PageClip[] } | null>(null);
  /** How many markups are on the clipboard; state so menus and shortcuts see copies at once. */
  const [clipboardCount, setClipboardCount] = useState(0);
  const [commentEdit, setCommentEdit] = useState<{ pane: Pane; id: string } | null>(null);
  const [hyperlinkEdit, setHyperlinkEdit] = useState<{ pane: Pane; id: string } | null>(null);
  /** A stamp with fields, being filled in before it is placed. */
  const [stampToFill, setStampToFill] = useState<StampDef | null>(null);
  /** A placed stamp whose fields are being changed. */
  const [stampEdit, setStampEdit] = useState<{ pane: Pane; id: string } | null>(null);
  // A table just drawn, waiting for its rows and columns; and the table cell being typed in.
  const [tableDraft, setTableDraft] = useState<{ pane: Pane; draft: TableDraft } | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; row: number; col: number; text?: string } | null>(null);
  /** Symbol Search: the symbol box the user drew, and in which pane. */
  const [visualSearchBox, setVisualSearchBox] = useState<{ pane: Pane; pageIndex: number; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  const followHyperlinkRef = useRef<(m: Markup) => void>(() => {});
  const eraseRef = useRef<(pageIndex: number, rect: { x: number; y: number; w: number; h: number }, polygon?: Point[]) => void>(() => {});
  const editTextRef = useRef<(pageIndex: number, at: [number, number]) => void>(() => {});
  const formFieldRef = useRef<(pane: Pane, w: FormWidgetHit) => void>(() => {});
  const editLabelRef = useRef<(pane: Pane, id: string) => void>(() => {});
  /** The last Snapshot taken: its picture's pixel size and the image markup it pastes as. */
  const lastSnapshot = useRef<{ width: number; height: number; markup: Markup } | null>(null);
  const snapshotRef = useRef<(pane: Pane, pageIndex: number, rect: { x: number; y: number; w: number; h: number }, withMarkups?: boolean, polygon?: Point[]) => Promise<void>>(async () => {});
  const pasteImageRef = useRef<(file: Blob, at?: { pane: Pane; x: number; y: number }) => void>(() => {});
  /** Images dropped on an open document, at a point on screen (Preferences › Images › Image Drag/Drop Behaviour). */
  const dropImagesRef = useRef<(pane: Pane, files: File[], x: number, y: number) => void>(() => {});
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
    void askText(msg('Name the Space'), `Space ${n}`, { label: msg('Name'), confirm: msg('Save') }).then((name) => {
      if (name?.trim()) o.store.update(id, { subject: name.trim() });
    });
  };
  /** The markup a reply is being written to, and the reply it answers when it answers one. */
  const [replyTo, setReplyTo] = useState<{ pane: Pane; id: string; parentId?: string } | null>(null);
  /** Edit → Multiply is open for this pane's selection. */
  const [multiplyFor, setMultiplyFor] = useState<Pane | null>(null);
  /** Right-click › Change Colours: the markups whose colours are being changed. */
  const [changeColoursFor, setChangeColoursFor] = useState<{ pane: Pane; ids: string[] } | null>(null);
  const [pictureColoursFor, setPictureColoursFor] = useState<{ pane: Pane; id: string } | null>(null);
  const [adjustImageFor, setAdjustImageFor] = useState<{ pane: Pane; ids: string[] } | null>(null);
  /** Right-click › Capture › View Capture: the picture shown. */
  const [captureView, setCaptureView] = useState<string | null>(null);
  /** File → New PDF, or Document → Insert → Blank Pages. */
  const [blankPdf, setBlankPdf] = useState<'new' | 'blank' | null>(null);
  const [combineOpen, setCombineOpen] = useState(false);
  const [docPropsOpen, setDocPropsOpen] = useState(false);
  /** Recently closed file- or library-backed tabs (LIFO, max 20) for Reopen Closed Tab (Ctrl+Shift+T). */
  const [closedTabs, setClosedTabs] = useState<{ name: string; libraryId: string; desktopToken: string | null; pageIndex: number }[]>([]);
  const closedTabsRef = useRef<{ name: string; libraryId: string; desktopToken: string | null; pageIndex: number }[]>([]);
  const [revealFile, setRevealFile] = useState<{ id: string; token: number } | null>(null);
  const [startSession, setStartSession] = useState<{ token: number; fileIds: string[] } | null>(null);
  /** Page labels from regions: the boxes drawn, on which pane's document, and its page text. */
  /** A saved drawing standard that fits the document just opened, offered until used or turned down. */
  const [suggestion, setSuggestion] = useState<{ fileId: string; standard: DrawingStandard; fit: number } | null>(null);
  const [labelMode, setLabelMode] = useState<{ pane: Pane; regions: Region[]; kind: 'label' | 'scale' | 'erase'; pages?: number[]; typed?: boolean; bookmarks?: boolean } | null>(null);
  const [labelTexts, setLabelTexts] = useState<PageText[] | null>(null);
  const regionRef = useRef<(rect: Region) => void>(() => {});
  const matchLineRef = useRef<(pane: Pane, pageIndex: number, p0: Point, p1: Point) => void>(() => {});
  const stitchRegionRef = useRef<(pane: Pane, pageIndex: number, points: Point[]) => void>(() => {});
  const portalDrawnRef = useRef<(pane: Pane, pageIndex: number, points: Point[]) => void>(() => {});
  const [portalDialog, setPortalDialog] = useState<PortalDialogState | null>(null);
  const matchLineEditedRef = useRef<(pane: Pane, id: string, p0: Point, p1: Point) => boolean>(() => false);
  const stitchDragRef = useRef<(pane: Pane, delta: Point, done: boolean) => void>(() => {});
  /** The Geospatial panel's handlers for drags and picks on the page (null while it is closed). */
  const geoHandlersRef = useRef<GeoHandlers | null>(null);
  /** The match line picked in the Stitching panel (drawn thicker; Move Sheet moves its sheet). */
  const [stitchSelected, setStitchSelected] = useState<string | null>(null);
  /** Move Sheet slides a sheet only along its match line. */
  const [stitchLockAlong, setStitchLockAlong] = useState(true);
  const [searchFocus, setSearchFocus] = useState(0);
  /** Opens a side panel on whichever side of the window it is docked. */
  const showPanel = (tab: LeftTab) => {
    if (panelSide(tab) === 'right') {
      setRightTab(tab);
      setRightOpen(true);
    } else {
      setLeftTab(tab);
      setLeftOpen(true);
    }
    if (tab === 'search') setSearchFocus((n) => n + 1);
  };
  /** Turns the side `tab` is docked on to it, unless that side is on a panel `keep` says to stay on. */
  const revealPanel = (tab: LeftTab, keep: (cur: LeftTab) => boolean, open = true) => {
    const side = panelSide(tab);
    (side === 'right' ? setRightTab : setLeftTab)((cur) => (keep(cur) && panelSide(cur) === side ? cur : tab));
    if (open) (side === 'right' ? setRightOpen : setLeftOpen)(true);
  };
  const busyPages = useJobRunning('pages');
  const searchHits = useRef<SearchHit[]>([]);
  const indexing = useJobRunning('index');
  const indexAbort = useRef<AbortController | null>(null);
  const openFileRef = useRef<HTMLInputElement>(null);
  const insertFileRef = useRef<HTMLInputElement>(null);
  const bulkInsertFileRef = useRef<HTMLInputElement>(null);
  const [bulkInsertFiles, setBulkInsertFiles] = useState<File[] | null>(null);
  /** Views to return to after following hyperlinks (Alt+Left). */
  const history = useRef<ViewState[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);
  /** Views Back left behind, for Forward (Alt+Right); cleared by any new navigation. */
  const future = useRef<ViewState[]>([]);
  const [canGoForward, setCanGoForward] = useState(false);
  const followLinkRef = useRef<(link: StoredLink) => void>(() => {});
  const previewLinkRef = useRef<(link: StoredLink) => void>(() => {});
  /** Previews of linked sheets and details, floating beside the plan (see LinkPreviews). */
  const [linkPreviews, setLinkPreviews] = useState<(LinkPreviewWindow & { link: StoredLink; fileId: string })[]>([]);
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
  /** A OneDrive session invite from the URL; joining opens Microsoft's sign-in, so it waits for a click. */
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
  const autoStitchA = useStitch(open?.store ?? null);
  const autoStitchB = useStitch(openB?.store ?? null);
  const manualStitchA = useManualStitch(open?.store ?? null);
  const manualStitchB = useManualStitch(openB?.store ?? null);
  const viewportsA = useViewports(open?.store ?? null);
  const viewportsB = useViewports(openB?.store ?? null);
  // The stitched groups shown: the match lines the user placed, then those found on the drawings.
  const stitchA = useMemo(() => mergeStitch(autoStitchA, withViewportRegions(manualStitchA, viewportsA)), [autoStitchA, manualStitchA, viewportsA]);
  const stitchB = useMemo(() => mergeStitch(autoStitchB, withViewportRegions(manualStitchB, viewportsB)), [autoStitchB, manualStitchB, viewportsB]);
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
  const assemblies = useAssemblies(activeStore);
  /** The assemblies with their catalog items filled in: what quantities are worked out from. */
  const takeoffAssemblies = useResolvedAssemblies(activeStore);
  const estimating = useEstimating(activeStore);
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
  /** Remove from Recents, Clear Recents: the documents stay on the device. */
  const removeFromRecents = useCallback((ids: string[]) => void hideFromRecents(ids).then(refreshLibrary).catch(console.error), [refreshLibrary]);

  /** A pane's markup tools. Every callback goes through refs or stable setters, so the effects creating them need no dependencies. */
  const createTools = (pane: Pane, viewer: TileViewer) => {
    const front = () => (pane === 'b' ? openBRef : openRef).current;
    return new MarkupTools(viewer, {
      author: () => authorRef.current,
      onEditText: setEditingText,
      onCalibrate: (pageIndex, lengthPoints, at, delta) => setCalibration({ pageIndex, lengthPoints, at, delta }),
      onScaleToLength: (pageIndex, points) => setScaleAsk({ pane, pageIndex, points }),
      onScaleRequired: (pageIndex, tool) => setScaleNeeded({ pane, pageIndex, tool }),
      measureDefaults: () => {
        // The assembly chosen in one document is not one of another's.
        const d = measureDefaultsRef.current;
        return d.assemblyId && !front()?.store.assemblies().some((a) => a.id === d.assemblyId) ? { ...d, assemblyId: undefined } : d;
      },
      manualQuantity: () => {
        const p = manualPendingRef.current;
        // The assembly chosen in one document is not one of another's.
        return p ? { ...p, assemblyId: p.assemblyId && front()?.store.assemblies().some((a) => a.id === p.assemblyId) ? p.assemblyId : undefined } : null;
      },
      onManualPlaced: () => {
        manualPendingRef.current = null;
      },
      onViewport: (pageIndex, rect) => viewportRef.current(pageIndex, rect),
      onFollowLink: (link) => followLinkRef.current(link),
      defaultFields: () => defaultFieldsFor(front()?.store),
      onCreated: recordRecent,
      onRegion: (_pageIndex, rect) => regionRef.current(rect),
      onMatchLine: (pageIndex, p0, p1) => matchLineRef.current(pane, pageIndex, p0, p1),
      onStitchRegion: (pageIndex, points) => stitchRegionRef.current(pane, pageIndex, points),
      onPortalDrawn: (pageIndex, points) => portalDrawnRef.current(pane, pageIndex, points),
      onMatchLineEdited: (id, p0, p1) => matchLineEditedRef.current(pane, id, p0, p1),
      onStitchDrag: (delta, done) => stitchDragRef.current(pane, delta, done),
      onGeoMoved: (dx, dy) => geoHandlersRef.current?.moved(dx, dy),
      onGeoPick: (target, p) => geoHandlersRef.current?.pick(target, p),
      onEditComment: (id) => setCommentEdit({ pane, id }),
      onEditHyperlink: (id) => setHyperlinkEdit({ pane, id }),
      onEditStamp: (id) => setStampEdit({ pane, id }),
      onNewTable: (draft) => setTableDraft({ pane, draft }),
      onEditTableCell: (id, row, col, text) => setEditingCell({ id, row, col, text }),
      onSpaceDrawn: (id) => nameSpaceRef.current(front(), id),
      onNotice: (text) => setNotice(text),
      onVisualSearch: (pageIndex, rect) => setVisualSearchBox({ pane, pageIndex, rect }),
      onCropArea: (_pageIndex, rect) => setPageTool({ kind: 'crop', drawnRect: rect }),
      onEraseContent: (pageIndex, rect, points) => eraseRef.current(pageIndex, rect, points),
      onEditPdfText: (pageIndex, at) => editTextRef.current(pageIndex, at),
      onFormField: (w) => formFieldRef.current(pane, w),
      onFormFieldDrawn: (pageIndex, rect) => formDrawnRef.current(pane, pageIndex, rect),
      onFollowHyperlink: (m) => followHyperlinkRef.current(m),
      requestImage: pickImage,
      defaultStamp: lastStamp,
      stampValues: (pageIndex) => stampValuesFor(front(), pageIndex),
      requestAttachment: pickAttachment,
      onOpenAttachment: openAttachment,
      onEditLabel: (id) => editLabelRef.current(pane, id),
      onSnapshot: (pageIndex, rect) => snapshotRef.current(pane, pageIndex, rect),
      onSnapshotPolygon: (pageIndex, points) => snapshotRef.current(pane, pageIndex, polygonBox(points), true, points),
      onCutContent: (pageIndex, rect, points) => {
        // The copy is made before the content is erased.
        void snapshotRef.current(pane, pageIndex, rect, false, points).then(() => eraseRef.current(pageIndex, rect, points));
      },
    });
  };

  useEffect(() => {
    const engine = new PdfEngine();
    const viewer = new TileViewer(canvasRef.current!, setStats);
    const tools = createTools('a', viewer);
    viewer.setOverlay(tools);
    setCtl({ engine, viewer, tools });
    // A renderer that crashes or stops answering is replaced, and the open documents reopened in it
    // from the copies kept on this device (markups live outside the renderer and are untouched).
    const tabOf = (doc: PdfDocument) => pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.doc === doc);
    const supervisor = new EngineSupervisor<PdfDocument>(engine, {
      bytesFor: async (doc) => {
        const tab = tabOf(doc);
        return tab ? readFile(tab.file.hash) : null;
      },
      sizeOf: (doc) => tabOf(doc)?.file.size,
      onRestarted: ({ lost }) => {
        viewer.engineRestarted();
        viewerBRef.current?.engineRestarted();
        resetThumbnails();
        setNotice(lost ? msg('The PDF renderer restarted. {lost} open {lost2, plural, one {document} other {documents}} could not be drawn again; close and reopen {value}.', { lost, lost2: lost, value: lost === 1 ? msg('it') : msg('them') }) : msg('The PDF renderer restarted.'));
      },
      onGaveUp: () => setNotice(msg('The PDF renderer stopped again. Use Retry on the page to restart it.')),
      log: (message, detail) => console.error(message, detail),
    });
    const retry = () => (supervisor.needsRetry ? supervisor.retry().then(() => undefined) : undefined);
    viewer.setRetryHandler(retry);
    retryRef.current = retry;
    // Debugging handle for the browser console and the end-to-end tests. `commands` are the live
    // commands by id; `assistant` answers the MCP tools (list_markups, get_page...) without asking.
    if (TEST_HOOK)
      Object.assign(window, {
        __nb: {
          engine,
          viewer,
          get viewerB() {
            return viewerBRef.current;
          },
          tools,
          commands: () => commandsRef.current,
          assistant: (method: string, params: unknown) => {
            const env = assistantRuntime.current;
            return assistantCall(env.documents(), method, params, { ...env, confirm: async () => true });
          },
        },
      });
    return () => {
      supervisor.dispose();
      tools.dispose();
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
    viewer.setRetryHandler(retryRef.current ?? null);
    viewerBRef.current = viewer;
    return () => {
      viewerBRef.current = null;
      tools.dispose();
      viewer.destroy();
      setCtlB(null);
    };
  }, [split, ctl]);

  const ctlOf = (pane: Pane) => (pane === 'b' ? ctlB : ctl);
  const openRefOf = (pane: Pane) => (pane === 'b' ? openBRef : openRef);
  const tabsRefOf = (pane: Pane) => (pane === 'b' ? tabsBRef : tabsARef);
  const paneParts = (pane: Pane) => ({ c: ctlOf(pane), o: openRefOf(pane).current });

  /** The pane whose tab list holds a pane's documents: a mirrored right pane has no tabs, its document's tab is in the left pane. */
  const tabPaneOf = (pane: Pane): Pane => (pane === 'b' && mirrorRef.current ? 'a' : pane);

  const setTabs = useCallback((pane: Pane, tabs: OpenTab[]) => {
    (pane === 'b' ? tabsBRef : tabsARef).current = tabs;
    (pane === 'b' ? setTabsB : setTabsA)(tabs);
  }, []);

  /** Replaces a tab's document in whichever pane's tab list holds it (the mirror can end while an edit is in flight); false if none does. */
  const replaceTab = useCallback(
    (cur: OpenFile, next: OpenFile) => {
      let replaced = false;
      for (const p of ['a', 'b'] as const) {
        const tabs = (p === 'b' ? tabsBRef : tabsARef).current;
        if (!tabs.includes(cur)) continue;
        setTabs(p, tabs.map((t) => (t === cur ? next : t)));
        replaced = true;
      }
      return replaced;
    },
    [setTabs],
  );

  /** The pane's front document, in its ref and its state. */
  const setFront = useCallback((pane: Pane, packed: OpenFile | null) => {
    (pane === 'b' ? openBRef : openRef).current = packed;
    (pane === 'b' ? setOpenB : setOpen)(packed);
  }, []);
  /** The pane's front 3D model, in its ref and its state. */
  const setFrontModel = useCallback((pane: Pane, model: OpenModel | null) => {
    (pane === 'b' ? modelBRef : modelARef).current = model;
    (pane === 'b' ? setModelB : setModelA)(model);
  }, []);
  /** The tab in front of a pane, whether a PDF or a 3D model. */
  const frontTabOf = (pane: Pane): OpenTab | null => (pane === 'b' ? openBRef.current ?? modelBRef.current : openRef.current ?? modelARef.current);

  /** Puts a document (or nothing) in front in a pane, remembering where the previous one was scrolled. */
  const showInPane = useCallback(
    (pane: Pane, tab: OpenTab | null, follow = false) => {
      const c = pane === 'b' ? ctlB : ctl;
      const cur = openRefOf(pane).current;
      const curModel = (pane === 'b' ? modelBRef : modelARef).current;
      // A mirrored right pane's view is not what the left pane saved for the same document.
      const mirrored = pane === 'b' && mirrorRef.current;
      if ((cur ?? curModel) === tab) return;
      // A 3D model takes the pane instead of a PDF; the PDF viewer is left empty behind it.
      const packed = pdfOf(tab);
      const model = tab?.kind === 'model' ? tab : null;
      if (pane === 'b' && !follow) mirrorRef.current = false;
      if (tab) recentOpenIds.current = touchRecent(recentOpenIds.current, tab.file.id);
      if (cur && c && !mirrored) savedViews.current.set(cur.file.id, c.viewer.getView());
      // Mirroring shows the left pane's PDF on the right too; a model is not mirrored.
      if (pane === 'a' && mirrorRef.current && packed && ctlB) showInPane('b', packed, true);
      setFrontModel(pane, model);
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
      c.tools.setSnapSource(async (pageIndex) => {
        const g = await packed.doc.geometry(pageIndex);
        return new SnapIndex(g.segments, undefined, g.curves);
      });
      c.tools.setTextSource((pageIndex) => packed.doc.text(pageIndex));
      const view = savedViews.current.get(packed.file.id);
      // View rotation belongs to each document: one not shown before starts unrotated.
      c.viewer.setDocument(packed.doc, view?.rotation ?? 0);
      // A stitched view's camera only makes sense with its stitch layout, so just return to its page.
      if (view?.mode === 'stitch') c.viewer.goToPage(view.pageIndex);
      else if (view) c.viewer.setView(view);
      else applyPageLayout(c.viewer, packed.doc);
    },
    [ctl, ctlB],
  );

  /** Brings a tab to the front of its pane. */
  const activateTab = useCallback(
    (pane: Pane, packed: OpenTab) => {
      if (pane === 'b') setSplit(true);
      setActivePane(pane);
      showInPane(pane, packed);
    },
    [showInPane],
  );

  const disposeOpen = (o: OpenTab) => {
    savedViews.current.delete(o.file.id);
    if (o.kind === 'model') {
      o.view.dispose();
      return;
    }
    void o.doc.close();
    void o.store.destroy();
    releaseFor(o.store);
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
      // The new tab goes just after the one in front.
      const insert = (tab: OpenTab) => {
        const tabs = pane === 'b' ? tabsBRef.current : tabsARef.current;
        const front = frontTabOf(pane);
        const at = front ? tabs.indexOf(front) + 1 : tabs.length;
        setTabs(pane, [...tabs.slice(0, at), tab, ...tabs.slice(at)]);
        activateTab(pane, tab);
      };
      // A 3D model (Experimental) opens in the 3D viewer, which loads only now.
      if (isModelFile(file)) return insert({ kind: 'model', file, view: openModelView(file, bytes) });
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
      insert({ file, doc, store });
      if (pane === 'a' && settings.get().showThumbnailsOnOpen) {
        // Off (the default), the side panel stays as the user left it. On: stay on Sessions, Sets or Search
        // when opening from them (or joining from an invite link). On narrow screens the panel covers the
        // drawing, so it opens only when asked.
        revealPanel('pages', (tab) => tab === 'sessions' || tab === 'projects' || tab === 'sets' || tab === 'search', !narrowScreen());
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
      await job(cur, abort.signal, (p) => progress(p.done, p.total, INDEX_PHASES()[p.phase]));
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
        // A Project's owner may have chosen a standard for all its files: everyone's copy reads with it.
        const projectLink = linkOf(cur.file.id);
        const fromProject = standardOfProject(projectLink ? projectById(projectLink.projectId)?.getSnapshot().manifest.standard : undefined);
        if (fromProject) adoptStandard(fromProject);
        if (fromProject && !cur.store.drawingStandard() && !cur.store.readOnly && !cur.store.declinedStandards().includes(fromProject.id)) cur.store.setDrawingStandard({ id: fromProject.id, hash: '' });
        // A drawing standard changed since the document was read with it reads the sheets again.
        const standard = standardOf(cur.store);
        const stale = !!standard && cur.store.drawingStandard()?.hash !== standardHash(standard) && !cur.store.readOnly;
        if (stale) cur.store.setDrawingStandard({ id: standard.id, hash: standardHash(standard) });
        if (stale || Object.keys(cur.store.allSheets()).length === 0) await indexFromText(await fresh(), cur.store, report, signal, standard ?? undefined);
        if (!cur.store.annotationsImported()) {
          // A Project file whose markups are already shared takes them from there, not from its PDF.
          const link = linkOf(cur.file.id);
          const project = link ? projectById(link.projectId) : null;
          const shared = link && project ? await project.hasSharedMarkups(link.fileId).catch(() => false) : false;
          await importPdfAnnotations(fresh, cur.store, report, signal, shared ? fromOtherTools : undefined);
          cur.store.setImageMarkupsChecked();
          await hideImported(cur.doc, cur.store);
          ctl?.viewer.clearCache();
          // Detected links that duplicate imported ones are dropped on re-detection.
          await linkFromText(fresh, cur.store, report, signal, standard ?? undefined);
        } else if (!cur.store.imageMarkupsChecked()) {
          // An earlier import may have stored Bluebeam image markups as empty rectangles.
          await repairSquareImages(fresh, cur.store, signal);
          cur.store.setImageMarkupsChecked();
          ctl?.viewer.clearCache();
          if (!cur.store.linksDetected()) await linkFromText(fresh, cur.store, report, signal, standard ?? undefined);
        } else if (!cur.store.linksDetected()) {
          await linkFromText(fresh, cur.store, report, signal, standard ?? undefined);
        }
        // Markups other tools made, read by an older importer: read again those not edited since.
        if (!cur.store.readOnly && cur.store.annotationsImported() && cur.store.importVersion() < IMPORT_VERSION) {
          const found = await readPdfAnnotations(await fresh(), cur.store, report, signal);
          cur.store.refreshImported(found.markups.filter(fromOtherTools), IMPORT_VERSION);
          ctl?.viewer.clearCache();
        }
        // Marks taught since this document was last searched (or ever, for a new set).
        const marks = marksFor(cur.store);
        const searched = cur.store.marksSearched();
        if (marks.some((m) => !searched.includes(m.id))) await linkFromMarks(fresh, cur.store, marks, report, signal, standard?.links);
        // Documents imported before maps were read: read the file for them once.
        if (!cur.store.geoChecked()) await readGeoRegions(await fresh(), cur.store);
        if (!cur.store.outlineImported()) cur.store.importOutline(outlineBookmarks(await cur.doc.outline()));
        if (!cur.store.stitchDetected()) await stitchFromText(fresh, cur.store, report, signal);
        // A set read with no standard may be one a saved standard fits: suggest it, once.
        if (!cur.store.drawingStandard() && !cur.store.readOnly) {
          const declined = cur.store.declinedStandards();
          const candidates = profiles.active().state.drawingStandards.map(withDefaults).filter((s) => !declined.includes(s.id) && (s.sheets.template || s.identify.length));
          if (candidates.length) {
            const pages = await loadPageTexts(fresh, cur.store, report, signal);
            const best = candidates.map((s) => ({ standard: s, fit: standardFit(pages, s.sheets, s.identify) ?? 0 })).sort((a, b) => b.fit - a.fit)[0];
            if (best && best.fit >= SUGGEST_FIT) setSuggestion({ fileId: cur.file.id, ...best });
          }
        }
      }),
    [runIndexJob, ctl],
  );

  const redetectLinks = useCallback(
    (doc: OpenFile | null = openRef.current) =>
      runIndexJob(doc, async (cur, signal, report) => {
        const standard = standardOf(cur.store);
        await linkFromText(() => readFile(cur.file.hash), cur.store, report, signal, standard ?? undefined);
        // Sheet numbers may have changed, so taught marks may now resolve to other sheets.
        const marks = marksFor(cur.store);
        if (marks.length || cur.store.marksSearched().length) await linkFromMarks(() => readFile(cur.file.hash), cur.store, marks, report, signal, standard?.links);
      }),
    [runIndexJob],
  );

  /** Looks for the taught marks in a document again (after teaching or forgetting one); `announce` says how many links wait for review. */
  const findTaughtMarks = useCallback(
    (doc: OpenFile | null = openRef.current, announce = false) =>
      runIndexJob(doc, async (cur, signal, report) => {
        await linkFromMarks(() => readFile(cur.file.hash), cur.store, marksFor(cur.store), report, signal, standardOf(cur.store)?.links);
        if (!announce) return;
        const review = cur.store.allLinks().filter((l) => l.id.startsWith('mark-') && l.status === 'review').length;
        setNotice(review ? msg('{review, plural, one {# link} other {# links}} from taught marks to review in the Links tab.', { review }) : msg('No marks like it were found in this document.'));
      }),
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

  followLinkRef.current = (link: StoredLink) => (settings.get().linkClick === 'jump' ? navigate(link.targetPage, link.targetRect) : previewLinkRef.current(link));
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
        await indexFromText(await readFile(cur.file.hash), cur.store, report, signal, standardOf(cur.store) ?? undefined);
        await stitchFromText(() => readFile(cur.file.hash), cur.store, report, signal);
      }),
    [runIndexJob],
  );

  /** Reads a document's sheets with a drawing standard (or none: from the text alone), then its links again. */
  const readWithStandard = useCallback(
    (doc: OpenFile | null, chosen: DrawingStandard | null) =>
      runIndexJob(doc, async (cur, signal, report) => {
        const standard = chosen && withDefaults(chosen);
        // None, chosen by a person: the standard it had is not suggested again (nor reapplied from its Project).
        const before = cur.store.drawingStandard();
        if (!standard && before) cur.store.declineStandard(before.id);
        cur.store.setDrawingStandard(standard ? { id: standard.id, hash: standardHash(standard) } : null);
        await indexFromText(await readFile(cur.file.hash), cur.store, report, signal, standard ?? undefined);
        // Sheet numbers may have changed, so taught marks may now resolve to other sheets; the standard brings its own.
        const marks = marksFor(cur.store);
        if (marks.length || cur.store.marksSearched().length) await linkFromMarks(() => readFile(cur.file.hash), cur.store, marks, report, signal, standard?.links);
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
          setNotice(msg('{name} was protected. This device keeps it unprotected so it can be worked on; Document › Security saves a protected copy.', { name }));
          return open;
        } catch (err) {
          if (!(err instanceof Error) || err.message !== NEEDS_PASSWORD) throw err;
          const typed = await askText(attempt ? msg('Wrong password') : msg('Password'), '', { label: msg('{name} is protected. Type its password to open it.', { name }), confirm: msg('Open'), password: true });
          if (typed === null) throw new Error(msg('{name} was not opened: it needs its password.', { name }));
          password = typed;
        }
      }
    },
    [ctl],
  );

  /** Set once `takeHostContents` is made (below, after what it uses). */
  const takeHostContentsRef = useRef<(file: StoredFile, bytes: ArrayBuffer) => Promise<StoredFile>>(async (file) => file);

  const openNewFile = useCallback(
    async (f: File | File[], target: Pane = 'a') => {
      for (const file of Array.isArray(f) ? f : [f]) {
        try {
          // Pictures open as one-page PDFs at their real size; DWG/DXF drawings as vector PDFs.
          const cad = isCadFile(file);
          const image = !cad && isImageFile(file);
          const conversion = cad ? await convertFile(file) : null;
          const raw = image || cad ? null : await file.arrayBuffer();
          // IFC models are kept as they are, for the 3D viewer.
          const bytes = conversion ? conversion.pdf : image ? await imageToPdf(file) : isModelFile(file) ? raw! : await unlockBytes(raw!, file.name);
          const name = cad ? pdfNameFor(file.name) : image ? file.name.replace(/\.[^.]+$/, '') + '.pdf' : file.name;
          // A document moved from another window with no file of its own has nowhere to save back to.
          const moved = movedFiles.get(file);
          const source = moved && !moved.hasFile ? undefined : handleOf(file);
          // The engine takes ownership of the buffer it is given, so store a copy first.
          const hostId = cad ? null : hostDocumentId(tokenOf(source));
          let stored = await saveFile(name, bytes.slice(0), hostId ?? undefined);
          // An embedding application's document, opened again with other contents (saved over
          // since, say): they come in as a change to it, so its markups and open tab follow.
          if (hostId && stored.hash !== (await contentHash(bytes))) stored = await takeHostContentsRef.current(stored, bytes.slice(0));
          // Save writes back over the file it came from, except pictures, drawings and protected
          // PDFs (which are kept unprotected here and must not replace the original).
          if (source && bytes === raw) await rememberHandle(stored.id, source);
          if (moved?.dirty) movedDirty.add(stored.id);
          await openStored(stored, bytes, target);
          if (conversion) cadSession.set(stored.id, conversion);
        } catch (err) {
          if (isAbort(err)) continue;
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      void refreshLibrary();
    },
    [openStored, refreshLibrary, unlockBytes],
  );

  /** Converts the drawing behind a converted PDF again (other pages, line options or reference files), opening the result as a new PDF. */
  const convertAgain = useCallback(
    async (fileId: string, options: CadOptions, references: CadFile[]) => {
      const entry = cadSession.get(fileId);
      if (!entry) return;
      setCadBusy(true);
      try {
        const conversion = await convertAsJob(entry.conversion.source, options, references);
        settings.set({ cadColorMode: options.colorMode ?? 'auto', cadLineweights: options.lineweights ?? true });
        const stored = await saveFile(pdfNameFor(entry.conversion.source.name), conversion.pdf.slice(0));
        await openStored(stored, conversion.pdf, split && activePaneRef.current === 'b' ? 'b' : 'a');
        cadSession.set(stored.id, conversion);
        setCadAgain(null);
        void refreshLibrary();
      } catch (err) {
        if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err));
      } finally {
        setCadBusy(false);
      }
    },
    [openStored, refreshLibrary, split],
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
      const ids = (tabs: OpenTab[]) => tabs.filter((t) => !studioDocOf(t.file.id)).map((t) => t.file.id);
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
        const tabs = pdfTabs([...tabsARef.current, ...tabsBRef.current]);
        const parts: ArrayBuffer[] = [];
        for (const src of sources) {
          if (src.kind === 'open') {
            const tab = tabs.find((t) => t.file.id === src.id);
            if (!tab) throw new Error(msg('{name} is no longer open.', { name: src.name }));
            const bytes = await annotatedBytes(tab);
            parts.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
          } else {
            parts.push(isCadFile(src.file) ? (await convertFile(src.file)).pdf : isImageFile(src.file) ? await imageToPdf(src.file) : await unlockBytes(await src.file.arrayBuffer(), src.file.name));
          }
        }
        const [first, ...rest] = parts;
        if (!first) return;
        // Each insert lands past the end, so the documents follow each other in order.
        const combined = rest.length ? await ctl.engine.editPdf(first, rest.map((_, i) => ({ type: 'insert' as const, source: i, at: Number.MAX_SAFE_INTEGER })), rest) : first;
        await openCreated(name, combined);
      } catch (err) {
        setError(msg('Combine failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
          // A file moved, renamed or deleted on disk since is not opened from here: Save would
          // write it back where it was. Opened from its new place, it finds its markups again.
          if (await movedAway(file.id)) {
            if (confirm(msg('"{name}" is no longer in its folder. It may have been moved, renamed or deleted, so it was not opened. Open it from where it is now with File › Open.\n\nRemove it from the recent files?', { name: file.name }))) removeFromRecents([file.id]);
            return;
          }
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
    [openStored, activateTab, refreshLibrary, removeFromRecents, split, activePane],
  );

  /** Follows a link to a comment (clicked on an item number in a register): opens its document, then goes to the comment. */
  const openMarkupLink = useCallback(
    async (link: MarkupLink) => {
      const file = linkedFile(await listFiles(), link);
      if (!file) {
        setNotice(msg('The document this link is for{value} is not in the library on this device.', { value: link.name ? ` (${link.name})` : '' }));
        return;
      }
      setPendingLink({ fileId: file.id, markupId: link.markup, since: Date.now() });
      await openFromLibrary(file);
    },
    [openFromLibrary],
  );
  const openMarkupLinkRef = useRef(openMarkupLink);
  openMarkupLinkRef.current = openMarkupLink;
  useEffect(() => {
    if (!ctl || !libraryReady) return;
    const follow = (links: readonly unknown[]) => {
      // One at a time: the last link clicked is the one that shows.
      const link = checkMarkupLink(links[links.length - 1] as MarkupLink | undefined);
      if (link) void openMarkupLinkRef.current(link);
    };
    // The web app is opened at a link's address; the desktop app is handed the link.
    const inAddress = parseMarkupQuery(window.location.search);
    if (inAddress) {
      stripMarkupQuery();
      follow([inAddress]);
    }
    const host = desktop();
    void host?.takeMarkupLinks?.().then(follow, () => undefined);
    return host?.onMarkupLinks?.(follow);
    // Once, when the viewer and the library are ready.
  }, [ctl, libraryReady]);

  useEffect(() => {
    if (restoredTabs.current || !ctl || !libraryReady) return;
    restoredTabs.current = true;
    // A document opened by the launch (a file, a share, a link) is all that opens.
    if (openRef.current) return;
    let saved: { a?: string[]; b?: string[] } = {};
    // A refresh of the page always brings back what was open, so nothing seems to vanish; a fresh
    // start reopens it only when Preferences says to.
    if (settings.get().restoreTabs || pageWasReloaded()) {
      try {
        saved = JSON.parse(localStorage.getItem('nb.openTabs') ?? '{}') ?? {};
      } catch {
        // Nothing to reopen.
      }
    }
    const find = (id: string) => library.find((f) => f.id === id);
    // Preferences › Options › Open PDF on Startup opens in front of the reopened tabs.
    const startup = find(settings.get().startupFile);
    // Read before reopening, which records each tab as it comes to the front.
    const active = savedTabs().active;
    void (async () => {
      const reopened: StoredFile[] = [];
      for (const [pane, ids] of [
        ['a', saved.a ?? []],
        ['b', saved.b ?? []],
      ] as const)
        for (const id of ids) {
          const file = find(id);
          if (!file) continue;
          await openFromLibrary(file, pane);
          reopened.push(file);
        }
      const front = startup ?? (reopened.find((f) => f.id === active));
      if (front && (startup || reopened.length > 1)) await openFromLibrary(front, 'a');
      if (settings.get().documentRecovery) {
        const recovered = recoveredDocs();
        const names = [...reopened, ...(startup ? [startup] : [])].filter((f, i, all) => recovered.has(f.id) && all.indexOf(f) === i).map((f) => f.name);
        if (names.length) setNotice(msg('Recovered changes not yet saved to {names}.', { names: names.join(', ') }));
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
    if (moving) {
      moveTabRef.current('a', moving);
      setActivePane('a');
    }
    const mirror = pendingMirror.current;
    pendingMirror.current = false;
    if (mirror && openRef.current) {
      // One document in both panes (one markup store, two views). Views start independent unless
      // Preferences › Document says to synchronise them; Synchronise in the View menu toggles it anytime.
      mirrorRef.current = true;
      showInPane('b', openRef.current, true);
      setSync(settings.get().syncSplitView ? 'document' : null);
      setActivePane('a');
    }
  }, [ctlB, openStored, showInPane]);

  useEffect(() => {
    if (!split) {
      mirrorRef.current = false;
      splitOrigin.current = null;
      pendingMirror.current = false;
    }
  }, [split]);

  // Load the library (the tabs are reopened above, as Preferences › Options says).
  const restored = useRef(false);
  useEffect(() => {
    if (!ctl || restored.current) return;
    restored.current = true;
    void refreshLibrary();
  }, [ctl, refreshLibrary]);

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
      // The same sheets laid out a little differently (a nudge, an edited line) keep the view where it is.
      if (group && c.viewer.updateStitch(group.placements)) continue;
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
      if (!ctlOf(pane)) {
        void next.doc.close();
        return;
      }
      await hideImported(next.doc, cur.store);
      const replaced = replaceTab(cur, next);
      // Every pane showing this document, by file (a mirrored right pane has no tab to find it by). A tab
      // that is not in front anywhere only has its tab entry replaced.
      const showing = (['a', 'b'] as const).filter((p) => ctlOf(p) && openRefOf(p).current?.file.id === cur.file.id);
      if (!replaced && !showing.length) {
        // The tab was closed while the edit ran (which closed `cur`'s document): drop the new one.
        void next.doc.close();
        return;
      }
      for (const p of showing) {
        const { tools, viewer } = ctlOf(p)!;
        setFront(p, next);
        tools.setSnapSource(async (pageIndex) => {
          const g = await next.doc.geometry(pageIndex);
          return new SnapIndex(g.segments, undefined, g.curves);
        });
        tools.setTextSource((pageIndex) => next.doc.text(pageIndex));
        const view = viewer.getView();
        viewer.setDocument(next.doc);
        if (keep === 'view') viewer.setView(view);
        else viewer.goToPage(keep(view.pageIndex));
      }
      void cur.doc.close();
    },
    [ctl, ctlB, replaceTab, setFront],
  );

  /**
   * Replaces an open document's file with `edited` and reopens it in place; its markups stay.
   * `remap` runs once the new file is stored (to move markups with their pages, or to note what is
   * already known about the new contents), and `pageFor` says which page to show given the one
   * that was showing. `edited` is transferred to the PDF engine. The change is one undo step,
   * `label` in the Undo History (a Live Session's shared file is not undone here).
   */
  const swapDocument = useCallback(
    async (cur: OpenFile, intoB: boolean, edited: ArrayBuffer, remap?: (file: StoredFile) => void, pageFor: (was: number) => number = (was) => was, label = 'Change document') => {
      const pane: Pane = intoB ? 'b' : 'a';
      if (!ctl || !ctlOf(pane)) return;
      if (settings.get().restrictSignedChanges) assertKeepsSignatures(await readFile(cur.file.hash), edited);
      // The contents before stay stored while undo can return to them.
      if (!studioDocOf(cur.file.id)) holdFor(cur.store, [cur.file.hash]);
      // Session documents live in the session, not the library: only cached on this device.
      const file = studioDocOf(cur.file.id)
        ? await (async () => {
            const hash = await cacheFile(edited);
            rememberStudioHash(cur.file.id, hash);
            return { ...cur.file, hash, size: edited.byteLength };
          })()
        : await replaceFileContent(cur.file.id, edited);
      if (studioDocOf(cur.file.id)) remap?.(file);
      else {
        holdFor(cur.store, [file.hash]);
        cur.store.fileStep(label, cur.file.hash, file.hash, () => remap?.(file));
      }
      forgetText(cur.file.id);

      // Both writes above have finished with `edited`, so the engine can take it.
      const doc = await ctl.engine.open(edited);
      await reopenInPane(cur, pane, { file, doc, store: cur.store }, pageFor);
      void refreshLibrary();
    },
    [ctl, ctlB, refreshLibrary, reopenInPane],
  );

  /**
   * Undo or redo stepped over a change to a document's file: its contents become those stored under
   * `hash` again and the tab reopens on them. Steps in quick succession (Undo History) settle on the
   * last one.
   */
  const fileWanted = useRef(new Map<MarkupStore, string>());
  const restoreFile = useCallback(
    async (store: MarkupStore, hash: string) => {
      const wanted = fileWanted.current;
      const busy = wanted.has(store);
      wanted.set(store, hash);
      if (busy || !ctl) return;
      try {
        for (;;) {
          const want = wanted.get(store)!;
          const inA = pdfTabs(tabsARef.current).find((t) => t.store === store);
          const tab = inA ?? pdfTabs(tabsBRef.current).find((t) => t.store === store);
          if (!tab || tab.file.hash === want) break;
          const bytes = await readFile(want);
          const file = await replaceFileContent(tab.file.id, bytes);
          forgetText(tab.file.id);
          // The write above has finished with `bytes`, so the engine can take them.
          const doc = await ctl.engine.open(bytes);
          await reopenInPane(tab, inA ? 'a' : 'b', { file, doc, store }, (was) => Math.min(was, doc.pages.length - 1));
        }
      } catch (err) {
        setError(msg('Could not bring the document back as it was: {value}', { value: err instanceof Error ? err.message : String(err) }));
      } finally {
        wanted.delete(store);
        void refreshLibrary();
      }
    },
    [ctl, refreshLibrary, reopenInPane],
  );
  const restoreFileRef = useRef(restoreFile);
  restoreFileRef.current = restoreFile;
  useEffect(() => {
    MarkupStore.onFileRestored = (store, hash) => void restoreFileRef.current(store, hash);
    return () => {
      MarkupStore.onFileRestored = null;
    };
  }, []);

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
      if (tabsARef.current.includes(cur)) return swapDocument(cur, false, edited, remap, undefined, stepLabel(revisionNote));
      if (tabsBRef.current.includes(cur)) return swapDocument(cur, true, edited, remap, undefined, stepLabel(revisionNote));
      if (settings.get().restrictSignedChanges) assertKeepsSignatures(await readFile(cur.file.hash), edited);
      remap?.(await replaceFileContent(cur.file.id, edited));
      forgetText(cur.file.id);
    },
    [swapDocument],
  );

  /** `attach` adds to the markups' remap, in the same undo step (pasted pages' own markups). */
  const applyPageOps = useCallback(
    async (ops: PageOp[], inserts: ArrayBuffer[] = [], attach?: (store: MarkupStore) => void) => {
      const intoB = activePaneRef.current === 'b';
      const cur = intoB ? openBRef.current : openRef.current;
      const tools = intoB ? ctlB?.tools : ctl?.tools;
      const viewer = intoB ? ctlB?.viewer : ctl?.viewer;
      if (!cur || !ctl || !tools || !viewer) return;
      if (studioDocOf(cur.file.id)) {
        setError(msg('Pages of a Live Session document cannot be changed: everyone in the session shares the same file.'));
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
          () => {
            cur.store.remapPages(plan, oldSizes);
            attach?.(cur.store);
          },
          (was) => plan.oldToNew[was] ?? 0,
          pageOpsLabel(ops),
        );
        // Inserted pages have no sheet information yet; the tab now holds the new file.
        if (ops.some((op) => op.type === 'insert')) void detectSheetsOffline(openRefOf(intoB ? 'b' : 'a').current);
      } catch (err) {
        setError(msg('Page operation failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
        progress(k, pages.length, msg('Page {number}: rendering', { number: p + 1 }));
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
        progress(k, pages.length, msg('Page {number}: reading text ({number2} of {count})', { number: p + 1, number2: k + 1, count: pages.length }));
        words.set(p, await recognise(image, scale));
      }
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      progress(pages.length, pages.length, msg('Adding the text'));
      const bytes = await addTextLayer(await readFile(cur.file.hash), words);
      await commitDocument(cur, bytes.slice().buffer, undefined, revisionNote);
      return [...words.values()].reduce((n, l) => n + l.length, 0);
    },
    [commitDocument],
  );

  const runOcr = useCallback(
    async (cur: OpenFile, pages: number[], dpi: number) => {
      if (studioDocOf(cur.file.id)) {
        setError(msg('A Live Session document is shared with others, so its content cannot be changed here.'));
        return;
      }
      try {
        const count = await runJob(`OCR · ${cur.file.name}`, (ctx) => ocrDocument(cur, pages, dpi, ctx));
        setNotice(msg('OCR found {count, plural, one {# word} other {# words}} on {count2, plural, one {# page} other {# pages}}; they can now be searched and selected.', { count, count2: pages.length }));
      } catch (err) {
        if (isAbort(err)) setNotice(msg('OCR cancelled; the document was not changed.'));
        else setError(msg('OCR failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
      if (!ctl) throw new Error(msg('The PDF engine is not ready'));
      const tab = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === fileId);
      if (tab) return { open: tab, release: () => {} };
      const file = (await listFiles()).find((f) => f.id === fileId);
      if (!file) throw new Error(msg('That document is no longer in the library'));
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

  /**
   * New contents for an embedding application's document (desktop/embedHost.ts), brought in the
   * way a Project revision is: the contents before are kept as a revision, markups this app wrote
   * into the file stay hidden (the store has them), other tools' markups are imported.
   */
  const takeHostContents = useCallback(
    async (file: StoredFile, bytes: ArrayBuffer): Promise<StoredFile> => {
      const { open, release } = await acquireDocument(file.id);
      try {
        const found = await readPdfAnnotations(bytes.slice(0), open.store);
        await commitDocument(open, bytes, () => open.store.importAnnotations(found.markups.filter(fromOtherTools), found.links, found.imported, found.extras), `Before reopening from the embedding application`);
      } finally {
        release();
      }
      return (await listFiles()).find((f) => f.id === file.id) ?? file;
    },
    [acquireDocument, commitDocument],
  );
  takeHostContentsRef.current = takeHostContents;

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

  /** Live handle to a library page for Align Pages / Select Region (crisp zoomed tiles + Snap to Content). */
  const openPickerPage = useCallback(
    async (fileId: string, page: number): Promise<PickerPageHandle> => {
      const { open, release } = await acquireDocument(fileId);
      const index = Math.min(Math.max(0, page), open.doc.pages.length - 1);
      const size = open.doc.pages[index]!;
      let snapPromise: Promise<SnapIndex> | null = null;
      return {
        width: size.width,
        height: size.height,
        renderTile: async (scale, x, y, width, height, signal) => {
          const { bitmap } = await open.doc.renderTile(index, scale, x, y, width, height, { signal, thinLines: settings.get().thinLines });
          return bitmap;
        },
        snapIndex: () => {
          if (!snapPromise) {
            snapPromise = open.doc.geometry(index).then((g) => new SnapIndex(g.segments, undefined, g.curves));
          }
          return snapPromise;
        },
        release,
      };
    },
    [acquireDocument],
  );

  /** Adds a file picked from the user's computer to the library without opening a tab, returning its ID. */
  const importLibraryFile = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const cad = isCadFile(file);
        const image = !cad && isImageFile(file);
        const conversion = cad ? await convertFile(file) : null;
        const raw = image || cad ? null : await file.arrayBuffer();
        const bytes = conversion ? conversion.pdf : image ? await imageToPdf(file) : await unlockBytes(raw!, file.name);
        const name = cad ? pdfNameFor(file.name) : image ? file.name.replace(/\.[^.]+$/, '') + '.pdf' : file.name;
        const source = handleOf(file);
        const hostId = cad ? null : hostDocumentId(tokenOf(source));
        let stored = await saveFile(name, bytes.slice(0), hostId ?? undefined);
        if (hostId && stored.hash !== (await contentHash(bytes))) stored = await takeHostContentsRef.current(stored, bytes.slice(0));
        if (source && bytes === raw) await rememberHandle(stored.id, source);
        if (conversion) cadSession.set(stored.id, conversion);
        await refreshLibrary();
        return stored.id;
      } catch (err) {
        if (isAbort(err)) return null;
        throw err;
      }
    },
    [refreshLibrary, unlockBytes],
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
        progress(k, all.length, msg('Reading sheets: {value}', { value: library.find((f) => f.id === id)?.name ?? '' }));
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
          const done = await runJob('Bulk Compare', async (ctx) => {
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
          const crowded = done.reduce((n, r) => n + r.pages.filter((p) => p.found).length, 0);
          if (!done.length) {
            setNotice(msg('No sheets in the two sets matched.'));
            return;
          }
          setNotice(msg('Bulk Compare: {sheets, plural, one {# sheet} other {# sheets}} in {count, plural, one {# pair} other {# pairs}} of files, {found, plural, one {# difference} other {# differences}} clouded.{value} Showing the pair with the most.', { sheets, count: done.length, found, value: crowded ? ' ' + msg('{crowded, plural, one {# sheet} other {# sheets}} had too many to mark one by one and were grouped; they may not line up.', { crowded }) : '' }));
          // Ranked by what was found, not what one page keeps.
          const weight = (r: (typeof done)[number]) => r.pages.reduce((m, p) => m + (p.found ?? p.differences.length), 0);
          const most = done.reduce((a, b) => (weight(b) > weight(a) ? b : a));
          setCompareResults(most);
          await sideBySideRef.current(most.oldId, most.newId);
        } catch (err) {
          if (isAbort(err)) setNotice(msg('Bulk Compare cancelled.'));
          else setError(msg('Bulk Compare failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      try {
        const results = await runJob('Compare Documents', (ctx) => compareFiles(spec, ctx));
        setCompareResults(results);
        await sideBySideRef.current(results.oldId, results.newId);
      } catch (err) {
        if (isAbort(err)) setNotice(msg('Compare cancelled.'));
        else setError(msg('Compare failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
              progress(k, pairs.length, msg('{pageLabelFor}: lining up ({number} of {count})', { pageLabelFor: pageLabelFor(n, pair.newPage), number: k + 1, count: pairs.length }));
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
        const made = await runJob(spec.batch ? 'Bulk Overlay' : 'Overlay Pages', async (ctx) => {
          const { overlayPages, rgbOf } = await import('./documents/overlay');
          if (spec.batch) {
            // Every pair of files stacked into one PDF.
            const groups = await pairBatch(spec.batch, spec.pairing.kind !== 'order', ctx);
            if (!groups.length) throw new Error(msg('No sheets in the two sets matched'));
            const pages: OverlayPageSpec[] = [];
            const sources = [];
            for (let g = 0; g < groups.length; g++) {
              const { oldId, newId, pairs } = groups[g]!;
              const plan = await overlayPlan({ ...spec, oldId, newId, pairing: { kind: 'list', pairs } }, partOf(ctx, g, groups.length, library.find((f) => f.id === newId)?.name ?? ''), g * 2);
              pages.push(...plan.pages);
              sources.push({ bytes: await readFile(plan.oldFile.hash), color: rgbOf(spec.colors.old) }, { bytes: await readFile(plan.newFile.hash), color: rgbOf(spec.colors.new) });
            }
            ctx.progress(1, 1, msg('Making the overlay'));
            const bytes = await overlayPages(sources, pages);
            return { name: `Bulk Overlay ${new Date().toISOString().slice(0, 10)}.pdf`, bytes, count: pages.length };
          }
          const plan = await overlayPlan(spec, ctx);
          ctx.progress(1, 1, msg('Making the overlay'));
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
        setNotice(msg('Overlaid {count, plural, one {# page} other {# pages}}: dark lines are in both revisions, coloured lines only in the revision drawn in that colour.', { count: made.count }));
      } catch (err) {
        if (isAbort(err)) setNotice(msg('Overlay cancelled.'));
        else setError(msg('Overlay failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
      }
    },
    [overlayPlan, pairBatch, library, openCreated],
  );

  /**
   * Redaction and Erase Content: the content under the areas is removed from the file (text,
   * lines and shapes, picture pixels). Redaction also covers the areas in black and removes the
   * redaction marks and any markups over them. Afterwards the pages' text is read again to check
   * nothing is left inside the areas. Bulk Redact (`erase`) can take only the text, cover
   * the areas, and delete markups in them.
   */
  const redactPages = useCallback(
    async (
      { signal, progress }: JobContext,
      cur: OpenFile,
      intoB: boolean,
      mode: 'redact' | 'erase',
      areas: { pageIndex: number; rect: { x: number; y: number; w: number; h: number }; polygon?: Point[] }[],
      options?: RedactOptions,
      erase?: Pick<EraseRegionsSpec, 'textOnly' | 'cover' | 'removeMarkups'>,
    ) => {
      if (!ctl || !areas.length) return;
      const regions = [...new Set(areas.map((a) => a.pageIndex))].map((pageIndex) => {
        const here = areas.filter((a) => a.pageIndex === pageIndex);
        const polygons = here.filter((a) => a.polygon).map((a) => a.polygon!.map(([x, y]) => ({ x, y })));
        return { pageIndex, rects: here.filter((a) => !a.polygon).map((a) => a.rect), ...(polygons.length ? { polygons } : {}) };
      });
      const redacting = mode === 'redact';
      const hex = options?.fill ?? erase?.cover ?? '#000000';
      const n = parseInt(hex.slice(1), 16);
      const fill: [number, number, number] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      const covering = redacting || !!erase?.cover;
      progress(0, regions.length, 'Starting');
      const redacted = await ctl.engine.redact(
        await readFile(cur.file.hash),
        {
          regions,
          fill: covering ? fill : null,
          imageFill: covering ? fill : [1, 1, 1],
          ...(redacting && options?.text ? { overlayText: options.text, overlayTextColor: contrastOn(hex) } : {}),
          ...(erase?.textOnly ? { textOnly: true } : {}),
        },
        { signal, onProgress: (done, total) => progress(done, total, `Page ${regions[done]!.pageIndex + 1} (${done + 1} of ${total})`) },
      );
      progress(regions.length, regions.length, msg('Saving the redacted document'));
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
      const gone = redacting ? cur.store.all().filter((m) => m.type === 'redaction' || overlaps(m)) : erase?.removeMarkups ? cur.store.all().filter(overlaps) : [];
      await swapDocument(cur, intoB, bytes, () => gone.length && cur.store.remove(gone.map((m) => m.id)), undefined, redacting ? 'Redact' : 'Erase content');
      // Search matches that were redacted no longer exist.
      if (redacting) {
        searchHits.current = [];
        (intoB ? ctlB : ctl)?.tools.setHighlights([]);
      }
      // Verify: no words left inside the areas.
      const doc = (intoB ? openBRef.current : openRef.current)?.doc;
      let left = 0;
      let checked = 0;
      for (const { pageIndex } of regions) {
        const here = areas.filter((a) => a.pageIndex === pageIndex);
        progress(checked++, regions.length, msg('Checking page {page} for text left inside ({checked} of {count})', { page: pageIndex + 1, checked, count: regions.length }));
        const words = (await doc?.text(pageIndex)) ?? [];
        // The overlay's own label is not left-over text.
        const label = new Set((options?.text ?? '').split(/\s+/).filter(Boolean));
        left += words.filter((w) => {
          if (redacting && label.has(w.text)) return false;
          const cx = (w.x0 + w.x1) / 2;
          const cy = (w.y0 + w.y1) / 2;
          return here.some(({ rect: r, polygon }) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h && (!polygon || pointInPolygon([cx, cy], polygon)));
        }).length;
      }
      const what = `${report.chars} character${report.chars === 1 ? '' : 's'}, ${report.paths} line${report.paths === 1 ? '' : 's'} or shape${report.paths === 1 ? '' : 's'}, ${report.images} picture${report.images === 1 ? '' : 's'}`;
      const markupNote = gone.filter((m) => m.type !== 'redaction').length ? msg(', and {count} markup(s) over them', { count: gone.filter((m) => m.type !== 'redaction').length }) : '';
      const onPages = erase ? ` on ${regions.length} page${regions.length === 1 ? '' : 's'}` : '';
      if (left || report.skipped) setError(msg('{value} removed {what}{markupNote}{onPages}, but {value2}{value3}. Check the file before sharing it.', { value: redacting ? msg('Redaction') : msg('Erase'), what, markupNote, onPages, value2: left ? msg('{left} word(s) can still be read inside the areas', { left }) : msg('{skipped} item(s) inside embedded forms could not be removed', { skipped: report.skipped }), value3: covering ? ' ' + msg('(they are covered by the box)') : '' }));
      else setNotice(msg('{value}: removed {what}{markupNote}{onPages}. Checked: no text is left in the {value2} areas.', { value: redacting || erase ? msg('Redacted') : msg('Erased'), what, markupNote, onPages, value2: redacting || erase ? msg('redacted') : msg('erased') }));
    },
    [ctl, ctlB, swapDocument],
  );

  /** `redactPages` as a job, so a large document shows its progress and can be cancelled before it is changed. */
  const runRedact = useCallback(
    async (cur: OpenFile, intoB: boolean, mode: 'redact' | 'erase', areas: Parameters<typeof redactPages>[4], options?: RedactOptions, erase?: Parameters<typeof redactPages>[6]) => {
      if (!ctl || !areas.length) return;
      if (studioDocOf(cur.file.id)) throw new Error(msg('A Live Session document is shared with others, so its content cannot be changed here.'));
      if (!(await rewriteSigned(cur.doc, mode === 'redact' ? 'Redaction' : 'Erase Content'))) return;
      const pages = new Set(areas.map((a) => a.pageIndex)).size;
      try {
        await runJob(`${mode === 'redact' ? 'Redact' : 'Bulk Redact'} · ${cur.file.name}`, (ctx) => redactPages(ctx, cur, intoB, mode, areas, options, erase), { ...PAGES_JOB, cancellable: true, shown: pages > 1 });
      } catch (err) {
        if (!isAbort(err)) throw err;
        setNotice(msg('{value} cancelled; the document was not changed.', { value: mode === 'redact' ? msg('Redaction') : msg('Erase') }));
      }
    },
    [ctl, redactPages],
  );
  /** Edit Text: the text object clicked is shown, its new text asked for, and replaced in the file. */
  editTextRef.current = (pageIndex, at) => {
    const cur = activeOpen;
    const c = paneB ? ctlB : ctl;
    if (!cur || !c || !ctl) return;
    if (studioDocOf(cur.file.id)) {
      setError(msg('A Live Session document is shared with others, so its content cannot be changed here.'));
      return;
    }
    void (async () => {
      const obj = await cur.doc.textObjectAt(pageIndex, at[0], at[1]);
      if (!obj) {
        // Clicking where there is no text adds new text to the page there.
        const text = await askText(msg('Add Text'), '', { label: msg('New text for the page (Helvetica, 10 pt; Enter a line break as \\n). It becomes part of the PDF, not a markup.'), confirm: msg('Add') });
        if (!text) return;
        const bytes = await ctl.engine.addText(await readFile(cur.file.hash), pageIndex, at[0], at[1], text.replace(/\\n/g, '\n'));
        await swapDocument(cur, paneB, bytes, undefined, undefined, 'Add text');
        return;
      }
      c.tools.flash(pageIndex, obj.rect);
      const text = await askText(msg('Edit text'), obj.text, { label: msg('Text'), confirm: msg('Replace') });
      if (text === null || text === obj.text) return;
      const { bytes, keptFont } = await ctl.engine.replaceText(await readFile(cur.file.hash), pageIndex, obj.index, text);
      await swapDocument(cur, paneB, bytes, undefined, undefined, 'Edit text');
      if (!keptFont) setNotice(msg('The text\'s own font does not have all the new characters, so it is set in Helvetica.'));
    })().catch((err) => setError(msg('Edit text failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
  };
  eraseRef.current = (pageIndex, rect, polygon) => {
    const cur = activeOpen;
    if (cur) void runRedact(cur, paneB, 'erase', [{ pageIndex, rect, ...(polygon ? { polygon } : {}) }]).catch((err) => setError(msg('Erase failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
  };

  /** Flatten, Unflatten, Repair, Reduce File Size and Colour Processing (Document menu). */
  const processDocument = useCallback(
    async ({ signal, progress }: JobContext, cur: OpenFile, spec: ProcessSpec | { kind: 'unflatten' } | { kind: 'repair' }, revisionNote?: string): Promise<string | null> => {
      // Called between items of the long ones: a cancel stops the work before the file is changed.
      const stopped = () => {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      };
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
          return msg('Flattened {count, plural, one {# markup} other {# markups}}{value}.', { count, value: spec.recovery ? msg('; Document › Unflatten brings them back') : '' });
        }
        case 'unflatten': {
          const { bytes, recovery } = await p.unflatten(await readFile(cur.file.hash));
          if (recovery === null) return msg('This file has no flattened markups to recover.');
          const markups = JSON.parse(recovery) as Markup[];
          const kept = cur.store.all().filter((m) => !markups.some((r) => r.id === m.id));
          await commitDocument(cur, bytes.slice().buffer, () => cur.store.resetMarkups([...kept, ...markups]), revisionNote);
          return msg('Recovered {count, plural, one {# markup} other {# markups}}.', { count: markups.length });
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
          const { bytes, images } = await p.reduceFileSize(await readFile(cur.file.hash), recompress, (done, total) => {
            stopped();
            progress(done, total, msg('Picture {number} of {total}', { number: done + 1, total }));
          });
          if (bytes.length >= before) return msg('The file is already as small as this can make it.');
          await commitDocument(cur, bytes.slice().buffer, undefined, revisionNote);
          const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
          return msg('Reduced from {mb} to {mb2}{value}.', { mb: mb(before), mb2: mb(bytes.length), value: images ? ' ' + msg('({images, plural, one {# picture} other {# pictures}} recompressed)', { images }) : '' });
        }
        case 'colour': {
          const bytes = await p.recolourPages(await readFile(cur.file.hash), spec.pages, spec.mode, recolourJpeg, (done, total, phase) => {
            stopped();
            progress(done, total, phase === 'pages' ? `Page ${spec.pages[done]! + 1} (${done + 1} of ${total})` : msg('Picture {number} of {total}', { number: done + 1, total }));
          });
          stopped();
          await commitDocument(cur, bytes.slice().buffer, undefined, revisionNote);
          return msg('Changed the colours of {count, plural, one {# page} other {# pages}}.', { count: spec.pages.length });
        }
      }
    },
    [ctl, commitDocument],
  );

  /** `processDocument` as a job, so the longer ones show progress and can be cancelled before the file is changed. */
  const runProcess = useCallback(
    async (cur: OpenFile, spec: Parameters<typeof processDocument>[2], revisionNote?: string): Promise<string | null> => {
      if (studioDocOf(cur.file.id)) throw new Error(msg('A Live Session document is shared with others, so it cannot be changed here.'));
      const rewrites: Partial<Record<typeof spec.kind, string>> = { repair: 'Repair', reduce: msg('Reduce File Size'), colour: 'Colour Processing' };
      const rewriting = rewrites[spec.kind];
      if (rewriting && !(await rewriteSigned(cur.doc, rewriting))) return null;
      const title = { flatten: 'Flatten', unflatten: 'Unflatten', repair: 'Repair', reduce: msg('Reduce File Size'), colour: 'Colour Processing' }[spec.kind];
      try {
        return await runJob(`${title} · ${cur.file.name}`, (ctx) => processDocument(ctx, cur, spec, revisionNote), { ...PAGES_JOB, cancellable: spec.kind === 'reduce' || spec.kind === 'colour' });
      } catch (err) {
        if (!isAbort(err)) throw err;
        return msg('{title} cancelled; the document was not changed.', { title });
      }
    },
    [processDocument],
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
        setError(msg('Pages of a Live Session document cannot be changed: everyone in the session shares the same file.'));
        return;
      }
      // The Slip Sheet job below shows progress; this one keeps page operations off until the end.
      const job = startJob('Slip Sheet', { ...PAGES_JOB, shown: false });
      try {
        const report = await runJob(msg('Slip Sheet · {name}', { name: cur.file.name }), async ({ signal, progress }) => {
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
              if (src.kind === 'library' && !stored) throw new Error(msg('{name} is no longer in the library', { name }));
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
            if (!plan.replace.length && !plan.add.length) return { plan, labelOf, left: 0 };
            // Comments on the sheets being replaced: the revision they were raised on is the one going out,
            // and the closed ones stay with it when asked.
            const replaced = new Set(plan.replace.map((r) => r.target));
            const before = cur.store.all();
            const raised = raisedRevisions(before, cur.store.allSheets(), replaced);
            const behind = spec.leaveClosed ? closedComments(before, replaced, closedStatuses(closeOutTemplateOf(cur.store))) : [];

            const moves = new Map<number, { scale: number; dx: number; dy: number }>();
            if (spec.alignMarkups)
              for (let k = 0; k < plan.replace.length; k++) {
                cancelled();
                const r = plan.replace[k]!;
                progress(k, plan.replace.length, msg('Lining up {labelOf}', { labelOf: labelOf(r.incoming) }));
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
            const note = `Before Slip Sheet: ${[...replacedLabels, ...plan.add.map(labelOf)].slice(0, 6).join(', ')}${plan.replace.length + plan.add.length > 6 ? '…' : ''}`;
            // The revision kept is the stored file, which has no markups in it. Comments left behind are
            // written into the copy that is kept, so they can still be read there.
            if (behind.length) await keepRevisionOf(cur.file.id, (await annotatedBytes(cur)).slice().buffer, msg('{note} (with its markups: {count} closed {count2, plural, one {comment} other {comments}} left behind)', { note, count: behind.length, count2: behind.length }));
            else await keepRevision(cur.file.id, note);
            const first = cur.doc.pages.length;
            await swapDocument(cur, intoB, bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0), () => {
              cur.store.forgetImported(plan.replace.map((r) => r.target));
              cur.store.batch(() => {
                for (const [id, raisedRev] of raised) cur.store.update(id, { raisedRev });
                cur.store.remove(behind.map((m) => m.id));
              });
              cur.store.transformPages(moves);
              // The replaced sheets are the new revision now.
              cur.store.setDetectedSheets(plan.replace.flatMap((r) => (opened[r.incoming.source]!.sheets[r.incoming.page] ? [[r.target, opened[r.incoming.source]!.sheets[r.incoming.page]!] as [number, SheetInfo]] : [])));
              cur.store.setDetectedSheets(plan.add.flatMap((p, k) => (opened[p.source]!.sheets[p.page] ? [[first + k, opened[p.source]!.sheets[p.page]!] as [number, SheetInfo]] : [])));
            }, undefined, 'Slip Sheet');
            return { plan, labelOf, left: behind.filter((m) => !cur.store.get(m.id)).length };
          } finally {
            for (const o of opened) void o.doc.close();
          }
        });
        const { plan, labelOf, left } = report;
        const list = (items: IncomingPage[]) => items.slice(0, 8).map(labelOf).join(', ') + (items.length > 8 ? ` and ${items.length - 8} more` : '');
        const parts = [
          plan.replace.length ? `replaced ${plan.replace.length} sheet${plan.replace.length === 1 ? '' : 's'} (${list(plan.replace.map((r) => r.incoming))})` : '',
          plan.add.length ? `added ${plan.add.length} (${list(plan.add)})` : '',
          plan.skipped.length ? msg('left out {count} with no match ({list})', { count: plan.skipped.length, list: list(plan.skipped) }) : '',
          left ? `left ${left} closed comment${left === 1 ? '' : 's'} behind` : '',
        ].filter(Boolean);
        setNotice(plan.replace.length || plan.add.length ? msg('Slip Sheet {parts}. The set as it was is kept under Document › Revisions.', { parts: parts.join('; ') }) : msg('Slip Sheet found no matching sheets{value}.', { value: parts.length ? `: ${parts.join('; ')}` : '' }));
        void refreshLibrary();
      } catch (err) {
        if (isAbort(err)) setNotice(msg('Slip Sheet cancelled; the document was not changed.'));
        else setError(msg('Slip Sheet failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
      } finally {
        job.end();
      }
    },
    [ctl, swapDocument, refreshLibrary, registerTemplates, closeOutTemplate],
  );

  /** Revisions: a kept version made the document's contents again (the current one is kept too). */
  const restoreRevision = useCallback(
    async (fileId: string, r: FileRevision) => {
      try {
        await keepRevision(fileId, `Before restoring the version of ${new Date(r.savedAt).toLocaleString()}`);
        const bytes = await readFile(r.hash);
        const inA = pdfTabs(tabsARef.current).find((t) => t.file.id === fileId);
        const inB = pdfTabs(tabsBRef.current).find((t) => t.file.id === fileId);
        const tab = inA ?? inB;
        if (tab) {
          await swapDocument(tab, !inA, bytes, () => {
            tab.store.forgetImported(tab.doc.pages.map((_, i) => i));
          }, undefined, 'Restore revision');
        } else {
          await replaceFileContent(fileId, bytes);
          forgetText(fileId);
        }
        setNotice(msg('Restored. The version before it is kept as a revision.'));
        void refreshLibrary();
      } catch (err) {
        setError(msg('Restore failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
      if (o && !studioDocOf(o.file.id)) drawingSets.setIndex(o.file.id, { pageCount: o.doc.pages.length, sheets: o.doc.pages.map((_, i) => (indexEntry(sheets[i]))) });
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
              drawingSets.setIndex(file.id, { pageCount: doc.pages.length, sheets: doc.pages.map((_, i) => (indexEntry(sheets[i]))) });
            } finally {
              held.release();
            }
          }
        });
      } catch (err) {
        if (!isAbort(err)) setError(msg('Reading sheets failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
        setError(msg('That file is no longer in the library.'));
        return;
      }
      // Preferences › Sets › Open Documents (Open Edited Documents, when the one in front has unsaved
      // changes): in place, a sheet of the same set opens instead of the document in front.
      const pane = activePaneRef.current;
      const front = frontTabOf(pane);
      const prefs = settings.get();
      const alreadyOpen = [...tabsARef.current, ...tabsBRef.current].some((t) => t.file.id === fileId);
      const sameSet = !!front && drawingSets.get().some((s) => s.entries.some((e) => e.fileId === front.file.id) && s.entries.some((e) => e.fileId === fileId));
      const edited = !!front && !studioDocOf(front.file.id) && hasUnsavedChanges(front);
      const replace = !alreadyOpen && sameSet && front!.file.id !== fileId && (edited ? prefs.setOpenEdited : prefs.setOpenDocuments) === 'inPlace' ? front : null;
      await openFromLibrary(file);
      const viewer = openBRef.current?.file.id === fileId && activePaneRef.current === 'b' ? ctlB?.viewer : openRef.current?.file.id === fileId ? ctl?.viewer : ctlB?.viewer;
      viewer?.goToPage(page);
      if (replace) await closeTabRef.current(pane, replace.file.id);
    },
    [library, openFromLibrary, ctl, ctlB],
  );
  openSetSheetRef.current = openSetSheet;

  /** Sets › Show preview of PDF: a small picture of a sheet, made once per sheet and kept for the visit. */
  const setPreviews = useRef(new Map<string, Promise<string | null>>());
  const setSheetPreview = useCallback(
    (fileId: string, page: number): Promise<string | null> => {
      const key = `${fileId}:${page}`;
      let p = setPreviews.current.get(key);
      if (!p) {
        p = (async () => {
          const held = await acquireDocument(fileId);
          try {
            const size = held.open.doc.pages[page];
            if (!size) return null;
            const scale = 220 / Math.max(size.width, size.height);
            const w = Math.max(1, Math.round(size.width * scale));
            const h = Math.max(1, Math.round(size.height * scale));
            const { bitmap } = await held.open.doc.renderTile(page, scale, 0, 0, w, h);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            return canvas.toDataURL('image/png');
          } finally {
            held.release();
          }
        })().catch(() => null);
        setPreviews.current.set(key, p);
      }
      return p;
    },
    [acquireDocument],
  );

  /**
   * Sets: follows up new revisions (Preferences › Sets › Sorting): the earlier sheet's markups copied
   * to the later one (with flattened ones recovered first, and burned into the page after if asked),
   * and the earlier one stamped Superseded.
   */
  const followUpRevisions = useCallback(
    async (setId: string, pairs: { key: string; earlier: SetSheet; later: SetSheet }[]) => {
      const prefs = settings.get();
      if (!prefs.setCopyMarkups && !prefs.setStampSuperseded) {
        drawingSets.markRevised(setId, pairs.map((p) => p.key));
        return;
      }
      const done: string[] = [];
      let copied = 0;
      let stamped = 0;
      try {
        await runJob('Revisions', async ({ progress }) => {
          for (const [k, { key, earlier, later }] of pairs.entries()) {
            progress(k, pairs.length, later.fileName);
            const a = await acquireDocument(earlier.fileId);
            const b = await acquireDocument(later.fileId);
            try {
              if (prefs.setCopyMarkups && !b.open.store.readOnly) {
                let source = a.open.store.forPage(earlier.page);
                if (prefs.setUnflatten) {
                  const { unflatten } = await import('./documents/process');
                  const { recovery } = await unflatten(await readFile(a.open.file.hash));
                  const flattened = recovery ? (JSON.parse(recovery) as Markup[]).filter((m) => m.pageIndex === earlier.page && !source.some((s) => s.id === m.id)) : [];
                  source = [...source, ...flattened];
                }
                source = source.filter((m) => m.type !== 'hyperlink' && !(m.type === 'stamp' && m.subject === 'Superseded'));
                if (source.length) {
                  const from = a.open.doc.pages[earlier.page]!;
                  const to = b.open.doc.pages[later.page]!;
                  const sx = to.width / from.width;
                  const sy = to.height / from.height;
                  const now = Date.now();
                  const groups = new Map<string, string>();
                  const copies: Markup[] = source.map(({ pdfAnnot: _link, ...m }, i) => ({
                    ...structuredClone(m),
                    id: crypto.randomUUID(),
                    pageIndex: later.page,
                    points: m.points.map(([x, y]) => [x * sx, y * sy] as [number, number]),
                    groupId: m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)!) : undefined,
                    locked: undefined,
                    createdAt: now + i,
                    modifiedAt: now + i,
                  }));
                  const store = b.open.store;
                  store.checkpoint();
                  store.batch(() => copies.forEach((m) => store.add(m)));
                  copied += copies.length;
                  if (prefs.setFlattenAfter) {
                    const fresh = copies.map(({ replies: _replies, checked: _checked, ...m }) => ({ ...m, status: 'none' as const }));
                    const { exportWithAnnotations } = await import('@nb/markup/export');
                    const fonts = await fontExport(fresh);
                    const exported = await exportWithAnnotations(await readFile(b.open.file.hash), fresh, { scaleFor: (i) => store.scaleFor(i), viewports: store.allViewports(), ...(fonts.systemFonts ? { systemFonts: fonts.systemFonts } : {}), onFontFallback: fonts.onFontFallback });
                    fonts.done();
                    const { flattenSelection } = await import('./documents/process');
                    const { bytes } = await flattenSelection(exported, new Set(fresh.map((m) => m.id)), {});
                    await commitDocument(b.open, bytes.slice().buffer, () => store.removeFlattened(copies.map((m) => m.id), {}), `Before flattening markups copied from the earlier revision`);
                  }
                }
              }
              if (prefs.setStampSuperseded && !a.open.store.readOnly) {
                const def = stampLibrary(profiles.active().state).find((s) => s.id === 'builtin-superseded')!;
                const size = a.open.doc.pages[earlier.page]!;
                const now = Date.now();
                const content = resolveStamp(def, { user: authorRef.current, now: new Date(now), ...stampValuesFor(a.open, earlier.page) });
                const w = Math.min(216, size.width - 72);
                const h = w / stampAspect(content);
                a.open.store.add({
                  id: crypto.randomUUID(),
                  type: 'stamp',
                  pageIndex: earlier.page,
                  points: [
                    [size.width - 36 - w, 36],
                    [size.width - 36, 36 + h],
                  ],
                  style: { ...DEFAULT_STYLES.stamp, stroke: stampColor(def), width: 2 },
                  stamp: content,
                  subject: def.name,
                  status: 'none',
                  author: authorRef.current,
                  createdAt: now,
                  modifiedAt: now,
                });
                stamped++;
              }
              done.push(key);
            } finally {
              a.release();
              b.release();
            }
          }
        });
      } catch (err) {
        if (!isAbort(err)) setError(msg('Following up revisions failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
      } finally {
        drawingSets.markRevised(setId, done);
      }
      const parts = [copied ? msg('copied {copied, plural, one {# markup} other {# markups}} to the new {count, plural, one {revision} other {revisions}}', { copied, count: done.length }) : '', stamped ? `stamped ${stamped} earlier revision${stamped === 1 ? '' : 's'} Superseded` : ''].filter(Boolean);
      if (parts.length) setNotice(msg('Sets: {parts}.', { parts: parts.join('; ') }));
    },
    [acquireDocument, commitDocument],
  );

  /** What the Search panel had found, kept while it is closed. */
  const searchMemory = useRef<SearchMemory | null>(null);
  const openSearchHitRef = useRef(openSearchHit);
  openSearchHitRef.current = openSearchHit;
  /** Shows a match from the Search panel, first bringing its document to the front (opening it if need be). */
  const openDocSearchHit = async (hit: DocHit, sameDoc: DocHit[], file?: File) => {
    const front = (activePaneRef.current === 'b' ? openBRef.current : openRef.current)?.file.id;
    if (front !== hit.docId) {
      const known = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === hit.docId)?.file ?? library.find((f) => f.id === hit.docId);
      if (known) await openFromLibrary(known);
      else if (file) await openNewFile(file, split && activePaneRef.current === 'b' ? 'b' : 'a');
      else return setError(msg('That file is no longer in the library.'));
      // The document comes to the front of its pane on the next render.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    if (hit.pageIndex < 0) return;
    searchHits.current = sameDoc.filter((h) => h.pageIndex >= 0);
    openSearchHitRef.current(hit);
  };

  /**
   * The Batch menu: a document command run over library files one at a time (open ones in their
   * tabs, the rest headless), reporting each file's result. Auto-Link Sheets works on the files together.
   */
  const runBatch = useCallback(
    async (spec: BatchSpec, onResult: (r: BatchResult) => void) => {
      const label = batchLabel(spec.command.kind);
      // Revision notes are kept in English: they are stored with the file, and stepLabel reads them back.
      const note = spec.keepRevisions ? `Before Bulk ${BATCH_ENGLISH[spec.command.kind]}` : undefined;
      const nameOf = (id: string) => library.find((f) => f.id === id)?.name ?? id;
      const fail = (fileId: string, err: unknown) => onResult({ fileId, name: nameOf(fileId), ok: false, message: err instanceof Error ? err.message : String(err) });
      try {
        await runJob(msg('Bulk {operation}', { operation: label }), async (ctx) => {
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
                onResult({ fileId: f.fileId, name: f.name, ok: true, message: mine.length ? `${mine.length} link${mine.length === 1 ? '' : 's'} to ${targets.join(', ')}` : msg('No references to the other files') });
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
          // An ID on a card is checked by the card at the first signature (its PIN is sent with each).
          let signer: { id: import('./documents/digitalIds').UnlockedId | import('./documents/pdfSign').Signer; image?: Uint8Array } | null = null;
          if (command.kind === 'sign') {
            const record = digitalIds.list().find((r) => r.id === command.sign.idId);
            if (!record) throw new Error(msg('That Digital ID is no longer on this device'));
            const id = (await import('./documents/signers')).signerFor(record, command.sign.password);
            if (!record.token) rememberPassword(record.id, command.sign.password);
            const picture = command.sign.imageId ? signatures.get().find((x) => x.id === command.sign.imageId) : undefined;
            signer = { id, ...(picture ? { image: new Uint8Array(await (await fetch(picture.image)).arrayBuffer()) } : {}) };
          }
          const stampDef = command.kind === 'stamp' ? stampLibrary(profiles.active().state).find((x) => x.id === command.stampId) : null;
          if (command.kind === 'stamp' && !stampDef) throw new Error(msg('That stamp is no longer in the library'));
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
              if (command.kind !== 'summary' && command.kind !== 'print' && command.kind !== 'split' && studioDocOf(cur.file.id)) throw new Error(msg('A Live Session document is shared with others, so it cannot be changed here.'));
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
                  const rows = withThreads(buildRows(all, ctxCells, {}, null), ctxCells);
                  const text = (r: (typeof rows)[number], key: string) => {
                    if (key === '__id') return r.reply?.id ?? r.markup.id;
                    if (key === '__parent') return r.reply?.parentId ?? '';
                    const v = r.cells[key];
                    let t = v?.error ? `#${v.error}` : (v?.text ?? '');
                    if (key === 'subject' && r.reply) t = `${'> '.repeat(r.reply.depth)}${t}`;
                    return t;
                  };
                  if (command.format === 'csv') {
                    const lines = rowsToCsv(rows, cols, true).split('\r\n');
                    const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
                    if (!csv.length) csv.push(`File,${lines[0]}`);
                    for (const line of lines.slice(1)) csv.push(`${cell(cur.file.name)},${line}`);
                  } else if (command.format === 'xml') {
                    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    xml.push(`  <File name="${esc(cur.file.name)}" pages="${cur.doc.pages.length}">`);
                    for (const r of rows) {
                      const parent = r.reply?.parentId ?? '';
                      xml.push(`    <Markup id="${esc(r.reply?.id ?? r.markup.id)}"${parent ? ` parent="${esc(parent)}"` : ''} type="${esc(r.reply ? 'reply' : r.markup.type)}" page="${r.markup.pageIndex + 1}">`);
                      for (const c of cols) {
                        const v = text(r, c.key);
                        if (v) xml.push(`      <Column name="${esc(c.label)}">${esc(v)}</Column>`);
                      }
                      xml.push('    </Markup>');
                    }
                    xml.push('  </File>');
                  } else {
                    const rel = [
                      { key: '__id', label: 'ID', width: 140 },
                      { key: '__parent', label: msg('Parent'), width: 140 },
                    ];
                    summaryCols = [...rel, ...cols.map((c) => ({ key: c.key, label: c.label, width: c.defaultWidth, ...(c.align ? { align: c.align } : {}) }))];
                    for (const r of rows) summaryRows.push({ cells: [cur.file.name, ...summaryCols.map((c) => text(r, c.key))], color: r.reply ? undefined : r.markup.style.stroke });
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
                    message = msg('Every page already has text');
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
                      style: { ...DEFAULT_STYLES.stamp, stroke: stampColor(def), width: 2 },
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
                  if (!crops.size) throw new Error(msg('Nothing would be left of the pages: use smaller margins.'));
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
                  const base = cur.file.name.replace(/\.pdf$/i, '');
                  const folder = base.replace(/[\\/:*?"<>|]+/g, '-').trim();
                  const parts = await tools.splitDocument(await annotatedBytes(cur), base, cur.store.bookmarks(), command);
                  for (const p of parts) splitParts.push({ name: `${folder}/${p.name}`, data: p.data });
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
                  const original = new Uint8Array(await readFile(cur.file.hash));
                  // Signed anyway (the batch was asked for), but said: scripts can change what a signed file shows.
                  const active = await (await import('./documents/activeContent')).activeContentWarning(original);
                  const signed = await signPdf(original, signer!.id, {
                    ...(area ? { area } : {}),
                    ...(c.reason ? { reason: c.reason } : {}),
                    ...(c.location ? { location: c.location } : {}),
                    ...(c.certify ? { certify: c.certify } : {}),
                    ...(signer!.image ? { image: signer!.image } : {}),
                    digest: settings.get().signatureAlgorithm,
                    format: settings.get().signatureFormat,
                    ...(c.timestampUrl ? { timestamp: async (value: Uint8Array) => (await import('./documents/pki')).fetchTimestamp(c.timestampUrl!, value, pkiFetch) } : {}),
                  });
                  const { bytes, note: ltvNote } = c.ltv ? await withLtv(signed) : { bytes: signed, note: null };
                  await commitDocument(cur, bytes.slice().buffer, undefined, note);
                  message = `Signed${c.certify ? ' and certified' : ''}${c.timestampUrl ? ', time stamped' : ''}${c.ltv && bytes !== signed ? ', LTV' : ''}${ltvNote ? `. ${ltvNote}` : ''}${active ? '. Warning: it has active content (JavaScript or Launch actions)' : ''}`;
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
                    message = msg('No sheet numbers found');
                    break;
                  }
                  const [{ PDFDocument }, { writePageLabels }] = await Promise.all([import('pdf-lib'), import('@nb/markup/export')]);
                  const pdf = await PDFDocument.load(await readFile(cur.file.hash), { updateMetadata: false });
                  writePageLabels(pdf, labels);
                  await commitDocument(cur, (await pdf.save()).slice().buffer, undefined, note);
                  drawingSets.setIndex(cur.file.id, { pageCount: cur.doc.pages.length, sheets: cur.doc.pages.map((_, i) => (indexEntry(sheets[i]))) });
                  message = `${n} of ${allPages.length} page${allPages.length === 1 ? '' : 's'} labelled (${labels.filter(Boolean).slice(0, 3).join(', ')}${n > 3 ? '…' : ''})`;
                  break;
                }
                case 'removeHeaderFooter': {
                  const { hasHeaderFooter, removeHeaderFooter } = await import('./documents/headerFooter');
                  const bytes = await readFile(cur.file.hash);
                  if (!(await hasHeaderFooter(bytes))) {
                    message = msg('No headers or footers added here');
                    break;
                  }
                  await commitDocument(cur, (await removeHeaderFooter(bytes)).slice().buffer, undefined, note);
                  message = msg('Headers and footers removed');
                  break;
                }
                case 'colour':
                  message = (await runProcess(cur, { kind: 'colour', mode: command.mode, pages: cur.doc.pages.map((_, i) => i) }, note)) ?? 'Done';
                  break;
                case 'flatten':
                  if (!cur.store.all().some((m) => m.type !== 'hyperlink')) {
                    message = msg('No markups to flatten');
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
              title: msg('Markup Summary'),
              subtitle: `${spec.fileIds.length} file${spec.fileIds.length === 1 ? '' : 's'} · ${summaryRows.length} row${summaryRows.length === 1 ? '' : 's'} · ${new Date().toLocaleString()} by ${authorRef.current}`,
              columns: [{ label: msg('File'), width: 160 }, ...summaryCols.map(({ key: _, ...c }) => c)],
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
        if (!isAbort(err)) setError(msg('Bulk {label} failed: {value}', { label, value: err instanceof Error ? err.message : String(err) }));
        else setNotice(msg('Bulk {label} cancelled; files already done keep their changes.', { label }));
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
  /** `rethrow`: a failure goes back to the caller (a dialog that shows it and stays open) instead of the error bar. */
  const editForm = useCallback(
    (fileId: string, what: string, edit: (bytes: ArrayBuffer) => Promise<Uint8Array | { bytes: Uint8Array; model: FormModel }>, revisionNote?: string, rethrow = false): Promise<boolean> => {
      const run = formQueue.current
        .then(async () => {
          const cur = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === fileId);
          if (!cur) return false;
          if (studioDocOf(fileId)) throw new Error(msg('A Live Session document is shared with others, so it cannot be changed here.'));
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
          if (rethrow) throw err;
          setError(msg('{what} failed: {error}', { what, error: err instanceof Error ? err.message : String(err) }));
          return false;
        });
      // The queue carries on after a failure.
      formQueue.current = run.catch(() => false);
      return run;
    },
    [commitDocument],
  );

  const fillFields = useCallback(
    (fileId: string, values: Record<string, string>) =>
      editForm(fileId, msg('Filling in the form'), async (bytes) => (await import('./documents/forms')).fillForm(bytes, values, { validate: true })),
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
          showPanel('signatures');
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
        else setError(msg('The button’s address is not a web address: {url}', { url: a.url }));
        return;
      case 'page':
        navigate(Math.min(a.pageIndex, o.doc.pages.length - 1), null);
        return;
      case 'reset':
        void editForm(o.file.id, msg('Resetting the form'), async (bytes) => (await import('./documents/forms')).resetForm(bytes));
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
          window.open(`${a.url}${a.url.includes('?') ? '&' : '?'}subject=${encodeURIComponent(msg('Form data: {name}', { name: o.file.name }))}&body=${encodeURIComponent(msg('The form data is attached (XFDF).'))}`, '_blank');
          setNotice(msg('The form data was saved as an XFDF file; attach it to the email that opened.'));
          return;
        }
        try {
          const res = await fetch(a.url, { method: 'POST', headers: { 'content-type': 'application/vnd.adobe.xfdf' }, body: xfdf });
          setNotice(res.ok ? msg('Form submitted to {host}.', { host: new URL(a.url).host }) : msg('Submitting failed: {host} answered {status}.', { host: new URL(a.url).host, status: String(res.status) }));
        } catch {
          setError(msg('Could not submit the form to {url} (the server may not accept requests from this app).', { url: a.url }));
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
      void runSign(o.file.id, signing, { area: { pageIndex, rect } }).catch((err) => setError(msg('Signing failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
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
      await editForm(o.file.id, msg('Adding the field'), (bytes) => createFields(bytes, [{ type: newFieldType, name, pageIndex, rect, ...(options ? { options } : {}) }]));
      setSelectedField(name);
      showPanel('forms');
    })();
  };

  // --- Digital signatures --------------------------------------------------------------------

  // The front document's signatures are checked while the Signatures panel or the Sign dialog is
  // showing, with whether it holds active content (JavaScript, Launch actions) to warn about.
  const checkingSigs = useRef(new Set<string>());
  const [activeContent, setActiveContent] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const o = split && activePane === 'b' ? openB : open;
    if (!o || (leftTab !== 'signatures' && rightTab !== 'signatures' && !signFor) || sigChecks[o.file.hash] || checkingSigs.current.has(o.file.hash)) return;
    const hash = o.file.hash;
    checkingSigs.current.add(hash);
    void (async () => {
      let checks: SignatureCheck[] = [];
      let warning: string | null = null;
      try {
        const [{ checkSignatures }, { activeContentWarning }] = await Promise.all([import('./documents/pdfSign'), import('./documents/activeContent')]);
        const bytes = new Uint8Array(await readFile(hash));
        [checks, warning] = await Promise.all([checkSignatures(bytes, await ltvTrust()), activeContentWarning(bytes)]);
      } catch {
        // Unreadable: shown as no signatures.
      }
      setActiveContent((cur) => ({ ...cur, [hash]: warning }));
      setSigChecks((cur) => ({ ...cur, [hash]: checks }));
      checkingSigs.current.delete(hash);
    })();
  }, [open, openB, split, activePane, leftTab, rightTab, sigChecks, signFor]);
  // Whose time stamps LTV relies on changed: check again.
  useEffect(() => setSigChecks({}), [trustedCerts]);

  /** Signs the document (an empty field, a drawn box, or invisibly) and keeps the version before as a revision. */
  const runSign = useCallback(
    async (fileId: string, c: SignChoice, target: { fieldName?: string; area?: { pageIndex: number; rect: { x: number; y: number; w: number; h: number } } }) => {
      const record = digitalIds.list().find((r) => r.id === c.idId);
      if (!record) throw new Error(msg('That Digital ID is no longer on this device'));
      const { signerFor } = await import('./documents/signers');
      const { signPdf } = await import('./documents/pdfSign');
      const id = signerFor(record, c.password);
      const picture = c.imageId ? signatures.get().find((p) => p.id === c.imageId) : undefined;
      const image = picture ? new Uint8Array(await (await fetch(picture.image)).arrayBuffer()) : undefined;
      let ltvNote: string | null = null;
      const ok = await editForm(
        fileId,
        'Signing',
        async (bytes) => {
          const signed = await signPdf(new Uint8Array(bytes), id, {
            ...target,
            ...(c.reason ? { reason: c.reason } : {}),
            ...(c.location ? { location: c.location } : {}),
            ...(c.certify ? { certify: c.certify } : {}),
            ...(image ? { image } : {}),
            digest: settings.get().signatureAlgorithm,
            format: settings.get().signatureFormat,
            ...(c.timestampUrl ? { timestamp: async (value: Uint8Array) => (await import('./documents/pki')).fetchTimestamp(c.timestampUrl!, value, pkiFetch) } : {}),
          });
          if (!c.ltv) return signed;
          const out = await withLtv(signed);
          ltvNote = out.note;
          return out.bytes;
        },
        'Before signing',
        // A card checks its PIN only now: a wrong one is shown in the Sign dialog, which stays open.
        true,
      );
      if (!ok) return;
      setNotice(msg('Signed by {name}{value}. The version before signing is kept under Document › Revisions.{value2}', { name: record.name, value: c.certify ? ' ' + msg('and certified') : '', value2: ltvNote ? ` ${ltvNote}` : '' }));
      showPanel('signatures');
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
      if (writes && studioDocOf(cur.file.id)) throw new Error(msg('Pages of a Live Session document cannot be changed: everyone in the session shares the same file.'));
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
          const parts = await tools.splitDocument(await annotatedBytes(cur), base, cur.store.bookmarks(), spec);
          await zipDownload(`${base} (split).zip`, parts.map((p) => p.data), (i) => parts[i]!.name);
          setNotice(msg('Split into {count} files.', { count: parts.length }));
          return;
        }
        case 'replace': {
          const bytes = await tools.replacePages(await readFile(cur.file.hash), await spec.file.arrayBuffer(), spec.targetPages, spec.sourcePages);
          await swapDocument(cur, intoB, bytes.slice().buffer, () => cur.store.forgetImported(spec.targetPages), undefined, `Replace ${spec.targetPages.length === 1 ? 'page' : 'pages'}`);
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
          if (!crops.size) throw new Error(msg('Nothing would be left of the pages: use smaller margins.'));
          const { bytes, transforms } = await tools.cropPages(await readFile(cur.file.hash), crops);
          await swapDocument(cur, intoB, bytes.slice().buffer, () => cur.store.transformPages(transforms), undefined, 'Crop pages');
          return;
        }
        case 'setup': {
          const { bytes, transforms } = await tools.resizePages(await readFile(cur.file.hash), spec.pages, spec.size, spec.fit);
          await swapDocument(cur, intoB, bytes.slice().buffer, () => cur.store.transformPages(transforms), undefined, 'Page Setup');
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
      setError(msg('Extract failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
    } finally {
      job.end();
    }
  }, [ctl]);

  /**
   * Save writes the document with its markups as PDF annotations over the file it was opened from
   * (asking once for permission). Documents with no file on disk, and Save As, ask where to put it.
   */
  const [savedTick, setSavedTick] = useState(0);
  const saveDocument = useCallback(async (saveAs: boolean, target?: { pane: Pane; t: OpenFile }, silent = false): Promise<boolean> => {
    const intoB = target ? target.pane === 'b' : activePaneRef.current === 'b';
    const cur = target?.t ?? (intoB ? openBRef.current : openRef.current);
    if (!cur) return false;
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
          replaceTab(cur, now);
          for (const p of ['a', 'b'] as const) if (openRefOf(p).current?.file.id === cur.file.id) setFront(p, now);
          void refreshLibrary();
        }
      }
      setSavedTick((n) => n + 1);
      if (!silent) setNotice((current) => afterFontNotice(current, `Saved ${fileName}.`));
    };
    try {
      // Autosave never asks where to save or downloads: it writes only to a file already chosen.
      const known = silent ? await recallHandle(cur.file.id) : null;
      if (silent && !known) return false;
      const out = await annotatedBytes(cur, { keepSigned: true });
      const stored = new Uint8Array(await readFile(cur.file.hash));
      assertKeepsSignatures(stored, out);
      await assertCertificationAllowsMarkups(stored, out);
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      const handle = saveAs ? null : known ?? (await recallHandle(cur.file.id));
      if (handle) {
        if (await writeToHandle(handle, blob)) {
          await saved(handle.name);
          return true;
        }
        if (!silent) setError(msg('{name} was not saved: the browser did not allow writing to it.', { name: handle.name }));
        return false;
      }
      const picked = await saveAsWithPicker(cur.file.name.endsWith('.pdf') ? cur.file.name : `${cur.file.name}.pdf`, 'application/pdf', blob);
      if (picked === 'unsupported') {
        anchorDownload(cur.file.name.replace(/\.pdf$/i, '') + ' (markups).pdf', blob);
        return true;
      }
      if (!picked) return false;
      await rememberHandle(cur.file.id, picked);
      await saved(picked.name);
      return true;
    } catch (err) {
      // Autosave retries after the next edit; a document that cannot be saved quietly stays unsaved.
      if (!silent) setError(msg('Save failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  }, [replaceTab, setFront, refreshLibrary]);

  // Preferences › Document › Autosave: a few seconds after the last edit, documents with changes
  // and a file to write to are saved in the background.
  const autosave = prefs.autosave;
  useEffect(() => {
    if (!autosave) return;
    const docs: { pane: Pane; t: OpenFile }[] = [
      ...pdfTabs(tabsA).map((t) => ({ pane: 'a' as const, t })),
      ...pdfTabs(tabsB).map((t) => ({ pane: 'b' as const, t })),
    ].filter(({ t }) => !studioDocOf(t.file.id));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      timer = undefined;
      for (const d of docs) {
        if (!hasUnsavedChanges(d.t) || autosaving.current.has(d.t.file.id)) continue;
        autosaving.current.add(d.t.file.id);
        void saveDocument(false, d, true).finally(() => autosaving.current.delete(d.t.file.id));
      }
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(run, AUTOSAVE_DELAY_MS);
    };
    if (docs.some(({ t }) => hasUnsavedChanges(t))) arm();
    const offs = docs.map(({ t }) => t.store.subscribe(arm));
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [autosave, tabsA, tabsB, savedTick, saveDocument]);
  const exportPdf = useCallback(() => saveDocument(false), [saveDocument]);

  /**
   * Closes one tab. The next tab comes to the front; when the left pane runs out of tabs while
   * the right pane has some, the right pane's tabs move across and the split closes.
   */
  const closeTab = useCallback(
    (pane: Pane, fileId: string, recordClosed = true) => {
      pane = tabPaneOf(pane);
      const tabs = pane === 'b' ? tabsBRef.current : tabsARef.current;
      const idx = tabs.findIndex((t) => t.file.id === fileId);
      if (idx < 0) return;
      const closing = tabs[idx]!;
      // A model in front counts too, so closing it brings the next tab forward.
      const front = frontTabOf(pane);
      if (recordClosed) {
        const desktopToken = fileLocationToken(closing.file.id);
        const isBlankUnsaved = closing.file.name === 'Untitled.pdf' && !desktopToken && !hasFileLocation(closing.file.id);
        if (!studioDocOf(closing.file.id) && !isBlankUnsaved && (desktopToken || (closing.file.id && closing.file.hash))) {
          const viewer = pane === 'b' ? ctlB?.viewer : ctl?.viewer;
          const lastPage =
            front === closing && viewer
              ? viewer.currentPageIndex
              : (savedViews.current.get(closing.file.id)?.pageIndex ?? 0);
          const entry = {
            name: closing.file.name,
            libraryId: closing.file.id,
            desktopToken,
            pageIndex: Math.max(0, lastPage),
          };
          setClosedTabs((prev) => {
            const next = [...prev.filter((x) => x.libraryId !== entry.libraryId), entry].slice(-20);
            closedTabsRef.current = next;
            return next;
          });
        }
      }
      const rest = tabs.filter((_, i) => i !== idx);
      setTabs(pane, rest);
      // The mirrored right pane follows the left pane's next tab; with none, the mirror and the split end.
      if (pane === 'a' && mirrorRef.current && openRef.current === closing && !rest.length) {
        showInPane('b', null);
        setSplit(false);
        setActivePane('a');
      }
      if (front === closing) {
        const next = rest[Math.min(idx, rest.length - 1)] ?? null;
        if (next) showInPane(pane, next);
        else if (pane === 'b') {
          showInPane('b', null);
          setSplit(false);
          setActivePane('a');
        } else if (tabsBRef.current.length) {
          const moved = tabsBRef.current;
          const bFront = frontTabOf('b') ?? moved[0]!;
          setTabs('b', []);
          showInPane('b', null);
          setTabs('a', moved);
          showInPane('a', bFront);
          setSplit(false);
          setActivePane('a');
        } else {
          showInPane('a', null);
          revealPanel('files', (tab) => tab === 'sessions' || tab === 'projects');
        }
      }
      disposeOpen(closing);
    },
    [setTabs, showInPane, ctl, ctlB],
  );

  /** Pops the most recently closed file- or library-backed tab and reopens it, restoring its last page. */
  const reopenClosedTab = useCallback(async () => {
    const stack = closedTabsRef.current;
    if (!stack.length) return;
    const entry = stack[stack.length - 1]!;
    const next = stack.slice(0, -1);
    closedTabsRef.current = next;
    setClosedTabs(next);

    const targetPane: Pane = split && activePaneRef.current === 'b' ? 'b' : 'a';
    const restorePage = (fileId: string, page: number) => {
      if (page <= 0) return;
      const tab = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === fileId);
      if (!tab || page >= tab.doc.pages.length) return;
      const isB = tabsBRef.current.some((t) => t.file.id === fileId);
      (isB ? ctlB?.viewer : ctl?.viewer)?.goToPage(page);
    };

    for (const p of ['a', 'b'] as const) {
      const existing = (p === 'b' ? tabsBRef.current : tabsARef.current).find((t) => t.file.id === entry.libraryId);
      if (existing) {
        activateTab(p, existing);
        restorePage(entry.libraryId, entry.pageIndex);
        return;
      }
    }

    try {
      const files = await listFiles();
      const file = files.find((f) => f.id === entry.libraryId);
      if (file) {
        if (await movedAway(file.id)) {
          setNotice(msg('Could not reopen "{name}": the file is no longer available.', { name: entry.name }));
          return;
        }
        const bytes = await readFile(file.hash);
        await openStored(file, bytes, targetPane);
        await touchFile(file.id);
        void refreshLibrary();
        restorePage(file.id, entry.pageIndex);
        return;
      }

      const host = desktop();
      if (entry.desktopToken && host) {
        const exists = host.tokenExists ? await host.tokenExists(entry.desktopToken) : true;
        if (!exists) {
          setNotice(msg('Could not reopen "{name}": the file is no longer available.', { name: entry.name }));
          return;
        }
        const raw = await host.readToken(entry.desktopToken);
        const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
        const stored = await saveFile(entry.name, bytes.slice(0));
        await openStored(stored, bytes, targetPane);
        void refreshLibrary();
        restorePage(stored.id, entry.pageIndex);
        return;
      }

      setNotice(msg('Could not reopen "{name}": the file is no longer available.', { name: entry.name }));
    } catch {
      setNotice(msg('Could not reopen "{name}": the file is no longer available.', { name: entry.name }));
    }
  }, [split, ctl, ctlB, activateTab, openStored, refreshLibrary]);

  /**
   * Puts a document's markups back to what its file holds: undoes what was done since it matched
   * the file, or, when that is not known (changes kept from an earlier session), reads them from the file again.
   */
  const discardUnsavedChanges = useCallback(async (t: OpenFile) => {
    const plan = planDiscard(savedState.get(t.store), t.store.undoHistory().length);
    if (plan.kind === 'undo') t.store.undoSteps(plan.steps);
    else if (!linkOf(t.file.id)) {
      const found = await readPdfAnnotations(await readFile(t.file.hash), t.store);
      t.store.resetMarkups([]);
      t.store.importAnnotations(found.markups, found.links, found.imported, found.extras);
    }
    markSaved(t);
    recoveredOnOpen.delete(t.file.id);
    rememberUnsaved(new Map([[t.file.id, false]]));
    setSavedTick((n) => n + 1);
  }, []);

  /**
   * Asks whether to save a document with unsaved changes, and saves it when told to. Resolves to
   * false on Cancel or when the save does not happen; true when the document can go.
   */
  const settleUnsaved = useCallback(
    async (pane: Pane, fileId: string): Promise<boolean> => {
      const find = () => pdfTabs(pane === 'b' ? tabsBRef.current : tabsARef.current).find((x) => x.file.id === fileId);
      const t = find();
      if (!t || studioDocOf(fileId) || !hasUnsavedChanges(t)) return true;
      const choice = await askSaveChanges(t.file.name);
      if (choice === 'cancel') return false;
      if (choice === 'discard') {
        // Don't Save always means it: Document Recovery is for crashes, not for changes the person turned down.
        await discardUnsavedChanges(t);
        return true;
      }
      const now = find();
      return !now || saveDocument(false, { pane, t: now });
    },
    [saveDocument, discardUnsavedChanges],
  );

  /**
   * Closes a tab the person asked to close. A document with unsaved changes asks first whether to
   * save them; the tab stays open on Cancel or when the save does not happen. Resolves to whether it closed.
   */
  const requestCloseTab = useCallback(
    async (pane: Pane, fileId: string): Promise<boolean> => {
      pane = tabPaneOf(pane);
      if (!(await settleUnsaved(pane, fileId))) return false;
      closeTab(pane, fileId);
      return true;
    },
    [closeTab, settleUnsaved],
  );
  closeTabRef.current = requestCloseTab;

  /**
   * Before the window goes (closing it, or Restart Now): asks about each document with unsaved
   * changes, showing it first, then saves Live Sessions on this device. False when the person
   * cancels or a session could not be saved, and the app keeps running.
   */
  const settleBeforeLeaving = useCallback(async () => {
    for (const pane of ['a', 'b'] as const) {
      for (const t of [...(pane === 'b' ? tabsBRef.current : tabsARef.current)]) {
        if (studioDocOf(t.file.id) || !hasUnsavedChanges(t)) continue;
        activateTab(pane, t);
        if (!(await settleUnsaved(pane, t.file.id))) return false;
      }
    }
    try {
      await Promise.all(sessionsRef.current.map((s) => s.saveLocally?.()));
    } catch {
      setError(msg('Session changes could not be saved on this device. Keep redcolumn open and retry sync before closing or restarting.'));
      return false;
    }
    return true;
  }, [activateTab, settleUnsaved]);

  /**
   * Leaves the app (the desktop window closing, or Restart Now) once `settleBeforeLeaving` allows it.
   * One guard covers both, so a close request while Restart Now is asking (or the reverse) does not
   * ask about the same documents twice.
   */
  const leaving = useRef(false);
  const leaveApp = useCallback(
    async (go: () => void, failed: (error: string) => string) => {
      if (leaving.current) return;
      leaving.current = true;
      try {
        if (await settleBeforeLeaving()) go();
      } catch (e) {
        setError(failed(e instanceof Error ? e.message : String(e)));
      } finally {
        leaving.current = false;
      }
    },
    [settleBeforeLeaving],
  );

  /**
   * Restarts the app (Preferences › Language), after the same questions closing the window asks
   * (the desktop app has no browser prompt on reload).
   */
  const restartApp = useCallback(() => leaveApp(() => location.reload(), (error) => msg('Could not restart: {error}', { error })), [leaveApp]);

  // The desktop app asks before its window closes while documents have unsaved changes: the page
  // reports whether any do, and on a close request asks about each one, showing it first.
  useEffect(() => {
    const host = desktop();
    if (!host?.setUnsavedChanges) return;
    const stores = pdfTabs([...tabsA, ...tabsB]);
    let last: boolean | null = null;
    const report = () => {
      const on = stores.some((t) => !studioDocOf(t.file.id) && hasUnsavedChanges(t)) || sessions.some((s) => {
        const state = s.getSnapshot().localSave;
        return state === 'saving' || state === 'error';
      });
      if (on !== last) host.setUnsavedChanges!((last = on));
    };
    report();
    const offs = [...stores.map((t) => t.store.subscribe(report)), ...sessions.map((s) => s.subscribe(report))];
    return () => offs.forEach((off) => off());
  }, [tabsA, tabsB, savedTick, sessions]);
  // In a browser, leaving or refreshing the page while documents have unsaved changes asks first
  // (the browser shows its own Leave / Reload site? prompt). The desktop app asks above instead.
  useEffect(() => {
    if (desktop()) return;
    const stores = pdfTabs([...tabsA, ...tabsB]);
    const warn = (e: BeforeUnloadEvent) => {
      if (!stores.some((t) => !studioDocOf(t.file.id) && hasUnsavedChanges(t)) && !sessions.some((s) => ['saving', 'error'].includes(s.getSnapshot().localSave ?? ''))) return;
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tabsA, tabsB, savedTick, sessions]);
  // Document Recovery: remember which open documents have changes not saved to their file.
  const recovery = prefs.documentRecovery;
  useEffect(() => {
    if (!recovery) {
      try {
        localStorage.removeItem(RECOVERY_KEY);
      } catch {
        // Nothing kept.
      }
      return;
    }
    const docs = pdfTabs([...tabsA, ...tabsB]).filter((t) => !studioDocOf(t.file.id));
    const report = () => rememberUnsaved(new Map(docs.map((t) => [t.file.id, hasUnsavedChanges(t)])));
    report();
    const offs = docs.map((t) => t.store.subscribe(report));
    return () => offs.forEach((off) => off());
  }, [tabsA, tabsB, savedTick, recovery]);
  useEffect(() => {
    const host = desktop();
    if (!host?.onCloseRequest) return;
    return host.onCloseRequest(() => void leaveApp(() => host.closeWindow?.(), (error) => msg('Could not close the window: {error}', { error })));
  }, [leaveApp]);

  /** Closes tabs one after another, stopping when the person cancels one. */
  const requestCloseTabs = useCallback(
    async (which: { pane: Pane; fileId: string }[]) => {
      for (const { pane, fileId } of which) if (!(await requestCloseTab(pane, fileId))) return;
    },
    [requestCloseTab],
  );

  /** Closes the split; the right pane's tabs join the left pane's. */
  const unsplit = useCallback(() => {
    const moved = tabsBRef.current;
    const bFront = openBRef.current;
    showInPane('b', null);
    setTabs('b', []);
    // The tab Split View took across goes back where it was.
    const origin = splitOrigin.current;
    splitOrigin.current = null;
    const back = origin ? moved.find((t) => t.file.id === origin.id) : undefined;
    const joined = [...tabsARef.current, ...moved.filter((t) => t !== back)];
    if (back) joined.splice(Math.min(origin!.index, tabsARef.current.length), 0, back);
    setTabs('a', joined);
    if (!openRef.current && bFront) showInPane('a', bFront);
    setSplit(false);
    setActivePane('a');
  }, [setTabs, showInPane]);

  /** Closes the tab in front of the active pane. */
  const closeDocument = useCallback(() => {
    const pane: Pane = activePaneRef.current === 'b' && frontTabOf('b') ? 'b' : 'a';
    const front = frontTabOf(pane);
    if (front) void requestCloseTab(pane, front.file.id);
    else if (pane === 'a' && split) unsplit();
  }, [requestCloseTab, unsplit, split]);

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
    if (wasOpen) setError(msg('{value} was removed from the session.', { value: name ?? msg('A document') }));
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
   * Joins a session (as well as any already joined). `interactive` (from a click) signs in first and
   * asks for more access when opening the shared folder needs it. Without a click (rejoining on page
   * load) it reads at once and asks to reconnect.
   */
  const joinStudio = useCallback(
    (ref: SessionRef, interactive = true) =>
      runStudio(async () => {
        if (sessionById(ref.id)) {
          setFocusedSession(ref.id);
          return;
        }
        const { holder, onRemoved } = removedHandler();
        holder.id = ref.id;
        if (ref.backend === 'folder') {
          enterStudio(await DriveSession.join(new SessionFolderDrive(), ref.id, authorRef.current, { authorize: noSignIn, onRemoved, interactive }));
          return;
        }
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
      }),
    [runStudio, enterStudio],
  );

  /** Joins a session kept in a shared folder the person picks on this computer. False if they cancel or it fails. */
  const joinFolderStudio = useCallback(async (): Promise<boolean> => {
    const picked = await desktop()?.folder.pick('session-open');
    return picked ? joinStudio({ backend: 'folder', id: picked.id }) : false;
  }, [joinStudio]);

  /** The bytes of a document offered to a new session, and the markups already on it. */
  const documentSourceBytes = useCallback(
    async (d: DocumentSource): Promise<{ bytes: ArrayBuffer; seed: Uint8Array | null }> => {
      if (d.kind === 'upload') return { bytes: await d.file.arrayBuffer(), seed: null };
      const open = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === d.fileId);
      if (open) return { bytes: await readFile(open.file.hash), seed: Y.encodeStateAsUpdate(open.store.doc) };
      const stored = library.find((f) => f.id === d.fileId);
      if (!stored) throw new Error(msg('{name} is no longer in the library.', { name: d.name }));
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
    async (req: StartRequest) => {
      let cancelled = false;
      const ok = await runStudio(async () => {
        const { holder, onRemoved } = removedHandler();
        const permissions = { markup: canAddMarkups(req.access.default), addDocuments: req.addDocuments, saveCopy: req.saveCopy, invite: req.invite };
        if (req.backend === 'folder') {
          // The host picks a folder everyone can reach; the session gets its own folder inside it.
          const parent = await desktop()?.folder.pick('session-create');
          if (!parent) {
            cancelled = true;
            return;
          }
          const session = await DriveSession.create(new SessionFolderDrive(parent.id), req.name, authorRef.current, permissions, {
            authorize: noSignIn,
            onRemoved,
            linkCanEdit: false,
            access: req.access,
            expiresAt: req.expiresAt,
            encrypt: false,
          });
          holder.id = session.id;
          enterStudio(session);
          await addToStudio(session.id, req.documents);
          return;
        }
        await signInWithMicrosoft();
        const create = () =>
          DriveSession.create(oneDriveApi, req.name, authorRef.current, permissions, {
            authorize: authorizeMicrosoft,
            onRemoved,
            linkCanEdit: req.linkCanEdit,
            access: req.access,
            expiresAt: req.expiresAt,
            encrypt: req.encrypt,
            email: microsoftEmail(),
            identify: microsoftEmail,
          });
        let session: CollabSession;
        try {
          session = await create();
        } catch (err) {
          // Sharing the folder can need more than the app folder: ask, and try again.
          if (!(err instanceof DriveAuthError)) throw err;
          await signInWithMicrosoft();
          session = await create();
        }
        holder.id = session.id;
        enterStudio(session);
        const emails = req.access.people.map((p) => p.name).filter(isEmail);
        if (session.invite && emails.length) await session.invite(emails);
        await addToStudio(session.id, req.documents);
      });
      return ok && !cancelled;
    },
    [runStudio, enterStudio, addToStudio],
  );

  /**
   * A session document's markups: from its tab when open, else synced into a store opened just for
   * this (closed again afterwards).
   */
  const withSessionMarkups = useCallback(async <T,>(session: CollabSession, docId: string, use: (store: MarkupStore) => T): Promise<Awaited<T>> => {
    const fileId = studioFileId(session.id, docId);
    const tab = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === fileId);
    if (tab) return await use(tab.store);
    const store = await MarkupStore.open(fileId);
    try {
      await session.attach(docId, store);
      return await use(store);
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
          for (const r of withThreads(buildRows(store.all(), ctx, {}, null), ctx)) rows.push({ ...r, cells: { document: { text: d.name, num: null }, ...r.cells } });
        });
      }
      return rowsToCsv(rows, [{ key: 'document', label: msg('Document'), defaultWidth: 160 }, ...(columns ?? listColumns([]).filter((c) => keep.has(c.key)))], true);
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
      let meta = session.meta;
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
            throw new Error(msg('No folder was chosen, so the session was not ended.'));
          }
        }
      } else if (saving && choice.destination === 'onedrive') await authorizeMicrosoft();
      else if (saving && choice.destination === 'project' && choice.projectId) project = projectById(choice.projectId) ?? (await openProject(choice.projectId, authorRef.current, true, false));

      // Ask for a destination while the initiating user gesture is still available.
      // Then confirm our writes and refresh the shared state before preparing exports.
      await session.prepareCloseout?.();
      meta = session.meta;
      const reviewState = () => JSON.stringify({ documents: session.meta.documents, revision: session.getSnapshot().revision, record: session.getSnapshot().record });
      const archivedState = reviewState();
      const files: { name: string; blob: Blob }[] = [];
      if (choice.pdfs && meta.documents.length) {
        const { exportWithAnnotations } = await import('@nb/markup/export');
        for (const d of meta.documents) {
          step(`Preparing ${d.name}`);
          const bytes = await session.fetchDocument(d.id);
          const out = await withSessionMarkups(session, d.id, async (store) => {
            const chosen = store.all().filter((m) => choice.authors.includes(m.author));
            const fonts = await fontExport(chosen);
            const exported = await exportWithAnnotations(
              bytes.slice(0),
              chosen,
              {
                ...(fonts.systemFonts ? { systemFonts: fonts.systemFonts } : {}),
                onFontFallback: fonts.onFontFallback,
                scaleFor: (i) => store.scaleFor(i),
                viewports: store.allViewports(),
                links: store.allLinks(),
                imported: store.importedAnnotations(),
                importedSpaces: store.importedSpaces(),
                pageScales: store.allScales(),
                geo: store.editedGeo(),
                columns: store.columnSet().columns,
                statuses: store.columnSet().statuses,
                assemblies: store.assemblies(),
                estimating: store.estimating(),
                portals: store.portals(),
                aiReview: store.aiReviewForSave(),
                places: store.places(),
              },
            );
            fonts.done();
            return exported;
          });
          files.push({ name: safe(`${d.name.replace(/\.pdf$/i, '')} (${meta.name}).pdf`), blob: new Blob([out.slice().buffer], { type: 'application/pdf' }) });
        }
      }
      if (choice.markupsCsv && meta.documents.length) step(msg('Preparing the markups CSV'));
      if (choice.markupsCsv && meta.documents.length) files.push({ name: safe(`${meta.name} markups.csv`), blob: new Blob(['﻿' + (await sessionMarkupsCsv(session))], { type: 'text/csv' }) });
      if (choice.recordCsv) {
        step(msg('Preparing the session record'));
        const snap = session.getSnapshot();
        files.push({ name: safe(`${meta.name} session record.csv`), blob: new Blob(['﻿' + recordToCsv(snap.meta, snap.record)], { type: 'text/csv' }) });
      }
      if (choice.reportPdf) step(msg('Preparing the session report'));
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
              await saveConfirmedArchiveFile(f.name, f.blob);
            }
            where = 'the files you chose';
          }
        } else if (choice.destination === 'onedrive') {
          const folder = `${meta.name} (ended ${stamp})`;
          const folderId = await oneDriveApi.createFolder(folder);
          for (const f of files) {
            step(msg('Uploading {name} to OneDrive', { name: f.name }));
            await oneDriveApi.createFile(folderId, f.name, f.blob.type, f.blob, {});
          }
          where = msg('OneDrive, Apps/redcolumn/{folder}', { folder });
        } else {
          if (!project) throw new Error(msg('Choose a Project to save to.'));
          const taken = new Set(project.getSnapshot().folders.filter((f) => f.parentId === null).map((f) => f.name.toLowerCase()));
          let folder = `${safe(meta.name)} (ended ${stamp})`;
          for (let n = 2; taken.has(folder.toLowerCase()); n++) folder = `${safe(meta.name)} (ended ${stamp}) ${n}`;
          const { id } = await project.addFolder(folder, null);
          for (const f of files) {
            step(msg('Uploading {name} to the Project', { name: f.name }));
            await project.addFile(f.name, id, await f.blob.arrayBuffer());
          }
          where = msg('the Project “{name}”, folder {folder}', { name: project.getSnapshot().manifest.name, folder });
        }
      }

      // Session Roundtrip: library documents take the session's markups (and its newer revision, if the host updated it).
      await session.prepareCloseout?.();
      if (reviewState() !== archivedState) throw new Error(msg('The review changed while its archive was being saved. Its shared files have been kept. Check the latest changes and save the archive again.'));
      const sentBack: string[] = [];
      for (const d of meta.documents) {
        const back = choice.sendBack.includes(d.id) ? sourceOf(sessionId, d.id) : null;
        if (!back) continue;
        step(msg('Sending {name} back to your library', { name: d.name }));
        const bytes = await session.fetchDocument(d.id);
        const chosen = await withSessionMarkups(session, d.id, (store) => store.all().filter((m) => choice.authors.includes(m.author)));
        const tab = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === back.fileId);
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
      step(msg('Removing the session and its files'));
      await session.end();
      closeStudioDocs(sessionId);
      forgetRoundtrip(sessionId);
      sessionsRef.current = sessionsRef.current.filter((s) => s.id !== sessionId);
      setSessions(sessionsRef.current);
      setFocusedSession((f) => (f === sessionId ? null : f));
      setNotice(msg('Ended “{name}” and removed its files.{value}{value2}', { name: meta.name, value: files.length ? ' ' + msg('Saved {count, plural, one {# file} other {# files}} to {where}.', { count: files.length, where }) : '', value2: sentBack.length ? ' ' + msg('Sent back: {sentBack}.', { sentBack: sentBack.join(', ') }) : '' }));
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
        const inA = pdfTabs(tabsARef.current).find((t) => t.file.id === fileId);
        const tab = inA ?? pdfTabs(tabsBRef.current).find((t) => t.file.id === fileId);
        const session = sessionById(snap.meta.id);
        if (!tab || !session) continue;
        void session
          .fetchDocument(d.id)
          .then((bytes) => swapDocument(tab, !inA, bytes, () => tab.store.forgetImported(tab.doc.pages.map((_, i) => i))))
          .then(() => setNotice(msg('{name} was updated to revision {version}; markups are on the same pages.', { name: d.name, version: String(version) })))
          .catch((err) => setError(msg('Could not load the new revision of {name}: {value}', { name: d.name, value: err instanceof Error ? err.message : String(err) })));
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
        const tab = pdfTabs(p === 'b' ? tabsBRef.current : tabsARef.current).find((t) => t.file.id === fileId);
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
            setNotice(msg('Offline: opened your copy of {name} (revision {rev}); the Project has revision {latest}.', { name: file.name, rev: String(link.rev), latest: String(latest) }));
            return null;
          });
          if (!got) return void (await openFromLibrary(stored));
          const tab = pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === copyId);
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
          setNotice(msg('{name}: updated to revision {n} from the Project.', { name: file.name, n: String(got.revision.n) }));
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
    setNotice(msg('Added {list} to the Project.', { list: sources.map((s) => s.name).join(', ') }));
  }, []);

  /**
   * Checks the library copy in as a new revision of the PDF. With OneDrive out
   * of reach the check-in is queued (the copy is read when it is sent) and goes when it is back.
   */
  const checkInProjectFile = useCallback(
    async (project: Project, file: ProjectFile, comment: string) => {
      const copyId = libraryCopyOf(project.id, file.id);
      if (!copyId) throw new Error(msg('Open the file from the Project first, then make your changes.'));
      const link = linkOf(copyId)!;
      const queue = () => {
        projectQueue().add({ kind: 'checkin', projectId: project.id, fileId: file.id, fileName: file.name, by: authorRef.current, libraryId: copyId, baseRev: link.rev, comment, keep: false });
        setNotice(msg('{name} will be checked in when OneDrive can be reached.', { name: file.name }));
      };
      if (!navigator.onLine) return queue();
      try {
        const rev = await project.checkIn(file.id, await projectCopyBytes(copyId), comment);
        setLink(copyId, { ...link, rev: rev.n });
        setNotice(msg('Checked in {name} as revision {n}.', { name: file.name, n: String(rev.n) }));
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
        for (const tab of pdfTabs([...tabsARef.current, ...tabsBRef.current])) {
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
      if (!file) throw new Error(msg('It is no longer in the Project.'));
      if (!project.heldByMe(file)) throw new Error(file.checkout ? msg('{by} has it checked out.', { by: file.checkout.by }) : msg('It is no longer checked out to you. Check it out again, then retry.'));
      const latest = file.revisions[file.revisions.length - 1]!.n;
      if (latest > c.baseRev) throw new Error(msg('Someone checked in revision {latest} after your copy (revision {baseRev}).', { latest: String(latest), baseRev: String(c.baseRev) }));
      const rev = await project.checkIn(file.id, await projectCopyBytes(c.libraryId), c.comment);
      const link = linkOf(c.libraryId);
      if (link) setLink(c.libraryId, { ...link, rev: rev.n });
    });
    if (r.sent.length) setNotice(msg('Sent {count} Project {count2, plural, one {change} other {changes}} made offline.', { count: r.sent.length, count2: r.sent.length }));
    if (r.failed.length) setError(msg('Not sent: {list}. Retry or discard them in the Projects panel.', { list: r.failed.map((c) => `${c.fileName} (${c.error})`).join('; ') }));
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
  // `?onedrive=<share id>`, which waits for a click to sign in. Links to redcolumn server sessions
  // (`?studio=`) and Google Drive sessions (`?gdrive=`) from older builds are dropped.
  useEffect(() => {
    if (!ctl) return;
    const params = new URLSearchParams(window.location.search);
    const driveInvite = parseOneDriveInvite(params.get('onedrive') ?? '');
    // An encrypted session's key comes after # (never sent to any server): keep it, and take it out of the address bar.
    const secret = driveInvite ? parseSecret(window.location.hash) : null;
    if (driveInvite && secret) {
      rememberSessionKeys(driveInvite, secret);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    const projectLink = idFromText(params.get('project') ?? '');
    // An encrypted Project's key comes after # (never sent to any server): keep it, and take it out of the address bar.
    const projectSecret = projectLink ? parseProjectKey(window.location.hash) : null;
    if (projectLink && projectSecret) {
      rememberProjectKey(projectLink, projectSecret);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    if (params.has('project')) {
      params.delete('project');
      window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`);
      if (projectLink) {
        setProjectInvite(projectLink);
        showPanel('projects');
      }
    }
    if (params.has('studio') || params.has('gdrive') || driveInvite) {
      params.delete('studio');
      params.delete('gdrive');
      params.delete('onedrive');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
      showPanel('sessions');
    }
    // Sessions only run in the desktop app: the web build neither rejoins them nor takes invites.
    const current = desktop() ? currentSessions() : [];
    void (async () => {
      for (const ref of current) await joinStudio(ref, false);
      if (!desktop()) return;
      if (driveInvite && !current.some((r) => r.id === driveInvite)) setStudioInvite({ backend: 'onedrive', id: driveInvite });
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
      addBusyCheck('jobs', () => (runningJobs().length ? msg('{label} is running', { label: runningJobs()[0]!.label.toLowerCase() }) : null)),
      addBusyCheck('projects', () => (projectQueue().busy ? msg('Project changes are being sent') : null)),
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
          return setError(msg('Could not open the shared link {url}. Download the PDF and share the file instead.', { url: launch.url }));
        }
        setError(launch.error ? msg('The shared file could not be received.') : msg('Nothing to open was shared: share a PDF file.'));
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
      else if (e.key === ' ' && measuring && tools.finishKey(e.key, e.target)) {
        // Space finished it, like Enter; the page must not scroll too.
        e.preventDefault();
      }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && measuring) tools.removeLastPoint();
      else if (e.key === 'Escape') tools.cancel();
      // Typing on a selected table cell, or Enter or F2, edits it; the typed character starts its new text.
      else if (tools.getState().tableCells && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && (e.key.length === 1 || e.key === 'Enter' || e.key === 'F2') && startCellEdit(tools, e.key.length === 1 ? e.key : undefined)) {
        // Handled.
      } else {
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
        // Nudging leaves the arrow keys alone unless the page itself has focus: a disabled nudge,
        // a key a widget already used (ribbon tabs, panels, dialogs), a focused control, or table cells.
        if (id?.startsWith('edit.nudge')) {
          const t = e.target;
          const onPage = t === document.body || t === document.documentElement || t instanceof HTMLCanvasElement;
          if (!command.enabled || e.defaultPrevented || !onPage || tools.getState().tableCells) return;
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
        if (!moved && !tools.rightClickFinish()) canvasMenuRef.current(e, pane);
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
      if (!additive && settings.get().zoomFitSelected) zoomToMarkup(viewer, m);
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

  /** The Markups list's selection: Ctrl toggles, Shift extends a range, a plain click focuses one. */
  const selectRowsFromList = useCallback((ids: readonly string[], focus: Markup, zoom: boolean, exact = false) => {
    const useB = activePaneRef.current === 'b' && ctlB;
    const viewer = useB ? ctlB.viewer : ctl?.viewer;
    const tools = useB ? ctlB.tools : ctl?.tools;
    if (!viewer || !tools) return;
    if (ids.includes(focus.id) && viewer.currentPageIndex !== focus.pageIndex) viewer.goToPage(focus.pageIndex);
    if (zoom && settings.get().zoomFitSelected) zoomToMarkup(viewer, focus);
    tools.setTool('select');
    if (exact) tools.selectOnly(ids);
    else tools.select(ids);
  }, [ctl, ctlB]);

  // --- Comments table: every comment and reply across a Project's or Live Session's files -------

  /** A markup to select once its document is open (a Comments table row opens the file first). */
  const pendingFocusRef = useRef<{ markupId: string; until: number } | null>(null);
  useEffect(() => {
    const f = pendingFocusRef.current;
    if (!f) return;
    if (Date.now() > f.until) {
      pendingFocusRef.current = null;
      return;
    }
    const m = markups.find((x) => x.id === f.markupId);
    if (!m) return;
    pendingFocusRef.current = null;
    selectFromList(m);
  }, [markups, selectFromList]);

  const panesRef = useRef({ ctl, ctlB });
  panesRef.current = { ctl, ctlB };

  /** Opens a row's file, then its page and markup. */
  const openCommentRow = useCallback(
    async (open: () => Promise<void>, row: CommentRow) => {
      setCommentsTable((t) => (t ? { ...t, hidden: true } : t));
      pendingFocusRef.current = { markupId: row.markupId, until: Date.now() + 15_000 };
      await open();
      // A markup that is not in the open copy (not synced yet): at least show its page.
      setTimeout(() => {
        if (pendingFocusRef.current?.markupId !== row.markupId) return;
        pendingFocusRef.current = null;
        (activePaneRef.current === 'b' ? panesRef.current.ctlB : panesRef.current.ctl)?.viewer.goToPage(row.pageIndex);
      }, 2500);
    },
    [],
  );

  /** Reads every file of a Project for its comments: the shared markups, and the markups other tools wrote into the PDF. */
  const showProjectComments = useCallback(async (project: Project) => {
    const key = `project:${project.id}`;
    const title = `Project ${project.getSnapshot().manifest.name}`;
    const files = project.getSnapshot().files;
    const statuses = profiles.active().state.columnTemplate?.statuses ?? DEFAULT_STATUSES;
    const rows: CommentRow[] = [];
    const failed: string[] = [];
    const open = (row: CommentRow) => {
      const file = project.getSnapshot().files.find((f) => f.id === row.fileId);
      if (file) void openCommentRow(() => openProjectFile(project, file), row).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    };
    setCommentsTable({ key, title, rows: null, progress: { done: 0, total: files.length }, failed, open, refresh: () => void showProjectComments(project) });
    for (const [i, file] of files.entries()) {
      try {
        // The folder is read once, for the first file; the rest use what it read.
        const shared = await project.sharedMarkups(file.id, i === 0);
        const { bytes } = await project.download(file.id);
        const scratch = await MarkupStore.open(`comments:${project.id}:${file.id}`, { persist: false });
        try {
          const found = await readPdfAnnotations(bytes, scratch);
          // Markups this app wrote come back from the shared copy; the PDF adds other tools' ones.
          const byId = new Map([...(shared.length ? found.markups.filter(fromOtherTools) : found.markups), ...shared].map((m) => [m.id, m]));
          // The file's own custom statuses (from Revu, say) name their states too.
          rows.push(...commentRows({ fileId: file.id, file: file.name, markups: [...byId.values()], pageLabel: (p) => found.labels[p] || `Page ${p + 1}` }, [...statuses, ...(found.extras.statuses ?? [])]));
        } finally {
          await scratch.destroy();
        }
      } catch (err) {
        failed.push(`${file.name} (${err instanceof Error ? err.message : String(err)})`);
      }
      setCommentsTable((t) => (t?.key === key ? { ...t, progress: { done: i + 1, total: files.length } } : t));
    }
    setCommentsTable((t) => (t?.key === key ? { ...t, rows, failed, progress: null } : t));
  }, [openCommentRow, openProjectFile]);

  /** A Live Session's comments, from each document's shared markups. */
  const showSessionComments = useCallback(
    async (session: CollabSession) => {
      const key = `session:${session.id}`;
      const docs = session.getSnapshot().meta.documents;
      const rows: CommentRow[] = [];
      const failed: string[] = [];
      const open = (row: CommentRow) => void openCommentRow(() => openSessionDocument(session.id, row.fileId), row).catch((err) => setError(err instanceof Error ? err.message : String(err)));
      setCommentsTable({ key, title: msg('Live Session {name}', { name: session.meta.name }), rows: null, progress: { done: 0, total: docs.length }, failed, open, refresh: () => void showSessionComments(session) });
      for (const [i, d] of docs.entries()) {
        try {
          rows.push(
            ...(await withSessionMarkups(session, d.id, (store) => {
              const sheets = store.allSheets();
              return commentRows({ fileId: d.id, file: d.name, markups: store.all(), pageLabel: (p) => sheets[p]?.number || `Page ${p + 1}` }, store.columnSet().statuses);
            })),
          );
        } catch (err) {
          failed.push(`${d.name} (${err instanceof Error ? err.message : String(err)})`);
        }
        setCommentsTable((t) => (t?.key === key ? { ...t, progress: { done: i + 1, total: docs.length } } : t));
      }
      setCommentsTable((t) => (t?.key === key ? { ...t, rows, failed, progress: null } : t));
    },
    [openCommentRow, openSessionDocument, withSessionMarkups],
  );

  // Stable handlers for the Markups list, so it re-renders only when its data changes.
  const listRowMenuRef = useRef<(m: Markup, x: number, y: number) => void>(() => {});
  listRowMenuRef.current = (m, x, y) => {
    const pane: Pane = paneB ? 'b' : 'a';
    const tools = paneParts(pane).c?.tools;
    if (!tools) return;
    let ids = [...tools.getState().selected];
    if (!ids.includes(m.id)) {
      selectRowsFromList([m.id], m, true);
      ids = [m.id];
    }
    setCtxMenu({ x, y, items: markupMenu(pane, ids) });
  };
  const onListRowMenu = useCallback((m: Markup, x: number, y: number) => listRowMenuRef.current(m, x, y), []);
  const onListReply = useCallback((m: Markup, parentId?: string) => setReplyTo({ pane: paneB ? 'b' : 'a', id: m.id, ...(parentId ? { parentId } : {}) }), [paneB]);
  const onManageColumns = useCallback(() => setColumnsOpen(true), []);
  const onExportList = useCallback(() => setSummaryOpen(true), []);

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
  // In select mode the style controls show the selected markup's style, not the tool's defaults. A table's controls are its cells'.
  const selectedStyle = toolsState.tool === 'select' && styleType && styleType !== 'table' ? markups.find((m) => m.type === styleType && toolsState.selected.has(m.id))?.style : undefined;
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
    const connector = m.type === 'connector';
    void askText(replace ? msg('Replace Text') : connector ? msg('Connector Text') : msg('Dimension Text'), m.text ?? '', {
      label: replace ? msg('Replacing "{value}" with:', { value: m.comment ?? '' }) : connector ? msg('Shown on the connector, e.g. Yes or No.') : msg('Shown along the dimension line.'),
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
    return { canvas, x0, y0, w, h, scale, originPx: [Math.floor(x0 * scale), Math.floor(y0 * scale)] as Point };
  };

  // --- Link previews ------------------------------------------------------------------------------

  /** A link's target as a preview: replaces the unpinned one, beside the pinned ones. */
  previewLinkRef.current = (link: StoredLink) => {
    const o = paneParts(activePaneRef.current).o;
    if (!o) return;
    const sheet = o.store.allSheets()[link.targetPage];
    const target = [sheet?.number ?? `Page ${link.targetPage + 1}`, sheet?.title].filter(Boolean).join(' ');
    const title = link.detail ? `${link.label} → ${target}` : target;
    setLinkPreviews((ps) => {
      const kept = ps.filter((p) => p.pinned);
      const k = kept.length;
      const w = Math.min(520, window.innerWidth - 48);
      const h = Math.min(380, window.innerHeight - 160);
      return [...kept, { id: crypto.randomUUID(), title, pinned: false, x: Math.max(8, window.innerWidth - w - 32 - k * 28), y: 120 + k * 28, w, h, link, fileId: o.file.id }];
    });
  };

  // A preview goes when its document is closed.
  useEffect(() => {
    const open = new Set([...tabsA, ...tabsB].map((t) => t.file.id));
    setLinkPreviews((ps) => (ps.every((p) => open.has(p.fileId)) ? ps : ps.filter((p) => open.has(p.fileId))));
  }, [tabsA, tabsB]);

  /** The open document a preview belongs to. */
  const previewFile = (fileId: string) => pdfTabs([...tabsARef.current, ...tabsBRef.current]).find((t) => t.file.id === fileId);

  const renderPreviewRef = useRef<(id: string, width: number, height: number, view?: PreviewView) => Promise<PreviewDrawing | null>>(async () => null);
  renderPreviewRef.current = async (id, width, height, asked) => {
    const p = linkPreviews.find((x) => x.id === id);
    const o = p && previewFile(p.fileId);
    const size = p && o?.doc.pages[p.link.targetPage];
    if (!p || !o || !size) return null;
    // The detail with some of the sheet around it, or the whole sheet.
    const t = p.link.targetRect;
    const pad = t ? Math.max(36, 0.25 * Math.max(t.w, t.h)) : 0;
    const area = t ? { x: t.x - pad, y: t.y - pad, w: t.w + 2 * pad, h: t.h + 2 * pad } : { x: 0, y: 0, w: size.width, h: size.height };
    const dpr = window.devicePixelRatio || 1;
    // Fitted to the link's target until the person zooms or pans.
    const view: PreviewView = asked ?? { cx: area.x + area.w / 2, cy: area.y + area.h / 2, zoom: Math.min(width / area.w, height / area.h) };
    const seen = { x: view.cx - width / 2 / view.zoom, y: view.cy - height / 2 / view.zoom, w: width / view.zoom, h: height / view.zoom };
    const region = await renderRegion(o, p.link.targetPage, seen, () => Math.min(16, Math.max(0.1, view.zoom * dpr)));
    // Panned or zoomed right off the page: draw nothing, but still report the view so the old picture goes.
    if (!region) return { canvas: document.createElement('canvas'), x0: 0, y0: 0, view };
    region.canvas.style.width = `${region.w * view.zoom}px`;
    region.canvas.style.height = `${region.h * view.zoom}px`;
    return { canvas: region.canvas, x0: region.x0, y0: region.y0, view };
  };
  const renderPreview = useCallback((id: string, width: number, height: number, view?: PreviewView) => renderPreviewRef.current(id, width, height, view), []);

  /** Opens a preview's sheet in the view (as following the link used to), and closes the preview unless it is pinned. */
  const openPreview = (id: string) => {
    const p = linkPreviews.find((x) => x.id === id);
    if (!p) return;
    if (activeOpen?.file.id !== p.fileId) {
      // Its document is open in another tab: the view cannot go there from here.
      setNotice(msg('Switch to {value} to open {title}.', { value: previewFile(p.fileId)?.file.name ?? msg('its document'), title: p.title }));
      return;
    }
    navigate(p.link.targetPage, p.link.targetRect);
    if (!p.pinned) setLinkPreviews((ps) => ps.filter((x) => x.id !== id));
  };

  /** Shows where a preview's link was clicked: the mark for a title's link, the title for a mark's. */
  const backFromPreview = (id: string) => {
    const p = linkPreviews.find((x) => x.id === id);
    if (!p) return;
    if (activeOpen?.file.id !== p.fileId) {
      setNotice(msg('Switch to {value} to go back.', { value: previewFile(p.fileId)?.file.name ?? msg('its document') }));
      return;
    }
    navigate(p.link.pageIndex, p.link.rect);
    if (!p.pinned) setLinkPreviews((ps) => ps.filter((x) => x.id !== id));
  };

  /**
   * The area of a Snapshot as vector content: the page cut to it as a PDF of its own, with the
   * markups over it (unless left out) as a see-through picture drawn over that. Null when the page
   * cannot be cut, or the result is too large to keep in a markup.
   */
  const vectorSnapshot = async (o: OpenFile, pageIndex: number, region: { x0: number; y0: number; w: number; h: number; scale: number; canvas: HTMLCanvasElement }, withMarkups: boolean): Promise<VectorPicture | null> => {
    const { x0, y0, w, h, scale } = region;
    let bytes: ArrayBuffer;
    try {
      bytes = await o.doc.clipRegion(pageIndex, { x: x0, y: y0, w, h });
    } catch (err) {
      console.error('Cutting the Snapshot area out of the page failed', err);
      return null;
    }
    if (bytes.byteLength > MAX_VECTOR_SNAPSHOT_BYTES) return null;
    let overlay: string | undefined;
    const store = o.store;
    const over = (b: { x: number; y: number; w: number; h: number }) => b.x < x0 + w && b.x + b.w > x0 && b.y < y0 + h && b.y + b.h > y0;
    if (withMarkups && store.forPage(pageIndex).some((m) => !m.hidden && over(markupBounds(m)))) {
      const c = document.createElement('canvas');
      c.width = region.canvas.width;
      c.height = region.canvas.height;
      const g = c.getContext('2d')!;
      g.scale(scale, scale);
      g.translate(-x0, -y0);
      const legends = { all: () => store.all(), scaleFor: (p: number) => store.scaleFor(p), scaleOf: (m: Markup) => store.scaleOf(m) };
      for (const m of store.forPage(pageIndex).sort((a, b) => a.createdAt - b.createdAt)) drawMarkup(g, m, scale, store.scaleOf(m), legends);
      overlay = c.toDataURL('image/png');
    }
    return { pdf: bytesToBase64(new Uint8Array(bytes)), width: w, height: h, ...(overlay ? { overlay } : {}) };
  };

  // Snapshot: the area as a picture (with its markups) on the clipboard; Ctrl+V pastes it as an image markup.
  // With a `polygon` the picture is the outline's box with everything outside the outline see-through.
  snapshotRef.current = (pane, pageIndex, rect, withMarkups = true, polygon) => {
    const { o } = paneParts(pane);
    if (!o) return Promise.resolve();
    return (async () => {
      // The resolution set in Preferences › Snapshot, within 4096 px on the longest side.
      const region = await renderRegion(o, pageIndex, rect, (w, h) => Math.min(settings.get().snapshotDpi / 72, 4096 / Math.max(w, h)), withMarkups);
      if (!region) return;
      const { x0, y0, w, h } = region;
      let canvas = region.canvas;
      if (polygon) {
        const clipped = document.createElement('canvas');
        clipped.width = canvas.width;
        clipped.height = canvas.height;
        const g = clipped.getContext('2d')!;
        g.beginPath();
        polygonInPixels(polygon, region.scale, region.originPx).forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.closePath();
        // Even-odd, as the erase decides what is inside an outline that crosses itself.
        g.clip('evenodd');
        g.drawImage(canvas, 0, 0);
        canvas = clipped;
      }
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) return;
      // A rectangle also keeps the area as vector content (Preferences › Snapshot), as Revu does:
      // sharp at any zoom and snapped to like the drawing. The picture stays for everything else.
      const vector = !polygon && settings.get().snapshotVector ? await vectorSnapshot(o, pageIndex, region, withMarkups) : null;
      const now = Date.now();
      const markup: Markup = {
        id: 'snapshot',
        type: 'image',
        pageIndex,
        points: [[x0, y0], [x0 + w, y0 + h]],
        style: { ...DEFAULT_STYLES.image },
        image: canvas.toDataURL('image/png'),
        ...(vector ? { vector } : {}),
        subject: 'Snapshot',
        status: 'none',
        author: authorRef.current,
        createdAt: now,
        modifiedAt: now,
      };
      // Also on the app's own clipboard, so pasting works where the system clipboard is off limits.
      clipboard.current = [markup];
      // Pasted back from the system clipboard, the picture is recognised by its pixel size and placed
      // at the size it was captured, not at a size that depends on the zoom.
      lastSnapshot.current = { width: canvas.width, height: canvas.height, markup };
      setClipboardCount(1);
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setNotice(msg('Snapshot copied to the clipboard. Ctrl+V pastes it as an image.'));
      } catch {
        setNotice(msg('Snapshot copied. Ctrl+V pastes it as an image here.'));
      }
    })().catch((err) => setError(msg('Snapshot failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
  };
  // An image pasted from another app becomes an image markup at the pointer (or the view's centre).
  pasteImageRef.current = (file, dropped) => {
    const pane: Pane = dropped?.pane ?? activePaneRef.current;
    const { c, o } = paneParts(pane);
    if (!c || !o || o.store.readOnly) return;
    const snap = dropped ? null : lastSnapshot.current;
    void (async () => {
      if (!snap) return false;
      const bitmap = await createImageBitmap(file);
      const ours = bitmap.width === snap.width && bitmap.height === snap.height;
      bitmap.close();
      if (!ours) return false;
      // Our own snapshot: placed at its captured size, like pasting it from the app's clipboard.
      const viewer = c.viewer;
      const at = lastPointer.current?.viewer === viewer ? lastPointer.current : null;
      const page = at ? viewer.pageNearClient(at.x, at.y) : viewer.currentPageIndex;
      c.tools.paste([snap.markup], page, at ? viewer.clientToPage(at.x, at.y, page) : null);
      return true;
    })()
      .catch(() => false)
      .then((done) => (done ? null : imageToDataUrl(file)))
      .then((pasted) => {
        if (!pasted) return;
        const { image, aspect } = pasted;
        const viewer = c.viewer;
        const at = dropped ?? (lastPointer.current?.viewer === viewer ? lastPointer.current : null);
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
  dropImagesRef.current = (pane, files, x, y) => {
    const { c, o } = paneParts(pane);
    if (!c || !o) return;
    const mode = settings.get().imageDrop;
    if (mode === 'newPage') {
      // Pages after the one they were dropped on, in the order dropped.
      const at = c.viewer.pageNearClient(x, y) + 1;
      void Promise.all(files.map((f) => imageToPdf(f)))
        .then((pages) => applyPageOps(pages.map((_, i) => ({ type: 'insert', source: i, at: at + i })), pages))
        .catch((err) => setError(msg('Adding the pictures failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
      return;
    }
    if (o.store.readOnly) return;
    if (mode === 'image') {
      files.forEach((f, i) => pasteImageRef.current(f, { pane, x: x + i * 24, y: y + i * 24 }));
      return;
    }
    // Attach Photo: each picture kept whole in a file attachment markup where it was dropped.
    const page = c.viewer.pageNearClient(x, y);
    const p = c.viewer.clientToPage(x, y, page);
    const s = 22 / c.viewer.zoomFor(page);
    void Promise.all(files.map((f) => fileToAttachment(f))).then((attachments) => {
      const now = Date.now();
      const ms = attachments.map(
        (attachment, i): Markup => ({ id: `photo${i}`, type: 'attachment', pageIndex: page, points: [[i * s * 1.2, 0], [i * s * 1.2 + s, s]], style: { ...DEFAULT_STYLES.attachment }, attachment, subject: 'Photo', status: 'none', author: authorRef.current, createdAt: now, modifiedAt: now }),
      );
      c.tools.paste(ms, page, [p[0] - s / 2, p[1] - s / 2]);
    }, (err) => setError(err instanceof Error ? err.message : String(err)));
  };
  viewportRef.current = (pageIndex, rect) => {
    const store = (paneB ? openB : open)?.store;
    if (!store) return;
    const n = store.allViewports().filter((x) => x.pageIndex === pageIndex).length + 1;
    // Only the part on the page counts.
    const size = (paneB ? ctlB : ctl)?.viewer.pageSize(pageIndex);
    const clipped = viewportRectFromCorners([rect.x, rect.y], [rect.x + rect.w, rect.y + rect.h], size);
    if (!clipped) return;
    store.setViewport({ id: crypto.randomUUID(), pageIndex, name: `Viewport ${n}`, rect: clipped, scale: store.scaleFor(pageIndex) });
    showPanel('measurements');
  };
  const setPageScale = (scale: Scale, allPages: boolean) => {
    const dest = paneB ? openB : open;
    dest?.store.setScale(allPages ? Array.from({ length: pageCount }, (_, i) => i) : [pageIndex], withDefaultUnits(scale));
  };
  const currentSheet = sheets[pageIndex];
  const currentStitch = stitchGroups.find((g) => g.placements.some((p) => p.pageIndex === pageIndex)) ?? null;
  const editing = editingText && (paneB ? openB : open) ? (paneB ? openB : open)!.store.get(editingText) : undefined;
  const v = paneB && ctlB ? ctlB.viewer : ctl?.viewer;
  // A model in front of the right pane makes it active too: PDF commands then have no document, rather than acting on the left pane's.
  const activeOpen = paneB && (openB || modelB) ? openB : open;
  /** The drawing the active PDF was converted from in this visit, if any. */
  const activeCad = useCadConversion(activeOpen?.file.id);
  // Review Sheet Scales rows: worked out only while the panel is open, and only when pages, sheets or scales change.
  const activePages = activeOpen?.doc.pages;
  const scaleRows = useMemo(
    () => (scaleReviewOpen && activePages ? scaleReviewRows(activePages, sheets, scales, scaleReadings?.file === activeOpen?.file.id ? scaleReadings.pages : {}, new Set(viewports.map((vp) => vp.pageIndex))) : []),
    [scaleReviewOpen, activePages, sheets, scales, scaleReadings, activeOpen?.file.id, viewports],
  );
  /** Where a sheet's number is printed (its largest copy), which tells its title block from the drawing. */
  const numberRect = (words: readonly { text: string; x0: number; y0: number; x1: number; y1: number; size: number }[], number: string | null | undefined) => {
    const hit = number ? words.filter((w) => w.text.trim() === number).sort((a, b) => b.size - a.size)[0] : undefined;
    return hit ? { x: hit.x0, y: hit.y0, w: hit.x1 - hit.x0, h: hit.y1 - hit.y0 } : null;
  };
  // While Review Sheet Scales is open, each page's scale bars, dimensions and view titles are read
  // in the background (text from the session cache, geometry from the viewer's document).
  useEffect(() => {
    if (!scaleReviewOpen || !activeOpen) return;
    const o = activeOpen;
    const ctrl = new AbortController();
    setScaleReadings({ file: o.file.id, pages: {}, done: false });
    void (async () => {
      const texts = await loadPageTexts(() => readFile(o.file.hash), o.store, () => {}, ctrl.signal);
      const pages: Record<number, PageScan> = {};
      for (let i = 0; i < texts.length; i++) {
        if (ctrl.signal.aborted) return;
        const sheet = o.store.allSheets()[i];
        const unit = o.store.hasScale(i) ? o.store.scaleFor(i).unit : (parseScaleText(sheet?.scaleText ?? '')?.unit ?? 'm');
        const { segments } = await o.doc.geometry(i);
        // Views at the page's own scale need no viewport; pages that have viewports keep theirs.
        const own = sheet?.scaleText ? parseScaleText(sheet.scaleText) : null;
        const views = o.store.allViewports().some((vp) => vp.pageIndex === i) ? [] : proposeViews(texts[i]!, texts[i]!.words, segments, own, numberRect(texts[i]!.words, sheet?.number));
        pages[i] = { readings: pageReadings(texts[i]!.words, segments, unit), views };
        if (i % 8 === 7 || i === texts.length - 1) setScaleReadings({ file: o.file.id, pages: { ...pages }, done: i === texts.length - 1 });
      }
    })().catch((err) => {
      if (!isAbort(err) && !ctrl.signal.aborted) setError(msg('Could not read the pages\' scale bars: {value}', { value: err instanceof Error ? err.message : String(err) }));
    });
    return () => ctrl.abort();
  }, [scaleReviewOpen, activeOpen]);
  /** Document → Insert → Bulk Insert PDFs: every file's pages go into the current document, in the listed order. */
  const bulkInsertDocuments = async (files: File[], where: BulkInsertWhere) => {
    setBulkInsertFiles(null);
    if (!open || !files.length) return;
    try {
      const sources: ArrayBuffer[] = [];
      for (const file of files) sources.push(isCadFile(file) ? (await convertFile(file)).pdf : isImageFile(file) ? await imageToPdf(file) : await unlockBytes(await file.arrayBuffer(), file.name));
      const at = where === 'start' ? 0 : where === 'after' ? (v?.currentPageIndex ?? pageIndex) + 1 : Number.MAX_SAFE_INTEGER;
      // Appending lands each file past the last; at a fixed position the files go in back to front so they end up in order.
      const ops = sources.map((_, i) => ({ type: 'insert' as const, source: i, at }));
      await applyPageOps(where === 'end' ? ops : ops.reverse(), sources);
    } catch (err) {
      setError(msg('Bulk insert failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
    }
  };
  const activeTools = paneB && ctlB ? ctlB.tools : ctl?.tools;
  const assistantHost = useRef<() => AssistantDocument[]>(() => []);
  assistantHost.current = () => {
    const pageFor = (t: OpenFile) => {
      if (t === open) return stats?.pageIndex ?? savedViews.current.get(t.file.id)?.pageIndex ?? 0;
      if (t === openB) return statsB?.pageIndex ?? savedViews.current.get(t.file.id)?.pageIndex ?? 0;
      return savedViews.current.get(t.file.id)?.pageIndex ?? 0;
    };
    return pdfTabs([...tabsA, ...tabsB]).map((t) => ({
      id: t.file.id,
      name: t.file.name,
      pageCount: t.doc.pages.length,
      pageIndex: pageFor(t),
      active: t === activeOpen,
      store: t.store,
      pageSize: (pageIndex: number) => {
        const page = t.doc.pages[pageIndex];
        return page ? { width: page.width, height: page.height } : null;
      },
      // get_page_image: the Snapshot picture on a white page, as PNG bytes.
      render: async (pageIndex: number, region: PageRegion, scale: number, withMarkups: boolean) => {
        const drawn = await renderRegion(t, pageIndex, region, () => scale, withMarkups);
        if (!drawn) return null;
        const { canvas, x0, y0, w, h } = drawn;
        const g = canvas.getContext('2d')!;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'destination-over';
        g.fillStyle = '#fff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
        return { png, width: canvas.width, height: canvas.height, scale, region: { x: x0, y: y0, w, h } };
      },
      text: (pageIndex: number) => t.doc.text(pageIndex),
      geometry: (pageIndex: number) => t.doc.geometry(pageIndex),
      // get_stitch_image: each sheet drawn at the size it has in the group, cut at its region and
      // match lines, outlined and numbered so the joins can be checked.
      renderStitch: async (group: StoredStitchGroup, bounds: PageRegion, scale: number, withMarkups: boolean) => {
        const W = Math.max(1, Math.ceil(bounds.w * scale));
        const H = Math.max(1, Math.ceil(bounds.h * scale));
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const g = out.getContext('2d')!;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, W, H);
        const worldToImage: Affine = [scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale];
        const outlines: { page: number; poly: [number, number][]; m: Affine }[] = [];
        for (const p of group.placements) {
          const size = t.doc.pages[p.pageIndex];
          if (!size) continue;
          const poly = visiblePolygon({ clips: p.clips, region: p.region?.map((q): [number, number] => [q[0], q[1]]) }, size.width, size.height);
          if (poly.length < 3) continue;
          const m = composeAffine(worldToImage, p.toWorld as Affine);
          outlines.push({ page: p.pageIndex, poly, m });
          // Only the part of the sheet inside the picture is drawn.
          const back = invertStitch(m);
          const corners = [[0, 0], [W, 0], [W, H], [0, H]].map((c) => applyAffine(back, c as [number, number]));
          const xs = poly.map((q) => q[0]);
          const ys = poly.map((q) => q[1]);
          const cx = corners.map((c) => c[0]);
          const cy = corners.map((c) => c[1]);
          const x0 = Math.max(Math.min(...xs), Math.min(...cx));
          const y0 = Math.max(Math.min(...ys), Math.min(...cy));
          const x1 = Math.min(Math.max(...xs), Math.max(...cx));
          const y1 = Math.min(Math.max(...ys), Math.max(...cy));
          if (x1 <= x0 || y1 <= y0) continue;
          const sheetScale = Math.min(scale * affineScale(p.toWorld as Affine), 4096 / Math.max(x1 - x0, y1 - y0));
          const drawn = await renderRegion(t, p.pageIndex, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, () => sheetScale, withMarkups);
          if (!drawn) continue;
          g.save();
          g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
          g.beginPath();
          poly.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
          g.closePath();
          g.clip();
          g.translate(drawn.x0, drawn.y0);
          g.scale(1 / sheetScale, 1 / sheetScale);
          g.drawImage(drawn.canvas, 0, 0);
          g.restore();
        }
        g.lineWidth = 1.5;
        g.font = 'bold 16px sans-serif';
        for (const { page, poly, m } of outlines) {
          const pts = poly.map((q) => applyAffine(m, q));
          g.strokeStyle = 'rgba(37, 99, 235, 0.7)';
          g.beginPath();
          pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
          g.closePath();
          g.stroke();
          const [lx, ly] = [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
          const label = `p.${page + 1}`;
          g.fillStyle = 'rgba(255, 255, 255, 0.85)';
          g.fillRect(lx - 4, ly - 16, g.measureText(label).width + 8, 22);
          g.fillStyle = 'rgba(37, 99, 235, 1)';
          g.fillText(label, lx, ly);
        }
        return { png: out.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''), width: W, height: H };
      },
    }));
  };
  // The stitched view and Stitch to New Page, for the assistant: on whichever pane shows the drawing.
  const assistantStitching: AssistantStitching = {
    show: (id, group, focusPage) => {
      const pane: Pane | null = activeOpen?.file.id === id ? (paneB ? 'b' : 'a') : open?.file.id === id ? 'a' : openB?.file.id === id ? 'b' : null;
      const c = pane ? ctlOf(pane) : null;
      if (!c) return false;
      history.current.push(c.viewer.getView());
      setCanGoBack(true);
      future.current = [];
      setCanGoForward(false);
      c.viewer.setStitch(group?.placements ?? null, focusPage);
      return true;
    },
    toPage: (id, group, withMarkups) => {
      const intoB = activeOpen?.file.id === id ? paneB : open?.file.id === id ? false : openB?.file.id === id ? true : null;
      const cur = intoB === null ? null : intoB ? openB : open;
      return cur ? stitchToNewPage(group, withMarkups, cur, intoB!) : Promise.resolve(null);
    },
  };
  // The profile's drawing standards, for get_drawing_standard and propose_standard_hints.
  const assistantStandards: AssistantStandards = {
    list: () => profiles.active().state.drawingStandards,
    save: (standard) => updateWorkspace((w) => ({ ...w, drawingStandards: [...w.drawingStandards.filter((s) => s.id !== standard.id), standard] })),
  };
  const assistantRuntime = useRef({
    documents: () => assistantHost.current(),
    commands: () => commandsRef.current,
    toolsFor: (id: string) => (open?.file.id === id ? (ctl?.tools ?? null) : openB?.file.id === id ? (ctlB?.tools ?? null) : null),
    confirm: confirmAssistant,
    stitch: assistantStitching,
    revealComparison: undefined as (() => void) | undefined,
    standards: assistantStandards,
  });
  assistantRuntime.current = {
    documents: () => assistantHost.current(),
    commands: () => commandsRef.current,
    toolsFor: (id) => (open?.file.id === id ? (ctl?.tools ?? null) : openB?.file.id === id ? (ctlB?.tools ?? null) : null),
    confirm: confirmAssistant,
    stitch: assistantStitching,
    revealComparison: () => showPanel('ai'),
    standards: assistantStandards,
  };
  useEffect(() => installAssistant(() => assistantRuntime.current), []);

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
      viewer.keepViewBetweenPages = prefs.keepViewBetweenPages;
      const cur = viewer.spread;
      if (cur.columns !== spread.columns || cur.cover !== spread.cover) viewer.setSpread(spread.columns, spread.cover);
    }
  }, [prefs.pageFilter, prefs.thinLines, prefs.keepViewBetweenPages, spread, ctl, ctlB]);

  // Read each open document's PDF layers once; layers the file starts with off count as hidden.
  useEffect(() => {
    for (const o of [open, openB]) {
      if (!o || pdfLayers[o.file.hash]) continue;
      const { hash, id } = o.file;
      setPdfLayers((all) => ({ ...all, [hash]: [] }));
      void Promise.all([readFile(hash), import('./documents/layers')])
        .then(([bytes, { readLayers, layersOnPages }]) => Promise.all([readLayers(bytes), layersOnPages(bytes)]))
        .then(([layers, pages]) => {
          setPdfLayers((all) => ({ ...all, [hash]: layers }));
          setPdfLayerPages((all) => ({ ...all, [hash]: pages }));
          setHiddenPdfLayers((all) => (all[id] ? all : { ...all, [id]: layers.filter((l) => !l.on).map((l) => l.id) }));
        })
        .catch(() => {});
    }
  }, [open, openB, pdfLayers]);

  // Markup layers switched off stay off for each pane's document, and so do the markups on a PDF
  // layer that is switched off.
  useEffect(() => {
    const hiddenFor = (o: typeof open) =>
      new Set(o ? [...(hiddenMarkupLayers[o.file.id] ?? []), ...markupLayersOfHiddenPdf(pdfLayers[o.file.hash] ?? [], hiddenPdfLayers[o.file.id] ?? [])] : []);
    ctl?.tools.setHiddenLayers(hiddenFor(open));
    ctlB?.tools.setHiddenLayers(hiddenFor(openB));
    ctl?.tools.setFadedLayers(new Set(open ? (fadedMarkupLayers[open.file.id] ?? []) : []));
    ctlB?.tools.setFadedLayers(new Set(openB ? (fadedMarkupLayers[openB.file.id] ?? []) : []));
  }, [hiddenMarkupLayers, hiddenPdfLayers, pdfLayers, fadedMarkupLayers, open, openB, ctl, ctlB]);

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

  // A grouping tool an AI client proposes for the library opens the review too.
  useEffect(() => {
    const proposed = () => toolLibrary.list().filter((t) => t.status === 'proposed').length;
    let seen = proposed();
    return toolLibrary.subscribe(() => {
      const now = proposed();
      if (now > seen) {
        setTakeoffReviewOpen(true);
        setNotice(msg('An AI client proposed a grouping tool. Review it in Takeoff › Review AI Takeoff › Tools: it cannot run until you accept it.'));
      }
      seen = now;
    });
  }, []);

  // AI results (drafts, assembly and count proposals) open Review AI Takeoff, so a person sees them straight away.
  useEffect(() => {
    if (!activeOpen) return;
    const store = activeOpen.store;
    // Proposals from before they were kept in the document move into it.
    migrateLocalProposals(store);
    // Everything seen waiting so far: a person's own Undo, Review Again or deleting an approved
    // measurement brings one back, and that is no reason to open the panel. Only new ones are.
    const seen = aiWaitingKeys(store);
    // Ones that came while another document was in front are mentioned once it is.
    if (seen.size) setNotice(msg('{size} AI {size2, plural, one {result is} other {results are}} waiting for your review in Takeoff › Review AI Takeoff.', { size: seen.size, size2: seen.size }));
    return store.subscribe(() => {
      const now = aiWaitingKeys(store);
      let fresh = false;
      for (const k of now) if (!seen.has(k)) {
        seen.add(k);
        fresh = true;
      }
      if (fresh) {
        setTakeoffReviewOpen(true);
        setNotice(msg('{size} AI {size2, plural, one {result is} other {results are}} waiting for your review. Nothing counts towards the takeoff until you approve it.', { size: now.size, size2: now.size }));
      }
    });
  }, [activeOpen]);


  /** Stitch to New Page: the group's sheets joined on one new last page, with copies of their markups. */
  const stitchToNewPage = async (group: StoredStitchGroup, withMarkups: boolean, cur: OpenFile | null = activeOpen, intoB: boolean = paneB): Promise<{ pageIndex: number; markups: number } | null> => {
    if (!cur || cur.store.readOnly) return null;
    try {
      const { stitchToPage, stitchedMarkups } = await import('./documents/stitchPages');
      const result = await stitchToPage(await readFile(cur.file.hash), group);
      const root = group.placements[0]!.pageIndex;
      const rootScale = cur.store.allScales()[root];
      let copied = 0;
      await swapDocument(
        cur,
        intoB,
        result.bytes.slice().buffer,
        () => {
          // Measurements on the new page read at the first sheet's scale (the others were scaled to it).
          if (rootScale) cur.store.setScale([result.pageIndex], { ...rootScale, metersPerPoint: rootScale.metersPerPoint / result.shrink });
          if (!withMarkups) return;
          const copies = stitchedMarkups(cur.store.all(), result, () => crypto.randomUUID());
          cur.store.batch(() => copies.forEach((m) => cur.store.add(m)));
          copied = copies.length;
        },
        () => result.pageIndex,
        msg('Stitch to New Page'),
      );
      setNotice(msg('Stitched {count} sheets onto page {page}{value2}.', { count: group.placements.length, page: result.pageIndex + 1, value2: withMarkups ? ' ' + msg('with {copied, plural, one {# markup} other {# markups}}', { copied }) : '' }));
      return { pageIndex: result.pageIndex, markups: copied };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

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

  /** A measurement can be saved as a takeoff template: a drawn one (a typed quantity has no tool to arm). */
  const templateable = (m: Markup) => isMeasureKind(m.type) && m.type !== 'manual';
  /** Right-click › Save as Template: the measurement's tool, subject, layer, style, slope, depth, assembly and inputs, kept in the document and the library. */
  const saveAsTemplate = async (m: Markup) => {
    const store = activeOpen?.store;
    if (!store || store.readOnly) return;
    const assembly = m.assemblyId ? store.assemblies().find((a) => a.id === m.assemblyId) : undefined;
    const name = (await askText(msg('Save as Template'), m.subject || assembly?.name || MARKUP_LABELS[m.type], { label: msg('Pick it from Takeoff › Templates to measure more like this one: the same tool, subject, layer, style, slope, depth, assembly and inputs.'), confirm: msg('Save') }))?.trim();
    if (!name) return;
    const t: TakeoffTemplate = {
      id: crypto.randomUUID(),
      name,
      tool: m.type,
      preset: { ...(m.subject ? { subject: m.subject } : {}), ...(m.layer ? { layer: m.layer } : {}), style: structuredClone(m.style), ...(m.slope ? { slope: structuredClone(m.slope) } : {}), ...(m.depth ? { depth: m.depth } : {}) },
      ...(assembly ? { assemblyId: assembly.id } : {}),
      ...(assembly && m.assemblyInputs ? { inputs: { ...m.assemblyInputs } } : {}),
    };
    store.checkpoint();
    store.setEstimating({ templates: [...store.estimating().templates, t] });
    // The library gets it too, with its assembly and what that prices from, for other documents.
    const kept = addToLibrary({ ...referencedRecords(documentFile(store), assembly ? [assembly.id] : []), templates: [t] });
    setNotice(msg('Saved the template “{name}”{value}. Pick it from Takeoff › Templates to measure more like it.', { name, value: kept ? '' : ' ' + msg('in this document (this browser would not keep the library)') }));
  };
  /** Arms a takeoff template's tool; one from the library is copied into the document first, with its assembly. */
  const armTemplate = (t: TakeoffTemplate) => {
    const store = activeOpen?.store;
    const tools = activeTools;
    if (!store || !tools) return;
    if (!store.readOnly && !store.estimating().templates.some((x) => x.id === t.id)) {
      store.checkpoint();
      store.batch(() => {
        copyIntoDocument(store, libraryFile(), t.assemblyId ? [t.assemblyId] : []);
        store.setEstimating({ templates: [...store.estimating().templates, t] });
      });
    }
    const assemblyId = t.assemblyId && store.assemblies().some((a) => a.id === t.assemblyId) ? t.assemblyId : undefined;
    tools.setTool(t.tool as Tool, {
      ...(t.preset.subject ? { subject: t.preset.subject } : {}),
      ...(t.preset.layer ? { layer: t.preset.layer } : {}),
      ...(t.preset.style ? { style: structuredClone(t.preset.style) } : {}),
      ...(t.preset.slope ? { slope: t.preset.slope } : {}),
      ...(t.preset.depth ? { depth: t.preset.depth } : {}),
      ...(assemblyId ? { assemblyId, ...(t.inputs ? { assemblyInputs: t.inputs } : {}) } : {}),
      takeoffTemplateId: t.id,
    });
    setNotice(msg('Template “{name}” armed: each {value} you draw gets its {value2}settings.', { name: t.name, value: MARKUP_LABELS[t.tool as Markup['type']]?.toLowerCase() ?? msg('measurement'), value2: assemblyId ? msg('assembly and ') : '' }));
  };

  const cellContext: CellContext = {
    scaleOf,
    sheets,
    spaces: markups.filter((m) => m.type === 'space'),
    statuses: columnSet.statuses,
    columns: columnSet.columns,
    assemblies: takeoffAssemblies,
  };
  /** The measurement the Assemblies window shows quantities for while editing: the first one selected. */
  const takeoffSample = markups.find((m) => toolsState.selected.has(m.id) && isMeasureKind(m.type) && m.type !== 'angle') ?? null;
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
  const useToolItem = (item: ToolChestItem, mode: 'copy' | 'style' = item.mode ?? settings.get().toolChestMode) => {
    const tools = activeTools;
    if (!tools) return;
    if (item.markups?.length && mode === 'copy') {
      // Sets that scale to the page grow or shrink saved tools so they keep their real-world size.
      const set = profiles.active().state.toolChests.find((t) => t.items.some((i) => i.id === item.id));
      const store = activeOpen?.store;
      const k = set?.scaleToPage && item.metersPerPoint && store?.hasScale(pageIndex) ? item.metersPerPoint / store.scaleFor(pageIndex).metersPerPoint : 1;
      const template = k === 1 ? item.markups : item.markups.map((m) => ({ ...m, points: m.points.map(([x, y]) => [x * k, y * k] as [number, number]) }));
      tools.setTool(item.type, { id: item.id, template, ...(item.subject ? { subject: item.subject } : {}), ...(item.markupLabel ? { label: item.markupLabel } : {}), ...(item.layer ? { layer: item.layer } : {}), ...(item.sequence ? { sequence: item.sequence } : {}), once: !settings.get().toolChestSticky });
      return;
    }
    if (item.type === 'signature') {
      if (!item.image) return;
      const img = new Image();
      img.onload = () => tools.setTool('signature', { id: item.id, image: item.image, aspect: img.naturalWidth / img.naturalHeight || 3, subject: item.subject, once: true });
      img.src = item.image;
      return;
    }
    // Draw-with-style still places the saved picture, stamp wording or file. Copy mode (above) places
    // the markup at the size it was saved.
    const carried = item.markups?.find((m) => m.image || m.stamp || m.attachment);
    const [p0, p1] = carried?.points ?? [];
    const aspect = p0 && p1 ? Math.abs(p1[0] - p0[0]) / Math.max(1e-6, Math.abs(p1[1] - p0[1])) : undefined;
    const form = carried?.stamp?.form;
    const stamp = carried?.stamp
      ? form
        ? withFieldValues({ id: item.id, name: item.subject || item.label, ...formStamp(carried.stamp)! }, form.values)
        : { id: item.id, name: item.subject || item.label, lines: carried.stamp.lines, color: item.style.stroke, frame: carried.stamp.frame, ...(carried.stamp.art ? { art: carried.stamp.art } : {}) }
      : undefined;
    tools.setTool(item.tool ?? item.type, {
      id: item.id,
      style: item.style,
      ...(item.subject ? { subject: item.subject } : {}),
      ...(item.markupLabel ? { label: item.markupLabel } : {}),
      ...(item.comment ? { comment: item.comment } : {}),
      ...(item.layer ? { layer: item.layer } : {}),
      ...(carried?.image ? { image: carried.image, ...(aspect ? { aspect } : {}) } : {}),
      ...(stamp ? { stamp } : {}),
      ...(carried?.attachment ? { attachment: carried.attachment } : {}),
    });
  };

  /** Takeoff totals as text lines for the summary. */
  const takeoffTotals = (list: readonly Markup[]): string[] => {
    const totals = new Map<MeasureKind, { value: number; scale: Scale; n: number }>();
    for (const m of list) {
      // AI drafts wait for review: left out of totals, as in reports.
      if (!isMeasureKind(m.type) || m.type === 'angle' || isAiDraft(m)) continue;
      const scale = scaleOf(m);
      const kind = measureKindOf(m);
      const t = totals.get(kind) ?? { value: 0, scale, n: 0 };
      t.value += measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m), scale.yMetersPerPoint);
      t.n++;
      totals.set(kind, t);
    }
    return [...totals].map(([kind, t]) => `Total ${MARKUP_LABELS[kind]} (${t.n}): ${formatMeasure(kind, t.value, t.scale)}`);
  };

  const runExport = async (req: SummaryExportRequest) => {
    const job = startJob('Markup summary', { kind: 'export', cancellable: false });
    const held: { open: OpenFile; release: () => void }[] = [];
    try {
      const sources = [];
      for (const file of req.files) {
        const h = await acquireDocument(file.id);
        held.push(h);
        const cur = h.open;
        const set = cur.store.columnSet();
        const all = cur.store.all();
        const scales = cur.store.allScales();
        const viewports = cur.store.allViewports();
        sources.push({
          id: file.id,
          fileName: cur.file.name,
          pageCount: cur.doc.pages.length,
          currentPage: cur.file.id === activeOpen?.file.id ? pageIndex + 1 : 1,
          scope: file.scope,
          markups: all,
          ctx: {
            scaleOf: (m: Markup) => scaleOfMarkup(m, scales[m.pageIndex] ?? DEFAULT_SCALE, viewports),
            sheets: cur.store.allSheets(),
            spaces: all.filter((m) => m.type === 'space'),
            statuses: set.statuses,
            columns: set.columns,
            assemblies: cur.store.resolvedAssemblies(),
          },
        });
      }
      const { buildSummary } = await import('./summary/exportSummary');
      const built = buildSummary(req.config, sources);
      const blobs: { name: string; blob: Blob }[] = [];
      for (const file of built) {
        if (file.pdf) {
          const { summaryPdf } = await import('@nb/markup/summary');
          const append = req.config.AppendToCurrentPDF && req.config.ExportFormat === 2 && built.length === 1 && held.length === 1 ? await annotatedBytes(held[0]!.open) : undefined;
          const out = await summaryPdf(file.pdf, append);
          blobs.push({ name: file.filename, blob: new Blob([out as BlobPart], { type: 'application/pdf' }) });
        } else if (file.text != null) {
          const body = file.mime === 'text/csv' ? `\uFEFF${file.text}` : file.text;
          blobs.push({ name: file.filename, blob: new Blob([body], { type: file.mime }) });
        }
      }
      if (!blobs.length) throw new Error(msg('Nothing to export.'));
      if (req.config.ExportFormat === 3) {
        const { printPdfBytes } = await import('./documents/printPdf');
        printPdfBytes(new Uint8Array(await blobs[0]!.blob.arrayBuffer()));
      } else if (req.directory) {
        for (const file of blobs) await writeSummaryFile(req.directory, file.name, file.blob, req.config.ReplaceExistingFiles);
        if (req.config.OpenDocument) window.open(URL.createObjectURL(blobs[0]!.blob));
      } else if (blobs.length > 1) {
        const { zipFiles } = await import('./documents/zip');
        const parts = await Promise.all(blobs.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
        download(`${(req.config.Title || 'Markup summary').trim() || 'Markup summary'}.zip`, new Blob([zipFiles(parts) as BlobPart], { type: 'application/zip' }));
      } else {
        download(blobs[0]!.name, blobs[0]!.blob);
        if (req.config.OpenDocument) {
          const url = URL.createObjectURL(blobs[0]!.blob);
          window.open(url);
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      }
      setSummaryOpen(false);
    } catch (err) {
      setError(msg('Markup summary failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
    } finally {
      for (const h of held) h.release();
      job.end();
    }
  };

  /** The list's filter and sort, limited to columns this document has. */
  const listKeys = new Set(listLayout.map((c) => c.key));
  const listFilters = Object.fromEntries(Object.entries(ws.list.filters).filter(([k]) => listKeys.has(k)));
  const listSort = ws.list.sort && listKeys.has(ws.list.sort.key) ? ws.list.sort : null;
  const openSummaryExport = () => setSummaryOpen(true);

  // Keep a spreadsheet in step with the Markups list, when this document has one connected.
  const sheetSync = useSheetSync(activeOpen?.file.name ?? null);
  const syncTable = useMemo(
    () => (sheetSync.link || syncOpen ? toTable(withThreads(buildRows(markups.filter((m) => m.type !== 'space'), cellContext, listFilters, listSort, ws.list.advanced), cellContext), visibleListColumns) : null),
    // The context and layout are rebuilt every render; these are what they depend on.
    [sheetSync.link, syncOpen, markups, scaleOf, sheets, columnSet, ws.list],
  );
  // Import from Excel: what the workbook would change, against every markup and column (not only those the list shows).
  const importPlan = useMemo(
    () =>
      importExcel && activeOpen?.file.id === importExcel.fileId
        ? planImport(importExcel.book, { rows: withThreads(buildRows(markups, cellContext, {}, null), cellContext), columns: listColumns(columnSet.columns), statuses: columnSet.statuses, templates: registerTemplates }, { docId: importExcel.fileId, aliases: importExcel.aliases })
        : null,
    // The context is rebuilt every render; these are what it depends on.
    [importExcel, activeOpen?.file.id, markups, scaleOf, sheets, columnSet, registerTemplates],
  );
  const saveRegisterTemplate = (t: RegisterTemplate) => updateWorkspace((w) => ({ ...w, registerTemplates: [...(w.registerTemplates ?? []).filter((x) => x.id !== t.id), t] }));
  /** The markups a register lists: those that say something (a comment, text, or a reply), or every markup. Spaces are never comments. */
  const registerMarkups = (scope: RegisterScope) => markups.filter((m) => m.type !== 'space' && (scope === 'all' || isComment(m)));
  /** The register template that says what closed means for this document: the one picked in Close-out, else the client's. */
  const closeOutTemplateOf = (store: MarkupStore) => (closeOutTemplate === null ? templateFor(registerTemplates, store.drawingStandard()?.id) : registerTemplates.find((t) => t.id === closeOutTemplate));
  // A followed link: once its document is in front and has its markups, go to the comment.
  useEffect(() => {
    if (!pendingLink || activeOpen?.file.id !== pendingLink.fileId) return;
    const m = markups.find((x) => x.id === pendingLink.markupId);
    if (m) {
      setPendingLink(null);
      const b = shapeBounds(m);
      const pad = Math.max(48, Math.max(b.w, b.h));
      navigate(m.pageIndex, { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
      (paneB ? ctlB : ctl)?.tools.select([m.id]);
      return;
    }
    // A document's own annotations are read in after it opens: give them a moment before saying it is gone.
    const wait = setTimeout(() => {
      setPendingLink(null);
      setNotice(msg('The comment this link is for is no longer in the document.'));
    }, Math.max(0, pendingLink.since + 8000 - Date.now()));
    return () => clearTimeout(wait);
    // The markups are what is waited for.
  }, [pendingLink, activeOpen?.file.id, markups]);

  /** A picture of each markup with the drawing around it, for a register's thumbnail column. Small JPEGs: they travel by email. */
  const registerThumbs = async (o: OpenFile, list: readonly Markup[]) => {
    const out = new Map<string, RegisterThumb>();
    for (const m of list) {
      const b = shapeBounds(m);
      const pad = Math.max(24, Math.max(b.w, b.h) * 0.25);
      const region = await renderRegion(o, m.pageIndex, { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, (w, h) => Math.min(3, THUMB_PX / Math.max(w, h)));
      if (!region) continue;
      // JPEG has no transparency: paper white behind the drawing.
      const flat = document.createElement('canvas');
      flat.width = region.canvas.width;
      flat.height = region.canvas.height;
      const g = flat.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, flat.width, flat.height);
      g.drawImage(region.canvas, 0, 0);
      const blob = await new Promise<Blob | null>((done) => flat.toBlob(done, 'image/jpeg', 0.7));
      if (blob) out.set(m.id, { data: new Uint8Array(await blob.arrayBuffer()), type: 'jpeg', width: flat.width, height: flat.height });
    }
    return out;
  };

  const exportRegister = async (template: RegisterTemplate, scope: RegisterScope, values: Partial<Record<RegisterValue, string>>, options: { fill: boolean; thumbnails: boolean }) => {
    if (!activeOpen) return;
    const { fill } = options;
    // A comment's first export records the revision of its sheet: what it was raised on.
    const listed = registerMarkups(scope);
    const raised = raisedRevisions(listed, sheets);
    if (raised.size) {
      const store = activeOpen.store;
      store.checkpoint();
      store.batch(() => {
        for (const [id, raisedRev] of raised) store.update(id, { raisedRev });
      });
      store.checkpoint();
    }
    // Links open the comment in the app they were made in: the desktop app's own scheme, or this web address.
    const linkBase: LinkBase = desktop() ? { kind: 'desktop' } : { kind: 'web', href: window.location.href };
    const linkFile = activeOpen.file;
    const linkOf = (markupId: string) => markupLinkUrl(linkBase, { doc: linkFile.id, markup: markupId, name: linkFile.name });
    const register = { rows: buildRows(listed.map((m) => (raised.has(m.id) ? { ...m, raisedRev: raised.get(m.id)! } : m)), cellContext, {}, null), columns: listColumns(columnSet.columns), statuses: columnSet.statuses, template, docId: activeOpen.file.id, exportedAt: new Date().toISOString(), values, linkOf };
    const name = `${activeOpen.file.name.replace(/\.pdf$/i, '')} ${template.name}`;
    const excel = localExcel();
    if (fill && template.clientFile && excel?.readSource && excel.fill) {
      // The client's own file: read it to place the rows, then Excel fills a copy in.
      try {
        const plan = planFill(await readWorkbook(await excel.readSource(template.clientFile.id)), register);
        if (!plan.ok) {
          setError(plan.problem);
          return;
        }
        const saved = await excel.fill(template.clientFile.id, name, plan.fill);
        if (!saved) return;
        setNotice(msg('{name} saved: the register in a copy of {name2}.', { name: saved.name, name2: template.clientFile.name }));
      } catch (err) {
        setError(err instanceof Error ? err.message : msg('The client’s file could not be filled in.'));
        return;
      }
    } else {
      let thumbnails: Map<string, RegisterThumb> | undefined;
      try {
        if (options.thumbnails) thumbnails = await registerThumbs(activeOpen, listed);
      } catch (err) {
        setError(msg('The thumbnails could not be made: {value}', { value: err instanceof Error ? err.message : String(err) }));
        return;
      }
      download(`${name}.xlsx`, new Blob([exportRegisterWorkbook({ ...register, ...(thumbnails ? { thumbnails } : {}) }) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    }
    setRegisterOpen(false);
  };
  const exportMarkupsXlsx = () => {
    if (!activeOpen) return;
    // Preferences › Markups List › Exclude Filtered Markups on Export, as for the CSV.
    const only = prefs.excludeFilteredOnExport;
    const rows = withThreads(buildRows(markups, cellContext, only ? listFilters : {}, listSort, only ? ws.list.advanced : null), cellContext);
    const bytes = exportListWorkbook({ rows, columns: visibleListColumns, statuses: columnSet.statuses, docId: activeOpen.file.id, exportedAt: new Date().toISOString() });
    download(activeOpen.file.name.replace(/\.pdf$/i, '') + ' markups.xlsx', new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  };
  const importMarkupsXlsx = async () => {
    const cur = activeOpen;
    if (!cur) return;
    const file = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!file) return;
    try {
      if (file.size > READ_LIMITS.maxBytes) throw new Error(msg('That workbook is too large to import.'));
      const book = await readWorkbook(new Uint8Array(await file.arrayBuffer()));
      setImportExcel({ fileId: cur.file.id, fileName: file.name, book, aliases: {} });
    } catch (err) {
      setError(msg('Importing {name} failed: {value}', { name: file.name, value: err instanceof Error ? err.message : String(err) }));
    }
  };
  // A two-way link has its own columns and every markup: a filter or a hidden column in the list must not look like deleted rows or columns.
  const syncColumns = sheetSync.link?.columns;
  const syncKeyed = useMemo(() => {
    if (!syncColumns || !isTwoWay(sheetSync.link)) return null;
    const all = new Map(listColumns(columnSet.columns).map((c) => [c.key, c]));
    const columns = syncColumns.flatMap((k) => all.get(k) ?? []);
    return toSyncTable(withThreads(buildRows(markups.filter((m) => m.type !== 'space'), cellContext, {}, null), cellContext), columns, { statuses: columnSet.statuses, replyColumns: [replyColumn(NEW_REPLY, NEW_REPLY_LABEL)] });
    // The context is rebuilt every render; these are what it depends on.
  }, [sheetSync.link, syncColumns, markups, scaleOf, sheets, columnSet]);
  /** The Quantities sheet: the Quantity Summary by Item over every measurement, as a second sheet of the synced workbook. */
  const quantitiesSheet = async () => {
    const { buildReport, reportPageLabel } = await import('./takeoff/reports');
    const { reportSheet } = await import('./takeoff/reportFiles');
    const table = buildReport('byItem', { markups, assemblies: takeoffAssemblies, items: estimating.items, ctx: cellContext, pageLabel: reportPageLabel(sheets) });
    return { ...reportSheet(table), name: 'Quantities' };
  };
  const [syncExtras, setSyncExtras] = useState<SheetSpec[]>([]);
  const wantQuantities = !!sheetSync.link?.quantities;
  useEffect(() => {
    if (!wantQuantities) {
      setSyncExtras((x) => (x.length ? [] : x));
      return;
    }
    let live = true;
    void quantitiesSheet().then((sheet) => live && setSyncExtras([sheet]));
    return () => {
      live = false;
    };
    // The context is rebuilt every render; these are what the quantities depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantQuantities, markups, takeoffAssemblies, estimating, scaleOf, sheets, columnSet]);
  // Edits typed in Excel, applied to the document as one undo step. Replies are from the person at this computer: it is their workbook.
  const syncApplyRef = useRef<(changes: CellChange[]) => void>(() => undefined);
  syncApplyRef.current = (changes) => {
    const store = activeOpen?.store;
    if (!store) return;
    const patches = patchesFor(changes, (id) => store.get(id), { statuses: columnSet.statuses, columns: columnSet.columns, replyAuthor: authorRef.current, now: Date.now(), newId: () => crypto.randomUUID() });
    store.checkpoint();
    store.batch(() => {
      for (const [id, patch] of patches) store.update(id, patch);
    });
    store.checkpoint();
  };
  const syncDocId = activeOpen?.file.id;
  const syncTwoWay = useMemo<TwoWay | null>(() => (syncKeyed && syncDocId ? { table: syncKeyed, docId: syncDocId, apply: (changes) => syncApplyRef.current(changes) } : null), [syncKeyed, syncDocId]);
  const pushSyncTable = sheetSync.update;
  useEffect(() => {
    if (syncTable && sheetSync.link) pushSyncTable(syncTable, wantQuantities ? syncExtras : [], syncTwoWay);
  }, [syncTable, sheetSync.link, pushSyncTable, syncExtras, wantQuantities, syncTwoWay]);

  /** Takeoff › Reports: builds the picked reports for the scope and saves them as one PDF, one workbook or CSV files. */
  const runReports = async (req: ReportRequest) => {
    const cur = activeOpen;
    if (!cur) return;
    setReportsBusy(true);
    setReportsError(null);
    try {
      const { buildReports, scopeMarkups, scopeLabel, scaleNote, reportPageLabel } = await import('./takeoff/reports');
      const { reportsXlsx, reportCsv, reportFileName } = await import('./takeoff/reportFiles');
      const listIds = new Set(buildRows(markups.filter((m) => m.type !== 'space'), cellContext, listFilters, listSort, ws.list.advanced).map((r) => r.markup.id));
      const scoped = scopeMarkups(markups, req.scope, { pageIndex, selected: toolsState.selected, listIds });
      const pageLabel = reportPageLabel(cur.store.allSheets());
      const tables = buildReports(req.reports, { markups: scoped, assemblies: takeoffAssemblies, items: estimating.items, ctx: cellContext, pageLabel });
      const base = cur.file.name.replace(/\.pdf$/i, '');
      const scope = scopeLabel(req.scope, { pageLabel: pageLabel(pageIndex), count: scoped.length });
      const date = new Date().toISOString().slice(0, 10);
      const note = scaleNote(scoped, cellContext, pageLabel);
      if (req.format === 'pdf') {
        const { reportPdf } = await import('@nb/markup/report');
        const bytes = await reportPdf({ project: base, date, scope, ...(note ? { scaleNote: note } : {}), paper: req.paper, reports: tables });
        download(`${base} - Takeoff Reports.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      } else if (req.format === 'xlsx') {
        const info = [[`Project: ${base}`], [`Cover: ${scope}`], [`Date: ${date}`], ...(note ? [[note]] : [])];
        download(`${base} - Takeoff Reports.xlsx`, new Blob([reportsXlsx(tables, info) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      } else {
        // Byte-order mark so Excel reads the CSV as UTF-8.
        const files = tables.map((t) => ({ name: reportFileName(base, t.title, 'csv'), data: new TextEncoder().encode(`\uFEFF${reportCsv(t)}`) }));
        if (files.length === 1) download(files[0]!.name, new Blob([files[0]!.data as BlobPart], { type: 'text/csv' }));
        else {
          const { zipFiles } = await import('./documents/zip');
          download(`${base} - Takeoff Reports.zip`, new Blob([zipFiles(files) as BlobPart], { type: 'application/zip' }));
        }
      }
      setReportsOpen(false);
    } catch (err) {
      setReportsError(err instanceof Error ? err.message : msg('The reports could not be made.'));
    } finally {
      setReportsBusy(false);
    }
  };
  /** What each report scope covers, for the dialog (measurements only: the reports ignore other markups). */
  const reportCounts = useMemo(() => {
    if (!reportsOpen) return { all: 0, page: 0, selection: 0, list: 0 };
    const measured = markups.filter((m) => isMeasureKind(m.type));
    const listIds = new Set(buildRows(markups.filter((m) => m.type !== 'space'), cellContext, listFilters, listSort, ws.list.advanced).map((r) => r.markup.id));
    return { all: measured.length, page: measured.filter((m) => m.pageIndex === pageIndex).length, selection: measured.filter((m) => toolsState.selected.has(m.id)).length, list: measured.filter((m) => listIds.has(m.id)).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsOpen, markups, pageIndex, toolsState.selected, scaleOf, sheets, columnSet, ws.list]);

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

  // The first markup someone makes asks for the name to sign this and later markups with.
  useEffect(() => {
    let named = false;
    try {
      named = localStorage.getItem(AUTHOR_KEY) !== null;
    } catch {
      // Storage unavailable: ask once per session.
    }
    const waiting: { store: MarkupStore; id: string }[] = [];
    let asking = false;
    MarkupStore.onAdded = (store, m) => {
      if (named || m.author !== authorRef.current) return;
      waiting.push({ store, id: m.id });
      if (asking) return;
      asking = true;
      void askText(msg('Your name'), '', { label: msg('Your markups are signed with this name. You can change it later in Preferences.'), confirm: msg('Save') }).then((name) => {
        named = true; // Declined: ask again next time the app starts, not on every markup.
        if (!name) return;
        MarkupStore.author = name;
        persistAuthor(name);
        for (const w of waiting) if (w.store.get(w.id)) w.store.update(w.id, { author: name });
      });
    };
    return () => {
      MarkupStore.onAdded = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBottomPanel = (tab: BottomTab) => {
    setBottomTab(tab);
    setShowBottom(true);
    setDockOpen(true);
  };

  const downloadCsv = (csv: string) => {
    if (!activeOpen) return;
    // Byte-order mark so Excel reads the CSV as UTF-8.
    download(activeOpen.file.name.replace(/\.pdf$/i, '') + ' markups.csv', new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
  };

  const currentPageOps = () => [v?.currentPageIndex ?? pageIndex];

  /** Dragging the Markups list's top edge resizes it; clicking the edge without dragging collapses it. */
  const onDockSplit = (e: { preventDefault(): void; clientY: number; button: number }) => {
    // Only the main button: a right or middle click on the edge does nothing.
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = dockHeight;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 3) dragged = true;
      if (dragged) setDockHeight(Math.max(80, Math.min(window.innerHeight * 0.5, startH + (startY - ev.clientY))));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
    };
    const up = () => {
      stop();
      if (!dragged) setDockOpen(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // A cancelled pointer (the browser took the touch gesture) neither resizes nor collapses.
    window.addEventListener('pointercancel', stop);
  };

  /** Dragging a side panel's inner edge resizes it; clicking the edge without dragging collapses it. */
  const onSideResize = (side: DockSide, e: { preventDefault(): void; clientX: number }) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === 'left' ? shownWidths.left : shownWidths.right;
    const setWidth = side === 'left' ? setLeftWidth : setRightWidth;
    // The right panel's inner edge is its left one: dragging it left widens the panel.
    const dir = side === 'left' ? 1 : -1;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) dragged = true;
      if (dragged) setWidth(Math.max(180, Math.min(480, startW + dir * (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragged) (side === 'left' ? setLeftOpen : setRightOpen)(false);
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

  /**
   * Split View. With other documents open, the most recently used one goes in the new pane. With only
   * one open, it is shown on both sides with the views synchronised.
   */
  const startSplit = () => {
    const front = frontTabOf('a');
    if (split || !front) return;
    const tabs = tabsARef.current;
    const partnerId = pickSplitPartner(tabs.map((t) => t.file.id), front.file.id, recentOpenIds.current);
    const partner = tabs.find((t) => t.file.id === partnerId);
    if (partner) {
      pendingMove.current = partner;
      splitOrigin.current = { id: partner.file.id, index: tabs.indexOf(partner) };
    } else pendingMirror.current = true;
    setSplit(true);
  };

  /** Swaps the two panes' tabs. */
  const swapPanes = () => {
    const a = openRef.current;
    const b = openBRef.current;
    if (!a || !b || mirrorRef.current || !ctl || !ctlB) return;
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
    // A mirrored right pane shows its document's tab too (it has none of its own in the list).
    const mirrored = pane === 'b' && mirrorRef.current && !!openB;
    const tabs = pane === 'b' ? (mirrored ? [openB] : tabsB) : tabsA;
    const front: OpenTab | null = pane === 'b' ? openB ?? modelB : open ?? modelA;
    return (
      <DocTabStrip
        label={pane === 'b' ? msg('Right pane documents') : msg('Documents')}
        activeKey={front?.file.id ?? null}
        count={tabs.length}
        onOverflowMenu={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCtxMenu({
            x: r.right,
            y: r.bottom,
            scroll: true,
            items: tabs.map((t) => ({ label: t.file.name, checked: t === front, onClick: () => activateTab(pane, t) })),
          });
        }}
        after={
          <button
            type="button"
            className="doc-tab-add"
            title={msg('New or open PDF')}
            aria-label={msg('New or open PDF')}
            onClick={(e) => {
              setActivePane(pane);
              activePaneRef.current = pane;
              const r = e.currentTarget.getBoundingClientRect();
              setCtxMenu({
                x: r.left,
                y: r.bottom,
                items: [
                  { label: msg('New PDF…'), shortcut: shortcutLabel('file.newPdf'), onClick: () => commandsRef.current.get('file.newPdf')?.run() },
                  { label: msg('Open PDF…'), shortcut: shortcutLabel('file.open'), onClick: () => openFromDisk() },
                ],
              });
            }}
          >
            +
          </button>
        }
      >
        {tabs.map((t) => {
          const session = studioDocOf(t.file.id);
          const sessionName = session ? snapshots.find((s) => s.meta.id === session.sessionId)?.meta.name : null;
          return (
            <div
              key={t.file.id}
              role="tab"
              aria-selected={t === front}
              className={`doc-tab${t === front ? ' active' : ''}`}
              title={session ? msg('{name} · Live Session {value}', { name: t.file.name, value: sessionName ?? session.sessionId }) : t.file.name}
              onClick={() => activateTab(pane, t)}
              onContextMenu={(e) => showMenu(e, tabMenu(pane, t))}
              draggable={!mirrored}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify({ pane, id: t.file.id }));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={(e) => {
                // Let go outside the window: the tab moves to a window of its own.
                const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
                if (e.dataTransfer.dropEffect === 'none' && outside) void detachTab(pane, t);
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
                if (e.button === 1) void requestCloseTab(pane, t.file.id);
              }}
            >
              {session && (
                <span className="studio-badge" title={msg('Live Session document{value}: markups sync with everyone in the session', { value: sessionName ? ` (${sessionName})` : '' })}>
                  {msg('Live')}
                </span>
              )}
              <TabName t={t} saved={savedTick} />
              <button
                type="button"
                className="close"
                title={msg('Close')}
                onClick={(e) => {
                  e.stopPropagation();
                  void requestCloseTab(pane, t.file.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        {tabs.length === 0 && <div className="doc-tab empty">{msg('No document')}</div>}
      </DocTabStrip>
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
      label: isMarkupTool(tool) ? MARKUP_LABELS[tool] : tool === 'select' ? msg('Select') : msg('Calibrate'),
      shortcut: toolShortcut(tool),
      checked: tools.getState().tool === tool,
      onClick: () => tools.setTool(tool),
    }));

  /** Tool picks in a submenu per group (Lines, Shapes, Freehand…); a group of one is listed inline. */
  const groupedToolEntries = (tools: MarkupTools, groups: ToolGroup[], keep: (t: ToolEntry) => boolean = () => true): MenuEntry[] =>
    groups.flatMap((g): MenuEntry[] => {
      const items = g.tools.filter(keep);
      if (!items.length) return [];
      if (items.length === 1) return toolEntries(tools, items);
      return [{ label: g.label, checked: items.some((t) => tools.getState().tool === t.tool), items: toolEntries(tools, items) }];
    });

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
    setNotice(msg('Captured {count, plural, one {# markup} other {# markups}}. The Capture column in the Markups list shows {value}.', { count: pictures.length, value: pictures.length === 1 ? msg('it') : msg('them') }));
  };

  /**
   * Right-click › Flatten: burns the selected markups into their pages; the rest stay markups. The
   * file as it was is kept as a revision first.
   */
  const flattenSelected = async (pane: Pane, ms: readonly Markup[]) => {
    const { c, o } = paneParts(pane);
    if (!o) return;
    if (studioDocOf(o.file.id)) {
      setError(msg('A Live Session document is shared with others, so its markups cannot be flattened here.'));
      return;
    }
    const store = o.store;
    // Links stay interactive and Spaces are not drawn, so neither is flattened.
    const targets = ms.filter((m) => m.type !== 'hyperlink' && m.type !== 'space' && !m.locked && store.mayEdit(m));
    if (!targets.length) return;
    const n = `${targets.length} markup${targets.length === 1 ? '' : 's'}`;
    if (!confirm(msg('Flatten {n} into the page? {value} part of the drawing and can no longer be edited. The file as it is now is kept as a revision.', { n, value: targets.length === 1 ? msg('It becomes') : msg('They become') }))) return;
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
      const fonts = await fontExport(fresh);
      const exported = await exportWithAnnotations(await readFile(o.file.hash), fresh, { scaleFor: (i) => store.scaleFor(i), viewports: store.allViewports(), ...(fonts.systemFonts ? { systemFonts: fonts.systemFonts } : {}), onFontFallback: fonts.onFontFallback });
      fonts.done();
      const { flattenSelection } = await import('./documents/process');
      const { bytes, count } = await flattenSelection(exported, new Set(fresh.map((m) => m.id)), drop);
      c?.tools.select([]);
      await commitDocument(o, bytes.slice().buffer, () => store.removeFlattened(targets.map((m) => m.id), drop), `Before flattening ${n}`);
      setNotice(msg('Flattened {count, plural, one {# markup} other {# markups}} into the page. File › Revisions has the file as it was.', { count }));
    } catch (err) {
      setError(msg('Flatten failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
    }
  };

  /**
   * Right-click on markups, in Bluebeam's order: clipboard and delete; type-specific edits; layer,
   * order, alignment, action, capture, flatten, group, lock, hide and legend; review; Tool Library;
   * defaults and properties.
   */
  const markupMenu = (pane: Pane, ids: string[], at?: Point, hitId?: string): MenuEntry[] => {
    const { c, o } = paneParts(pane);
    if (!c || !o) return [];
    const store = o.store;
    const ms = ids.map((id) => store.get(id)).filter((m): m is Markup => !!m);
    const first = ms[0];
    if (!first) return [];
    const ro = store.readOnly;
    const one = ms.length === 1;
    // Selecting one list row selects its whole group (a Cloud+ is a cloud and a callout). That is still one comment.
    const oneGroup = !!first.groupId && ms.every((m) => m.groupId === first.groupId);
    const replyMarkup = oneGroup ? (ms.find((m) => isTextType(m.type)) ?? first) : first;
    // A callout (alone, or with its cloud in a Cloud+) can take extra leaders; a single text box
    // becomes a callout when given one.
    const callouts = ms.filter((m) => m.type === 'callout');
    const callout = callouts.length === 1 ? callouts[0] : undefined;
    const leaderTarget = callout ?? (one && first.type === 'text' ? first : undefined);
    const status = one ? first.status : null;
    const setStatus = (s: string) => {
      store.checkpoint();
      store.batch(() => ms.forEach((m) => store.update(m.id, { status: s })));
    };
    // The connector right-clicked (or the one selected): its route is set on its own, whatever else is selected.
    const connector = [hitId ? store.get(hitId) : undefined, one ? first : undefined].find((m) => m?.type === 'connector');
    const connectorItems = (): MenuEntry[] =>
      connector
        ? [
            SEP,
            {
              label: msg('Connector'),
              disabled: ro || !!connector.locked,
              items: [
                { label: msg('Right-Angle'), checked: (connector.connect?.route ?? 'elbow') === 'elbow', onClick: () => c.tools.setRouteOf(connector.id, 'elbow') },
                { label: msg('Straight'), checked: connector.connect?.route === 'straight', onClick: () => c.tools.setRouteOf(connector.id, 'straight') },
                SEP,
                { label: msg('Reset Route'), disabled: !connector.connect?.bends, onClick: () => c.tools.setRouteOf(connector.id, 'reset') },
              ],
            },
          ]
        : [];
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
    // Right-click inside a table: its rows and columns, at the cell under the pointer (the last ones when the menu came from the list).
    const tableItems = (m: Markup): MenuEntry[] => {
      const t = tableOf(m);
      const cell = (at && tableCellAt(m, at)) || { row: t.rows.length - 1, col: t.cols.length - 1 };
      const off = ro || theirs || !!m.locked;
      // Right-clicking outside the selected cells selects the cell under the pointer; inside them, the whole block stays selected.
      const selected = c.tools.tableSelection();
      const inside = !!selected && selected.markup.id === m.id && cell.row >= selected.range.row && cell.row < selected.range.row + selected.range.rowSpan && cell.col >= selected.range.col && cell.col < selected.range.col + selected.range.colSpan;
      if (!inside) c.tools.selectTableCell(m.id, cell);
      const apply = (edit: TableEdit | null) => {
        if (!edit) return;
        store.checkpoint();
        store.update(m.id, edit);
      };
      return [
        SEP,
        { label: msg('Edit Cell Text'), disabled: off, onClick: () => setEditingCell({ id: m.id, ...cell }) },
        { label: msg('Merge Cells'), disabled: off || !c.tools.canMergeCells(), onClick: () => c.tools.mergeSelectedCells() },
        { label: msg('Split Cell'), disabled: off || !c.tools.canSplitCells(), onClick: () => c.tools.splitSelectedCells() },
        { label: msg('Insert Row Above'), disabled: off || t.rows.length >= MAX_TABLE_LINES, onClick: () => apply(insertTableRow(m, cell.row, cell.row)) },
        { label: msg('Insert Row Below'), disabled: off || t.rows.length >= MAX_TABLE_LINES, onClick: () => apply(insertTableRow(m, cell.row + 1, cell.row)) },
        { label: msg('Insert Column Left'), disabled: off || t.cols.length >= MAX_TABLE_LINES, onClick: () => apply(insertTableColumn(m, cell.col, cell.col)) },
        { label: msg('Insert Column Right'), disabled: off || t.cols.length >= MAX_TABLE_LINES, onClick: () => apply(insertTableColumn(m, cell.col + 1, cell.col)) },
        { label: msg('Delete Row {number}', { number: cell.row + 1 }), danger: true, disabled: off || t.rows.length <= 1, onClick: () => apply(deleteTableRow(m, cell.row)) },
        { label: msg('Delete Column {number}', { number: cell.col + 1 }), danger: true, disabled: off || t.cols.length <= 1, onClick: () => apply(deleteTableColumn(m, cell.col)) },
        SEP,
      ];
    };
    return [
      { label: msg('Cut'), icon: MENU_ICONS.cut, shortcut: shortcutLabel('edit.cut'), disabled: ro || allLocked, onClick: () => cutMarkups(pane) },
      { label: msg('Copy'), icon: MENU_ICONS.copy, shortcut: shortcutLabel('edit.copy'), onClick: () => copyMarkups(pane) },
      { label: msg('Paste'), icon: MENU_ICONS.paste, shortcut: shortcutLabel('edit.paste'), disabled: ro || !clipboard.current.length, onClick: () => c.tools.paste(clipboard.current, first.pageIndex, null) },
      { label: msg('Multiply…'), icon: MENU_ICONS.multiply, shortcut: shortcutLabel('edit.multiply'), disabled: ro || allLocked, onClick: () => setMultiplyFor(pane) },
      { label: msg('Format Painter'), icon: MENU_ICONS.painter, shortcut: shortcutLabel('edit.formatPainter'), disabled: ro || !one, onClick: () => c.tools.setTool('painter') },
      { label: msg('Delete'), icon: MENU_ICONS.delete, shortcut: 'Del', disabled: ro || allLocked, onClick: () => c.tools.deleteSelected() },
      SEP,
      { label: msg('Round All Corners'), checked: allRound, disabled: ro || !roundable.some((m) => !m.locked && store.mayEdit(m)), onClick: () => roundCorners(store, ms, !allRound) },
      ...(ms.some((m) => m.type === 'image' && m.image)
        ? [{ label: msg('Adjust Image…'), disabled: ro || allLocked, onClick: () => setAdjustImageFor({ pane, ids: ms.filter((m) => m.type === 'image' && m.image).map((m) => m.id) }) } as MenuEntry]
        : []),
      // A picture's own colours are swapped, not the line and fill colours the other markups have.
      { label: msg('Change Colours…'), disabled: ro || allLocked, onClick: () => (one && first.type === 'image' && first.image ? setPictureColoursFor({ pane, id: first.id }) : setChangeColoursFor({ pane, ids })) },
      { label: msg('Auto-size Text Box'), shortcut: shortcutLabel('edit.autoSize'), disabled: ro || allLocked || !ms.some(canAutoSize), onClick: () => autoSizeTextBoxes(store, ms) },
      // What only some kinds of markup have.
      // Right-click on a measurement's segment: curve it, or straighten it.
      ...(() => {
        const seg = one && at ? c.tools.segmentAt(first.id, at) : null;
        return seg
          ? [{ label: seg.curved ? msg('Convert to Line') : msg('Convert to Arc'), disabled: ro || theirs || !!first.locked, onClick: () => c.tools.setSegmentCurve(first.id, seg.segment, !seg.curved) } as MenuEntry]
          : [];
      })(),
      ...(one && isTextType(first.type) ? [{ label: msg('Edit Text'), disabled: ro || theirs || !!first.locked, onClick: () => setEditingText(first.id) }] : []),
      ...(one && first.type === 'table' ? tableItems(first) : []),
      // A count or an open line carries on from where it stopped (a line from the end nearest the click).
      ...(one && c.tools.canResumeMarkup(first.id) ? [{ label: msg('Resume'), disabled: ro || theirs || !!first.locked, onClick: () => c.tools.resume(first.id, at) } as MenuEntry] : []),
      ...(one && !isTextType(first.type) ? [{ label: first.comment ? msg('Edit Comment…') : msg('Add Comment…'), disabled: ro || theirs, onClick: () => setCommentEdit({ pane, id: first.id }) }] : []),
      ...(ms.every((m) => ROTATABLE.has(m.type))
        ? [
            {
              label: msg('Rotate'),
              disabled: ro || allLocked,
              items: [
                { label: msg('Rotate 90° Clockwise'), onClick: () => turnMarkups(store, ms, 90) },
                { label: msg('Rotate 90° Counterclockwise'), onClick: () => turnMarkups(store, ms, -90) },
                {
                  label: msg('Rotate…'),
                  onClick: () =>
                    void (async () => {
                      const help = msg('Angle in degrees, clockwise, or a grade such as 2% or 1:50 (negative falls to the right). Drag the round handle above a selected markup to turn it freely.');
                      let initial = String(first.rotation ?? 0);
                      let note = '';
                      // Ask again, with the reason, until the input is understood or the dialog is cancelled.
                      for (;;) {
                        const t = await askText(msg('Rotate'), initial, { label: note ? `${note}\n${help}` : help, confirm: msg('Rotate') });
                        if (t === null) return;
                        const r = parseRotationInput(t);
                        if (r.ok && (!r.warning || t === initial)) return turnMarkups(store, ms, r.degrees, true);
                        initial = t;
                        note = r.ok ? msg('{warning} Press Rotate again to apply it.', { warning: r.warning }) : r.error;
                      }
                    })(),
                },
                { label: msg('Reset Rotation'), disabled: !ms.some((m) => m.rotation), onClick: () => turnMarkups(store, ms, 0, true) },
              ],
            },
          ]
        : []),
      ...(leaderTarget
        ? [
            { label: msg('Add Leader'), disabled: ro || !!leaderTarget.locked || !store.mayEdit(leaderTarget), onClick: () => c.tools.addCalloutLeader(leaderTarget.id) } as MenuEntry,
            ...(leaderTarget.type === 'callout' && leaderTarget.points.length >= 6
              ? [{ label: msg('Remove Last Leader'), disabled: ro || !!leaderTarget.locked || !store.mayEdit(leaderTarget), onClick: () => c.tools.removeCalloutLeader(leaderTarget.id) } as MenuEntry]
              : []),
          ]
        : []),
      ...(one && first.attachment
        ? [
            { label: msg('Open Attachment'), onClick: () => openAttachment(first) },
            { label: msg('Save Attachment…'), onClick: () => download(first.attachment!.name, attachmentBlob(first.attachment!)) },
          ]
        : []),
      ...(one && first.type === 'image' && first.image
        ? [
            { label: msg('Crop Image'), disabled: ro || !!first.locked, onClick: () => c.tools.setTool('cropImage') } as MenuEntry,
            { label: msg('Reset Crop'), disabled: ro || !!first.locked || !cropOf(first), onClick: () => c.tools.resetCropSelected() } as MenuEntry,
          ]
        : []),
      ...connectorItems(),
      SEP,
      {
        label: msg('Layer'),
        disabled: ro,
        items: [
          ...[...new Set([...store.all().flatMap((m) => (m.layer ? [m.layer] : [])), ...(o ? addedMarkupLayers(o.file.hash) : [])])].sort().map((name) => ({
            label: name,
            checked: ms.every((m) => m.layer === name),
            onClick: () => setAll(() => ({ layer: name })),
          })),
          { label: msg('No Layer'), checked: ms.every((m) => !m.layer), onClick: () => setAll(() => ({ layer: undefined })) },
          SEP,
          {
            label: msg('New Layer…'),
            onClick: () =>
              void askText(msg('New Markup Layer'), '', { label: msg('The selected markups move to it. Layers show and hide in the Layers panel, and are PDF layers in saved files.'), confirm: msg('Create') }).then((name) => {
                if (name) setAll(() => ({ layer: name }));
              }),
          },
        ],
      },
      {
        label: msg('Order'),
        disabled: ro,
        items: [
          { label: msg('Bring to Front'), shortcut: shortcutLabel('edit.bringToFront'), onClick: () => c.tools.arrange(ids, 'front') },
          { label: msg('Bring Forward'), shortcut: shortcutLabel('edit.bringForward'), onClick: () => c.tools.arrange(ids, 'forward') },
          { label: msg('Send Backward'), shortcut: shortcutLabel('edit.sendBackward'), onClick: () => c.tools.arrange(ids, 'backward') },
          { label: msg('Send to Back'), shortcut: shortcutLabel('edit.sendToBack'), onClick: () => c.tools.arrange(ids, 'back') },
        ],
      },
      {
        label: msg('Alignment'),
        disabled: ro || allLocked,
        items: [
          { label: msg('Align Left'), shortcut: shortcutLabel('edit.alignLeft'), disabled: one || anyLocked, onClick: () => commandsRef.current.get('edit.alignLeft')?.run() },
          { label: msg('Align Center'), shortcut: shortcutLabel('edit.alignCenter'), disabled: one || anyLocked, onClick: () => commandsRef.current.get('edit.alignCenter')?.run() },
          { label: msg('Align Right'), shortcut: shortcutLabel('edit.alignRight'), disabled: one || anyLocked, onClick: () => commandsRef.current.get('edit.alignRight')?.run() },
          { label: msg('Align Top'), shortcut: shortcutLabel('edit.alignTop'), disabled: one || anyLocked, onClick: () => commandsRef.current.get('edit.alignTop')?.run() },
          { label: msg('Align Middle'), shortcut: shortcutLabel('edit.alignMiddle'), disabled: one || anyLocked, onClick: () => commandsRef.current.get('edit.alignMiddle')?.run() },
          { label: msg('Align Bottom'), shortcut: shortcutLabel('edit.alignBottom'), disabled: one || anyLocked, onClick: () => commandsRef.current.get('edit.alignBottom')?.run() },
          { label: msg('Center in Document'), disabled: anyLocked, onClick: () => commandsRef.current.get('edit.centerInDocument')?.run() },
          SEP,
          { label: msg('Distribute Horizontally'), disabled: ms.length < 3 || anyLocked, onClick: () => commandsRef.current.get('edit.distributeHorizontal')?.run() },
          { label: msg('Distribute Vertically'), disabled: ms.length < 3 || anyLocked, onClick: () => commandsRef.current.get('edit.distributeVertical')?.run() },
          SEP,
          { label: msg('Same Width'), disabled: one, onClick: () => commandsRef.current.get('edit.sameWidth')?.run() },
          { label: msg('Same Height'), disabled: one, onClick: () => commandsRef.current.get('edit.sameHeight')?.run() },
          { label: msg('Same Size'), disabled: one, onClick: () => commandsRef.current.get('edit.sameSize')?.run() },
          SEP,
          { label: msg('Flip Horizontal'), shortcut: shortcutLabel('edit.flipHorizontal'), disabled: anyLocked, onClick: () => commandsRef.current.get('edit.flipHorizontal')?.run() },
          { label: msg('Flip Vertical'), shortcut: shortcutLabel('edit.flipVertical'), disabled: anyLocked, onClick: () => commandsRef.current.get('edit.flipVertical')?.run() },
          SEP,
          { label: msg('Scale to Length…'), onClick: () => c.tools.setTool('scaleLength') },
        ],
      },
      // Any markup can carry an action (a flag that opens a detail, a cloud that opens an RFI page).
      { label: msg('Edit Action…'), shortcut: shortcutLabel('edit.editAction'), disabled: ro || theirs || !one, onClick: () => setHyperlinkEdit({ pane, id: first.id }) },
      {
        label: msg('Capture'),
        disabled: ro,
        items: [
          {
            label: ms.some((m) => m.capture) ? msg('Capture Again') : msg('Capture'),
            disabled: theirs,
            onClick: () => void captureMarkups(o, ms).catch((err) => setError(msg('Capture failed: {value}', { value: err instanceof Error ? err.message : String(err) }))),
          },
          { label: msg('View Capture'), disabled: !one || !first.capture, onClick: () => setCaptureView(first.capture ?? null) },
          { label: msg('Remove Capture'), disabled: theirs || !ms.some((m) => m.capture), onClick: () => setAll(() => ({ capture: undefined })) },
        ],
      },
      { label: msg('Flatten'), icon: MENU_ICONS.flatten, disabled: ro || allLocked || !!session || ms.every((m) => m.type === 'hyperlink' || m.type === 'space') || commandPolicy('document.flatten').disabledReason !== null, onClick: commandPolicy('document.flatten').run(() => void flattenSelected(pane, ms)) },
      grouped
        ? { label: msg('Ungroup'), shortcut: shortcutLabel('edit.ungroup'), disabled: ro || allLocked, onClick: () => c.tools.ungroup() }
        : { label: msg('Group'), shortcut: shortcutLabel('edit.group'), disabled: ro || one || allLocked, onClick: () => c.tools.group() },
      { label: anyLocked ? msg('Unlock') : msg('Lock'), shortcut: shortcutLabel('edit.lock'), disabled: ro || theirs, onClick: () => c.tools.setLocked(!anyLocked) },
      {
        label: ms.every((m) => m.hidden) ? msg('Show') : msg('Hide'),
        icon: MENU_ICONS.hide,
        disabled: ro,
        onClick: () => {
          const hide = !ms.every((m) => m.hidden);
          setAll(() => ({ hidden: hide || undefined }));
          if (hide) c.tools.select([]);
        },
      },
      {
        label: msg('Legend'),
        icon: MENU_ICONS.legend,
        disabled: ro,
        items: [
          {
            label: msg('Show in Legends'),
            checked: ms.every((m) => !m.legendHidden),
            disabled: theirs,
            onClick: () => {
              const show = !ms.every((m) => !m.legendHidden);
              setAll(() => ({ legendHidden: show ? undefined : true }));
            },
          },
          { label: msg('New Legend'), onClick: () => c.tools.setTool('legend') },
          ...(one && first.type === 'legend'
            ? [
                SEP,
                ...(['page', 'document'] as const).map((scope) => ({
                  label: scope === 'page' ? msg('Lists Markups on This Page') : msg('Lists Markups in the Document'),
                  checked: (first.legend?.scope ?? 'page') === scope,
                  onClick: () => store.update(first.id, { legend: { scope } }),
                })),
              ]
            : []),
        ],
      },
      SEP,
      { label: msg('Reply'), icon: MENU_ICONS.reply, disabled: ro || !(one || oneGroup), onClick: () => setReplyTo({ pane, id: replyMarkup.id }) },
      {
        label: msg('Set Status'),
        disabled: ro,
        items: store.columnSet().statuses.map((s) => ({
          label: s.id === 'none' ? msg('None') : s.name,
          checked: status === s.id,
          onClick: () => setStatus(s.id),
        })),
      },
      {
        label: msg('Check'),
        checked: ms.every((m) => m.checked),
        disabled: ro,
        onClick: () => {
          const check = !ms.every((m) => m.checked);
          setAll(() => ({ checked: check || undefined }));
        },
      },
      {
        label: ms.every((m) => m.flagged) ? msg('Unflag') : msg('Flag'),
        disabled: ro,
        onClick: () => {
          const flag = !ms.every((m) => m.flagged);
          setAll(() => ({ flagged: flag || undefined }));
        },
      },
      ...(session
        ? [
            {
              label: msg('Send Markup Alert…'),
              disabled: !one || sessionById(session.sessionId)?.meta.status !== 'active',
              onClick: () =>
                void askText(msg('Send Markup Alert'), first.comment ?? '', { label: msg('Everyone in the session is shown this markup, with your message.'), confirm: msg('Send') }).then((text) => {
                  if (text) sessionById(session.sessionId)?.sendAlert(session.docId, first.id, first.pageIndex, text);
                }),
            },
          ]
        : []),
      SEP,
      {
        label: msg('Add to Tool Library'),
        items: [
          ...profiles
            .active()
            .state.toolChests.filter((t) => t.id !== RECENT_TOOLS_ID)
            .map((t) => ({ label: t.name, onClick: () => toolChestItemsOf(ms, store).forEach((item) => addToToolSet(t.id, item)) })),
          SEP,
          {
            label: msg('New Tool Set…'),
            onClick: () =>
              void askText(msg('New Tool Set'), 'My Tools', { confirm: msg('Create') }).then((name) => {
                if (name) {
                  const id = createToolSet(name);
                  toolChestItemsOf(ms, store).forEach((item) => addToToolSet(id, item));
                }
              }),
          },
        ],
      },
      ...(ms.some(canBeCountSymbol)
        ? [
            {
              label: msg('Save as Count Symbol…'),
              onClick: () =>
                void askText(msg('Save as Count Symbol'), first.subject || MARKUP_LABELS[first.type], {
                  label: msg('Name for this custom Count marker symbol (saved to your profile):'),
                  confirm: msg('Save'),
                }).then((name) => {
                  if (!name?.trim()) return;
                  const sym = symbolFromMarkups(ms, name.trim(), crypto.randomUUID());
                  if (!sym) return;
                  if (!addCountSymbol(sym)) {
                    setNotice(msg('Could not save count symbol: browser storage is full.'));
                    return;
                  }
                  c.tools.setDefaultStyle('count', { countShape: undefined, countSymbol: structuredClone(sym) });
                  setNotice(msg('Saved count symbol “{name}”.', { name: sym.name }));
                }),
            },
          ]
        : []),
      ...(one && templateable(first) ? [{ label: msg('Save as Template…'), disabled: ro, onClick: () => void saveAsTemplate(first) }] : []),
      SEP,
      { label: msg('Set as Default'), disabled: !one, onClick: () => c.tools.setDefaultStyle(first.type, first.style) },
      {
        label: msg('Apply to Pages…'),
        disabled: ro || allLocked || pageCount < 2,
        onClick: () =>
          void askText(msg('Apply to Pages'), `1-${pageCount}`, { label: msg('Pages to copy the selection onto, at the same place: for example 1-3, 5, 8- (each markup’s own page is skipped).'), confirm: msg('Apply') }).then((text) => {
            const pages = text === null ? [] : parsePageRange(text, pageCount);
            if (pages.length) c.tools.applyToPages(pages);
          }),
      },
      { label: msg('Properties'), icon: MENU_ICONS.properties, onClick: () => showPanel('properties') },
    ];
  };

  /** Right-click on an empty part of a page: tools, paste, navigation, zoom, page operations. */
  const pageMenu = (pane: Pane, page: number, pt: PagePoint): MenuEntry[] => {
    const { c, o } = paneParts(pane);
    if (!c) return [];
    if (!o) return [{ label: msg('Open…'), shortcut: 'Ctrl+O', onClick: () => openFromDisk() }];
    const ro = o.store.readOnly;
    const v = c.viewer;
    const mode = (pane === 'b' ? statsB : stats)?.mode;
    const count = o.doc.pages.length;
    const shared = !!studioDocOf(o.file.id);
    const pageOps = shared || busyPages;
    const geo = geoAt(o.store.allGeoRegions(), page, pt);
    // Where the point lies on the map, for finding what is there in an open 3D model.
    const models = [...tabsA, ...tabsB];
    const grid = models.some((t) => t.kind === 'model') ? gridAtPage(o.store.allGeoRegions(), page, pt) : null;
    // While a polylength or area is being drawn, its next segment can be made a 3-point arc.
    const arcOn = c.tools.getState().arc !== 'off';
    const arcEntry: MenuEntry[] = !ro && c.tools.getState().measuring && (arcOn || c.tools.canArc()) ? [{ label: msg('Arc (3-point)'), shortcut: shortcutLabel('draw.arc'), checked: arcOn, onClick: () => c.tools.toggleArc() }, SEP] : [];
    return [
      ...arcEntry,
      ...toolEntries(c.tools, MARKUP_TOOLS.filter((t) => t.tool === 'select')),
      { label: msg('Markup'), disabled: ro, items: groupedToolEntries(c.tools, MARKUP_GROUPS, (t) => t.tool !== 'select') },
      { label: msg('Measure'), disabled: ro, items: groupedToolEntries(c.tools, MEASURE_GROUPS) },
      SEP,
      { label: msg('Paste'), shortcut: 'Ctrl+V', disabled: ro || !clipboard.current.length, onClick: () => c.tools.paste(clipboard.current, page, pt) },
      { label: msg('Select All Markups'), shortcut: 'Ctrl+A', onClick: () => c.tools.select(o.store.all().map((m) => m.id)) },
      ...(geo ? [{ label: msg('Copy Coordinates'), onClick: () => void navigator.clipboard.writeText(formatLatLon(geo.lat, geo.lon, settings.get().geoFormat)).catch(() => {}) }] : []),
      ...(grid && models.some((t) => t.kind === 'model') ? [{ label: msg('Find in 3D'), disabled: !mapModel(), onClick: () => findIn3d(grid) }] : []),
      SEP,
      { label: msg('Previous View'), shortcut: 'Alt+←', disabled: !canGoBack, onClick: goBack },
      { label: msg('Previous Page'), shortcut: 'PgUp', disabled: page <= 0, onClick: () => v.prevPage() },
      { label: msg('Next Page'), shortcut: 'PgDn', disabled: page >= count - 1, onClick: () => v.nextPage() },
      SEP,
      { label: msg('Zoom In'), shortcut: '+', onClick: () => v.zoomSteps(settings.get().buttonZoomStep, 1) },
      { label: msg('Zoom Out'), shortcut: '−', onClick: () => v.zoomSteps(settings.get().buttonZoomStep, -1) },
      { label: msg('Fit Page'), shortcut: 'Ctrl+9', onClick: () => v.fit() },
      { label: msg('Fit Width'), shortcut: 'Ctrl+0', onClick: () => v.fitToWidth() },
      { label: msg('Actual Size'), shortcut: 'Ctrl+8', onClick: () => v.actualSize() },
      { label: msg('Single Page'), shortcut: 'Ctrl+4', checked: mode === 'single', onClick: () => v.setPageMode('single') },
      { label: msg('Continuous'), shortcut: 'Ctrl+5', checked: mode === 'continuous', onClick: () => v.setPageMode('continuous') },
      SEP,
      {
        label: msg('Rotate Page'),
        disabled: pageOps,
        items: [
          { label: msg('Clockwise'), onClick: () => void applyPageOps([{ type: 'rotate', pages: [page], quarterTurns: 1 }]) },
          { label: msg('Counterclockwise'), onClick: () => void applyPageOps([{ type: 'rotate', pages: [page], quarterTurns: 3 }]) },
          { label: '180°', onClick: () => void applyPageOps([{ type: 'rotate', pages: [page], quarterTurns: 2 }]) },
        ],
      },
      { label: msg('Insert Pages…'), disabled: pageOps, onClick: () => insertFileRef.current?.click() },
      { label: msg('Extract Page…'), disabled: busyPages, onClick: () => void extractPages([page]) },
      {
        label: msg('Delete Page…'),
        disabled: pageOps || count < 2,
        onClick: () => {
          if (confirm(msg('Delete page {page}? Markups on it are deleted too.', { page: page + 1 }))) void applyPageOps([{ type: 'delete', pages: [page] }]);
        },
      },
      SEP,
      { label: msg('Page Labels from Region…'), disabled: ro, onClick: () => startLabelRegions(pane) },
      { label: msg('Bulk Apply Page Scale…'), disabled: ro, onClick: () => startLabelRegions(pane, 'scale') },
      { label: msg('Thumbnails'), onClick: () => showPanel('pages') },
      { label: msg('Properties'), onClick: () => showPanel('properties') },
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
    showMenu(e, markupMenu(pane, ids, [pt[0], pt[1]], hit.id));
  };

  const copyMarkups = (pane: Pane) => {
    const tools = paneParts(pane).c?.tools;
    // Selected PDF text copies as text; markups copy as markups.
    const text = tools?.selectedPdfText();
    if (text) {
      void navigator.clipboard?.writeText(text).then(
        () => setNotice(msg('Copied {count, plural, one {# character} other {# characters}}.', { count: text.length })),
        () => setNotice(msg('The browser did not allow copying to the clipboard.')),
      );
      return true;
    }
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
  const moveTab = (from: Pane, t: OpenTab) => {
    const to: Pane = from === 'a' ? 'b' : 'a';
    if (to === 'b' && !ctlB) {
      pendingMove.current = t;
      setSplit(true);
      return;
    }
    // A mirrored document is already shown in both panes: nothing to move.
    if (mirrorRef.current && (from === 'b' || t === openBRef.current)) return;
    const rest = (from === 'b' ? tabsBRef.current : tabsARef.current).filter((x) => x !== t);
    const front = from === 'b' ? openBRef.current : openRef.current;
    setTabs(from, rest);
    if (front === t) showInPane(from, rest[0] ?? null);
    const dest = to === 'b' ? tabsBRef.current : tabsARef.current;
    if (!dest.includes(t)) setTabs(to, [...dest, t]);
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
    const newInB = pdfTabs(tabsBRef.current).find((t) => t.file.id === newId);
    if (newInB) moveTab('b', newInB);
    else await openFromLibrary(newFile, 'a');
    const oldInA = pdfTabs(tabsARef.current).find((t) => t.file.id === oldId);
    const oldInB = pdfTabs(tabsBRef.current).find((t) => t.file.id === oldId);
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

  /** AI Compare Documents: reads both open documents' text and starts the comparison. */
  const runSemanticCompare = (oldId: string, newId: string) => beginComparison(assistantHost.current(), oldId, newId);

  /** Shows one change in both revisions, bringing them side by side first when they are not. */
  const goToParagraph = async (change: SemanticChange, shown = false): Promise<void> => {
    const state = semanticCompare.get();
    if (!state) return;
    const req = state.request;
    const ctlFor = (id: string) => (openRef.current?.file.id === id ? ctl : openBRef.current?.file.id === id ? ctlB : null);
    // An added or removed paragraph has one side: the other revision goes to where it would be.
    const stand = counterpart(state.result.changes, change);
    const wanted = [
      { id: req.newId, p: change.new ?? stand },
      { id: req.oldId, p: change.old ?? stand },
    ].filter((w): w is { id: string; p: Pick<Paragraph, 'page' | 'box'> } => !!w.p);
    // Both revisions have to be on screen, even for a change only one of them has.
    if (!shown && [req.oldId, req.newId].some((id) => !ctlFor(id))) {
      await showSideBySide(req.oldId, req.newId);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return semanticGoRef.current(change, true);
    }
    for (const { id, p } of wanted) {
      const viewer = ctlFor(id)?.viewer;
      if (!viewer) continue;
      // A stand-in placed beside its neighbour can run off the page: kept on it.
      const size = viewer.pageSize(p.page - 1);
      const w = size ? Math.min(p.box.w, size.width) : p.box.w;
      const h = size ? Math.min(p.box.h, size.height) : p.box.h;
      const x = size ? Math.min(Math.max(p.box.x, 0), size.width - w) : p.box.x;
      const y = size ? Math.min(Math.max(p.box.y, 0), size.height - h) : p.box.y;
      const pad = Math.max(w, h) * 0.3 + 24;
      viewer.zoomToRect({ x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 }, 1, p.page - 1);
    }
  };
  semanticGoRef.current = goToParagraph;

  /**
   * Moves a tab to a new window of its own (desktop app). A document with changes, or with no file
   * yet, goes as it stands now (markups included) and stays unsaved there; a saved one is simply
   * opened from its file.
   */
  const detachTab = async (pane: Pane, t: OpenTab) => {
    const host = desktop();
    if (!host?.detachDocument) return;
    if (studioDocOf(t.file.id)) return setError(msg('A Live Session document stays in the window it was opened in.'));
    if (t.kind === 'model') return setError(msg('A 3D model stays in the window it was opened in.'));
    try {
      const token = fileLocationToken(t.file.id);
      const dirty = hasUnsavedChanges(t);
      const contents = dirty || !token ? await annotatedBytes(t, { keepSigned: true }) : null;
      if (!(await host.detachDocument(token ?? '', t.file.name, contents, dirty))) return setError(msg('Could not open a new window.'));
      // Its changes live on in the new window, so closing here must not ask about them or keep them for recovery.
      rememberUnsaved(new Map([[t.file.id, false]]));
      markSaved(t);
      closeTab(pane, t.file.id, false);
    } catch (err) {
      setError(msg('Could not move the document: {value}', { value: err instanceof Error ? err.message : String(err) }));
    }
  };

  /** Right-click on a document tab: close, save, add to a session, show where it lives, move pane. */
  const tabMenu = (pane: Pane, t: OpenTab): MenuEntry[] => {
    const mirrored = pane === 'b' && mirrorRef.current;
    const tabs = mirrored ? [t] : pane === 'b' ? tabsB : tabsA;
    const idx = tabs.indexOf(t);
    const sessionDoc = studioDocOf(t.file.id);
    const snap = sessionDoc ? snapshots.find((s) => s.meta.id === sessionDoc.sessionId) : null;
    const closeMany = (which: OpenTab[]) => void requestCloseTabs(which.map((x) => ({ pane, fileId: x.file.id })));
    const withTab = (fn: () => void) => () => {
      activateTab(pane, t);
      fn();
    };
    const addable = sessions.filter((s) => s.canAddDocuments);
    const closing: MenuEntry[] = [
      { label: msg('Close'), onClick: () => void requestCloseTab(pane, t.file.id) },
      { label: msg('Close All'), onClick: () => closeMany(tabs) },
      { label: msg('Close All But This'), disabled: tabs.length < 2, onClick: () => closeMany(tabs.filter((x) => x !== t)) },
      { label: msg('Close Tabs to the Right'), disabled: idx === tabs.length - 1, onClick: () => closeMany(tabs.slice(idx + 1)) },
      { label: msg('Reopen Closed Tab'), shortcut: 'Ctrl+Shift+T', disabled: closedTabs.length === 0, onClick: () => void reopenClosedTab() },
    ];
    // A 3D model has no markups to save or share, so its menu only closes it or shows where it lives.
    if (t.kind === 'model')
      return [
        ...closing,
        ...(desktop()
          ? [SEP, {
              label: msg('Open File Location'),
              disabled: locationTick < 0 || !hasFileLocation(t.file.id),
              onClick: () => void revealFileLocation(t.file.id).then((ok) => {
                if (!ok) setError(msg('That file is not in a folder on this computer. It may have been moved, renamed or deleted.'));
              }),
            }]
          : []),
      ];
    return [
      ...closing,
      SEP,
      { label: msg('Save'), shortcut: 'Ctrl+S', onClick: withTab(() => void saveDocument(false)) },
      { label: msg('Save As…'), shortcut: 'Ctrl+Shift+S', onClick: withTab(() => void saveDocument(true)) },
      ...(desktop()?.detachDocument
        ? [{
            label: msg('Move to New Window'),
            onClick: () => void detachTab(pane, t),
          }]
        : []),
      ...(desktop() && locationTick >= 0 && hasFileLocation(t.file.id)
        ? [{
            label: (() => {
              const p = desktop()?.platform ?? (typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : '');
              if (/win/i.test(p)) return msg('Reveal in Explorer');
              if (/mac|darwin/i.test(p)) return msg('Reveal in Finder');
              return msg('Show in File Manager');
            })(),
            onClick: () => void revealFileLocation(t.file.id).then((ok) => {
              if (!ok) setError(msg('That file is not in a folder on this computer. It may have been moved, renamed or deleted.'));
            }),
          }]
        : []),
      {
        label: msg('Save a Copy of the Original…'),
        onClick: () => void readFile(t.file.hash).then((bytes) => download(t.file.name, new Blob([bytes], { type: 'application/pdf' }))),
      },
      SEP,
      sessionDoc
        ? { label: msg('Show in Session'), onClick: () => { showPanel('sessions'); setFocusedSession(sessionDoc.sessionId); } }
        : !desktop()
        ? { label: msg('Add to Session (desktop app only)'), disabled: true, onClick: () => {} }
        : {
            label: msg('Add to Session'),
            items: [
              ...addable.map((s) => ({
                label: s.meta.name,
                onClick: () => void runStudio(() => addToStudio(s.id, [{ kind: 'file', fileId: t.file.id, name: t.file.name }])),
              })),
              ...(addable.length ? [SEP] : []),
              { label: msg('Start New Session…'), onClick: () => { showPanel('sessions'); setStartSession({ token: Date.now(), fileIds: [t.file.id] }); } },
            ],
          },
      sessionDoc
        ? snap?.backend === 'folder'
          ? { label: msg('Show Session Folder'), onClick: () => void desktop()?.folder.show(sessionDoc.sessionId) }
          : { label: msg('Open in OneDrive'), disabled: !snap?.folderUrl, onClick: () => snap?.folderUrl && window.open(snap.folderUrl, '_blank', 'noopener') }
        : { label: msg('Show in File Access'), onClick: () => { showPanel('files'); setRevealFile({ id: t.file.id, token: Date.now() }); } },
      { label: msg('Copy File Name'), onClick: () => void navigator.clipboard?.writeText(t.file.name) },
      SEP,
      {
        label: pane === 'a' ? (split ? msg('Move to Right Pane') : msg('Open in Split View')) : msg('Move to Left Pane'),
        disabled: mirrorRef.current && (pane === 'b' || t === openBRef.current),
        onClick: () => moveTab(pane, t),
      },
    ];
  };

  /** The panel rail's panels in the profile's order (unlisted ones keep their default place at the end). */
  // The Markups list is a rail panel only while docked in a side panel (it starts in the bottom dock).
  const anyModelOpen = tabsA.some((t) => t.kind === 'model') || tabsB.some((t) => t.kind === 'model');

  // Open models drawn on sheets registered to a map (issue #191): their plan linework, read from the
  // IFC without the 3D viewer, placed through each sheet's own registration.
  const [modelOnDrawings, setModelOnDrawings] = useState(true);
  const openModelFiles = [...tabsA, ...tabsB].filter((t) => t.kind === 'model').map((t) => t.file);
  const openModelKey = [...new Set(openModelFiles.map((f) => f.hash))].sort().join(',');
  const [sheetModels, setSheetModels] = useState<GeoModel[]>([]);
  useEffect(() => {
    if (!modelOnDrawings || !openModelKey) return setSheetModels([]);
    let live = true;
    const files = [...new Map(openModelFiles.map((f) => [f.hash, f])).values()];
    void Promise.all(files.map((f) => modelLinework(f).catch(() => null))).then((models) => {
      if (live) setSheetModels(models.filter((m): m is GeoModel => !!m && (m.paths.length > 0)));
    });
    return () => {
      live = false;
    };
    // openModelKey stands for the files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelOnDrawings, openModelKey]);
  const geoRegionsA = useGeoRegions(open?.store ?? null);
  const geoRegionsB = useGeoRegions(openB?.store ?? null);
  useEffect(() => {
    const panes = [
      [ctl?.tools, geoRegionsA],
      [ctlB?.tools, geoRegionsB],
    ] as const;
    for (const [tools, regions] of panes) {
      if (!tools) continue;
      if (!sheetModels.length || !regions.length) {
        tools.setModelOverlay(null);
        continue;
      }
      // Pages are placed when first drawn, and kept.
      const byPage = new Map<number, ModelLayer[]>();
      tools.setModelOverlay((pageIndex) => {
        let layers = byPage.get(pageIndex);
        if (!layers) byPage.set(pageIndex, (layers = modelLayers(sheetModels, regions, pageIndex)));
        return layers;
      });
    }
  }, [ctl, ctlB, sheetModels, geoRegionsA, geoRegionsB]);
  // The first model opened brings its properties up, where that side has nothing else open.
  const hadModel = useRef(anyModelOpen);
  useEffect(() => {
    if (anyModelOpen && !hadModel.current && !ws.hiddenPanels.includes('model3dProps')) {
      const side = panelSide('model3dProps');
      if (!(side === 'left' ? leftOpen : rightOpen)) showPanel('model3dProps');
    }
    hadModel.current = anyModelOpen;
    // Only the coming and going of models matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyModelOpen]);
  const orderedRail = RAIL().filter(({ id, needsModel }) => (id !== 'markups' || ws.markupsDocked) && (!needsModel || anyModelOpen)).sort((a, b) => {
    const ia = ws.panelOrder.indexOf(a.id);
    const ib = ws.panelOrder.indexOf(b.id);
    return (ia < 0 ? RAIL().length + RAIL().indexOf(a) : ia) - (ib < 0 ? RAIL().length + RAIL().indexOf(b) : ib);
  });

  const visibleRail = orderedRail.filter(({ id }) => !ws.hiddenPanels.includes(id));
  const leftRail = visibleRail.filter(({ id }) => panelSide(id) === 'left');
  const rightRail = visibleRail.filter(({ id }) => panelSide(id) === 'right');
  const rightShown = rightOpen && rightRail.some(({ id }) => id === rightTab);
  const stitchPanelShown = (leftOpen && leftTab === 'stitching') || (rightShown && rightTab === 'stitching');
  // Hand-placed match lines and regions show on the sheets while the Stitching panel is open.
  useEffect(() => {
    const panes = [
      [ctl, open, manualStitchA, viewportsA],
      [ctlB, openB, manualStitchB, viewportsB],
    ] as const;
    for (const [c, doc, s, vps] of panes) {
      if (!c) continue;
      if (!stitchPanelShown || !doc) {
        c.tools.setStitchGuides(null);
        continue;
      }
      const { regions } = withViewportRegions(s, vps);
      c.tools.setStitchGuides({ lines: s.lines.map((l) => ({ ...l, paired: !!l.matchTo, problem: !!l.matchTo && !!lineProblem(l, regions) })), regions, selected: stitchSelected });
    }
  }, [ctl, ctlB, open, openB, manualStitchA, manualStitchB, viewportsA, viewportsB, stitchPanelShown, stitchSelected]);

  const startPanelDrag = (e: ReactDragEvent, id: LeftTab) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PANEL_DRAG_TYPE, id);
    setRailDrag({ id, over: null, after: false, side: null });
  };
  /** A panel dragged over a side's rail or side panel (not over one of its rail buttons) docks at the end of that side. */
  const dragOverSide = (e: ReactDragEvent, side: DockSide) => {
    if (!railDrag || (e.target as HTMLElement).closest('[data-panel]')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (railDrag.over || railDrag.side !== side) setRailDrag({ ...railDrag, over: null, after: false, side });
  };
  const dropOnSide = (e: ReactDragEvent, side: DockSide) => {
    if (!railDrag || (e.target as HTMLElement).closest('[data-panel]')) return;
    e.preventDefault();
    if (panelSide(railDrag.id) !== side) dockPanel(railDrag.id, side);
    setRailDrag(null);
  };

  /**
   * Docks a panel on a side of the window, next to `target` on that side's rail (or at its end).
   * A panel moved to the other side opens there.
   */
  const dockPanel = (id: LeftTab, side: DockSide, target?: LeftTab, after = false) => {
    if (id === target) return;
    // The Markups list comes from the bottom dock: it has no side yet, and the dock gives way to Links.
    const fromBottom = id === 'markups' && !ws.markupsDocked;
    const from = fromBottom ? null : panelSide(id);
    if (fromBottom) {
      setBottomTab('links');
      setShowBottom(false);
    }
    const ids = orderedRail.map((r) => r.id).filter((x) => x !== id);
    if (target) ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, id);
    else ids.push(id);
    updateWorkspace((w) => ({
      ...w,
      panelOrder: ids,
      rightPanels: side === 'right' ? [...w.rightPanels.filter((x) => x !== id), id] : w.rightPanels.filter((x) => x !== id),
      ...(id === 'markups' ? { markupsDocked: true } : {}),
    }));
    if (from === side) return;
    if (side === 'right') {
      if (leftTab === id) setLeftOpen(false);
      setRightTab(id);
      setRightOpen(true);
    } else {
      if (rightTab === id) setRightOpen(false);
      setLeftTab(id);
      setLeftOpen(true);
    }
  };

  /** Moves the Markups list back from a side panel to the bottom dock. */
  const undockMarkups = () => {
    if (!ws.markupsDocked) return;
    updateWorkspace((w) => ({ ...w, markupsDocked: false, rightPanels: w.rightPanels.filter((x) => x !== 'markups') }));
    if (leftTab === 'markups') setLeftOpen(false);
    if (rightTab === 'markups') setRightOpen(false);
    setBottomTab('markups');
    setShowBottom(true);
    setDockOpen(true);
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
    const list = (tools: ToolEntry[]): MenuEntry[] =>
      tools.map(({ tool, icon }) => ({ label: toolLabel(tool), lead: icon, checked: onToolbar(tool), onClick: () => toggle(tool) }));
    // One submenu per group, with "show all / hide all" for the group at its top.
    const groups = (gs: ToolGroup[]): MenuEntry[] =>
      gs.map((g) => {
        const on = g.tools.filter((t) => onToolbar(t.tool)).length;
        const setGroup = (show: boolean) =>
          updateWorkspace((w) => {
            const cur = w.toolbarTools ?? all;
            const ids = g.tools.map((t) => t.tool);
            const next = all.filter((t) => (ids.includes(t) ? show : cur.includes(t)));
            return { ...w, toolbarTools: next.length === all.length ? null : next };
          });
        return {
          label: `${g.label} (${on}/${g.tools.length})`,
          items: [
            { label: msg('Show All in Group'), disabled: on === g.tools.length, onClick: () => setGroup(true) },
            { label: msg('Hide Group'), disabled: on === 0, onClick: () => setGroup(false) },
            SEP,
            ...list(g.tools),
          ],
        };
      });
    return [
      ...(clicked ? [{ label: msg('Remove {toolLabel} from Toolbar', { toolLabel: toolLabel(clicked) }), onClick: () => toggle(clicked) } as MenuEntry, SEP] : []),
      { label: msg('Markup Tools'), items: groups(MARKUP_GROUPS) },
      { label: msg('Measure Tools'), items: groups(MEASURE_GROUPS) },
      {
        label: msg('Reset Toolbar to Defaults'),
        disabled: ws.toolbarTools?.length === DEFAULT_TOOLBAR_TOOLS.length && DEFAULT_TOOLBAR_TOOLS.every((t) => ws.toolbarTools?.includes(t)),
        onClick: () => updateWorkspace((w) => ({ ...w, toolbarTools: [...DEFAULT_TOOLBAR_TOOLS] })),
      },
      SEP,
      ...layoutMenu(),
    ];
  };

  /** Right-click on the panel rail: move the clicked panel to the other side, turn each panel on or off, or restore the default order. */
  const panelsMenu = (clicked?: LeftTab): MenuEntry[] => [
    ...(clicked && !narrowScreen()
      ? [
          panelSide(clicked) === 'left'
            ? { label: msg('Dock {panel} on the Right', { panel: leftTitles()[clicked]! }), onClick: () => dockPanel(clicked, 'right') }
            : { label: msg('Dock {panel} on the Left', { panel: leftTitles()[clicked]! }), onClick: () => dockPanel(clicked, 'left') },
          SEP,
        ]
      : []),
    ...orderedRail.map(({ id, title, experimental }): MenuEntry => ({
      label: experimental ? `${title} (Experimental)` : title,
      checked: !ws.hiddenPanels.includes(id),
      disabled: id === 'files',
      onClick: () => {
        const hide = !ws.hiddenPanels.includes(id);
        updateWorkspace((w) => ({ ...w, hiddenPanels: hide ? [...w.hiddenPanels, id] : w.hiddenPanels.filter((x) => x !== id) }));
        if (hide && leftTab === id) setLeftOpen(false);
        if (hide && rightTab === id) setRightOpen(false);
      },
    })),
    SEP,
    { label: msg('Reset Panel Order'), disabled: !ws.panelOrder.length, onClick: () => updateWorkspace((w) => ({ ...w, panelOrder: [] })) },
    {
      label: msg('Dock All Panels on the Left'),
      disabled: !ws.rightPanels.length,
      onClick: () => {
        updateWorkspace((w) => ({ ...w, rightPanels: [] }));
        setRightOpen(false);
      },
    },
  ];

  /** Right-click on the menu bar, toolbars, panel rail or status bar: which parts of the window show. */
  const layoutMenu = (): MenuEntry[] => [
    { label: msg('Markup Toolbar'), checked: showTools, onClick: toggleToolbar },
    { label: msg('Panels'), checked: leftOpen, onClick: () => setLeftOpen((s) => !s) },
    ...(rightRail.length ? [{ label: msg('Right Panels'), checked: rightShown, onClick: () => commandActions.toggleRight() } as MenuEntry] : []),
    { label: msg('Markups List'), checked: bottomOpen, onClick: toggleBottom },
    { label: split ? msg('Unsplit') : msg('Split View'), shortcut: 'Ctrl+2', disabled: !split && !activeOpen, onClick: () => (split ? unsplit() : startSplit()) },
    SEP,
    { label: msg('Keyboard Shortcuts'), onClick: () => setShortcutsOpen(true) },
  ];

  /** Copies pages of the active document, with their markups, to the page clipboard. */
  const copyPages = async (pages: number[]) => {
    const cur = activePaneRef.current === 'b' ? openBRef.current : openRef.current;
    if (!cur || !ctl || !pages.length) return false;
    try {
      const clips = cur.store.copyPages(pages);
      pageClipboard.current = { bytes: await ctl.engine.extractPages(await readFile(cur.file.hash), pages), clips };
      setNotice(msg('{value} copied. Paste ({combo}) inserts {value2} after the selected page.', { value: pages.length === 1 ? msg('Page') : msg('{count} pages', { count: pages.length }), combo: formatCombo('Ctrl+V'), value2: pages.length === 1 ? msg('it') : msg('them') }));
      return true;
    } catch (err) {
      setError(msg('Copy failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  };

  /**
   * Inserts the page clipboard's pages, with their markups, before index `at` of the active
   * document. False when there are none to paste or the document's pages cannot change.
   */
  const pastePages = (at: number) => {
    const clip = pageClipboard.current;
    if (!clip || !commandsRef.current.get('document.insertBlank')?.enabled) return false;
    void applyPageOps([{ type: 'insert', source: 0, at }], [clip.bytes.slice(0)], (store) => store.pastePages(clip.clips, at));
    return true;
  };

  /**
   * Right-click in the page thumbnails: Bluebeam's page menu, acting on the selected pages. With
   * none (a click between thumbnails), what needs a page is greyed out and Paste Pages appends.
   */
  const thumbMenu = (pages: number[], rename: () => void): MenuEntry[] => {
    const cmds = commandsRef.current;
    const none = !pages.length;
    const run = (id: string, label: string, icon?: ReactNode, onPage = false): MenuEntry => {
      const c = cmds.get(id);
      return { label, icon, shortcut: shortcutLabel(id), disabled: !c?.enabled || (onPage && none), onClick: c?.run };
    };
    const editable = !!cmds.get('document.insertBlank')?.enabled;
    const count = activeOpen?.doc.pages.length ?? 0;
    const these = pages.length > 1 ? `${pages.length} pages` : `page ${(pages[0] ?? 0) + 1}`;
    const hasMarkups = pages.some((p) => (activeOpen?.store.forPage(p).length ?? 0) > 0);
    const deletePages = (ask: boolean) => {
      if (ask && !confirm(msg('Delete {these}? Markups on {value} are deleted too.', { these, value: pages.length > 1 ? msg('them') : msg('it') }))) return false;
      void applyPageOps([{ type: 'delete', pages }]);
      return true;
    };
    const rotate = (quarterTurns: number) => () => void applyPageOps([{ type: 'rotate', pages, quarterTurns }]);
    return [
      run('document.pageSetup', 'Page Set-up…', MENU_ICONS.pageSetup),
      run('window.measurements', 'Set Scale…', MENU_ICONS.scale),
      SEP,
      {
        label: msg('Cut Pages'),
        disabled: none || !editable || pages.length >= count,
        onClick: () =>
          void copyPages(pages).then((ok) => {
            if (ok) deletePages(hasMarkups);
          }),
      },
      { label: msg('Copy Pages'), shortcut: 'Ctrl+C', disabled: none || !activeOpen, onClick: () => void copyPages(pages) },
      run('document.copyPageSnapshot', msg('Copy Page to Snapshot'), undefined, true),
      {
        label: msg('Paste Pages'),
        shortcut: 'Ctrl+V',
        disabled: !editable || !pageClipboard.current,
        onClick: () => pastePages(none ? count : pages.at(-1)! + 1),
      },
      SEP,
      run('tools.stamps', 'Apply Stamp…', MENU_ICONS.stamp, true),
      SEP,
      run('document.insertBlank', msg('Insert Blank Page…'), MENU_ICONS.pageBlank),
      run('document.insertPages', 'Insert Pages…', MENU_ICONS.pageInsert),
      run('document.bulkInsertPages', msg('Bulk Insert PDFs…'), MENU_ICONS.pageInsert),
      { label: msg('Extract Pages…'), icon: MENU_ICONS.pageExtract, shortcut: shortcutLabel('document.extractPages'), disabled: none || !cmds.get('document.extractPages')?.enabled, onClick: () => void extractPages(pages) },
      run('document.replacePages', 'Replace Pages…', MENU_ICONS.pageReplace),
      { label: msg('Delete Pages…'), icon: MENU_ICONS.pageDelete, shortcut: shortcutLabel('document.deletePages'), disabled: none || !editable || pages.length >= count, onClick: () => deletePages(true) },
      {
        label: msg('Rotate Pages'),
        icon: MENU_ICONS.pageRotate,
        disabled: none || !editable,
        items: [
          { label: msg('Clockwise 90°'), shortcut: shortcutLabel('document.rotatePages'), onClick: rotate(1) },
          { label: msg('Counterclockwise 90°'), shortcut: shortcutLabel('document.rotateCounterclockwise'), onClick: rotate(-1) },
          { label: msg('Rotate 180°'), onClick: rotate(2) },
        ],
      },
      run('document.numberPages', 'Number Pages…', MENU_ICONS.pageNumber),
      { label: msg('Rename Page Label'), disabled: !editable || pages.length !== 1, onClick: rename },
      {
        label: msg('Reset All Page Labels'),
        disabled: !editable,
        onClick: () => {
          const store = activeOpen?.store;
          if (store) for (let i = 0; i < count; i++) store.editSheet(i, { number: null });
        },
      },
      SEP,
      {
        label: msg('Export Pages'),
        items: [run('file.exportImages', 'Page Images…'), { label: msg('PDF…'), disabled: none || !cmds.get('document.extractPages')?.enabled, onClick: () => void extractPages(pages) }],
      },
      run('file.share', 'Email Pages…'),
      run('file.print', 'Print Pages…', MENU_ICONS.print),
      SEP,
      run('document.repair', 'Repair PDF'),
      run('document.flatten', 'Flatten…', MENU_ICONS.flatten),
      SEP,
      {
        label: msg('Markup Summary'),
        icon: MENU_ICONS.summary,
        items: [run('file.exportSummary', 'Markup Summary…'), run('file.exportCsv', msg('Export Markups CSV'))],
      },
    ];
  };

  /** The recent files list (File › Open Recent, File Access › Recents); `locationTick` keeps it current as disk locations load. */
  /** The library's PDFs: what PDF tools (Compare, Batch, Slip Sheet, Search) can work on, without 3D models. */
  const pdfLibrary = useMemo(() => library.filter((f) => !isModelFile(f)), [library]);
  const recentList = (templates = true) => recentFiles(library, { count: prefs.recentCount, days: prefs.recentDays, locationOf: locationTick >= 0 ? fileLocationToken : undefined, templates });

  /** Right-click on a library file (File Access). */
  const libraryMenu = (f: StoredFile): MenuEntry[] => [
    { label: msg('Open'), onClick: () => void openFromLibrary(f, 'a') },
    { label: msg('Revisions ({count})…', { count: f.revisions?.length ?? 0 }), onClick: () => setRevisionsOf(f.id) },
    { label: msg('Open in Split View'), onClick: () => void readFile(f.hash).then(async (bytes) => {
        if (!ctlB) {
          pendingSplitStored.current = { file: f, bytes };
          setSplit(true);
        } else await openStored(f, bytes, 'b');
      }) },
    {
      label: msg('Add to Session'),
      disabled: !desktop() || !sessions.some((s) => s.canAddDocuments),
      items: sessions
        .filter((s) => s.canAddDocuments)
        .map((s) => ({ label: s.meta.name, onClick: () => void runStudio(() => addToStudio(s.id, [{ kind: 'file', fileId: f.id, name: f.name }])) })),
    },
    SEP,
    { label: msg('Save a Copy…'), onClick: () => void readFile(f.hash).then((bytes) => download(f.name, new Blob([bytes], { type: 'application/pdf' }))) },
    { label: msg('Use as Template'), checked: !!f.template, onClick: () => void setTemplate(f.id, !f.template).then(refreshLibrary) },
    { label: msg('Copy File Name'), onClick: () => void navigator.clipboard?.writeText(f.name) },
    ...(desktop()
      ? [{
          label: msg('Open File Location'),
          disabled: locationTick < 0 || !hasFileLocation(f.id),
          onClick: () => void revealFileLocation(f.id).then((ok) => {
            if (!ok) setError(msg('That file is not in a folder on this computer. It may have been moved, renamed or deleted.'));
          }),
        }]
      : []),
    SEP,
    { label: msg('Remove from Recents'), disabled: !!f.recentHidden, onClick: () => removeFromRecents([f.id]) },
    {
      label: msg('Remove from Device…'),
      danger: true,
      onClick: () => {
        if (confirm(msg('Remove "{name}" from this device? Its markups are kept and return if you open it again.', { name: f.name }))) {
          fileGroups.forget(f.id);
          drawingSets.forget(f.id);
          void removeFile(f).then(() => forgetHandle(f.id)).then(refreshLibrary);
        }
      },
    },
  ];

  /** Links › Teach Links: shows the Links tab, opens Teach Links and turns on the tool for boxing a mark. */
  /** Opens the drawing standards setup on the active document, and reads its text for the checks. */
  const startSetup = (pane: Pane = paneB ? 'b' : 'a', step?: WizardStepId) => {
    const { o } = paneParts(pane);
    if (!o) return;
    setActivePane(pane);
    setSetup((cur) => (cur?.pane === pane && !step ? cur : { pane, inline: cur?.pane === pane ? cur.inline : false, step, n: (cur?.n ?? 0) + 1 }));
    setSetupTexts(null);
    void runJob(`Reading · ${o.file.name}`, ({ signal, progress }) => loadPageTexts(() => readFile(o.file.hash), o.store, (p) => progress(p.done, p.total, INDEX_PHASES()[p.phase]), signal), { kind: 'index' })
      .then((texts) => {
        if ((pane === 'b' ? openBRef.current : openRef.current) === o) setSetupTexts(texts);
      })
      .catch((err) => {
        if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err));
      });
  };
  // The setup closes with its document.
  useEffect(() => {
    if (setup && !paneParts(setup.pane).o) setSetup(null);
  });
  const setupRenderRef = useRef<(pageIndex: number, width: number, height: number, view: PreviewView) => Promise<PreviewDrawing | null>>(async () => null);
  setupRenderRef.current = async (pageIndex, width, height, view) => {
    const o = setup ? paneParts(setup.pane).o : null;
    if (!o) return null;
    const dpr = window.devicePixelRatio || 1;
    const seen = { x: view.cx - width / 2 / view.zoom, y: view.cy - height / 2 / view.zoom, w: width / view.zoom, h: height / view.zoom };
    const region = await renderRegion(o, pageIndex, seen, () => Math.min(16, Math.max(0.05, view.zoom * dpr)), false);
    if (!region) return { canvas: document.createElement('canvas'), x0: 0, y0: 0, view };
    region.canvas.style.width = `${region.w * view.zoom}px`;
    region.canvas.style.height = `${region.h * view.zoom}px`;
    return { canvas: region.canvas, x0: region.x0, y0: region.y0, view };
  };
  const setupRender = useCallback((pageIndex: number, width: number, height: number, view: PreviewView) => setupRenderRef.current(pageIndex, width, height, view), []);

  /** Forgets a taught mark, whether it was for every set or a drawing standard's own, and looks again without it. */
  const forgetMark = (id: string, doc: OpenFile | null) => {
    updateWorkspace((s) => ({
      ...s,
      taughtMarks: s.taughtMarks.filter((m) => m.id !== id),
      drawingStandards: s.drawingStandards.map((d) => (d.marks?.some((m) => m.id === id) ? { ...d, marks: d.marks.filter((m) => m.id !== id), updatedAt: Date.now() } : d)),
    }));
    void findTaughtMarks(doc);
  };

  /** Starts drawing page-label boxes on a pane's document (Document → Page Labels → From Page Region). */
  /** `pages` starts the panel on those pages; `typed` opens Page Labels ready to type a label rather than draw boxes. */
  /** `erase` is Bulk Redact, which draws its boxes the same way. */
  /** `bookmarks` opens Page Labels set to name each page's bookmark (Bookmarks panel → From regions). */
  const startLabelRegions = (pane: Pane = paneB ? 'b' : 'a', kind: 'label' | 'scale' | 'erase' = 'label', opts: { pages?: number[]; typed?: boolean; bookmarks?: boolean } = {}) => {
    const { c, o } = paneParts(pane);
    if (!c || !o) return;
    if (kind === 'erase' && studioDocOf(o.file.id)) {
      setError(msg('A Live Session document is shared with others, so its content cannot be changed here.'));
      return;
    }
    setActivePane(pane);
    // Reopening with new pages or a new source starts the panel afresh (it is keyed on them), keeping the boxes drawn.
    // Erase boxes are not label boxes, so switching between them starts with none.
    const own = (k: string) => (k === 'erase' ? k : 'label');
    setLabelMode((m) =>
      m?.pane === pane && m.kind === kind && !opts.pages && !opts.typed && !m.pages && !m.typed && !!opts.bookmarks === !!m.bookmarks
        ? m
        : { pane, regions: m?.pane === pane && own(m.kind) === own(kind) ? m.regions : [], kind, ...opts },
    );
    c.tools.setTool(opts.typed ? 'select' : 'labelRegion');
    setLabelTexts(null);
    void runJob(`Reading · ${o.file.name}`, ({ signal, progress }) => loadPageTexts(() => readFile(o.file.hash), o.store, (p) => progress(p.done, p.total, INDEX_PHASES()[p.phase]), signal), { kind: 'index' })
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
  matchLineRef.current = (pane, pageIndex, p0, p1) => {
    const doc = pane === 'b' ? openB : open;
    const viewer = pane === 'b' ? ctlB?.viewer : ctl?.viewer;
    const size = viewer?.pageSize(pageIndex);
    if (!doc || !size || doc.store.readOnly) return;
    const s = doc.store.manualStitch();
    const region = withViewportRegions({ ...s, lines: [{ id: '', pageIndex, p0, p1, contentSide: 1, name: '', matchTo: null }] }, pane === 'b' ? viewportsB : viewportsA).regions[pageIndex];
    const line = newMatchLine(s.lines, pageIndex, p0, p1, size, region);
    // With just one unmatched line on another sheet, the new line is clearly its partner.
    const waiting = s.lines.filter((l) => !l.matchTo && l.pageIndex !== pageIndex);
    const lines = [...s.lines, line];
    if (waiting.length === 1) {
      const other = waiting[0]!;
      line.matchTo = other.id;
      lines.splice(lines.indexOf(other), 1, { ...other, matchTo: line.id });
      setNotice(msg('{name} matched to {name2} on {pageLabelFor}.', { name: line.name, name2: other.name, pageLabelFor: pageLabelFor(doc, other.pageIndex) }));
    }
    doc.store.setManualStitch({ ...s, lines });
    setStitchSelected(line.id);
  };
  matchLineEditedRef.current = (pane, id, p0, p1) => {
    const doc = pane === 'b' ? openB : open;
    if (!doc || doc.store.readOnly) return false;
    const s = doc.store.manualStitch();
    const line = s.lines.find((l) => l.id === id);
    const zoom = (pane === 'b' ? ctlB : ctl)?.viewer.zoomFor(line?.pageIndex ?? 0) ?? 1;
    // Ends dragged onto each other fix no direction: keep the line as it was.
    if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * zoom < 2) {
      setNotice(msg('A match line needs two different ends: the line was left as it was.'));
      return false;
    }
    doc.store.setManualStitch({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, p0, p1 } : l)) });
    setStitchSelected(id);
    return true;
  };
  /** The sheet Move Sheet and the nudge buttons move: the one joined at the selected line, placed from its partner. */
  const stitchMover = (doc: OpenFile, groups: readonly StoredStitchGroup[]) => {
    const lines = doc.store.manualStitch().lines;
    const sel = lines.find((l) => l.id === stitchSelected);
    const group = sel ? (groups.find((g) => g.placements.some((p) => p.pageIndex === sel.pageIndex)) ?? null) : null;
    const mover = sel ? moverLine(lines, sel.id, group) : null;
    return mover && group ? { lines, mover, group } : null;
  };
  stitchDragRef.current = (pane, delta, done) => {
    const doc = pane === 'b' ? openB : open;
    const c = pane === 'b' ? ctlB : ctl;
    if (!doc || !c || doc.store.readOnly) return;
    const m = stitchMover(doc, pane === 'b' ? stitchB : stitchA);
    if (!m) {
      if (done) setNotice(msg('Pick a matched line in the Stitching panel first: Move Sheet moves the sheet joined at it.'));
      return;
    }
    const ref = pairOf(m.lines, m.mover.id)!.ref;
    // How the view turns and scales the reference sheet (rotation included), from its own placement.
    const o = c.viewer.pageToWorld(ref.pageIndex, [0, 0]);
    const x = c.viewer.pageToWorld(ref.pageIndex, [1, 0]);
    const y = c.viewer.pageToWorld(ref.pageIndex, [0, 1]);
    const [along, across] = dragToShift(m.lines, m.mover.id, [x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1]], delta, stitchLockAlong);
    const lines = shiftLine(m.lines, m.mover.id, along, across);
    const s = doc.store.manualStitch();
    if (done) {
      doc.store.setManualStitch({ ...s, lines });
      return;
    }
    // While dragging, only the view follows; the store takes the result on release.
    const groups = mergeStitch(pane === 'b' ? autoStitchB : autoStitchA, withViewportRegions({ ...s, lines }, pane === 'b' ? viewportsB : viewportsA));
    const group = groups.find((g) => g.placements.some((p) => p.pageIndex === m.mover.pageIndex));
    if (group) c.viewer.updateStitch(group.placements);
  };
  /** The line whose adjustment moves the sheet joined at line `id` (see `moverLine`). */
  const moverOf = (lines: readonly StoredMatchLine[], id: string) => {
    const group = stitchGroups.find((g) => g.placements.some((p) => p.pageIndex === lines.find((l) => l.id === id)?.pageIndex)) ?? null;
    return moverLine(lines, id, group);
  };
  /** Nudges the sheet joined at line `id`: `along` the match line, `apart` from its partner (the panel's buttons and arrow keys). */
  const nudgeStitch = (id: string, along: number, apart: number) => {
    const doc = activeOpen;
    if (!doc || activeReadOnly) return;
    const lines = doc.store.manualStitch().lines;
    const mover = moverOf(lines, id);
    if (!mover) return;
    const [a, c] = nudgeToShift(lines, mover.id, along, apart);
    doc.store.setManualStitch({ ...doc.store.manualStitch(), lines: shiftLine(lines, mover.id, a, c) });
  };
  /** Puts the sheet joined at line `id` back where the two lines' ends place it. */
  const resetStitch = (id: string) => {
    const doc = activeOpen;
    if (!doc || activeReadOnly) return;
    const s = doc.store.manualStitch();
    const pair = pairOf(s.lines, id);
    if (!pair) return;
    doc.store.setManualStitch({ ...s, lines: s.lines.map((l) => (l.id === pair.line.id || l.id === pair.partner.id ? (({ offset: _, ...rest }) => rest)(l) : l)) });
  };
  portalDrawnRef.current = (pane, pageIndex, points) => setPortalDialog({ pane, draft: { pageIndex, points } });
  usePortalGuides([[ctl, open?.store, open?.doc.pages.length], [ctlB, openB?.store, openB?.doc.pages.length]]);
  stitchRegionRef.current = (pane, pageIndex, points) => {
    const doc = pane === 'b' ? openB : open;
    if (!doc || doc.store.readOnly) return;
    const s = doc.store.manualStitch();
    doc.store.setManualStitch({ ...s, regions: { ...s.regions, [pageIndex]: points } });
  };

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
        tool={toolsState.tool}
        onTool={(t) => (which === 'b' ? ctlB : ctl)?.tools.setTool(t)}
        sheetLabel={sh[idx]?.number ?? undefined}
        sheetTitle={sh[idx]?.title ?? undefined}
        pageWidthPt={size?.width ?? null}
        pageHeightPt={size?.height ?? null}
        scaleControl={
          <ScaleControl
            scale={sc[idx] ?? null}
            disabled={!o}
            onPreset={(scale) => o?.store.setScale([idx], withDefaultUnits(scale))}
            onCustom={() => setCustomScalePane(which)}
          />
        }
        onFirst={() => viewer?.changePage(0)}
        onPrev={() => viewer?.prevPage()}
        onNext={() => viewer?.nextPage()}
        onLast={() => viewer?.changePage(Math.max(0, count - 1))}
        onGoTo={(i) => viewer?.changePage(i)}
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
  const mayEditMarkup = (m: Markup) => !activeOpen || activeOpen.store.mayEdit(m);
  /** Cutout: draws a hole in the one selected area; with no area selected it says so instead of starting a cutout with nowhere to cut. */
  const startCutoutFromSelection = () => {
    const blocker = cutoutBlocker(selectedMarkups, mayEditMarkup);
    if (!blocker) activeTools?.startCutout(selectedMarkups[0]!.id);
    else setNotice(selectedMarkups.length ? `${blocker}.` : msg('Select an area first, then draw the cutout inside it.'));
  };
  /** Arms the Stamp tool with a library stamp, remembered as the one to use next time. */
  const placeStamp = (s: StampDef, filled = false) => {
    updateWorkspace((w) => ({ ...w, lastStampId: s.id }));
    // A stamp with fields is filled in first, then placed as filled in.
    if (s.fields?.length && !filled) return setStampToFill(s);
    activeTools?.setTool('stamp', { stamp: s, once: !settings.get().toolChestSticky });
  };

  /** The 3D model in front of the active pane, and its view's state once loaded (the 3D ribbon tab and commands follow it). */
  const activeModel = paneB && (openB || modelB) ? modelB : modelA;
  const model3dState = useSyncExternalStore(
    useCallback((l: () => void) => activeModel?.view.subscribe(l) ?? (() => {}), [activeModel]),
    () => activeModel?.view.controls()?.state() ?? null,
  );

  /** Open sheets registered to the map, which models on the same map can be shown on and linked to. */
  const mapSheets = (): SheetSource[] =>
    pdfTabs([...tabsA, ...tabsB])
      .filter((t, i, all) => all.findIndex((x) => x.file.id === t.file.id) === i)
      .flatMap((t) =>
        t.store
          .allGeoRegions()
          .filter((region) => regionCrs(region))
          .map((region) => ({
            key: `${t.file.id}:${region.pageIndex}:${region.id}`,
            label: `${t.file.name.replace(/\.pdf$/i, '')} — ${pageLabelFor(t, region.pageIndex)}${region.name ? ` (${region.name})` : ''}`,
            region,
            doc: t.doc,
            store: t.store,
          })),
      );

  // Issues raised in open models and their markups on open sheets kept in step.
  useIssueSync(
    [...tabsA, ...tabsB].flatMap((t) => (t.kind === 'model' ? [t.file.hash] : [])),
    mapSheets(),
  );

  /** Brings a sheet to the front where a model element lies on it, with a ring around the place. */
  const openSheetAt = (hit: SheetHit) => {
    const fileId = hit.source.key.split(':')[0];
    const inA = tabsARef.current.find((t) => t.file.id === fileId);
    const pane: Pane = inA ? 'a' : 'b';
    const tab = inA ?? tabsBRef.current.find((t) => t.file.id === fileId);
    if (!tab) return;
    activateTab(pane, tab);
    activePaneRef.current = pane;
    // The sheet's viewer is shown and sized on the next frame, then moves to the place.
    requestAnimationFrame(() => requestAnimationFrame(() => navigate(hit.source.region.pageIndex, ringAround(hit.point))));
  };

  /** A georeferenced model open in a tab, and its pane: where Find in 3D looks. */
  const mapModel = (): { pane: Pane; tab: OpenModel } | null => {
    for (const [pane, tabs] of [['a', tabsA], ['b', tabsB]] as const) {
      const tab = tabs.find((t): t is OpenModel => t.kind === 'model' && !!t.view.controls()?.state().georeferenced);
      if (tab) return { pane, tab };
    }
    return null;
  };

  /** Shows the model element at a sheet's map position: brings the model to the front and selects what is there. */
  const findIn3d = (grid: [number, number]) => {
    const found = mapModel();
    const controls = found?.tab.view.controls();
    if (!found || !controls) return;
    activateTab(found.pane, found.tab);
    void controls.findAt(grid[0], grid[1]).then((hit) => {
      if (!hit) setNotice('Nothing in the model at that place on the map.');
    });
  };

  const commandActions: CommandActions = {
    open: () => openFromDisk(),
    newFromTemplate: () => void newFromTemplate(),
    fromCamera: () => setCameraOpen(true),
    newPdf: () => setBlankPdf('new'),
    combine: () => setCombineOpen(true),
    close: closeDocument,
    closeAll: () =>
      void requestCloseTabs((['b', 'a'] as const).flatMap((pane) => (pane === 'b' ? tabsBRef.current : tabsARef.current).map((t) => ({ pane, fileId: t.file.id })))),
    reopenClosedTab: () => void reopenClosedTab(),
    saveAll: () =>
      void (async () => {
        for (const t of pdfTabs([...tabsARef.current, ...tabsBRef.current])) {
          try {
            const out = await annotatedBytes(t);
            download(t.file.name.replace(/\.pdf$/i, '') + ' (markups).pdf', new Blob([out as BlobPart], { type: 'application/pdf' }));
          } catch (err) {
            setError(msg('Saving {name} failed: {value}', { name: t.file.name, value: err instanceof Error ? err.message : String(err) }));
          }
        }
      })(),
    revert: () => {
      const store = activeOpen?.store;
      const n = store?.undoHistory().length ?? 0;
      if (store && n && confirm(msg('Revert {name}? The {n, plural, one {# change} other {# changes}} made since it was opened are undone (Redo brings them back).', { name: activeOpen!.file.name, n }))) store.undoSteps(n);
    },
    publish: (mode) => setPublishFor(mode),
    share: () => void shareDocument(),
    markupsXfdf: (dir) => void markupsXfdf(dir),
    markupsFdf: (dir) => void markupsFdf(dir),
    importMarkupsFromPdf: () => void importMarkupsFromPdf(),
    exportBax: () => void exportMarkupsBax(),
    importBax: () => void importMarkupsBax(),
    save: () => void saveDocument(false),
    saveAs: () => void saveDocument(true),
    exportCsv: () => {
      // Preferences › Markups List › Exclude Filtered Markups on Export: else every markup is exported.
      const only = prefs.excludeFilteredOnExport;
      downloadCsv(rowsToCsv(withThreads(buildRows(markups, cellContext, only ? listFilters : {}, listSort, only ? ws.list.advanced : null), cellContext), visibleListColumns, true));
    },
    exportXlsx: exportMarkupsXlsx,
    exportRegister: () => setRegisterOpen(true),
    registerTemplates: () => setRegisterTemplatesOpen({}),
    importXlsx: () => void importMarkupsXlsx(),
    exportSummary: openSummaryExport,
    print: () => setPrintOpen(true),
    preferences: () => {
      setPrefsCategory(undefined);
      setPrefsOpen(true);
    },
    manageProfiles: () => setProfilesOpen(true),
    migrateRevu: () => setRevuMigrationOpen(true),
    shortcuts: () => setShortcutsOpen(true),
    about: () =>
      alert(
        [
          msg('redcolumn {aPP_VERSION}: PDF markup and takeoff for construction drawings.', { aPP_VERSION: APP_VERSION }),
          msg('Open source under the Apache License 2.0. Third-party notices: ') + `${PROJECT_URL}/blob/master/THIRD_PARTY_NOTICES.md`,
          msg('Your documents stay {value}; there is no redcolumn server or account. Privacy policy: ', { value: desktop() ? msg('on this computer') : msg('in this browser') }) + `${PROJECT_URL}/blob/master/PRIVACY.md`,
          msg('Measurements and quantities depend on the scale you set: check them before relying on them. redcolumn comes with no warranty.'),
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
      if (n && (!settings.get().confirmDelete || confirm(msg('Delete {n, plural, one {# markup} other {# markups}}?', { n })))) activeTools?.deleteSelected();
    },
    selectAll: () => activeTools?.select(markups.map((m) => m.id)),
    sound: () => setSoundOpen('sound'),
    video: () => setSoundOpen('video'),
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
          setNotice(msg('No fill-in lines, boxes or check boxes were found that are not fields already.'));
          return;
        }
        if (!confirm(msg('Create {count} form {count2, plural, one {field} other {fields}} ({count3} check boxes) where the page has fill-in lines and boxes? They can be renamed or deleted in the Forms panel.', { count: specs.length, count2: specs.length, count3: specs.filter((s) => s.type === 'checkbox').length }))) return;
        const ok = await editForm(cur.file.id, 'Creating fields', (bytes) => createFields(bytes, specs));
        if (ok) {
          showPanel('forms');
          setNotice(msg('Created {count, plural, one {# field} other {# fields}}.', { count: specs.length }));
        }
      })().catch((err) => setError(msg('Finding fields failed: {value}', { value: err instanceof Error ? err.message : String(err) }))),
    archivePdfA: () =>
      void (async () => {
        const cur = activeOpen;
        if (!cur || !(await rewriteSigned(cur.doc, msg('An archive copy (PDF/A)')))) return;
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
          setNotice(msg('Saved {base} (PDF-A).pdf as PDF/A-2b.{done}', { base, done }));
          return;
        }
        // It would not pass a validator, so it is not marked PDF/A; saving it is the user's choice.
        if (!confirm(msg('{name} cannot be made a valid PDF/A:\n\n{blocking}\n\nSave an archive copy anyway? It will not be marked as PDF/A.', { name: cur.file.name, blocking: blocking.join('\n\n') }))) return;
        download(`${base} (archive).pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
        setError(msg('Saved {base} (archive).pdf, not marked as PDF/A: {blocking}{done}', { base, blocking: blocking.join(' '), done }));
      })().catch((err) => setError(msg('PDF/A failed: {value}', { value: err instanceof Error ? err.message : String(err) }))),
    install: () => setInstallOpen(true),
    help: (what) => {
      const open = (path: string) => window.open(`${PROJECT_URL}${path}`, '_blank', 'noopener');
      if (what === 'docs') window.open(`${import.meta.env.BASE_URL}help/index.html`, '_blank', 'noopener');
      else if (what === 'community') open('/discussions');
      else if (what === 'support') open('/issues/new?labels=bug&title=Problem%3A%20');
      else if (what === 'suggest') open('/issues/new?labels=enhancement&title=Suggestion%3A%20');
      else if (what === 'sponsor') window.open('https://github.com/sponsors/ColbyGallagher', '_blank', 'noopener');
      else if (what === 'whatsNew') setWhatsNewOpen(true);
      else if (what === 'logs') download(`redcolumn log ${new Date().toISOString().slice(0, 10)}.txt`, logFile());
      else if (what === 'updates') {
        const gate = updateGate();
        if (gate?.waiting) return gate.applyNow();
        const host = desktop();
        if (host) {
          void host.checkForUpdates().then((r) => {
            if (r.status === 'available' && r.url) {
              if (confirm(msg('redcolumn {latest} is available. You have {current}.\n\nOpen the download page? Run the new installer to update; your documents and markups are kept.', { latest: String(r.latest), current: r.current }))) window.open(r.url, '_blank', 'noopener');
            } else if (r.status === 'downloading') setNotice(msg('redcolumn {latest} is downloading in the background ({value}%). It installs when you close redcolumn.', { latest: String(r.latest), value: r.percent ?? 0 }));
            else if (r.status === 'ready') {
              if (confirm(msg('redcolumn {latest} is ready to install. You have {current}.\n\nRestart now to update? Your documents and markups are kept.', { latest: String(r.latest), current: r.current }))) restartIntoUpdate();
            } else if (r.status === 'unavailable') setNotice(msg('Could not check for updates (offline?).'));
            else setNotice(msg('You have the latest version ({current}).', { current: r.current }));
          }).catch(() => setNotice(msg('Could not check for updates (offline?).')));
          return;
        }
        void navigator.serviceWorker
          ?.getRegistration()
          .then(async (reg) => {
            if (!reg) return setNotice(msg('Updates are checked automatically when the app is installed.'));
            await reg.update();
            setNotice(reg.waiting || reg.installing ? msg('A new version is downloading; it loads by itself when you are not in the middle of something.') : msg('You have the latest version.'));
          })
          .catch(() => setNotice(msg('Could not check for updates (offline?).')));
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
    cadTool: (tool) => activeTools?.setTool(tool),
    join: () => {
      if (!activeTools?.joinSelected()) setNotice(msg('Nothing to join: select lines or polylines whose ends meet'));
    },
    explode: () => void activeTools?.explodeSelected(),
    selectSimilar: () => void activeTools?.selectSimilar(),
    toCloud: () => void activeTools?.convertToCloud(),
    reverse: () => void activeTools?.reverseSelected(),
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
      showPanel('search');
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
    modelOnDrawings: () => setModelOnDrawings((on) => !on),
    stitching: () => showPanel('stitching'),
    geospatial: () => showPanel('geospatial'),
    stitchToPage: () => {
      if (currentStitch) stitchToNewPage(currentStitch, true).catch(() => {});
    },
    applyStitching: () => setApplyStitch(true),
    convertDrawingAgain: () => {
      if (activeOpen && activeCad) setCadAgain(activeOpen.file.id);
    },
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
      else v.changePage(which === 'first' ? 0 : pageCount - 1);
    },
    documentProperties: () => setDocPropsOpen(true),
    rotatePages: (quarterTurns) => {
      showPanel('pages');
      void applyPageOps([{ type: 'rotate', pages: currentPageOps(), quarterTurns }]);
    },
    insertPages: () => {
      showPanel('pages');
      insertFileRef.current?.click();
    },
    bulkInsertPages: () => {
      showPanel('pages');
      bulkInsertFileRef.current?.click();
    },
    insertBlank: () => setBlankPdf('blank'),
    extractPages: () => setPageTool({ kind: 'extract', drawnRect: null }),
    copyPageSnapshot: () => {
      const pane = activePaneRef.current;
      const { o } = paneParts(pane);
      const page = v?.currentPageIndex ?? pageIndex;
      const size = o?.doc.pages[page];
      if (size) void snapshotRef.current(pane, page, { x: 0, y: 0, w: size.width, h: size.height });
    },
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
      if (cur) void runProcess(cur, { kind: 'unflatten' }, 'Before Unflatten').then((msg) => msg && setNotice(msg)).catch((err) => setError(msg('Unflatten failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
    },
    compare: () => setCompareOpen('compare'),
    semanticCompare: () => showPanel('ai'),
    batch: (kind) => (kind === 'summary' ? setSummaryOpen(true) : setBatchOpen(kind)),
    security: () => setSecurityOpen(true),
    showPanel: (tab) => showPanel(tab),
    focusPanel: (id) => {
      if (id === 'markups' && ws.markupsDocked) showPanel('markups');
      else if (id === 'markups' || id === 'links') showBottomPanel(id);
      else showPanel(id);
    },
    togglePanels: () => {
      const open = leftOpen || rightShown || bottomOpen;
      setLeftOpen(!open);
      setRightOpen(!open && rightRail.length > 0);
      setShowBottom(!open);
      if (!open) setDockOpen(true);
    },
    addBookmark: () => {
      const cur = activeOpen;
      if (!cur || !v) return;
      const view = visibleView(v, paneB ? canvasBRef.current : canvasRef.current);
      const mark: Bookmark = { id: crypto.randomUUID(), title: pageLabelFor(cur, view.pageIndex), pageIndex: view.pageIndex, rect: view.rect, children: [] };
      cur.store.setBookmarks(insertBookmark(cur.store.bookmarks(), mark));
      showPanel('bookmarks');
    },
    cycleDocument: (dir) => {
      const tp = tabPaneOf(pane);
      const tabs = tp === 'b' ? tabsBRef.current : tabsARef.current;
      const front = tp === 'b' ? openBRef.current : openRef.current;
      if (tabs.length < 2 || !front) return;
      const i = tabs.findIndex((t) => t.file.id === front.file.id);
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      // From the mirrored right pane the left pane changes and focus stays where it is.
      if (next) (tp === pane ? activateTab(tp, next) : showInPane(tp, next));
    },
    align: (how) => activeTools?.alignSelected(how),
    nudge: (dx, dy, large) => activeTools?.nudgeScreen(dx, dy, large),
    flip: (axis) => activeTools?.flipSelected(axis),
    centerOnPage: () => activeTools?.centerSelectedOnPage(),
    matchSize: (kind) => activeTools?.matchSizeSelected(kind),
    distribute: (axis) => activeTools?.distributeSelected(axis),
    scaleToLength: () => activeTools?.setTool('scaleLength'),
    resetCrop: () => activeTools?.resetCropSelected(),
    pictureDialog: (which) => {
      const ms = selectedMarkups.filter((m) => m.type === 'image' && m.image && !m.locked);
      if (!ms.length) return;
      if (which === 'adjust') setAdjustImageFor({ pane, ids: ms.map((m) => m.id) });
      else setPictureColoursFor({ pane, id: ms[0]!.id });
    },
    arrange: (where) => activeTools && activeTools.arrange(activeTools.getState().selected, where),
    sign: () => {
      showPanel('signatures');
      setSignFor({ fieldName: null });
    },
    digitalIds: () => setIdsOpen(true),
    slipSheet: () => setSlipSheetOpen(true),
    closeOut: () => setCloseOutOpen(true),
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
        setNotice(msg('Nothing is marked for redaction: use Tools › Redaction › Mark for Redaction, or Search › Mark for redaction.'));
        return;
      }
      setRedactFor({ pane: paneB ? 'b' : 'a', count: marks.length });
    },
    repair: () => {
      const cur = activeOpen;
      if (cur) void runProcess(cur, { kind: 'repair' }, 'Before Repair').then((msg) => msg && setNotice(msg)).catch((err) => setError(msg('Repair failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
    },
    deletePages: () => {
      const pages = currentPageOps();
      if (!confirm(msg('Delete page {page}? Markups on it are deleted too.', { page: pages[0]! + 1 }))) return;
      showPanel('pages');
      void applyPageOps([{ type: 'delete', pages }]);
    },
    labelRegions: () => startLabelRegions(),
    drawingStandards: () => startSetup(undefined, 'review'),
    setUpDrawingStandard: () => startSetup(),
    teachMark: () => startSetup(undefined, 'sections'),
    scaleRegions: () => startLabelRegions(undefined, 'scale'),
    scaleReview: () => setScaleReviewOpen(true),
    bulkRedact: () => startLabelRegions(undefined, 'erase'),
    thumbnails: () => showPanel('pages'),
    setTool: (tool) => activeTools?.setTool(tool),
    manageColumns: () => setColumnsOpen(true),
    manageAssemblies: () => setAssembliesOpen(true),
    browseLibrary: () => setLibraryOpen(true),
    takeoffQuantities: () => setQuantitiesOpen(true),
    scripts: () => setScriptsOpen(true),
    takeoffReview: () => setTakeoffReviewOpen(true),
    cutout: startCutoutFromSelection,
    syncExcel: () => setSyncOpen(true),
    portals: () => setPortalDialog({ pane: paneB ? 'b' : 'a' }),
    breakPortalLink: () => {
      activeOpen?.store.breakPortalLinks(selectedMarkups.filter((m) => m.portalLink).map((m) => m.id));
      setNotice(msg('The selected markups are no longer mirrored: they are ordinary markups on their page now.'));
    },
    takeoffReports: () => {
      setReportsError(null);
      setReportsOpen(true);
    },
    toggleArc: () => activeTools?.toggleArc(),
    hipValley: (kind) => activeTools?.setTool('polylength', { subject: kind === 'hip' ? 'Hip' : 'Valley', slope: hipValleySlope(kind) }),
    manualQuantity: () => setManualOpen(true),
    manageItems: () => setItemsOpen(true),
    manageProductLists: () => setProductListsOpen(true),
    manageTemplates: () => setTemplatesOpen(true),
    saveTemplate: () => {
      const m = selectedMarkups.length === 1 ? selectedMarkups[0] : undefined;
      if (m && templateable(m)) void saveAsTemplate(m);
    },
    signatures: () => showPanel('signatures'),
    toggleToolbar,
    setToolbarStyle: (toolbarStyle, collapsed) => updateWorkspace((w) => ({ ...w, toolbarStyle, showToolbar: true, ribbonCollapsed: collapsed ?? w.ribbonCollapsed })),
    resetLayout,
    toggleLeft: () => setLeftOpen((s) => !s),
    toggleRight: () => (rightShown ? setRightOpen(false) : showPanel(panelSide(rightTab) === 'right' ? rightTab : rightRail[0]!.id)),
    toggleBottom,
    commandPalette: () => setPaletteOpen(true),
    manageStamps: () => {
      setStampsCreating(false);
      setStampsOpen(true);
    },
    manageLineStyles: () => setLineStylesOpen(true),
    flowShape: (kind) => activeTools?.setFlowShape(kind),
    addNextShape: (side) => activeTools?.addNextShape(side),
    connectShapes: () => {
      if (activeTools && !activeTools.connectSelected()) setNotice(msg('The selected shapes are already connected.'));
    },
    connectorRoute: (route) => activeTools?.setConnectorRoute(route),
    model3d: (action) => activeModel?.view.controls()?.run(action),
  };
  /** A new document that is a copy of a template document (its markups too), under `name`. */
  const copyTemplate = async (choice: StoredFile, name: string) => {
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
      if (from.assemblies().length) to.setAssemblies(from.assemblies());
      to.setEstimating(from.estimating());
      await Promise.all([from.destroy(), to.destroy()]);
      await openStored(file, bytes, activePaneRef.current);
      void refreshLibrary();
    } catch (err) {
      setError(msg('New from template failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
    }
  };
  /** File › New PDF from Template: picks a template document and a name for the copy. */
  const newFromTemplate = async () => {
    const templates = library.filter((f) => f.template);
    if (!templates.length) return;
    const choice = templates.length === 1 ? templates[0]! : await pickTemplate(templates);
    if (!choice) return;
    const name = await askText(msg('New PDF from Template'), choice.name.replace(/\.pdf$/i, '') + ' copy.pdf', { label: msg('A new document from the template "{name}".', { name: choice.name }), confirm: msg('Create') });
    if (name) await copyTemplate(choice, name);
  };
  /** File › New PDF › Start from: a built-in template, or a copy of one in the library. */
  const newFromTemplateRequest = async (req: TemplateRequest) => {
    if (req.kind === 'library') {
      const choice = library.find((f) => f.id === req.id);
      if (choice) await copyTemplate(choice, choice.name.replace(/\.pdf$/i, '') + ' copy.pdf');
      return;
    }
    const t = BUILTIN_TEMPLATES.find((x) => x.id === req.id);
    if (!t) return;
    try {
      const { buildTemplate } = await import('./documents/pdfTemplates');
      await openCreated(`${t.name}.pdf`, (await buildTemplate(t.id, req.count)).slice().buffer);
    } catch (err) {
      setError(msg('Creating the PDF failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
    }
  };
  /** File › New PDF › Import Template: a PDF from disk, added to the library as a template. */
  const importTemplate = async (f: File): Promise<string | null> => {
    try {
      const stored = await saveFile(f.name, await f.arrayBuffer());
      await setTemplate(stored.id, true);
      await refreshLibrary();
      return stored.id;
    } catch (err) {
      setError(msg('Importing the template failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
      return null;
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
        await navigator.share({ files: [file], title: cur.file.name, text: msg('{name}, with markups', { name: cur.file.name }) });
        return;
      }
      download(name, file);
      window.location.href = `mailto:?subject=${encodeURIComponent(cur.file.name)}&body=${encodeURIComponent(`Attached: ${name}\n`)}`;
      setNotice(msg('Saved {name}; attach it to the new email.', { name }));
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(msg('Sharing failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
      setError(msg('XFDF {dir} failed: {value}', { dir, value: err instanceof Error ? err.message : String(err) }));
    }
  };

  /** Markups out to, or in from, an FDF file (Bluebeam Revu and Acrobat read and write it). */
  const markupsFdf = async (dir: 'export' | 'import') => {
    const cur = activeOpen;
    if (!cur) return;
    const { fdfFromPdf, markupsFromFdf } = await import('@nb/markup/fdf');
    try {
      if (dir === 'export') {
        const fdf = await fdfFromPdf(await annotatedBytes(cur, { links: false }), cur.file.name);
        download(cur.file.name.replace(/\.pdf$/i, '') + '.fdf', new Blob([fdf as BlobPart], { type: 'application/vnd.fdf' }));
        return;
      }
      const file = await pickFile('.fdf,application/vnd.fdf');
      if (!file) return;
      const matrices = await pageMatrices(cur);
      const { PDFDocument } = await import('pdf-lib');
      const sizes = (await PDFDocument.load(await readFile(cur.file.hash), { ignoreEncryption: true, updateMetadata: false })).getPages().map((p) => p.getSize());
      const { markups, skipped } = await markupsFromFdf(await file.arrayBuffer(), (i) => matrices[i] ?? null, {
        pageSize: (i) => sizes[i] ?? null,
        // Stamps are only an appearance stream in an FDF; PDFium draws them from a PDF built around them.
        open: async (pdf) => {
          const doc = await ctl!.engine.open(pdf.slice().buffer);
          return { pageCount: doc.pages.length, annotations: (i) => doc.annotations(i), annotationImage: (i, index, scale) => doc.annotationImage(i, index, scale), close: () => void doc.close() };
        },
      });
      addImported(cur, markups, file.name);
      if (skipped.length) setError(msg('{count, plural, one {# annotation} other {# annotations}} in {name} could not be imported: {slice}{value}', { count: skipped.length, name: file.name, slice: skipped.slice(0, 5).join('; '), value: skipped.length > 5 ? '; …' : '' }));
    } catch (err) {
      setError(msg('FDF {dir} failed: {value}', { dir, value: err instanceof Error ? err.message : String(err) }));
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
      setError(msg('Importing markups failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
      setNotice(msg('Markups exported as a Bluebeam BAX file. In Revu: Markups › Import Markups.'));
    } catch (err) {
      setError(msg('Exporting markups failed: {value}', { value: err instanceof Error ? err.message : String(err) }));
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
        setNotice(msg('{name} has no markups for this document{value}.', { name: file.name, value: inj.offPage ? ' ' + msg('({offPage} are on pages it does not have)', { offPage: inj.offPage }) : '' }));
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
      const parts = [added && `${added} added`, updated && `${updated} updated`, same && msg('{same} already up to date', { same })].filter(Boolean).join(', ');
      setNotice(msg('Imported {name}: {parts}{value}.', { name: file.name, parts, value: inj.offPage ? msg('; {offPage} on pages this document does not have were left out', { offPage: inj.offPage }) : '' }));
    } catch (err) {
      setError(msg('Importing {name} failed: {value}', { name: file.name, value: err instanceof Error ? err.message : String(err) }));
    }
  };

  /** Adds imported markups as one undo step: new ids, except where the same markup is already here (updated instead). */
  const addImported = (cur: OpenFile, found: readonly Markup[], from: string) => {
    if (!found.length) {
      setNotice(msg('{from} has no markups to import.', { from }));
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
    setNotice(msg('Imported {count, plural, one {# markup} other {# markups}} from {from}{value}.', { count: found.length, from, value: updated ? ' ' + msg('({updated} updated in place)', { updated }) : '' }));
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
        const { renderPageImages, pageNumberLabel } = await import('./documents/pageImages');
        const store = cur.store;
        const legends = { all: () => store.all(), scaleFor: (p: number) => store.scaleFor(p), scaleOf: (m: Markup) => store.scaleOf(m) };
        const { tiffCompression, multiPageTiff, imagePageNumber } = settings.get();
        const images = await renderPageImages(cur.doc, req.pages, {
          dpi: req.dpi,
          format: req.format,
          colour: req.colour,
          tiff: { compression: tiffCompression, multiPage: multiPageTiff },
          ...(req.markups
            ? {
                drawMarkups: (ctx: OffscreenCanvasRenderingContext2D, pageIndex: number, zoom: number) => {
                  for (const m of store.forPage(pageIndex).sort((a, b) => a.createdAt - b.createdAt)) drawMarkup(ctx as unknown as CanvasRenderingContext2D, m, zoom, store.scaleOf(m), legends);
                },
              }
            : {}),
        });
        const ext = req.format === 'png' ? 'png' : req.format === 'tiff' ? 'tif' : 'jpg';
        // Preferences › Images › Page Number: e.g. "Page 001", its digits replaced by the page number.
        const label = (i: number) => {
          const p = req.pages[i]!;
          return (cur.store.allSheets()[p]?.number || pageNumberLabel(imagePageNumber, p + 1)).replace(/[\\/:*?"<>|]+/g, '_');
        };
        if (req.format === 'tiff' && multiPageTiff && req.pages.length > 1) download(`${base}.tif`, new Blob([images[0] as BlobPart], { type: 'image/tiff' }));
        else if (images.length === 1) download(`${base} ${label(0)}.${ext}`, new Blob([images[0] as BlobPart], { type: `image/${req.format}` }));
        else {
          const { zipFiles } = await import('./documents/zip');
          download(`${base} images.zip`, new Blob([zipFiles(images.map((data, i) => ({ name: `${base} ${label(i)}.${ext}`, data }))) as BlobPart], { type: 'application/zip' }));
        }
      }
      setPublishFor(null);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setError(req.kind === 'pdf' ? msg('Publish failed: {error}', { error }) : msg('Export failed: {error}', { error }));
    } finally {
      job.end();
    }
  };

  const commands = buildCommands(commandActions, {
    modelOpen: !!activeModel,
    model3d: model3dState,
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
    textSelected: !!toolsState.textSelection,
    hiddenCount: markups.filter((m) => m.hidden).length,
    selectionLocked: selectedMarkups.some((m) => m.locked),
    selectionGrouped: selectedMarkups.some((m) => m.groupId),
    selectionLinked: anyLinked(selectedMarkups),
    selectionJoinable: selectedMarkups.filter(canJoin).length > 1,
    selectionExplodable: selectedMarkups.some(canExplode),
    selectionCloudable: selectedMarkups.some(canCloud),
    selectionReversible: selectedMarkups.some(canReverse),
    selectionAutoSizable: selectedMarkups.some(canAutoSize),
    selectionCroppable: selectedMarkups.filter((m) => m.type === 'image' && m.image && !m.locked).length === 1,
    selectionPictures: selectedMarkups.filter((m) => m.type === 'image' && m.image && !m.locked).length,
    selectionCropped: selectedMarkups.some((m) => m.type === 'image' && !m.locked && !!cropOf(m)),
    selectionFits: (tool) => (tool === 'offset' ? !selectedMarkups.length || selectedMarkups.some(canOffset) : cadToolFits(tool, selectedMarkups)),
    canPaste: clipboardCount > 0,
    canGoBack,
    canGoForward,
    canUndo: !!activeOpen && activeOpen.store.undoHistory().length > 0,
    split,
    splitHorizontal,
    mirrored: mirrorRef.current,
    sync,
    columns: spread.columns,
    cover: spread.cover,
    magnifier,
    fullScreen,
    continuous: activeMode === 'continuous',
    stitched: activeMode === 'stitch',
    modelOnDrawings,
    anyModelOpen,
    canStitch: !!currentStitch,
    canStitchToPage: !!currentStitch && !!activeOpen && !activeReadOnly,
    canApplyStitching: !!activeOpen && stitchSourceSheets(paneB ? manualStitchB : manualStitchA).length >= 2,
    canConvertDrawingAgain: !!activeCad,
    showLinks: toolsState.showLinks,
    snap: toolsState.snap,
    showToolbar: showTools,
    toolbarStyle: ws.toolbarStyle,
    ribbonCollapsed: ws.ribbonCollapsed,
    showLeft: leftOpen,
    showRight: rightShown,
    hasRightPanels: rightRail.length > 0,
    showBottom: bottomOpen,
    tool: toolsState.tool,
    settings: prefs,
    openTabCount: (tabPaneOf(pane) === 'b' ? tabsB : tabsA).length,
    hasClosedTabs: closedTabs.length > 0,
    leftTab,
    rightTab,
    bottomTab,
    flowShape: toolsState.flowShape,
    connectorRoute: toolsState.connectorRoute,
    canAddNextShape: !activeReadOnly && selectedMarkups.length === 1 && !selectedMarkups[0]!.locked && canConnect(selectedMarkups[0]!),
    canConnectShapes: !activeReadOnly && selectedMarkups.filter((m) => !m.locked && canConnect(m)).length > 1,
    cutoutReady: !activeReadOnly && !!cutoutTargetOf(selectedMarkups, mayEditMarkup),
    canArc: !activeReadOnly && !!activeTools?.canArc(),
    arcArmed: toolsState.arc !== 'off',
    hipValley: toolsState.tool === 'polylength' && (toolsState.preset?.slope?.kind === 'hip' || toolsState.preset?.slope?.kind === 'valley') ? toolsState.preset.slope.kind : null,
    canSaveTemplate: !activeReadOnly && selectedMarkups.length === 1 && templateable(selectedMarkups[0]!),
    cutoutHint: cutoutBlocker(selectedMarkups, mayEditMarkup) ?? undefined,
  });
  const commandMap = new Map(commands.map((c) => [c.id, c]));
  commandsRef.current = commandMap;

  /** A side's panel rail: click a panel to show it; drag it along the rail, or onto the other side, to move it. */
  const panelRail = (side: DockSide, items: ReturnType<typeof RAIL>) => {
    const shown = side === 'left' ? leftOpen : rightOpen;
    const open = shown ? (side === 'left' ? leftTab : rightTab) : null;
    const labelled = railLabels[side];
    // The chevron points toward the window edge to collapse the rail, and away from it to expand.
    const pointsLeft = labelled === (side === 'left');
    return (
    <nav
      className={['rail', side, labelled ? 'labelled' : '', railDrag?.side === side && !railDrag.over ? 'drop-target' : ''].filter(Boolean).join(' ')}
      aria-label={side === 'left' ? msg('Panels') : msg('Right panels')}
      onDragOver={(e) => dragOverSide(e, side)}
      onDrop={(e) => dropOnSide(e, side)}
    >
      {(side === 'left' || items.length > 0) && (
      <button
        type="button"
        className="rail-toggle"
        title={labelled ? msg('Collapse the panel names') : msg('Show the panel names')}
        aria-label={labelled ? msg('Collapse the panel names') : msg('Show the panel names')}
        aria-pressed={labelled}
        onClick={() => toggleRailLabels(side)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="1.6" d={pointsLeft ?'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
        </svg>
        <span className="rail-label">{msg('Collapse')}</span>
      </button>
      )}
      {items.map(({ id, title, icon, experimental }) => (
        <button
          key={id}
          type="button"
          className={[
            open === id ? 'active' : '',
            railDrag?.id === id ? 'dragging' : '',
            railDrag?.over === id ? (railDrag.after ? 'drop-after' : 'drop-before') : '',
            experimental ? 'experimental' : '',
          ].filter(Boolean).join(' ')}
          title={experimental ? msg('{title} (Experimental)', { title }) : title}
          aria-pressed={open === id}
          data-panel={id}
          draggable
          onDragStart={(e) => startPanelDrag(e, id)}
          onDragOver={(e) => {
            if (!railDrag || railDrag.id === id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > r.top + r.height / 2;
            if (railDrag.over !== id || railDrag.after !== after || railDrag.side !== side) setRailDrag({ ...railDrag, over: id, after, side });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (railDrag) dockPanel(railDrag.id, side, id, railDrag.after);
            setRailDrag(null);
          }}
          onDragEnd={() => setRailDrag(null)}
          onClick={() => {
            if (open === id) (side === 'left' ? setLeftOpen : setRightOpen)(false);
            else showPanel(id);
          }}
        >
          {icon}
          <span className="rail-label">{title}</span>
          {experimental && <span className="rail-exp">{msg('Exp')}</span>}
        </button>
      ))}
      {!items.length && railDrag && <div className="rail-drop-hint">{msg('Dock here')}</div>}
    </nav>
    );
  };

  /** The side panel on one side of the window, showing the panel picked on that side's rail. */
  const sidePanel = (side: DockSide) => {
    const tab = side === 'left' ? leftTab : rightTab;
    if (!(side === 'left' ? leftOpen : rightOpen) || panelSide(tab) !== side) return null;
    // A 3D panel left open when the last model closed gives the space back to the drawing.
    if (!anyModelOpen && RAIL().find((r) => r.id === tab)?.needsModel) return null;
    const width = side === 'left' ? shownWidths.left : shownWidths.right;
    const close = () => (side === 'left' ? setLeftOpen(false) : setRightOpen(false));
    return (
      <aside
        className={`panel side ${side}${tab === 'sessions' || tab === 'projects' ? ' rc-chrome' : ''}${railDrag?.side === side && !railDrag.over ? ' drop-target' : ''}`}
        style={{ width }}
        onDragOver={(e) => dragOverSide(e, side)}
        onDrop={(e) => dropOnSide(e, side)}
      >
        <h2
          style={tab === 'layers' ? { display: 'none' } : undefined}
          draggable
          title={msg('Drag to the left or right side of the window to dock this panel there')}
          onDragStart={(e) => startPanelDrag(e, tab)}
          onDragEnd={() => setRailDrag(null)}
        >
          {leftTitles()[tab]}
          {tab === 'markups' && (
            <button className="drawer-popout" aria-label={msg('Dock the Markups list at the bottom')} title={msg('Dock at the bottom of the window')} draggable={false} onClick={undockMarkups}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M2 2.5h12v11H2zM2 10h12" />
              </svg>
            </button>
          )}
          <button className="drawer-close" aria-label={msg('Close the panel')} title={msg('Close')} draggable={false} onClick={close}>
            ×
          </button>
        </h2>
        {tab === 'search' ? (
          <SearchPanel
            activeId={activeOpen?.file.id ?? null}
            activeKey={activeOpen ? `${activeOpen.file.id}:${activeOpen.file.hash}` : null}
            currentPage={pageIndex}
            memory={searchMemory}
            focusToken={searchFocus}
            sheets={sheets}
            sources={(scope) => {
              const tabs = pdfTabs([...tabsA, ...tabsB]);
              const fromTab = (o: OpenFile, page?: number) => openSource(o, formModels[o.file.hash], page);
              if (scope === 'document') return activeOpen ? [fromTab(activeOpen)] : [];
              if (scope === 'page') return activeOpen ? [fromTab(activeOpen, pageIndex)] : [];
              if (scope === 'open') return tabs.map((o) => fromTab(o));
              return recentList(false)
                .filter((f) => !isModelFile(f))
                .map((f) => {
                  const tab = tabs.find((t) => t.file.id === f.id);
                  return tab ? fromTab(tab) : librarySource(f);
                });
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
                    setNotice(msg('Marked {count, plural, one {# match} other {# matches}} for redaction. Tools › Redaction › Apply Redactions removes them.', { count: hits.length }));
                  }
                : undefined
            }
            readOnly={activeReadOnly}
            countTools={ws.toolChests
              .filter((t) => t.id !== RECENT_TOOLS_ID)
              .flatMap((t) => t.items)
              .filter((i) => i.type === 'count')
              .map((i): CountTool => ({ id: i.id, name: i.label || i.subject || 'Count', style: i.style, ...(i.subject ? { subject: i.subject } : {}), ...(i.label ? { label: i.label } : {}), ...(i.markups ? { markups: i.markups } : {}) }))}
            onApplyCount={
              activeOpen
                ? (found, tool) => {
                    const store = activeOpen.store;
                    if (store.readOnly || !found.length) return;
                    const now = Date.now();
                    const made = countsFromHits(found, {
                      base: { status: 'none', author: authorRef.current, createdAt: now, modifiedAt: now, fields: defaultFieldsFor(store) },
                      style: { ...(activeTools?.getState().styles.count ?? DEFAULT_STYLES.count) },
                      subject: 'Text Search',
                      tool,
                    });
                    store.checkpoint();
                    store.batch(() => made.forEach((m) => store.add(m)));
                    setNotice(msg('Counted {count, plural, one {# match} other {# matches}}{value}.', { count: found.length, value: tool ? ' ' + msg('with {name}', { name: tool.name }) : '' }));
                  }
                : undefined
            }
            onResults={(hits) => {
              searchHits.current = hits;
              activeTools?.setHighlights(hits);
            }}
            onOpen={(hit, sameDoc, file) => void openDocSearchHit(hit, sameDoc, file)}
          />
        ) : tab === 'markups' ? (
          markupsPopped ? (
            <div className="popout-note">
              <p>{msg('The Markups list is open in its own window.')}</p>
              <button type="button" className="btn small" onClick={() => setMarkupsPopped(false)}>
                {msg('Bring it back')}
              </button>
            </div>
          ) : (
            <div className="dock-body">{markupList}</div>
          )
        ) : tab === 'pages' ? (
          <PagesPanel
            doc={activeOpen?.doc ?? null}
            store={activeOpen?.store ?? null}
            view={activeTools ?? null}
            currentPage={pageIndex}
            sheets={sheets}
            scales={scales}
            busy={busyPages || indexing}
            onGoTo={(i) => v?.changePage(i)}
            onPageOps={(ops, inserts) => void applyPageOps(ops, inserts)}
            onSetScale={(pages, scale) => activeOpen?.store.setScale(pages, withDefaultUnits(scale))}
            onCalibrate={activeOpen && !activeReadOnly ? () => activeTools?.setTool('calibrate') : null}
            onSetLabel={(pages, label) => {
              for (const i of pages) activeOpen?.store.editSheet(i, { number: label });
            }}
            onBulkScales={(pages) => startLabelRegions(undefined, 'scale', { pages })}
            onPageLabels={(pages) => startLabelRegions(undefined, 'label', { pages, typed: true })}
            onThumbMenu={(e, pages, rename) => showMenu(e, thumbMenu(pages, rename))}
            onCopyPages={(pages) => void copyPages(pages)}
            onPastePages={pastePages}
          />
        ) : tab === 'forms' ? (
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
              await editForm(activeOpen.file.id, msg('Changing the field'), async (bytes) => (await import('./documents/forms')).updateField(bytes, name, changes));
              if (changes.name) setSelectedField(changes.name);
            }}
            onDelete={(name) => {
              if (!activeOpen || !confirm(msg('Delete the field "{name}"?', { name }))) return;
              void editForm(activeOpen.file.id, msg('Deleting the field'), async (bytes) => (await import('./documents/forms')).removeFields(bytes, [name]));
              setSelectedField(null);
            }}
            onReorder={(names) => activeOpen && void editForm(activeOpen.file.id, msg('Changing the tab order'), async (bytes) => (await import('./documents/forms')).setTabOrder(bytes, names))}
            onReset={() => {
              if (!activeOpen || !confirm(msg('Clear every field of this form?'))) return;
              void editForm(activeOpen.file.id, msg('Resetting the form'), async (bytes) => (await import('./documents/forms')).resetForm(bytes));
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
                  setError(msg('{name} could not be read as form data.', { name: file.name }));
                  return;
                }
                const known = new Set(model.fields.filter((f) => f.type !== 'button' && f.type !== 'signature').map((f) => f.name));
                const values = Object.fromEntries(Object.entries(data).filter(([k]) => known.has(k)));
                const n = Object.keys(values).length;
                if (!n) {
                  setNotice(msg('None of the fields in {name} are in this form.', { name: file.name }));
                  return;
                }
                await fillFields(activeOpen.file.id, values);
                setNotice(msg('Filled in {n, plural, one {# field} other {# fields}} from {name}.', { n, name: file.name }));
              })();
            }}
          />
        ) : tab === 'sets' ? (
          <SetsPanel
            library={library}
            current={activeOpen && !studioDocOf(activeOpen.file.id) ? { fileId: activeOpen.file.id, page: pageIndex } : null}
            indexing={indexingSets}
            onIndex={(ids) => void indexSetFiles(ids)}
            onOpenSheet={(fileId, page) => void openSetSheet(fileId, page)}
            onRevisions={(setId, pairs) => void followUpRevisions(setId, pairs)}
            onPreview={setSheetPreview}
          />
        ) : tab === 'properties' ? (
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
        ) : tab === 'bookmarks' ? (
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
            onFromRegions={() => startLabelRegions(undefined, 'label', { bookmarks: true })}
            currentView={() => (v ? visibleView(v, paneB ? canvasBRef.current : canvasRef.current) : { pageIndex, rect: null })}
          />
        ) : tab === 'layers' ? (
          <LayersPanel
            docKey={activeOpen?.file.hash ?? null}
            pdfLayers={activeOpen ? (pdfLayers[activeOpen.file.hash] ?? []) : []}
            hiddenPdf={new Set(activeOpen ? (hiddenPdfLayers[activeOpen.file.id] ?? []) : [])}
            markupLayers={(() => {
              const counts = new Map<string, number>();
              for (const m of markups) counts.set(m.layer ?? '', (counts.get(m.layer ?? '') ?? 0) + 1);
              // Markups on no layer are listed only once some markup is on a layer.
              if (counts.size === 1 && counts.has('')) return [];
              return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => (a.name === '' ? 1 : b.name === '' ? -1 : a.name.localeCompare(b.name)));
            })()}
            hiddenMarkup={new Set(activeOpen ? (hiddenMarkupLayers[activeOpen.file.id] ?? []) : [])}
            onHidden={(pdf, markup) => {
              const cur = activeOpen;
              if (!cur) return;
              const id = cur.file.id;
              setHiddenMarkupLayers((all) => ({ ...all, [id]: markup }));
              const was = hiddenPdfLayers[id] ?? [];
              if (was.length === pdf.length && was.every((x) => pdf.includes(x))) return;
              setHiddenPdfLayers((all) => ({ ...all, [id]: pdf }));
              void showPdfLayers(cur, new Set(pdf)).catch((err) => setError(msg('Showing layers failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
            }}
            onFaded={(markup) => {
              const id = activeOpen?.file.id;
              if (!id || (!markup.length && !fadedMarkupLayers[id]?.length)) return;
              setFadedMarkupLayers((all) => ({ ...all, [id]: markup }));
            }}
            onPage={
              activeOpen && pdfLayerPages[activeOpen.file.hash]
                ? {
                    pdf: new Set(pdfLayerPages[activeOpen.file.hash]![pageIndex] ?? []),
                    markup: new Set(markups.filter((m) => m.pageIndex === pageIndex).map((m) => m.layer ?? '')),
                  }
                : null
            }
            showLinks={toolsState.showLinks}
            onShowLinks={(show) => activeTools?.setShowLinks(show)}
          />
        ) : tab === 'toolchest' ? (
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
        ) : tab === 'measurements' ? (
          <MeasurementsPanel
            markups={markups}
            scales={scales}
            selected={toolsState.selected}
            onSelect={selectFromList}
            scaleOf={scaleOf}
            viewports={viewports.filter((x) => x.pageIndex === pageIndex)}
            allViewports={viewports}
            onViewports={
              activeOpen && !activeReadOnly
                ? {
                    add: () => activeTools?.setTool('viewport'),
                    update: (x) => activeOpen.store.setViewport(x),
                    remove: (id) => activeOpen.store.removeViewport(id),
                  }
                : null
            }
            pageIndex={pageIndex}
            pageCount={pageCount}
            pageName={activeOpen ? (pageLabelFor(activeOpen, pageIndex).startsWith('Page ') ? activeOpen.file.name.replace(/\.pdf$/i, '') : pageLabelFor(activeOpen, pageIndex)) : ''}
            onScale={activeOpen && !activeReadOnly ? (scale) => activeOpen.store.setScale([pageIndex], withDefaultUnits(scale)) : null}
            onApplyScale={activeOpen && !activeReadOnly && scales[pageIndex] ? (pages) => activeOpen.store.setScale(pages, scales[pageIndex]!) : null}
            tool={toolsState.tool}
            onTool={activeOpen && !activeReadOnly ? (next) => (next === 'cutout' ? startCutoutFromSelection() : activeTools?.setTool(next)) : null}
            store={activeOpen && !activeReadOnly ? activeOpen.store : null}
            defaults={measureDefaults}
            onDefaults={setMeasureDefaults}
            takeoff={activeOpen ? { assemblies, totals: (ms) => rollup(ms, takeoffAssemblies, cellContext, 'item'), onManage: () => setAssembliesOpen(true) } : null}
          />
        ) : tab === 'spaces' ? (
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
        ) : tab === 'ai' ? (
          <SemanticComparePanel
            docs={[...new Map([...tabsA, ...tabsB].map((t) => [t.file.id, { id: t.file.id, name: t.file.name }])).values()]}
            currentId={activeOpen?.file.id ?? null}
            onRun={runSemanticCompare}
            onGo={(change) => void goToParagraph(change)}
            onSideBySide={(oldId, newId) => void showSideBySide(oldId, newId)}
            onMessage={setNotice}
          />
        ) : tab === 'geospatial' ? (
          <GeospatialPanel
            docKey={activeOpen?.file.hash ?? null}
            store={activeOpen?.store ?? null}
            tools={activeTools ?? null}
            handlers={geoHandlersRef}
            pageIndex={pageIndex}
            pageLabel={(i) => pageLabelFor(activeOpen, i)}
            pageSize={(i) => v?.pageSize(i) ?? null}
            metersPerPoint={(i) => scales[i]?.metersPerPoint ?? null}
            stitchGroups={stitchGroups}
            stitched={activeMode === 'stitch'}
            onOpenStitched={(p) => {
              const group = stitchGroups.find((g) => g.placements.some((x) => x.pageIndex === p));
              if (group && activeMode !== 'stitch') openStitch(group, p);
            }}
            onShowStitching={() => showPanel('stitching')}
            matchLines={(paneB ? manualStitchB : manualStitchA).lines}
            onSetScale={() => {
              setCustomScalePage(pageIndex);
              setCustomScalePane(paneB ? 'b' : 'a');
            }}
            onCalibrate={activeOpen && !activeReadOnly ? () => activeTools?.setTool('calibrate') : null}
            editable={!!activeOpen && !activeReadOnly}
            onGoTo={(p) => v?.goToPage(p)}
            onNotice={setNotice}
          />
        ) : tab === 'stitching' ? (
          <StitchPanel
            stitch={paneB ? manualStitchB : manualStitchA}
            editable={!!activeOpen && !activeReadOnly}
            pageIndex={pageIndex}
            pageLabel={(i) => pageLabelFor(activeOpen, i)}
            hasViewport={(p) => viewports.some((x) => x.pageIndex === p)}
            tool={toolsState.tool}
            onSetTool={(t) => activeTools?.setTool(t)}
            onChange={(next) => activeOpen?.store.setManualStitch(next)}
            onGoTo={(p) => v?.goToPage(p)}
            selected={stitchSelected}
            onSelectLine={setStitchSelected}
            onPreview={currentStitch || activeMode === 'stitch' ? () => openStitch(activeMode === 'stitch' ? null : currentStitch, pageIndex) : null}
            previewing={activeMode === 'stitch'}
            onStitchToPage={currentStitch && activeOpen && !activeReadOnly ? (withMarkups) => void stitchToNewPage(currentStitch, withMarkups).catch(() => {}) : null}
            onNudge={nudgeStitch}
            onReset={resetStitch}
            moverPage={(id) => {
              const lines = (paneB ? manualStitchB : manualStitchA).lines;
              const group = stitchGroups.find((g) => g.placements.some((p) => p.pageIndex === lines.find((l) => l.id === id)?.pageIndex)) ?? null;
              return moverLine(lines, id, group)?.pageIndex ?? null;
            }}
            lockAlong={stitchLockAlong}
            onLockAlong={setStitchLockAlong}
            onAdoptDetected={
              currentStitch && activeOpen && !activeReadOnly && currentStitch.edges.some((e) => e.line) && !(paneB ? manualStitchB : manualStitchA).lines.some((l) => currentStitch.placements.some((p) => p.pageIndex === l.pageIndex))
                ? () => {
                    const s = activeOpen.store.manualStitch();
                    const adopted = adoptDetected(currentStitch, s.lines);
                    activeOpen.store.setManualStitch({ ...s, lines: [...s.lines, ...adopted] });
                    setNotice(msg('{count} detected join{value2} can now be edited.', { count: adopted.length / 2, value2: adopted.length === 2 ? '' : 's' }));
                  }
                : null
            }
          />
        ) : tab === 'model3d' ? (
          <Model3dPanel
            view={activeModel?.view ?? null}
            fileHash={activeModel?.file.hash ?? null}
            sheets={mapSheets()}
            onDownload={(name, text) => download(name, new Blob([text], { type: 'application/json' }))}
            onSaveFile={(name, data) => download(name, data)}
            onNotice={setNotice}
          />
        ) : tab === 'model3dProps' ? (
          <Model3dPropertiesPanel view={activeModel?.view ?? null} sheets={mapSheets()} onOpenSheet={openSheetAt} />
        ) : tab === 'flags' ? (
          <FlagsPanel markups={markups} statuses={columnSet.statuses} selected={toolsState.selected} onSelect={selectFromList} onAdd={activeOpen && !activeReadOnly ? () => activeTools?.setTool('flagLabel') : null} />
        ) : (tab === 'projects' || tab === 'sessions') && !desktop() ? (
          <DesktopOnlyNotice kind={tab} />
        ) : tab === 'projects' ? (
          <ProjectsPanel
            me={author}
            oneDriveAvailable={oneDriveSharingEnabled}
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
            onShowComments={(project) => (commentsTable?.key === `project:${project.id}` ? setCommentsTable({ ...commentsTable, hidden: false }) : void showProjectComments(project))}
            onAddCurrent={async (project, folderId, onProgress) => {
              const cur = activeOpen;
              if (!cur) return;
              onProgress({ done: 0, total: 1, name: cur.file.name });
              const bytes = await annotatedBytes(cur);
              await addToProject(project, folderId, [{ name: cur.file.name, bytes: bytes.slice().buffer, libraryId: cur.file.id }], onProgress);
            }}
          />
        ) : tab === 'sessions' ? (
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
            oneDriveAvailable={oneDriveSharingEnabled}
            folderAvailable={folderSessionsAvailable()}
            onJoinFolder={folderSessionsAvailable() ? joinFolderStudio : undefined}
            onShowFolder={(id) => void desktop()?.folder.show(id).catch((err) => setStudioError(err instanceof Error ? err.message : String(err)))}
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
              if (format === 'comments') {
                const session = sessionById(id);
                if (commentsTable?.key === `session:${id}`) setCommentsTable({ ...commentsTable, hidden: false });
                else if (session) void showSessionComments(session);
                return;
              }
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
        ) : tab === 'signatures' ? (
          <div className="signatures-wrap">
          <DigitalSignaturesSection
            checks={activeOpen ? (sigChecks[activeOpen.file.hash] ?? null) : []}
            activeContent={activeOpen ? (activeContent[activeOpen.file.hash] ?? null) : null}
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
              if (!c.certificates.length) throw new Error(msg('The signature carries no certificate'));
              const chain = await buildChain(c.certificates[0]!, c.certificates);
              const r = await checkRevocation(chain, pkiFetch);
              const when = r.at ? ' ' + msg('(as of {at})', { at: r.at.toLocaleString() }) : '';
              const trust = r.verified ? '' : ' The answer’s signature could not be checked.';
              return r.status === 'good'
                ? msg('Not revoked, says the certificate authority’s {via}{when}.{trust}', { via: r.via, when, trust })
                : r.status === 'revoked'
                  ? `Revoked${r.revokedAt ? ` on ${r.revokedAt.toLocaleString()}` : ''} (${r.via}).${c.signedAt && r.revokedAt && c.signedAt < r.revokedAt ? ' It was signed before that.' : ''}${trust}`
                  : msg('The {via} responder does not know this certificate.', { via: r.via });
            }}
            {...(desktop()?.pkiFetch
              ? {
                  onAddLtv: async (c: SignatureCheck) => {
                    if (!activeOpen) throw new Error(msg('No document is open'));
                    let note: string | null = null;
                    const ok = await editForm(
                      activeOpen.file.id,
                      msg('Adding long-term validation'),
                      async (bytes) => {
                        const out = await addLtv(new Uint8Array(bytes), { fields: [c.field] });
                        note = out.problems.length ? msg('Added, but not for all of it: {problems}', { problems: out.problems.join('; ') }) : null;
                        return out.bytes;
                      },
                      `Before adding long-term validation`,
                      true,
                    );
                    return ok ? (note ?? 'Long-term validation added: the chain and revocation answers are kept in the PDF.') : 'LTV not added.';
                  },
                }
              : {})}
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
            recents={recentList()}
            onClearRecents={() => removeFromRecents(library.map((f) => f.id))}
            activeHash={activeOpen?.file.hash ?? null}
            onOpen={(f) => void openFromLibrary(f)}
            fileMenu={(f, groupEntries) => {
              const base = libraryMenu(f);
              // File Access groups go after the open and session actions.
              const at = base.findIndex((x) => 'sep' in x);
              return at < 0 ? [...base, SEP, ...groupEntries] : [...base.slice(0, at), SEP, ...groupEntries, ...base.slice(at)];
            }}
            reveal={revealFile}
            onRemove={(f) => void removeFile(f).then(() => forgetHandle(f.id)).then(refreshLibrary)}
          />
        )}
        <div className="panel-split" role="separator" aria-orientation="vertical" aria-label={msg('Resize side panel')} title={msg('Drag to resize, click to collapse')} onPointerDown={(e) => onSideResize(side, e)} />
      </aside>
    );
  };

  const markupList = (
    <MarkupList
      markups={markups}
      store={activeOpen?.store ?? null}
      scaleOf={scaleOf}
      sheets={sheets}
      columnSet={columnSet}
      assemblies={assemblies}
      readOnly={!activeOpen || activeReadOnly}
      selected={toolsState.selected}
      onSelect={selectRowsFromList}
      onReply={onListReply}
      onRowMenu={onListRowMenu}
      onManageColumns={onManageColumns}
      onExport={onExportList}
      onSync={() => setSyncOpen(true)}
      syncing={!!sheetSync.link}
      syncError={sheetSync.status.kind === 'error' ? sheetSync.status.message : sheetSync.issues.length ? `${sheetSync.issues.length} cell${sheetSync.issues.length === 1 ? ' is' : 's are'} paused: changed here and in Excel. Click to choose.` : null}
      onFiltered={setListKept}
      allHidden={allMarkupsHidden}
      onToggleAllHidden={toggleAllMarkupsHidden}
    />
  );

  // The Markups list sits beside the side panels, or spans the window below them.
  const bottomDock = !dockOpen ? (
    <button type="button" className="dock-edge" aria-label={msg('Open the Markups list')} title={msg('Open the Markups list')} onClick={() => setDockOpen(true)} />
  ) : (
    <aside
      className="bottom-dock"
      style={{ height: dockHeight }}
      onDragOver={(e) => {
        if (railDrag?.id !== 'markups') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        if (railDrag?.id !== 'markups') return;
        e.preventDefault();
        undockMarkups();
        setRailDrag(null);
      }}
    >
      <div className="dock-split" role="separator" aria-orientation="horizontal" aria-label={msg('Resize markups panel')} title={msg('Drag to resize, click to collapse')} onPointerDown={onDockSplit} />
      <div className="tabs">
        <button
          type="button"
          className="dock-width-toggle"
          title={dockFull ? msg('Fit the panel between the side panels') : msg('Extend the panel across the full width')}
          aria-label={dockFull ? msg('Fit the panel between the side panels') : msg('Extend the panel across the full width')}
          aria-pressed={dockFull}
          onClick={() => updateWorkspace((w) => ({ ...w, dockFullWidth: !w.dockFullWidth }))}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.6" d={dockFull ? 'M1 4l4 4-4 4M15 4l-4 4 4 4M8 2v12' : 'M5 4 1 8l4 4M11 4l4 4-4 4M1 8h14'} />
          </svg>
        </button>
        <div className="dock-tablist" role="tablist">
          {!ws.markupsDocked && (
            <button
              role="tab"
              aria-selected={bottomTab === 'markups'}
              className={bottomTab === 'markups' ? 'active' : ''}
              title={msg('Drag to a side of the window to dock the Markups list there')}
              draggable
              onDragStart={(e) => startPanelDrag(e, 'markups')}
              onDragEnd={() => setRailDrag(null)}
              onClick={() => setBottomTab('markups')}
            >
              {msg('Markups')}
            </button>
          )}
          <button
            role="tab"
            aria-selected={bottomTab === 'links'}
            className={bottomTab === 'links' ? 'active' : ''}
            onClick={() => setBottomTab('links')}
          >
            {msg('Links{value}', { value: links.some((l) => l.status === 'review') ? ' •' : '' })}
          </button>
        </div>
        {bottomTab === 'markups' && !markupsPopped && (
          <button type="button" className="drawer-popout" aria-label={msg('Open the Markups list in its own window')} title={msg('Open in its own window')} onClick={() => setMarkupsPopped(true)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M9 2h5v5M14 2 7.5 8.5M12 10v3.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H6" />
            </svg>
          </button>
        )}
        <button className="drawer-close" aria-label={msg('Close the Markups list')} title={msg('Close')} onClick={() => setShowBottom(false)}>
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
            marks={[...ws.taughtMarks, ...((activeOpen && standardOf(activeOpen.store)?.marks.map((m) => ({ ...m, standard: standardOf(activeOpen.store)!.name }))) ?? [])]}
            editable={!!activeOpen && !activeOpen.store.readOnly}
            onTeach={() => startSetup(undefined, 'sections')}
            onForget={(id) => forgetMark(id, activeOpen)}
          />
        ) : markupsPopped ? (
          <div className="popout-note">
            <p>{msg('The Markups list is open in its own window.')}</p>
            <button type="button" className="btn small" onClick={() => setMarkupsPopped(false)}>
              {msg('Bring it back')}
            </button>
          </div>
        ) : (
          markupList
        )}
      </div>
    </aside>
  );

  return (
    <div
      className={`app${fullScreen ? ' fullscreen' : ''}`}
      onContextMenuCapture={() => setCtxInPopOut(false)}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        // Text fields keep the browser's own menu (spelling, copy and paste).
        if (target.closest('input, textarea, select, [contenteditable]')) return;
        // The ribbon's tabs sit in the menu bar's row; the ribbon shows its own menu for them.
        if (target.closest('.rb-tabs')) return;
        if (target.closest('.rail')) showMenu(e, panelsMenu(target.closest<HTMLElement>('[data-panel]')?.dataset.panel as LeftTab | undefined));
        else if (target.closest('.toolbar.tools')) showMenu(e, toolbarMenu(e));
        else if (target.closest('.menubar, .toolbar,.statusbar, .doc-tabs, .tabs, .panel.side > h2')) showMenu(e, layoutMenu());
        else if (!target.closest('.modal, .ctx-root, a')) e.preventDefault();
      }}
    >
      <input
        ref={openFileRef}
        type="file"
        accept={`application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp,${CAD_ACCEPT},${MODEL_ACCEPT}`}
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
        accept={`application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp,${CAD_ACCEPT},${MODEL_ACCEPT}`}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !open) return;
          const at = (v?.currentPageIndex ?? pageIndex) + 1;
          void applyPageOps([{ type: 'insert', source: 0, at }], [isCadFile(file) ? (await convertFile(file)).pdf : isImageFile(file) ? await imageToPdf(file) : await file.arrayBuffer()]);
        }}
      />
      <input
        ref={bulkInsertFileRef}
        type="file"
        accept={`application/pdf,.pdf,image/png,image/jpeg,image/gif,image/bmp,image/webp,${CAD_ACCEPT},${MODEL_ACCEPT}`}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length && open) setBulkInsertFiles(files);
        }}
      />
      <MenuBar
        commands={commandMap}
        author={author}
        onAuthorChange={persistAuthor}
        recents={recentList().map((f) => ({ id: f.id, name: f.name }))}
        profiles={profileList.map((p) => ({ id: p.id, name: p.name }))}
        activeProfileId={activeProfileId}
        hiddenPanels={ws.hiddenPanels}
        panels={{ showLeft: leftOpen, showBottom: bottomOpen, leftTab, bottomTab }}
        stamps={stampLibrary(ws).map((s) => ({ id: s.id, name: s.name }))}
        update={updateState}
        on={{
          update: onUpdateButton,
          placeStamp: (id) => {
            const s = stampLibrary(ws).find((x) => x.id === id);
            if (s) placeStamp(s);
          },
          openRecent: (id) => {
            const f = library.find((x) => x.id === id);
            if (f) void openFromLibrary(f);
          },
          clearRecents: () => removeFromRecents(library.map((f) => f.id)),
          switchProfile: (id) => profiles.switchTo(id),
          showLeft: showPanel,
          showBottom: showBottomPanel,
          install: () => setInstallOpen(true),
          openSetting: (s) => {
            setPrefsCategory({ category: s.category, tab: s.tab, query: s.label === s.tabLabel ? undefined : s.label });
            setPrefsOpen(true);
          },
        }}
      />
      {activeTools && showTools && (() => {
        const toolbarProps: ToolBarProps = {
          tools: activeTools,
          state: toolsState,
          styleType,
          markups,
          selectedStyle,
          cloudBubble,
          geometry: selectedShape && activeOpen ? { markup: selectedShape, scale: activeOpen.store.scaleOf(selectedShape), store: activeOpen.store, readOnly: activeReadOnly || !!selectedShape.locked || !activeOpen.store.mayEdit(selectedShape) } : null,
          // Whatever is selected: the Markup Format tab edits what they share, together (style needs two or more).
          selection: toolsState.tool === 'select' && activeOpen && toolsState.selected.size > 0 ? { markups: markups.filter((m) => toolsState.selected.has(m.id)), store: activeOpen.store } : null,
          layerNames: [...new Set([...markups.flatMap((m) => (m.layer ? [m.layer] : [])), ...(activeOpen ? addedMarkupLayers(activeOpen.file.hash) : [])])],
          askLayer: () => askText(msg('New Markup Layer'), '', { label: msg('Markups go on it. Layers show and hide in the Layers panel, and are PDF layers in saved files.'), confirm: msg('Create') }).then((name) => name?.trim() || null),
          textType,
          textMarkupStyle: selectedText?.type === 'table' && toolsState.tableCells?.id === selectedText.id ? (activeTools?.selectedCellStyle() ?? selectedText.style) : selectedText?.style,
          enabled: !!activeOpen && !activeReadOnly,
          // Units & Scale shows while measuring: a measure tool is active, or measurements are selected.
          unitsScale:
            activeOpen && (MEASURE_TOOLS.some((t) => t.tool === toolsState.tool) || selectedMarkups.some((m) => isMeasureKind(m.type)))
              ? {
                  scale: scales[pageIndex] ?? null,
                  disabled: activeReadOnly,
                  onPreset: (scale) => activeOpen.store.setScale([pageIndex], withDefaultUnits(scale)),
                  onCustom: () => {
                    setCustomScalePage(pageIndex);
                    setCustomScalePane(paneB ? 'b' : 'a');
                  },
                  onUnitsChanged: () => {
                    const current = scales[pageIndex];
                    if (current) activeOpen.store.setScale([pageIndex], scaleInDefaultUnits(current));
                  },
                }
              : null,
          visibleTools: ws.toolbarTools,
          author,
          onPlaceStamp: (s) => placeStamp(s),
          onNewStamp: () => {
            setStampsCreating(true);
            setStampsOpen(true);
          },
          onManageStamps: () => {
            setStampsCreating(false);
            setStampsOpen(true);
          },
          onUndo: () => activeOpen?.store.undo(),
          onRedo: () => activeOpen?.store.redo(),
          takeoffTemplates: activeOpen ? { document: estimating.templates, onUse: armTemplate } : null,
          takeoffAssembly: activeOpen ? { assemblies, defaults: measureDefaults, onDefaults: setMeasureDefaults, onManage: () => setAssembliesOpen(true) } : null,
        };
        const displayMenu = <ToolbarDisplayMenu commands={commandMap} />;
        return ws.toolbarStyle === 'ribbon' ? (
          <Ribbon commands={commandMap} toolbar={toolbarProps} collapsed={ws.ribbonCollapsed} onCollapsedChange={(ribbonCollapsed) => updateWorkspace((w) => ({ ...w, ribbonCollapsed }))} displayMenu={displayMenu} model3d={activeModel ? { views: model3dState?.views ?? [], openView: model3dState?.openView ?? null, run: (a) => activeModel.view.controls()?.run(a) } : null} />
        ) : (
          <ToolBar {...toolbarProps} toolbarMenu={displayMenu} />
        );
      })()}
      {!split && docTabs('a')}
      <div className="body">
        {panelRail('left', leftRail)}
        {sidePanel('left')}
        {!leftOpen && <button type="button" className="panel-edge" aria-label={msg('Open the side panel')} title={msg('Open the side panel')} onClick={() => setLeftOpen(true)} />}
        <div className="workspace">
          <div id="rc-project-slot" className="rc-project-slot" />
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
                  if (e.dataTransfer.types.includes(PANEL_DRAG_TYPE)) return;
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
                  const images = open ? [...e.dataTransfer.files].filter(isImageFile) : [];
                  if (images.length) dropImagesRef.current('a', images, e.clientX, e.clientY);
                  void droppedPdfs(e.dataTransfer).then((files) => {
                    if (files.length) void openNewFile(files, 'a');
                  });
                }}
              >
                <canvas ref={canvasRef} />
                {modelA && <ModelStage view={modelA.view} />}
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
                {(toolsStateA.tool === 'offset' || isCadTool(toolsStateA.tool)) && open && ctl && (
                  <CadBar
                    tool={toolsStateA.tool}
                    prompt={ctl.tools.cadPromptText()}
                    error={toolsStateA.cad?.error ?? null}
                    source={toolsStateA.painterSource}
                    scale={toolsStateA.painterSource ? open.store.scaleOf(toolsStateA.painterSource) : open.store.scaleFor(pageIndex)}
                    onCancel={() => ctl.tools.cancel()}
                  />
                )}
                {!open && !modelA && (
                  <StartScreen
                    launchOpen={launchOpen}
                    onOpen={() => openFromDisk()}
                    onNew={() => setBlankPdf('new')}
                    showTip={prefs.startTips}
                    onHideTip={() => settings.set({ startTips: false })}
                    onHelp={(page) => window.open(`${import.meta.env.BASE_URL}help/index.html#${encodeURIComponent(page)}`, '_blank', 'noopener')}
                  />
                )}
                {open?.store.readOnly && <div className="readonly-banner">{readOnlyReason(open, snapshots)}</div>}
                {open && recoveredOnOpen.has(open.file.id) && !recoveredKept.has(open.file.id) && hasUnsavedChanges(open) && (
                  <RecoveredMarkupsBar onKeep={() => { recoveredKept.add(open.file.id); setSavedTick((n) => n + 1); }} onDiscard={() => void discardUnsavedChanges(open)} />
                )}
                {ctl && open && toolsStateA.textSelection && (
                  <TextSelectionBar tools={ctl.tools} length={toolsStateA.textSelection.text.length} readOnly={open.store.readOnly} onCopy={() => copyMarkups('a')} />
                )}
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
                {ctl && open && <SlowDrawingPrompt viewer={ctl.viewer} doc={open.doc} fileId={open.file.id} />}
                {open && <CadReportBar fileId={open.file.id} onConvertAgain={() => setCadAgain(open.file.id)} />}
                {open && suggestion?.fileId === open.file.id && (
                  <div className="slow-drawing standard-suggestion" role="status">
                    <p>
                      {keyed(msgParts('This looks like a {b} set: {round}% of the sheets checked fit that drawing standard.', { b: <b>{suggestion.standard.name}</b>, round: Math.round(suggestion.fit * 100) }))}
                    </p>
                    <div className="slow-drawing-actions">
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          open.store.declineStandard(suggestion.standard.id);
                          setSuggestion(null);
                        }}
                      >
                        {msg('Not this set')}
                      </button>
                      <button
                        type="button"
                        className="btn small primary"
                        onClick={() => {
                          const { standard } = suggestion;
                          setSuggestion(null);
                          void readWithStandard(open, standard).then(() => setNotice(msg('{name} is read with {name2}.', { name: open.file.name, name2: standard.name })));
                        }}
                      >
                        {msg('Use {name}', { name: suggestion.standard.name })}
                      </button>
                    </div>
                  </div>
                )}
              </main>
              {pageNav('a')}
            </div>
            {split && (
              <>
                <div
                  className={splitHorizontal ? 'split-h' : 'split-v'}
                  role="separator"
                  aria-orientation={splitHorizontal ? 'horizontal' : 'vertical'}
                  aria-label={msg('Resize split')}
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
                      if (e.dataTransfer.types.includes(PANEL_DRAG_TYPE)) return;
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
                      const images = openB ? [...e.dataTransfer.files].filter(isImageFile) : [];
                      if (images.length) dropImagesRef.current('b', images, e.clientX, e.clientY);
                      void droppedPdfs(e.dataTransfer).then((files) => {
                        if (files.length) void openNewFile(files, 'b');
                      });
                    }}
                  >
                    <canvas ref={canvasBRef} />
                    {modelB && <ModelStage view={modelB.view} />}
                    {!openB && !modelB && <div className="hint">{msg('Drop a PDF here or File → Open Recent')}</div>}
                    {openB?.store.readOnly && <div className="readonly-banner">{readOnlyReason(openB, snapshots)}</div>}
                    {openB && recoveredOnOpen.has(openB.file.id) && !recoveredKept.has(openB.file.id) && hasUnsavedChanges(openB) && (
                      <RecoveredMarkupsBar onKeep={() => { recoveredKept.add(openB.file.id); setSavedTick((n) => n + 1); }} onDiscard={() => void discardUnsavedChanges(openB)} />
                    )}
                    {openB && <CadReportBar fileId={openB.file.id} onConvertAgain={() => setCadAgain(openB.file.id)} />}
                    {ctlB && openB && toolsStateB.textSelection && (
                      <TextSelectionBar tools={ctlB.tools} length={toolsStateB.textSelection.text.length} readOnly={openB.store.readOnly} onCopy={() => copyMarkups('b')} />
                    )}
                  </main>
                  {pageNav('b')}
                </div>
              </>
            )}
          </div>
          {labelMode?.kind === 'scale' && labelPaneParts?.o && (
            <ScaleRegionsPanel
              key={`${labelPaneParts.o.file.id}:${labelMode.pages?.join(',') ?? ''}`}
              initialPages={labelMode.pages}
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
                  store.setScale([page], withDefaultUnits(scale));
                  done++;
                }
                const missed = scales.length - done;
                setNotice(msg('Set the scale on {done, plural, one {# page} other {# pages}}{value}.', { done, value: missed ? msg('; {missed} had no readable scale in the boxes and were left as they were', { missed }) : '' }));
                setLabelMode(null);
              }}
            />
          )}
          {labelMode?.kind === 'erase' && labelPaneParts?.o && (
            <EraseRegionsPanel
              key={labelPaneParts.o.file.id}
              regions={labelMode.regions}
              drawing={(labelMode.pane === 'b' ? toolsStateB : toolsStateA).tool === 'labelRegion'}
              pageCount={labelPaneParts.o.doc.pages.length}
              currentPage={(labelMode.pane === 'b' ? statsB : stats)?.pageIndex ?? 0}
              texts={labelTexts}
              pageSize={(page) => labelPaneParts.c?.viewer.pageSize(page) ?? null}
              readOnly={labelPaneParts.o.store.readOnly}
              onDraw={() => labelPaneParts.c?.tools.setTool('labelRegion')}
              onChange={(regions) => setLabelMode({ ...labelMode, regions })}
              onClose={() => setLabelMode(null)}
              onApply={(spec) => {
                const o = labelPaneParts.o!;
                setLabelMode(null);
                void runRedact(o, labelMode.pane === 'b', 'erase', spec.areas, undefined, spec).catch((err) => setError(msg('Bulk redact failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
              }}
            />
          )}
          {applyStitch && activeOpen && (
            <ApplyStitchingDialog
              documents={[activeOpen, ...pdfTabs([...tabsA, ...tabsB]).filter((t, i, all) => t.file.id !== activeOpen.file.id && all.findIndex((x) => x.file.id === t.file.id) === i)].map((t) => ({ id: t.file.id, name: t.file.name, pageCount: t.doc.pages.length, readOnly: t.store.readOnly, label: (i: number) => pageLabelFor(t, i), size: (i: number) => t.doc.pages[i]!, stitch: () => t.store.manualStitch() }))}
              onApply={(targetId, pairs, tol, options) => {
                const target = pdfTabs([...tabsA, ...tabsB]).find((t) => t.file.id === targetId) ?? activeOpen;
                return applyStitching(activeOpen, target, pairs, tol, options);
              }}
              onShow={(targetId, page) => {
                setApplyStitch(false);
                const target = pdfTabs([...tabsA, ...tabsB]).find((t) => t.file.id === targetId);
                if (!target || target.file.id !== activeOpen.file.id) return setNotice(msg('Switch to {value} to see its stitched sheets.', { value: target?.file.name ?? msg('that document') }));
                const group = mergeStitch(target.store.stitchGroups(), withViewportRegions(target.store.manualStitch(), target.store.allViewports())).find((g) => g.placements.some((p) => p.pageIndex === page));
                if (group) openStitch(group, page);
                else setNotice(msg('That sheet is not joined to another: check its match lines in the Stitching panel.'));
              }}
              onClose={() => setApplyStitch(false)}
            />
          )}
          {setup &&
            (() => {
              const { o } = paneParts(setup.pane);
              if (!o) return null;
              const pane = setup.pane;
              const sheets = pane === 'b' ? sheetsB : sheetsA;
              const wizard = (
                <StandardsWizard
                  key={`setup:${o.file.id}:${setup.n}`}
                  initialStep={setup.step}
                  fileName={o.file.name}
                  pages={o.doc.pages}
                  texts={setupTexts}
                  sheets={o.doc.pages.map((_, i) => sheets[i])}
                  render={setupRender}
                  standards={ws.drawingStandards}
                  current={o.store.drawingStandard()?.id ?? null}
                  readOnly={o.store.readOnly}
                  readPage={async (i) => {
                    const [words, geometry] = await Promise.all([o.doc.text(i), o.doc.geometry(i)]);
                    return { width: o.doc.pages[i]!.width, height: o.doc.pages[i]!.height, words, segments: inked(geometry.segments, geometry.paper) };
                  }}
                  onSave={(standard) => updateWorkspace((w) => ({ ...w, drawingStandards: [...w.drawingStandards.filter((s) => s.id !== standard.id), standard] }))}
                  onUse={(id, checks) => {
                    const standard = profiles.active().state.drawingStandards.find((s) => s.id === id) ?? null;
                    void readWithStandard(o, standard).then(() => {
                      // The links the person checked in the setup are kept, or turned down, as they said.
                      const known = new Set(o.store.allLinks().map((l) => l.id));
                      for (const [linkId, ok] of checks) if (known.has(linkId)) o.store.setLinkStatus(linkId, ok ? 'accepted' : 'rejected');
                      const read = Object.values(o.store.allSheets()).filter((s) => s.source === 'standard').length;
                      setNotice(standard ? msg('Read {name} with {name2}: {read} of {count} sheet numbers from its title block.', { name: o.file.name, name2: standard.name, read, count: o.doc.pages.length }) : msg('{name} is read from its text again.', { name: o.file.name }));
                    });
                  }}
                  onStitch={() => {
                    void restitch(o).then(() => {
                      const groups = o.store.stitchGroups();
                      setNotice(groups.length ? msg('Stitched {name}: {count, plural, one {# group} other {# groups}} of plans joined along their match lines. Open them from the Stitching panel.', { name: o.file.name, count: groups.length }) : msg('No plans in {name} could be stitched from their match lines.', { name: o.file.name }));
                    });
                  }}
                  onUseNone={() => void readWithStandard(o, null).then(() => setNotice(msg('{name} is read from its text again.', { name: o.file.name })))}
                  onImport={(file) =>
                    void file
                      .text()
                      .then((content) => {
                        const standard = parseStandardFile(content);
                        const known = profiles.active().state.drawingStandards.some((s) => s.id === standard.id);
                        updateWorkspace((w) => ({ ...w, drawingStandards: [...w.drawingStandards.filter((s) => s.id !== standard.id), standard] }));
                        setNotice(msg('{value} the drawing standard "{name}".', { value: known ? msg('Updated') : msg('Added'), name: standard.name }));
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  }
                  onExport={(standard) => download(standardFileName(standard), new Blob([exportStandard(standard)], { type: 'application/json' }))}
                  onDelete={(id) => updateWorkspace((w) => ({ ...w, drawingStandards: w.drawingStandards.filter((s) => s.id !== id) }))}
                  everySetMarks={ws.taughtMarks.length}
                  onMoveMarks={(id) => {
                    updateWorkspace((w) => ({
                      ...w,
                      taughtMarks: [],
                      drawingStandards: w.drawingStandards.map((d) => (d.id === id ? { ...withDefaults(d), marks: [...withDefaults(d).marks, ...w.taughtMarks], updatedAt: Date.now() } : d)),
                    }));
                    void findTaughtMarks(o);
                  }}
                  onForgetMark={(id) => forgetMark(id, o)}
                  project={(() => {
                    const link = linkOf(o.file.id);
                    const project = link ? projectById(link.projectId) : null;
                    if (!project) return null;
                    const { manifest } = project.getSnapshot();
                    return { name: manifest.name, owner: project.level === 'owner', standard: standardOfProject(manifest.standard)?.name ?? null };
                  })()}
                  onProjectStandard={(standard) => {
                    const link = linkOf(o.file.id);
                    const project = link ? projectById(link.projectId) : null;
                    if (!project) return;
                    void project
                      .setStandard(standard ? exportStandard(standard) : null, standard?.name)
                      .then(() => setNotice(standard ? msg('Every file in {name} is now read with {name2}.', { name: project.getSnapshot().manifest.name, name2: standard.name }) : msg('{name} no longer has a drawing standard.', { name: project.getSnapshot().manifest.name })))
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                  }}
                  onClose={() => setSetup(null)}
                />
              );
              if (setup.inline) return wizard;
              return (
                <PopOutWindow
                  name="redcolumn-standards"
                  title={msg('Set up drawing standard')}
                  width={Math.min(1500, Math.round(window.screen.availWidth * 0.9))}
                  height={Math.min(1000, Math.round(window.screen.availHeight * 0.9))}
                  onClose={(reason) => {
                    // Pop-ups blocked: the setup covers the app instead.
                    if (reason === 'blocked') setSetup((cur) => (cur ? { ...cur, inline: true } : cur));
                    else setSetup(null);
                  }}
                >
                  {wizard}
                </PopOutWindow>
              );
            })()}
          {labelMode?.kind === 'label' && labelPaneParts?.o && (
            <LabelRegionsPanel
              key={`${labelPaneParts.o.file.id}:${labelMode.pages?.join(',') ?? ''}:${labelMode.typed ? 't' : ''}:${labelMode.bookmarks ? 'b' : ''}`}
              initialPages={labelMode.pages}
              initialSource={labelMode.typed ? 'typed' : 'regions'}
              initialTarget={labelMode.bookmarks ? 'bookmark' : 'number'}
              labelOf={(page, target) => (target === 'bookmark' ? (flattenBookmarks(labelPaneParts.o?.store.bookmarks() ?? []).find((r) => r.bookmark.pageIndex === page && !r.bookmark.action && !r.bookmark.children.length && !r.bookmark.rect)?.bookmark.title ?? pageLabelFor(labelPaneParts.o, page)) : target === 'number' ? (labelMode.pane === 'b' ? sheetsB : sheetsA)[page]?.number : (labelMode.pane === 'b' ? sheetsB : sheetsA)[page]?.title) ?? ''}
              onSource={(source) => labelPaneParts.c?.tools.setTool(source === 'typed' ? 'select' : 'labelRegion')}
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
                if (target === 'bookmark') {
                  const named = nameBookmarksByPage(
                    store.bookmarks(),
                    labels.map((l) => ({ pageIndex: l.page, title: l.label })),
                    () => crypto.randomUUID(),
                  );
                  const n = named.renamed + named.added;
                  if (n) store.setBookmarks(named.tree);
                  setNotice(msg('Named {n, plural, one {# bookmark} other {# bookmarks}}{value}{value2}.', { n, value: named.added && named.renamed ? ' ' + msg('({added} new)', { added: named.added }) : '', value2: named.skipped.length ? msg('; {count, plural, one {# page} other {# pages}} had no text in the boxes and {value} left as {value2}', { count: named.skipped.length, value: named.skipped.length === 1 ? msg('was') : msg('were'), value2: named.skipped.length === 1 ? msg('it was') : msg('they were') }) : '' }));
                  setLabelMode(null);
                  return;
                }
                let done = 0;
                store.checkpoint();
                for (const { page, label } of labels) {
                  if (!label) continue;
                  store.editSheet(page, target === 'number' ? { number: label } : { title: label });
                  done++;
                }
                const missed = labels.length - done;
                setNotice(msg('Labelled {done, plural, one {# page} other {# pages}}{value}.', { done, value: missed ? msg('; {missed} had no text in the boxes and were left as they were', { missed }) : '' }));
                setLabelMode(null);
              }}
            />
          )}
          {showBottom && !dockFull && bottomDock}
        </div>
        {rightRail.length > 0 && !rightShown && (
          <button type="button" className="panel-edge right" aria-label={msg('Open the right side panel')} title={msg('Open the right side panel')} onClick={() => commandActions.toggleRight()} />
        )}
        {sidePanel('right')}
        {(rightRail.length > 0 || (railDrag && !narrowScreen())) && panelRail('right', rightRail)}
      </div>
      {showBottom && dockFull && bottomDock}
      <StatusBar
        viewer={v ?? null}
        rotation={(paneB ? statsB : stats)?.rotation ?? 0}
        scaleFor={(pageIndex) => activeOpen?.store.scaleFor(pageIndex) ?? null}
        geoRegions={() => activeOpen?.store.allGeoRegions() ?? []}
        snapContent={toolsState.snap}
        onSnapContent={(on) => activeTools?.setSnap(on)}
        tool={toolsState.tool}
        arc={toolsState.arc}
        onSelectTool={() => activeTools?.setTool('select')}
        onOpenSettings={(category, tab) => {
          setPrefsCategory({ category, tab });
          setPrefsOpen(true);
        }}
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
            void runRedact(cur, pane === 'b', 'redact', marks.map((m) => ({ pageIndex: m.pageIndex, rect: boundsOf(m.points) })), options).catch((err) => setError(msg('Redaction failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
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
                const img = p.png ? await pdf.embedPng(p.png) : await pdf.embedJpg(p.jpeg!);
                const w = 612;
                const h = (w * p.height) / p.width;
                pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
              }
              const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
              await openCreated(`Scan ${stamp}.pdf`, (await pdf.save()).slice().buffer);
              setNotice(msg('Created a {count}-page PDF from the camera. Document › OCR makes its text searchable.', { count: pages.length }));
            })().catch((err) => setError(msg('Creating the PDF failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
          }}
        />
      )}
      {publishFor && activeOpen && (
        <PublishDialog mode={publishFor} pageCount={activeOpen.doc.pages.length} currentPage={pageIndex} busy={publishing} onRun={(req) => void runPublish(req)} onClose={() => setPublishFor(null)} />
      )}
      {whatsNewOpen && <WhatsNewDialog onClose={() => setWhatsNewOpen(false)} />}
      <LinkPreviews
        windows={linkPreviews}
        render={renderPreview}
        onChange={(w) => setLinkPreviews((ps) => ps.map((p) => (p.id === w.id ? { ...p, ...w } : p)))}
        onOpen={openPreview}
        onBack={backFromPreview}
        onClose={(id) => setLinkPreviews((ps) => ps.filter((p) => p.id !== id))}
        revision={markups}
      />
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
          kind={soundOpen}
          onCancel={() => setSoundOpen(false)}
          onDone={(file) => {
            const kind = soundOpen;
            setSoundOpen(false);
            void fileToAttachment(file).then((attachment) => {
              activeTools?.setTool('attachment', { attachment, subject: kind === 'video' ? 'Video' : 'Sound', once: true });
              setNotice(msg('Click where the {value} note goes.', { value: kind === 'video' ? msg('video') : msg('sound') }));
            }, (err) => setError(err instanceof Error ? err.message : String(err)));
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
          templates={library.filter((f) => f.template).map((f) => ({ id: f.id, name: f.name }))}
          openDoc={activeOpen && library.some((f) => f.id === activeOpen.file.id) ? { id: activeOpen.file.id, name: activeOpen.file.name, template: !!library.find((f) => f.id === activeOpen.file.id)?.template } : null}
          onTemplate={(req) => {
            setBlankPdf(null);
            void newFromTemplateRequest(req);
          }}
          onKeepOpenDoc={async () => {
            if (!activeOpen) return null;
            await setTemplate(activeOpen.file.id, true);
            await refreshLibrary();
            return activeOpen.file.id;
          }}
          onImport={importTemplate}
          onRemoveTemplate={(id) => void setTemplate(id, false).then(refreshLibrary)}
          onCancel={() => setBlankPdf(null)}
          onApply={(req) => {
            const mode = blankPdf;
            setBlankPdf(null);
            if (mode === 'blank') void applyPageOps([{ type: 'blank', at: req.at, count: req.count, width: req.width, height: req.height }]);
            else if (ctl)
              void ctl.engine
                .createPdf(Array.from({ length: req.count }, () => ({ width: req.width, height: req.height })))
                .then((bytes) => openCreated('Untitled.pdf', bytes))
                .catch((err) => setError(msg('Creating the PDF failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
          }}
        />
      )}
      {cadAgain && cadSession.get(cadAgain) && (
        <CadConvertDialog
          conversion={cadSession.get(cadAgain)!.conversion}
          busy={cadBusy}
          onCancel={() => setCadAgain(null)}
          onConvert={(options, references) => void convertAgain(cadAgain, options, references)}
        />
      )}
      {bulkInsertFiles && (
        <BulkInsertDialog
          initial={bulkInsertFiles}
          currentPage={(v?.currentPageIndex ?? pageIndex) + 1}
          onCancel={() => setBulkInsertFiles(null)}
          onInsert={(files, where) => void bulkInsertDocuments(files, where)}
        />
      )}
      {combineOpen && (
        <CombineDialog
          open={pdfTabs([...tabsA, ...tabsB]).filter((t, i, all) => all.findIndex((x) => x.file.id === t.file.id) === i).map((t) => ({ id: t.file.id, name: t.file.name }))}
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
              .then((bytes) => swapDocument(cur, paneB, bytes, undefined, undefined, msg('Change document properties')))
              .catch((err) => setError(msg('Saving document properties failed: {value}', { value: err instanceof Error ? err.message : String(err) })));
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
      {adjustImageFor &&
        (() => {
          const store = paneParts(adjustImageFor.pane).o?.store;
          const ms = store ? adjustImageFor.ids.map((id) => store.get(id)).filter((m): m is Markup => !!m && !!m.image && !m.locked && store.mayEdit(m)) : [];
          if (!store || !ms.length) return null;
          return (
            <AdjustImageDialog
              source={ms[0]!.image!}
              count={ms.length}
              onCancel={() => setAdjustImageFor(null)}
              onChangeColours={ms.length === 1 ? () => {
                setAdjustImageFor(null);
                setPictureColoursFor({ pane: adjustImageFor.pane, id: ms[0]!.id });
              } : undefined}
              onApply={async (adjust) => {
                // Bake every picture first, so a failure leaves them all as they were; then one undo step.
                const baked: { id: string; from: string; image: string }[] = [];
                // Re-resolved now, not when the dialog opened: a picture may have gone or been locked since.
                const now = adjustImageFor.ids.map((id) => store.get(id)).filter((m): m is Markup => !!m && !!m.image && !m.locked && store.mayEdit(m));
                for (const m of now) baked.push({ id: m.id, from: m.image!, image: await bakePicture(m.image!, (d) => adjustPixels(d, adjust)) });
                // Pictures deleted, locked or given another image under the dialog meanwhile are skipped, so
                // a collaborator's change is not overwritten.
                const live = baked.filter((b) => {
                  const m = store.get(b.id);
                  return !!m?.image && !m.locked && store.mayEdit(m) && m.image === b.from;
                });
                if (live.length) {
                  store.checkpoint();
                  store.batch(() => live.forEach((b) => store.update(b.id, { image: b.image })));
                }
                setAdjustImageFor(null);
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
      {pictureColoursFor &&
        (() => {
          const store = paneParts(pictureColoursFor.pane).o?.store;
          const m = store?.get(pictureColoursFor.id);
          if (!store || !m?.image || m.locked || !store.mayEdit(m)) return null;
          const source = m.image;
          return (
            <PictureColoursDialog
              source={source}
              onCancel={() => setPictureColoursFor(null)}
              onApply={async (mode) => {
                const image = await bakePicture(source, (d) => recolourPixels(d, mode));
                const now = store.get(m.id);
                if (!now?.image || now.locked || !store.mayEdit(now) || now.image !== source) return setPictureColoursFor(null);
                store.checkpoint();
                // New colours are in the picture only, so a vector Snapshot becomes a plain picture.
                store.batch(() => store.update(m.id, { image, vector: undefined }));
                setPictureColoursFor(null);
              }}
            />
          );
        })()}
      {captureView && (
        <div className="modal-backdrop" onMouseDown={() => setCaptureView(null)}>
          <div className="modal capture-view" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setCaptureView(null)}>
            <h3>{msg('Capture')}</h3>
            <img src={captureView} alt={msg('The markup as captured')} />
            <div className="actions">
              <button type="button" className="btn primary" autoFocus onClick={() => setCaptureView(null)}>
                {msg('Close')}
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
          const parent = replyTo.parentId ? m.replies?.find((r) => r.id === replyTo.parentId) : undefined;
          return (
            <CommentDialog
              title={parent ? msg('Reply to {value}', { value: parent.author || msg('reply') }) : msg('Reply to {value}', { value: m.subject || MARKUP_LABELS[m.type] })}
              initial=""
              onClose={() => setReplyTo(null)}
              onSave={(text) => {
                if (text.trim()) store.update(m.id, { replies: [...(m.replies ?? []), { id: crypto.randomUUID(), author: authorRef.current, text: text.trim(), createdAt: Date.now(), ...(replyTo.parentId ? { parentId: replyTo.parentId } : {}) }] });
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
            if (studioDocOf(cur.file.id)) throw new Error(msg('A Live Session document is shared with others, so its pages cannot be changed here.'));
            const { addHeaderFooter } = await import('./documents/headerFooter');
            const date = new Date().toLocaleDateString();
            const bytes = await addHeaderFooter(await readFile(cur.file.hash), pages, spec, (i) => ({ label: cur.store.allSheets()[i]?.number || String(i + 1), file: cur.file.name, date }));
            await swapDocument(cur, paneB, bytes.slice().buffer, undefined, undefined, msg('Add header and footer'));
            setHeaderFooter(null);
          }}
          onRemove={async () => {
            const cur = activeOpen;
            const { removeHeaderFooter } = await import('./documents/headerFooter');
            await swapDocument(cur, paneB, (await removeHeaderFooter(await readFile(cur.file.hash))).slice().buffer, undefined, undefined, msg('Remove header and footer'));
            setHeaderFooter(null);
          }}
        />
      )}
      {compareOpen && (
        <CompareDialog
          mode={compareOpen}
          files={pdfLibrary}
          openIds={[...tabsA, ...tabsB].map((t) => t.file.id)}
          currentId={activeOpen?.file.id ?? null}
          currentPage={pageIndex}
          preview={previewPage}
          openPage={openPickerPage}
          onImportFile={importLibraryFile}
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
            if (!(await rewriteSigned(activeOpen.doc, msg('A protected copy')))) return;
            const { encryptPdf } = await import('./documents/security');
            // With its markups, as a saved copy always has them.
            const bytes = await encryptPdf(await annotatedBytes(activeOpen), settings);
            download(`${activeOpen.file.name.replace(/\.pdf$/i, '')} (protected).pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
            setSecurityOpen(false);
            setNotice(msg('Saved a protected copy of {name}{value}.', { name: activeOpen.file.name, value: settings.openPassword ? msg(': it needs its password to open') : '' }));
          }}
        />
      )}
      {signFor && activeOpen && (
        <SignDialog
          ids={idList}
          pictures={signatures.get()}
          fieldName={signFor.fieldName}
          activeContent={activeContent[activeOpen.file.hash] ?? null}
          alreadySigned={!!(sigChecks[activeOpen.file.hash]?.length || formModels[activeOpen.file.hash]?.fields.some((f) => f.type === 'signature' && f.value))}
          onManageIds={() => setIdsOpen(true)}
          onCancel={() => setSignFor(null)}
          onSign={async (c) => {
            // A .p12 password is checked before anything else happens; a card checks its PIN when it signs.
            const record = digitalIds.list().find((r) => r.id === c.idId);
            if (!record) throw new Error(msg('Choose a Digital ID'));
            (await import('./documents/signers')).signerFor(record, c.password);
            if (!record.token) rememberPassword(record.id, c.password);
            if (!signFor.fieldName && c.where === 'draw') {
              pendingSign.current = c;
              activeTools?.setTool('formField');
              setSignFor(null);
              setNotice(msg('Drag a box on the page where the signature goes.'));
              return;
            }
            await runSign(activeOpen.file.id, c, signFor.fieldName ? { fieldName: signFor.fieldName } : {});
            setSignFor(null);
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
          onAddCard={async (card) => {
            const [{ tokenDigitalId }, { buildChain, certificatesIn, completeChain }] = await Promise.all([import('./documents/digitalIds'), import('./documents/pki')]);
            // The chain as far as the card's own certificates go (often the issuing CAs are on it too),
            // then the rest from the CA's published certificates, so signatures carry the whole chain.
            // Offline, or where the CA publishes none, the card's own certificates are kept as they are.
            let chain = await buildChain(card.certificate, card.others);
            if (!chain.complete) {
              // Known roots (the desktop app's list) end chains whose CA publishes no root address.
              const roots = await desktop()?.pkiRoots?.().catch(() => []) ?? [];
              const anchors = roots.flatMap((pem) => certificatesIn(new TextEncoder().encode(pem)));
              chain = await completeChain(chain, pkiFetch, { pool: card.others, anchors });
            }
            digitalIds.add(await tokenDigitalId({ ref: card.ref, label: card.label, token: card.token, pinPad: card.pinPad, chainDer: chain.certs.map((c) => c.der) }));
            setIdList(digitalIds.list());
            setTrustedCerts(digitalIds.trusted());
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
              link={snap.inviteLink}
              groups={policyOf(snap.meta).groups.map((g) => ({
                name: g.name,
                emails: g.members.filter((m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)),
              }))}
              onCancel={() => setInviteSession(null)}
              onSend={async (emails) => {
                // OneDrive shares the session folder and emails the link.
                await session.invite?.(emails);
                setInviteSession(null);
                setNotice(msg('Shared the session with {emails}.', { emails: emails.join(', ') }));
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
              documents={session.meta.documents.length}
              authors={endFor.authors}
              projects={knownProjects()
                .filter((p) => !p.removed)
                .map((p) => ({ id: p.id, name: projectById(p.id)?.getSnapshot().manifest.name ?? p.name }))}
              oneDriveAvailable={oneDriveSharingEnabled}
              sendBack={session.meta.documents.flatMap((d) => {
                const src = sourceOf(endFor.sessionId, d.id);
                return src ? [{ docId: d.id, name: d.name, target: msg('update {name} in your library', { name: src.name }) }] : [];
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
              <b>{msg('⚠ Markup Alert from {author}', { author: e.author })}</b>
              <span>{e.text}</span>
              {docName && <span className="hint">{msg('{docName}, page {page}', { docName, page: (e.page ?? 0) + 1 })}</span>}
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
                    {msg('Show')}
                  </button>
                )}
                <button className="btn small" onClick={() => setMarkupAlert(null)}>
                  {msg('Dismiss')}
                </button>
              </div>
            </div>
          );
        })()}
      {batchOpen && (
        <BatchDialog
          initial={batchOpen}
          files={pdfLibrary}
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
          files={pdfLibrary.filter((f) => f.id !== activeOpen.file.id)}
          closed={(() => {
            const template = closeOutTemplateOf(activeOpen.store);
            const ids = closedStatuses(template);
            const names = columnSet.statuses.filter((s) => ids.has(s.id)).map((s) => s.name);
            return { count: markups.filter((m) => isComment(m) && ids.has(m.status || 'none')).length, means: names.length ? names.join(', ').replace(/, ([^,]*)$/, ' or $1') : 'closed' };
          })()}
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
                  if (same.id === f.id) setNotice(msg('That revision is the same as the current version.'));
                  void openFromLibrary(same);
                  return;
                }
                void readFile(r.hash)
                  .then((bytes) => openCreated(`${f.name.replace(/\.pdf$/i, '')} (${revisionStamp(r.savedAt)}).pdf`, bytes))
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
              onRestore={(r) => {
                if (!confirm(msg('Go back to the version of {date}? Markups stay on their page numbers; the current version is kept as a revision.', { date: new Date(r.savedAt).toLocaleString() }))) return;
                setRevisionsOf(null);
                void restoreRevision(f.id, r);
              }}
              onDelete={(r) => {
                if (confirm(msg('Delete this revision from the device?'))) void removeRevision(f.id, r.hash).then(refreshLibrary);
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
      <ToolPreviewCard />
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
            const note = await runProcess(activeOpen, spec, `Before ${PROCESS_ENGLISH[spec.kind]}`);
            const changed = (await listFiles()).find((f) => f.id === activeOpen.file.id)?.hash !== activeOpen.file.hash;
            if (note) setNotice(changed ? msg('{note} Document › Revisions brings back the version before.', { note }) : note);
            setProcessKind(null);
          }}
        />
      )}
      {pageTool && activeOpen && (
        <PageToolsDialog
          kind={pageTool.kind}
          pageCount={activeOpen.doc.pages.length}
          currentPage={pageIndex}
          fileName={activeOpen.file.name.replace(/\.pdf$/i, '')}
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
                  made.push(...countsFromHits(hits.map((h) => ({ pageIndex: h.pageIndex, point: h.match.center })), { base, style: styles.count, subject: 'Symbol Search' }));
                } else {
                  for (const h of hits) {
                    const r = h.match.rect;
                    const pad = Math.max(r.w, r.h) * 0.2;
                    made.push({ ...base, id: crypto.randomUUID(), type: action, pageIndex: h.pageIndex, points: [[r.x - pad, r.y - pad], [r.x + r.w + pad, r.y + r.h + pad]], style: { ...styles[action] } });
                  }
                }
                o.store.checkpoint();
                o.store.batch(() => made.forEach((m) => o.store.add(m)));
                setNotice(msg('Added {count, plural, one {# markup} other {# markups}} from Symbol Search.', { count: made.length }));
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
                setNotice(msg('Added {count, plural, one {# hyperlink} other {# hyperlinks}} from Symbol Search.', { count: vsLinks.hits.length }));
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
      {tableDraft && (
        <TableDialog
          onCancel={() => setTableDraft(null)}
          onApply={(rows, columns) => {
            paneParts(tableDraft.pane).c?.tools.addTable(tableDraft.draft, rows, columns);
            setTableDraft(null);
          }}
        />
      )}
      {stampToFill && (
        <FillStampDialog
          stamp={stampToFill}
          author={author}
          title={stampToFill.name}
          applyLabel={msg('Place')}
          onCancel={() => setStampToFill(null)}
          onApply={(values) => {
            setStampToFill(null);
            placeStamp(withFieldValues(stampToFill, values), true);
          }}
        />
      )}
      {stampEdit &&
        (() => {
          const { o } = paneParts(stampEdit.pane);
          const m = o?.store.get(stampEdit.id);
          const form = m?.stamp?.form;
          if (!o || !m?.stamp || !form) return null;
          return (
            <FillStampDialog
              stamp={{ name: m.subject ?? 'Stamp', ...formStamp(m.stamp)! }}
              author={form.placed.user}
              initial={form.values}
              title={m.subject ?? msg('Stamp')}
              applyLabel={msg('Update')}
              onCancel={() => setStampEdit(null)}
              onApply={(values) => {
                setStampEdit(null);
                const next = refillStamp(m.stamp!, values);
                if (!next) return;
                o.store.checkpoint();
                o.store.update(m.id, { stamp: next.stamp, style: { ...m.style, stroke: next.color } });
              }}
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
              title={msg('{mARKUP_LABELS} comment', { mARKUP_LABELS: MARKUP_LABELS[m.type] })}
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
      {lineStylesOpen && <LineStylesDialog onClose={() => setLineStylesOpen(false)} />}
      {countSymbolsOpen && (
        <CountSymbolsDialog
          author={author}
          selectedMarkups={activeOpen ? activeOpen.store.all().filter((m) => (activeTools?.getState().selected ?? new Set()).has(m.id)) : []}
          onUse={(sym) => {
            if (!activeTools) return;
            const st = activeTools.getState();
            const chosen = activeOpen ? activeOpen.store.all().filter((m) => st.selected.has(m.id)) : [];
            if (chosen.length && chosen.every((m) => m.type === 'count')) {
              activeTools.applyStyle(chosen.map((m) => m.id), { countShape: undefined, countSymbol: structuredClone(sym) });
            } else {
              activeTools.setDefaultStyle('count', { countShape: undefined, countSymbol: structuredClone(sym) });
              if (st.tool !== 'count') activeTools.setTool('count');
            }
          }}
          onClose={() => setCountSymbolsOpen(false)}
        />
      )}
      {revuMigrationOpen && (
        <RevuMigrationDialog
          onClose={() => setRevuMigrationOpen(false)}
          onHelp={() => window.open(`${import.meta.env.BASE_URL}help/index.html#revu-migration`, '_blank', 'noopener')}
        />
      )}
      {stampsOpen && (
        <StampsDialog
          key={stampsCreating ? 'new' : 'library'}
          creating={stampsCreating}
          author={author}
          onClose={() => {
            setStampsOpen(false);
            setStampsCreating(false);
          }}
          onPlace={(s) => {
            setStampsOpen(false);
            setStampsCreating(false);
            placeStamp(s);
          }}
        />
      )}
      {scaleAsk && activeOpen && (
        <ScaleToLengthDialog
          points={scaleAsk.points}
          scale={activeOpen.store.scaleAt(scaleAsk.pageIndex, scaleAsk.points[0])}
          onCancel={() => {
            setScaleAsk(null);
            (scaleAsk.pane === 'b' ? ctlB : ctl)?.tools.cancel();
          }}
          onPick={() => {
            setScaleAsk(null);
            (scaleAsk.pane === 'b' ? ctlB : ctl)?.tools.pickScaleTarget();
          }}
          onScale={(factor) => {
            setScaleAsk(null);
            (scaleAsk.pane === 'b' ? ctlB : ctl)?.tools.scaleSelectionBy(factor);
          }}
        />
      )}
      {scaleNeeded && (scaleNeeded.pane === 'b' ? openB : open) && (
        <ScaleRequiredDialog
          scaleToLength={scaleNeeded.tool === 'scaleLength'}
          page={pageLabelFor(scaleNeeded.pane === 'b' ? openB : open, scaleNeeded.pageIndex)}
          notToScale={isNotToScale((scaleNeeded.pane === 'b' ? openB : open)?.store.allSheets()[scaleNeeded.pageIndex]?.scaleText)}
          onCancel={() => setScaleNeeded(null)}
          onSetScale={() => {
            setCustomScalePage(scaleNeeded.pageIndex);
            setCustomScalePane(scaleNeeded.pane);
            setScaleNeeded(null);
          }}
          onCalibrate={
            activeReadOnly
              ? null
              : () => {
                  (scaleNeeded.pane === 'b' ? ctlB : ctl)?.tools.setTool('calibrate');
                  setScaleNeeded(null);
                }
          }
        />
      )}
      {customScalePane && (customScalePane === 'b' ? openB : open) && (
        <SetScaleDialog
          scale={(customScalePane === 'b' ? scalesB : scalesA)[customScalePage ?? (customScalePane === 'b' ? statsB : stats)?.pageIndex ?? 0] ?? null}
          pageCount={(customScalePane === 'b' ? statsB : stats)?.pageCount ?? 0}
          currentPage={customScalePage ?? (customScalePane === 'b' ? statsB : stats)?.pageIndex ?? 0}
          selected={[]}
          onCalibrate={
            activeOpen && !activeReadOnly
              ? () => {
                  setCustomScalePane(null);
                  setCustomScalePage(null);
                  activeTools?.setTool('calibrate');
                }
              : null
          }
          onApply={(pages, scale) => {
            (customScalePane === 'b' ? openB : open)?.store.setScale(pages, withDefaultUnits(scale));
            setCustomScalePane(null);
            setCustomScalePage(null);
          }}
          onCancel={() => {
            setCustomScalePane(null);
            setCustomScalePage(null);
          }}
        />
      )}
      {calibration && activeOpen && (
        <CalibrateDialog
          delta={calibration.delta}
          current={calibrationViewport?.scale ?? scales[calibration.pageIndex] ?? null}
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
      {assembliesOpen && activeOpen && (
        <AssembliesDialog
          initial={assemblies}
          readOnly={activeReadOnly}
          columns={columnSet.columns}
          usage={Object.fromEntries(Object.entries(Object.groupBy(markups.filter((m) => m.assemblyId), (m) => m.assemblyId!)).map(([id, list]) => [id, list?.length ?? 0]))}
          // Examples in the units this page measures in, else the preferred ones.
          unitSystem={scales[pageIndex] ? systemOf(scales[pageIndex]!.unit) : prefs.unitSystem}
          preview={takeoffSample ? (a) => itemQuantities(takeoffSample, resolveAssemblies([a], estimating.items, estimating.productLists)[0]!, cellsFor(takeoffSample, cellContext), columnSet.columns) : null}
          estimating={estimating}
          onImportEstimating={(incoming) => activeOpen.store.setEstimating(mergeEstimating(activeOpen.store.estimating(), incoming))}
          previewLabel={takeoffSample ? `${takeoffSample.subject || MARKUP_LABELS[takeoffSample.type]} on page ${takeoffSample.pageIndex + 1}` : ''}
          onSave={(list) => {
            activeOpen.store.setAssemblies(list);
            setAssembliesOpen(false);
          }}
          onExportJson={(json) => download(`${activeOpen.file.name.replace(/\.pdf$/i, '')} estimating.json`, new Blob([json], { type: 'application/json' }))}
          onHelp={(page) => window.open(`${import.meta.env.BASE_URL}help/index.html#${encodeURIComponent(page)}`, '_blank', 'noopener')}
          onClose={() => setAssembliesOpen(false)}
        />
      )}
      {scriptsOpen && activeOpen && (
        <ScriptsDialog
          markups={activeOpen.store.all()}
          ctx={{ statuses: activeOpen.store.columnSet().statuses, columns: activeOpen.store.columnSet().columns, pageLabel: (p) => activeOpen.store.allSheets()[p]?.number || String(p + 1), mayEdit: (m) => activeOpen.store.mayEdit(m) }}
          readOnly={activeReadOnly}
          onApply={(changes) => {
            const store = activeOpen.store;
            // One undo step for the whole script.
            store.checkpoint();
            store.batch(() => changes.forEach((c) => store.update(c.id, c.patch)));
            setNotice(msg('Script applied: {count, plural, one {# markup} other {# markups}} changed. Undo takes it back.', { count: changes.length }));
          }}
          onClose={() => setScriptsOpen(false)}
        />
      )}
      {scaleReviewOpen && activeOpen && (
        <SheetScaleReview
          key={activeOpen.file.id}
          rows={scaleRows}
          reading={!scaleReadings?.done}
          pageLabel={(i) => pageLabelFor(activeOpen, i)}
          currentPage={pageIndex}
          readOnly={activeOpen.store.readOnly}
          onShow={(page, views) => {
            v?.goToPage(page);
            activeTools?.setRegions(views.map((view) => view.rect));
          }}
          onApply={(list) => {
            const store = activeOpen.store;
            const viewports = list.flatMap(({ page, views }) => views.map((view) => ({ id: crypto.randomUUID(), pageIndex: page, name: view.name, rect: view.rect, scale: withDefaultUnits(view.scale) })));
            const scaled = list.filter((p) => p.scale);
            // One undo step for the page scales and viewports together.
            store.checkpoint();
            store.batch(() => {
              store.setScales(scaled.map(({ page, scale }) => [page, withDefaultUnits(scale!)] as const));
              for (const vp of viewports) store.setViewport(vp);
            });
            activeTools?.setRegions([]);
            const parts = [scaled.length ? msg('set the scale on {count, plural, one {# page} other {# pages}}', { count: scaled.length }) : '', viewports.length ? `added ${viewports.length} viewport${viewports.length === 1 ? '' : 's'}` : ''].filter(Boolean);
            setNotice(msg('From the title blocks: {parts}. Undo takes it back.', { parts: parts.join(' and ') }));
          }}
          onClose={() => {
            activeTools?.setRegions([]);
            setScaleReviewOpen(false);
          }}
        />
      )}
      {takeoffReviewOpen && activeOpen && (
        <TakeoffReview
          store={activeOpen.store}
          me={author}
          ctx={cellContext}
          pageLabel={(i) => pageLabelFor(activeOpen, i)}
          onShow={(m) => selectFromList(m)}
          onShowRect={(pageIndex, r) => {
            const viewer = activePaneRef.current === 'b' && ctlB ? ctlB.viewer : ctl?.viewer;
            if (!viewer) return;
            viewer.goToPage(pageIndex);
            // A small symbol shows with its surroundings; a large source (a legend, a schedule) with a margin.
            const pad = Math.max(24, Math.min(Math.max(r.w, r.h) * 3, 200));
            viewer.zoomToRect({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }, 1, pageIndex);
          }}
          onShowPage={(pageIndex) => (activePaneRef.current === 'b' && ctlB ? ctlB.viewer : ctl?.viewer)?.goToPage(pageIndex)}
          documentName={activeOpen.file.name}
          onMessage={setNotice}
          onClose={() => setTakeoffReviewOpen(false)}
        />
      )}
      {quantitiesOpen && activeOpen && (
        <QuantitiesDialog
          markups={markups}
          assemblies={takeoffAssemblies}
          ctx={cellContext}
          pageLabel={(i) => pageLabelFor(activeOpen, i)}
          onManage={() => {
            setQuantitiesOpen(false);
            setAssembliesOpen(true);
          }}
          // Byte-order mark so Excel reads the CSV as UTF-8.
          onExportCsv={(csv, by) => download(`${activeOpen.file.name.replace(/\.pdf$/i, '')} quantities by ${by}.csv`, new Blob(['﻿' + csv], { type: 'text/csv' }))}
          onClose={() => setQuantitiesOpen(false)}
        />
      )}
      {itemsOpen && activeOpen && (
        <ItemsDialog
          initial={estimating.items}
          productLists={estimating.productLists}
          readOnly={activeReadOnly}
          usage={Object.fromEntries(Object.entries(Object.groupBy(assemblies.flatMap((a) => a.items.flatMap((i) => (i.itemId ? [i.itemId] : []))), (id) => id)).map(([id, l]) => [id, l?.length ?? 0]))}
          onSave={(items, lists) => {
            activeOpen.store.setEstimating({ items, ...(lists.length ? { productLists: [...estimating.productLists, ...lists] } : {}) });
            setItemsOpen(false);
          }}
          onManageLists={() => {
            setItemsOpen(false);
            setProductListsOpen(true);
          }}
          onClose={() => setItemsOpen(false)}
        />
      )}
      {productListsOpen && activeOpen && (
        <ProductListsDialog
          initial={estimating.productLists}
          readOnly={activeReadOnly}
          usage={Object.fromEntries(Object.entries(Object.groupBy(estimating.items.flatMap((i) => (i.listRef ? [i.listRef.listId] : [])), (id) => id)).map(([id, l]) => [id, l?.length ?? 0]))}
          onSave={(productLists) => {
            activeOpen.store.setEstimating({ productLists });
            setProductListsOpen(false);
          }}
          onClose={() => setProductListsOpen(false)}
        />
      )}
      {templatesOpen && activeOpen && (
        <TemplatesDialog
          initial={estimating.templates}
          assemblies={assemblies}
          readOnly={activeReadOnly}
          onSave={(templates) => {
            activeOpen.store.setEstimating({ templates });
            setTemplatesOpen(false);
          }}
          onUse={(t) => {
            setTemplatesOpen(false);
            armTemplate(t);
          }}
          onImport={async (f) => {
            const file = estimatingFromJson(await f.text());
            const store = activeOpen.store;
            store.checkpoint();
            store.batch(() => {
              if (file.assemblies.length) store.setAssemblies(mergeAssemblies(store.assemblies(), file.assemblies));
              store.setEstimating(mergeEstimating(store.estimating(), file));
            });
            return msg('Imported {count, plural, one {# template} other {# templates}}, {count2, plural, one {# assembly} other {# assemblies}}, {count3, plural, one {# item} other {# items}} and {count4} product {count5, plural, one {list} other {lists}} from {name}.', { count: file.templates.length, count2: file.assemblies.length, count3: file.items.length, count4: file.productLists.length, count5: file.productLists.length, name: f.name });
          }}
          onExport={() => {
            const doc = documentFile(activeOpen.store);
            const used = referencedRecords(doc, estimating.templates.flatMap((t) => (t.assemblyId ? [t.assemblyId] : [])));
            download(`${activeOpen.file.name.replace(/\.pdf$/i, '')} takeoff templates.json`, new Blob([estimatingToJson({ ...used, templates: estimating.templates })], { type: 'application/json' }));
          }}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
      {commentsTable && !commentsTable.hidden && (
        <CommentsTableDialog
          title={commentsTable.title}
          rows={commentsTable.rows}
          progress={commentsTable.progress}
          failed={commentsTable.failed}
          onOpen={commentsTable.open}
          onRefresh={commentsTable.rows ? commentsTable.refresh : undefined}
          onExportCsv={(csv) => download(`${commentsTable.title} comments.csv`, new Blob(['﻿' + csv], { type: 'text/csv' }))}
          onClose={() => setCommentsTable(null)}
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
      {summaryOpen && (
        <MarkupSummaryDialog
          docName={activeOpen?.file.name ?? 'Markup summary'}
          activeFile={activeOpen ? { id: activeOpen.file.id, name: activeOpen.file.name, pageCount: activeOpen.doc.pages.length } : null}
          currentPage={pageIndex + 1}
          markups={activeOpen ? markups : []}
          ctx={cellContext}
          customColumns={activeOpen ? columnSet.columns : []}
          openFiles={pdfTabs([...tabsA, ...tabsB]).map((t) => ({ id: t.file.id, name: t.file.name, pageCount: t.doc.pages.length }))}
          library={library.map((f) => ({ id: f.id, name: f.name }))}
          busy={exportBusy}
          initialFilters={prefs.excludeFilteredOnExport ? listFilters : {}}
          initialSort={listSort}
          onExport={(req) => void runExport(req)}
          onDownload={download}
          onClose={() => setSummaryOpen(false)}
        />
      )}
      {manualOpen && activeOpen && (
        <ManualQuantityDialog
          scale={activeOpen.store.scaleFor(pageIndex)}
          assemblies={assemblies}
          onCancel={() => setManualOpen(false)}
          onOk={(request) => {
            setManualOpen(false);
            manualPendingRef.current = request;
            activeTools?.setTool('manual');
          }}
        />
      )}
      {importExcel && importPlan && activeOpen && (
        <ImportExcelDialog
          fileName={importExcel.fileName}
          result={importPlan}
          rowLabel={(key) => {
            const m = activeOpen.store.get(key);
            return { itemNo: m?.seq ? String(m.seq) : '', sheet: m ? sheets[m.pageIndex]?.number || `Page ${m.pageIndex + 1}` : '' };
          }}
          blocked={(change) => {
            const m = activeOpen.store.get(change.rowKey);
            return !!m && !activeOpen.store.mayEdit(m) && !isOpenChange(change);
          }}
          replyAuthor={importExcel.book.lastModifiedBy ?? ''}
          aliases={importExcel.aliases}
          onAlias={(column, value, option) =>
            setImportExcel((cur) => {
              if (!cur) return cur;
              const forColumn = { ...cur.aliases[column] };
              if (option) forColumn[value.toLowerCase()] = option;
              else delete forColumn[value.toLowerCase()];
              return { ...cur, aliases: { ...cur.aliases, [column]: forColumn } };
            })
          }
          onApply={(changes, replyAuthor) => {
            const store = activeOpen.store;
            // A register words its statuses the client's way.
            const record = importPlan.register;
            const patches = patchesFor(changes, (id) => store.get(id), { statuses: columnSet.statuses, columns: columnSet.columns, replyAuthor, now: Date.now(), newId: () => crypto.randomUUID(), ...(record ? { statusId: wording(record, columnSet.statuses).statusId } : {}) });
            // Words mapped to a status in this import are remembered in the register's template, so they are not asked again.
            const mapped = Object.entries(importExcel.aliases.status ?? {});
            const template = record ? registerTemplates.find((t) => t.id === record.templateId) : undefined;
            if (template && mapped.length) {
              saveRegisterTemplate({
                ...template,
                statuses: template.statuses.map((s) => {
                  const more = mapped.filter(([typed, word]) => word === s.word && !s.also.some((a) => a.toLowerCase() === typed)).map(([typed]) => typed);
                  return more.length ? { ...s, also: [...s.also, ...more] } : s;
                }),
                updatedAt: Date.now(),
              });
            }
            // One undo step for the whole import.
            store.checkpoint();
            store.batch(() => {
              for (const [id, patch] of patches) store.update(id, patch);
            });
            store.checkpoint();
            setNotice(msg('Imported {fileName}: {count, plural, one {# change} other {# changes}} to {size, plural, one {# markup} other {# markups}}. Undo takes them back in one step.', { fileName: importExcel.fileName, count: changes.length, size: patches.size }));
            setImportExcel(null);
          }}
          onClose={() => setImportExcel(null)}
        />
      )}
      {closeOutOpen && activeOpen && (
        <CloseOutDialog
          docName={activeOpen.file.name}
          sheets={closeOut(markups, sheets, closedStatuses(closeOutTemplateOf(activeOpen.store)), columnSet.statuses)}
          templates={registerTemplates.map((t) => ({ id: t.id, name: t.name }))}
          templateId={closeOutTemplateOf(activeOpen.store)?.id ?? ''}
          onTemplate={setCloseOutTemplate}
          onOpen={(id, pageIndex) => {
            setCloseOutOpen(false);
            navigate(pageIndex, null);
            (paneB ? ctlB : ctl)?.tools.select([id]);
          }}
          onExportCsv={(csv) => download(`${activeOpen.file.name.replace(/\.pdf$/i, '')} close-out.csv`, new Blob(['\uFEFF' + csv], { type: 'text/csv' }))}
          onClose={() => setCloseOutOpen(false)}
        />
      )}
      {registerOpen && activeOpen && (
        <ExportRegisterDialog
          docName={activeOpen.file.name}
          templates={registerTemplates}
          initialId={templateFor(registerTemplates, activeOpen.store.drawingStandard()?.id)?.id}
          values={{ document: activeOpen.file.name.replace(/\.pdf$/i, ''), exportDate: new Date().toLocaleDateString('en-CA'), reviewer: author }}
          counts={{ comments: registerMarkups('comments').length, all: registerMarkups('all').length }}
          canFill={!!localExcel()?.fill}
          onExport={exportRegister}
          onTemplates={(id) => setRegisterTemplatesOpen({ id })}
          onClose={() => setRegisterOpen(false)}
        />
      )}
      {registerTemplatesOpen && (
        <RegisterTemplatesDialog
          templates={registerTemplates}
          initialId={registerTemplatesOpen.id}
          standards={ws.drawingStandards.map((s) => ({ id: s.id, name: s.name }))}
          listColumns={listColumns(columnSet.columns).map((c) => ({ key: c.key, label: c.label }))}
          statuses={columnSet.statuses}
          onNew={() => starterTemplate(crypto.randomUUID(), columnSet.statuses, Date.now())}
          onSave={saveRegisterTemplate}
          onDelete={(id) => updateWorkspace((w) => ({ ...w, registerTemplates: (w.registerTemplates ?? []).filter((t) => t.id !== id) }))}
          onImportFile={async () => {
            const file = await pickFile('.rcregister,application/json');
            if (!file) return null;
            try {
              // A shared template gets an id of its own here: it never replaces one of this person's.
              return { ...parseTemplateFile(await file.text()), id: crypto.randomUUID() };
            } catch (err) {
              setError(err instanceof Error ? err.message : msg('{name} could not be read.', { name: file.name }));
              return null;
            }
          }}
          onExportFile={(t) => download(templateFileName(t), new Blob([exportTemplate(t)], { type: 'application/json' }))}
          onPickClientFile={
            localExcel()?.pickSource
              ? async (draft) => {
                  try {
                    const picked = await localExcel()!.pickSource!();
                    if (!picked) return null;
                    return { id: picked.id, name: picked.name, problems: checkClientFile(await readWorkbook(picked.bytes), draft).problems };
                  } catch (err) {
                    setError(err instanceof Error ? err.message : msg('That file could not be read.'));
                    return null;
                  }
                }
              : undefined
          }
          onClose={() => setRegisterTemplatesOpen(null)}
        />
      )}
      {portalDialog && (portalDialog.pane === 'b' ? openB : open) && (
        <PortalDialogHost
          state={portalDialog}
          store={(portalDialog.pane === 'b' ? openB : open)!.store}
          pageCount={(portalDialog.pane === 'b' ? openB : open)!.doc.pages.length}
          pageLabel={(i) => (portalDialog.pane === 'b' ? sheetsB : sheetsA)[i]?.number || `Page ${i + 1}`}
          onClose={() => setPortalDialog(null)}
          onNotice={setNotice}
        />
      )}
      {syncOpen && activeOpen && syncTable && (
        <SheetSyncDialog
          docName={activeOpen.file.name}
          link={sheetSync.link}
          status={sheetSync.status}
          rowCount={syncKeyed ? syncKeyed.rows.length : Math.max(0, syncTable.length - 1)}
          twoWay={sheetSync.twoWay}
          canTwoWay={!!localExcel()?.read}
          issues={sheetSync.issues.map((i) => ({ ...i, itemNo: String(activeOpen.store.get(i.rowKey)?.seq ?? '') }))}
          onResolve={sheetSync.resolve}
          onUseListColumns={() => sheetSync.setColumns(visibleListColumns.map((c) => c.key))}
          localExcelAvailable={!!localExcel()}
          inDesktopApp={!!desktop()}
          onConnectLocal={(title, quantities) => void (async () => sheetSync.connectLocal(title, syncTable, quantities ? [await quantitiesSheet()] : [], quantities, localExcel()?.read ? visibleListColumns.map((c) => c.key) : undefined))()}
          onSetQuantities={sheetSync.setQuantities}
          onOpenLocal={() => sheetSync.link && void localExcel()?.open(sheetSync.link.id).catch((err: unknown) => setNotice(err instanceof Error ? err.message : msg('Could not open the workbook.')))}
          onShowLocal={() => sheetSync.link && void localExcel()?.show(sheetSync.link.id).catch(() => undefined)}
          onSyncNow={() => void sheetSync.syncNow()}
          onStop={sheetSync.disconnect}
          onClose={() => setSyncOpen(false)}
        />
      )}
      {reportsOpen && activeOpen && (
        <ReportsDialog counts={reportCounts} pageLabel={activeOpen.store.allSheets()[pageIndex]?.number || `Page ${pageIndex + 1}`} busy={reportsBusy} error={reportsError} onExport={(req) => void runReports(req)} onClose={() => setReportsOpen(false)} />
      )}
      {installOpen && <InstallDialog onClose={() => setInstallOpen(false)} />}
      {libraryOpen && (
        <LibraryDialog
          onInstall={(pack, source) => {
            const { counts, saved } = installPack(pack, source);
            const added = describeCounts(counts);
            if (!saved) setError(msg('Added {name}, but this browser would not keep all of it (a private window, or storage is full).', { name: pack.name }));
            return added;
          }}
          onHelp={() => window.open(`${import.meta.env.BASE_URL}help/index.html#community-library`, '_blank', 'noopener')}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {prefsOpen && <PreferencesDialog author={author} onAuthor={persistAuthor} onRestart={restartApp} initialCategory={prefsCategory?.category} initialTab={prefsCategory?.tab} initialQuery={prefsCategory?.query} onClose={() => setPrefsOpen(false)} />}
      {profilesOpen && (
        <ProfilesDialog
          documentColumns={activeOpen ? columnSet : null}
          canApplyToDocument={!!activeOpen && !activeReadOnly}
          onApplyToDocument={(set: ColumnSet) => activeOpen?.store.setColumnSet(structuredClone(set))}
          onDownload={(name, text) => download(name, new Blob([text], { type: 'application/json' }))}
          onClose={() => setProfilesOpen(false)}
        />
      )}
      {ctxMenu && !ctxInPopOut && <ContextMenu menu={ctxMenu} onClose={closeCtxMenu} />}
      {markupsPopped && (
        <PopOutWindow
          name="redcolumn-markups"
          title={msg('Markups')}
          onClose={(reason) => {
            setMarkupsPopped(false);
            if (reason === 'blocked') setNotice(msg('The browser blocked the new window. Allow pop-ups for this site and try again.'));
          }}
        >
          <div className="app popout" onContextMenuCapture={() => setCtxInPopOut(true)}>
            <div className="bottom-dock popout-dock">
              <div className="tabs">
                <div className="dock-tablist" role="tablist">
                  <button role="tab" aria-selected="true" className="active">
                    {msg('Markups')}
                  </button>
                </div>
                <button type="button" className="drawer-popout" title={msg('Put the list back in the app')} aria-label={msg('Put the Markups list back in the app')} onClick={() => setMarkupsPopped(false)}>
                  ⇲
                </button>
              </div>
              <div className="dock-body">{markupList}</div>
            </div>
            {ctxMenu && ctxInPopOut && <ContextMenu menu={ctxMenu} onClose={closeCtxMenu} />}
          </div>
        </PopOutWindow>
      )}
      <AskTextHost />
      <AssistantConfirmDialog />
      <UnsavedChangesDialog />
      <StepUpHost />
      <FirstUseHost />
      {editing && activeOpen && v && activeTools && (
        <TextEditor key={editing.id} markup={editing} store={activeOpen.store} viewer={v} onDone={() => setEditingText(null)} />
      )}
      {editingCell && activeOpen && v && (() => {
        const table = activeOpen.store.get(editingCell.id);
        if (table?.type !== 'table') return null;
        return (
          <TableCellEditor
            key={`${table.id}:${editingCell.row}:${editingCell.col}`}
            markup={table}
            row={editingCell.row}
            col={editingCell.col}
            typed={editingCell.text}
            store={activeOpen.store}
            viewer={v}
            onDone={(to) => {
              // The cell being left, or the one moved on to, stays the selected one.
              activeTools?.selectTableCell(table.id, to ?? editingCell);
              setEditingCell(to ? { id: table.id, ...to } : null);
            }}
          />
        );
      })()}
    </div>
  );
}

const RAIL = lazy((): { id: LeftTab; title: string; icon: ReactNode; experimental?: boolean; needsModel?: boolean }[] => [
  {
    id: 'model3d',
    title: msg('3D Model'),
    experimental: true,
    needsModel: true,
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" d="M2.5 4.5 8 1.8l5.5 2.7v7L8 14.2l-5.5-2.7zM2.5 4.5 8 7.2l5.5-2.7M8 7.2v7" />
      </svg>
    ),
  },
  {
    id: 'model3dProps',
    title: msg('3D Properties'),
    experimental: true,
    needsModel: true,
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M2 2.5h12v11H2zM2 6h12M2 9.5h12M6.5 2.5v11" />
      </svg>
    ),
  },
  {
    id: 'markups',
    title: msg('Markups'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M2 3.5h12M2 8h12M2 12.5h12" />
      </svg>
    ),
  },
  {
    id: 'files',
    title: msg('File Access'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M3 2h6l2 2v10H3V2zm6 0v2h2" />
      </svg>
    ),
  },
  {
    id: 'pages',
    title: msg('Thumbnails'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 2h5v6H2V2zm7 0h5v6H9V2zM2 9h5v5H2V9zm7 0h5v5H9V9z" />
      </svg>
    ),
  },
  {
    id: 'bookmarks',
    title: msg('Bookmarks'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M4 2h8v12l-4-2-4 2V2z" />
      </svg>
    ),
  },
  {
    id: 'toolchest',
    title: msg('Tool Library'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 6h12v8H2V6zm3-3h6l1 3H4l1-3z" />
      </svg>
    ),
  },
  {
    id: 'properties',
    title: msg('Properties'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M3 3h10v2H3V3zm0 4h10v2H3V7zm0 4h7v2H3v-2z" />
      </svg>
    ),
  },
  {
    id: 'layers',
    title: msg('Layers'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M8 2l7 4-7 4-7-4 7-4zm0 9 7-4v2l-7 4-7-4V7l7 4z" />
      </svg>
    ),
  },
  {
    id: 'measurements',
    title: msg('Measurements'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 7h12v2H2V7zm0-4h2v10H2V3zm10 0h2v10h-2V3z" />
      </svg>
    ),
  },
  {
    id: 'signatures',
    title: msg('Signatures'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M2 12c2-4 4-6 6-6s2 3 4 3 2-2 2-2v5H2v0z" />
      </svg>
    ),
  },
  {
    id: 'spaces',
    title: msg('Spaces'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M2 2h12v12H2zM2 8h6V2M8 8v6" />
      </svg>
    ),
  },
  {
    id: 'stitching',
    title: msg('Stitching'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M1.5 3.5h6v9h-6zM8.5 3.5h6v9h-6z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.5 1.5" d="M8 1.5v13" />
      </svg>
    ),
  },
  {
    id: 'ai',
    title: msg('Compare'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" d="M1.5 2.5h4.5v11H1.5zM10 2.5h4.5v11H10z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M8 4.5v2M7 5.5h2M8 9.5v2M7 10.5h2" />
      </svg>
    ),
  },
  {
    id: 'geospatial',
    title: msg('Geospatial'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path fill="none" stroke="currentColor" strokeWidth="1.1" d="M1.8 8h12.4M8 1.8c-2.2 2.4-2.2 10 0 12.4M8 1.8c2.2 2.4 2.2 10 0 12.4" />
      </svg>
    ),
  },
  {
    id: 'flags',
    title: msg('Flags'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M3 2h1v12H3V2zm2 0h8l-2 3 2 3H5V2z" />
      </svg>
    ),
  },
  {
    id: 'search',
    title: msg('Search'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M7 2a5 5 0 0 1 3.9 8.1l2.5 2.5-1.4 1.4-2.5-2.5A5 5 0 1 1 7 2zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
      </svg>
    ),
  },
  {
    id: 'forms',
    title: msg('Forms'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M2.5 3.5h11v3h-11zM2.5 9.5h11v3h-11z" />
        <path fill="currentColor" d="M4 4.5h1v1H4zM4 10.5h1v1H4z" />
      </svg>
    ),
  },
  {
    id: 'sets',
    title: msg('Sets'),
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M5 2.5h8.5v10M3.5 4h8.5v10H3.5z" />
      </svg>
    ),
  },
  {
    id: 'projects',
    title: msg('Projects'),
    experimental: true,
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M2 4.5h4l1.2 1.5H14v6.5H2z" />
      </svg>
    ),
  },
  {
    id: 'sessions',
    title: msg('Sessions'),
    experimental: true,
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3 13c0-2.2 2.2-4 5-4s5 1.8 5 4v1H3v-1z" />
      </svg>
    ),
  },
]);

