import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { DEFAULT_SCALE, type Scale } from '@nb/measure';
import { SOURCE_RANK, type DetectedLink, type SheetInfo } from '@nb/sheets';
import { DEFAULT_STATUSES, type ColumnSet } from './columns';
import { mapGeometry, type Markup, type Point } from './model';
import { rotatePagePoint, type PagePlan } from './pages';
import { remapBookmarks, type Bookmark, type Place } from './bookmarks';
import { scaleOfMarkup, viewportAt, type Viewport } from './viewports';
import { TYPE_INFO } from './types';

/**
 * `auto`: detected with high confidence and active. `review`: detected with low confidence; active
 * but flagged for a person to check. `accepted`/`rejected`: a person decided; rejected links are
 * hidden and are not re-suggested by later detection runs.
 */
export type LinkStatus = 'auto' | 'review' | 'accepted' | 'rejected';

export interface StoredLink extends DetectedLink {
  status: LinkStatus;
}

/** One stitched run of sheets: each sheet's placement in a shared space, and the pairings. */
export interface StoredStitchGroup {
  placements: {
    pageIndex: number;
    /** Affine [a, b, c, d, e, f] from page space to the group's world space. */
    toWorld: [number, number, number, number, number, number];
    clips: { point: [number, number]; normal: [number, number] }[];
  }[];
  edges: { a: number; b: number; station: string | null; votes: number; confidence: number }[];
}

const DEFAULT_COLUMN_SET: ColumnSet = { columns: [], statuses: DEFAULT_STATUSES };

/** Detected links at or above this confidence are active without review. */
const LINK_AUTO_CONFIDENCE = 0.75;

/** Transaction origin for edits made by this client; the undo manager only tracks these. */
const LOCAL = Symbol('local');
/** Origin for automatic sheet detection: persisted and synced, but not undoable. */
const DETECTION = Symbol('detection');

/**
 * Markups for one PDF, held in a Yjs document so offline edits persist locally (IndexedDB) and
 * merge cleanly once a sync provider is attached. Each markup is stored whole under its id;
 * concurrent edits to the same markup resolve last-writer-wins, edits to different markups merge.
 */
export class MarkupStore {
  readonly doc = new Y.Doc();
  readonly map: Y.Map<Markup>;
  /** Drawing scale per page, keyed by page index. */
  readonly scales: Y.Map<Scale>;
  /** Sheet number/title per page, keyed by page index. */
  readonly sheets: Y.Map<SheetInfo>;
  /** Hyperlinks between sheets, keyed by the link's stable id. */
  readonly links: Y.Map<StoredLink>;
  /** Viewports (page regions with their own scale), keyed by id. */
  readonly viewports: Y.Map<Viewport>;
  /** The bookmark tree (`bookmarks`) and Places (`places`), each stored whole. */
  readonly outline: Y.Map<unknown>;
  /** Small document-level flags (e.g. whether link detection has run). */
  readonly meta: Y.Map<unknown>;
  readonly undoManager: Y.UndoManager;
  private persistence: IndexeddbPersistence;
  private listeners = new Set<() => void>();
  private snapshot: Markup[] = [];
  private scaleSnapshot: Readonly<Record<number, Scale>> = {};
  private sheetSnapshot: Readonly<Record<number, SheetInfo>> = {};
  private linkSnapshot: StoredLink[] = [];
  private stitchSnapshot: StoredStitchGroup[] = [];
  private bookmarkSnapshot: Bookmark[] = [];
  private placeSnapshot: Place[] = [];
  private viewportSnapshot: Viewport[] = [];
  private columnRaw: unknown = undefined;
  private columnSnapshot: ColumnSet = DEFAULT_COLUMN_SET;
  private locked = false;

  readonly fileHash: string;

