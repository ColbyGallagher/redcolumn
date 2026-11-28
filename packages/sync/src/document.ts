import type { ColumnSet, EditorContext, EditRule, Markup, MarkupDocument, Point, UndoResult, Viewport } from '@nb/markup';
import { DEFAULT_STATUSES } from '@nb/markup/columns';
import { planAdd, planRemove, planUpdate, type AddPlan } from '@nb/markup/editing';
import { scaleOfMarkup, viewportAt } from '@nb/markup/viewports';
import { DEFAULT_SCALE, type Scale } from '@nb/measure';
import {
  applyBatch,
  applyOp,
  columnGroupKey,
  emptyState,
  own,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL,
  versionOf,
  type Actor as OpsActor,
  type ApplyContext,
  type Operation,
  type OpsState,
  type Placement,
  type ProtocolRange,
  type StatusDef,
  type VersionedRecord,
} from '@nb/ops';
import { SOURCE_RANK, type SheetInfo } from '@nb/sheets';
import { defaultSyncPersistence, type SyncPersistence } from './persistence.ts';
import { diffMarkup, projectMarkups, splitMarkup } from './project.ts';
import { baseForGroup, buildRetryOps, groupPendingUnits, rebasePending, splitIntoBatches } from './rebase.ts';
import type {
  ConnectionState,
  ForwardCheck,
  InboxEntry,
  PersistedHistoryRequest,
  PersistedSetup,
  PersistedSyncState,
  ServerEvent,
  ServerMessage,
  ServerRejection,
  SyncFacet,
  SyncStatus,
  SyncTransport,
  TransportState,
  UndoGroupCheck,
  UndoOpSpec,
  UndoStep,
} from './types.ts';

const DEFAULT_COLUMN_SET: ColumnSet = { columns: [], statuses: DEFAULT_STATUSES };

let fallbackIdCounter = 0;
function defaultNewId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `op_${Date.now().toString(36)}_${(++fallbackIdCounter).toString(36)}`;
}

function describeOps(ops: readonly Operation[]): string {
  if (!ops.length) return 'Edit';
  const types = new Set(ops.map((o) => o.type));
  if (types.has('markup.create')) {
    const n = ops.filter((o) => o.type === 'markup.create').length;
    return n === 1 ? 'Add markup' : `Add ${n} markups`;
  }
  if (types.has('markup.delete')) {
    const n = ops.filter((o) => o.type === 'markup.delete').length;
    return n === 1 ? 'Delete markup' : `Delete ${n} markups`;
  }
  if (types.has('markup.restore')) {
    const n = ops.filter((o) => o.type === 'markup.restore').length;
    return n === 1 ? 'Restore markup' : `Restore ${n} markups`;
  }
  if (types.has('placement.patch') && !types.has('markup.patch')) {
    const n = ops.filter((o) => o.type === 'placement.patch').length;
    return n === 1 ? 'Move markup' : `Move ${n} markups`;
  }
  if (types.has('markup.patch')) {
    const n = ops.filter((o) => o.type === 'markup.patch').length;
    return n === 1 ? 'Edit markup' : `Edit ${n} markups`;
  }
  return 'Edit';
}

/**
 * Applies `ops` as consecutive units (single ops or batches), the way the server receives them.
 * Stops at the first refused unit.
 */
function applyUnits(
  state: OpsState,
  ops: readonly Operation[],
  ctx: ApplyContext,
): { ok: true; state: OpsState } | { ok: false; rejection: ServerRejection } {
  let next = state;
  for (const unit of groupPendingUnits(ops)) {
    const res = unit.length === 1 && unit[0]!.batchId === undefined
      ? applyOp(next, unit[0]!, ctx)
      : applyBatch(next, unit, ctx);
    if (!res.ok) return { ok: false, rejection: res.rejection };
    next = res.state;
  }
  return { ok: true, state: next };
}

function opKind(type: string): 'markup' | 'placement' {
  return type.startsWith('markup.') ? 'markup' : 'placement';
}

interface DeferredUndo {
  opIds: Set<string>;
  kind: 'undo' | 'redo';
  step: UndoStep;
  emittedOps: Operation[];
  /** True once any of its ops was handed to the transport (it may then be committed on the server). */
  sent: boolean;
  /** `historyEpoch` when the request started; a new edit since then means no redo step is pushed. */
  epoch: number;
  resolve: (result: UndoResult) => void;
}

interface PendingBatchDraft {
  ops: Operation[];
  checks: UndoGroupCheck[];
  inverse: UndoOpSpec[];
  forward: UndoOpSpec[];
  forwardChecks: ForwardCheck[];
  addedMarkups: string[];
  label: string | null;
}

export interface SyncDocumentOptions {
  /** Stable cache/persistence key. Defaults to `${streamId}:${revisionId}`. */
  key?: string;
  /** Document stream identifier. */
  streamId: string;
  /** Visibility scope (review or standalone session). */
  scopeId: string;
  /** Immutable revision identifier viewed by this document. */
  revisionId: string;
  /** Ordered page IDs for this revision (`pages[pageIndex] === pageId`). */
  pages: readonly string[];
  /** Signed-in actor for optimistic apply and UI hints. */
  actor: OpsActor;
  /** Actor's lane id. Defaults to `'lane-1'`. */
  laneId?: string;
  /** Editor context (display name and app hooks). */
  context?: EditorContext<SyncDocument>;
  /** Optional transport to attach (call `connect()` to start syncing). */
  transport?: SyncTransport;
  /** Persistence adapter, or `false` for non-persisted memory-only mode. */
  persistence?: SyncPersistence | false;
  /** Optional client-side UI hint restricting which markups this user may edit. */
  editRule?: EditRule | null;
  /** Initial read-only state. */
  readOnly?: boolean;
  /** Resolves an `@nb/ops` actor to a display name on projected `Markup.author`. */
  resolveAuthor?: (actor: OpsActor) => string;
  /** Initial document setup (scales, viewports, sheets, columns). */
  setup?: Partial<PersistedSetup>;
  /** Project status definitions for status transitions. */
  statuses?: readonly StatusDef[];
  /** Protocol range offered during handshake. Defaults to `SUPPORTED_PROTOCOL`. */
  protocol?: ProtocolRange;
  /** Client clock (ms since epoch). Defaults to `Date.now`. */
  clock?: () => number;
  /** Unique id generator for opIds, placementIds, batchIds. Defaults to `crypto.randomUUID`. */
  newId?: () => string;
}

/**
 * Synced implementation of {@link MarkupDocument} without Yjs.
 *
 * Maintains confirmed server state, an optimistic pending queue applied with `@nb/ops` reducers,
 * a rejected inbox for conflicts/refusals, and a version-checked undo/redo stack. Views one
 * immutable revision and maps `pageIndex` ↔ `pageId` at the boundary.
 */
export class SyncDocument implements MarkupDocument, SyncFacet {
  readonly key: string;
  readonly streamId: string;
  readonly scopeId: string;
  readonly revisionId: string;
  readonly pages: readonly string[];

  private readonly actor: OpsActor;
  private readonly laneId: string;
  private readonly context: EditorContext<SyncDocument>;
  private readonly resolveAuthor: (actor: OpsActor) => string;
  private readonly statuses?: readonly StatusDef[];
  private readonly protocol: ProtocolRange;
  private readonly clock: () => number;
  private readonly newId: () => string;
  private readonly persistence: SyncPersistence | null;

  private confirmed: OpsState = emptyState();
  private view: OpsState = emptyState();
  private cursor: string | null = null;
  private pending: Operation[] = [];
  private inFlightOpIds = new Set<string>();
  private confirmedOpIds = new Set<string>();
  private inbox: InboxEntry[] = [];
  private undoStack: UndoStep[] = [];
  private redoStack: UndoStep[] = [];

  private projectedList: Markup[] = [];
  private projectedMap = new Map<string, Markup>();
  private placementByMarkup = new Map<string, Placement>();
  private hasConnectors = false;
  private seqHigh = 0;

  private scaleSnapshot: Readonly<Record<number, Scale>> = {};
  private viewportSnapshot: Viewport[] = [];
  private sheetSnapshot: Readonly<Record<number, SheetInfo>> = {};
  private columnSnapshot: ColumnSet = DEFAULT_COLUMN_SET;
  private customColumnSet = false;

  private _readOnly: boolean;
  private _editCount = 0;
  private editRule: EditRule | null;
  private _connection: ConnectionState = 'disconnected';
  /** Set when the server revoked access; cleared only by a later successful welcome. */
  private revoked = false;
  private _lastError: string | null = null;
  /** The message last reported for a failed local save (cleared when a later save succeeds). */
  private persistError: string | null = null;

  private transport: SyncTransport | null = null;
  private unsubTransportMessage: (() => void) | null = null;
  private unsubTransportState: (() => void) | null = null;

  private readonly listeners = new Set<() => void>();
  private readonly syncListeners = new Set<() => void>();

  private batchDepth = 0;
  private batchDraft: PendingBatchDraft | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  /** A save is queued and not started yet; it snapshots the latest state when it runs. */
  private persistQueued = false;
  private destroyed = false;
  /** Undo/redo requests run one at a time: each waits for the previous one to finish. */
  private historyQueue: Promise<unknown> | null = null;
  /** Bumped by every new local edit step, so an undo that finishes afterwards pushes no redo. */
  private historyEpoch = 0;

