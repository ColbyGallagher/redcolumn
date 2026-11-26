import { msg } from '@nb/i18n';
import { BATCH_KINDS, batchLabel, type BatchKind } from '../components/BatchDialog';
import type { ModelAction, ModelState } from '@nb/model3d';
import { model3dCommands } from './model3dCommands';
import { desktop } from '../desktop/host';
import { applyCommandPolicy } from './commandPolicy';
import type { Settings } from '../settings/settings';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import type { CadTool } from '../markup/cadTools';
import { cadToolName, flowShapeName } from '../i18n/names';
import { MARKUP_TOOLS, MEASURE_TOOLS } from '../components/ToolBar';
import type { ToolbarStyle } from '../workspace/profiles';
import { FLOW_SHAPES, type FlowShapeKind, type Side } from '@nb/markup';

/** The CAD Modify tools' commands, in menu order. */
export const CAD_COMMANDS: readonly [id: string, tool: CadTool][] = [
  ['edit.move', 'move'],
  ['edit.copyBase', 'copy'],
  ['edit.scale', 'scale'],
  ['edit.trim', 'trim'],
  ['edit.extend', 'extend'],
  ['edit.break', 'break'],
  ['edit.lengthen', 'lengthen'],
  ['edit.fillet', 'fillet'],
  ['edit.chamfer', 'chamfer'],
  ['edit.mirror', 'mirror'],
  ['edit.rotate', 'rotateRef'],
  ['edit.alignPoints', 'align'],
  ['edit.stretch', 'stretch'],
  ['edit.arrayPolar', 'arrayPolar'],
  ['edit.arrayPath', 'arrayPath'],
  ['edit.divide', 'divide'],
];

export type CommandCategory = 'File' | 'Edit' | 'View' | 'Document' | 'Bulk' | 'Tools' | 'Window' | 'Help';

/**
 * Something the user can do from a menu, a shortcut or the command palette. Commands are rebuilt
 * on every render, so `enabled` and `checked` are plain values for the current state.
 */
export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  run: () => void;
  enabled: boolean;
  checked?: boolean;
  /** Shown as the tooltip while the command is disabled: what to do to enable it. */
  hint?: string;
  /** The organisation's policy removes this command (desktop/policy.ts): menus, the ribbon and the palette leave it out. */
  managed?: true;
}

