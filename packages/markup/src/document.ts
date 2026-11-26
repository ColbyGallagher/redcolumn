import type { GeoRegion, Scale } from '@nb/measure';
import type { DetectedLink, SheetInfo } from '@nb/sheets';
import type { AiReviewChange, AiReviewData, ReviewPassSettings } from './aiReview';
import type { Assembly } from './assemblies';
import type { Bookmark, Place } from './bookmarks';
import type { ColumnSet } from './columns';
import type { Estimating } from './estimating';
import type { Markup, Point } from './model';
import type { PagePlan } from './pages';
import type { Portal } from './portals';
import type { ImportedExtras, LinkStatus, PageClip, StoredLink, StoredManualStitch, StoredStitchGroup } from './store';
import type { Viewport } from './viewports';

// The editing surface the viewer, tools and panels use, split into a core every document has and
// facets a document may or may not offer. `MarkupStore` implements all of them; another store can
// implement the core and only the facets it supports. Code takes the narrowest set it needs, e.g.
// `MarkupDocument & TakeoffFacet`. Member names match `MarkupStore`'s.

/**
 * What an undo or redo did. `nothing`: there was no step to take. `forbidden`: the document does
 * not take edits now. `changed`: the step's target changed since. `offline`: it could not be sent.
 */
export type UndoResult = { ok: true } | { ok: false; reason: 'changed' | 'forbidden' | 'offline' | 'nothing' };

/** Scales, viewports, sheet numbers and titles, and the custom columns and statuses: read by every view, written when allowed. */
export interface DocumentSetup {
  /** The page's scale, or the 1:1 default when none has been set. */
  scaleFor(pageIndex: number): Scale;
  /** The scale at a point: its viewport's, else the page's. */
  scaleAt(pageIndex: number, p: Point): Scale;
  /** The scale a markup is measured at: its viewport's, else its page's. */
  scaleOf(m: Pick<Markup, 'points' | 'pageIndex'>): Scale;
  hasScale(pageIndex: number): boolean;
  /** Whether a point has a real scale: a calibrated viewport's, else its page's. */
  isScaledAt(pageIndex: number, p: Point): boolean;
  /** Stable object until the next change. */
  allScales(): Readonly<Record<number, Scale>>;
  setScale(pageIndexes: Iterable<number>, scale: Scale): void;
  /** A different scale on each of several pages, as one undo step. */
  setScales(entries: Iterable<readonly [number, Scale]>): void;
  /** Every viewport (stable until the next change). */
  allViewports(): Viewport[];
  setViewport(v: Viewport): void;
  removeViewport(id: string): void;
  /** Stable object until the next change. */
  allSheets(): Readonly<Record<number, SheetInfo>>;
  /** Records detected sheet info; an entry only replaces one from an equal or weaker source. */
  setDetectedSheets(entries: Iterable<[pageIndex: number, info: SheetInfo]>): void;
  /** A person's correction; always wins over detection. */
  editSheet(pageIndex: number, patch: Partial<Pick<SheetInfo, 'number' | 'title'>>): void;
  /** The document's custom columns and statuses (stable until they change). */
  columnSet(): ColumnSet;
  /** Whether this document has its own column definitions (rather than the built-in defaults). */
  hasColumnSet(): boolean;
  setColumnSet(set: ColumnSet): void;
}