  /** Undo/redo ops currently awaiting server confirmation. */
  private pendingUndos: DeferredUndo[] = [];
  /** OpIds belonging to an active undo/redo request (excluded from the rejected inbox). */
  private undoTrackedOpIds = new Set<string>();

  readonly sync: SyncStatus;

  private constructor(options: SyncDocumentOptions) {
    this.streamId = options.streamId;
    this.scopeId = options.scopeId;
    this.revisionId = options.revisionId;
    this.pages = [...options.pages];
    this.key = options.key ?? `${options.streamId}:${options.revisionId}`;
    this.actor = { ...options.actor };
    this.laneId = options.laneId ?? 'lane-1';
    this.context = options.context ?? { actor: { id: options.actor.userId, name: options.actor.userId } };
    this.resolveAuthor =
      options.resolveAuthor ??
      ((a) => (a.userId === this.actor.userId && this.context.actor.name ? this.context.actor.name : a.userId));
    this.statuses = options.statuses;
    this.protocol = options.protocol ?? SUPPORTED_PROTOCOL;
    this.clock = options.clock ?? Date.now;
    this.newId = options.newId ?? defaultNewId;
    this.persistence = options.persistence === false ? null : (options.persistence ?? defaultSyncPersistence());
    this._readOnly = options.readOnly ?? false;
    this.editRule = options.editRule ?? null;

    if (options.setup) this.applySetup(options.setup);
    if (options.transport) this.attachTransport(options.transport);

    const self = this;
    this.sync = {
      get pendingCount() {
        return self.pending.length;
      },
      get inbox() {
        return self.inbox;
      },
      get connection() {
        return self._connection;
      },
      get cursor() {
        return self.cursor;
      },
      get lastError() {
        return self._lastError;
      },
      subscribe: (listener) => {
        this.syncListeners.add(listener);
        return () => this.syncListeners.delete(listener);
      },
      discardInbox: (id) => this.discardInbox(id),
      copyInbox: (id) => this.copyInbox(id),
      retryInboxAsNew: (id) => this.retryInboxAsNew(id),
      flush: () => this.flush(),
    };
  }

  /** Opens a synced document, restoring any persisted local state for its key before returning. */
  static async open(options: SyncDocumentOptions): Promise<SyncDocument> {
    const doc = new SyncDocument(options);
    if (doc.persistence) {
      const saved = await doc.persistence.load(doc.key);
      if (saved) {
        doc.confirmed = saved.confirmed;
        doc.cursor = saved.cursor;
        doc.pending = saved.pending;
        doc.inbox = saved.inbox;
        doc.undoStack = saved.undoStack;
        doc.redoStack = saved.redoStack;
        doc.confirmedOpIds = new Set(saved.confirmedOpIds);
        if (saved.setup) doc.applySetup(saved.setup);
        if (saved.revoked) {
          doc.revoked = true;
          doc._connection = 'revoked';
          doc.clearSetup();
        }
        doc.restoreHistoryRequests(saved.history ?? []);
      }
    }
    doc.rebaseAndProject(false);
    return doc;
  }

  /**
   * Re-attaches undo/redo requests that were sent before a restart. Their ops are still in
   * `pending` and resend with the same opIds; the step completes when the server confirms them.
   */
  private restoreHistoryRequests(requests: readonly PersistedHistoryRequest[]): void {
    const waits: Promise<UndoResult>[] = [];
    for (const req of requests) {
      const stack = req.kind === 'undo' ? this.undoStack : this.redoStack;
      const step = stack.find((s) => s.id === req.stepId);
      if (!step || req.emittedOps.length !== step.inverse.length) continue;
      const opIds = new Set(req.emittedOps.map((o) => o.opId));
      for (const id of opIds) this.undoTrackedOpIds.add(id);
      waits.push(
        new Promise<UndoResult>((resolve) => {
          this.pendingUndos.push({
            opIds,
            kind: req.kind,
            step,
            emittedOps: req.emittedOps,
            sent: true,
            epoch: this.historyEpoch,
            resolve,
          });
        }),
      );
    }
    if (waits.length) {
      const tail = Promise.all(waits).then(() => undefined);
      this.historyQueue = tail;
      void tail.then(() => {
        if (this.historyQueue === tail) this.historyQueue = null;
      });
    }
  }

  /** Connects to the server over `transport` (or the one passed to `open`), catches up, and flushes pending ops. */
  async connect(transport?: SyncTransport): Promise<void> {
    if (this.destroyed) return;
    if (transport && transport !== this.transport) this.attachTransport(transport);
    if (!this.transport) throw new Error('No transport configured for SyncDocument');
    this._lastError = null;
    this.inFlightOpIds.clear();
    // A revoked (or too old) client stays in that state until the server welcomes it again.
    if (this._connection !== 'revoked' && this._connection !== 'update_required') {
      this.setConnection(this.cursor ? 'reconnecting' : 'connecting');
    }
    await this.transport.connect({
      streamId: this.streamId,
      cursor: this.cursor,
      protocol: this.protocol,
      pendingOpIds: this.pending.map((o) => o.opId),
    });
  }

  /** Disconnects the transport. Queued pending operations stay persisted for the next reconnect. */
  async disconnect(): Promise<void> {
    this.failInFlightUndos('offline');
    this.inFlightOpIds.clear();
    if (this.transport) await this.transport.disconnect();
    if (this._connection !== 'revoked' && this._connection !== 'update_required') {
      this.setConnection('disconnected');
    }
  }

  /** Sends all not-yet-in-flight pending units in order if connected. */
  async flush(): Promise<void> {
    if (this.destroyed || this._connection !== 'connected' || !this.transport) return;
    for (const unit of groupPendingUnits(this.pending)) {
      if (unit.some((o) => this.inFlightOpIds.has(o.opId))) continue;
      const history = this.pendingUndos.find((d) => d.opIds.has(unit[0]!.opId));
      if (history) {
        // A multi-chunk undo goes one chunk at a time, so a refused chunk leaves later ones unsent.
        const at = history.emittedOps.findIndex((o) => o.opId === unit[0]!.opId);
        if (history.emittedOps.slice(0, at).some((o) => !this.confirmedOpIds.has(o.opId))) break;
        if (!history.sent) {
          history.sent = true;
          this.schedulePersist();
        }
      }
      for (const op of unit) this.inFlightOpIds.add(op.opId);
      await this.transport.send(unit);
      // Stop if sending caused disconnect/revocation synchronously.
      if (this._connection !== 'connected') break;
    }
  }

  /**
   * Waits until all queued local persistence writes have finished. Rejects if the latest write
   * failed; a failed write never stops later ones, so this resolves again once a save succeeds.
   */
  whenPersisted(): Promise<void> {
    return this.persistChain;
  }

  /** Confirmed server state (what the server has acknowledged). */
  confirmedState(): OpsState {
    return this.confirmed;
  }

  /** Current optimistic state (confirmed state with pending operations applied on top). */
  viewState(): OpsState {
    return this.view;
  }

  /** Sets whether local edits are ignored. */
  setReadOnly(readOnly: boolean): void {
    if (this._readOnly === readOnly) return;
    this._readOnly = readOnly;
    this.notify();
  }

  /** Sets the client-side UI hint for which markups this user may edit. */
  setEditRule(rule: EditRule | null): void {
    if (this.editRule === rule) return;
    this.editRule = rule;
    this.notify();
  }

  /**
   * Low-level submission for arbitrary `@nb/ops` operations (e.g. responses, issues, status changes,
   * or releases). Releases require an active connection and are never queued offline.
   */
  submitOps(ops: readonly Operation[], label?: string): boolean {
    if (this.readOnly || !ops.length) return false;
    if (ops.some((o) => o.type === 'release.create') && this._connection !== 'connected') {
      return false;
    }
    const stamped = this.stampBatch(ops);
    const res = applyUnits(this.view, stamped, this.optimisticContext());
    if (!res.ok) {
      this.pushInbox({
        id: stamped[0]!.batchId ?? stamped[0]!.opId,
        ops: stamped,
        reason: res.rejection,
        rejectedAt: this.clock(),
        label: label ?? describeOps(stamped),
      });
      this.schedulePersist();
      this.notifySync();
      return false;
    }
    this.pending = [...this.pending, ...stamped];
    this.view = res.state;
    this._editCount += 1;
    this.refreshProjection();
    this.schedulePersist();
    this.notifyAll();
    void this.flush();
    return true;
  }

  /**
   * Adds changes the server refused to another copy of this document, such as one left by a window
   * that has closed, to the rejected list. `whenPersisted` then says when they are saved here.
   */
  adoptRejected(entries: readonly InboxEntry[]): void {
    const fresh = entries.filter((entry) => !this.inbox.some((e) => e.id === entry.id));
    if (!fresh.length) return;
    this.inbox = [...this.inbox, ...structuredClone(fresh)];
    this.schedulePersist();
    this.notifySync();
  }

  // ---- MarkupDocument core ----------------------------------------------------------------

  get readOnly(): boolean {
    return this._readOnly || this.revoked;
  }

  get editCount(): number {
    return this._editCount;
  }

