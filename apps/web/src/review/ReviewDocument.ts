import { msg } from '@nb/i18n';
import {
  EMPTY_AI_REVIEW,
  EMPTY_ESTIMATING,
  IMPORT_VERSION,
  type AiReviewData,
  type Assembly,
  type Bookmark,
  type ColumnSet,
  type EditRule,
  type Estimating,
  type ImportedExtras,
  type Markup,
  type MarkupStatusDef,
  type PageClip,
  type Place,
  type Point,
  type Portal,
  type ReviewPassSettings,
  type StoredLink,
  type StoredManualStitch,
  type StoredStitchGroup,
  type UndoResult,
  type Viewport,
} from '@nb/markup';
import type { GeoRegion, Scale } from '@nb/measure';
import type { StatusDef, StatusCategory } from '@nb/ops';
import type { PresenceUser, StatusRules, SyncDocument, SyncFacet, SyncStatus } from '@nb/sync';
import type { SheetInfo } from '@nb/sheets';
import type { AppDocument, FacetName } from './facets.ts';
import type { SharedStatuses } from './statusUi.ts';
import type { ProjectRole } from '../connect/client.ts';

/*
 * A server document in the viewer: a `SyncDocument` behind the editing surface the viewer, tools
 * and panels use. The facets a server document does not offer are listed in `missingFacets`, so
 * the app hides what needs them. Their reads answer "nothing", and anything that would change the
 * file throws, so a path the app forgot to hide cannot silently change a copy only here.
 */

const MISSING_FACETS: ReadonlySet<FacetName> = new Set<FacetName>([
  'takeoff',
  'aiReview',
  'portals',
  'links',
  'stitch',
  'geo',
  'import',
  'fileSteps',
  'yjs',
  'setup',
]);

/** Thrown when something asks a server document to do what it does not offer. */
export class MissingFacetError extends Error {
  readonly facet: FacetName;

  constructor(facet: FacetName) {
    super(msg('That is not available for documents on a server yet.'));
    this.name = 'MissingFacetError';
    this.facet = facet;
  }
}

/** Markup fields that are separate records on a server, which this version does not write yet. */
const UNSYNCED_FIELDS = ['replies', 'raisedRev'] as const;

/** The colours the project's statuses are shown in: by what they mean, with the usual open ones told apart. */
const CATEGORY_COLOURS: Readonly<Record<StatusCategory, string>> = { open: '#d97706', closed: '#16a34a', void: '#6b7280' };
const STATUS_COLOURS: Readonly<Record<string, string>> = { actioned: '#7c3aed', answered: '#0891b2' };

/** The project's statuses as the status controls list them, with "None" for a markup that has no issue. */
const statusChoices = (statuses: readonly StatusDef[]): MarkupStatusDef[] => [
  { id: 'none', name: 'None', color: '#9aa1a9' },
  ...statuses.map((s) => ({
    id: s.id,
    name: s.name,
    color: (Object.hasOwn(STATUS_COLOURS, s.id) ? STATUS_COLOURS[s.id] : undefined) ?? CATEGORY_COLOURS[s.category],
  })),
];

const NO_ASSEMBLIES: Assembly[] = [];
const NO_PORTALS: Portal[] = [];
const NO_LINKS: StoredLink[] = [];
const NO_MARK_IDS: string[] = [];
const NO_BOOKMARKS: Bookmark[] = [];
const NO_PLACES: Place[] = [];
const NO_STITCH: StoredStitchGroup[] = [];
const NO_MANUAL_STITCH: StoredManualStitch = { lines: [], regions: {} };
const NO_GEO: GeoRegion[] = [];
const NO_PAGES_GEO: Record<number, GeoRegion[]> = {};
const NO_PAGE_NUMBERS: number[] = [];
const NO_IMPORTED: Record<number, number[]> = {};
const NO_REVIEW_PASS: ReviewPassSettings = { enabled: false };

/** The part of the sync transport the document shows and drives. */
export interface ReviewTransport {
  readonly connectionId: string | null;
  setPage(pageIndex: number): void;
  retryNow(): void;
  onPresence(listener: (users: PresenceUser[]) => void): () => void;
  onAccess(listener: (role: string, rules?: StatusRules) => void): () => void;
  onSessionEnded(listener: () => void): () => void;
}

