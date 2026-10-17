import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { Command } from '../commands/appCommands';
import { shortcutLabel } from '../commands/shortcuts';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import { MENU_ICONS } from './menuIcons';
import { StampMenu } from './StampsDialog';
import { MARKUP_GROUPS, MARKUP_TOOLS, MEASURE_GROUPS, MEASURE_TOOLS, StyleControls, toolTitle, type ToolBarProps } from './ToolBar';

/** A 16 × 16 line icon for a ribbon button, drawn in the text colour. */
function ic(d: string, extra?: ReactNode): ReactNode {
  return (
    <svg className="tool-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {extra}
    </svg>
  );
}

/** Icons for the commands the ribbon shows (tools use their toolbar icons). */
const ICONS: Record<string, ReactNode> = {
  'edit.paste': MENU_ICONS.paste,
  'edit.pasteInPlace': ic('M5 3H3v11h10V3h-2M6 2h4v2.5H6z', <circle cx="8" cy="9.5" r="1.6" />),
  'edit.cut': MENU_ICONS.cut,
  'edit.copy': MENU_ICONS.copy,
  'edit.formatPainter': MENU_ICONS.painter,
  'edit.multiply': MENU_ICONS.multiply,
  'edit.undo': ic('M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7'),
  'edit.redo': ic('M10.5 3l3 3-3 3M13.5 6h-7a4 4 0 0 0 0 8H9'),
  'edit.undoHistory': ic('M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.8h2.8M8 5v3.2l2 1.3'),
  'edit.selectAll': ic('M2 2h3M7 2h2M11 2h3v3M14 7v2M14 11v3h-3M9 14H7M5 14H2v-3M2 9V7M2 5V2M5 5h6v6H5z'),
  'edit.selectSimilar': ic('M2 2.5h5v5H2zM9 8.5h5v5H9zM9 2.5h5v5H9z', <path d="M2 8.5h5v5H2z" strokeDasharray="1.5 1.2" />),
  'edit.selectText': ic('M5 2.5h6M8 2.5v11M5 13.5h6'),
  'tool.pan': ic('M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2'),
  'tool.zoomBox': ic('M2 2h7v7H2zM8 8l5.5 5.5'),
  'edit.delete': MENU_ICONS.delete,
  'edit.hide': MENU_ICONS.hide,
  'edit.showHidden': ic('M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z', <circle cx="8" cy="8" r="1.8" />),
  'edit.find': ic('M10 10l4 4', <circle cx="6.5" cy="6.5" r="4.5" />),
  'edit.checkSpelling': ic('M2 11l2.5-7L7 11M3 8.5h3M9 9.5l2 2 4-5'),
  // Modify.
  'edit.move': ic('M8 1.5v13M1.5 8h13M8 1.5 6.2 3.3M8 1.5l1.8 1.8M8 14.5l-1.8-1.8M8 14.5l1.8-1.8M1.5 8l1.8-1.8M1.5 8l1.8 1.8M14.5 8l-1.8-1.8M14.5 8l-1.8 1.8'),
  'edit.copyBase': ic('M2 6h7v7.5H2zM6 2.5h8V10', <circle cx="2" cy="13.5" r="1.2" fill="currentColor" />),
  'edit.rotate': ic('M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3'),
  'edit.scale': ic('M2 14V8h6v6zM8 8l6-6M10 2h4v4'),
  'edit.mirror': ic('M8 1.5v13', <path d="M6 3.5 2 12h4zM10 3.5l4 8.5h-4z" />),
  'edit.alignPoints': ic('M2 13l5-5M9 6l5-5', <><circle cx="2" cy="13" r="1.2" /><circle cx="14" cy="1" r="1.2" /></>),
  'edit.stretch': ic('M2 4h6v8H2zM8 8h6M12 6l2 2-2 2'),
  'edit.scaleToLength': MENU_ICONS.scale,
  'edit.offset': ic('M2 12.5 6 3.5h8M5 14.5l4-9h5'),
  'edit.trim': ic('M2 8h12M8 2v12', <path d="M10.5 6.5l2 2M12.5 6.5l-2 2" />),
  'edit.extend': ic('M2 8h8M10 8h3', <path d="M14 2v12M10 8h3.5" strokeDasharray="1.5 1.2" />),
  'edit.break': ic('M2 8h4.5M9.5 8H14M6.5 5.5v5M9.5 5.5v5'),
  'edit.lengthen': ic('M2 8h8M10 8l-2-2M10 8l-2 2M12 5v6'),
  'edit.fillet': ic('M2.5 14V8a5.5 5.5 0 0 1 5.5-5.5h6'),
  'edit.chamfer': ic('M2.5 14V6.5l4-4h7.5'),
  'edit.join': ic('M2 12l4-6h4l4-4', <><circle cx="6" cy="6" r="1.2" fill="currentColor" /><circle cx="10" cy="6" r="1.2" fill="currentColor" /></>),
  'edit.explode': ic('M2 13l3-5M7 5h3M12 4l2-2M6 9l1.5 1.5M10 9.5l1 2'),
  'edit.reverse': ic('M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3'),
  'edit.toCloud': ic('M4.5 12.5a2.5 2.5 0 0 1-.4-5 3.5 3.5 0 0 1 6.8-1A2.8 2.8 0 1 1 11.5 12.5z'),
  'edit.autoSize': ic('M2 4h12v8H2zM5 8h6M4 6.5 2.5 8 4 9.5M12 6.5l1.5 1.5-1.5 1.5'),
  'edit.arrayPolar': ic('M8 8', <><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="2.5" r="1.4" /><circle cx="13.2" cy="9.5" r="1.4" /><circle cx="2.8" cy="9.5" r="1.4" /><circle cx="8" cy="13.5" r="1.4" /></>),
  'edit.arrayPath': ic('M1.5 13c3-1 4-9 13-10', <><circle cx="3.5" cy="12" r="1.2" /><circle cx="7.3" cy="7.5" r="1.2" /><circle cx="12" cy="4" r="1.2" /></>),
  'edit.divide': ic('M2 8h12M2 6v4M6 6.5v3M10 6.5v3M14 6v4'),
  'edit.bringToFront': ic('M6 6h8v8H6z', <path d="M2 2h8v8H2z" fill="currentColor" fillOpacity="0.35" />),
  'edit.bringForward': ic('M2 2h8v8H2zM6 6h8v8H6z'),
  'edit.sendBackward': ic('M6 6h8v8H6zM2 2h8v8H2z'),
  'edit.sendToBack': ic('M2 2h8v8H2z', <path d="M6 6h8v8H6z" fill="currentColor" fillOpacity="0.35" />),
  'edit.flipHorizontal': ic('M8 1.5v13M6 4 2 8l4 4zM10 4l4 4-4 4z'),
  'edit.flipVertical': ic('M1.5 8h13M4 6l4-4 4 4zM4 10l4 4 4-4z'),
  'edit.alignLeft': ic('M2 1.5v13M4 4h9M4 10h6'),
  'edit.alignCenter': ic('M8 1.5v13M3 4h10M5 10h6'),
  'edit.alignRight': ic('M14 1.5v13M3 4h9M6 10h6'),
  'edit.alignTop': ic('M1.5 2h13M4 4v9M10 4v6'),
  'edit.alignMiddle': ic('M1.5 8h13M4 3v10M10 5v6'),
  'edit.alignBottom': ic('M1.5 14h13M4 3v9M10 6v6'),
  'edit.group': ic('M1.5 1.5h13v13h-13z', <path d="M4 4h4v4H4zM8 8h4v4H8z" />),
  'edit.ungroup': ic('M2 2h5v5H2zM9 9h5v5H9z'),
  'edit.lock': ic('M4 7.5h8v6.5H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'),
  'edit.editAction': ic('M5 11 11 5M7 5h4v4'),
  'edit.eraseContent': ic('M9.5 2.5 13.5 6.5 7 13H3.5L2 11.5z', <path d="M6 6l4 4M3.5 13h10" />),
  'edit.cutContent': ic('M2 2h12v8H2z', <><path d="M5 10l6 4.5M11 10l-6 4.5" /></>),
  'edit.editText': ic('M3 3h7M6.5 3v9M9 13l5-5-1.5-1.5-5 5V13z'),
  // Document.
  'document.insertPages': MENU_ICONS.pageInsert,
  'document.insertBlank': MENU_ICONS.pageBlank,
  'document.extractPages': MENU_ICONS.pageExtract,
  'document.replacePages': MENU_ICONS.pageReplace,
  'document.deletePages': MENU_ICONS.pageDelete,
  'document.rotatePages': MENU_ICONS.pageRotate,
  'document.cropPages': ic('M4 1.5v10.5h10.5M1.5 4h10.5v10.5'),
  'document.pageSetup': MENU_ICONS.pageSetup,
  'document.splitDocument': ic('M3.5 1.5h9v5h-9zM3.5 9.5h9v5h-9z'),
  'document.numberPages': MENU_ICONS.pageNumber,
  'document.headerFooter': ic('M3 1.5h10v13H3zM5 4h6M5 12h6'),
  'document.labelRegions': ic('M2 5.5 6.5 1.5H14v8l-4 4.5H2z', <circle cx="10.5" cy="4.8" r="1" />),
  'document.addBookmark': ic('M4 1.5h8v13L8 11l-4 3.5z'),
  'document.ocr': ic('M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3M5 6h6M5 8.5h6M5 11h4'),
  'document.flatten': MENU_ICONS.flatten,
  'document.unflatten': ic('M5.5 9 3 2.5h10L10.5 9M6.5 9a1.5 1.5 0 0 0 3 0M8 11v3.5'),
  'document.reduceSize': ic('M3.5 1.5h9v13h-9zM8 4v7M5.5 8.5 8 11l2.5-2.5'),
  'document.repair': ic('M10.5 2a3 3 0 0 0-3.7 3.7L2 10.5 4.5 13l4.8-4.8A3 3 0 0 0 13 4.5l-2 2-1.5-1.5 2-2z'),
  'document.colour': ic('M8 2c3 3.5 4.5 5.5 4.5 7.5a4.5 4.5 0 0 1-9 0C3.5 7.5 5 5.5 8 2z'),
  'document.compare': ic('M1.5 2.5h5.5v11H1.5zM9 2.5h5.5v11H9zM3 6h2.5M10.5 6H13M3 9h2.5M10.5 9H13'),
  'document.overlay': ic('M2 2h8v8H2z', <path d="M6 6h8v8H6z" strokeDasharray="1.5 1.2" />),
  'document.slipSheet': ic('M3.5 3.5h9v11h-9zM5.5 1.5h9v11'),
  'document.revisions': ic('M3 1.5h10v13H3zM5.5 5h5M5.5 8h5M5.5 11h3'),
  'document.security': ic('M8 1.5 13.5 3.5V8c0 3.5-2.5 5.5-5.5 6.5C5 13.5 2.5 11.5 2.5 8V3.5z'),
  'tools.sign': ic('M2 13c2-4 3-7 4-7s0 6 1.5 6 2-3 3-3 1 2 3 2M2 15h12'),
  'tools.digitalIds': ic('M1.5 3.5h13v9h-13zM4 6.5h3M4 9.5h5', <circle cx="11.5" cy="7.5" r="1.5" />),
  'tools.applyRedactions': ic('M2 4h12v3H2zM2 9h8v3H2z', <path d="M12 9.5l2 2M14 9.5l-2 2" />),
  'document.pdfa': ic('M3 1.5h10v13H3zM5.5 11 8 4.5l2.5 6.5M6.3 9h3.4'),
  'tools.formField': ic('M1.5 5h13v6h-13zM4 7v2'),
  'tools.autoFields': ic('M1.5 2.5h13v4h-13zM1.5 9.5h13v4h-13zM4 4.5h1M4 11.5h1'),
  'tools.forms': ic('M3 1.5h10v13H3zM5 5h6M5 8h6M5 11h3'),
  'document.scaleRegions': MENU_ICONS.scale,
  'tools.assemblies': ic('M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z'),
  'tools.quantities': MENU_ICONS.summary,
  'tools.sketchToScale': ic('M2 14 14 2M2 14h4M2 14v-4M10 2h4v4'),
  'tools.columns': ic('M1.5 2.5h13v11h-13zM6 2.5v11M10.5 2.5v11'),
  // View.
  'view.fitPage': ic('M3.5 1.5h9v13h-9zM1.5 4V1.5H4M12 1.5h2.5V4M14.5 12v2.5H12M4 14.5H1.5V12'),
  'view.fitWidth': ic('M3.5 2.5h9v11h-9zM1 8h3M15 8h-3M2.5 6.5 1 8l1.5 1.5M13.5 6.5 15 8l-1.5 1.5'),
  'view.actualSize': ic('M2.5 2.5h11v11h-11zM6 6v4.5M10 6v4.5M8 7v.1M8 9.5v.1'),
  'view.zoomIn': ic('M10 10l4 4M4.5 6.5h4M6.5 4.5v4', <circle cx="6.5" cy="6.5" r="4.5" />),
  'view.zoomOut': ic('M10 10l4 4M4.5 6.5h4', <circle cx="6.5" cy="6.5" r="4.5" />),
  'view.magnifier': ic('M10.5 10.5l3.5 3.5', <><circle cx="6.5" cy="6.5" r="5" /><circle cx="6.5" cy="6.5" r="2.2" /></>),
  'view.singlePage': ic('M4 1.5h8v13H4z'),
  'view.continuous': ic('M4 1h8v6H4zM4 9h8v6H4z'),
  'view.sideBySide': ic('M1.5 2.5h6v11h-6zM8.5 2.5h6v11h-6z'),
  'view.continuousSideBySide': ic('M1.5 1h6v6h-6zM8.5 1h6v6h-6zM1.5 9h6v6h-6zM8.5 9h6v6h-6z'),
  'view.coverPage': ic('M5 2.5h6v11H5z', <path d="M5 2.5h6v11H5z" fill="currentColor" fillOpacity="0.3" />),
  'view.rotateClockwise': ic('M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3'),
  'view.rotateCounterclockwise': ic('M3 8a5 5 0 1 0 1.5-3.6M3 2v3h3'),
  'view.split': ic('M1.5 2.5h13v11h-13zM8 2.5v11'),
  'view.splitHorizontal': ic('M1.5 2.5h13v11h-13zM1.5 8h13'),
  'view.syncDocument': ic('M3 6a5 5 0 0 1 9-1.5M13 10a5 5 0 0 1-9 1.5M12 1.5v3h-3M4 14.5v-3h3'),
  'view.syncPage': ic('M5 3h6v10H5zM2 8h1.5M12.5 8H14'),
  'view.unsplit': ic('M1.5 2.5h13v11h-13z'),
  'view.stitched': ic('M1.5 3.5h6v9h-6zM8.5 3.5h6v9h-6zM7 6h2M7 8h2M7 10h2'),
  'view.rulers': ic('M1.5 1.5h13v3h-10v10h-3zM6 1.5v1.5M9 1.5v1.5M12 1.5v1.5M1.5 7.5H3M1.5 10.5H3'),
  'view.grid': ic('M1.5 1.5h13v13h-13zM6 1.5v13M10.5 1.5v13M1.5 6h13M1.5 10.5h13'),
  'view.snapGrid': ic('M1.5 5.5h13M1.5 10.5h13M5.5 1.5v13M10.5 1.5v13', <circle cx="10.5" cy="5.5" r="1.6" fill="currentColor" />),
  'view.snapContent': ic('M2 13 7 3l5 10', <circle cx="7" cy="3" r="1.8" />),
  'view.snapMarkup': ic('M2 12h12', <rect x="6" y="10" width="4" height="4" />),
  'view.polarTracking': ic('M2 14h12M2 14 12 4', <path d="M8 14a6 6 0 0 0-1.7-4.2" />),
  'view.objectSnapTracking': ic('M2 13h12M10 3v10', <><path d="M2 13h12M10 3v10" strokeDasharray="1.5 1.2" /><circle cx="10" cy="3" r="1.5" /></>),
  'view.crosshair': ic('M8 1v14M1 8h14'),
  'view.showLinks': ic('M6.5 9.5l3-3M7 4.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5 7.5 13a2.5 2.5 0 0 1-3.5-3.5L5.5 8'),
  'view.darkPages': ic('M12.5 10A5.5 5.5 0 0 1 6 3.5a5.5 5.5 0 1 0 6.5 6.5z'),
  'view.dimmer': ic('M8 4.5a3.5 3.5 0 1 0 0 7z', <circle cx="8" cy="8" r="3.5" />),
  'view.thinLines': ic('M2 4h12M2 8h12M2 12h12'),
  'view.fullScreen': ic('M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4'),
  'window.leftPanel': ic('M1.5 2.5h13v11h-13zM5.5 2.5v11'),
  'window.rightPanel': ic('M1.5 2.5h13v11h-13zM10.5 2.5v11'),
  'window.bottomPanel': ic('M1.5 2.5h13v11h-13zM1.5 9.5h13'),
  'window.panels': ic('M1.5 2.5h13v11h-13zM5.5 2.5v7M1.5 9.5h13'),
};