  mayEdit(m: Pick<Markup, 'author'>): boolean {
    if (this.readOnly) return false;
    return !this.editRule || this.editRule(m);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  all(): Markup[] {
    return this.projectedList;
  }

  forPage(pageIndex: number): Markup[] {
    return this.projectedList.filter((m) => m.pageIndex === pageIndex);
  }

  get(id: string): Markup | undefined {
    return this.projectedMap.get(id);
  }

  setPageCount(_count: number): void {
    // Revisions are immutable; page count is fixed by `pages`.
  }

  add(markup: Markup): void {
    if (this.readOnly) return;
    const pageId = this.requirePageId(markup.pageIndex);

    this.runEdit((draft) => {
      const plan: AddPlan = planAdd(this.projectedMap, markup, {
        lastSeq: this.seqHigh,
        mayEdit: (m) => this.mayEdit(m),
        hasConnectors: this.hasConnectors,
      });
      if (plan.nextSeq !== undefined && plan.nextSeq > this.seqHigh) this.seqHigh = plan.nextSeq;
      const primary = plan.put[0];
      if (!primary) return;

      if (plan.added !== null) {
        const { content, geometry } = splitMarkup(primary);
        const createOpId = this.newId();
        const placeId = this.newId();
        const placeOpId = this.newId();
        const now = this.clock();

        const createOp: Operation = {
          opId: createOpId,
          schemaVersion: PROTOCOL_VERSION,
          streamId: this.streamId,
          type: 'markup.create',
          entityId: primary.id,
          payload: { scopeId: this.scopeId, type: primary.type, content },
          clientTime: now,
        };
        const placeOp: Operation = {
          opId: placeOpId,
          schemaVersion: PROTOCOL_VERSION,
          streamId: this.streamId,
          type: 'placement.create',
          entityId: placeId,
          payload: {
            markupId: primary.id,
            revisionId: this.revisionId,
            pageId,
            geometry,
            method: 'original',
            confidence: null,
            state: 'confirmed',
          },
          clientTime: now,
        };

        this.applyDraftOps(draft, [createOp, placeOp]);
        draft.checks.push(
          { kind: 'markup', entityId: primary.id, group: '*', expectedOpId: createOpId, preOpId: null, revertedOpIds: [] },
          { kind: 'placement', entityId: placeId, group: '*', expectedOpId: placeOpId, preOpId: null, revertedOpIds: [] },
        );
        // Undo deletes placement then markup; redo restores markup then placement.
        draft.inverse.unshift(
          { type: 'placement.delete', entityId: placeId, payload: {}, groups: ['deleted'] },
          { type: 'markup.delete', entityId: primary.id, payload: {}, groups: ['deleted'] },
        );
        draft.forward.push(
          { type: 'markup.restore', entityId: primary.id, payload: {}, groups: ['deleted'] },
          { type: 'placement.restore', entityId: placeId, payload: {}, groups: ['deleted'] },
        );
        draft.forwardChecks.push(
          { kind: 'markup', entityId: primary.id, group: 'deleted' },
          { kind: 'placement', entityId: placeId, group: 'deleted' },
        );
        draft.addedMarkups.push(primary.id);
        if (!draft.label) draft.label = 'Add markup';
      } else {
        const before = this.projectedMap.get(primary.id);
        if (before) this.emitDiffIntoDraft(draft, before, primary, 'Replace markup');
      }

      for (const followed of plan.put.slice(1)) {
        const before = this.projectedMap.get(followed.id);
        if (before) this.emitDiffIntoDraft(draft, before, followed, null);
      }
    });
  }

  update(id: string, patch: Partial<Omit<Markup, 'id'>>): void {
    if (this.readOnly) return;
    const before = this.projectedMap.get(id);
    if (!before) return;

    this.runEdit((draft) => {
      const plan = planUpdate(this.projectedMap, id, patch, {
        actor: this.context.actor.name,
        now: this.clock(),
        statuses: this.columnSet().statuses,
        mayEdit: (m) => this.mayEdit(m),
        hasConnectors: this.hasConnectors,
      });
      if (!plan.put.length) return;
      for (let i = 0; i < plan.put.length; i++) {
        const next = plan.put[i]!;
        const prev = i === 0 ? before : this.projectedMap.get(next.id);
        if (prev) this.emitDiffIntoDraft(draft, prev, next, i === 0 ? 'Edit markup' : null);
      }
    });
  }

  remove(ids: Iterable<string>): void {
    if (this.readOnly) return;
    this.runEdit((draft) => {
      const plan = planRemove(this.projectedMap, ids, { mayEdit: (m) => this.mayEdit(m) });
      if (!plan.remove.length) return;
      const now = this.clock();

      for (const id of plan.remove) {
        const markupRec = own(this.view.markups, id);
        if (!markupRec || markupRec.deleted) continue;
        const placement = this.placementByMarkup.get(id);
        const ops: Operation[] = [];
        const restoreOps: UndoOpSpec[] = [];
        const deleteOps: UndoOpSpec[] = [];

        if (placement && !placement.deleted) {
          const prevPlaceDelOp = versionOf(placement, 'deleted').op;
          const placeDelOpId = this.newId();
          ops.push({
            opId: placeDelOpId,
            schemaVersion: PROTOCOL_VERSION,
            streamId: this.streamId,
            type: 'placement.delete',
            entityId: placement.id,
            payload: {},
            clientTime: now,
          });
          this.recordGroupCheck(draft, {
            kind: 'placement',
            entityId: placement.id,
            group: 'deleted',
            expectedOpId: placeDelOpId,
            preOpId: prevPlaceDelOp,
          });
          deleteOps.push({ type: 'placement.delete', entityId: placement.id, payload: {}, groups: ['deleted'] });
        }

        const prevMarkupDelOp = versionOf(markupRec, 'deleted').op;
        const markupDelOpId = this.newId();
        ops.push({
          opId: markupDelOpId,
          schemaVersion: PROTOCOL_VERSION,
          streamId: this.streamId,
          type: 'markup.delete',
          entityId: id,
          payload: {},
          clientTime: now,
        });
        this.recordGroupCheck(draft, {
          kind: 'markup',
          entityId: id,
          group: 'deleted',
          expectedOpId: markupDelOpId,
          preOpId: prevMarkupDelOp,
        });
        deleteOps.push({ type: 'markup.delete', entityId: id, payload: {}, groups: ['deleted'] });

        // Restore order: markup FIRST, then placement (`placement.restore` requires live markup).
        restoreOps.push({ type: 'markup.restore', entityId: id, payload: {}, groups: ['deleted'] });
        if (placement && !placement.deleted) {
          restoreOps.push({ type: 'placement.restore', entityId: placement.id, payload: {}, groups: ['deleted'] });
        }

        this.applyDraftOps(draft, ops);
        draft.inverse.unshift(...restoreOps);
        draft.forward.push(...deleteOps);
        draft.forwardChecks.push({ kind: 'markup', entityId: id, group: 'deleted' });
        if (placement && !placement.deleted) {
          draft.forwardChecks.push({ kind: 'placement', entityId: placement.id, group: 'deleted' });
        }
      }

      if (!draft.label) {
        draft.label = plan.remove.length === 1 ? 'Delete markup' : `Delete ${plan.remove.length} markups`;
      }
    });
  }

  setField(ids: Iterable<string>, columnId: string, value: string): void {
    if (this.readOnly) return;
    this.runEdit((draft) => {
      const now = this.clock();
      const group = columnGroupKey(columnId);
      const seen = new Set<string>();
      let changed = 0;

      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const m = this.projectedMap.get(id);
        if (!m || !this.mayEdit(m)) continue;
        const prev = m.fields?.[columnId];
        const next = value === '' ? undefined : value;
        if (prev === next) continue;

        const viewRec = own(this.view.markups, id);
        if (!viewRec || viewRec.deleted) continue;
        const confRec = own(this.confirmed.markups, id);
        const preOpId = versionOf(viewRec, group).op;
        const opId = this.newId();
        const op: Operation = {
          opId,
          schemaVersion: PROTOCOL_VERSION,
          streamId: this.streamId,
          type: 'markup.patch',
          entityId: id,
          basedOn: { [group]: baseForGroup(confRec, viewRec, group) },
          payload: { fields: { [columnId]: next ?? null } },
          clientTime: now,
        };
        this.applyDraftOps(draft, [op]);
        this.recordGroupCheck(draft, { kind: 'markup', entityId: id, group, expectedOpId: opId, preOpId });
        draft.inverse.unshift({
          type: 'markup.patch',
          entityId: id,
          payload: { fields: { [columnId]: prev ?? null } },
          groups: [group],
        });
        draft.forward.push({
          type: 'markup.patch',
          entityId: id,
          payload: { fields: { [columnId]: next ?? null } },
          groups: [group],
        });
        draft.forwardChecks.push({ kind: 'markup', entityId: id, group });
        changed += 1;
      }

      if (changed > 0 && !draft.label) {
        draft.label = changed === 1 ? 'Edit field' : `Edit ${changed} markups`;
      }
    });
  }

  batch(fn: () => void): void {
    if (this.readOnly) return;
    const isOuter = this.batchDepth === 0;
    if (isOuter) {
      this.batchDraft = this.emptyDraft();
    }
    this.batchDepth += 1;
    try {
      fn();
    } catch (err) {
      this.batchDepth -= 1;
      if (isOuter) {
        this.batchDraft = null;
        this.rebaseAndProject(false);
      }
      throw err;
    }
    this.batchDepth -= 1;
    if (isOuter && this.batchDraft) {
      const draft = this.batchDraft;
      this.batchDraft = null;
      this.commitDraft(draft);
    }
  }

  checkpoint(): void {
    // Each top-level mutation or batch() already produces a discrete undo step.
  }

  async undo(): Promise<UndoResult> {
    return this.runHistory('undo');
  }

