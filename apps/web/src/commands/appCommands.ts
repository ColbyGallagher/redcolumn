import { BATCH_LABELS, type BatchKind } from '../components/BatchDialog';
import type { Settings } from '../settings/settings';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import { MARKUP_TOOLS, MEASURE_TOOLS } from '../components/ToolBar';

export type CommandCategory = 'File' | 'Edit' | 'View' | 'Document' | 'Batch' | 'Tools' | 'Window' | 'Help';

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
  saveAll: () => void;
  revert: () => void;
  publish: (mode: 'pdf' | 'images') => void;
  share: () => void;
  markupsXfdf: (dir: 'export' | 'import') => void;
  importMarkupsFromPdf: () => void;
  save: () => void;
  saveAs: () => void;
  exportCsv: () => void;
  exportSummary: () => void;
  print: () => void;
  preferences: () => void;
  manageProfiles: () => void;
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
  showHidden: () => void;
  selectAll: () => void;
  formatPainter: () => void;
  offset: () => void;
  group: () => void;
  ungroup: () => void;
  lock: (locked: boolean) => void;
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
  rotatePages: () => void;
  insertPages: () => void;
  insertBlank: () => void;
  extractPages: () => void;
  pageTool: (kind: 'split' | 'replace' | 'crop' | 'setup') => void;
  headerFooter: (mode: 'headerFooter' | 'number') => void;
  process: (kind: 'flatten' | 'reduce' | 'colour') => void;
  unflatten: () => void;
  repair: () => void;
  applyRedactions: () => void;
  showPanel: (tab: 'forms') => void;
  sign: () => void;
  digitalIds: () => void;
  ocr: () => void;
  compare: () => void;
  security: () => void;
  archivePdfA: () => void;
  autoFields: () => void;
  batch: (kind: BatchKind) => void;
  slipSheet: () => void;
  revisions: () => void;
  overlay: () => void;
  deletePages: () => void;
  labelRegions: () => void;
  scaleRegions: () => void;
  thumbnails: () => void;
  setTool: (tool: Tool) => void;
  manageColumns: () => void;
  signatures: () => void;
  toggleToolbar: () => void;
  toggleLeft: () => void;
  toggleBottom: () => void;
  commandPalette: () => void;
  install: () => void;
  help: (what: 'docs' | 'whatsNew' | 'logs' | 'suggest' | 'support' | 'community' | 'updates') => void;
  manageStamps: () => void;
}

/** The state commands depend on. */
export interface CommandState {
  hasDocument: boolean;
  /** The document can take markup edits (it is open and not read-only). */
  editable: boolean;
  /** Pages can be changed now (open, not busy, not a shared Studio document). */
  pagesEditable: boolean;
  pageCount: number;
  pageIndex: number;
  /** Documents in the library, for commands that work across files. */
  libraryCount: number;
  /** Library documents marked as templates. */
  templateCount: number;
  /** Copies may be saved (downloaded, exported, printed); a Studio host can forbid it for attendees. */
  canSaveCopy: boolean;
  selectionCount: number;
  /** Markups in the document that are hidden. */
  hiddenCount: number;
  selectionLocked: boolean;
  selectionGrouped: boolean;
  /** The one selected markup can be offset (a line, path or closed shape). */
  selectionOffsettable: boolean;
  canPaste: boolean;
  canGoBack: boolean;
  /** The active document has changes that can be undone (Revert). */
  canUndo: boolean;
  canGoForward: boolean;
  split: boolean;
  splitHorizontal: boolean;
  sync: 'document' | 'page' | null;
  /** Pages per row and whether the first page sits alone. */
  columns: 1 | 2;
  cover: boolean;
  magnifier: boolean;
  fullScreen: boolean;
  continuous: boolean;
  stitched: boolean;
  canStitch: boolean;
  showLinks: boolean;
  snap: boolean;
  showToolbar: boolean;
  showLeft: boolean;
  showBottom: boolean;
  tool: Tool;
  settings: Settings;
}