// Bulk jobs share their single-document command's icon.
Object.assign(ICONS, {
  'file.combine': ic('M2 2h5v6H2zM9 2h5v6H9zM4.5 8v2.5h7V8M8 10.5V14M6 12l2 2 2-2'),
  'batch.link': ICONS['view.showLinks'],
  'batch.flatten': ICONS['document.flatten'],
  'batch.unflatten': ICONS['document.unflatten'],
  'batch.ocr': ICONS['document.ocr'],
  'batch.reduce': ICONS['document.reduceSize'],
  'batch.repair': ICONS['document.repair'],
  'batch.colour': ICONS['document.colour'],
  'batch.headerFooter': ICONS['document.headerFooter'],
  'batch.removeHeaderFooter': ic('M3 1.5h10v13H3zM5 4h6', <path d="M9 10l3 3M12 10l-3 3" />),
  'batch.stamp': MENU_ICONS.stamp,
  'batch.crop': ICONS['document.cropPages'],
  'batch.pageSetup': ICONS['document.pageSetup'],
  'batch.split': ICONS['document.splitDocument'],
  'batch.pageLabels': ICONS['document.labelRegions'],
  'batch.sign': ICONS['tools.sign'],
  'batch.summary': MENU_ICONS.summary,
  'batch.print': MENU_ICONS.print,
});