export interface ReviewDocumentInfo {
  projectName: string;
  documentTitle: string;
  documentNumber: string;
  revisionLabel: string;
  userId: string;
  userName: string;
  role: ProjectRole;
  /** The project's status set. */
  statuses: readonly StatusDef[];
  rules: StatusRules;
}

const isRole = (role: string): role is ProjectRole => role === 'project_admin' || role === 'reviewer' || role === 'viewer';

export class ReviewDocument implements AppDocument, SyncFacet, SharedStatuses {
  readonly missingFacets = MISSING_FACETS;
  readonly info: ReviewDocumentInfo;
  readonly sync: SyncStatus;
  private readonly inner: SyncDocument;
  private readonly transport: ReviewTransport;
  /** Names by user id, for markup authors. */
  private readonly names: Map<string, string>;
  private readonly cleanups: (() => void | Promise<void>)[] = [];
  private readonly statusListeners = new Set<() => void>();
  private _role: ProjectRole;
  private _rules: StatusRules;
  private readonly statusDefs: MarkupStatusDef[];
  private columnCache: { from: ColumnSet; value: ColumnSet } | null = null;
  private forcedReadOnly = false;
  private _others: PresenceUser[] = [];
  private _problem: string | null = null;
  private _sessionEnded = false;
  private _statusVersion = 0;

  constructor(inner: SyncDocument, transport: ReviewTransport, info: ReviewDocumentInfo, names: Map<string, string>) {
    this.inner = inner;
    this.transport = transport;
    this.info = info;
    this.names = names;
    this.sync = inner.sync;
    this._role = info.role;
    this._rules = info.rules;
    this.statusDefs = statusChoices(info.statuses);
    this.applyRole();
    this.cleanups.push(
      inner.sync.subscribe(() => this.statusChanged()),
      transport.onPresence((users) => {
        for (const user of users) this.names.set(user.userId, user.name);
        this._others = users.filter((u) => u.connectionId !== transport.connectionId);
        this.statusChanged();
      }),
      transport.onAccess((role, rules) => {
        if (!isRole(role)) return;
        const next = rules ?? this._rules;
        if (role === this._role && JSON.stringify(next) === JSON.stringify(this._rules)) return;
        this._role = role;
        this._rules = next;
        this.applyRole();
        this.statusChanged();
      }),
      transport.onSessionEnded(() => {
        this._sessionEnded = true;
        this.statusChanged();
      }),
    );
  }

  // ---- What the status bar shows ----------------------------------------------------------

  get role(): ProjectRole {
    return this._role;
  }

  /** Other people with the document open (another window of one's own included). */
  get others(): readonly PresenceUser[] {
    return this._others;
  }

  /** Something the user tried that did not happen, until dismissed. */
  get problem(): string | null {
    return this._problem;
  }

  get sessionEnded(): boolean {
    return this._sessionEnded;
  }