/** Every command, in menu order within each category. */
export function buildCommands(a: CommandActions, s: CommandState): Command[] {
  const doc = s.hasDocument;
  const sel = s.selectionCount > 0;
  const cmd = (id: string, category: CommandCategory, label: string, run: () => void, enabled = true, checked?: boolean): Command => ({
    id,
    category,
    label,
    run,
    enabled,
    ...(checked === undefined ? {} : { checked }),
  });
  const toggle = (key: 'showGrid' | 'snapToGrid' | 'snapToMarkup' | 'showRulers' | 'crosshair') => () => a.setSettings({ [key]: !s.settings[key] });
  const tools = [...MARKUP_TOOLS, ...MEASURE_TOOLS].map(({ tool }) => cmd(`tool.${tool}`, 'Tools', toolLabel(tool), () => a.setTool(tool), doc && (tool === 'select' || tool === 'lasso' || tool === 'snapshot' || s.editable), s.tool === tool));

  return [
    cmd('file.newPdf', 'File', 'New PDF…', a.newPdf),
    cmd('file.fromCamera', 'File', 'From Camera…', a.fromCamera),
    cmd('file.newFromTemplate', 'File', 'New PDF from Template…', a.newFromTemplate, s.templateCount > 0),
    cmd('file.open', 'File', 'Open…', a.open),
    cmd('file.combine', 'File', 'Combine…', a.combine),
    cmd('file.close', 'File', 'Close', a.close, doc),
    cmd('file.closeAll', 'File', 'Close All', a.closeAll, doc),
    cmd('file.save', 'File', 'Save', a.save, doc && s.canSaveCopy),
    cmd('file.saveAs', 'File', 'Save As…', a.saveAs, doc && s.canSaveCopy),
    cmd('file.saveAll', 'File', 'Save All', a.saveAll, doc && s.canSaveCopy),
    cmd('file.revert', 'File', 'Revert', a.revert, s.editable && s.canUndo),
    cmd('file.publish', 'File', 'Publish…', () => a.publish('pdf'), doc && s.canSaveCopy),
    cmd('file.share', 'File', 'Share / Email…', a.share, doc && s.canSaveCopy),
    cmd('file.exportImages', 'File', 'Page Images…', () => a.publish('images'), doc && s.canSaveCopy),
    cmd('file.exportXfdf', 'File', 'Markups as XFDF…', () => a.markupsXfdf('export'), doc && s.canSaveCopy),
    cmd('file.importXfdf', 'File', 'Import Markups from XFDF…', () => a.markupsXfdf('import'), s.editable),
    cmd('file.importPdfMarkups', 'File', 'Import Markups from PDF…', a.importMarkupsFromPdf, s.editable),
    cmd('file.exportCsv', 'File', 'Export Markups CSV', a.exportCsv, doc && s.canSaveCopy),
    cmd('file.exportSummary', 'File', 'Markup Summary…', a.exportSummary, doc && s.canSaveCopy),
    cmd('file.print', 'File', 'Print…', a.print, doc && s.canSaveCopy),
    cmd('file.preferences', 'File', 'Preferences…', a.preferences),
    cmd('file.manageProfiles', 'File', 'Manage Profiles…', a.manageProfiles),
    cmd('file.shortcuts', 'File', 'Keyboard Shortcuts…', a.shortcuts),
    cmd('file.about', 'File', 'About redcolumn', a.about),

    cmd('edit.undo', 'Edit', 'Undo', a.undo, doc),
    cmd('edit.redo', 'Edit', 'Redo', a.redo, doc),
    cmd('edit.undoHistory', 'Edit', 'Undo History…', a.undoHistory, doc),
    cmd('edit.cut', 'Edit', 'Cut', a.cut, sel && s.editable),
    cmd('edit.copy', 'Edit', 'Copy', a.copy, sel),
    cmd('edit.paste', 'Edit', 'Paste', a.paste, s.editable && s.canPaste),
    cmd('edit.pasteInPlace', 'Edit', 'Paste in Place', a.pasteInPlace, s.editable && s.canPaste),
    cmd('edit.offset', 'Edit', 'Offset', a.offset, s.selectionOffsettable && s.editable, s.tool === 'offset'),
    cmd('edit.multiply', 'Edit', 'Multiply…', a.multiply, sel && s.editable),
    cmd('edit.delete', 'Edit', 'Delete', a.deleteSelection, sel && s.editable),
    cmd('edit.hide', 'Edit', 'Hide', a.hideSelection, sel && s.editable),
    cmd('edit.showHidden', 'Edit', 'Show Hidden Markups', a.showHidden, s.hiddenCount > 0 && s.editable),
    cmd('edit.selectAll', 'Edit', 'Select All', a.selectAll, doc),
    cmd('edit.formatPainter', 'Edit', 'Format Painter', a.formatPainter, s.selectionCount === 1 && s.editable, s.tool === 'painter'),
    cmd('edit.group', 'Edit', 'Group', a.group, s.selectionCount > 1 && s.editable),
    cmd('edit.ungroup', 'Edit', 'Ungroup', a.ungroup, s.selectionGrouped && s.editable),
    cmd('edit.lock', 'Edit', s.selectionLocked ? 'Unlock' : 'Lock', () => a.lock(!s.selectionLocked), sel && s.editable, s.selectionLocked),
    cmd('edit.find', 'Edit', 'Find Text', a.find, doc),
    cmd('edit.checkSpelling', 'Edit', 'Check Spelling…', a.checkSpelling, doc),

    cmd('view.fitPage', 'View', 'Fit Page', a.fit, doc),
    cmd('view.fitWidth', 'View', 'Fit Width', a.fitWidth, doc),
    cmd('view.actualSize', 'View', 'Actual Size', a.actualSize, doc),
    cmd('view.zoomIn', 'View', 'Zoom In', a.zoomIn, doc),
    cmd('view.zoomOut', 'View', 'Zoom Out', a.zoomOut, doc),
    cmd('view.singlePage', 'View', 'Single Page', () => (s.columns === 2 ? a.spread(1, s.cover, false) : a.singlePage()), doc, doc && !s.continuous && !s.stitched && s.columns === 1),
    cmd('view.continuous', 'View', 'Continuous Pages', () => (s.columns === 2 ? a.spread(1, s.cover, true) : a.continuous()), doc, s.continuous && s.columns === 1),
    cmd('view.sideBySide', 'View', 'Side-by-Side', () => a.spread(2, s.cover, false), doc, doc && !s.continuous && !s.stitched && s.columns === 2),
    cmd('view.continuousSideBySide', 'View', 'Continuous Side-by-Side', () => a.spread(2, s.cover, true), doc, s.continuous && s.columns === 2),
    cmd('view.coverPage', 'View', 'Show Cover Page in Side-by-Side', () => a.spread(s.columns, !s.cover, s.continuous), doc, s.cover),
    cmd('view.rotateClockwise', 'View', 'Rotate View Clockwise', () => a.rotateView(1), doc),
    cmd('view.rotateCounterclockwise', 'View', 'Rotate View Counterclockwise', () => a.rotateView(-1), doc),
    cmd('view.split', 'View', 'Split Vertical', s.split && !s.splitHorizontal ? a.unsplit : a.split, doc, s.split && !s.splitHorizontal),
    cmd('view.splitHorizontal', 'View', 'Split Horizontal', s.split && s.splitHorizontal ? a.unsplit : a.splitHorizontal, doc, s.split && s.splitHorizontal),
    cmd('view.syncDocument', 'View', 'Synchronise Document', () => a.sync(s.sync === 'document' ? null : 'document'), s.split, s.sync === 'document'),
    cmd('view.syncPage', 'View', 'Synchronise Page', () => a.sync(s.sync === 'page' ? null : 'page'), s.split, s.sync === 'page'),
    cmd('view.switchPanes', 'View', 'Switch Split Panes', a.switchPanes, s.split),
    cmd('view.balance', 'View', 'Balance Split', a.balance, s.split),
    cmd('view.unsplit', 'View', 'Unsplit', a.unsplit, s.split),
    cmd('view.stitched', 'View', 'Stitched View', a.stitch, s.canStitch || s.stitched, s.stitched),
    cmd('view.rulers', 'View', 'Rulers', toggle('showRulers'), true, s.settings.showRulers),
    cmd('view.crosshair', 'View', 'Full-Screen Crosshair', toggle('crosshair'), true, s.settings.crosshair),
    cmd('view.grid', 'View', 'Show Grid', toggle('showGrid'), true, s.settings.showGrid),
    cmd('view.snapGrid', 'View', 'Snap to Grid', toggle('snapToGrid'), true, s.settings.snapToGrid),
    cmd('view.snapContent', 'View', 'Snap to Content', () => a.snapContent(!s.snap), true, s.snap),
    cmd('view.snapMarkup', 'View', 'Snap to Markup', toggle('snapToMarkup'), true, s.settings.snapToMarkup),
    cmd('view.showLinks', 'View', 'Show Links', () => a.showLinks(!s.showLinks), doc, s.showLinks),
    cmd('view.darkPages', 'View', 'Dark Mode (Pages)', () => a.setSettings({ pageFilter: s.settings.pageFilter === 'dark' ? 'none' : 'dark' }), true, s.settings.pageFilter === 'dark'),
    cmd('view.dimmer', 'View', 'Dimmer', () => a.setSettings({ pageFilter: s.settings.pageFilter === 'dim' ? 'none' : 'dim' }), true, s.settings.pageFilter === 'dim'),
    cmd('view.thinLines', 'View', 'Disable Line Weights', () => a.setSettings({ thinLines: !s.settings.thinLines }), true, s.settings.thinLines),
    cmd('view.magnifier', 'View', 'Magnifier', a.magnifier, doc, s.magnifier),
    cmd('view.fullScreen', 'View', 'Full Screen', a.fullScreen, doc, s.fullScreen),
    cmd('view.replyIndicators', 'View', 'Always Show Reply Indicators', () => a.setSettings({ replyIndicators: !s.settings.replyIndicators }), true, s.settings.replyIndicators),
    cmd('view.reuse', 'View', 'Reuse Tool', () => a.setSettings({ reuseTool: !s.settings.reuseTool }), true, s.settings.reuseTool),
    cmd('tool.pan', 'Tools', 'Pan', () => a.setTool('pan'), doc, s.tool === 'pan'),
    cmd('tool.zoomBox', 'Tools', 'Zoom', () => a.setTool('zoomBox'), doc, s.tool === 'zoomBox'),
    cmd('tool.dynamicZoom', 'Tools', 'Dynamic Zoom', () => a.setTool('dynamicZoom'), doc, s.tool === 'dynamicZoom'),
    cmd('view.back', 'View', 'Previous View', a.back, s.canGoBack),
    cmd('view.forward', 'View', 'Next View', a.forward, s.canGoForward),
    cmd('view.nextPage', 'View', 'Next Page', () => a.goToPage('next'), doc && s.pageIndex < s.pageCount - 1),
    cmd('view.prevPage', 'View', 'Previous Page', () => a.goToPage('prev'), doc && s.pageIndex > 0),
    cmd('view.firstPage', 'View', 'First Page', () => a.goToPage('first'), doc && s.pageIndex > 0),
    cmd('view.lastPage', 'View', 'Last Page', () => a.goToPage('last'), doc && s.pageIndex < s.pageCount - 1),

    cmd('document.properties', 'Document', 'Document Properties…', a.documentProperties, doc),
    cmd('document.rotatePages', 'Document', 'Rotate Pages', a.rotatePages, s.pagesEditable),
    cmd('document.insertPages', 'Document', 'Insert Pages from PDF…', a.insertPages, s.pagesEditable),
    cmd('document.insertBlank', 'Document', 'Insert Blank Pages…', a.insertBlank, s.pagesEditable),
    cmd('document.extractPages', 'Document', 'Extract Pages…', a.extractPages, s.pagesEditable && s.canSaveCopy),
    cmd('document.deletePages', 'Document', 'Delete Pages…', a.deletePages, s.pagesEditable && s.pageCount > 1),
    cmd('document.splitDocument', 'Document', 'Split Document…', () => a.pageTool('split'), doc && s.pageCount > 1 && s.canSaveCopy),
    cmd('document.replacePages', 'Document', 'Replace Pages…', () => a.pageTool('replace'), s.pagesEditable),
    cmd('document.cropPages', 'Document', 'Crop Pages…', () => a.pageTool('crop'), s.pagesEditable),
    cmd('document.pageSetup', 'Document', 'Page Setup…', () => a.pageTool('setup'), s.pagesEditable),
    cmd('document.headerFooter', 'Document', 'Headers & Footers…', () => a.headerFooter('headerFooter'), s.pagesEditable),
    cmd('document.numberPages', 'Document', 'Number Pages…', () => a.headerFooter('number'), s.pagesEditable),
    cmd('document.flatten', 'Document', 'Flatten…', () => a.process('flatten'), s.pagesEditable && s.editable),
    cmd('document.unflatten', 'Document', 'Unflatten', a.unflatten, s.pagesEditable && s.editable),
    cmd('document.reduceSize', 'Document', 'Reduce File Size…', () => a.process('reduce'), s.pagesEditable),
    cmd('document.repair', 'Document', 'Repair PDF', a.repair, s.pagesEditable),
    cmd('document.colour', 'Document', 'Colour Processing…', () => a.process('colour'), s.pagesEditable),
    cmd('document.ocr', 'Document', 'OCR…', a.ocr, s.pagesEditable),
    cmd('document.slipSheet', 'Document', 'Slip Sheet…', a.slipSheet, s.pagesEditable),
    cmd('document.revisions', 'Document', 'Revisions…', a.revisions, doc),
    ...(Object.keys(BATCH_LABELS) as BatchKind[]).map((k) => cmd(`batch.${k}`, 'Batch', `${BATCH_LABELS[k]}…`, () => a.batch(k), s.libraryCount > 0)),
    cmd('document.security', 'Document', 'Security…', a.security, doc && s.canSaveCopy),
    cmd('document.pdfa', 'Document', 'Archive as PDF/A…', a.archivePdfA, doc && s.canSaveCopy),
    cmd('document.compare', 'Document', 'Compare Documents…', a.compare, s.libraryCount > 1),
    cmd('document.overlay', 'Document', 'Overlay Pages…', a.overlay, s.libraryCount > 1),
    cmd('document.labelRegions', 'Document', 'Page Labels from Region…', a.labelRegions, s.pagesEditable),
    cmd('document.scaleRegions', 'Document', 'Bulk Apply Page Scale…', a.scaleRegions, s.pagesEditable),
    cmd('document.thumbnails', 'Document', 'Edit Page Labels in Thumbnails', a.thumbnails, doc),

    ...tools,
    cmd('tools.sound', 'Tools', 'Sound…', a.sound, s.editable),
    cmd('tools.eraserSmall', 'Tools', 'Eraser Size: Small', () => a.setSettings({ eraserSize: 'small' }), true, s.settings.eraserSize === 'small'),
    cmd('tools.eraserMedium', 'Tools', 'Eraser Size: Medium', () => a.setSettings({ eraserSize: 'medium' }), true, s.settings.eraserSize === 'medium'),
    cmd('tools.eraserLarge', 'Tools', 'Eraser Size: Large', () => a.setSettings({ eraserSize: 'large' }), true, s.settings.eraserSize === 'large'),
    cmd('tools.eraserWhole', 'Tools', 'Annotation Eraser (Whole Markups)', () => a.setSettings({ eraserWhole: !s.settings.eraserWhole }), true, s.settings.eraserWhole),
    cmd('tools.sketchToScale', 'Tools', 'Draw to Scale', () => a.setSettings({ sketchToScale: !s.settings.sketchToScale }), doc, s.settings.sketchToScale),
    cmd('tools.stamps', 'Tools', 'Manage Stamps…', a.manageStamps, doc),
    cmd('tools.applyRedactions', 'Tools', 'Apply Redactions…', a.applyRedactions, s.pagesEditable && s.editable),
    cmd('tools.sign', 'Tools', 'Sign with Digital ID…', a.sign, s.pagesEditable),
    cmd('tools.digitalIds', 'Tools', 'Digital IDs…', a.digitalIds),
    cmd('tools.formField', 'Tools', 'Form Field', () => a.setTool('formField'), s.pagesEditable, s.tool === 'formField'),
    cmd('tools.forms', 'Tools', 'Forms Panel', () => a.showPanel('forms'), doc),
    cmd('tools.autoFields', 'Tools', 'Auto-Create Fields…', a.autoFields, s.pagesEditable && s.editable),
    cmd('edit.eraseContent', 'Edit', 'Erase Content', () => a.setTool('eraseContent'), s.pagesEditable && s.editable, s.tool === 'eraseContent'),
    cmd('edit.cutContent', 'Edit', 'Cut Content', () => a.setTool('cutContent'), s.pagesEditable && s.editable && s.canSaveCopy, s.tool === 'cutContent'),
    cmd('edit.editText', 'Edit', 'Edit Text', () => a.setTool('editText'), s.pagesEditable && s.editable, s.tool === 'editText'),
    cmd('edit.selectText', 'Edit', 'Select Text', () => a.setTool('selectText'), doc, s.tool === 'selectText'),
    cmd('tools.columns', 'Tools', 'Markup Columns & Statuses…', a.manageColumns, doc),
    cmd('tools.sign', 'Tools', 'Sign…', a.signatures, doc),

    cmd('window.toolbar', 'Window', 'Tools Toolbar', a.toggleToolbar, true, s.showToolbar),
    cmd('window.leftPanel', 'Window', 'Left Panel', a.toggleLeft, true, s.showLeft),
    cmd('window.bottomPanel', 'Window', 'Bottom Panel', a.toggleBottom, true, s.showBottom),

    cmd('help.commands', 'Help', 'Find Tools + Commands…', a.commandPalette),
    cmd('help.docs', 'Help', 'Help', () => a.help('docs')),
    cmd('help.whatsNew', 'Help', "Learn What's New", () => a.help('whatsNew')),
    cmd('help.updates', 'Help', 'Check for Updates', () => a.help('updates')),
    cmd('help.install', 'Help', 'Install App…', a.install),
    cmd('help.support', 'Help', 'Technical Support', () => a.help('support')),
    cmd('help.suggest', 'Help', 'Make a Suggestion', () => a.help('suggest')),
    cmd('help.community', 'Help', 'redcolumn Community', () => a.help('community')),
    cmd('help.logs', 'Help', 'Send Log Files', () => a.help('logs')),
  ];
}
