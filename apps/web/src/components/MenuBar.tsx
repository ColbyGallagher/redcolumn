import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Command } from '../commands/appCommands';
import { shortcutLabel } from '../commands/shortcuts';
import { isStandalone, onInstallChange } from '../offline/install';
import type { Tool } from '../markup/MarkupTools';
import { MEASURE_TOOLS } from './ToolBar';

/**
 * Tools › Markup, in groups. Left out because the menus list them elsewhere: Stamp, File
 * Attachment, Hyperlink, Eraser, Redaction and Snapshot. Select and Lasso are not markups.
 */
const MARKUP_GROUPS: { label: string; tools: Tool[] }[] = [
  { label: 'Lines & Shapes', tools: ['line', 'arrow', 'dimension', 'polyline', 'arc', 'rect', 'ellipse', 'polygon', 'cloud', 'cloudPlus'] },
  { label: 'Freehand', tools: ['pen', 'highlighter'] },
  { label: 'Text Markup', tools: ['textHighlight', 'underline', 'strikeout', 'squiggly', 'replaceText'] },
  { label: 'Text & Notes', tools: ['text', 'callout', 'typewriter', 'note'] },
  { label: 'Other', tools: ['image', 'flag', 'legend', 'space'] },
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
  | 'search'
  | 'sheets'
  | 'forms'
  | 'sets'
  | 'sessions';
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
  search: 'Search',
  sheets: 'Sheets',
  forms: 'Forms',
  sets: 'Sets',
  sessions: 'Sessions',
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
  on: {
    placeStamp: (id: string) => void;
    openRecent: (id: string) => void;
    switchProfile: (id: string) => void;
    showLeft: (tab: LeftTab) => void;
    showBottom: (tab: BottomTab) => void;
    /** The Install App button: the browser's prompt where it has one, else the steps dialog. */
    install: () => void;
  };
}

type MenuId = 'file' | 'edit' | 'view' | 'document' | 'batch' | 'tools' | 'window' | 'help';

const MENUS: { id: MenuId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'document', label: 'Document' },
  { id: 'batch', label: 'Batch' },
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

function Sep() {
  return <div className="menu-sep" role="separator" />;
}

/**
 * A submenu that pops out to the side, as in desktop menus. The flyout is fixed-positioned so the
 * scrolling menu it sits in does not clip it; it flips left or shifts up near the window's edges.
 */
