import type {
  AiReviewFacet,
  EditRule,
  FileStepFacet,
  GeoFacet,
  ImportFacet,
  LinkFacet,
  MarkupDocument,
  PortalFacet,
  StitchFacet,
  TakeoffFacet,
  YjsFacet,
} from '@nb/markup';
import type { SyncFacet } from '@nb/sync';

/*
 * The viewer works on one editing interface: a core every document has, and optional facets. A
 * file on this device (`MarkupStore`) has them all. A server document has none of these yet, and
 * says so; the app uses the guards here to hide the commands and panels that need one.
 */

/** What a document open in the viewer answers to, whether or not it offers each facet. */
export type AppDocument = MarkupDocument &
  TakeoffFacet &
  AiReviewFacet &
  PortalFacet &
  LinkFacet &
  StitchFacet &
  GeoFacet &
  ImportFacet &
  FileStepFacet & {
    setReadOnly(readOnly: boolean): void;
    setEditRule(rule: EditRule | null): void;
  };

export type FacetName =
  /** Assemblies, estimating and the other takeoff tools. */
  | 'takeoff'
  | 'aiReview'
  | 'portals'
  /** Sheet links, bookmarks, places and drawing standards. */
  | 'links'
  | 'stitch'
  | 'geo'
  /** Bringing in markups from the PDF or another file. */
  | 'import'
  /** Changes to the file itself: page operations, crop, flatten, redaction, OCR, forms. */
  | 'fileSteps'
  /** The Yjs document Live Sessions and Projects sync. */
  | 'yjs'
  /**
   * Writing the document setup (scales, viewports, page labels and custom columns) where everyone
   * with the document sees it. A document without it keeps its setup only as read from the file.
   */
  | 'setup';

/** A document that lacks facets it has stand-ins for says which. */
interface DeclaresFacets {
  readonly missingFacets?: ReadonlySet<FacetName>;
}

/** What a document has when it has a facet. */
const PROBES: Record<Exclude<FacetName, 'yjs'>, string> = {
  takeoff: 'setAssemblies',
  aiReview: 'changeAiReview',
  portals: 'setPortal',
  links: 'setDetectedLinks',
  stitch: 'setStitch',
  geo: 'setGeoRegions',
  import: 'importAnnotations',
  fileSteps: 'fileStep',
  setup: 'setScale',
};

/** Whether the document offers a facet. */
export function hasFacet(doc: object, name: FacetName): boolean {
  if ((doc as DeclaresFacets).missingFacets?.has(name)) return false;
  const member = (doc as unknown as Record<string, unknown>)[name === 'yjs' ? 'yjs' : PROBES[name]];
  return name === 'yjs' ? typeof member === 'object' && member !== null : typeof member === 'function';
}

export const hasFileSteps = (doc: MarkupDocument): doc is MarkupDocument & FileStepFacet => hasFacet(doc, 'fileSteps');
export const hasTakeoff = (doc: MarkupDocument): doc is MarkupDocument & TakeoffFacet => hasFacet(doc, 'takeoff');
export const hasAiReview = (doc: MarkupDocument): doc is MarkupDocument & AiReviewFacet => hasFacet(doc, 'aiReview');
export const hasPortals = (doc: MarkupDocument): doc is MarkupDocument & PortalFacet => hasFacet(doc, 'portals');
export const hasLinks = (doc: MarkupDocument): doc is MarkupDocument & LinkFacet => hasFacet(doc, 'links');
export const hasStitching = (doc: MarkupDocument): doc is MarkupDocument & StitchFacet => hasFacet(doc, 'stitch');
export const hasGeo = (doc: MarkupDocument): doc is MarkupDocument & GeoFacet => hasFacet(doc, 'geo');
export const hasImport = (doc: MarkupDocument): doc is MarkupDocument & ImportFacet => hasFacet(doc, 'import');
export const hasYjs = (doc: MarkupDocument): doc is MarkupDocument & YjsFacet => hasFacet(doc, 'yjs');

/** Whether the document is synced with a server, which keeps it saved. */
export const isSynced = (doc: MarkupDocument | null | undefined): boolean =>
  !!doc && typeof (doc as Partial<SyncFacet>).sync === 'object';