  private constructor(fileHash: string) {
    this.fileHash = fileHash;
    this.map = this.doc.getMap<Markup>('markups');
    this.scales = this.doc.getMap<Scale>('scales');
    this.sheets = this.doc.getMap<SheetInfo>('sheets');
    this.links = this.doc.getMap<StoredLink>('links');
    this.meta = this.doc.getMap('meta');
    this.outline = this.doc.getMap('outline');
    this.viewports = this.doc.getMap<Viewport>('viewports');
    this.undoManager = new Y.UndoManager([this.map, this.scales, this.sheets, this.links, this.outline, this.viewports], { trackedOrigins: new Set([LOCAL]), captureTimeout: 300 });
    // Each undo step is labelled with what it did, for the Undo History list.
    const label = (event: { stackItem: { meta: Map<unknown, unknown> }; changedParentTypes: Map<Y.AbstractType<Y.YEvent<never>>, Y.YEvent<never>[]> }) => {
      const text = describeChange(event.changedParentTypes, this.map, this.scales, this.viewports, this.outline);
      const had = event.stackItem.meta.get('label') as string | undefined;
      // Changes merged into one step (typing, dragging) keep the first description unless it said less.
      if (!had || had === 'Edit') event.stackItem.meta.set('label', text);
      if (!event.stackItem.meta.has('at')) event.stackItem.meta.set('at', Date.now());
    };
    this.undoManager.on('stack-item-added', label as never);
    this.undoManager.on('stack-item-updated', label as never);
    this.persistence = new IndexeddbPersistence(`nb-markups-${fileHash}`, this.doc);
    this.map.observe(() => this.refresh());
    this.scales.observe(() => this.refresh());
    this.sheets.observe(() => this.refresh());
    this.links.observe(() => this.refresh());
    this.meta.observe(() => this.refresh());
    this.outline.observe(() => this.refresh());
    this.viewports.observe(() => this.refresh());
  }

  private refresh() {
    this.snapshot = [...this.map.values()];
    this.scaleSnapshot = Object.fromEntries([...this.scales.entries()].map(([k, v]) => [Number(k), v]));
    this.sheetSnapshot = Object.fromEntries([...this.sheets.entries()].map(([k, v]) => [Number(k), v]));
    this.linkSnapshot = [...this.links.values()];
    this.stitchSnapshot = (this.meta.get('stitch') as StoredStitchGroup[] | undefined) ?? [];
    this.bookmarkSnapshot = (this.outline.get('bookmarks') as Bookmark[] | undefined) ?? [];
    this.placeSnapshot = (this.outline.get('places') as Place[] | undefined) ?? [];
    this.viewportSnapshot = [...this.viewports.values()];
    const raw = this.meta.get('columns');
    if (raw !== this.columnRaw) {
      this.columnRaw = raw;
      const set = raw as Partial<ColumnSet> | undefined;
      this.columnSnapshot = set ? { columns: set.columns ?? [], statuses: set.statuses?.length ? set.statuses : DEFAULT_STATUSES } : DEFAULT_COLUMN_SET;
    }
    for (const l of this.listeners) l();
  }

  /**
   * Read-only stores ignore every edit (a finished Live Session, or one where the host has locked
   * markups): the sync server would drop them, so they must not appear locally either.
   */
  get readOnly(): boolean {
    return this.locked;
  }

  setReadOnly(readOnly: boolean) {
    if (this.locked === readOnly) return;
    this.locked = readOnly;
    this.refresh();
  }

  static async open(fileHash: string): Promise<MarkupStore> {
    const store = new MarkupStore(fileHash);
    await store.persistence.whenSynced;
    store.refresh();
    return store;
  }

  /** The page's scale, or the 1:1 default when none has been set. */
  scaleFor(pageIndex: number): Scale {
    return this.scaleSnapshot[pageIndex] ?? DEFAULT_SCALE;
  }

  /** The scale at a point: its viewport's, else the page's. */
  scaleAt(pageIndex: number, p: Point): Scale {
    return viewportAt(this.viewportSnapshot, pageIndex, p)?.scale ?? this.scaleFor(pageIndex);
  }

  /** The scale a markup is measured at: its viewport's, else its page's. */
  scaleOf(m: Pick<Markup, 'points' | 'pageIndex'>): Scale {
    return scaleOfMarkup(m, this.scaleFor(m.pageIndex), this.viewportSnapshot);
  }

  /** Every viewport (stable until the next change). */
  allViewports(): Viewport[] {
    return this.viewportSnapshot;
  }