  async redo(): Promise<UndoResult> {
    return this.runHistory('redo');
  }

  /**
   * Runs undo/redo requests one after another: a second request starts only once the first is
   * confirmed or refused, so it sees the stacks the first one left behind.
   */
  private runHistory(kind: 'undo' | 'redo'): Promise<UndoResult> {
    // A request still waiting on the server cannot finish while offline; don't queue behind it.
    if (this.pendingUndos.length && this._connection !== 'connected') {
      return Promise.resolve(this.readOnly ? { ok: false, reason: 'forbidden' } : { ok: false, reason: 'offline' });
    }
    // Start at once when idle, so the request sees exactly the edits made before the call.
    const prev = this.historyQueue;
    const run = prev ? prev.then(() => this.executeHistoryStep(kind)) : this.executeHistoryStep(kind);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.historyQueue = tail;
    void tail.then(() => {
      if (this.historyQueue === tail) this.historyQueue = null;
    });
    return run;
  }

  undoHistory(): { label: string; at: number }[] {
    return this.undoStack.map((s) => ({ label: s.label, at: s.at })).reverse();
  }

  async undoSteps(steps: number): Promise<void> {
    if (this.readOnly) return;
    for (let i = 0; i < steps && this.undoStack.length; i++) {
      const res = await this.undo();
      if (!res.ok) break;
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.unsubTransportMessage) this.unsubTransportMessage();
    if (this.unsubTransportState) this.unsubTransportState();
    this.unsubTransportMessage = null;
    this.unsubTransportState = null;
    this.listeners.clear();
    this.syncListeners.clear();
    // Let a queued save finish first: it records sent undo requests so they complete after reopening.
    await this.persistChain.catch(() => undefined);
    for (const d of this.pendingUndos.splice(0, this.pendingUndos.length)) d.resolve({ ok: false, reason: 'offline' });
    this.undoTrackedOpIds.clear();
    await this.persistence?.close?.();
  }

  // ---- DocumentSetup ----------------------------------------------------------------------

  scaleFor(pageIndex: number): Scale {
    return this.scaleSnapshot[pageIndex] ?? DEFAULT_SCALE;
  }

  scaleAt(pageIndex: number, p: Point): Scale {
    return viewportAt(this.viewportSnapshot, pageIndex, p)?.scale ?? this.scaleFor(pageIndex);
  }

  scaleOf(m: Pick<Markup, 'points' | 'pageIndex'>): Scale {
    return scaleOfMarkup(m, this.scaleFor(m.pageIndex), this.viewportSnapshot);
  }

  hasScale(pageIndex: number): boolean {
    return Object.hasOwn(this.scaleSnapshot, pageIndex);
  }

  isScaledAt(pageIndex: number, p: Point): boolean {
    const vp = viewportAt(this.viewportSnapshot, pageIndex, p);
    if (vp && vp.scale.metersPerPoint !== DEFAULT_SCALE.metersPerPoint) return true;
    return this.hasScale(pageIndex);
  }

  allScales(): Readonly<Record<number, Scale>> {
    return this.scaleSnapshot;
  }

  setScale(pageIndexes: Iterable<number>, scale: Scale): void {
    if (this.readOnly) return;
    const next: Record<number, Scale> = { ...this.scaleSnapshot };
    let changed = false;
    for (const i of pageIndexes) {
      next[i] = structuredClone(scale);
      changed = true;
    }
    if (!changed) return;
    this.scaleSnapshot = next;
    this._editCount += 1;
    this.schedulePersist();
    this.notify();
  }

  setScales(entries: Iterable<readonly [number, Scale]>): void {
    if (this.readOnly) return;
    const next: Record<number, Scale> = { ...this.scaleSnapshot };
    let changed = false;
    for (const [i, scale] of entries) {
      next[i] = structuredClone(scale);
      changed = true;
    }
    if (!changed) return;
    this.scaleSnapshot = next;
    this._editCount += 1;
    this.schedulePersist();
    this.notify();
  }

  allViewports(): Viewport[] {
    return this.viewportSnapshot;
  }

  setViewport(v: Viewport): void {
    if (this.readOnly) return;
    const filtered = this.viewportSnapshot.filter((existing) => existing.id !== v.id);
    this.viewportSnapshot = [...filtered, structuredClone(v)];
    this._editCount += 1;
    this.schedulePersist();
    this.notify();
  }

  removeViewport(id: string): void {
    if (this.readOnly) return;
    const next = this.viewportSnapshot.filter((v) => v.id !== id);
    if (next.length === this.viewportSnapshot.length) return;
    this.viewportSnapshot = next;
    this._editCount += 1;
    this.schedulePersist();
    this.notify();
  }

  allSheets(): Readonly<Record<number, SheetInfo>> {
    return this.sheetSnapshot;
  }

  setDetectedSheets(entries: Iterable<[pageIndex: number, info: SheetInfo]>): void {
    if (this.readOnly) return;
    const next: Record<number, SheetInfo> = { ...this.sheetSnapshot };
    let changed = false;
    for (const [i, info] of entries) {
      const current = next[i];
      if (!current || SOURCE_RANK[info.source] >= SOURCE_RANK[current.source]) {
        next[i] = structuredClone(info);
        changed = true;
      }
    }
    if (!changed) return;
    this.sheetSnapshot = next;
    this.schedulePersist();
    this.notify();
  }

  editSheet(pageIndex: number, patch: Partial<Pick<SheetInfo, 'number' | 'title'>>): void {
    if (this.readOnly) return;
    const current = this.sheetSnapshot[pageIndex];
    const base: SheetInfo = current ?? {
      number: null,
      title: null,
      discipline: null,
      scaleText: null,
      revision: null,
      source: 'manual',
      confidence: 1,
    };
    this.sheetSnapshot = {
      ...this.sheetSnapshot,
      [pageIndex]: { ...base, ...patch, source: 'manual', confidence: 1 },
    };
    this._editCount += 1;
    this.schedulePersist();
    this.notify();
  }

  columnSet(): ColumnSet {
    return this.columnSnapshot;
  }

  hasColumnSet(): boolean {
    return this.customColumnSet;
  }

  setColumnSet(set: ColumnSet): void {
    if (this.readOnly) return;
    this.columnSnapshot = {
      columns: structuredClone(set.columns),
      statuses: set.statuses.length ? structuredClone(set.statuses) : DEFAULT_STATUSES,
    };
    this.customColumnSet = true;
    this._editCount += 1;
    this.schedulePersist();
    this.notify();
  }

  // ---- Inbox actions ----------------------------------------------------------------------

  private discardInbox(id: string): void {
    const next = this.inbox.filter((e) => e.id !== id);
    if (next.length === this.inbox.length) return;
    this.inbox = next;
    this.schedulePersist();
    this.notifySync();
  }

  private copyInbox(id: string): Operation[] | undefined {
    const entry = this.inbox.find((e) => e.id === id);
    return entry ? structuredClone([...entry.ops]) : undefined;
  }

  private retryInboxAsNew(id: string): boolean {
    if (this.readOnly) return false;
    const entry = this.inbox.find((e) => e.id === id);
    if (!entry) return false;
    const rebuilt = buildRetryOps(entry.ops, this.confirmed, this.view, this.newId, this.clock());
    if (!rebuilt) return false;
    // Re-chunk so an entry gathered from several batches still fits the batch size limit.
    const fresh = this.stampBatch(
      rebuilt.map(({ batchId: _batchId, batchSize: _batchSize, ...op }) => op as Operation),
    );
    const res = applyUnits(this.view, fresh, this.optimisticContext());
    if (!res.ok) return false;

    this.inbox = this.inbox.filter((e) => e.id !== id);
    this.pending = [...this.pending, ...fresh];
    this.view = res.state;
    this._editCount += 1;
    this.refreshProjection();
    this.schedulePersist();
    this.notifyAll();
    void this.flush();
    return true;
  }

  // ---- Draft / batch editing helpers ------------------------------------------------------

  private emptyDraft(): PendingBatchDraft {
    return { ops: [], checks: [], inverse: [], forward: [], forwardChecks: [], addedMarkups: [], label: null };
  }

  private runEdit(fn: (draft: PendingBatchDraft) => void): void {
    if (this.batchDraft) {
      fn(this.batchDraft);
      return;
    }
    const draft = this.emptyDraft();
    try {
      fn(draft);
    } catch (err) {
      this.rebaseAndProject(false);
      throw err;
    }
    this.commitDraft(draft);
  }

  private applyDraftOps(draft: PendingBatchDraft, ops: readonly Operation[]): void {
    const ctx = this.optimisticContext();
    for (const op of ops) {
      const res = applyOp(this.view, op, ctx);
      if (!res.ok) {
        throw new Error(`Optimistic apply failed for ${op.type} ${op.entityId}: ${res.rejection.code}`);
      }
      this.view = res.state;
      draft.ops.push(op);
    }
    this.refreshProjection();
  }

  private recordGroupCheck(draft: PendingBatchDraft, check: UndoGroupCheck): void {
    // If an earlier op inside the same batch already recorded a check for (kind, entityId, group),
    // keep its original `preOpId` and advance its `expectedOpId` to the latest op in the batch.
    const existing = draft.checks.find(
      (c) => c.kind === check.kind && c.entityId === check.entityId && c.group === check.group,
    );
    if (existing) {
      existing.expectedOpId = check.expectedOpId;
      return;
    }
    // If the record was created earlier in the same batch (group: '*'), mark this op as part of the create.
    const created = draft.checks.find(
      (c) => c.kind === check.kind && c.entityId === check.entityId && c.group === '*',
    );
    if (created) {
      created.revertedOpIds = [...(created.revertedOpIds ?? []), check.expectedOpId];
      return;
    }
    draft.checks.push(check);
  }

