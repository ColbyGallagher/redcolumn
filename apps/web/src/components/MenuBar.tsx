import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Command } from '../commands/appCommands';
import { shortcutLabel } from '../commands/shortcuts';
import { desktop, type UpdateState } from '../desktop/host';
import { isStandalone } from '../offline/install';
import type { Tool } from '../markup/MarkupTools';
import { MEASURE_TOOLS } from './ToolBar';
import { MenuSearch } from './MenuSearch';
import { createPortal } from 'react-dom';
import { MENUBAR_SLOT_ID, useSearchSlot } from './menubarSlot';
import { settings, useSettings } from '../settings/settings';
import type { PrefEntry } from './PreferencesDialog';

/**
 * Tools › Markup, in groups. Left out because the menus list them elsewhere: Stamp, File
 * Attachment, Hyperlink, Eraser, Redaction and Snapshot. Select and Lasso are not markups.
 */
const MARKUP_GROUPS: { label: string; tools: Tool[] }[] = [
  { label: 'Lines & Shapes', tools: ['line', 'arrow', 'dimension', 'polyline', 'arc', 'ellipticalArc', 'rect', 'ellipse', 'polygon', 'cloud', 'polygonCloud', 'cloudPlus'] },
  { label: 'Freehand', tools: ['pen', 'highlighter'] },
  { label: 'Text Markup', tools: ['textHighlight', 'underline', 'strikeout', 'squiggly', 'replaceText'] },
  { label: 'Text & Notes', tools: ['text', 'callout', 'typewriter', 'flagLabel', 'note'] },
  { label: 'Other', tools: ['image', 'legend', 'table', 'space'] },
];

export type LeftTab =
  | 'files'
  | 'pages'
  | 'bookmarks'
  | 'toolchest'
  | 'properties'
  | 'layers'
  | 'measurements'
  | 'spaces'
  | 'signatures'
  | 'flags'
  | 'stitching'
  | 'geospatial'
  | 'ai'
  | 'search'
  | 'forms'
  | 'sets'
  | 'sessions'
  | 'projects'
  | 'markups'
  | 'model3d'
  | 'model3dViews'
  | 'model3dSets'
  | 'model3dIssues'
  | 'model3dSheets'
  | 'model3dReview'
  | 'model3dProps'
  | 'model3dDisplay';
export type BottomTab = 'markups' | 'links';

export const LEFT_TITLES: Record<LeftTab, string> = {
  files: 'File Access',
  pages: 'Thumbnails',
  bookmarks: 'Bookmarks',
  toolchest: 'Tool Library',
  properties: 'Properties',
  layers: 'Layers',
  measurements: 'Measurements',
  spaces: 'Spaces',
  signatures: 'Signatures',
  flags: 'Flags',
  stitching: 'Stitching',
  geospatial: 'Geospatial',
  ai: 'Compare',
  search: 'Search',
  forms: 'Forms',
  sets: 'Sets',
  sessions: 'Sessions',
  projects: 'Projects',
  markups: 'Markups',
  model3d: 'Model Tree',
  model3dViews: 'Views',
  model3dSets: 'Sets & Appearance',
  model3dIssues: 'Issues',
  model3dSheets: 'Sheets',
  model3dReview: 'Takeoff & Compare',
  model3dProps: 'Properties',
  model3dDisplay: 'Display & Scene',
};

export interface RecentFile {
  id: string;
  name: string;
}

export interface MenuBarProps {
  /** Every command by id (see commands/appCommands.ts): labels, shortcuts, state and actions. */
  commands: ReadonlyMap<string, Command>;
  author: string;
  onAuthorChange: (value: string) => void;
  recents: RecentFile[];
  profiles: { id: string; name: string }[];
  activeProfileId: string;
  /** Side panels the active profile hides. */
  hiddenPanels: readonly string[];
  panels: { showLeft: boolean; showBottom: boolean; leftTab: LeftTab; bottomTab: BottomTab };
  /** The stamp library, for Tools › Stamp. */
  stamps: { id: string; name: string }[];
  /** The desktop app's update state; the header shows a button while a newer version exists. */
  update?: UpdateState | null;
  on: {
    /** The update button: opens the release page, or restarts into the downloaded version. */
    update?: () => void;
    placeStamp: (id: string) => void;
    openRecent: (id: string) => void;
    /** Takes every file off the Open Recent list (they stay on the device). */
    clearRecents?: () => void;
    switchProfile: (id: string) => void;
    showLeft: (tab: LeftTab) => void;
    showBottom: (tab: BottomTab) => void;
    /** The Install App button: opens the dialog that downloads the desktop app. */
    install: () => void;
    /** A preference picked in the search box: opens Preferences on its tab. */
    openSetting: (setting: PrefEntry) => void;
  };
}