/** The markups of one document, and the edits every document takes. */
export interface MarkupDocument extends DocumentSetup {
  /** Identifies the document (and so its contents) for caches and saved settings. */
  readonly key: string;
  /** Edits are ignored while true. */
  readonly readOnly: boolean;
  /** Whether this person may change the markup itself, not only its status and replies. */
  mayEdit(m: Pick<Markup, 'author'>): boolean;
  /** Counts changes made here since the document opened; a different count than at the last save means unsaved changes. */
  readonly editCount: number;
  /** Calls `listener` after any change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Stable array reference until the next change. */
  all(): Markup[];
  forPage(pageIndex: number): Markup[];
  get(id: string): Markup | undefined;
  add(markup: Markup): void;
  /** Merges `patch` into a markup; a field patched to undefined is removed. */
  update(id: string, patch: Partial<Omit<Markup, 'id'>>): void;
  remove(ids: Iterable<string>): void;
  /** Runs several edits as one change: listeners hear once, and they are one undo step. */
  batch(fn: () => void): void;
  /** Sets one custom column's value on several markups as one undo step (empty clears it). */
  setField(ids: Iterable<string>, columnId: string, value: string): void;
  /** The document's page count, when known (what refers to pages past it is ignored). */
  setPageCount(count: number): void;
  /** Ends the current undo step so the next edit is undone separately. */
  checkpoint(): void;
  undo(): UndoResult | Promise<UndoResult>;
  redo(): UndoResult | Promise<UndoResult>;
  /** What can be undone, newest first: each step's description and when it was made. */
  undoHistory(): { label: string; at: number }[];
  /** Undoes the newest `steps` steps. */
  undoSteps(steps: number): void;
  destroy(): Promise<void>;
}

/** Assemblies and the estimating library (catalog items, product lists, takeoff templates). */
export interface TakeoffFacet {
  /** The document's assemblies (stable until they change). */
  assemblies(): Assembly[];
  setAssemblies(list: readonly Assembly[]): void;
  /** The assemblies with their items' catalog links filled in (stable until either changes). */
  resolvedAssemblies(): Assembly[];
  /** The document's catalog items, product lists and takeoff templates (stable until they change). */
  estimating(): Estimating;
  /** Replaces some or all of the catalog items, product lists and templates, as one undo step. */
  setEstimating(patch: Partial<Estimating>): void;
}

/** What an AI assistant proposes for a person to review, and the optional review pass. */
export interface AiReviewFacet {
  /** AI proposals waiting for review, and the AI drafts a person rejected. */
  aiReview(): AiReviewData;
  /** The review list as a saved file keeps it. */
  aiReviewForSave(): AiReviewData;
  /** Adds, replaces or removes review entries. `byAi`: an AI client's change, not undone by the person's Undo. */
  changeAiReview(change: AiReviewChange, byAi?: boolean): void;
  reviewPass(): ReviewPassSettings;
  setReviewPass(next: ReviewPassSettings, byAi?: boolean): void;
  /** Adds links an AI assistant proposed, each waiting for a person. Returns the stored ids. */
  proposeLinks(links: readonly DetectedLink[]): string[];
}

/** Portals: regions of pages kept in step with each other. */
export interface PortalFacet {
  portals(): Portal[];
  /** Adds a portal, or replaces the one with its id. Says what linking or unlinking pages did. */
  setPortal(portal: Portal): { copied: number; adopted: number; unlinked: number };
  removePortal(id: string): void;
  breakPortalLinks(ids: Iterable<string>): void;
}

/** Links between sheets, the bookmark tree and Places, and the drawing standard sheets are read with. */
export interface LinkFacet {
  /** Stable array until the next change. */
  allLinks(): StoredLink[];
  linksDetected(): boolean;
  /** Ids of the taught marks this document was last searched for. */
  marksSearched(): string[];
  /** Replaces automatically detected links with a new detection run; a person's decisions stay. */
  setDetectedLinks(detected: readonly DetectedLink[]): void;
  /** Replaces the link candidates found from taught marks. */
  setMarkLinks(found: readonly DetectedLink[], markIds: readonly string[]): void;
  setLinkStatus(id: string, status: LinkStatus): void;
  /** The bookmark tree (stable until the next change). */
  bookmarks(): Bookmark[];
  places(): Place[];
  setBookmarks(tree: Bookmark[]): void;
  setPlaces(places: Place[]): void;
  /** Whether the PDF's own outline has been read in. */
  outlineImported(): boolean;
  /** One-time import of the PDF's bookmarks; not undoable. */
  importOutline(tree: Bookmark[]): void;
  /** Chooses the drawing standard this document is read with, or none. */
  setDrawingStandard(standard: { id: string; hash: string } | null): void;
  /** Drawing standards a person said this document is not drawn to. */
  declinedStandards(): string[];
  declineStandard(id: string): void;
  /** The drawing standard this document was last read with, if any. */
  drawingStandard(): { id: string; hash: string } | null;
}

