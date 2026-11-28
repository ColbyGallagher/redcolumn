import { msg } from '@nb/i18n';
import type { MarkupType } from '@nb/markup';
import type { Command } from '../commands/appCommands.ts';
import type { CadTool } from '../markup/cadTools.ts';
import type { OtherTool, Tool } from '../markup/MarkupTools.ts';
import { hasFacet, isSynced, type AppDocument, type FacetName } from './facets.ts';

/*
 * Which commands, tools and panels need which facet. For a document without the facet they are
 * left out of the menus, ribbon, command palette and toolbar, and their shortcuts do nothing. A
 * file on this device has every facet, so nothing changes for it.
 */

const COMMANDS: Record<FacetName, readonly string[]> = {
  fileSteps: [
    'document.rotatePages',
    'document.rotateCounterclockwise',
    'document.insertPages',
    'document.bulkInsertPages',
    'document.insertBlank',
    'document.extractPages',
    'document.deletePages',
    'document.replacePages',
    'document.cropPages',
    'document.pageSetup',
    'document.headerFooter',
    'document.numberPages',
    'document.flatten',
    'document.unflatten',
    'document.reduceSize',
    'document.repair',
    'document.colour',
    'document.ocr',
    'document.slipSheet',
    'document.labelRegions',
    'document.revisions',
    'document.properties',
    'document.security',
    'document.pdfa',
    'document.convertDrawingAgain',
    'tools.applyRedactions',
    'tools.bulkRedact',
    'tools.sign',
    'tools.signatures',
    'tools.formField',
    'tools.forms',
    'tools.autoFields',
    'edit.eraseContent',
    'edit.cutContent',
    'edit.editText',
    'tool.redaction',
    'window.forms',
    'window.signatures',
  ],
  takeoff: [
    'tools.assemblies',
    'tools.library',
    'tools.quantities',
    'takeoff.manual',
    'takeoff.syncExcel',
    'takeoff.reports',
    'takeoff.hip',
    'takeoff.valley',
    'takeoff.items',
    'takeoff.productLists',
    'takeoff.templates',
    'takeoff.saveTemplate',
    'tool.cutout',
    'draw.arc',
    'tools.nextMeasure',
    'window.measurements',
  ],
  aiReview: ['tools.takeoffReview'],
  portals: ['takeoff.definePortal', 'takeoff.portals', 'takeoff.breakPortalLink'],
  links: [
    'document.addBookmark',
    'document.teachMark',
    'document.drawingStandards',
    'document.setUpDrawingStandard',
    'view.showLinks',
    'window.bookmarks',
    'window.links',
  ],
  stitch: ['view.stitched', 'document.stitching', 'document.stitchToPage', 'document.applyStitching'],
  geo: ['document.geospatial'],
  import: ['file.importXfdf', 'file.importFdf', 'file.importBax', 'file.importPdfMarkups', 'file.importXlsx'],
  yjs: ['window.sessions'],
  setup: [
    'tool.calibrate',
    'edit.createViewport',
    'edit.scaleToLength',
    'document.scaleRegions',
    'document.scaleReview',
    'document.thumbnails',
    'tools.columns',
  ],
};

const FACET_OF_COMMAND = new Map<string, FacetName>(
  (Object.entries(COMMANDS) as [FacetName, readonly string[]][]).flatMap(([facet, ids]) => ids.map((id) => [id, facet] as const)),
);

/**
 * The facet each tool needs. A tool can be armed by more than its `tool.` command, and stays armed
 * when another tab comes to the front, so what is armed is checked against this. Every tool that
 * does not draw a markup (the CAD tools apart, which only edit markups) is listed, so a new one
 * does not compile until it is.
 */
const OTHER_TOOL_FACETS = {
  select: null,
  lasso: null,
  painter: null,
  cloudPlus: null,
  eraser: null,
  offset: null,
  selectText: null,
  pan: null,
  zoomBox: null,
  dynamicZoom: null,
  snapshot: null,
  /** Crops a picture markup, not the page. */
  cropImage: null,
  calibrate: 'setup',
  viewport: 'setup',
  scaleLength: 'setup',
  labelRegion: 'setup',
  cutout: 'takeoff',
  dynamicFill: 'takeoff',
  visualSearch: 'takeoff',
  cropArea: 'fileSteps',
  eraseContent: 'fileSteps',
  cutContent: 'fileSteps',
  editText: 'fileSteps',
  formField: 'fileSteps',
  matchLine: 'stitch',
  stitchRegion: 'stitch',
  stitchPolygon: 'stitch',
  stitchMove: 'stitch',
  portalPolygon: 'portals',
} as const satisfies Record<Exclude<OtherTool, CadTool>, FacetName | null>;