type MenuId = 'file' | 'edit' | 'view' | 'document' | 'batch' | 'tools' | 'window' | 'help';

const MENUS: { id: MenuId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'document', label: 'Document' },
  { id: 'batch', label: 'Bulk' },
  { id: 'tools', label: 'Tools' },
  { id: 'window', label: 'Window' },
  { id: 'help', label: 'Help' },
];

function Item({
  label,
  shortcut,
  disabled,
  checked,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  onClick?: () => void;
}) {
  return (
    <button role="menuitem" className={`menu-item${checked ? ' checked' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="check">{checked ? '✓' : ''}</span>
      <span className="label">{label}</span>
      {shortcut && <span className="sc">{shortcut}</span>}
    </button>
  );
}

/** The Feedback dropdown's items: Help-menu commands, labelled for what the user is trying to do. */
const FEEDBACK_ITEMS: [string, string][] = [
  ['help.support', 'Report a Bug / Get Support'],
  ['help.suggest', 'Suggest a Feature'],
  ['help.sponsor', 'Sponsor redcolumn'],
];

function Sep() {
  return <div className="menu-sep" role="separator" />;
}

/** How long a flyout stays after the pointer leaves it, so a diagonal move to its items does not close it. */
const FLYOUT_CLOSE_DELAY = 400;
/** How long the pointer must rest on a submenu row before it replaces a sibling's open flyout. */
const SIBLING_OPEN_DELAY = 300;

/**
 * A submenu that pops out to the side, as in desktop menus. The flyout is fixed-positioned so the
 * scrolling menu it sits in does not clip it; it flips left or shifts up near the window's edges.
 */
function Submenu({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    const r = row.current?.getBoundingClientRect();
    if (r) setPos({ left: r.right - 2, top: r.top - 5 });
  };
  const openFly = () => {
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    // Another submenu in the same menu is open: the pointer may only be passing over this row on a
    // diagonal to that submenu's items, so wait to see if it stays before taking over.
    const sibling = !pos && row.current?.parentElement?.querySelector(':scope > .menu-sub > .menu-flyout');
    if (sibling) openTimer.current = setTimeout(show, SIBLING_OPEN_DELAY);
    else show();
  };
  const closeFly = () => {
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => {
      // A field in the flyout is being typed in (Edit › Author): it stays until focus leaves it.
      if (fly.current?.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
      setPos(null);
    }, FLYOUT_CLOSE_DELAY);
  };
  useEffect(
    () => () => {
      clearTimeout(closeTimer.current);
      clearTimeout(openTimer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    const el = fly.current;
    const r = row.current?.getBoundingClientRect();
    if (!el || !pos || !r) return;
    const f = el.getBoundingClientRect();
    const left = f.right > window.innerWidth - 4 ? Math.max(4, r.left - f.width + 2) : pos.left;
    const top = Math.max(4, Math.min(pos.top, window.innerHeight - f.height - 4));
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [pos]);
  return (
    <div className="menu-sub" ref={row} onMouseEnter={openFly} onMouseLeave={closeFly} onFocus={openFly} onBlur={closeFly}>
      <div className={`menu-item has-sub${pos ? ' open' : ''}`} tabIndex={-1}>
        <span className="check" />
        <span className="label">{label}</span>
        <span className="sc">▸</span>
      </div>
      {pos && (
        <div ref={fly} className="menu-flyout" role="menu" style={pos}>
          {children}
        </div>
      )}
    </div>
  );
}

/** What the header's update button says and does for each update state; null while there is nothing to show. */
export function updateButton(update: UpdateState | null | undefined): { label: string; title: string; busy: boolean } | null {
  if (!update) return null;
  const version = update.latest ? `redcolumn ${update.latest}` : 'A new version';
  if (update.status === 'available') return { label: update.latest ? `Update to ${update.latest}` : 'Update available', title: `${version} is available. Click to open the download page.`, busy: false };
  if (update.status === 'downloading') return { label: `Downloading update ${update.percent ?? 0}%`, title: `${version} is downloading in the background. It installs when you close redcolumn.`, busy: true };
  if (update.status === 'ready') return { label: 'Restart to update', title: `${version} is ready. Click to restart into it; it also installs when you close redcolumn.`, busy: false };
  return null;
}

/**
 * The top bar: the redcolumn mark opens one menu that holds the search box, every menu (File, Edit,
 * View… as flyouts), Autosave, updates and Install. The toolbar (ribbon tabs, or the simplified row)
 * fills the rest of the row.
 */
export function MenuBar({ commands, author, onAuthorChange, recents, profiles, activeProfileId, hiddenPanels, panels, stamps, update, on }: MenuBarProps) {
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const brand = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const installed = isStandalone();
  const updateBtn = updateButton(update);
  const autosave = useSettings().autosave;
  const commandList = useMemo(() => [...commands.values()], [commands]);
  const searchSlot = useSearchSlot();
  const search = <MenuSearch commands={commandList} onOpenSetting={on.openSetting} />;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!brand.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!feedbackOpen) return;
    const close = (e: MouseEvent) => {
      if (!feedback.current?.contains(e.target as Node)) setFeedbackOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFeedbackOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [feedbackOpen]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  /** A menu item for a command; `label` overrides the command's own name. */
  const Cmd = ({ id, label }: { id: string; label?: string }) => {
    const c = commands.get(id);
    if (!c) return <Item label={label ?? id} disabled />;
    // Removed by the organisation's policy (desktop/policy.ts).
    if (c.managed) return null;
    return <Item label={label ?? c.label} shortcut={shortcutLabel(id)} checked={c.checked} disabled={!c.enabled} onClick={run(c.run)} />;
  };

  const menu = (id: MenuId): ReactNode => {
    switch (id) {
      case 'file':
        return (
          <>
            <Cmd id="file.about" />
            <Cmd id="file.preferences" />
            <Submenu label="Profiles">
              {profiles.map((p) => (
                <Item key={p.id} label={p.name} checked={p.id === activeProfileId} onClick={run(() => on.switchProfile(p.id))} />
              ))}
              <Sep />
              <Cmd id="file.manageProfiles" />
            </Submenu>
            <Cmd id="file.shortcuts" />
            <Cmd id="file.migrateRevu" />
            <Sep />
            <Cmd id="file.newPdf" />
            <Cmd id="file.newFromTemplate" />
            <Cmd id="file.open" />
            <Submenu label="Open Recent">
              {recents.length === 0 ? (
                <Item label="No recent files" disabled />
              ) : (
                <>
                  {recents.map((f) => <Item key={f.id} label={f.name} onClick={run(() => on.openRecent(f.id))} />)}
                  {on.clearRecents && (
                    <>
                      <Sep />
                      <Item label="Clear Recent Files" onClick={run(() => on.clearRecents?.())} />
                    </>
                  )}
                </>
              )}
            </Submenu>
            <Submenu label="Create">
              <Cmd id="file.newPdf" label="Blank PDF…" />
              <Cmd id="file.fromCamera" />
            </Submenu>
            <Cmd id="file.combine" />
            <Sep />
            <Cmd id="file.close" />
            <Cmd id="file.closeAll" />
            <Cmd id="file.save" />
            <Cmd id="file.saveAs" />
            <Cmd id="file.saveAll" />
            <Cmd id="file.revert" />
            <Sep />
            <Cmd id="file.publish" />
            <Cmd id="file.share" />
            <Submenu label="Export">
              <Cmd id="file.save" label="PDF with markups" />
              <Cmd id="file.exportImages" />
              <Cmd id="file.exportCsv" label="Markups CSV" />
              <Cmd id="file.exportXlsx" label="Markups for Excel" />
              <Cmd id="file.exportRegister" label="Comment Register…" />
              <Cmd id="file.registerTemplates" />
              <Cmd id="file.exportXfdf" />
              <Cmd id="file.exportFdf" />
              <Cmd id="file.exportBax" />
              <Cmd id="file.exportSummary" />
            </Submenu>
            <Submenu label="Import">
              <Cmd id="file.importXfdf" label="Markups from XFDF…" />
              <Cmd id="file.importFdf" label="Markups from FDF…" />
              <Cmd id="file.importBax" label="Markups from Bluebeam BAX…" />
              <Cmd id="file.importPdfMarkups" label="Markups from Another PDF…" />
              <Cmd id="file.importXlsx" label="Markups from Excel…" />
            </Submenu>
            <Cmd id="file.print" />
          </>
        );
      case 'edit':
        return (
          <>
            <Cmd id="edit.undo" />
            <Cmd id="edit.redo" />
            <Cmd id="edit.undoHistory" />
            <Sep />
            <Cmd id="edit.cut" />
            <Cmd id="edit.copy" />
            <Cmd id="edit.paste" />
            <Cmd id="edit.pasteInPlace" />
            <Cmd id="edit.offset" />
            <Cmd id="edit.multiply" />
            <Submenu label="Modify">
              <Cmd id="edit.move" />
              <Cmd id="edit.copyBase" />
              <Cmd id="edit.offset" />
              <Cmd id="edit.trim" />
              <Cmd id="edit.extend" />
              <Cmd id="edit.break" />
              <Cmd id="edit.lengthen" />
              <Cmd id="edit.fillet" />
              <Cmd id="edit.chamfer" />
              <Cmd id="edit.join" />
              <Cmd id="edit.explode" />
              <Cmd id="edit.reverse" />
              <Cmd id="edit.toCloud" />
              <Sep />
              <Cmd id="edit.mirror" />
              <Cmd id="edit.rotate" />
              <Cmd id="edit.scale" />
              <Cmd id="edit.alignPoints" />
              <Cmd id="edit.stretch" />
              <Cmd id="edit.scaleToLength" />
              <Cmd id="edit.createViewport" />
              <Sep />
              <Cmd id="edit.cropImage" />
              <Cmd id="edit.resetCrop" />
              <Cmd id="edit.adjustImage" />
              <Cmd id="edit.pictureColours" />
              <Sep />
              <Cmd id="edit.arrayPolar" />
              <Cmd id="edit.arrayPath" />
              <Cmd id="edit.divide" />
            </Submenu>
            <Cmd id="edit.hide" />
            <Cmd id="edit.showHidden" />
            <Cmd id="edit.delete" />
            <Sep />
            <Cmd id="tool.pan" />
            <Cmd id="tool.select" label="Select" />
            <Cmd id="edit.selectAll" />
            <Cmd id="edit.selectSimilar" />
            <Cmd id="tool.lasso" />
            <Cmd id="tool.snapshot" />
            <Cmd id="edit.formatPainter" />
            <Cmd id="edit.scaleToLength" />
            <Cmd id="edit.createViewport" />
            <Cmd id="edit.group" />
            <Cmd id="edit.ungroup" />
            <Cmd id="edit.lock" />
            <Cmd id="edit.find" />
            <Submenu label="PDF Content">
              <Cmd id="edit.selectText" />
              <Cmd id="edit.eraseContent" />
              <Cmd id="tools.bulkRedact" />
              <Cmd id="edit.cutContent" />
              <Cmd id="edit.editText" />
            </Submenu>
            <Cmd id="edit.checkSpelling" />
            <Sep />
            <label className="menu-field" title="Name recorded on your markups">
              Author
              <input value={author} onChange={(e) => onAuthorChange(e.target.value)} onClick={(e) => e.stopPropagation()} />
            </label>
          </>
        );
      case 'view':
        return (
          <>
            <Cmd id="view.fitPage" />
            <Cmd id="view.fitWidth" />
            <Cmd id="view.actualSize" />
            <Cmd id="view.zoomIn" />
            <Cmd id="view.zoomOut" />
            <Sep />
            <Cmd id="view.singlePage" />
            <Cmd id="view.continuous" />
            <Cmd id="view.sideBySide" />
            <Cmd id="view.continuousSideBySide" />
            <Cmd id="view.coverPage" />
            <Submenu label="Rotate View">
              <Cmd id="view.rotateClockwise" label="Clockwise" />
              <Cmd id="view.rotateCounterclockwise" label="Counterclockwise" />
            </Submenu>
            <Sep />
            <Cmd id="view.split" />
            <Cmd id="view.splitHorizontal" />
            <Cmd id="view.switchPanes" label="Switch" />
            <Cmd id="view.balance" label="Balance" />
            <Cmd id="view.unsplit" />
            <Cmd id="view.stitched" />
            <Cmd id="view.syncDocument" />
            <Cmd id="view.syncPage" />
            <Sep />
            <Cmd id="view.rulers" />
            <Cmd id="view.crosshair" />
            <Cmd id="view.grid" />
            <Cmd id="view.snapGrid" />
            <Cmd id="view.snapContent" />
            <Cmd id="view.snapMarkup" />
            <Cmd id="view.polarTracking" />
            <Cmd id="view.objectSnapTracking" />
            <Cmd id="view.showLinks" />
            <Cmd id="document.teachMark" />
            <Sep />
            <Cmd id="view.darkPages" />
            <Cmd id="view.dimmer" />
            <Cmd id="view.replyIndicators" />
            <Cmd id="view.thinLines" />
            <Cmd id="view.keepView" />
            <Cmd id="view.magnifier" />
            <Cmd id="view.fullScreen" />
            <Submenu label="Navigation Tools">
              <Cmd id="tool.pan" />
              <Cmd id="tool.zoomBox" />
              <Cmd id="tool.dynamicZoom" />
            </Submenu>
            <Sep />
            <Cmd id="view.back" label="Back" />
            <Cmd id="view.forward" label="Forward" />
          </>
        );
      case 'document':
        return (
          <>
            <Cmd id="document.properties" />
            <Cmd id="document.addBookmark" />
            <Cmd id="document.pageSetup" />
            <Cmd id="document.rotatePages" label="Rotate Pages…" />
            <Cmd id="document.rotateCounterclockwise" label="Rotate Counterclockwise" />
            <Submenu label="Insert">
              <Cmd id="document.insertPages" label="Pages from PDF…" />
              <Cmd id="document.bulkInsertPages" label="Bulk Insert PDFs…" />
              <Cmd id="document.insertBlank" label="Blank Pages…" />
            </Submenu>
            <Cmd id="document.extractPages" />
            <Cmd id="document.splitDocument" />
            <Cmd id="document.replacePages" />
            <Cmd id="document.deletePages" />
            <Cmd id="document.cropPages" />
            <Cmd id="document.numberPages" />
            <Submenu label="Page Labels">
              <Cmd id="document.labelRegions" label="From Page Region…" />
              <Cmd id="document.thumbnails" label="Edit in Thumbnails…" />
            </Submenu>
            <Cmd id="document.scaleRegions" label="Bulk Apply Page Scale…" />
            <Cmd id="document.scaleReview" />
            <Cmd id="document.drawingStandards" />
            <Cmd id="document.headerFooter" />
            <Cmd id="tools.bulkRedact" />
            <Cmd id="document.security" />
            <Sep />
            <Cmd id="document.compare" />
            <Cmd id="document.semanticCompare" />
            <Cmd id="document.overlay" />
            <Cmd id="document.slipSheet" />
            <Cmd id="document.revisions" />
            <Cmd id="document.closeOut" />
            <Cmd id="document.stitching" />
            <Cmd id="document.geospatial" />
            <Cmd id="document.stitchToPage" />
            <Cmd id="document.applyStitching" />
            <Cmd id="document.convertDrawingAgain" />
            <Cmd id="document.ocr" />
            <Cmd id="document.colour" />
            <Sep />
            <Cmd id="document.reduceSize" />
            <Cmd id="document.repair" />
            <Cmd id="document.pdfa" />
            <Cmd id="document.flatten" />
            <Cmd id="document.unflatten" />
          </>
        );
      case 'batch':
        return (
          <>
            <Cmd id="file.combine" label="Combine PDFs…" />
            <Cmd id="document.slipSheet" />
            <Cmd id="batch.link" />
            <Cmd id="document.compare" />
            <Cmd id="document.overlay" />
            <Sep />
            <Cmd id="batch.flatten" />
            <Cmd id="batch.unflatten" />
            <Cmd id="batch.ocr" />
            <Cmd id="batch.reduce" />
            <Cmd id="batch.repair" />
            <Cmd id="batch.colour" />
            <Cmd id="batch.headerFooter" />
            <Cmd id="batch.removeHeaderFooter" />
            <Cmd id="tools.bulkRedact" />
            <Cmd id="batch.stamp" />
            <Sep />
            <Cmd id="batch.crop" />
            <Cmd id="batch.pageSetup" />
            <Cmd id="batch.split" />
            <Cmd id="batch.pageLabels" />
            <Sep />
            <Cmd id="batch.sign" />
            <Sep />
            <Cmd id="batch.summary" />
            <Cmd id="batch.print" />
          </>
        );
      case 'tools':
        return (
          <>
            <Submenu label="Markup">
              {MARKUP_GROUPS.map((group) => (
                <Submenu key={group.label} label={group.label}>
                  {group.tools.map((tool) => (
                    <Cmd key={tool} id={`tool.${tool}`} />
                  ))}
                </Submenu>
              ))}
            </Submenu>
            <Submenu label="Stamp">
              {stamps.map((s) => (
                <Item key={s.id} label={s.name} disabled={!commands.get('tool.stamp')?.enabled} onClick={run(() => on.placeStamp(s.id))} />
              ))}
              <Sep />
              <Cmd id="tools.stamps" />
            </Submenu>
            <Submenu label="Measure">
              {MEASURE_TOOLS.map(({ tool }) => (
                <Cmd key={tool} id={`tool.${tool}`} />
              ))}
            </Submenu>
            <Submenu label="Takeoff">
              <Cmd id="tools.assemblies" />
              <Cmd id="tools.quantities" />
              <Cmd id="tools.takeoffReview" />
              <Cmd id="takeoff.items" />
              <Cmd id="takeoff.productLists" />
              <Cmd id="takeoff.templates" />
              <Cmd id="takeoff.saveTemplate" />
              <Cmd id="tools.library" />
              <Cmd id="tool.cutout" />
              <Cmd id="takeoff.manual" />
              <Cmd id="takeoff.reports" />
              <Cmd id="takeoff.syncExcel" />
              <Cmd id="takeoff.definePortal" />
              <Cmd id="takeoff.portals" />
              <Cmd id="takeoff.breakPortalLink" />
              <Cmd id="takeoff.hip" />
              <Cmd id="takeoff.valley" />
            </Submenu>
            <Cmd id="tools.lineStyles" />
            <Cmd id="tools.sketchToScale" />
            <Cmd id="tools.scripts" />
            <Submenu label="Sign & Certify">
              <Cmd id="tools.sign" />
              <Cmd id="tools.digitalIds" />
            </Submenu>
            <Submenu label="Markups List">
              <Cmd id="tools.columns" label="Columns & Statuses…" />
              <Cmd id="file.exportSummary" label="Summary…" />
            </Submenu>
            <Submenu label="Form">
              <Cmd id="tools.formField" label="Draw Field" />
              <Cmd id="tools.autoFields" />
              <Cmd id="tools.forms" label="Forms Panel" />
            </Submenu>
            <Submenu label="Redaction">
              <Cmd id="tool.redaction" label="Mark for Redaction" />
              <Cmd id="tools.applyRedactions" />
              <Cmd id="tools.bulkRedact" />
            </Submenu>
            <Cmd id="tool.hyperlink" />
            <Cmd id="tool.attachment" />
            <Cmd id="tools.sound" />
            <Cmd id="tools.video" />
            <Submenu label="Eraser">
              <Cmd id="tool.eraser" label="Eraser" />
              <Cmd id="tools.eraserSmall" label="Small" />
              <Cmd id="tools.eraserMedium" label="Medium" />
              <Cmd id="tools.eraserLarge" label="Large" />
              <Cmd id="tools.eraserWhole" />
            </Submenu>
            <Submenu label="Toolbars">
              <Cmd id="window.toolbar" />
              <Sep />
              <Cmd id="window.ribbon" />
              <Cmd id="window.ribbonTabs" />
              <Cmd id="window.simplifiedToolbar" />
            </Submenu>
            <Cmd id="view.reuse" label="Reuse" />
          </>
        );
      case 'window':
        return (
          <>
            <Cmd id="window.toolbar" />
            <Submenu label="Toolbar Display">
              <Cmd id="window.ribbon" label="Ribbon: Tabs and Commands" />
              <Cmd id="window.ribbonTabs" label="Ribbon: Tabs Only" />
              <Cmd id="window.simplifiedToolbar" />
              <Sep />
              <Cmd id="window.collapseRibbon" />
            </Submenu>
            <Cmd id="window.leftPanel" />
            <Cmd id="window.rightPanel" />
            <Cmd id="window.bottomPanel" />
            <Cmd id="window.panels" />
            <Cmd id="window.resetLayout" />
            <Sep />
            <Submenu label="Panels">
              <Cmd id="window.files" />
              {commands.get('window.model3d')?.enabled ? (
                <>
                  <Sep />
                  <Cmd id="window.model3d" />
                  <Cmd id="window.model3dViews" />
                  <Cmd id="window.model3dSets" />
                  <Cmd id="window.model3dIssues" />
                  <Cmd id="window.model3dSheets" />
                  <Cmd id="window.model3dReview" />
                  <Sep />
                  <Cmd id="window.model3dProps" />
                  <Cmd id="window.model3dDisplay" />
                </>
              ) : (
                <>
                  <Cmd id="window.pages" />
                  <Cmd id="window.bookmarks" />
                  <Cmd id="window.toolchest" />
                  <Cmd id="window.properties" />
                  <Cmd id="window.layers" />
                  <Cmd id="window.measurements" />
                  <Cmd id="window.spaces" />
                  <Cmd id="window.signatures" />
                  <Cmd id="window.search" />
                  <Cmd id="window.forms" />
                  <Cmd id="window.sets" />
                  <Cmd id="window.sessions" />
                  <Cmd id="window.markups" />
                  <Cmd id="window.links" />
                </>
              )}
            </Submenu>
          </>
        );
      case 'help':
        return (
          <>
            <Cmd id="help.commands" />
            <Cmd id="help.docs" />
            <Cmd id="help.community" />
            <Cmd id="help.updates" />
            {!desktop() && <Cmd id="help.install" />}
            <Cmd id="help.support" />
            <Cmd id="help.suggest" />
            <Cmd id="help.sponsor" />
            <Cmd id="help.logs" />
            <Sep />
            <Cmd id="help.whatsNew" />
            <Cmd id="file.shortcuts" label="Keyboard Shortcuts Guide" />
          </>
        );
    }
  };

  return (
    <div className="menubar" role="menubar">
      <div className={`menu brand-menu${open ? ' open' : ''}`} ref={brand}>
        <button
          type="button"
          className="brand-mark"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="redcolumn menu"
          title={updateBtn ? `redcolumn menu: ${updateBtn.label}` : 'redcolumn menu: File, Edit, View, search and more'}
          onClick={() => setOpen(!open)}
        >
          <img className="brand-col" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" draggable={false} />
          <span className="brand-word">
            <b>red</b>column
          </span>
          <span className="brand-caret" aria-hidden="true">
            ▾
          </span>
          {updateBtn && !updateBtn.busy && <span className="brand-badge" aria-hidden="true" />}
        </button>
        {open && (
          <div className="menu-drop brand-drop" role="menu">
            {MENUS.map(({ id, label }) => (
              <Submenu key={id} label={label}>
                {menu(id)}
              </Submenu>
            ))}
            <Sep />
            <Item
              label="Autosave"
              checked={autosave}
              onClick={() => settings.set({ autosave: !autosave })}
            />
            {updateBtn && <Item label={updateBtn.label} disabled={updateBtn.busy} onClick={on.update && run(on.update)} />}
            {!installed && <Item label="Install App…" onClick={run(on.install)} />}
          </div>
        )}
      </div>
      <div id={MENUBAR_SLOT_ID} className="menubar-slot" />
      {searchSlot ? createPortal(search, searchSlot) : search}
      <div className={`menu feedback-menu${feedbackOpen ? ' open' : ''}`} ref={feedback}>
        <button
          type="button"
          className="menubar-icon-btn feedback-btn"
          aria-haspopup="true"
          aria-expanded={feedbackOpen}
          aria-label="Feedback"
          title="Report a bug, suggest a feature or sponsor redcolumn"
          onClick={() => setFeedbackOpen(!feedbackOpen)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M2.5 3h11v7.5H8L5 13.5v-3H2.5z" />
          </svg>
          <span className="feedback-label">Feedback</span>
          <span className="brand-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {feedbackOpen && (
          <div className="menu-drop feedback-drop" role="menu">
            {FEEDBACK_ITEMS.map(([id, label]) => {
              const c = commands.get(id);
              return c && !c.managed ? <Item key={id} label={label} disabled={!c.enabled} onClick={() => { setFeedbackOpen(false); c.run(); }} /> : null;
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        className={`menubar-icon-btn autosave-btn${autosave ? ' on' : ''}`}
        aria-checked={autosave}
        aria-label="Autosave"
        title={autosave ? 'Autosave is on: changes are saved to the file a few seconds after you make them. Click to turn off.' : 'Autosave is off. Click to save changes to the file in the background.'}
        onClick={() => settings.set({ autosave: !autosave })}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M2.5 2.5h8l3 3v8h-11z M5 2.5v3.5h5V2.5 M5 13.5V9.5h6v4" />
        </svg>
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </button>
    </div>
  );
}