  setViewport(v: Viewport) {
    if (this.locked) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => this.viewports.set(v.id, v), LOCAL);
  }

  removeViewport(id: string) {
    if (this.locked) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => this.viewports.delete(id), LOCAL);
  }

  hasScale(pageIndex: number): boolean {
    return pageIndex in this.scaleSnapshot;
  }

  /** Stable object until the next change (safe for React's useSyncExternalStore). */
  allScales(): Readonly<Record<number, Scale>> {
    return this.scaleSnapshot;
  }

  setScale(pageIndexes: Iterable<number>, scale: Scale) {
    if (this.locked) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => {
      for (const i of pageIndexes) this.scales.set(String(i), scale);
    }, LOCAL);
  }

  /** Stable object until the next change (safe for React's useSyncExternalStore). */
  allSheets(): Readonly<Record<number, SheetInfo>> {
    return this.sheetSnapshot;
  }

  /**
   * Records detected sheet info. An entry only replaces one from an equal or weaker source, so an
   * AI result never overwrites a manual edit and a re-run of text detection never overwrites AI.
   */
  setDetectedSheets(entries: Iterable<[pageIndex: number, info: SheetInfo]>) {
    if (this.locked) return;
    this.doc.transact(() => {
      for (const [i, info] of entries) {
        const current = this.sheets.get(String(i));
        if (!current || SOURCE_RANK[info.source] >= SOURCE_RANK[current.source]) this.sheets.set(String(i), info);
      }
    }, DETECTION);
  }

  /** Stable array until the next change (safe for React's useSyncExternalStore). */
  allLinks(): StoredLink[] {
    return this.linkSnapshot;
  }

  linksDetected(): boolean {
    return this.meta.get('linksDetected') === true;
  }

  /**
   * Replaces automatically detected links with a new detection run. Links a person accepted or
   * rejected keep that decision (matched by stable id); stale undecided links are removed.
   */
  setDetectedLinks(detected: readonly DetectedLink[]) {
    if (this.locked) return;
    // Callouts already covered by a link that came with the PDF are not suggested again.
    const pdfLinks = [...this.links.values()].filter((l) => l.id.startsWith('pdf-'));
    const overlaps = (a: DetectedLink, b: DetectedLink) => {
      const w = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
      const h = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
      return w > 0 && h > 0 && w * h > 0.5 * Math.min(a.rect.w * a.rect.h, b.rect.w * b.rect.h);
    };
    detected = detected.filter((l) => !pdfLinks.some((p) => p.pageIndex === l.pageIndex && overlaps(p, l)));
    this.doc.transact(() => {
      const fresh = new Set(detected.map((l) => l.id));
      for (const [id, link] of this.links) {
        if (!fresh.has(id) && !id.startsWith('pdf-') && (link.status === 'auto' || link.status === 'review')) this.links.delete(id);
      }
      for (const l of detected) {
        const current = this.links.get(l.id);
        const decided = current && (current.status === 'accepted' || current.status === 'rejected');
        const status: LinkStatus = decided ? current.status : l.confidence >= LINK_AUTO_CONFIDENCE ? 'auto' : 'review';
        this.links.set(l.id, { ...l, status });
      }
      this.meta.set('linksDetected', true);
    }, DETECTION);
  }

  /** Stitched sheet groups (stable until the next change). */
  stitchGroups(): StoredStitchGroup[] {
    return this.stitchSnapshot;
  }

  stitchDetected(): boolean {
    return this.meta.has('stitch');
  }

  setStitch(groups: StoredStitchGroup[]) {
    if (this.locked) return;
    this.doc.transact(() => this.meta.set('stitch', groups), DETECTION);
  }

  setLinkStatus(id: string, status: LinkStatus) {
    if (this.locked) return;
    const link = this.links.get(id);
    if (!link) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => this.links.set(id, { ...link, status }), LOCAL);
  }

  /** The bookmark tree (stable until the next change). */
  bookmarks(): Bookmark[] {
    return this.bookmarkSnapshot;
  }

  places(): Place[] {
    return this.placeSnapshot;
  }

  setBookmarks(tree: Bookmark[]) {
    if (this.locked) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => this.outline.set('bookmarks', tree), LOCAL);
  }

  setPlaces(places: Place[]) {
    if (this.locked) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => this.outline.set('places', places), LOCAL);
  }

  /** Whether the PDF's own outline has been read in (after which the tree here is the outline). */
  outlineImported(): boolean {
    return this.meta.get('outlineImported') === true;
  }

  /** One-time import of the PDF's bookmarks; not undoable. */
  importOutline(tree: Bookmark[]) {
    if (this.locked) return;
    this.doc.transact(() => {
      if (!this.outline.has('bookmarks')) this.outline.set('bookmarks', tree);
      this.meta.set('outlineImported', true);
    }, DETECTION);
  }

  annotationsImported(): boolean {
    return this.meta.get('annotationsImported') === true;
  }

  /**
   * Existing PDF annotations now represented here, by page and /Annots index. They stay hidden
   * while viewing (even if the markup is later deleted) and are replaced on export.
   */
  importedAnnotations(): Record<number, number[]> {
    return (this.meta.get('importedAnnotations') as Record<number, number[]> | undefined) ?? {};
  }

  /**
   * One-time import of the PDF's own markups and links. Runs once per document: afterwards the
   * imported markups are edited here like any others.
   */
  importAnnotations(markups: readonly Markup[], links: readonly DetectedLink[], imported: Record<number, number[]>) {
    if (this.locked) return;
    this.doc.transact(() => {
      for (const m of markups) if (!this.map.has(m.id)) this.map.set(m.id, m);
      for (const l of links) if (!this.links.has(l.id)) this.links.set(l.id, { ...l, status: 'accepted' });
      this.meta.set('importedAnnotations', imported);
      this.meta.set('annotationsImported', true);
    }, DETECTION);
  }

  /**
   * Follows the PDF through page operations (delete, move, insert, rotate): every markup, scale,
   * sheet, link and imported-annotation record moves to its page's new index, geometry on rotated
   * pages is rotated with the page, and anything on deleted pages is dropped. Stitching is cleared
   * to be recomputed. Undo history is cleared: it refers to the old page numbers.
   */
  remapPages(plan: PagePlan, oldSizes: readonly { width: number; height: number }[]) {
    if (this.locked) return;
    const to = (i: number) => plan.oldToNew[i] ?? null;
    const turn = (page: number, p: readonly [number, number]): Point => {
      const size = oldSizes[page];
      return size && plan.turns[page] ? rotatePagePoint([p[0], p[1]], size.width, size.height, plan.turns[page]!) : [p[0], p[1]];
    };
    const turnRect = (page: number, r: { x: number; y: number; w: number; h: number }) => {
      const a = turn(page, [r.x, r.y]);
      const b = turn(page, [r.x + r.w, r.y + r.h]);
      return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    };
    this.doc.transact(() => {
      for (const [id, m] of [...this.map.entries()]) {
        const n = to(m.pageIndex);
        if (n === null) this.map.delete(id);
        else {
          const next: Markup = { ...m, pageIndex: n, ...mapGeometry(m, (p) => turn(m.pageIndex, p)) };
          // Hyperlinks to a page follow it; one whose target page was deleted loses its action.
          if (m.link?.kind === 'page') {
            const t = to(m.link.pageIndex);
            if (t === null) delete next.link;
            else next.link = { kind: 'page', pageIndex: t, rect: m.link.rect ? turnRect(m.link.pageIndex, m.link.rect) : null };
          }
          this.map.set(id, next);
        }
      }
      for (const [id, l] of [...this.links.entries()]) {
        const from = to(l.pageIndex);
        const target = to(l.targetPage);
        if (from === null || target === null) this.links.delete(id);
        else this.links.set(id, { ...l, pageIndex: from, targetPage: target, rect: turnRect(l.pageIndex, l.rect), targetRect: l.targetRect ? turnRect(l.targetPage, l.targetRect) : null });
      }
      for (const ymap of [this.scales, this.sheets] as Y.Map<unknown>[]) {
        const entries = [...ymap.entries()];
        ymap.clear();
        for (const [k, v] of entries) {
          const n = to(Number(k));
          if (n !== null) ymap.set(String(n), v);
        }
      }
      const imported: Record<number, number[]> = {};
      for (const [k, v] of Object.entries(this.importedAnnotations())) {
        const n = to(Number(k));
        if (n !== null) imported[n] = v;
      }
      this.meta.set('importedAnnotations', imported);
      this.meta.delete('stitch');
      for (const [id, v] of [...this.viewports.entries()]) {
        const n = to(v.pageIndex);
        if (n === null) this.viewports.delete(id);
        else this.viewports.set(id, { ...v, pageIndex: n, rect: turnRect(v.pageIndex, v.rect) });
      }
      if (this.outline.has('bookmarks')) this.outline.set('bookmarks', remapBookmarks(this.bookmarkSnapshot, to, turnRect));
      if (this.outline.has('places'))
        this.outline.set('places', this.placeSnapshot.flatMap((p) => {
          const n = to(p.pageIndex);
          return n === null ? [] : [{ ...p, pageIndex: n, rect: p.rect ? turnRect(p.pageIndex, p.rect) : null }];
        }));
    }, DETECTION);
    this.undoManager.clear();
  }

  /**
   * Follows pages whose content was moved or scaled in page space (Crop Pages, Page Setup): every
   * markup, link, viewport, bookmark and Place on them goes through `p → p × scale + (dx, dy)`,
   * and markups' line widths and text sizes scale too. Undo history is cleared: the file changed.
   */
  transformPages(transforms: ReadonlyMap<number, { scale: number; dx: number; dy: number }>) {
    if (this.locked || !transforms.size) return;
    const pt = (page: number, [x, y]: readonly [number, number]): Point => {
      const t = transforms.get(page);
      return t ? [x * t.scale + t.dx, y * t.scale + t.dy] : [x, y];
    };
    const rect = (page: number, r: { x: number; y: number; w: number; h: number }) => {
      const t = transforms.get(page);
      return t ? { x: r.x * t.scale + t.dx, y: r.y * t.scale + t.dy, w: r.w * t.scale, h: r.h * t.scale } : r;
    };
    const rectOrNull = <R extends { x: number; y: number; w: number; h: number }>(page: number, r: R | null) => (r ? rect(page, r) : null);
    this.doc.transact(() => {
      for (const [id, m] of [...this.map.entries()]) {
        const t = transforms.get(m.pageIndex);
        const link = m.link?.kind === 'page' && transforms.has(m.link.pageIndex) ? { ...m.link, rect: rectOrNull(m.link.pageIndex, m.link.rect) } : m.link;
        if (!t && link === m.link) continue;
        const next: Markup = { ...m, ...(t ? mapGeometry(m, (p) => pt(m.pageIndex, p)) : {}) };
        if (link) next.link = link;
        if (t && t.scale !== 1) {
          const k = t.scale;
          next.style = { ...m.style, width: m.style.width * k };
          for (const key of ['fontSize', 'arcRadius', 'leader'] as const) if (m.style[key] !== undefined) next.style[key] = m.style[key]! * k;
        }
        this.map.set(id, next);
      }
      for (const [id, l] of [...this.links.entries()]) {
        if (!transforms.has(l.pageIndex) && !transforms.has(l.targetPage)) continue;
        this.links.set(id, { ...l, rect: rect(l.pageIndex, l.rect), targetRect: rectOrNull(l.targetPage, l.targetRect) });
      }
      for (const [id, v] of [...this.viewports.entries()]) if (transforms.has(v.pageIndex)) this.viewports.set(id, { ...v, rect: rect(v.pageIndex, v.rect) });
      if (this.outline.has('bookmarks')) {
        // Point destinations (w = h = 0) move like areas.
        const walk = (list: Bookmark[]): Bookmark[] => list.map((b) => ({ ...b, rect: rectOrNull(b.pageIndex, b.rect), children: walk(b.children) }));
        this.outline.set('bookmarks', walk(this.bookmarkSnapshot));
      }
      if (this.outline.has('places')) this.outline.set('places', this.placeSnapshot.map((p) => ({ ...p, rect: rectOrNull(p.pageIndex, p.rect) })));
    }, DETECTION);
    this.undoManager.clear();
  }

  /**
   * Forgets which of the PDF's own annotations were imported on these pages (their pages were
   * replaced, so the old /Annots indices no longer apply).
   */
  forgetImported(pages: Iterable<number>) {
    if (this.locked) return;
    const imported = { ...this.importedAnnotations() };
    for (const p of pages) delete imported[p];
    this.doc.transact(() => this.meta.set('importedAnnotations', imported), DETECTION);
  }

  /**
   * Replaces every markup (Flatten burns them into the page; Unflatten brings them back). The PDF's
   * own annotations are no longer represented here, so the imported-annotation record is cleared.
   * Not undoable: the file changed underneath.
   */
  resetMarkups(markups: readonly Markup[]) {
    if (this.locked) return;
    this.doc.transact(() => {
      this.map.clear();
      for (const m of markups) this.map.set(m.id, m);
      this.meta.set('importedAnnotations', {});
    }, DETECTION);
    this.undoManager.clear();
  }

  /** A user's correction; always wins over detection. */
  editSheet(pageIndex: number, patch: Partial<Pick<SheetInfo, 'number' | 'title'>>) {
    if (this.locked) return;
    const current = this.sheets.get(String(pageIndex));
    const base: SheetInfo = current ?? { number: null, title: null, discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 };
    this.undoManager.stopCapturing();
    this.doc.transact(() => this.sheets.set(String(pageIndex), { ...base, ...patch, source: 'manual', confidence: 1 }), LOCAL);
  }

  /** The document's custom columns and statuses (stable until they change). */
  columnSet(): ColumnSet {
    return this.columnSnapshot;
  }

  /** Whether this document has its own column definitions (rather than the built-in defaults). */
  hasColumnSet(): boolean {
    return this.meta.has('columns');
  }

  setColumnSet(set: ColumnSet) {
    if (this.locked) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => this.meta.set('columns', { columns: set.columns, statuses: set.statuses }), LOCAL);
  }

  /** Sets one custom column's value on several markups as one undo step (empty clears it). */
  setField(ids: Iterable<string>, columnId: string, value: string) {
    if (this.locked) return;
    this.undoManager.stopCapturing();
    this.doc.transact(() => {
      for (const id of ids) {
        const m = this.map.get(id);
        if (!m) continue;
        const fields = { ...m.fields };
        if (value === '') delete fields[columnId];
        else fields[columnId] = value;
        this.map.set(id, { ...m, fields, modifiedAt: Date.now() });
      }
    }, LOCAL);
  }

  /** Stable array reference until the next change (safe for React's useSyncExternalStore). */
  all(): Markup[] {
    return this.snapshot;
  }

  forPage(pageIndex: number): Markup[] {
    return this.snapshot.filter((m) => m.pageIndex === pageIndex);
  }

  get(id: string): Markup | undefined {
    return this.map.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(markup: Markup) {
    if (this.locked) return;
    const clean: Record<string, unknown> = { ...markup };
    for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
    this.doc.transact(() => this.map.set(markup.id, clean as unknown as Markup), LOCAL);
  }

  /** Merges `patch` into a markup; a field patched to undefined is removed. */
  update(id: string, patch: Partial<Omit<Markup, 'id'>>) {
    if (this.locked) return;
    const current = this.map.get(id);
    if (!current) return;
    const next: Record<string, unknown> = { ...current, ...patch, modifiedAt: Date.now() };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    this.doc.transact(() => this.map.set(id, next as unknown as Markup), LOCAL);
  }

  remove(ids: Iterable<string>) {
    if (this.locked) return;
    this.doc.transact(() => {
      for (const id of ids) this.map.delete(id);
    }, LOCAL);
  }

  /** Ends the current undo step so the next edit is undone separately. */
  checkpoint() {
    this.undoManager.stopCapturing();
  }

  undo() {
    if (this.locked) return;
    this.undoManager.undo();
  }

  /** What can be undone, newest first: each step's description and when it was made. */
  undoHistory(): { label: string; at: number }[] {
    return this.undoManager.undoStack
      .map((item) => ({ label: (item.meta.get('label') as string | undefined) ?? 'Edit', at: (item.meta.get('at') as number | undefined) ?? 0 }))
      .reverse();
  }

  /** Undoes the newest `steps` steps (Undo History: step back to an earlier point). */
  undoSteps(steps: number) {
    if (this.locked) return;
    for (let i = 0; i < steps && this.undoManager.undoStack.length; i++) this.undoManager.undo();
  }

  redo() {
    if (this.locked) return;
    this.undoManager.redo();
  }

  async destroy() {
    this.listeners.clear();
    this.undoManager.destroy();
    await this.persistence.destroy();
    this.doc.destroy();
  }
}