/** Each tool's toolbar icon. */
const TOOL_ICON = new Map<Tool, ReactNode>([...MARKUP_TOOLS, ...MEASURE_TOOLS].map((t) => [t.tool, t.icon]));

type TabId = 'home' | 'markup' | 'measure' | 'modify' | 'document' | 'bulk' | 'view';

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'markup', label: 'Markup' },
  { id: 'measure', label: 'Measure' },
  { id: 'modify', label: 'Modify' },
  { id: 'document', label: 'Document' },
  { id: 'bulk', label: 'Bulk' },
  { id: 'view', label: 'View' },
];

const TAB_KEY = 'rc.ribbonTab';

function savedTab(): TabId {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t && TABS.some((x) => x.id === t)) return t as TabId;
  } catch {
    /* storage off limits: start on Home */
  }
  return 'home';
}

export interface RibbonProps {
  /** Every command by id: the ribbon's buttons run them and show their enabled and checked state. */
  commands: ReadonlyMap<string, Command>;
  /** What the simplified toolbar gets: tools, style controls and stamps. */
  toolbar: ToolBarProps;
  /** Only the tabs show; clicking one drops its commands down over the page until one is used. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The display options menu (ribbon, tabs only, simplified). */
  displayMenu: ReactNode;
}

type Size = 'large' | 'small';