/** What the app can do; App supplies these, the command table decides when each is available. */
export interface CommandActions {
  open: () => void;
  newPdf: () => void;
  newFromTemplate: () => void;
  fromCamera: () => void;
  combine: () => void;
  close: () => void;
  closeAll: () => void;
  reopenClosedTab: () => void;
  saveAll: () => void;
  revert: () => void;
  publish: (mode: 'pdf' | 'images') => void;
  share: () => void;
  markupsXfdf: (dir: 'export' | 'import') => void;
  /** Bluebeam Revu's and Acrobat's FDF markup file: the markups out, or a reviewer's in. */
  markupsFdf: (dir: 'export' | 'import') => void;
  importMarkupsFromPdf: () => void;
  /** Bluebeam's markup file (.bax): every markup out, or a reviewer's markups in. */
  exportBax: () => void;
  importBax: () => void;
  save: () => void;
  saveAs: () => void;
  exportCsv: () => void;
  /** The Markups list as an .xlsx that can be edited in Excel and imported again. */
  exportXlsx: () => void;
  /** An edited .xlsx back in: a preview of what it changes, then the changes. */
  importXlsx: () => void;
  /** The comments in a client's register layout, as an .xlsx to fill in and import again. */
  exportRegister: () => void;
  /** The register templates: column headings, status wording and the block above the table, per client. */
  registerTemplates: () => void;
  exportSummary: () => void;
  print: () => void;
  preferences: () => void;
  manageProfiles: () => void;
  migrateRevu: () => void;
  shortcuts: () => void;
  about: () => void;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  pasteInPlace: () => void;
  multiply: () => void;
  deleteSelection: () => void;
  hideSelection: () => void;
  undoHistory: () => void;
  checkSpelling: () => void;
  sound: () => void;
  video: () => void;
  showHidden: () => void;
  selectAll: () => void;
  formatPainter: () => void;
  offset: () => void;
  /** Picks a CAD Modify tool (Trim, Fillet, Mirror...). */
  cadTool: (tool: CadTool) => void;
  join: () => void;
  explode: () => void;
  selectSimilar: () => void;
  toCloud: () => void;
  reverse: () => void;
  group: () => void;
  ungroup: () => void;
  lock: (locked: boolean) => void;
  /** Fits the selected text boxes to their text. */
  autoSize: () => void;
  /** Opens the selected markup's action (what clicking it does). */
  editAction: () => void;
  find: () => void;
  fit: () => void;
  fitWidth: () => void;
  actualSize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  singlePage: () => void;
  continuous: () => void;
  spread: (columns: 1 | 2, cover: boolean, continuous: boolean) => void;
  splitHorizontal: () => void;
  sync: (mode: 'document' | 'page' | null) => void;
  magnifier: () => void;
  fullScreen: () => void;
  stitch: () => void;
  /** Turns open 3D models' linework on geospatial sheets on or off. */
  modelOnDrawings: () => void;
  /** Opens the Stitching panel (match lines and regions placed by hand). */
  stitching: () => void;
  geospatial: () => void;
  /** Writes the current sheet's stitched group as one new page. */
  stitchToPage: () => void;
  /** Copies the stitching set up on some plan sheets onto another discipline's sheets. */
  applyStitching: () => void;
  /** Converts the drawing the current PDF was made from again (DWG/DXF opened in this visit). */
  convertDrawingAgain: () => void;
  split: () => void;
  unsplit: () => void;
  switchPanes: () => void;
  balance: () => void;
  rotateView: (quarterTurns: number) => void;
  setSettings: (patch: Partial<Settings>) => void;
  snapContent: (on: boolean) => void;
  showLinks: (show: boolean) => void;
  back: () => void;
  forward: () => void;
  goToPage: (which: 'next' | 'prev' | 'first' | 'last') => void;
  documentProperties: () => void;
  /** Quarter turns clockwise (3 is counterclockwise). */
  rotatePages: (quarterTurns: number) => void;
  insertPages: () => void;
  bulkInsertPages: () => void;
  insertBlank: () => void;
  extractPages: () => void;
  /** The current page, with its markups, as a picture on the clipboard. */
  copyPageSnapshot: () => void;
  pageTool: (kind: 'split' | 'replace' | 'crop' | 'setup') => void;
  headerFooter: (mode: 'headerFooter' | 'number') => void;
  process: (kind: 'flatten' | 'reduce' | 'colour') => void;
  unflatten: () => void;
  repair: () => void;
  applyRedactions: () => void;
  showPanel: (tab: 'forms') => void;
  /** Opens a side or bottom panel. `markups` and `links` are the bottom panel. */
  focusPanel: (id: PanelId) => void;
  togglePanels: () => void;
  addBookmark: () => void;
  cycleDocument: (dir: 1 | -1) => void;
  align: (how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  /** Arrow-key nudge of the selected markups; `large` is the Shift step. */
  nudge: (dx: -1 | 0 | 1, dy: -1 | 0 | 1, large: boolean) => void;
  flip: (axis: 'horizontal' | 'vertical') => void;
  centerOnPage: () => void;
  /** Resizes the selection to the first selected markup's width, height or both. */
  matchSize: (kind: 'width' | 'height' | 'both') => void;
  distribute: (axis: 'horizontal' | 'vertical') => void;
  scaleToLength: () => void;
  /** Shows the selected cropped pictures whole again. */
  resetCrop: () => void;
  /** Modify › Adjust Image / Picture Colours: opens the dialog for the selected pictures. */
  pictureDialog: (which: 'adjust' | 'colours') => void;
  arrange: (where: 'front' | 'back' | 'forward' | 'backward') => void;
  sign: () => void;
  digitalIds: () => void;
  ocr: () => void;
  compare: () => void;
  /** Document › AI Compare Documents: what changed in two revisions' text, by meaning, with an AI client's help. */
  semanticCompare: () => void;
  security: () => void;
  archivePdfA: () => void;
  autoFields: () => void;
  batch: (kind: BatchKind) => void;
  slipSheet: () => void;
  /** What is still open on each sheet, and the revision each comment was raised on. */
  closeOut: () => void;
  revisions: () => void;
  overlay: () => void;
  deletePages: () => void;
  labelRegions: () => void;
  /** Document › Drawing Standards: a client's title block and drawing numbers, chosen per document. */
  drawingStandards: () => void;
  /** Document › Set Up Drawing Standard: the step-by-step setup, in its own window. */
  setUpDrawingStandard: () => void;
  /** Box an example of a section mark, title or detail callout for sheet links to learn. */
  teachMark: () => void;
  scaleRegions: () => void;
  /** Document › Review Sheet Scales: title-block scales against the size each page was saved at. */
  scaleReview: () => void;
  /** Bulk Redact: removes what is inside the same boxes on many pages. */
  bulkRedact: () => void;
  thumbnails: () => void;
  setTool: (tool: Tool) => void;
  manageColumns: () => void;
  /** Tools › Takeoff › Assemblies… */
  manageAssemblies: () => void;
  /** Tools › Takeoff › Browse Library…: the community library's trade packs, listed from GitHub on open. */
  browseLibrary: () => void;
  /** Tools › Takeoff › Takeoff Quantities… */
  takeoffQuantities: () => void;
  /** Tools › Scripts: rules that find markups and change them. */
  scripts: () => void;
  /** Tools › Takeoff › Review AI Takeoff: what an AI client drew and proposed, to approve or reject. */
  takeoffReview: () => void;
  /** Takeoff › Cutout: draws a hole in the selected area. */
  cutout: () => void;
  /** Takeoff › Sync to Excel: opens the same dialog as the Markups list's button. */
  syncExcel: () => void;
  /** Portals (Experimental): the document's portals, to change their linked pages or remove them. */
  portals: () => void;
  /** The selected mirrored markups become ordinary markups on their pages. */
  breakPortalLink: () => void;
  /** Takeoff › Reports: the quantity, detail and count reports as PDF, Excel or CSV. */
  takeoffReports: () => void;
  /** Takeoff › Arc (3-point): arms (or disarms) the next segment of a polylength, area, perimeter or volume as an arc. */
  toggleArc: () => void;
  /** Takeoff › Hip / Valley: arms Polylength to measure a hip or valley at the Slope group's pitch. */
  hipValley: (kind: 'hip' | 'valley') => void;
  /** Takeoff › Manual Quantity: asks for a typed quantity, then arms placing it. */
  manualQuantity: () => void;
  /** Takeoff › Items: the catalog of cost lines assemblies price from. */
  manageItems: () => void;
  /** Takeoff › Product Lists: price lists catalog items link to. */
  manageProductLists: () => void;
  /** Takeoff › Templates › Manage Templates: rename, delete, import and export takeoff templates. */
  manageTemplates: () => void;
  /** Takeoff › Save as Template: the selected measurement's tool, look and assembly as a takeoff template. */
  saveTemplate: () => void;
  signatures: () => void;
  toggleToolbar: () => void;
  /** The top toolbar as a ribbon (full, or tabs only) or as the one-row simplified toolbar. */
  setToolbarStyle: (style: ToolbarStyle, collapsed?: boolean) => void;
  /** Puts the side panels, Markups list, ribbon, toolbar and split view back to their standard arrangement. */
  resetLayout: () => void;
  toggleLeft: () => void;
  /** Shows or hides the side panel of the panels docked on the right. */
  toggleRight: () => void;
  toggleBottom: () => void;
  commandPalette: () => void;
  install: () => void;
  help: (what: 'docs' | 'whatsNew' | 'logs' | 'suggest' | 'sponsor' | 'support' | 'community' | 'updates') => void;
  manageStamps: () => void;
  manageLineStyles: () => void;
  /** Diagram: arms the Flowchart Shape tool with a shape. */
  flowShape: (kind: FlowShapeKind) => void;
  /** Diagram: adds the next step beside the selected shape, joined to it. */
  addNextShape: (side: Side) => void;
  /** Diagram: joins the selected shapes one after another. */
  connectShapes: () => void;
  /** Diagram: how connectors bend (new ones and the selected ones). */
  connectorRoute: (route: 'elbow' | 'straight') => void;
  /** Runs a 3D view action on the model in front. */
  model3d: (action: ModelAction) => void;
}

/** The state commands depend on. */
export interface CommandState {
  hasDocument: boolean;
  /** The document can take markup edits (it is open and not read-only). */
  editable: boolean;
  /** Pages can be changed now (open, not busy, not a shared collaboration document). */
  pagesEditable: boolean;
  pageCount: number;
  pageIndex: number;
  /** Documents in the library, for commands that work across files. */
  libraryCount: number;
  /** Library documents marked as templates. */
  templateCount: number;
  /** Copies may be saved (downloaded, exported, printed); a collaboration host can forbid it for attendees. */
  canSaveCopy: boolean;
  selectionCount: number;
  /** PDF text is selected (not a markup), so Copy applies to it. */
  textSelected?: boolean;
  /** Markups in the document that are hidden. */
  hiddenCount: number;
  selectionLocked: boolean;
  selectionGrouped: boolean;
  /** Some selected markup is mirrored through a portal. */
  selectionLinked: boolean;
  /** Join and Explode have something selected to work on. */
  selectionJoinable: boolean;
  selectionExplodable: boolean;
  /** Convert to Cloud and Reverse have something selected to work on. */
  selectionCloudable: boolean;
  selectionReversible: boolean;
  /** Auto-size has a text box selected to fit. */
  selectionAutoSizable: boolean;
  /** Crop Image has one picture selected to crop; Reset Crop has a cropped one. */
  selectionCroppable: boolean;
  selectionCropped: boolean;
  /** Adjust Image has pictures selected to work on; Picture Colours has exactly one. */
  selectionPictures: number;
  /** Whether a Modify tool can work on the selection (true when nothing is selected). */
  selectionFits: (tool: CadTool | 'offset') => boolean;
  canPaste: boolean;
  canGoBack: boolean;
  /** The active document has changes that can be undone (Revert). */
  canUndo: boolean;
  canGoForward: boolean;
  split: boolean;
  splitHorizontal: boolean;
  /** The right pane is a second view of the left pane's document: nothing to switch. */
  mirrored: boolean;
  sync: 'document' | 'page' | null;
  /** Pages per row and whether the first page sits alone. */
  columns: 1 | 2;
  cover: boolean;
  magnifier: boolean;
  fullScreen: boolean;
  continuous: boolean;
  stitched: boolean;
  canStitch: boolean;
  canStitchToPage: boolean;
  canApplyStitching: boolean;
  canConvertDrawingAgain: boolean;
  showLinks: boolean;
  snap: boolean;
  showToolbar: boolean;
  toolbarStyle: ToolbarStyle;
  /** The ribbon shows only its tabs; a tab's commands drop down when clicked. */
  ribbonCollapsed: boolean;
  showLeft: boolean;
  /** The right-hand side panel is showing (some panels are docked on the right). */
  showRight: boolean;
  hasRightPanels: boolean;
  showBottom: boolean;
  tool: Tool;
  settings: Settings;
  /** Tabs in the active pane, for next and previous document. */
  openTabCount: number;
  /** Whether there is a recently closed tab that can be reopened. */
  hasClosedTabs?: boolean;
  leftTab: string;
  rightTab: string;
  bottomTab: string;
  /** The shape the Flowchart Shape tool draws, and how connectors bend. */
  flowShape: FlowShapeKind;
  connectorRoute: 'elbow' | 'straight';
  /** One shape is selected to add the next step after. */
  canAddNextShape: boolean;
  /** Two or more shapes are selected to join. */
  canConnectShapes: boolean;
  /** One unlocked area or volume is selected, so Cutout knows where to cut. */
  cutoutReady: boolean;
  /** A polylength, area, perimeter or volume is being drawn (or its tool is active), so a 3-point arc can be armed. */
  canArc: boolean;
  /** A 3-point arc is armed and waiting for its clicks. */
  arcArmed: boolean;
  /** Polylength is armed as a hip or valley (Takeoff › Hip / Valley). */
  hipValley: 'hip' | 'valley' | null;
  /** One measurement is selected that can be saved as a takeoff template. */
  canSaveTemplate: boolean;
  /** Why Cutout is disabled with the selection as it is, for its tooltip. */
  cutoutHint?: string;
  /** A 3D model is the tab in front (loaded or not). */
  modelOpen?: boolean;
  /** The 3D view of the model in front, once it has loaded. */
  model3d?: ModelState | null;
  /** Open models' linework is drawn on geospatial sheets. */
  modelOnDrawings?: boolean;
  /** A 3D model is open in some tab (in front or not). */
  anyModelOpen?: boolean;
  /** Split, with a model in front in one pane and a PDF in the other: what Sync View with Sheet needs. */
  modelSheetPair?: boolean;
}

/** Panels opened by Bluebeam's Alt+ shortcuts. `markups` and `links` sit on the bottom. */
export type PanelId =
  | 'files'
  | 'pages'
  | 'bookmarks'
  | 'toolchest'
  | 'properties'
  | 'layers'
  | 'measurements'
  | 'spaces'
  | 'signatures'
  | 'search'
  | 'forms'
  | 'sets'
  | 'sessions'
  | 'markups'
  | 'links'
  | 'model3d'
  | 'model3dProps';

/** Every command, in menu order within each category. */
export function buildCommands(a: CommandActions, s: CommandState): Command[] {
  const doc = s.hasDocument;
  const sel = s.selectionCount > 0;
  // Locked markups in the selection are skipped, not a reason to refuse.
  const nudgeable = sel && s.editable;
  const sidePanelOpen = (id: string) => (s.showLeft && s.leftTab === id) || (s.showRight && s.rightTab === id);
  const cmd = (id: string, category: CommandCategory, label: string, run: () => void, enabled = true, checked?: boolean): Command => ({
    id,
    category,
    label,
    run,
    enabled,
    ...(checked === undefined ? {} : { checked }),
  });
  const toggle = (key: 'showGrid' | 'snapToGrid' | 'snapToMarkup' | 'showRulers' | 'crosshair' | 'polarTracking' | 'objectSnapTracking') => () => a.setSettings({ [key]: !s.settings[key] });
  const tools = [...MARKUP_TOOLS, ...MEASURE_TOOLS].map(({ tool }) => cmd(`tool.${tool}`, 'Tools', toolLabel(tool), () => a.setTool(tool), doc && (tool === 'select' || tool === 'lasso' || tool === 'snapshot' || s.editable), s.tool === tool));

  return [
    cmd('file.newPdf', 'File', msg('New PDF…'), a.newPdf),
    cmd('file.fromCamera', 'File', msg('From Camera…'), a.fromCamera),
    cmd('file.newFromTemplate', 'File', msg('New PDF from Template…'), a.newFromTemplate, s.templateCount > 0),
    cmd('file.open', 'File', msg('Open…'), a.open),
    cmd('file.combine', 'File', msg('Combine…'), a.combine),
    cmd('file.close', 'File', msg('Close'), a.close, doc || !!s.modelOpen),
    cmd('file.closeAll', 'File', msg('Close All'), a.closeAll, doc || !!s.modelOpen),
    cmd('tab.reopenClosed', 'File', msg('Reopen Closed Tab'), a.reopenClosedTab, !!s.hasClosedTabs),
    cmd('file.save', 'File', msg('Save'), a.save, doc && s.canSaveCopy),
    cmd('file.saveAs', 'File', msg('Save As…'), a.saveAs, doc && s.canSaveCopy),
    cmd('file.saveAll', 'File', msg('Save All'), a.saveAll, doc && s.canSaveCopy),
    cmd('file.revert', 'File', msg('Revert'), a.revert, s.editable && s.canUndo),
    cmd('file.publish', 'File', msg('Publish…'), () => a.publish('pdf'), doc && s.canSaveCopy),
    cmd('file.share', 'File', msg('Share / Email…'), a.share, doc && s.canSaveCopy),
    cmd('file.exportImages', 'File', msg('Page Images…'), () => a.publish('images'), doc && s.canSaveCopy),
    cmd('file.exportXfdf', 'File', msg('Markups as XFDF…'), () => a.markupsXfdf('export'), doc && s.canSaveCopy),
    cmd('file.importXfdf', 'File', msg('Import Markups from XFDF…'), () => a.markupsXfdf('import'), s.editable),
    cmd('file.exportFdf', 'File', msg('Markups as FDF…'), () => a.markupsFdf('export'), doc && s.canSaveCopy),
    cmd('file.importFdf', 'File', msg('Import Markups from FDF…'), () => a.markupsFdf('import'), s.editable),
    cmd('file.exportBax', 'File', msg('Markups as Bluebeam BAX…'), a.exportBax, doc),
    cmd('file.importBax', 'File', msg('Import Markups from Bluebeam BAX…'), a.importBax, s.editable),
    cmd('file.importPdfMarkups', 'File', msg('Import Markups from PDF…'), a.importMarkupsFromPdf, s.editable),
    cmd('file.exportCsv', 'File', msg('Export Markups CSV'), a.exportCsv, doc && s.canSaveCopy),
    cmd('file.exportXlsx', 'File', msg('Export Markups for Excel'), a.exportXlsx, doc && s.canSaveCopy),
    cmd('file.importXlsx', 'File', msg('Import Markups from Excel…'), a.importXlsx, s.editable),
    cmd('file.exportRegister', 'File', msg('Export Comment Register…'), a.exportRegister, doc && s.canSaveCopy),
    cmd('file.registerTemplates', 'File', msg('Register Templates…'), a.registerTemplates, doc),
    cmd('file.exportSummary', 'File', msg('Markup Summary…'), a.exportSummary, doc && s.canSaveCopy),
    cmd('file.print', 'File', msg('Print…'), a.print, doc && s.canSaveCopy),
    cmd('file.preferences', 'File', msg('Preferences…'), a.preferences),
    cmd('file.manageProfiles', 'File', msg('Manage Profiles…'), a.manageProfiles),
    cmd('file.migrateRevu', 'File', msg('Migrate from Revu…'), a.migrateRevu),
    cmd('file.shortcuts', 'File', msg('Keyboard Shortcuts…'), a.shortcuts),
    cmd('file.about', 'File', msg('About redcolumn'), a.about),

    cmd('edit.undo', 'Edit', msg('Undo'), a.undo, doc),
    cmd('edit.redo', 'Edit', msg('Redo'), a.redo, doc),
    cmd('edit.undoHistory', 'Edit', msg('Undo History…'), a.undoHistory, doc),
    cmd('edit.cut', 'Edit', msg('Cut'), a.cut, sel && s.editable),
    cmd('edit.copy', 'Edit', msg('Copy'), a.copy, sel || !!s.textSelected),
    cmd('edit.paste', 'Edit', msg('Paste'), a.paste, s.editable && s.canPaste),
    cmd('edit.pasteInPlace', 'Edit', msg('Paste in Place'), a.pasteInPlace, s.editable && s.canPaste),
    cmd('edit.offset', 'Edit', toolLabel('offset'), a.offset, s.editable && s.selectionFits('offset'), s.tool === 'offset'),
    cmd('edit.multiply', 'Edit', msg('Multiply…'), a.multiply, sel && s.editable),
    ...CAD_COMMANDS.map(([id, tool]) => cmd(id, 'Edit', cadToolName(tool), () => a.cadTool(tool), doc && s.editable && s.selectionFits(tool), s.tool === tool)),
    cmd('edit.join', 'Edit', msg('Join'), a.join, s.selectionJoinable && s.editable),
    cmd('edit.explode', 'Edit', msg('Explode'), a.explode, s.selectionExplodable && s.editable),
    // translators: a verb: reverse the direction of the selected lines
    cmd('edit.reverse', 'Edit', msg('Reverse'), a.reverse, s.selectionReversible && s.editable),
    cmd('edit.toCloud', 'Edit', msg('Convert to Cloud'), a.toCloud, s.selectionCloudable && s.editable),
    cmd('edit.selectSimilar', 'Edit', msg('Select Similar'), a.selectSimilar, sel),
    cmd('edit.delete', 'Edit', msg('Delete'), a.deleteSelection, sel && s.editable),
    cmd('edit.hide', 'Edit', msg('Hide'), a.hideSelection, sel && s.editable),
    cmd('edit.showHidden', 'Edit', msg('Show Hidden Markups'), a.showHidden, s.hiddenCount > 0 && s.editable),
    cmd('edit.selectAll', 'Edit', msg('Select All'), a.selectAll, doc),
    cmd('edit.formatPainter', 'Edit', msg('Format Painter'), a.formatPainter, s.selectionCount === 1 && s.editable, s.tool === 'painter'),
    cmd('edit.group', 'Edit', msg('Group'), a.group, s.selectionCount > 1 && s.editable),
    cmd('edit.ungroup', 'Edit', msg('Ungroup'), a.ungroup, s.selectionGrouped && s.editable),
    // translators: Lock and Unlock are verbs (stop the selected markups being changed)
    cmd('edit.lock', 'Edit', s.selectionLocked ? msg('Unlock') : msg('Lock'), () => a.lock(!s.selectionLocked), sel && s.editable, s.selectionLocked),
    cmd('edit.nudgeLeft', 'Edit', msg('Nudge Left'), () => a.nudge(-1, 0, false), nudgeable),
    cmd('edit.nudgeRight', 'Edit', msg('Nudge Right'), () => a.nudge(1, 0, false), nudgeable),
    cmd('edit.nudgeUp', 'Edit', msg('Nudge Up'), () => a.nudge(0, -1, false), nudgeable),
    cmd('edit.nudgeDown', 'Edit', msg('Nudge Down'), () => a.nudge(0, 1, false), nudgeable),
    cmd('edit.nudgeLeftLarge', 'Edit', msg('Nudge Left (Large)'), () => a.nudge(-1, 0, true), nudgeable),
    cmd('edit.nudgeRightLarge', 'Edit', msg('Nudge Right (Large)'), () => a.nudge(1, 0, true), nudgeable),
    cmd('edit.nudgeUpLarge', 'Edit', msg('Nudge Up (Large)'), () => a.nudge(0, -1, true), nudgeable),
    cmd('edit.nudgeDownLarge', 'Edit', msg('Nudge Down (Large)'), () => a.nudge(0, 1, true), nudgeable),
    cmd('edit.alignLeft', 'Edit', msg('Align Left'), () => a.align('left'), s.selectionCount > 1 && s.editable && !s.selectionLocked),
    cmd('edit.alignCenter', 'Edit', msg('Align Center'), () => a.align('center'), s.selectionCount > 1 && s.editable && !s.selectionLocked),
    cmd('edit.alignRight', 'Edit', msg('Align Right'), () => a.align('right'), s.selectionCount > 1 && s.editable && !s.selectionLocked),
    cmd('edit.alignTop', 'Edit', msg('Align Top'), () => a.align('top'), s.selectionCount > 1 && s.editable && !s.selectionLocked),
    cmd('edit.alignMiddle', 'Edit', msg('Align Middle'), () => a.align('middle'), s.selectionCount > 1 && s.editable && !s.selectionLocked),
    cmd('edit.alignBottom', 'Edit', msg('Align Bottom'), () => a.align('bottom'), s.selectionCount > 1 && s.editable && !s.selectionLocked),
    cmd('edit.centerInDocument', 'Edit', msg('Center in Document'), a.centerOnPage, sel && s.editable && !s.selectionLocked),
    cmd('edit.sameWidth', 'Edit', msg('Same Width'), () => a.matchSize('width'), s.selectionCount > 1 && s.editable),
    cmd('edit.sameHeight', 'Edit', msg('Same Height'), () => a.matchSize('height'), s.selectionCount > 1 && s.editable),
    cmd('edit.sameSize', 'Edit', msg('Same Size'), () => a.matchSize('both'), s.selectionCount > 1 && s.editable),
    cmd('edit.distributeHorizontal', 'Edit', msg('Distribute Horizontally'), () => a.distribute('horizontal'), s.selectionCount > 2 && s.editable && !s.selectionLocked),
    cmd('edit.distributeVertical', 'Edit', msg('Distribute Vertically'), () => a.distribute('vertical'), s.selectionCount > 2 && s.editable && !s.selectionLocked),
    cmd('edit.flipHorizontal', 'Edit', msg('Flip Horizontal'), () => a.flip('horizontal'), sel && s.editable && !s.selectionLocked),
    cmd('edit.flipVertical', 'Edit', msg('Flip Vertical'), () => a.flip('vertical'), sel && s.editable && !s.selectionLocked),
    cmd('edit.createViewport', 'Edit', msg('Create Viewport'), () => a.setTool('viewport'), doc && s.editable, s.tool === 'viewport'),
    cmd('edit.scaleToLength', 'Edit', msg('Scale to Length…'), a.scaleToLength, doc && s.editable, s.tool === 'scaleLength'),
    cmd('edit.cropImage', 'Edit', msg('Crop Image'), () => a.setTool('cropImage'), s.selectionCroppable && s.editable, s.tool === 'cropImage'),
    cmd('edit.adjustImage', 'Edit', msg('Adjust Image…'), () => a.pictureDialog('adjust'), s.selectionPictures > 0 && s.editable),
    cmd('edit.pictureColours', 'Edit', msg('Picture Colours…'), () => a.pictureDialog('colours'), s.selectionPictures === 1 && s.editable),
    cmd('edit.resetCrop', 'Edit', msg('Reset Crop'), a.resetCrop, s.selectionCropped && s.editable),
    cmd('edit.bringToFront', 'Edit', msg('Bring to Front'), () => a.arrange('front'), sel && s.editable),
    cmd('edit.bringForward', 'Edit', msg('Bring Forward'), () => a.arrange('forward'), sel && s.editable),
    cmd('edit.sendBackward', 'Edit', msg('Send Backward'), () => a.arrange('backward'), sel && s.editable),
    cmd('edit.sendToBack', 'Edit', msg('Send to Back'), () => a.arrange('back'), sel && s.editable),
    cmd('edit.autoSize', 'Edit', msg('Auto-size Text Box'), a.autoSize, s.selectionAutoSizable && s.editable),
    cmd('edit.editAction', 'Edit', msg('Edit Action…'), a.editAction, s.selectionCount === 1 && s.editable),
    cmd('edit.find', 'Edit', msg('Find Text'), a.find, doc),
    cmd('edit.checkSpelling', 'Edit', msg('Check Spelling…'), a.checkSpelling, doc),

    cmd('view.fitPage', 'View', msg('Fit Page'), a.fit, doc),
    cmd('view.fitWidth', 'View', msg('Fit Width'), a.fitWidth, doc),
    cmd('view.actualSize', 'View', msg('Actual Size'), a.actualSize, doc),
    cmd('view.zoomIn', 'View', msg('Zoom In'), a.zoomIn, doc),
    cmd('view.zoomOut', 'View', msg('Zoom Out'), a.zoomOut, doc),
    cmd('view.singlePage', 'View', msg('Single Page'), () => (s.columns === 2 ? a.spread(1, s.cover, false) : a.singlePage()), doc, doc && !s.continuous && !s.stitched && s.columns === 1),
    cmd('view.continuous', 'View', msg('Continuous Pages'), () => (s.columns === 2 ? a.spread(1, s.cover, true) : a.continuous()), doc, s.continuous && s.columns === 1),
    cmd('view.sideBySide', 'View', msg('Side-by-Side'), () => a.spread(2, s.cover, false), doc, doc && !s.continuous && !s.stitched && s.columns === 2),
    cmd('view.continuousSideBySide', 'View', msg('Continuous Side-by-Side'), () => a.spread(2, s.cover, true), doc, s.continuous && s.columns === 2),
    cmd('view.coverPage', 'View', msg('Show Cover Page in Side-by-Side'), () => a.spread(s.columns, !s.cover, s.continuous), doc, s.cover),
    cmd('view.rotateClockwise', 'View', msg('Rotate View Clockwise'), () => a.rotateView(1), doc),
    cmd('view.rotateCounterclockwise', 'View', msg('Rotate View Counterclockwise'), () => a.rotateView(-1), doc),
    cmd('view.split', 'View', msg('Split Vertical'), s.split && !s.splitHorizontal ? a.unsplit : a.split, doc, s.split && !s.splitHorizontal),
    cmd('view.splitHorizontal', 'View', msg('Split Horizontal'), s.split && s.splitHorizontal ? a.unsplit : a.splitHorizontal, doc, s.split && s.splitHorizontal),
    cmd('view.syncDocument', 'View', msg('Synchronise Document'), () => a.sync(s.sync === 'document' ? null : 'document'), s.split, s.sync === 'document'),
    cmd('view.syncPage', 'View', msg('Synchronise Page'), () => a.sync(s.sync === 'page' ? null : 'page'), s.split, s.sync === 'page'),
    cmd('view.switchPanes', 'View', msg('Switch Split Panes'), a.switchPanes, s.split && !s.mirrored),
    cmd('view.balance', 'View', msg('Balance Split'), a.balance, s.split),
    cmd('view.unsplit', 'View', msg('Unsplit'), a.unsplit, s.split),
    cmd('view.stitched', 'View', msg('Stitched View'), a.stitch, s.canStitch || s.stitched, s.stitched),
    {
      ...cmd('view.modelOnDrawings', 'View', msg('3D Models on Sheets'), a.modelOnDrawings, !!s.anyModelOpen, !!s.modelOnDrawings),
      hint: msg('Open an IFC model to draw it on sheets registered to the same map'),
    },
    {
      ...cmd('view.syncModel', 'View', msg('Sync View with Sheet'), () => a.sync(s.sync ? null : 'document'), !!s.modelSheetPair, !!s.modelSheetPair && !!s.sync),
      hint: msg('Split the view with a 3D model on one side and a sheet registered to the map on the other'),
    },
    cmd('view.rulers', 'View', msg('Rulers'), toggle('showRulers'), true, s.settings.showRulers),
    cmd('view.crosshair', 'View', msg('Full-Screen Crosshair'), toggle('crosshair'), true, s.settings.crosshair),
    cmd('view.grid', 'View', msg('Show Grid'), toggle('showGrid'), true, s.settings.showGrid),
    cmd('view.snapGrid', 'View', msg('Snap to Grid'), toggle('snapToGrid'), true, s.settings.snapToGrid),
    cmd('view.snapContent', 'View', msg('Snap to Content'), () => a.snapContent(!s.snap), true, s.snap),
    cmd('view.snapMarkup', 'View', msg('Snap to Markup'), toggle('snapToMarkup'), true, s.settings.snapToMarkup),
    cmd('view.polarTracking', 'View', msg('Polar Tracking'), toggle('polarTracking'), true, s.settings.polarTracking),
    cmd('view.objectSnapTracking', 'View', msg('Object Snap Tracking'), toggle('objectSnapTracking'), true, s.settings.objectSnapTracking),
    cmd('view.showLinks', 'View', msg('Show Links'), () => a.showLinks(!s.showLinks), doc, s.showLinks),
    cmd('view.darkPages', 'View', msg('Dark Mode (Pages)'), () => a.setSettings({ pageFilter: s.settings.pageFilter === 'dark' ? 'none' : 'dark' }), true, s.settings.pageFilter === 'dark'),
    cmd('view.dimmer', 'View', msg('Dimmer'), () => a.setSettings({ pageFilter: s.settings.pageFilter === 'dim' ? 'none' : 'dim' }), true, s.settings.pageFilter === 'dim'),
    cmd('view.thinLines', 'View', msg('Disable Line Weights'), () => a.setSettings({ thinLines: !s.settings.thinLines }), true, s.settings.thinLines),
    cmd('view.keepView', 'View', msg('Keep View Between Pages'), () => a.setSettings({ keepViewBetweenPages: !s.settings.keepViewBetweenPages }), true, s.settings.keepViewBetweenPages),
    cmd('view.magnifier', 'View', msg('Magnifier'), a.magnifier, doc, s.magnifier),
    cmd('view.fullScreen', 'View', msg('Full Screen'), a.fullScreen, doc, s.fullScreen),
    cmd('view.replyIndicators', 'View', msg('Always Show Reply Indicators'), () => a.setSettings({ replyIndicators: !s.settings.replyIndicators }), true, s.settings.replyIndicators),
    cmd('view.reuse', 'View', msg('Reuse Tool'), () => a.setSettings({ reuseTool: !s.settings.reuseTool }), true, s.settings.reuseTool),
    cmd('tool.pan', 'Tools', toolLabel('pan'), () => a.setTool('pan'), doc, s.tool === 'pan'),
    cmd('tool.zoomBox', 'Tools', toolLabel('zoomBox'), () => a.setTool('zoomBox'), doc, s.tool === 'zoomBox'),
    cmd('tool.dynamicZoom', 'Tools', msg('Dynamic Zoom'), () => a.setTool('dynamicZoom'), doc, s.tool === 'dynamicZoom'),
    cmd('view.back', 'View', msg('Previous View'), a.back, s.canGoBack),
    cmd('view.forward', 'View', msg('Next View'), a.forward, s.canGoForward),
    cmd('view.nextPage', 'View', msg('Next Page'), () => a.goToPage('next'), doc && s.pageIndex < s.pageCount - 1),
    cmd('view.prevPage', 'View', msg('Previous Page'), () => a.goToPage('prev'), doc && s.pageIndex > 0),
    cmd('view.firstPage', 'View', msg('First Page'), () => a.goToPage('first'), doc && s.pageIndex > 0),
    cmd('view.lastPage', 'View', msg('Last Page'), () => a.goToPage('last'), doc && s.pageIndex < s.pageCount - 1),
    cmd('view.nextDocument', 'View', msg('Next Document'), () => a.cycleDocument(1), s.openTabCount > 1),
    cmd('view.prevDocument', 'View', msg('Previous Document'), () => a.cycleDocument(-1), s.openTabCount > 1),

    cmd('document.properties', 'Document', msg('Document Properties…'), a.documentProperties, doc),
    cmd('document.addBookmark', 'Document', msg('Add Bookmark'), a.addBookmark, s.editable),
    cmd('document.rotatePages', 'Document', msg('Rotate Pages'), () => a.rotatePages(1), s.pagesEditable),
    cmd('document.rotateCounterclockwise', 'Document', msg('Rotate Pages Counterclockwise'), () => a.rotatePages(3), s.pagesEditable),
    cmd('document.insertPages', 'Document', msg('Insert Pages from PDF…'), a.insertPages, s.pagesEditable),
    cmd('document.bulkInsertPages', 'Document', msg('Bulk Insert PDFs…'), a.bulkInsertPages, s.pagesEditable),
    cmd('document.insertBlank', 'Document', msg('Insert Blank Pages…'), a.insertBlank, s.pagesEditable),
    cmd('document.extractPages', 'Document', msg('Extract Pages…'), a.extractPages, s.pagesEditable && s.canSaveCopy),
    cmd('document.copyPageSnapshot', 'Document', msg('Copy Page to Snapshot'), a.copyPageSnapshot, doc),
    cmd('document.deletePages', 'Document', msg('Delete Pages…'), a.deletePages, s.pagesEditable && s.pageCount > 1),
    cmd('document.splitDocument', 'Document', msg('Split Document…'), () => a.pageTool('split'), doc && s.pageCount > 1 && s.canSaveCopy),
    cmd('document.replacePages', 'Document', msg('Replace Pages…'), () => a.pageTool('replace'), s.pagesEditable),
    cmd('document.cropPages', 'Document', msg('Crop Pages…'), () => a.pageTool('crop'), s.pagesEditable),
    cmd('document.pageSetup', 'Document', msg('Page Setup…'), () => a.pageTool('setup'), s.pagesEditable),
    cmd('document.headerFooter', 'Document', msg('Headers & Footers…'), () => a.headerFooter('headerFooter'), s.pagesEditable),
    cmd('document.numberPages', 'Document', msg('Number Pages…'), () => a.headerFooter('number'), s.pagesEditable),
    cmd('document.flatten', 'Document', msg('Flatten…'), () => a.process('flatten'), s.pagesEditable && s.editable),
    cmd('document.unflatten', 'Document', msg('Unflatten'), a.unflatten, s.pagesEditable && s.editable),
    cmd('document.reduceSize', 'Document', msg('Reduce File Size…'), () => a.process('reduce'), s.pagesEditable),
    cmd('document.repair', 'Document', msg('Repair PDF'), a.repair, s.pagesEditable),
    cmd('document.colour', 'Document', msg('Colour Processing…'), () => a.process('colour'), s.pagesEditable),
    cmd('document.ocr', 'Document', msg('OCR…'), a.ocr, s.pagesEditable),
    cmd('document.slipSheet', 'Document', msg('Slip Sheet…'), a.slipSheet, s.pagesEditable),
    cmd('document.revisions', 'Document', msg('Revisions…'), a.revisions, doc),
    cmd('document.closeOut', 'Document', msg('Close-out…'), a.closeOut, doc),
    ...BATCH_KINDS.map((k) => cmd(`batch.${k}`, 'Bulk', `${batchLabel(k)}…`, () => a.batch(k), s.libraryCount > 0)),
    cmd('document.security', 'Document', msg('Security…'), a.security, doc && s.canSaveCopy),
    cmd('document.pdfa', 'Document', msg('Archive as PDF/A…'), a.archivePdfA, doc && s.canSaveCopy),
    cmd('document.compare', 'Document', msg('Compare Documents…'), a.compare, true),
    cmd('document.semanticCompare', 'Document', msg('AI Compare Documents…'), a.semanticCompare, s.libraryCount > 1, sidePanelOpen('ai')),
    cmd('document.overlay', 'Document', msg('Overlay Pages…'), a.overlay, true),
    cmd('document.stitching', 'Document', msg('Stitching…'), a.stitching, doc, sidePanelOpen('stitching')),
    cmd('document.geospatial', 'Document', msg('Geospatial…'), a.geospatial, doc, sidePanelOpen('geospatial')),
    cmd('document.stitchToPage', 'Document', msg('Stitch to New Page'), a.stitchToPage, s.canStitchToPage),
    cmd('document.applyStitching', 'Document', msg('Apply Stitching to Other Sheets…'), a.applyStitching, s.canApplyStitching),
    cmd('document.convertDrawingAgain', 'Document', msg('Convert Drawing Again… (Experimental)'), a.convertDrawingAgain, s.canConvertDrawingAgain),
    cmd('document.labelRegions', 'Document', msg('Page Labels from Region…'), a.labelRegions, s.pagesEditable),
    cmd('document.scaleRegions', 'Document', msg('Bulk Apply Page Scale…'), a.scaleRegions, s.pagesEditable),
    cmd('document.scaleReview', 'Document', msg('Review Sheet Scales…'), a.scaleReview, doc),
    cmd('document.drawingStandards', 'Document', msg('Drawing Standards…'), a.drawingStandards, doc),
    cmd('document.setUpDrawingStandard', 'Document', msg('Set Up Drawing Standard…'), a.setUpDrawingStandard, doc),
    cmd('document.thumbnails', 'Document', msg('Edit Page Labels in Thumbnails'), a.thumbnails, doc),
    cmd('document.teachMark', 'Document', msg('Teach Sheet Links…'), a.teachMark, doc && s.editable),

    ...tools,
    cmd('tools.sound', 'Tools', msg('Sound…'), a.sound, s.editable),
    cmd('tools.video', 'Tools', msg('Video…'), a.video, s.editable),
    cmd('tools.eraserSmall', 'Tools', msg('Eraser Size: Small'), () => a.setSettings({ eraserSize: 'small' }), true, s.settings.eraserSize === 'small'),
    cmd('tools.eraserMedium', 'Tools', msg('Eraser Size: Medium'), () => a.setSettings({ eraserSize: 'medium' }), true, s.settings.eraserSize === 'medium'),
    cmd('tools.eraserLarge', 'Tools', msg('Eraser Size: Large'), () => a.setSettings({ eraserSize: 'large' }), true, s.settings.eraserSize === 'large'),
    cmd('tools.eraserWhole', 'Tools', msg('Annotation Eraser (Whole Markups)'), () => a.setSettings({ eraserWhole: !s.settings.eraserWhole }), true, s.settings.eraserWhole),
    cmd('tools.sketchToScale', 'Tools', msg('Draw to Scale'), () => a.setSettings({ sketchToScale: !s.settings.sketchToScale }), doc, s.settings.sketchToScale),
    cmd('tools.stamps', 'Tools', msg('Manage Stamps…'), a.manageStamps, doc),
    cmd('tools.lineStyles', 'Tools', msg('Line Styles…'), a.manageLineStyles, true),
    cmd('tools.nextMeasure', 'Tools', msg('Next Measure Tool'), () => {
      const order = MEASURE_TOOLS.map((t) => t.tool);
      const at = order.indexOf(s.tool);
      a.setTool(order[(at + 1) % order.length]!);
    }, doc && s.editable),
    cmd('tools.applyRedactions', 'Tools', msg('Apply Redactions…'), a.applyRedactions, s.pagesEditable && s.editable),
    cmd('tools.bulkRedact', 'Bulk', msg('Bulk Redact…'), a.bulkRedact, s.pagesEditable && s.editable),
    cmd('tools.sign', 'Tools', msg('Sign with Digital ID…'), a.sign, s.pagesEditable),
    cmd('tools.digitalIds', 'Tools', msg('Digital IDs…'), a.digitalIds),
    cmd('tools.formField', 'Tools', msg('Form Field'), () => a.setTool('formField'), s.pagesEditable, s.tool === 'formField'),
    cmd('tools.forms', 'Tools', msg('Forms Panel'), () => a.showPanel('forms'), doc),
    cmd('tools.autoFields', 'Tools', msg('Auto-Create Fields…'), a.autoFields, s.pagesEditable && s.editable),
    cmd('edit.eraseContent', 'Edit', msg('Erase Content'), () => a.setTool('eraseContent'), s.pagesEditable && s.editable, s.tool === 'eraseContent'),
    cmd('edit.cutContent', 'Edit', msg('Cut Content'), () => a.setTool('cutContent'), s.pagesEditable && s.editable && s.canSaveCopy, s.tool === 'cutContent'),
    cmd('edit.editText', 'Edit', msg('Edit Text'), () => a.setTool('editText'), s.pagesEditable && s.editable, s.tool === 'editText'),
    cmd('edit.selectText', 'Edit', msg('Select Text'), () => a.setTool('selectText'), doc, s.tool === 'selectText'),
    cmd('tools.columns', 'Tools', msg('Markup Columns & Statuses…'), a.manageColumns, doc),
    cmd('tools.assemblies', 'Tools', msg('Assemblies…'), a.manageAssemblies, doc),
    cmd('tools.library', 'Tools', msg('Browse Library…'), a.browseLibrary, true),
    cmd('tools.quantities', 'Tools', msg('Takeoff Quantities…'), a.takeoffQuantities, doc),
    cmd('tools.scripts', 'Tools', msg('Scripts…'), a.scripts, doc),
    cmd('takeoff.manual', 'Tools', msg('Manual Quantity…'), a.manualQuantity, doc && s.editable, s.tool === 'manual'),
    { ...cmd('tool.cutout', 'Tools', msg('Cutout'), a.cutout, doc && s.editable && (s.cutoutReady || s.tool === 'cutout'), s.tool === 'cutout'), hint: doc && s.editable ? s.cutoutHint : undefined },
    cmd('takeoff.syncExcel', 'Tools', msg('Sync to Excel…'), a.syncExcel, doc),
    cmd('takeoff.reports', 'Tools', msg('Takeoff Reports…'), a.takeoffReports, doc),
    cmd('takeoff.definePortal', 'Tools', msg('Define Portal (Experimental)'), () => a.setTool('portalPolygon'), doc && s.editable && s.pageCount > 1, s.tool === 'portalPolygon'),
    cmd('takeoff.portals', 'Tools', msg('Portals… (Experimental)'), a.portals, doc),
    cmd('takeoff.breakPortalLink', 'Tools', msg('Break Portal Link (Experimental)'), a.breakPortalLink, s.selectionLinked && s.editable),
    { ...cmd('draw.arc', 'Tools', msg('Arc (3-point)'), a.toggleArc, doc && s.editable && (s.canArc || s.arcArmed), s.arcArmed), hint: msg('Start a polylength or area first') },
    cmd('takeoff.hip', 'Tools', msg('Hip Length'), () => a.hipValley('hip'), doc && s.editable, s.tool === 'polylength' && s.hipValley === 'hip'),
    cmd('takeoff.valley', 'Tools', msg('Valley Length'), () => a.hipValley('valley'), doc && s.editable, s.tool === 'polylength' && s.hipValley === 'valley'),
    cmd('tools.takeoffReview', 'Tools', msg('Review AI Takeoff…'), a.takeoffReview, doc),
    cmd('takeoff.items', 'Tools', msg('Items…'), a.manageItems, doc),
    cmd('takeoff.productLists', 'Tools', msg('Product Lists…'), a.manageProductLists, doc),
    cmd('takeoff.templates', 'Tools', msg('Takeoff Templates…'), a.manageTemplates, doc),
    cmd('takeoff.saveTemplate', 'Tools', msg('Save as Template…'), a.saveTemplate, doc && s.canSaveTemplate),
    cmd('tools.signatures', 'Tools', msg('Sign…'), a.signatures, doc),
    ...FLOW_SHAPES.map((f) => cmd(`diagram.${f.kind}`, 'Tools', flowShapeName(f.kind), () => a.flowShape(f.kind), doc && s.editable, s.tool === 'flowShape' && s.flowShape === f.kind)),
    cmd('tool.connector', 'Tools', toolLabel('connector'), () => a.setTool('connector'), doc && s.editable, s.tool === 'connector'),
    cmd('diagram.addBelow', 'Tools', msg('Add Step Below'), () => a.addNextShape('bottom'), s.canAddNextShape),
    cmd('diagram.addRight', 'Tools', msg('Add Step Right'), () => a.addNextShape('right'), s.canAddNextShape),
    cmd('diagram.addAbove', 'Tools', msg('Add Step Above'), () => a.addNextShape('top'), s.canAddNextShape),
    cmd('diagram.addLeft', 'Tools', msg('Add Step Left'), () => a.addNextShape('left'), s.canAddNextShape),
    cmd('diagram.connect', 'Tools', msg('Connect Shapes'), a.connectShapes, s.canConnectShapes),
    cmd('diagram.elbow', 'Tools', msg('Elbow Connectors'), () => a.connectorRoute('elbow'), doc, s.connectorRoute === 'elbow'),
    cmd('diagram.straight', 'Tools', msg('Straight Connectors'), () => a.connectorRoute('straight'), doc, s.connectorRoute === 'straight'),

    cmd('window.toolbar', 'Window', msg('Tools Toolbar'), a.toggleToolbar, true, s.showToolbar),
    cmd('window.ribbon', 'Window', msg('Ribbon'), () => a.setToolbarStyle('ribbon', false), true, s.toolbarStyle === 'ribbon' && !s.ribbonCollapsed),
    cmd('window.ribbonTabs', 'Window', msg('Ribbon Tabs Only'), () => a.setToolbarStyle('ribbon', true), true, s.toolbarStyle === 'ribbon' && s.ribbonCollapsed),
    cmd('window.simplifiedToolbar', 'Window', msg('Simplified Toolbar'), () => a.setToolbarStyle('simplified'), true, s.toolbarStyle === 'simplified'),
    cmd('window.collapseRibbon', 'Window', s.ribbonCollapsed ? msg('Expand the Ribbon') : msg('Collapse the Ribbon'), () => a.setToolbarStyle('ribbon', !s.ribbonCollapsed), s.toolbarStyle === 'ribbon', s.toolbarStyle === 'ribbon' && s.ribbonCollapsed),
    cmd('window.leftPanel', 'Window', msg('Left Panel'), a.toggleLeft, true, s.showLeft),
    cmd('window.rightPanel', 'Window', msg('Right Panel'), a.toggleRight, s.hasRightPanels, s.showRight),
    cmd('window.bottomPanel', 'Window', msg('Bottom Panel'), a.toggleBottom, true, s.showBottom),
    cmd('window.panels', 'Window', msg('Toggle Panels'), a.togglePanels),
    cmd('window.resetLayout', 'Window', msg('Reset Layout'), a.resetLayout),
    cmd('window.files', 'Window', msg('File Access'), () => a.focusPanel('files'), true, sidePanelOpen('files')),
    cmd('window.pages', 'Window', msg('Thumbnails'), () => a.focusPanel('pages'), true, sidePanelOpen('pages')),
    cmd('window.bookmarks', 'Window', msg('Bookmarks'), () => a.focusPanel('bookmarks'), true, sidePanelOpen('bookmarks')),
    cmd('window.toolchest', 'Window', msg('Tool Library'), () => a.focusPanel('toolchest'), true, sidePanelOpen('toolchest')),
    cmd('window.properties', 'Window', msg('Properties'), () => a.focusPanel('properties'), true, sidePanelOpen('properties')),
    cmd('window.layers', 'Window', msg('Layers'), () => a.focusPanel('layers'), true, sidePanelOpen('layers')),
    cmd('window.measurements', 'Window', msg('Measurements'), () => a.focusPanel('measurements'), true, sidePanelOpen('measurements')),
    cmd('window.spaces', 'Window', msg('Spaces'), () => a.focusPanel('spaces'), true, sidePanelOpen('spaces')),
    cmd('window.signatures', 'Window', msg('Signatures'), () => a.focusPanel('signatures'), true, sidePanelOpen('signatures')),
    cmd('window.search', 'Window', msg('Search'), () => a.focusPanel('search'), true, sidePanelOpen('search')),
    cmd('window.forms', 'Window', msg('Forms'), () => a.focusPanel('forms'), true, sidePanelOpen('forms')),
    cmd('window.sets', 'Window', msg('Sets'), () => a.focusPanel('sets'), true, sidePanelOpen('sets')),
    cmd('window.sessions', 'Window', msg('Sessions'), () => a.focusPanel('sessions'), true, sidePanelOpen('sessions')),
    cmd('window.model3d', 'Window', msg('3D Model'), () => a.focusPanel('model3d'), !!s.modelOpen, sidePanelOpen('model3d')),
    cmd('window.model3dProps', 'Window', msg('3D Properties'), () => a.focusPanel('model3dProps'), !!s.modelOpen, sidePanelOpen('model3dProps')),
    cmd('window.markups', 'Window', msg('Markups List'), () => a.focusPanel('markups'), true, s.showBottom && s.bottomTab === 'markups'),
    cmd('window.links', 'Window', msg('Hyperlinks'), () => a.focusPanel('links'), true, s.showBottom && s.bottomTab === 'links'),

    cmd('help.commands', 'Help', msg('Find Tools + Commands…'), a.commandPalette),
    cmd('help.docs', 'Help', msg('Help'), () => a.help('docs')),
    cmd('help.whatsNew', 'Help', msg("Learn What's New"), () => a.help('whatsNew')),
    cmd('help.updates', 'Help', msg('Check for Updates'), () => a.help('updates')),
    // The desktop app is already installed.
    ...(desktop() ? [] : [cmd('help.install', 'Help', msg('Install App…'), a.install)]),
    cmd('help.support', 'Help', msg('Technical Support'), () => a.help('support')),
    cmd('help.suggest', 'Help', msg('Make a Suggestion'), () => a.help('suggest')),
    cmd('help.sponsor', 'Help', msg('Sponsor'), () => a.help('sponsor')),
    cmd('help.community', 'Help', msg('redcolumn Community'), () => a.help('community')),
    cmd('help.logs', 'Help', msg('Send Log Files'), () => a.help('logs')),
    ...model3dCommands(a.model3d, s.model3d ?? null),
  ].map(applyCommandPolicy);
}