/** A short description of one undo step: which markups it added, deleted or changed, or what else. */
function describeChange(
  changed: Map<Y.AbstractType<Y.YEvent<never>>, Y.YEvent<never>[]>,
  markups: Y.Map<Markup>,
  scales: Y.Map<Scale>,
  viewports: Y.Map<Viewport>,
  outline: Y.Map<unknown>,
): string {
  const ev = changed.get(markups as never)?.[0] as Y.YMapEvent<Markup> | undefined;
  if (ev) {
    const added: Markup[] = [];
    const removed: Markup[] = [];
    const updated: Markup[] = [];
    for (const [key, change] of ev.changes.keys) {
      if (change.action === 'add') added.push(markups.get(key)!);
      else if (change.action === 'delete') removed.push(change.oldValue as Markup);
      else {
        const now = markups.get(key)!;
        const was = change.oldValue as Markup;
        updated.push(now);
        // A single edit says what changed.
        if (ev.changes.keys.size === 1 && was) return `${editKind(was, now)} ${nameOf(now)}`;
      }
    }
    const say = (verb: string, list: Markup[]) => (list.length === 1 ? `${verb} ${nameOf(list[0]!)}` : `${verb} ${list.length} markups`);
    if (added.length && !removed.length && !updated.length) return say('Add', added);
    if (removed.length && !added.length && !updated.length) return say('Delete', removed);
    if (updated.length && !added.length && !removed.length) return say('Edit', updated);
    if (added.length && removed.length) return `Replace ${removed.length} markup${removed.length === 1 ? '' : 's'}`;
    return 'Edit markups';
  }
  if (changed.has(scales as never)) return 'Set scale';
  if (changed.has(viewports as never)) return 'Change viewports';
  if (changed.has(outline as never)) return 'Edit bookmarks';
  return 'Edit';
}