  private emitDiffIntoDraft(draft: PendingBatchDraft, before: Markup, after: Markup, label: string | null): void {
    const diff = diffMarkup(before, after);
    const now = this.clock();
    const ops: Operation[] = [];

    // 1. Content & custom fields patch.
    if (diff.contentGroups.length > 0) {
      const viewRec = own(this.view.markups, before.id);
      if (viewRec && !viewRec.deleted) {
        const confRec = own(this.confirmed.markups, before.id);
        const basedOn: Record<string, number | string> = {};
        const preOps = new Map<string, string>();
        for (const g of diff.contentGroups) {
          basedOn[g] = baseForGroup(confRec, viewRec, g);
          preOps.set(g, versionOf(viewRec, g).op);
        }
        const opId = this.newId();
        const payload: { set?: typeof diff.contentSet; fields?: typeof diff.fieldsPatch } = {};
        if (Object.keys(diff.contentSet).length) payload.set = diff.contentSet;
        if (Object.keys(diff.fieldsPatch).length) payload.fields = diff.fieldsPatch;

        ops.push({
          opId,
          schemaVersion: PROTOCOL_VERSION,
          streamId: this.streamId,
          type: 'markup.patch',
          entityId: before.id,
          basedOn,
          payload,
          clientTime: now,
        });

        for (const g of diff.contentGroups) {
          this.recordGroupCheck(draft, {
            kind: 'markup',
            entityId: before.id,
            group: g,
            expectedOpId: opId,
            preOpId: preOps.get(g) ?? null,
          });
          draft.forwardChecks.push({ kind: 'markup', entityId: before.id, group: g });
        }

        const invPayload: Record<string, unknown> = {};
        if (Object.keys(diff.inverseContentSet).length) invPayload.set = diff.inverseContentSet;
        if (Object.keys(diff.inverseFieldsPatch).length) invPayload.fields = diff.inverseFieldsPatch;
        draft.inverse.unshift({
          type: 'markup.patch',
          entityId: before.id,
          payload: invPayload,
          groups: diff.contentGroups,
        });
        draft.forward.push({
          type: 'markup.patch',
          entityId: before.id,
          payload: structuredClone(payload) as Record<string, unknown>,
          groups: diff.contentGroups,
        });
      }
    }

    // 2. Placement change (either cross-page move or same-page geometry patch).
    const oldPlacement = this.placementByMarkup.get(before.id);
    if (diff.pageChanged && oldPlacement && !oldPlacement.deleted) {
      const nextPageId = this.requirePageId(after.pageIndex);
      const { geometry: nextGeometry } = splitMarkup(after);
      const delOpId = this.newId();
      const createOpId = this.newId();
      const newPlacementId = this.newId();
      const prevDelOp = versionOf(oldPlacement, 'deleted').op;

      ops.push(
        {
          opId: delOpId,
          schemaVersion: PROTOCOL_VERSION,
          streamId: this.streamId,
          type: 'placement.delete',
          entityId: oldPlacement.id,
          payload: {},
          clientTime: now,
        },
        {
          opId: createOpId,
          schemaVersion: PROTOCOL_VERSION,
          streamId: this.streamId,
          type: 'placement.create',
          entityId: newPlacementId,
          payload: {
            markupId: before.id,
            revisionId: this.revisionId,
            pageId: nextPageId,
            geometry: nextGeometry,
            method: oldPlacement.method,
            confidence: oldPlacement.confidence,
            state: oldPlacement.state,
          },
          clientTime: now,
        },
      );

      this.recordGroupCheck(draft, {
        kind: 'placement',
        entityId: oldPlacement.id,
        group: 'deleted',
        expectedOpId: delOpId,
        preOpId: prevDelOp,
      });
      draft.checks.push({
        kind: 'placement',
        entityId: newPlacementId,
        group: '*',
        expectedOpId: createOpId,
        preOpId: null,
        revertedOpIds: [],
      });
      draft.inverse.unshift(
        { type: 'placement.delete', entityId: newPlacementId, payload: {}, groups: ['deleted'] },
        { type: 'placement.restore', entityId: oldPlacement.id, payload: {}, groups: ['deleted'] },
      );
      draft.forward.push(
        { type: 'placement.delete', entityId: oldPlacement.id, payload: {}, groups: ['deleted'] },
        { type: 'placement.restore', entityId: newPlacementId, payload: {}, groups: ['deleted'] },
      );
      draft.forwardChecks.push(
        { kind: 'placement', entityId: oldPlacement.id, group: 'deleted' },
        { kind: 'placement', entityId: newPlacementId, group: 'deleted' },
      );
    } else if (diff.geometryChanged && oldPlacement && !oldPlacement.deleted) {
      const confPlace = own(this.confirmed.placements, oldPlacement.id);
      const preOpId = versionOf(oldPlacement, 'geometry').op;
      const opId = this.newId();
      const payload = { geometry: diff.geometryPatch };
      ops.push({
        opId,
        schemaVersion: PROTOCOL_VERSION,
        streamId: this.streamId,
        type: 'placement.patch',
        entityId: oldPlacement.id,
        basedOn: { geometry: baseForGroup(confPlace, oldPlacement, 'geometry') },
        payload,
        clientTime: now,
      });

      this.recordGroupCheck(draft, {
        kind: 'placement',
        entityId: oldPlacement.id,
        group: 'geometry',
        expectedOpId: opId,
        preOpId,
      });
      draft.inverse.unshift({
        type: 'placement.patch',
        entityId: oldPlacement.id,
        payload: { geometry: diff.inverseGeometryPatch },
        groups: ['geometry'],
      });
      draft.forward.push({
        type: 'placement.patch',
        entityId: oldPlacement.id,
        payload: structuredClone(payload) as Record<string, unknown>,
        groups: ['geometry'],
      });
      draft.forwardChecks.push({ kind: 'placement', entityId: oldPlacement.id, group: 'geometry' });
    }

    if (!ops.length) return;
    this.applyDraftOps(draft, ops);
    if (label && !draft.label) draft.label = label;
  }

  private commitDraft(draft: PendingBatchDraft): void {
    if (!draft.ops.length) return;
    const stamped = this.stampBatch(draft.ops);
    this.pending = [...this.pending, ...stamped];
    this._editCount += 1;

    // Push discrete undo step and clear redo stack.
    if (draft.inverse.length > 0) {
      this.undoStack = [
        ...this.undoStack,
        {
          id: this.newId(),
          label: draft.label ?? describeOps(stamped),
          at: this.clock(),
          checks: draft.checks,
          inverse: draft.inverse,
          forward: draft.forward,
          forwardChecks: draft.forwardChecks,
          sourceOpIds: stamped.map((o) => o.opId),
        },
      ];
      this.redoStack = [];
      this.historyEpoch += 1;
    }

    // Re-apply cleanly so batchId/batchSize metadata matches `pending`.
    this.rebaseAndProject(false);
    this.schedulePersist();
    this.notifyAll();

    if (this.context.onAdded) {
      for (const id of draft.addedMarkups) {
        const added = this.projectedMap.get(id);
        if (added) this.context.onAdded(this, added);
      }
    }

    void this.flush();
  }

  private stampBatch(ops: readonly Operation[]): Operation[] {
    if (ops.length <= 1) return [...ops];
    const markupOf = (op: Operation): string => {
      if (op.type === 'placement.create') return op.payload.markupId;
      return (op.type.startsWith('placement.') ? own(this.view.placements, op.entityId)?.markupId : undefined) ?? op.entityId;
    };
    const out: Operation[] = [];
    for (const chunk of splitIntoBatches(ops, markupOf)) {
      if (chunk.length === 1) {
        out.push(chunk[0]!);
      } else {
        const batchId = this.newId();
        for (const op of chunk) out.push({ ...op, batchId, batchSize: chunk.length });
      }
    }
    return out;
  }

  // ---- Undo / Redo execution --------------------------------------------------------------