interface RibbonContext {
  commands: ReadonlyMap<string, Command>;
  toolbar: ToolBarProps;
  /** Called after a button runs: a dropped-down ribbon folds back to its tabs. */
  done: () => void;
}

const Ctx = createContext<RibbonContext>(null!);

function Cmd({ id, size = 'small', label, icon }: { id: string; size?: Size; label?: string; icon?: ReactNode }) {
  const { commands, done } = useContext(Ctx);
  const c = commands.get(id);
  const name = label ?? c?.label ?? id;
  const key = shortcutLabel(id);
  return (
    <button
      type="button"
      className={`btn tool rb-btn ${size}${c?.checked ? ' active' : ''}`}
      data-ribbon-command={id}
      disabled={!c?.enabled}
      aria-pressed={c?.checked === undefined ? undefined : c.checked}
      title={`${c?.label ?? name}${key ? ` (${key})` : ''}`}
      onClick={() => {
        c?.run();
        done();
      }}
    >
      <span className="rb-icon">{icon ?? ICONS[id] ?? '•'}</span>
      <span className="rb-label">{name.replace(/…$/, '')}</span>
    </button>
  );
}

function ToolBtn({ tool, size = 'small' }: { tool: Tool; size?: Size }) {
  const { commands, toolbar, done } = useContext(Ctx);
  const { tools, state, author, enabled } = toolbar;
  const c = commands.get(`tool.${tool}`);
  const icon = TOOL_ICON.get(tool) ?? ICONS[`tool.${tool}`] ?? '•';
  const content = (
    <>
      <span className="rb-icon">{icon}</span>
      <span className="rb-label">{toolLabel(tool)}</span>
    </>
  );
  if (tool === 'stamp')
    return (
      <span className={`rb-stamp ${size}`}>
        <StampMenu
          icon={content}
          disabled={!enabled}
          active={state.tool === 'stamp'}
          title={toolTitle(tool)}
          author={author}
          currentId={state.tool === 'stamp' ? (state.preset?.stamp?.id ?? null) : null}
          onPlace={(s) => {
            toolbar.onPlaceStamp(s);
            done();
          }}
          onNew={toolbar.onNewStamp}
          onManage={toolbar.onManageStamps}
        />
      </span>
    );
  return (
    <button
      type="button"
      className={`btn tool rb-btn ${size}${state.tool === tool && !state.preset ? ' active' : ''}`}
      data-toolbar-tool={tool}
      disabled={c ? !c.enabled : !enabled}
      title={toolTitle(tool)}
      onClick={() => {
        tools.setTool(tool);
        done();
      }}
    >
      {content}
    </button>
  );
}