function nameOf(m: Markup): string {
  return m.subject || TYPE_INFO[m.type]?.label || 'markup';
}

/** What an edit to one markup did: moved it, reshaped, restyled, changed its text, status or other fields. */
function editKind(was: Markup, now: Markup): string {
  if (JSON.stringify(was.points) !== JSON.stringify(now.points)) {
    const dx = now.points[0]![0] - was.points[0]![0];
    const dy = now.points[0]![1] - was.points[0]![1];
    const movedOnly = was.points.length === now.points.length && now.points.every((p, i) => Math.abs(p[0] - was.points[i]![0] - dx) < 1e-6 && Math.abs(p[1] - was.points[i]![1] - dy) < 1e-6);
    return movedOnly ? 'Move' : 'Reshape';
  }
  if (JSON.stringify(was.style) !== JSON.stringify(now.style)) return 'Restyle';
  if ((was.text ?? '') !== (now.text ?? '')) return 'Edit text of';
  if ((was.comment ?? '') !== (now.comment ?? '')) return 'Comment on';
  if (was.status !== now.status) return 'Set status of';
  if ((was.replies?.length ?? 0) !== (now.replies?.length ?? 0)) return 'Reply to';
  if (!!was.hidden !== !!now.hidden) return now.hidden ? 'Hide' : 'Show';
  if ((was.rotation ?? 0) !== (now.rotation ?? 0)) return 'Rotate';
  if (!!was.locked !== !!now.locked) return now.locked ? 'Lock' : 'Unlock';
  return 'Edit';
}