  private async executeHistoryStep(kind: 'undo' | 'redo'): Promise<UndoResult> {
    if (this.destroyed) return { ok: false, reason: 'offline' };
    if (this.readOnly) return { ok: false, reason: 'forbidden' };
    const stack = kind === 'undo' ? this.undoStack : this.redoStack;
    const step = stack[stack.length - 1];
    if (!step) return { ok: false, reason: 'nothing' };

    // 1. Permission UI hint check on all touched markups.
    for (const check of step.checks) {
      if (check.kind === 'markup') {
        const projected = this.projectedMap.get(check.entityId);
        if (projected && !this.mayEdit(projected)) {
          return { ok: false, reason: 'forbidden' };
        }
      }
    }

    // 2. Local version check (all or nothing for a batch).
    if (!this.allChecksMatch(step.checks)) {
      // Permanently diverged: pop so the stack does not wedge, and report 'changed' (never silently skip).
      if (kind === 'undo') this.undoStack = this.undoStack.slice(0, -1);
      else this.redoStack = this.redoStack.slice(0, -1);
      this.schedulePersist();
      this.notifyAll();
      return { ok: false, reason: 'changed' };
    }

    // 3. Connection check: undo sends a new operation verified by the server.
    if (this._connection === 'revoked') return { ok: false, reason: 'forbidden' };
    if (this._connection !== 'connected' || !this.transport) {
      return { ok: false, reason: 'offline' };
    }

    // 4. Materialize fresh inverse operations (with current `basedOn` versions).
    const emitted = this.materializeUndoOps(step.inverse);
    if (!emitted) {
      if (kind === 'undo') this.undoStack = this.undoStack.slice(0, -1);
      else this.redoStack = this.redoStack.slice(0, -1);
      this.schedulePersist();
      this.notifyAll();
      return { ok: false, reason: 'changed' };
    }

    // 5. Optimistically apply every chunk; if any chunk fails locally, nothing is applied or sent.
    const res = applyUnits(this.view, emitted, this.optimisticContext());
    if (!res.ok) {
      if (kind === 'undo') this.undoStack = this.undoStack.slice(0, -1);
      else this.redoStack = this.redoStack.slice(0, -1);
      this.schedulePersist();
      this.notifyAll();
      return { ok: false, reason: 'changed' };
    }

    const opIds = new Set(emitted.map((o) => o.opId));
    for (const id of opIds) this.undoTrackedOpIds.add(id);

    this.pending = [...this.pending, ...emitted];
    this.view = res.state;
    this.refreshProjection();
    this.schedulePersist();
    this.notifyAll();

    return new Promise<UndoResult>((resolve) => {
      const deferred: DeferredUndo = {
        opIds,
        kind,
        step,
        emittedOps: emitted,
        sent: false,
        epoch: this.historyEpoch,
        resolve,
      };
      this.pendingUndos.push(deferred);
      void this.flush();
    });
  }

  private allChecksMatch(checks: readonly UndoGroupCheck[]): boolean {
    const recordOf = (check: UndoGroupCheck): VersionedRecord | undefined =>
      check.kind === 'markup' ? own(this.view.markups, check.entityId) : own(this.view.placements, check.entityId);
    // Records this same step deleted: their other group checks still apply (undo restores first).
    const deletedByStep = new Set<string>();
    for (const check of checks) {
      if (check.group !== 'deleted') continue;
      const record = recordOf(check);
      if (record?.deleted && versionOf(record, 'deleted').op === check.expectedOpId) {
        deletedByStep.add(`${check.kind}:${check.entityId}`);
      }
    }

    for (const check of checks) {
      const record = recordOf(check);
      if (!record) return false;

      if (check.group === '*') {
        // A deleted record passes only if the delete was this step's own (its op is then allowed).
        const allowed = new Set<string>([check.expectedOpId, ...(check.revertedOpIds ?? [])]);
        if (!allowed.has(record.createdBy)) return false;
        for (const ver of Object.values(record.versions)) {
          if (!allowed.has(ver.op)) return false;
        }
      } else if (check.group === 'deleted') {
        if (versionOf(record, 'deleted').op !== check.expectedOpId) return false;
      } else {
        if (record.deleted && !deletedByStep.has(`${check.kind}:${check.entityId}`)) return false;
        if (versionOf(record, check.group).op !== check.expectedOpId) return false;
      }
    }
    return true;
  }

  private materializeUndoOps(specs: readonly UndoOpSpec[]): Operation[] | null {
    const now = this.clock();
    const raw: Operation[] = [];
    let simView = this.view;
    const ctx = this.optimisticContext();

    for (const spec of specs) {
      const opId = this.newId();
      let basedOn: Record<string, number | string> | undefined;

      if (spec.type === 'markup.patch') {
        const viewRec = own(simView.markups, spec.entityId);
        if (!viewRec || viewRec.deleted) return null;
        const confRec = own(this.confirmed.markups, spec.entityId);
        basedOn = {};
        for (const g of spec.groups) basedOn[g] = baseForGroup(confRec, viewRec, g);
      } else if (spec.type === 'placement.patch') {
        const viewRec = own(simView.placements, spec.entityId);
        if (!viewRec || viewRec.deleted) return null;
        const confRec = own(this.confirmed.placements, spec.entityId);
        basedOn = {};
        for (const g of spec.groups) basedOn[g] = baseForGroup(confRec, viewRec, g);
      }

      const op = {
        opId,
        schemaVersion: PROTOCOL_VERSION,
        streamId: this.streamId,
        type: spec.type,
        entityId: spec.entityId,
        ...(basedOn ? { basedOn } : {}),
        payload: structuredClone(spec.payload),
        clientTime: now,
      } as Operation;

      const sim = applyOp(simView, op, ctx);
      if (!sim.ok) return null;
      simView = sim.state;
      raw.push(op);
    }

    return this.stampBatch(raw);
  }

  private completeDeferredUndo(deferred: DeferredUndo, ok: boolean, rejection?: ServerRejection): void {
    const idx = this.pendingUndos.indexOf(deferred);
    if (idx < 0) return;
    this.pendingUndos.splice(idx, 1);
    for (const id of deferred.opIds) this.undoTrackedOpIds.delete(id);

    if (ok) {
      // Pop from source stack.
      if (deferred.kind === 'undo') {
        this.undoStack = this.undoStack.filter((s) => s.id !== deferred.step.id);
      } else {
        this.redoStack = this.redoStack.filter((s) => s.id !== deferred.step.id);
      }

      // Build map of (kind:entityId:group) -> newly emitted opId.
      const emittedByGroup = new Map<string, string>();
      for (let i = 0; i < deferred.step.inverse.length; i++) {
        const spec = deferred.step.inverse[i]!;
        const op = deferred.emittedOps[i]!;
        const kind = spec.type.startsWith('markup.') ? 'markup' : 'placement';
        for (const g of spec.groups) emittedByGroup.set(`${kind}:${spec.entityId}:${g}`, op.opId);
      }

      // Advance earlier steps on the source stack whose expectedOpId was this step's preOpId,
      // so consecutive undos (and add -> edit -> undo edit -> undo add) chain seamlessly.
      const sourceStack = deferred.kind === 'undo' ? this.undoStack : this.redoStack;
      for (const check of deferred.step.checks) {
        if (!check.preOpId) continue;
        const newOpId = emittedByGroup.get(`${check.kind}:${check.entityId}:${check.group}`);
        if (!newOpId) continue;
        for (const earlier of sourceStack) {
          for (const ec of earlier.checks) {
            if (ec.kind !== check.kind || ec.entityId !== check.entityId) continue;
            if (ec.group === check.group && ec.expectedOpId === check.preOpId) {
              ec.expectedOpId = newOpId;
            } else if (ec.group === '*') {
              const allowed = new Set([ec.expectedOpId, ...(ec.revertedOpIds ?? [])]);
              if (allowed.has(check.preOpId)) {
                ec.revertedOpIds = [...(ec.revertedOpIds ?? []), newOpId];
              }
            }
          }
        }
      }

      // Push the complementary step onto the opposite stack.
      const reverseChecks: UndoGroupCheck[] = [];
      const seenReverse = new Set<string>();
      for (const fc of deferred.step.forwardChecks) {
        const key = `${fc.kind}:${fc.entityId}:${fc.group}`;
        if (seenReverse.has(key)) continue;
        seenReverse.add(key);
        const emittedOpId = emittedByGroup.get(key);
        if (!emittedOpId) continue;
        const origCheck = deferred.step.checks.find(
          (c) => c.kind === fc.kind && c.entityId === fc.entityId && (c.group === fc.group || c.group === '*'),
        );
        if (fc.created) {
          // The record was created by the step this one reverses: keep the "nobody else edited it"
          // check, now also allowing our own restore op.
          reverseChecks.push({
            kind: fc.kind,
            entityId: fc.entityId,
            group: '*',
            expectedOpId: fc.created.expectedOpId,
            preOpId: origCheck?.expectedOpId ?? null,
            revertedOpIds: [...fc.created.revertedOpIds, emittedOpId],
          });
          continue;
        }
        reverseChecks.push({
          kind: fc.kind,
          entityId: fc.entityId,
          group: fc.group,
          expectedOpId: emittedOpId,
          preOpId: origCheck?.expectedOpId ?? null,
        });
      }

      const reverseStep: UndoStep = {
        id: this.newId(),
        label: deferred.step.label,
        at: this.clock(),
        checks: reverseChecks,
        inverse: deferred.step.forward,
        forward: deferred.step.inverse,
        forwardChecks: deferred.step.checks.map((c): ForwardCheck =>
          c.group === '*'
            ? {
                kind: c.kind,
                entityId: c.entityId,
                group: 'deleted',
                created: { expectedOpId: c.expectedOpId, revertedOpIds: [...(c.revertedOpIds ?? [])] },
              }
            : { kind: c.kind, entityId: c.entityId, group: c.group },
        ),
        sourceOpIds: deferred.emittedOps.map((o) => o.opId),
      };

      if (deferred.kind === 'undo') {
        // A new edit made while this undo was in flight discards redo, as it would have if the
        // undo had finished first.
        if (deferred.epoch === this.historyEpoch) this.redoStack = [...this.redoStack, reverseStep];
      } else {
        this.undoStack = [...this.undoStack, reverseStep];
      }

      this._editCount += 1;
      this.schedulePersist();
      this.notifyAll();
      deferred.resolve({ ok: true });
      return;
    }

    // Rejected by the server, or stale on rebase. Take back whatever part of it already applied.
    this.rollBackPartialHistory(deferred);
    const reason: 'changed' | 'forbidden' = rejection?.code === 'forbidden' ? 'forbidden' : 'changed';
    if (reason === 'changed') {
      if (deferred.kind === 'undo') {
        this.undoStack = this.undoStack.filter((s) => s.id !== deferred.step.id);
      } else {
        this.redoStack = this.redoStack.filter((s) => s.id !== deferred.step.id);
      }
    }
    this.schedulePersist();
    this.notifyAll();
    deferred.resolve({ ok: false, reason });
  }