  /** Changes whenever anything the status bar shows does. */
  get statusVersion(): number {
    return this._statusVersion;
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dismissProblem(): void {
    if (this._problem === null) return;
    this._problem = null;
    this.statusChanged();
  }

  report(problem: string): void {
    if (this._problem === problem) return;
    this._problem = problem;
    this.statusChanged();
  }

  setViewedPage(pageIndex: number): void {
    this.transport.setPage(pageIndex);
  }

  retryNow(): void {
    this.transport.retryNow();
  }

  /** Runs `cleanup` when the document is closed. */
  onDestroy(cleanup: () => void | Promise<void>): void {
    this.cleanups.push(cleanup);
  }

  private statusChanged(): void {
    this._statusVersion += 1;
    for (const listener of [...this.statusListeners]) listener();
  }

  private applyRole(): void {
    this.inner.setReadOnly(this.forcedReadOnly || this._role === 'viewer');
    // A hint for the tools: the server decides. Admins may change anyone's markups.
    this.inner.setEditRule(this._role === 'project_admin' ? null : this.ownRule);
  }

  private readonly ownRule: EditRule = (m) => {
    const id = (m as Partial<Markup>).id;
    const records = this.inner.viewState().markups;
    return !id || !Object.hasOwn(records, id) || records[id]!.owner.userId === this.info.userId;
  };

  private refuse(facet: FacetName): never {
    throw new MissingFacetError(facet);
  }

  private setupRefused(): void {
    this.report(msg('Scales, page labels and custom columns are not shared on a server yet, so they cannot be changed here.'));
  }

  // ---- Core -------------------------------------------------------------------------------

  get key(): string {
    return this.inner.key;
  }

  get readOnly(): boolean {
    return this.inner.readOnly;
  }

  get editCount(): number {
    return this.inner.editCount;
  }

  setReadOnly(readOnly: boolean): void {
    this.forcedReadOnly = readOnly;
    this.applyRole();
  }

  setEditRule(_rule: EditRule | null): void {
    // The rule follows the project role.
  }

  mayEdit(m: Pick<Markup, 'author'>): boolean {
    return this.inner.mayEdit(m);
  }

  subscribe(listener: () => void): () => void {
    return this.inner.subscribe(listener);
  }

  all(): Markup[] {
    return this.inner.all();
  }

  forPage(pageIndex: number): Markup[] {
    return this.inner.forPage(pageIndex);
  }

  get(id: string): Markup | undefined {
    return this.inner.get(id);
  }

  add(markup: Markup): void {
    // Adding a markup that is already here replaces it, and its issue stays as it is.
    if (!this.inner.get(markup.id)) {
      if (markup.replies?.length) this.repliesRefused();
      // A status or tick is the issue's: a new or copied markup has no issue yet.
      else if (markup.checked || (markup.status && markup.status !== 'none')) {
        this.report(msg('A new markup starts without a status or a tick.'));
      }
    }
    this.inner.add(markup);
  }

  update(id: string, patch: Partial<Omit<Markup, 'id'>>): void {
    const current = this.inner.get(id);
    if (!current) return;
    const rest: Record<string, unknown> = { ...patch };
    for (const key of UNSYNCED_FIELDS) {
      if (!(key in rest)) continue;
      if (JSON.stringify(rest[key]) !== JSON.stringify(current[key])) this.repliesRefused();
      delete rest[key];
    }
    // The history comes from the server's status events.
    delete rest.statusHistory;
    if ('status' in rest && rest.status !== current.status && !this.mayChooseStatus([id], rest.status as string)) {
      this.report(msg('You may not set that status here.'));
      delete rest.status;
    }
    if ('checked' in rest && !!rest.checked !== !!current.checked && !this.mayTick()) {
      this.report(msg('You may not check markups here.'));
      delete rest.checked;
    }
    if (Object.keys(rest).length) this.inner.update(id, rest as Partial<Omit<Markup, 'id'>>);
  }

  private repliesRefused(): void {
    this.report(msg('Replies are not available for documents on a server yet, so they were not saved.'));
  }

  // ---- Statuses and ticks: hints for the interface. The server decides. --------------------

  mayChooseStatus(markupIds: readonly string[], statusId: string): boolean {
    if (this.readOnly || !this._rules.changeStatus) return false;
    // An issue cannot go back to having no status.
    if (statusId === 'none') return markupIds.every((id) => !this.inner.issueFor(id));
    const def = this.info.statuses.find((s) => s.id === statusId);
    if (!def) return false;
    if (def.category !== 'closed' || this._rules.close === 'any') return true;
    // A markup with no issue yet would get one raised by this person.
    return markupIds.every(
      (id) =>
        this.inner.get(id)?.status === statusId ||
        (this._rules.close === 'own' && (this.inner.issueFor(id)?.owner.userId ?? this.info.userId) === this.info.userId),
    );
  }

  mayTick(): boolean {
    return !this.readOnly && this._rules.tick;
  }

  temporaryId(markupId: string): string | null {
    const issue = this.inner.issueFor(markupId);
    if (!issue || issue.number !== null) return null;
    return msg('Temp {id}', { id: issue.id.replace(/-/g, '').slice(0, 4).toUpperCase() });
  }

  remove(ids: Iterable<string>): void {
    this.inner.remove(ids);
  }

  batch(fn: () => void): void {
    this.inner.batch(fn);
  }

  setField(ids: Iterable<string>, columnId: string, value: string): void {
    this.inner.setField(ids, columnId, value);
  }

  setPageCount(count: number): void {
    this.inner.setPageCount(count);
  }

  checkpoint(): void {
    this.inner.checkpoint();
  }

  async undo(): Promise<UndoResult> {
    return this.explainHistory(await this.inner.undo());
  }

  async redo(): Promise<UndoResult> {
    return this.explainHistory(await this.inner.redo());
  }

  /** An undo that did not happen is always said, never skipped silently. */
  private explainHistory(result: UndoResult): UndoResult {
    if (!result.ok && result.reason === 'changed') this.report(msg('Nothing was undone: it has been changed since.'));
    else if (!result.ok && result.reason === 'forbidden') this.report(msg('You cannot undo that change here.'));
    else if (!result.ok && result.reason === 'offline') this.report(msg('Undo needs a connection to the server.'));
    else if (!result.ok && result.reason === 'permanent') {
      this.report(msg('A status change cannot be undone. Set the status again to change it. Undo again to undo what you did before it.'));
    }
    return result;
  }

  undoHistory(): { label: string; at: number }[] {
    return this.inner.undoHistory();
  }

  async undoSteps(steps: number): Promise<void> {
    for (let i = 0; i < steps; i++) {
      const result = await this.undo();
      // A status change stays, and the steps before it are still undone.
      if (!result.ok && result.reason !== 'permanent') break;
    }
  }

  async destroy(): Promise<void> {
    const cleanups = this.cleanups.splice(0);
    this.statusListeners.clear();
    await this.inner.disconnect();
    await this.inner.destroy();
    for (const cleanup of cleanups) await cleanup();
  }

  // ---- Document setup: read from the file; changes are not shared yet ------------------------

  scaleFor(pageIndex: number): Scale {
    return this.inner.scaleFor(pageIndex);
  }

  scaleAt(pageIndex: number, p: Point): Scale {
    return this.inner.scaleAt(pageIndex, p);
  }

  scaleOf(m: Pick<Markup, 'points' | 'pageIndex'>): Scale {
    return this.inner.scaleOf(m);
  }

  hasScale(pageIndex: number): boolean {
    return this.inner.hasScale(pageIndex);
  }

  isScaledAt(pageIndex: number, p: Point): boolean {
    return this.inner.isScaledAt(pageIndex, p);
  }

  allScales(): Readonly<Record<number, Scale>> {
    return this.inner.allScales();
  }

  setScale(_pageIndexes: Iterable<number>, _scale: Scale): void {
    this.setupRefused();
  }

  setScales(_entries: Iterable<readonly [number, Scale]>): void {
    this.setupRefused();
  }

  allViewports(): Viewport[] {
    return this.inner.allViewports();
  }

  setViewport(_v: Viewport): void {
    this.setupRefused();
  }

  removeViewport(_id: string): void {
    this.setupRefused();
  }

  allSheets(): Readonly<Record<number, SheetInfo>> {
    return this.inner.allSheets();
  }

  /** Sheet numbers and titles read from the file come out the same for everyone, so they are kept. */
  setDetectedSheets(entries: Iterable<[pageIndex: number, info: SheetInfo]>): void {
    this.inner.setDetectedSheets(entries);
  }

  editSheet(_pageIndex: number, _patch: Partial<Pick<SheetInfo, 'number' | 'title'>>): void {
    this.setupRefused();
  }

  /** The columns as read from the file, with the project's statuses. The same object until they change. */
  columnSet(): ColumnSet {
    const from = this.inner.columnSet();
    if (this.columnCache?.from !== from) this.columnCache = { from, value: { columns: from.columns, statuses: this.statusDefs } };
    return this.columnCache.value;
  }

  hasColumnSet(): boolean {
    return this.inner.hasColumnSet();
  }

  setColumnSet(_set: ColumnSet): void {
    this.setupRefused();
  }

  // ---- Takeoff ----------------------------------------------------------------------------

  assemblies(): Assembly[] {
    return NO_ASSEMBLIES;
  }

  setAssemblies(_list: readonly Assembly[]): void {
    this.refuse('takeoff');
  }

  resolvedAssemblies(): Assembly[] {
    return NO_ASSEMBLIES;
  }

  estimating(): Estimating {
    return EMPTY_ESTIMATING;
  }

  setEstimating(_patch: Partial<Estimating>): void {
    this.refuse('takeoff');
  }

  // ---- AI review --------------------------------------------------------------------------

  aiReview(): AiReviewData {
    return EMPTY_AI_REVIEW;
  }

  aiReviewForSave(): AiReviewData {
    return EMPTY_AI_REVIEW;
  }

  changeAiReview(): void {
    this.refuse('aiReview');
  }

  reviewPass(): ReviewPassSettings {
    return NO_REVIEW_PASS;
  }

  setReviewPass(): void {
    this.refuse('aiReview');
  }

  // ---- Portals ----------------------------------------------------------------------------

  portals(): Portal[] {
    return NO_PORTALS;
  }

  setPortal(_portal: Portal): { copied: number; adopted: number; unlinked: number } {
    return this.refuse('portals');
  }

  removePortal(_id: string): void {
    this.refuse('portals');
  }

  breakPortalLinks(_ids: Iterable<string>): void {
    this.refuse('portals');
  }

  // ---- Links, bookmarks and drawing standards. "Detected" reads true so nothing looks again. --

  allLinks(): StoredLink[] {
    return NO_LINKS;
  }

  linksDetected(): boolean {
    return true;
  }

  marksSearched(): string[] {
    return NO_MARK_IDS;
  }

  setDetectedLinks(): void {
    this.refuse('links');
  }

  setMarkLinks(): void {
    this.refuse('links');
  }

  setLinkStatus(): void {
    this.refuse('links');
  }

  proposeLinks(): string[] {
    return this.refuse('links');
  }

  bookmarks(): Bookmark[] {
    return NO_BOOKMARKS;
  }

  places(): Place[] {
    return NO_PLACES;
  }

  setBookmarks(): void {
    this.refuse('links');
  }

  setPlaces(): void {
    this.refuse('links');
  }

  outlineImported(): boolean {
    return true;
  }

  importOutline(): void {
    this.refuse('links');
  }

  setDrawingStandard(): void {
    this.refuse('links');
  }

  declinedStandards(): string[] {
    return NO_MARK_IDS;
  }

  declineStandard(): void {
    this.refuse('links');
  }

  drawingStandard(): { id: string; hash: string } | null {
    return null;
  }

  // ---- Stitching and maps -----------------------------------------------------------------

  stitchGroups(): StoredStitchGroup[] {
    return NO_STITCH;
  }

  stitchDetected(): boolean {
    return true;
  }

  setStitch(): void {
    this.refuse('stitch');
  }

  manualStitch(): StoredManualStitch {
    return NO_MANUAL_STITCH;
  }

  setManualStitch(): void {
    this.refuse('stitch');
  }

  allGeoRegions(): GeoRegion[] {
    return NO_GEO;
  }

  geoChecked(): boolean {
    return true;
  }

  setGeoRegions(): void {
    this.refuse('geo');
  }

  geoEditedPages(): number[] {
    return NO_PAGE_NUMBERS;
  }

  editedGeo(): Record<number, GeoRegion[]> {
    return NO_PAGES_GEO;
  }

  setPageGeo(): void {
    this.refuse('geo');
  }

  setPagesGeo(): void {
    this.refuse('geo');
  }

  // ---- Importing the PDF's own annotations. The file's annotations stay as the page shows them. --

  annotationsImported(): boolean {
    return true;
  }

  importVersion(): number {
    return IMPORT_VERSION;
  }

  refreshImported(): void {
    this.refuse('import');
  }

  imageMarkupsChecked(): boolean {
    return true;
  }

  setImageMarkupsChecked(): void {
    this.refuse('import');
  }

  restoreImageMarkups(): void {
    this.refuse('import');
  }

  importedAnnotations(): Record<number, number[]> {
    return NO_IMPORTED;
  }

  importedSpaces(): Record<number, number[]> {
    return NO_IMPORTED;
  }

  importAnnotations(_markups: readonly Markup[], _links: unknown, _imported: Record<number, number[]>, _extras?: ImportedExtras): void {
    this.refuse('import');
  }

  // ---- Changes to the file ------------------------------------------------------------------

  remapPages(): void {
    this.refuse('fileSteps');
  }

  copyPages(): PageClip[] {
    return this.refuse('fileSteps');
  }

  pastePages(): void {
    this.refuse('fileSteps');
  }

  transformPages(): void {
    this.refuse('fileSteps');
  }

  forgetImported(): void {
    this.refuse('fileSteps');
  }

  removeFlattened(): void {
    this.refuse('fileSteps');
  }

  resetMarkups(): void {
    this.refuse('fileSteps');
  }

  fileStep(): void {
    this.refuse('fileSteps');
  }
}