function Submenu({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openFly = () => {
    clearTimeout(closeTimer.current);
    const r = row.current?.getBoundingClientRect();
    if (r) setPos({ left: r.right - 2, top: r.top - 5 });
  };
  const closeFly = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPos(null), 150);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
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

/** The top menus. Items come from the command table. */
export function MenuBar({ commands, author, onAuthorChange, recents, profiles, activeProfileId, hiddenPanels, panels, stamps, on }: MenuBarProps) {
  const [open, setOpen] = useState<MenuId | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [installed, setInstalled] = useState(isStandalone);
  useEffect(() => onInstallChange(() => setInstalled(isStandalone())), []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(null);
    fn();
  };

  /** A menu item for a command; `label` overrides the command's own name. */
  const Cmd = ({ id, label }: { id: string; label?: string }) => {
    const c = commands.get(id);
    if (!c) return <Item label={label ?? id} disabled />;
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
            <Sep />
            <Cmd id="file.newPdf" />
            <Cmd id="file.newFromTemplate" />
            <Cmd id="file.open" />
            <Submenu label="Open Recent">
              {recents.length === 0 ? (
                <Item label="No recent files" disabled />
              ) : (
                recents.map((f) => <Item key={f.id} label={f.name} onClick={run(() => on.openRecent(f.id))} />)
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
              <Cmd id="file.exportXfdf" />
              <Cmd id="file.exportSummary" />
            </Submenu>
            <Submenu label="Import">
              <Cmd id="file.importXfdf" label="Markups from XFDF…" />
              <Cmd id="file.importPdfMarkups" label="Markups from Another PDF…" />
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
            <Cmd id="edit.hide" />
            <Cmd id="edit.showHidden" />
            <Cmd id="edit.delete" />
            <Sep />
            <Cmd id="tool.pan" />
            <Cmd id="tool.select" label="Select" />
            <Cmd id="edit.selectAll" />
            <Cmd id="tool.lasso" />
            <Cmd id="tool.snapshot" />
            <Cmd id="edit.formatPainter" />
            <Cmd id="edit.group" />
            <Cmd id="edit.ungroup" />
            <Cmd id="edit.lock" />
            <Cmd id="edit.find" />
            <Submenu label="PDF Content">
              <Cmd id="edit.selectText" />
              <Cmd id="edit.eraseContent" />
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
            <Cmd id="view.showLinks" />
            <Sep />
            <Cmd id="view.darkPages" />
            <Cmd id="view.dimmer" />
            <Cmd id="view.replyIndicators" />
            <Cmd id="view.thinLines" />
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
            <Cmd id="document.pageSetup" />
            <Cmd id="document.rotatePages" label="Rotate Pages…" />
            <Submenu label="Insert">
              <Cmd id="document.insertPages" label="Pages from PDF…" />
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
            <Cmd id="document.headerFooter" />
            <Cmd id="document.security" />
            <Sep />
            <Cmd id="document.compare" />
            <Cmd id="document.overlay" />
            <Cmd id="document.slipSheet" />
            <Cmd id="document.revisions" />
            <Cmd id="view.stitched" label="Stitching…" />
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
            <Cmd id="tools.sketchToScale" />
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
            </Submenu>
            <Cmd id="tool.hyperlink" />
            <Cmd id="tool.attachment" />
            <Cmd id="tools.sound" />
            <Submenu label="Eraser">
              <Cmd id="tool.eraser" label="Eraser" />
              <Cmd id="tools.eraserSmall" label="Small" />
              <Cmd id="tools.eraserMedium" label="Medium" />
              <Cmd id="tools.eraserLarge" label="Large" />
              <Cmd id="tools.eraserWhole" />
            </Submenu>
            <Submenu label="Toolbars">
              <Cmd id="window.toolbar" />
            </Submenu>
            <Cmd id="view.reuse" label="Reuse" />
          </>
        );
      case 'window':
        return (
          <>
            <Cmd id="window.toolbar" />
            <Cmd id="window.leftPanel" />
            <Cmd id="window.bottomPanel" />
          </>
        );
      case 'help':
        return (
          <>
            <Cmd id="help.commands" />
            <Cmd id="help.docs" />
            <Cmd id="help.community" />
            <Cmd id="help.updates" />
            <Cmd id="help.install" />
            <Cmd id="help.support" />
            <Cmd id="help.suggest" />
            <Cmd id="help.logs" />
            <Sep />
            <Cmd id="help.whatsNew" />
            <Cmd id="file.shortcuts" label="Keyboard Shortcuts Guide" />
          </>
        );
    }
  };

  return (
    <div className="menubar" ref={root} role="menubar">
      {MENUS.map(({ id, label }) => (
        <div key={id} className={`menu${open === id ? ' open' : ''}`}>
          <button
            type="button"
            className="menu-title"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === id}
            onClick={() => setOpen(id)}
            onMouseEnter={() => {
              if (open) setOpen(id);
            }}
          >
            {label}
          </button>
          {open === id && (
            <div className="menu-drop" role="menu">
              {menu(id)}
            </div>
          )}
        </div>
      ))}
      {!installed && (
        <button type="button" className="install-app-btn" title={'Install redcolumn as an app:\n• Works offline, even with no signal\n• Its own window, with a taskbar, dock or home screen icon\n• Offered as the opener for PDFs in your file manager (desktop)\n• Share PDFs to it from other apps (phone)\n• Right-click the icon for Open and New PDF shortcuts\n• Updates install in the background without interrupting your work'} onClick={on.install}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M8 2v8m-3-3 3 3 3-3M3 13h10" />
          </svg>
          Install app
        </button>
      )}
    </div>
  );
}