  /**
   * For a refused undo/redo sent in several chunks: drops its chunks that were not committed, and
   * if earlier chunks were committed, queues compensating ops (the step's `forward` ops for the
   * groups those chunks touched) so the request as a whole has no effect.
   */
  private rollBackPartialHistory(deferred: DeferredUndo): void {
    const before = this.pending.length;
    this.pending = this.pending.filter((o) => !deferred.opIds.has(o.opId) || this.confirmedOpIds.has(o.opId));
    const committed = deferred.emittedOps
      .map((op, i) => ({ op, spec: deferred.step.inverse[i] }))
      .filter((e) => this.confirmedOpIds.has(e.op.opId) && e.spec);

    if (committed.length) {
      const touched = new Set<string>();
      for (const { spec } of committed) {
        for (const g of spec!.groups) touched.add(`${opKind(spec!.type)}:${spec!.entityId}:${g}`);
      }
      const specs = deferred.step.forward.filter((s) =>
        s.groups.some((g) => touched.has(`${opKind(s.type)}:${s.entityId}:${g}`)),
      );
      this.rebaseAndProject(true);
      const ops = specs.length ? this.materializeUndoOps(specs) : null;
      if (ops) {
        const res = applyUnits(this.view, ops, this.optimisticContext());
        if (res.ok) {
          this.pending = [...this.pending, ...ops];
          this.view = res.state;
        }
      }
      if (!ops) this._lastError = 'Part of an undo was applied and could not be taken back';
      this.refreshProjection();
      void this.flush();
    } else if (this.pending.length !== before) {
      this.rebaseAndProject(true);
    }
  }

  /**
   * Called when the connection drops. Undo/redo requests that never left the client are cancelled
   * (`offline`). Requests already sent may have been committed: their ops stay queued (resent with
   * the same opIds) and the request completes when the server confirms or refuses them.
   */
  private failInFlightUndos(reason: 'offline' | 'forbidden'): void {
    const active = this.pendingUndos.filter((d) => reason === 'forbidden' || !d.sent);
    if (!active.length) return;
    this.pendingUndos = this.pendingUndos.filter((d) => !active.includes(d));
    for (const d of active) {
      for (const id of d.opIds) this.undoTrackedOpIds.delete(id);
      // Drop unacknowledged undo ops so they don't silently execute later after reporting failure.
      this.pending = this.pending.filter((o) => !d.opIds.has(o.opId));
      d.resolve({ ok: false, reason });
    }
    this.rebaseAndProject(false);
    this.schedulePersist();
    this.notifyAll();
  }

  // ---- Incoming transport messages --------------------------------------------------------

  private attachTransport(transport: SyncTransport): void {
    if (this.unsubTransportMessage) this.unsubTransportMessage();
    if (this.unsubTransportState) this.unsubTransportState();
    this.transport = transport;
    this.unsubTransportMessage = transport.onMessage((msg) => this.handleMessage(msg));
    this.unsubTransportState = transport.onStateChange((state) => this.handleTransportState(state));
  }

  private handleTransportState(state: TransportState): void {
    if (this.destroyed) return;
    if (state === 'disconnected') {
      this.inFlightOpIds.clear();
      this.failInFlightUndos('offline');
      if (this._connection !== 'revoked' && this._connection !== 'update_required') {
        this.setConnection('disconnected');
      }
    } else if (state === 'connecting') {
      if (this._connection !== 'revoked' && this._connection !== 'update_required') {
        this.setConnection(this.cursor ? 'reconnecting' : 'connecting');
      }
    }
  }

  private handleMessage(msg: ServerMessage): void {
    if (this.destroyed) return;

    switch (msg.type) {
      case 'welcome': {
        if (!msg.protocol.ok) {
          this._lastError = msg.protocol.reason;
          if (msg.protocol.reason === 'client_too_old') {
            this.setConnection('update_required');
          } else {
            this.setConnection('disconnected');
          }
          return;
        }
        if (msg.snapshot) {
          this.applySnapshot(msg.snapshot.state, msg.snapshot.cursor, msg.snapshot.appliedOpIds);
        }
        if (msg.events?.length) {
          for (const ev of msg.events) this.applyServerEvent(ev, false);
          this.rebaseAndProject(true);
        }
        // Only a successful welcome lifts a revocation.
        this.revoked = false;
        this.setConnection('connected');
        this.schedulePersist();
        this.notifyAll();
        void this.flush();
        return;
      }

      case 'snapshot': {
        this.applySnapshot(msg.state, msg.cursor, msg.appliedOpIds);
        this.schedulePersist();
        this.notifyAll();
        void this.flush();
        return;
      }

      case 'ack': {
        this.handleAck(msg);
        return;
      }

      case 'reject': {
        this.handleReject(msg);
        return;
      }

      case 'event': {
        this.applyServerEvent(msg.event, true);
        this.schedulePersist();
        this.notifyAll();
        return;
      }

      case 'revoked': {
        this.handleRevoked(msg.reason);
        return;
      }
    }
  }

  private applySnapshot(state: OpsState, cursor: string, appliedOpIds?: readonly string[]): void {
    this.confirmed = structuredClone(state);
    this.cursor = cursor;
    const alreadyApplied = new Set<string>(appliedOpIds ?? []);
    // Also detect any pending opIds already baked into records in the snapshot.
    for (const rec of [...Object.values(state.markups), ...Object.values(state.placements), ...Object.values(state.issues), ...Object.values(state.responses)]) {
      alreadyApplied.add(rec.createdBy);
      for (const v of Object.values(rec.versions)) alreadyApplied.add(v.op);
    }
    for (const id of alreadyApplied) this.confirmedOpIds.add(id);

    // Drop any pending ops that are already reflected in the snapshot.
    const newlyConfirmed = this.pending.filter((o) => alreadyApplied.has(o.opId));
    if (newlyConfirmed.length) {
      this.pending = this.pending.filter((o) => !alreadyApplied.has(o.opId));
      for (const op of newlyConfirmed) this.inFlightOpIds.delete(op.opId);
      for (const d of [...this.pendingUndos]) {
        if ([...d.opIds].every((id) => alreadyApplied.has(id))) {
          this.completeDeferredUndo(d, true);
        }
      }
    }

    this.rebaseAndProject(true);
  }

  private handleAck(msg: Extract<ServerMessage, { type: 'ack' }>): void {
    const opIdSet = new Set(msg.opIds);
    const matchingPending = this.pending.filter((o) => opIdSet.has(o.opId));
    for (const id of msg.opIds) this.inFlightOpIds.delete(id);

    // Idempotent: skip re-applying if already confirmed (e.g. duplicate ack or echoed event arrived first).
    const unapplied = matchingPending.filter((o) => !this.confirmedOpIds.has(o.opId));
    if (unapplied.length) {
      const ctx: ApplyContext = {
        actor: msg.actor,
        laneId: msg.laneId,
        now: msg.serverTime,
        ...(this.statuses ? { statuses: this.statuses } : {}),
      };
      this.applyConfirmedUnit(unapplied, ctx);
    }
    for (const id of msg.opIds) this.confirmedOpIds.add(id);
    this.cursor = msg.cursor;
    this.pending = this.pending.filter((o) => !opIdSet.has(o.opId));

    // A multi-chunk undo completes only once every one of its chunks is confirmed.
    const deferred = this.pendingUndos.find(
      (d) => msg.opIds.some((id) => d.opIds.has(id)) && [...d.opIds].every((id) => this.confirmedOpIds.has(id)),
    );
    this.rebaseAndProject(true);
    if (deferred) {
      this.completeDeferredUndo(deferred, true);
    } else {
      this.schedulePersist();
      this.notifyAll();
    }
    void this.flush();
  }

  private handleReject(msg: Extract<ServerMessage, { type: 'reject' }>): void {
    const opIdSet = new Set(msg.opIds);
    for (const id of msg.opIds) this.inFlightOpIds.delete(id);

    const matchingPending = this.pending.filter((o) => opIdSet.has(o.opId));
    this.pending = this.pending.filter((o) => !opIdSet.has(o.opId));

    const deferred = this.pendingUndos.find((d) => msg.opIds.some((id) => d.opIds.has(id)));
    if (deferred) {
      this.rebaseAndProject(true);
      this.completeDeferredUndo(deferred, false, msg.reason);
      return;
    }

    if (matchingPending.length) {
      const id = matchingPending[0]!.batchId ?? matchingPending[0]!.opId;
      if (!this.inbox.some((e) => e.id === id)) {
        this.pushInbox({
          id,
          ops: matchingPending,
          reason: msg.reason,
          rejectedAt: this.clock(),
          label: describeOps(matchingPending),
        });
      }
      this.dropInvalidatedUndoSteps(opIdSet);
    }

    // Rebase remaining pending ops, cascading any dependent ops to the inbox.
    this.rebaseAndProject(true, opIdSet);
    this.schedulePersist();
    this.notifyAll();
    void this.flush();
  }