/** Sheets stitched into one drawing: detected groups and hand-placed match lines. */
export interface StitchFacet {
  /** Stitched sheet groups (stable until the next change). */
  stitchGroups(): StoredStitchGroup[];
  stitchDetected(): boolean;
  setStitch(groups: StoredStitchGroup[]): void;
  /** Match lines and drawing regions placed by hand (stable until the next change). */
  manualStitch(): StoredManualStitch;
  setManualStitch(next: StoredManualStitch): void;
}

/** Map registrations of pages (geospatial PDFs). */
export interface GeoFacet {
  /** The file's map registrations, stable until the next change. */
  allGeoRegions(): GeoRegion[];
  /** Whether the file was read for map registrations. */
  geoChecked(): boolean;
  /** Records the file's map registrations, read from its bytes. */
  setGeoRegions(regions: GeoRegion[]): void;
  /** Pages whose map registration was made (or removed) here. */
  geoEditedPages(): number[];
  /** The registrations made here, by page, for export. */
  editedGeo(): Record<number, GeoRegion[]>;
  setPageGeo(pageIndex: number, regions: GeoRegion[]): void;
  setPagesGeo(byPage: Readonly<Record<number, GeoRegion[]>>): void;
}

/** Reading the PDF's own annotations into markups, and what was read. */
export interface ImportFacet {
  annotationsImported(): boolean;
  /** Which version of the importer read this document's own markups. */
  importVersion(): number;
  /** Reads other tools' markups again with a newer importer; those edited since stay. */
  refreshImported(markups: readonly Markup[], version: number): void;
  /** True after image markups imported as empty rectangles have been checked once. */
  imageMarkupsChecked(): boolean;
  setImageMarkupsChecked(): void;
  /** Gives image markups imported as empty rectangles their pictures back. */
  restoreImageMarkups(patches: readonly { id: string; image: string; points: Markup['points'] }[]): void;
  /** Existing PDF annotations now represented here, by page and /Annots index. */
  importedAnnotations(): Record<number, number[]>;
  /** The PDF's own Bluebeam Spaces now represented here, by page and /BSISpaces index. */
  importedSpaces(): Record<number, number[]>;
  /** One-time import of the PDF's own markups and links (and what comes with them). */
  importAnnotations(markups: readonly Markup[], links: readonly DetectedLink[], imported: Record<number, number[]>, extras?: ImportedExtras): void;
}

/** Following changes to the document's file: page operations, page setup, flattening. */
export interface FileStepFacet {
  /** Follows the PDF through page operations (delete, move, insert, rotate). */
  remapPages(plan: PagePlan, oldSizes: readonly { width: number; height: number }[]): void;
  /** What is attached to `pages`, for {@link pastePages}. */
  copyPages(pages: readonly number[]): PageClip[];
  /** Puts what {@link copyPages} took onto pasted copies of those pages, starting at index `at`. */
  pastePages(clips: readonly PageClip[], at: number): void;
  /** Follows pages whose content was moved or scaled in page space. */
  transformPages(transforms: ReadonlyMap<number, { scale: number; dx: number; dy: number }>): void;
  /** Forgets which of the PDF's own annotations were imported on these pages. */
  forgetImported(pages: Iterable<number>): void;
  /** Drops markups flattened into their pages, with the annotations that went with them. */
  removeFlattened(ids: Iterable<string>, removed: Record<number, readonly number[]>): void;
  /** Replaces every markup (Flatten and Unflatten). */
  resetMarkups(markups: readonly Markup[]): void;
  /** Records a change to the file (from `before` to `after`, by hash) as one undo step, with `remap`. */
  fileStep(label: string, before: string, after: string, remap?: () => void): void;
}