/**
 * Markup tools that need a facet. Measuring tools belong to takeoff: what they report depends on
 * the page's scale, which is not shared yet, so the same measurement would read differently to
 * different people.
 */
const MARKUP_TOOL_FACETS: Partial<Record<MarkupType, FacetName>> = {
  redaction: 'fileSteps',
  length: 'takeoff',
  polylength: 'takeoff',
  perimeter: 'takeoff',
  arcLength: 'takeoff',
  diameter: 'takeoff',
  radius: 'takeoff',
  angle: 'takeoff',
  area: 'takeoff',
  volume: 'takeoff',
  count: 'takeoff',
  manual: 'takeoff',
};

const FACET_OF_TOOL: Readonly<Record<string, FacetName | null>> = { ...OTHER_TOOL_FACETS, ...MARKUP_TOOL_FACETS };

/** The facet a tool needs, if any. */
export function facetOfTool(tool: Tool): FacetName | null {
  return Object.hasOwn(FACET_OF_TOOL, tool) ? FACET_OF_TOOL[tool]! : null;
}

/** The commands listed above, for checking they exist. */
export const listedCommandIds = (): string[] => [...FACET_OF_COMMAND.keys(), ...SAVE_COMMANDS];

/** The facet a command needs, if any. */
export function facetOfCommand(id: string): FacetName | null {
  const direct = FACET_OF_COMMAND.get(id);
  if (direct) return direct;
  return id.startsWith('tool.') ? facetOfTool(id.slice(5) as Tool) : null;
}

/** A synced document is saved by the server: there is no Save, and nothing to revert to. */
const SAVE_COMMANDS: ReadonlySet<string> = new Set(['file.save', 'file.saveAll', 'file.revert']);

/**
 * Removes what the document in front cannot do. A removed command is disabled, so its shortcut
 * does nothing, and marked `managed`, which leaves it out of menus, the ribbon and the palette.
 */
export function applyFacetPolicy(commands: Command[], doc: AppDocument | null | undefined): Command[] {
  if (!doc) return commands;
  const synced = isSynced(doc);
  return commands.map((command) => {
    const facet = facetOfCommand(command.id);
    const missing = (facet !== null && !hasFacet(doc, facet)) || (synced && SAVE_COMMANDS.has(command.id));
    if (!missing) return command;
    return { ...command, enabled: false, managed: true as const, hint: msg('Not available for documents on a server yet') };
  });
}

const PANELS: Readonly<Record<string, FacetName>> = {
  bookmarks: 'links',
  links: 'links',
  stitching: 'stitch',
  geospatial: 'geo',
  forms: 'fileSteps',
  signatures: 'fileSteps',
  measurements: 'takeoff',
  sessions: 'yjs',
  projects: 'yjs',
};

/** Whether a side or bottom panel has nothing to offer the document in front. */
export function panelUnavailable(id: string, doc: AppDocument | null | undefined): boolean {
  const facet = Object.hasOwn(PANELS, id) ? PANELS[id] : undefined;
  return !!doc && !!facet && !hasFacet(doc, facet);
}

/** The ribbon tabs that would be empty or misleading for the document. */
export function hiddenRibbonTabs(doc: AppDocument | null | undefined): readonly string[] {
  return doc && !hasFacet(doc, 'takeoff') ? ['measure', 'takeoff'] : [];
}

/**
 * The tools the simplified toolbar shows: the profile's choice (`null`: all of `every`) without
 * those the document cannot use.
 */
export function toolsFor(doc: AppDocument | null | undefined, chosen: readonly Tool[] | null, every: readonly Tool[]): readonly Tool[] | null {
  if (!doc) return chosen;
  const unavailable = (tool: Tool) => {
    const facet = facetOfTool(tool);
    return facet !== null && !hasFacet(doc, facet);
  };
  if (!every.some(unavailable)) return chosen;
  return (chosen ?? every).filter((tool) => !unavailable(tool));
}