function Group({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
  <div className={`rb-group${wide ? ' wide' : ''}`} role="group" aria-label={label}>
    <div className="rb-items">{children}</div>
    <div className="rb-group-label">{label}</div>
  </div>
  );
}

/** Small buttons stacked three high, as in Word's ribbon. */
function Stack({ children }: { children: ReactNode }) {
  return <div className="rb-stack">{children}</div>;
}


/**
 * The top toolbar as a ribbon, as in Word, Excel and AutoCAD: tabs of commands in labelled groups.
 * Buttons come from the command table, so they disable themselves when what is selected cannot
 * take them (Explode with a text box selected, Fillet with a cloud).
 */
export function Ribbon({ commands, toolbar, collapsed, onCollapsedChange, displayMenu }: RibbonProps) {
  const [tab, setTab] = useState<TabId>(savedTab);
  // With the ribbon collapsed, the tab whose commands are dropped down (none: just the tabs).
  const [dropped, setDropped] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { state } = toolbar;

  const pick = (id: TabId) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* storage off limits: the tab lasts for this session */
    }
  };

  useEffect(() => {
    if (!collapsed) setDropped(false);
  }, [collapsed]);

  useEffect(() => {
    if (!dropped) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      // Stamp and hatch menus pop out of the ribbon; clicks in them keep it open.
      if (root.current?.contains(t) || t.closest?.('.stamp-menu, .hatch-pop')) return;
      setDropped(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropped(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [dropped]);

  /** After a command runs from a dropped-down ribbon, it folds back to its tabs (as in Word). */
  const done = () => {
    if (collapsed) setDropped(false);
  };

  const properties = (
    <Group label="Properties" wide>
      <div className="rb-props">
        <StyleControls {...toolbar} />
      </div>
    </Group>
  );

  const toolGroups = (groups: typeof MARKUP_GROUPS) =>
    groups.map((g) => (
      <Group key={g.label} label={g.label}>
        {Array.from({ length: Math.ceil(g.tools.length / 3) }, (_, i) => (
          <Stack key={i}>
            {g.tools.slice(i * 3, i * 3 + 3).map(({ tool }) => (
              <ToolBtn key={tool} tool={tool} />
            ))}
          </Stack>
        ))}
      </Group>
    ));

  const body = (id: TabId): ReactNode => {
    switch (id) {
      case 'home':
        return (
          <>
            <Group label="Clipboard">
              <Cmd id="edit.paste" size="large" />
              <Stack>
                <Cmd id="edit.cut" />
                <Cmd id="edit.copy" />
                <Cmd id="edit.pasteInPlace" />
              </Stack>
              <Cmd id="edit.formatPainter" size="large" label="Format Painter" />
            </Group>
            <Group label="History">
              <Stack>
                <Cmd id="edit.undo" />
                <Cmd id="edit.redo" />
                <Cmd id="edit.undoHistory" label="History" />
              </Stack>
            </Group>
            <Group label="Select">
              <ToolBtn tool="select" size="large" />
              <Stack>
                <ToolBtn tool="lasso" />
                <Cmd id="tool.pan" />
                <Cmd id="tool.zoomBox" />
              </Stack>
              <Stack>
                <Cmd id="edit.selectAll" />
                <Cmd id="edit.selectSimilar" />
                <Cmd id="edit.selectText" />
              </Stack>
            </Group>
            <Group label="Quick Tools">
              <Stack>
                <ToolBtn tool="pen" />
                <ToolBtn tool="highlighter" />
                <ToolBtn tool="text" />
              </Stack>
              <Stack>
                <ToolBtn tool="cloud" />
                <ToolBtn tool="callout" />
                <ToolBtn tool="stamp" />
              </Stack>
            </Group>
            {properties}
            <Group label="Edit">
              <Cmd id="edit.delete" size="large" />
              <Stack>
                <Cmd id="edit.hide" />
                <Cmd id="edit.find" />
                <Cmd id="edit.checkSpelling" label="Spelling" />
              </Stack>
            </Group>
          </>
        );
      case 'markup':
        return (
          <>
            {toolGroups(MARKUP_GROUPS.filter((g) => g.label !== 'Select'))}
            {properties}
          </>
        );
      case 'measure':
        return (
          <>
            <Group label="Scale">
              <ToolBtn tool="calibrate" size="large" />
              <Stack>
                <Cmd id="document.scaleRegions" label="Bulk Page Scale" />
                <Cmd id="tools.sketchToScale" />
              </Stack>
            </Group>
            {toolGroups(MEASURE_GROUPS.filter((g) => g.label !== 'Scale'))}
            <Group label="Takeoff">
              <Cmd id="tools.assemblies" size="large" />
              <Stack>
                <Cmd id="tools.quantities" />
                <Cmd id="tools.columns" label="Columns & Statuses" />
                <Cmd id="tools.nextMeasure" />
              </Stack>
            </Group>
            {properties}
          </>
        );
      case 'modify':
        return (
          <>
            <Group label="Transform">
              <Cmd id="edit.move" size="large" />
              <Stack>
                <Cmd id="edit.copyBase" label="Copy" />
                <Cmd id="edit.rotate" />
                <Cmd id="edit.scale" />
              </Stack>
              <Stack>
                <Cmd id="edit.mirror" />
                <Cmd id="edit.stretch" />
                <Cmd id="edit.alignPoints" />
              </Stack>
              <Stack>
                <Cmd id="edit.scaleToLength" />
                <Cmd id="edit.flipHorizontal" />
                <Cmd id="edit.flipVertical" />
              </Stack>
            </Group>
            <Group label="Edit Geometry">
              <Cmd id="edit.offset" size="large" />
              <Stack>
                <Cmd id="edit.trim" />
                <Cmd id="edit.extend" />
                <Cmd id="edit.break" />
              </Stack>
              <Stack>
                <Cmd id="edit.lengthen" />
                <Cmd id="edit.fillet" />
                <Cmd id="edit.chamfer" />
              </Stack>
            </Group>
            <Group label="Convert">
              <Stack>
                <Cmd id="edit.join" />
                <Cmd id="edit.explode" />
                <Cmd id="edit.reverse" />
              </Stack>
              <Stack>
                <Cmd id="edit.toCloud" />
                <Cmd id="edit.autoSize" label="Auto-size Text" />
              </Stack>
            </Group>
            <Group label="Pattern">
              <Stack>
                <Cmd id="edit.arrayPolar" />
                <Cmd id="edit.arrayPath" />
                <Cmd id="edit.divide" />
              </Stack>
              <Stack>
                <Cmd id="edit.multiply" />
              </Stack>
            </Group>
            <Group label="Arrange">
              <Stack>
                <Cmd id="edit.bringToFront" />
                <Cmd id="edit.bringForward" />
              </Stack>
              <Stack>
                <Cmd id="edit.sendBackward" />
                <Cmd id="edit.sendToBack" />
              </Stack>
            </Group>
            <Group label="Align">
              <div className="rb-icon-grid">
                <Cmd id="edit.alignLeft" />
                <Cmd id="edit.alignCenter" />
                <Cmd id="edit.alignRight" />
                <Cmd id="edit.alignTop" />
                <Cmd id="edit.alignMiddle" />
                <Cmd id="edit.alignBottom" />
              </div>
            </Group>
            <Group label="Group">
              <Stack>
                <Cmd id="edit.group" />
                <Cmd id="edit.ungroup" />
                <Cmd id="edit.lock" />
              </Stack>
            </Group>
            <Group label="PDF Content">
              <Cmd id="edit.editText" size="large" />
              <Stack>
                <Cmd id="edit.selectText" />
                <Cmd id="edit.eraseContent" />
                <Cmd id="edit.cutContent" />
              </Stack>
            </Group>
            <Group label="Remove">
              <Cmd id="edit.delete" size="large" />
              <Stack>
                <Cmd id="edit.hide" />
                <Cmd id="edit.showHidden" />
                <Cmd id="edit.editAction" />
              </Stack>
            </Group>
          </>
        );
      case 'document':
        return (
          <>
            <Group label="Pages">
              <Cmd id="document.insertPages" size="large" label="Insert Pages" />
              <Stack>
                <Cmd id="document.insertBlank" label="Insert Blank" />
                <Cmd id="document.extractPages" label="Extract" />
                <Cmd id="document.replacePages" label="Replace" />
              </Stack>
              <Stack>
                <Cmd id="document.deletePages" label="Delete" />
                <Cmd id="document.rotatePages" label="Rotate" />
                <Cmd id="document.cropPages" label="Crop" />
              </Stack>
              <Stack>
                <Cmd id="document.pageSetup" />
                <Cmd id="document.splitDocument" label="Split" />
              </Stack>
            </Group>
            <Group label="Labels">
              <Stack>
                <Cmd id="document.numberPages" />
                <Cmd id="document.headerFooter" />
                <Cmd id="document.labelRegions" label="Page Labels" />
              </Stack>
              <Stack>
                <Cmd id="document.addBookmark" />
              </Stack>
            </Group>
            <Group label="Process">
              <Cmd id="document.ocr" size="large" label="OCR" />
              <Stack>
                <Cmd id="document.flatten" />
                <Cmd id="document.unflatten" />
                <Cmd id="document.colour" label="Colour" />
              </Stack>
              <Stack>
                <Cmd id="document.reduceSize" label="Reduce Size" />
                <Cmd id="document.repair" />
              </Stack>
            </Group>
            <Group label="Compare">
              <Cmd id="document.compare" size="large" label="Compare" />
              <Stack>
                <Cmd id="document.overlay" label="Overlay" />
                <Cmd id="document.slipSheet" label="Slip Sheet" />
                <Cmd id="document.revisions" label="Revisions" />
              </Stack>
            </Group>
            <Group label="Protect">
              <Stack>
                <Cmd id="document.security" />
                <Cmd id="tools.sign" label="Sign" />
                <Cmd id="tools.digitalIds" />
              </Stack>
              <Stack>
                <ToolBtn tool="redaction" />
                <Cmd id="tools.applyRedactions" label="Apply Redactions" />
                <Cmd id="document.pdfa" label="PDF/A" />
              </Stack>
            </Group>
            <Group label="Forms">
              <Stack>
                <Cmd id="tools.formField" />
                <Cmd id="tools.autoFields" label="Auto-Create Fields" />
                <Cmd id="tools.forms" />
              </Stack>
            </Group>
          </>
        );
      case 'bulk':
        return (
          <>
            <Group label="Combine & Compare">
              <Cmd id="file.combine" size="large" label="Combine PDFs" />
              <Stack>
                <Cmd id="batch.link" />
                <Cmd id="document.slipSheet" label="Slip Sheet" />
              </Stack>
              <Stack>
                <Cmd id="document.compare" label="Compare" />
                <Cmd id="document.overlay" label="Overlay" />
              </Stack>
            </Group>
            <Group label="Process">
              <Stack>
                <Cmd id="batch.flatten" />
                <Cmd id="batch.unflatten" />
                <Cmd id="batch.ocr" />
              </Stack>
              <Stack>
                <Cmd id="batch.reduce" />
                <Cmd id="batch.repair" />
                <Cmd id="batch.colour" />
              </Stack>
            </Group>
            <Group label="Headers & Stamps">
              <Stack>
                <Cmd id="batch.headerFooter" />
                <Cmd id="batch.removeHeaderFooter" />
                <Cmd id="batch.stamp" />
              </Stack>
            </Group>
            <Group label="Pages">
              <Stack>
                <Cmd id="batch.crop" />
                <Cmd id="batch.pageSetup" />
              </Stack>
              <Stack>
                <Cmd id="batch.split" />
                <Cmd id="batch.pageLabels" />
              </Stack>
            </Group>
            <Group label="Sign">
              <Cmd id="batch.sign" size="large" />
            </Group>
            <Group label="Output">
              <Stack>
                <Cmd id="batch.summary" />
                <Cmd id="batch.print" />
              </Stack>
            </Group>
          </>
        );
      case 'view':
        return (
          <>
            <Group label="Zoom">
              <Cmd id="view.fitPage" size="large" />
              <Stack>
                <Cmd id="view.fitWidth" />
                <Cmd id="view.actualSize" />
                <Cmd id="view.magnifier" />
              </Stack>
              <Stack>
                <Cmd id="view.zoomIn" />
                <Cmd id="view.zoomOut" />
              </Stack>
            </Group>
            <Group label="Page Layout">
              <Stack>
                <Cmd id="view.singlePage" />
                <Cmd id="view.continuous" label="Continuous" />
                <Cmd id="view.coverPage" label="Cover Page" />
              </Stack>
              <Stack>
                <Cmd id="view.sideBySide" />
                <Cmd id="view.continuousSideBySide" label="Continuous Side-by-Side" />
                <Cmd id="view.stitched" />
              </Stack>
              <Stack>
                <Cmd id="view.rotateClockwise" label="Rotate Clockwise" />
                <Cmd id="view.rotateCounterclockwise" label="Rotate Counterclockwise" />
              </Stack>
            </Group>
            <Group label="Split">
              <Stack>
                <Cmd id="view.split" />
                <Cmd id="view.splitHorizontal" />
                <Cmd id="view.unsplit" />
              </Stack>
              <Stack>
                <Cmd id="view.syncDocument" label="Sync Document" />
                <Cmd id="view.syncPage" label="Sync Page" />
              </Stack>
            </Group>
            <Group label="Snap & Grid">
              <Stack>
                <Cmd id="view.rulers" />
                <Cmd id="view.grid" />
                <Cmd id="view.crosshair" label="Crosshair" />
              </Stack>
              <Stack>
                <Cmd id="view.snapGrid" />
                <Cmd id="view.snapContent" />
                <Cmd id="view.snapMarkup" />
              </Stack>
              <Stack>
                <Cmd id="view.polarTracking" />
                <Cmd id="view.objectSnapTracking" />
              </Stack>
            </Group>
            <Group label="Display">
              <Stack>
                <Cmd id="view.darkPages" label="Dark Pages" />
                <Cmd id="view.dimmer" />
                <Cmd id="view.thinLines" label="Thin Lines" />
              </Stack>
              <Stack>
                <Cmd id="view.showLinks" />
                <Cmd id="view.fullScreen" />
              </Stack>
            </Group>
            <Group label="Panels">
              <Stack>
                <Cmd id="window.leftPanel" />
                <Cmd id="window.rightPanel" />
                <Cmd id="window.bottomPanel" />
              </Stack>
              <Stack>
                <Cmd id="window.panels" />
              </Stack>
            </Group>
          </>
        );
    }
  };

  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    pick(next.id);
    root.current?.querySelector<HTMLButtonElement>(`[data-ribbon-tab="${next.id}"]`)?.focus();
  };

  const showBody = !collapsed || dropped;
  return (
    <Ctx.Provider value={{ commands, toolbar, done }}>
    <div className={`ribbon${collapsed ? ' collapsed' : ''}`} ref={root}>
      <div className="rb-tabs" role="tablist" aria-label="Ribbon" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`rb-tab${t.id === 'modify' ? ' modify' : ''}`}
            data-ribbon-tab={t.id}
            aria-selected={tab === t.id && showBody}
            tabIndex={tab === t.id ? 0 : -1}
            title={collapsed ? 'Double-click to pin the ribbon open' : 'Double-click to collapse the ribbon'}
            onClick={() => {
              if (collapsed) setDropped(!(dropped && tab === t.id));
              pick(t.id);
            }}
            onDoubleClick={() => onCollapsedChange(!collapsed)}
          >
            {t.label}
            {t.id === 'modify' && state.selected.size > 0 && <span className="rb-tab-badge" title={`${state.selected.size} selected`}>{state.selected.size}</span>}
          </button>
        ))}
        <span className="grow" />
        {displayMenu}
      </div>
      {showBody && (
        <div className="rb-body" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
          {body(tab)}
          <span className="grow" />
          {!collapsed && (
            <button type="button" className="rb-collapse" title={`Collapse the ribbon to its tabs${shortcutLabel('window.collapseRibbon') ? ` (${shortcutLabel('window.collapseRibbon')})` : ''}`} aria-label="Collapse the ribbon" onClick={() => onCollapsedChange(true)}>
              ︿
            </button>
          )}
          {collapsed && dropped && (
            <button type="button" className="rb-collapse" title="Keep the ribbon open" aria-label="Pin the ribbon open" onClick={() => onCollapsedChange(false)}>
              📌
            </button>
          )}
        </div>
      )}
    </div>
    </Ctx.Provider>
  );
}

