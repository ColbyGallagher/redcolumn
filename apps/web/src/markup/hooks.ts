import { useSyncExternalStore } from 'react';
import { DEFAULT_STATUSES, DEFAULT_STYLES, type Assembly, type Bookmark, type ColumnSet, type Place, type Viewport, type Markup, type MarkupStore, type StoredLink, type StoredManualStitch, type StoredStitchGroup } from '@nb/markup';
import type { GeoRegion, Scale } from '@nb/measure';
import type { SheetInfo } from '@nb/sheets';
import type { MarkupTools, ToolsState } from './MarkupTools';

const EMPTY: Markup[] = [];
const IDLE: ToolsState = { tool: 'select', selected: new Set(), styles: DEFAULT_STYLES, snap: true, measuring: false, showLinks: true, preset: null, painterSource: null, fillAs: 'area', sketch: null, tableCells: null, cad: null, flowShape: 'process', connectorRoute: 'elbow' };
const NO_SCALES: Readonly<Record<number, Scale>> = {};
const NO_SHEETS: Readonly<Record<number, SheetInfo>> = {};
const noopSubscribe = () => () => {};

export function useMarkups(store: MarkupStore | null): Markup[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.all() ?? EMPTY);
}

export function useScales(store: MarkupStore | null): Readonly<Record<number, Scale>> {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.allScales() ?? NO_SCALES);
}

const NO_LINKS: StoredLink[] = [];
const NO_STITCH: StoredStitchGroup[] = [];
const NO_MANUAL_STITCH: StoredManualStitch = { lines: [], regions: {} };

export function useStitch(store: MarkupStore | null): StoredStitchGroup[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.stitchGroups() ?? NO_STITCH);
}

/** Match lines and drawing regions the user placed for stitching. */
export function useManualStitch(store: MarkupStore | null): StoredManualStitch {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.manualStitch() ?? NO_MANUAL_STITCH);
}

export function useLinks(store: MarkupStore | null): StoredLink[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.allLinks() ?? NO_LINKS);
}

export function useSheets(store: MarkupStore | null): Readonly<Record<number, SheetInfo>> {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.allSheets() ?? NO_SHEETS);
}

const NO_BOOKMARKS: Bookmark[] = [];
const NO_PLACES: Place[] = [];

export function useBookmarks(store: MarkupStore | null): Bookmark[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.bookmarks() ?? NO_BOOKMARKS);
}

export function usePlaces(store: MarkupStore | null): Place[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.places() ?? NO_PLACES);
}

const NO_VIEWPORTS: Viewport[] = [];

export function useViewports(store: MarkupStore | null): Viewport[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.allViewports() ?? NO_VIEWPORTS);
}

export function useToolsState(tools: MarkupTools | null): ToolsState {
  return useSyncExternalStore(tools?.subscribe ?? noopSubscribe, () => tools?.getState() ?? IDLE);
}

const NO_COLUMNS: ColumnSet = { columns: [], statuses: DEFAULT_STATUSES };

export function useColumnSet(store: MarkupStore | null): ColumnSet {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.columnSet() ?? NO_COLUMNS);
}

const NO_ASSEMBLIES: Assembly[] = [];

export function useAssemblies(store: MarkupStore | null): Assembly[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.assemblies() ?? NO_ASSEMBLIES);
}

const NO_GEO: GeoRegion[] = [];

/** The document's map registrations (geospatial PDF regions), from the file and made here. */
export function useGeoRegions(store: MarkupStore | null): GeoRegion[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noopSubscribe, () => store?.allGeoRegions() ?? NO_GEO);
}