  private applyServerEvent(event: ServerEvent, shouldRebase: boolean): void {
    const unapplied = event.ops.filter((o) => !this.confirmedOpIds.has(o.opId));
    const eventOpIds = new Set(event.ops.map((o) => o.opId));

    if (unapplied.length) {
      const ctx: ApplyContext = {
        actor: event.actor,
        laneId: event.laneId,
        now: event.serverTime,
        ...(this.statuses ? { statuses: this.statuses } : {}),
      };
      this.applyConfirmedUnit(unapplied, ctx);
      for (const op of unapplied) this.confirmedOpIds.add(op.opId);
    }

    this.cursor = event.cursor;

    // If this event includes any of our own pending ops (e.g. catch-up after a lost ack), clear them.
    const hadPending = this.pending.some((o) => eventOpIds.has(o.opId));
    if (hadPending) {
      this.pending = this.pending.filter((o) => !eventOpIds.has(o.opId));
      for (const id of eventOpIds) this.inFlightOpIds.delete(id);
      for (const d of [...this.pendingUndos]) {
        if ([...d.opIds].every((id) => this.confirmedOpIds.has(id))) {
          this.completeDeferredUndo(d, true);
        }
      }
    }

    if (shouldRebase) this.rebaseAndProject(true);
  }

  private applyConfirmedUnit(ops: readonly (Operation | ServerEvent['ops'][number])[], ctx: ApplyContext): void {
    if (ops.length === 1 && ops[0]!.batchId === undefined) {
      const res = applyOp(this.confirmed, ops[0]!, ctx);
      if (res.ok) this.confirmed = res.state;
      return;
    }
    const res = applyBatch(this.confirmed, ops, ctx);
    if (res.ok) {
      this.confirmed = res.state;
      return;
    }
    // Fallback: apply individually if an event carried unbatched ops together.
    let state = this.confirmed;
    for (const op of ops) {
      const r = applyOp(state, op, ctx);
      if (r.ok) state = r.state;
    }
    this.confirmed = state;
  }

  private handleRevoked(reason?: string): void {
    this._lastError = reason ?? 'Access removed';
    this.inFlightOpIds.clear();
    this.failInFlightUndos('forbidden');

    // Preserve any remaining local pending work in the rejected inbox so the user can export it.
    for (const unit of groupPendingUnits(this.pending)) {
      const id = unit[0]!.batchId ?? unit[0]!.opId;
      if (!this.inbox.some((e) => e.id === id)) {
        this.pushInbox({
          id,
          ops: unit,
          reason: { code: 'forbidden', ...(reason ? { message: reason } : {}) },
          rejectedAt: this.clock(),
          label: describeOps(unit),
        });
      }
    }

    // Clear cached document state apart from the rejected inbox.
    this.pending = [];
    this.confirmed = emptyState();
    this.view = emptyState();
    this.cursor = null;
    this.confirmedOpIds.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.clearSetup();
    this.refreshProjection();
    this.revoked = true;
    this.setConnection('revoked');
    this.schedulePersist();
    this.notifyAll();
  }

  // ---- Rebase, projection & persistence ---------------------------------------------------

  private rebaseAndProject(collectRejectedToInbox: boolean, previouslyRejected?: ReadonlySet<string>): void {
    const out = rebasePending({
      confirmed: this.confirmed,
      pending: this.pending,
      ctx: this.optimisticContext(),
      now: this.clock(),
      labelOf: describeOps,
      previouslyRejected,
    });
    this.view = out.viewState;
    this.pending = out.kept;

    if (out.rejected.length) {
      for (const id of out.rejectedOpIds) this.inFlightOpIds.delete(id);

      // Undo/redo ops never go to the inbox: their request is reported as failed instead.
      if (collectRejectedToInbox) {
        for (const entry of out.rejected) {
          if (entry.ops.every((o) => this.undoTrackedOpIds.has(o.opId))) continue;
          if (!this.inbox.some((e) => e.id === entry.id)) this.pushInbox(entry);
        }
      }

      this.dropInvalidatedUndoSteps(out.rejectedOpIds);
      this.refreshProjection();

      // Fail any tracked undo whose op became stale during rebase.
      for (const d of [...this.pendingUndos]) {
        if ([...d.opIds].some((id) => out.rejectedOpIds.has(id))) {
          this.completeDeferredUndo(d, false, { code: 'conflict', conflicts: [] });
        }
      }
      return;
    }

    this.refreshProjection();
  }

  private dropInvalidatedUndoSteps(rejectedOpIds: ReadonlySet<string>): void {
    if (!rejectedOpIds.size) return;
    this.undoStack = this.undoStack.filter((s) => !s.sourceOpIds.some((id) => rejectedOpIds.has(id)));
  }

  private refreshProjection(): void {
    const projected = projectMarkups(this.view, {
      revisionId: this.revisionId,
      pages: this.pages,
      laneId: this.laneId,
      resolveAuthor: this.resolveAuthor,
    });
    this.projectedList = projected.markups;
    this.projectedMap = projected.byId;
    this.placementByMarkup = projected.placementByMarkupId;
    this.hasConnectors = this.projectedList.some((m) => m.type === 'connector');
  }

  private pushInbox(entry: InboxEntry): void {
    this.inbox = [...this.inbox, entry];
  }

  private optimisticContext(): ApplyContext {
    return {
      actor: this.actor,
      laneId: this.laneId,
      now: this.clock(),
      ...(this.statuses ? { statuses: this.statuses } : {}),
    };
  }

  private requirePageId(pageIndex: number): string {
    const pageId = this.pages[pageIndex];
    if (!pageId) throw new RangeError(`No page id mapped for pageIndex ${pageIndex}`);
    return pageId;
  }

  private applySetup(setup: Partial<PersistedSetup>): void {
    if (setup.scales) this.scaleSnapshot = structuredClone(setup.scales);
    if (setup.viewports) this.viewportSnapshot = structuredClone(setup.viewports);
    if (setup.sheets) this.sheetSnapshot = structuredClone(setup.sheets);
    if (setup.columnSet) {
      this.columnSnapshot = {
        columns: structuredClone(setup.columnSet.columns),
        statuses: setup.columnSet.statuses.length ? structuredClone(setup.columnSet.statuses) : DEFAULT_STATUSES,
      };
      this.customColumnSet = true;
    }
  }

  private clearSetup(): void {
    this.scaleSnapshot = {};
    this.viewportSnapshot = [];
    this.sheetSnapshot = {};
    this.columnSnapshot = DEFAULT_COLUMN_SET;
    this.customColumnSet = false;
  }

  private snapshotForPersist(): PersistedSyncState {
    // Undo/redo ops that never left the client are not persisted, so a crash before sending leaves
    // the step cleanly retryable. Sent ones are kept (with a marker) because the server may have
    // committed them; they resend with the same opIds and complete the step on reconnect.
    const sentHistory = this.pendingUndos.filter((d) => d.sent);
    const keep = new Set(sentHistory.flatMap((d) => [...d.opIds]));
    const persistPending = this.pending.filter((o) => !this.undoTrackedOpIds.has(o.opId) || keep.has(o.opId));
    const state: PersistedSyncState = {
      formatVersion: 1,
      confirmed: structuredClone(this.confirmed),
      cursor: this.cursor,
      pending: structuredClone(persistPending),
      inbox: structuredClone(this.inbox),
      undoStack: structuredClone(this.undoStack),
      redoStack: structuredClone(this.redoStack),
      confirmedOpIds: [...this.confirmedOpIds],
      setup: {
        scales: structuredClone(this.scaleSnapshot) as Record<number, Scale>,
        viewports: structuredClone(this.viewportSnapshot),
        sheets: structuredClone(this.sheetSnapshot) as Record<number, SheetInfo>,
        columnSet: this.customColumnSet ? structuredClone(this.columnSnapshot) : null,
      },
    };
    if (sentHistory.length) {
      state.history = sentHistory.map((d) => ({
        kind: d.kind,
        stepId: d.step.id,
        emittedOps: structuredClone(d.emittedOps),
      }));
    }
    if (this.revoked) {
      // Keep only the rejected inbox (the user's own unsynced work) and the revoked flag.
      delete state.setup;
      state.revoked = true;
    }
    return state;
  }

  /**
   * Queues a save of the latest state. Saves run one at a time and coalesce: a save queued while
   * another runs snapshots the state when it starts. A failed save is reported in `lastError` and
   * never stops later saves.
   */
  private schedulePersist(): void {
    if (!this.persistence || this.destroyed || this.persistQueued) return;
    this.persistQueued = true;
    const persistence = this.persistence;
    const key = this.key;
    const link = this.persistChain
      .catch(() => undefined)
      .then(() => {
        this.persistQueued = false;
        return persistence.save(key, this.snapshotForPersist());
      });
    this.persistChain = link;
    link.then(
      () => {
        if (this.persistError === null) return;
        if (this._lastError === this.persistError) this._lastError = null;
        this.persistError = null;
        this.notifySync();
      },
      (err: unknown) => {
        this.persistError = `Could not save local changes: ${err instanceof Error ? err.message : String(err)}`;
        this._lastError = this.persistError;
        this.notifySync();
      },
    );
  }

  private setConnection(next: ConnectionState): void {
    if (this._connection === next) return;
    this._connection = next;
    this.notifySync();
    if (next === 'revoked') this.notify();
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  private notifySync(): void {
    for (const l of [...this.syncListeners]) l();
  }

  private notifyAll(): void {
    this.notify();
    this.notifySync();
  }
}