/**
 * The toolbar's display options, as Word's Ribbon Display Options: the full ribbon, its tabs only,
 * or the one-row simplified toolbar.
 */
export function ToolbarDisplayMenu({ commands }: { commands: ReadonlyMap<string, Command> }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
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
  const items: { id: string; label: string; hint: string }[] = [
    { id: 'window.ribbon', label: 'Show Tabs and Commands', hint: 'The full ribbon, always open' },
    { id: 'window.ribbonTabs', label: 'Show Tabs Only', hint: 'Click a tab to show its commands' },
    { id: 'window.simplifiedToolbar', label: 'Simplified Toolbar', hint: 'Tools and style in one row' },
  ];
  return (
    <div className="rb-display" ref={root}>
      <button type="button" className="btn rb-display-btn" title="Toolbar display options" aria-label="Toolbar display options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {ic('M1.5 2.5h13v4h-13zM1.5 9h13M1.5 12h8')}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="rb-display-menu" role="menu" aria-label="Toolbar display options">
          {items.map(({ id, label, hint }) => {
            const c = commands.get(id);
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={!!c?.checked}
                className={`menu-item${c?.checked ? ' checked' : ''}`}
                onClick={() => {
                  setOpen(false);
                  c?.run();
                }}
              >
                <span className="check">{c?.checked ? '●' : ''}</span>
                <span className="label">
                  {label}
                  <small>{hint}</small>
                </span>
                {shortcutLabel(id) && <span className="sc">{shortcutLabel(id)}</span>}
              </button>
            );
          })}
          <div className="menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              commands.get('window.toolbar')?.run();
            }}
          >
            <span className="check" />
            <span className="label">Hide Toolbar</span>
          </button>
        </div>
      )}
    </div>
  );
}
