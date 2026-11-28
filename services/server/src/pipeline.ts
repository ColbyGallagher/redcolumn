import { createHash } from 'node:crypto';
import {
  applyBatch,
  applyOp,
  dependencies,
  emptyState,
  parseOperation,
  type Actor,
  type ApplyContext,
  type Change,
  type MarkupRecord,
  type Operation,
  type OpsState,
  type Placement,
  type Rejection,
} from '@nb/ops';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Broadcaster, StreamEvent } from './broadcaster.ts';
import type { Database } from './db.ts';
import {
  addsSecondPlacement,
  authorizeDocumentOp,
  documentOfStream,
  findForeignPage,
  loadItemRows,
  newItemRow,
  resolveDocumentAccess,
  versionAfter,
  writeItemVersion,
  type DocumentAccess,
  type ItemVersion,
  type StoredItemRow,
} from './documentAccess.ts';

export type PipelineRejection =
  | Rejection
  | { code: 'op_id_conflict'; message: string }
  | { code: 'payload_too_large'; message: string }
  | { code: 'unsupported_operation'; message: string }
  | { code: 'forbidden'; message?: string };

export interface SubmitOptions {
  /**
   * Refuse a stream that is not a document's. Everything a client sends is submitted this way; a
   * document stream is always checked against the document's rules, with or without it.
   */
  documentOnly?: boolean;
}

export type OpAck =
  | { ok: true; opId: string; streamId: string; seq: number; receivedAt: string; replayed?: boolean }
  | { ok: false; opId: string | null; rejection: PipelineRejection; replayed?: boolean };

export type BatchAck =
  | { ok: true; streamId: string; results: Extract<OpAck, { ok: true }>[] }
  | { ok: false; index: number; opId: string | null; rejection: PipelineRejection };

export interface OpPipelineHooks {
  /** Called inside the DB transaction right before COMMIT. Throwing rolls back the transaction. */
  onBeforeCommit?: (ctx: { opIds: string[]; streamId: string }) => Promise<void> | void;
  /** Called after COMMIT succeeds, before broadcasting or returning the acknowledgement. */
  onAfterCommitBeforeAck?: (ctx: { opIds: string[]; streamId: string; events: StreamEvent[] }) => Promise<void> | void;
}

export interface OpPipelineOptions {
  db: Kysely<Database>;
  broadcaster: Broadcaster;
  maxOpBytes: number;
  defaultLaneId?: string;
  now?: () => number;
  hooks?: OpPipelineHooks;
}

const SUPPORTED_DOCUMENT_OPS = new Set<Operation['type']>([
  'markup.create',
  'markup.patch',
  'markup.delete',
  'markup.restore',
  'placement.create',
  'placement.patch',
  'placement.delete',
  'placement.restore',
]);

/** Deterministic JSON representation with recursively sorted object keys. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`).join(',')}}`;
}

export function hashOperationPayload(op: Operation): string {
  return createHash('sha256').update(canonicalizeJson(op), 'utf8').digest('hex');
}

function extractRawOpId(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'opId' in raw && typeof (raw as { opId: unknown }).opId === 'string') {
    return (raw as { opId: string }).opId;
  }
  return null;
}

const OP_ID_CONFLICT_MESSAGE = 'Operation id was already used for a different operation';

/**
 * Markup and placement ids are global, but each row belongs to one stream. A write that would
 * land on a row owned by another stream is refused; this error is thrown when a concurrent
 * transaction on another stream claimed the id after our pre-check, so the write is retried.
 */
class ForeignEntityError extends Error {
  readonly kind: 'markup' | 'placement';
  readonly id: string;
  constructor(kind: 'markup' | 'placement', id: string) {
    super(`${kind} "${id}" belongs to another stream`);
    this.name = 'ForeignEntityError';
    this.kind = kind;
    this.id = id;
  }
}

/** Unique indexes on op ids. Two streams racing on one opId fail on one of these. */
const OP_ID_UNIQUE_CONSTRAINTS = new Set(['op_results_pkey', 'events_op_id_key']);

function isRetryableTxError(err: unknown): boolean {
  if (err instanceof ForeignEntityError) return true;
  if (!err || typeof err !== 'object') return false;
  const { code, constraint } = err as { code?: unknown; constraint?: unknown };
  return code === '23505' && typeof constraint === 'string' && OP_ID_UNIQUE_CONSTRAINTS.has(constraint);
}

/**
 * Finds the first create op whose entity id is already used by a row on another stream.
 * Non-create ops need no check: state is loaded per stream, so a foreign id reads as not found.
 */
async function findForeignCreate(
  trx: Transaction<Database>,
  streamId: string,
  ops: readonly Operation[],
): Promise<{ index: number; kind: 'markup' | 'placement'; id: string } | null> {
  const markupIds = ops.filter((op) => op.type === 'markup.create').map((op) => op.entityId);
  const placementIds = ops.filter((op) => op.type === 'placement.create').map((op) => op.entityId);
  const foreign = new Set<string>();
  if (markupIds.length > 0) {
    const rows = await trx
      .selectFrom('markups')
      .select('id')
      .where('id', 'in', markupIds)
      .where('stream_id', '<>', streamId)
      .execute();
    for (const row of rows) foreign.add(`markup:${row.id}`);
  }
  if (placementIds.length > 0) {
    const rows = await trx
      .selectFrom('placements')
      .select('id')
      .where('id', 'in', placementIds)
      .where('stream_id', '<>', streamId)
      .execute();
    for (const row of rows) foreign.add(`placement:${row.id}`);
  }
  if (foreign.size === 0) return null;
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]!;
    const kind = op.type === 'markup.create' ? 'markup' : op.type === 'placement.create' ? 'placement' : null;
    if (kind && foreign.has(`${kind}:${op.entityId}`)) return { index, kind, id: op.entityId };
  }
  return null;
}

function measureBytes(raw: unknown, provided?: number): number {
  if (provided !== undefined) return provided;
  try {
    return Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  } catch {
    return Infinity;
  }
}

/** What a document stream's rules need for one write: who is writing, and the stored items' sharing state. */
interface DocumentWrite {
  access: DocumentAccess;
  rows: Map<string, StoredItemRow>;
}

type GuardResult = { ok: true; write: DocumentWrite | null } | { ok: false; rejection: PipelineRejection };

/** Checked after the stream is locked, so the answer reflects the membership in force when applying. */
async function guardStream(
  trx: Transaction<Database>,
  streamId: string,
  actor: Actor,
  options: SubmitOptions,
): Promise<GuardResult> {
  const document = await documentOfStream(trx, streamId);
  if (!document) {
    return options.documentOnly ? { ok: false, rejection: { code: 'forbidden' } } : { ok: true, write: null };
  }
  const access = await resolveDocumentAccess(trx, actor.userId, streamId);
  if (!access) return { ok: false, rejection: { code: 'forbidden' } };
  return { ok: true, write: { access, rows: new Map() } };
}

type Evaluation =
  | { ok: true; versions: (ItemVersion | null)[] }
  | { ok: false; index: number; rejection: PipelineRejection };

/**
 * Walks a document write one operation at a time, as the reducers will apply it: each operation
 * must be allowed against the state the earlier ones left. Returns the item version each one made.
 * Permission is asked before the reducer, so a hidden record is only ever "not found".
 */
async function evaluateDocumentWrite(
  trx: Transaction<Database>,
  write: DocumentWrite,
  state: OpsState,
  ops: readonly Operation[],
  ctx: ApplyContext,
): Promise<Evaluation> {
  const { access, rows } = write;
  const foreignPage = await findForeignPage(trx, access.documentId, ops);
  const versions: (ItemVersion | null)[] = [];
  let next = state;
  for (const [index, op] of ops.entries()) {
    const decision = authorizeDocumentOp(access, op, next, rows);
    if (!decision.ok) {
      const { reason } = decision;
      let rejection: PipelineRejection = { code: 'forbidden', message: reason.code };
      if (reason.code === 'not_found') {
        rejection =
          reason.kind === 'scope'
            ? { code: 'invalid', message: 'Unknown review scope' }
            : { code: 'not_found', kind: reason.kind as 'markup' | 'placement', id: reason.id };
      }
      return { ok: false, index, rejection };
    }
    if (index === foreignPage) {
      return { ok: false, index, rejection: { code: 'invalid', message: 'Unknown revision or page' } };
    }
    if (addsSecondPlacement(op, next)) {
      return { ok: false, index, rejection: { code: 'invalid', message: 'The markup is already placed on this revision' } };
    }
    const applied = applyOp(next, op, ctx);
    if (!applied.ok) return { ok: false, index, rejection: applied.rejection };
    next = applied.state;
    if (op.type === 'markup.create') rows.set(op.entityId, newItemRow(access));
    versions.push(versionAfter(access, op, next, rows));
  }
  return { ok: true, versions };
}

/** The columns an event row has for the sync feed: which item version it produced, in which lane. */
function eventAudience(version: ItemVersion | null | undefined) {
  return {
    item_kind: version?.kind ?? null,
    version_rev: version?.record.rev ?? null,
    lane_id: version?.row.originLaneId ?? null,
  };
}

async function lockStreams(trx: Transaction<Database>, streamIds: readonly string[]): Promise<Map<string, number>> {
  const uniqueSorted = [...new Set(streamIds)].sort();
  for (const id of uniqueSorted) {
    await trx
      .insertInto('streams')
      .values({ id, kind: 'document', seq: '0' })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }
  const locked = await trx
    .selectFrom('streams')
    .select(['id', 'seq'])
    .where('id', 'in', uniqueSorted)
    .orderBy('id', 'asc')
    .forUpdate()
    .execute();

  const seqByStream = new Map<string, number>();
  for (const row of locked) {
    seqByStream.set(row.id, Number(row.seq));
  }
  return seqByStream;
}

async function loadStateForOps(
  trx: Transaction<Database>,
  streamId: string,
  ops: readonly Operation[],
): Promise<OpsState> {
  const markupIds = new Set<string>();
  const placementIds = new Set<string>();

  for (const op of ops) {
    for (const dep of dependencies(op)) {
      if (dep.kind === 'markup') markupIds.add(dep.id);
      if (dep.kind === 'placement') placementIds.add(dep.id);
    }
  }

  const placements: Record<string, Placement> = {};
  if (placementIds.size > 0) {
    const rows = await trx
      .selectFrom('placements')
      .select(['id', 'markup_id', 'record_json'])
      .where('stream_id', '=', streamId)
      .where('id', 'in', [...placementIds])
      .execute();
    for (const row of rows) {
      placements[row.id] = row.record_json as Placement;
      markupIds.add(row.markup_id);
    }
  }

  // A markup has one live placement per revision, so making one needs to see its others.
  const placedMarkups = new Set<string>();
  for (const op of ops) {
    if (op.type === 'placement.create') placedMarkups.add(op.payload.markupId);
    if (op.type === 'placement.restore' && Object.hasOwn(placements, op.entityId)) {
      placedMarkups.add(placements[op.entityId]!.markupId);
    }
  }
  if (placedMarkups.size > 0) {
    const rows = await trx
      .selectFrom('placements')
      .select(['id', 'record_json'])
      .where('stream_id', '=', streamId)
      .where('markup_id', 'in', [...placedMarkups])
      .execute();
    for (const row of rows) {
      placements[row.id] = row.record_json as Placement;
    }
  }

  const markups: Record<string, MarkupRecord> = {};
  if (markupIds.size > 0) {
    const rows = await trx
      .selectFrom('markups')
      .select(['id', 'record_json'])
      .where('stream_id', '=', streamId)
      .where('id', 'in', [...markupIds])
      .execute();
    for (const row of rows) {
      markups[row.id] = row.record_json as MarkupRecord;
    }
  }

  return {
    ...emptyState(),
    markups,
    placements,
  };
}

async function persistChanges(
  trx: Transaction<Database>,
  streamId: string,
  state: OpsState,
  changes: readonly Change[],
  write: DocumentWrite | null,
): Promise<void> {
  const nowDate = new Date();
  const asDate = (ms: number | null) => (ms === null ? null : new Date(ms));
  for (const change of changes) {
    if (change.kind === 'markup') {
      const record = state.markups[change.id];
      if (!record) continue;
      const result = await trx
        .insertInto('markups')
        .values({
          id: record.id,
          stream_id: streamId,
          scope_id: record.scopeId,
          type: record.type,
          rev: record.rev,
          deleted: record.deleted,
          owner_user_id: record.owner.userId,
          owner_party_id: record.owner.partyId,
          owner_group_id: record.owner.groupId,
          record_json: sql`${JSON.stringify(record)}::jsonb`,
          project_id: write?.access.projectId ?? null,
          origin_lane_id: write?.rows.get(record.id)?.originLaneId ?? null,
          ...(write?.rows.has(record.id)
            ? {
                draft_visibility: write.rows.get(record.id)!.draftVisibility,
                checking_state: write.rows.get(record.id)!.released ? ('released' as const) : ('draft' as const),
              }
            : {}),
          client_time: asDate(record.clientTime),
          updated_at: nowDate,
        })
        .onConflict((oc) =>
          oc
            .column('id')
            .doUpdateSet({
              rev: record.rev,
              deleted: record.deleted,
              record_json: sql`${JSON.stringify(record)}::jsonb`,
              updated_at: nowDate,
            })
            .where('markups.stream_id', '=', streamId),
        )
        .executeTakeFirst();
      if (!result.numInsertedOrUpdatedRows) throw new ForeignEntityError('markup', record.id);
    } else if (change.kind === 'placement') {
      const record = state.placements[change.id];
      if (!record) continue;
      const result = await trx
        .insertInto('placements')
        .values({
          id: record.id,
          stream_id: streamId,
          markup_id: record.markupId,
          revision_id: record.revisionId,
          page_id: record.pageId,
          rev: record.rev,
          deleted: record.deleted,
          record_json: sql`${JSON.stringify(record)}::jsonb`,
          scope_id: write ? (state.markups[record.markupId]?.scopeId ?? null) : null,
          origin_lane_id: write?.rows.get(record.markupId)?.originLaneId ?? null,
          owner_party_id: state.markups[record.markupId]?.owner.partyId ?? null,
          // The column has no 'ai' value; the record keeps the exact method.
          method: record.method === 'ai' ? 'suggested' : record.method,
          client_time: asDate(record.clientTime),
          updated_at: nowDate,
        })
        .onConflict((oc) =>
          oc
            .column('id')
            .doUpdateSet({
              rev: record.rev,
              deleted: record.deleted,
              record_json: sql`${JSON.stringify(record)}::jsonb`,
              updated_at: nowDate,
            })
            .where('placements.stream_id', '=', streamId),
        )
        .executeTakeFirst();
      if (!result.numInsertedOrUpdatedRows) throw new ForeignEntityError('placement', record.id);
    }
  }
}

export class OpPipeline {
  private readonly db: Kysely<Database>;
  private readonly broadcaster: Broadcaster;
  private readonly maxOpBytes: number;
  private readonly defaultLaneId: string;
  private readonly now: () => number;
  private readonly hooks: OpPipelineHooks;

  constructor(options: OpPipelineOptions) {
    this.db = options.db;
    this.broadcaster = options.broadcaster;
    this.maxOpBytes = options.maxOpBytes;
    this.defaultLaneId = options.defaultLaneId ?? 'default';
    this.now = options.now ?? (() => Date.now());
    this.hooks = options.hooks ?? {};
  }

  /**
   * Runs a write transaction, retrying once when it lost a race that the stream lock cannot
   * prevent: the same opId submitted on two streams at once, or two streams creating the same
   * entity id. The retry sees the winner's committed rows and answers from them.
   */
  private async runTransaction<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(fn);
    } catch (err) {
      if (!isRetryableTxError(err)) throw err;
      return this.db.transaction().execute(fn);
    }
  }

  async submitOperation(
    rawInput: unknown,
    actor: Actor,
    rawByteLength?: number,
    options: SubmitOptions = {},
  ): Promise<OpAck> {
    const rawOpId = extractRawOpId(rawInput);
    const bytes = measureBytes(rawInput, rawByteLength);
    if (bytes > this.maxOpBytes) {
      return {
        ok: false,
        opId: rawOpId,
        rejection: { code: 'payload_too_large', message: `Operation exceeds maximum size of ${this.maxOpBytes} bytes` },
      };
    }

    const parsed = parseOperation(rawInput);
    if (!parsed.ok) {
      return { ok: false, opId: rawOpId, rejection: parsed.rejection };
    }
    const op = parsed.op;

    if (!SUPPORTED_DOCUMENT_OPS.has(op.type)) {
      return {
        ok: false,
        opId: op.opId,
        rejection: { code: 'unsupported_operation', message: `Operation "${op.type}" is not supported on document streams` },
      };
    }

    const payloadHash = hashOperationPayload(op);

    const txOutcome = await this.runTransaction(async (trx) => {
      const seqByStream = await lockStreams(trx, [op.streamId]);

      const existing = await trx
        .selectFrom('op_results')
        .select(['payload_hash', 'actor_id', 'result_json'])
        .where('op_id', '=', op.opId)
        .executeTakeFirst();

      if (existing) {
        // A stored result is only replayed to the actor who submitted it, for the same content.
        if (existing.payload_hash !== payloadHash || existing.actor_id !== actor.userId) {
          const conflictAck: OpAck = {
            ok: false,
            opId: op.opId,
            rejection: { code: 'op_id_conflict', message: OP_ID_CONFLICT_MESSAGE },
          };
          return { ack: conflictAck, events: [] as StreamEvent[] };
        }
        const stored = existing.result_json as OpAck;
        return { ack: { ...stored, replayed: true }, events: [] as StreamEvent[] };
      }

      const nowMs = this.now();
      const guard = await guardStream(trx, op.streamId, actor, options);
      if (!guard.ok) {
        // Not stored: the answer depends on who may write now, not on the operation.
        const refused: OpAck = { ok: false, opId: op.opId, rejection: guard.rejection };
        return { ack: refused, events: [] as StreamEvent[] };
      }
      const { write } = guard;

      const foreign = await findForeignCreate(trx, op.streamId, [op]);
      let applied: { ok: true; state: OpsState; changes: Change[] } | { ok: false; rejection: PipelineRejection };
      let version: ItemVersion | null = null;
      if (foreign) {
        applied = { ok: false, rejection: { code: 'exists', kind: foreign.kind, id: foreign.id } };
      } else {
        const state = await loadStateForOps(trx, op.streamId, [op]);
        const ctx: ApplyContext = { actor, laneId: write?.access.laneId ?? this.defaultLaneId, now: nowMs };
        let refused: PipelineRejection | null = null;
        if (write) {
          write.rows = await loadItemRows(trx, op.streamId, Object.keys(state.markups));
          const evaluation = await evaluateDocumentWrite(trx, write, state, [op], ctx);
          if (evaluation.ok) version = evaluation.versions[0] ?? null;
          else refused = evaluation.rejection;
        }
        applied = refused ? { ok: false, rejection: refused } : applyOp(state, op, ctx);
      }

      if (!applied.ok) {
        const rejectionAck: OpAck = { ok: false, opId: op.opId, rejection: applied.rejection };
        await trx
          .insertInto('op_results')
          .values({
            op_id: op.opId,
            stream_id: op.streamId,
            actor_id: actor.userId,
            payload_hash: payloadHash,
            accepted: false,
            result_json: sql`${JSON.stringify(rejectionAck)}::jsonb`,
          })
          .execute();
        if (this.hooks.onBeforeCommit) {
          await this.hooks.onBeforeCommit({ opIds: [op.opId], streamId: op.streamId });
        }
        return { ack: rejectionAck, events: [] as StreamEvent[] };
      }

      const nextSeq = (seqByStream.get(op.streamId) ?? 0) + 1;
      const receivedAtDate = new Date(nowMs);
      const receivedAt = receivedAtDate.toISOString();

      await trx
        .updateTable('streams')
        .set({
          seq: String(nextSeq),
          updated_at: receivedAtDate,
          ...(write ? { project_id: write.access.projectId } : {}),
        })
        .where('id', '=', op.streamId)
        .execute();

      await persistChanges(trx, op.streamId, applied.state, applied.changes, write);
      if (write && version) await writeItemVersion(trx, write.access, op, version, receivedAtDate);

      await trx
        .insertInto('events')
        .values({
          stream_id: op.streamId,
          seq: String(nextSeq),
          op_id: op.opId,
          actor_id: actor.userId,
          op_type: op.type,
          entity_id: op.entityId,
          payload_json: sql`${JSON.stringify(op)}::jsonb`,
          received_at: receivedAtDate,
          client_time: op.clientTime === undefined ? null : new Date(op.clientTime),
          ...eventAudience(version),
        })
        .execute();

      const acceptedAck: Extract<OpAck, { ok: true }> = {
        ok: true,
        opId: op.opId,
        streamId: op.streamId,
        seq: nextSeq,
        receivedAt,
      };

      await trx
        .insertInto('op_results')
        .values({
          op_id: op.opId,
          stream_id: op.streamId,
          actor_id: actor.userId,
          payload_hash: payloadHash,
          accepted: true,
          result_json: sql`${JSON.stringify(acceptedAck)}::jsonb`,
        })
        .execute();

      if (this.hooks.onBeforeCommit) {
        await this.hooks.onBeforeCommit({ opIds: [op.opId], streamId: op.streamId });
      }

      const event: StreamEvent = {
        streamId: op.streamId,
        seq: nextSeq,
        opId: op.opId,
        actorId: actor.userId,
        opType: op.type,
        entityId: op.entityId,
        op,
        receivedAt,
      };
      return { ack: acceptedAck, events: [event] };
    });

    if (txOutcome.events.length > 0) {
      if (this.hooks.onAfterCommitBeforeAck) {
        await this.hooks.onAfterCommitBeforeAck({
          opIds: [op.opId],
          streamId: op.streamId,
          events: txOutcome.events,
        });
      }
      for (const event of txOutcome.events) {
        this.broadcaster.publish(event);
      }
    }

    return txOutcome.ack;
  }

  async submitBatch(
    rawInputs: unknown[],
    actor: Actor,
    rawByteLength?: number,
    options: SubmitOptions = {},
  ): Promise<BatchAck> {
    if (!Array.isArray(rawInputs) || rawInputs.length === 0) {
      return { ok: false, index: 0, opId: null, rejection: { code: 'invalid', message: 'The batch is empty' } };
    }
    const bytes = measureBytes(rawInputs, rawByteLength);
    if (bytes > this.maxOpBytes) {
      return {
        ok: false,
        index: 0,
        opId: extractRawOpId(rawInputs[0]),
        rejection: { code: 'payload_too_large', message: `Batch exceeds maximum size of ${this.maxOpBytes} bytes` },
      };
    }

    const ops: Operation[] = [];
    const hashes: string[] = [];
    const seenOpIds = new Set<string>();
    for (let i = 0; i < rawInputs.length; i++) {
      const parsed = parseOperation(rawInputs[i]);
      if (!parsed.ok) {
        return { ok: false, index: i, opId: extractRawOpId(rawInputs[i]), rejection: parsed.rejection };
      }
      if (!SUPPORTED_DOCUMENT_OPS.has(parsed.op.type)) {
        return {
          ok: false,
          index: i,
          opId: parsed.op.opId,
          rejection: { code: 'unsupported_operation', message: `Operation "${parsed.op.type}" is not supported on document streams` },
        };
      }
      if (seenOpIds.has(parsed.op.opId)) {
        return {
          ok: false,
          index: i,
          opId: parsed.op.opId,
          rejection: { code: 'invalid', message: 'Duplicate opId within batch' },
        };
      }
      seenOpIds.add(parsed.op.opId);
      ops.push(parsed.op);
      hashes.push(hashOperationPayload(parsed.op));
    }

    const streamId = ops[0]!.streamId;
    for (let i = 1; i < ops.length; i++) {
      if (ops[i]!.streamId !== streamId) {
        return {
          ok: false,
          index: i,
          opId: ops[i]!.opId,
          rejection: { code: 'invalid', message: 'A batch must target a single stream' },
        };
      }
    }

    const txOutcome = await this.runTransaction(async (trx) => {
      const seqByStream = await lockStreams(trx, [streamId]);

      const existingRows = await trx
        .selectFrom('op_results')
        .select(['op_id', 'payload_hash', 'actor_id', 'result_json'])
        .where('op_id', 'in', ops.map((o) => o.opId))
        .execute();

      const existingById = new Map(existingRows.map((r) => [r.op_id, r]));
      if (existingById.size > 0) {
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]!;
          const existing = existingById.get(op.opId);
          if (existing && (existing.payload_hash !== hashes[i] || existing.actor_id !== actor.userId)) {
            const ack: BatchAck = {
              ok: false,
              index: i,
              opId: op.opId,
              rejection: { code: 'op_id_conflict', message: OP_ID_CONFLICT_MESSAGE },
            };
            return { ack, events: [] as StreamEvent[] };
          }
        }
        if (existingById.size === ops.length) {
          const replayedResults: Extract<OpAck, { ok: true }>[] = [];
          for (let i = 0; i < ops.length; i++) {
            const stored = existingById.get(ops[i]!.opId)!.result_json as OpAck;
            if (!stored.ok) {
              const ack: BatchAck = { ok: false, index: i, opId: ops[i]!.opId, rejection: stored.rejection };
              return { ack, events: [] as StreamEvent[] };
            }
            replayedResults.push({ ...stored, replayed: true });
          }
          const ack: BatchAck = { ok: true, streamId, results: replayedResults };
          return { ack, events: [] as StreamEvent[] };
        }
        const conflictIndex = ops.findIndex((o) => existingById.has(o.opId));
        const ack: BatchAck = {
          ok: false,
          index: conflictIndex,
          opId: ops[conflictIndex]!.opId,
          rejection: { code: 'op_id_conflict', message: 'Batch partially overlaps already processed operation ids' },
        };
        return { ack, events: [] as StreamEvent[] };
      }

      const guard = await guardStream(trx, streamId, actor, options);
      if (!guard.ok) {
        const ack: BatchAck = { ok: false, index: 0, opId: ops[0]!.opId, rejection: guard.rejection };
        return { ack, events: [] as StreamEvent[] };
      }
      const { write } = guard;

      const foreign = await findForeignCreate(trx, streamId, ops);
      if (foreign) {
        const ack: BatchAck = {
          ok: false,
          index: foreign.index,
          opId: ops[foreign.index]!.opId,
          rejection: { code: 'exists', kind: foreign.kind, id: foreign.id },
        };
        return { ack, events: [] as StreamEvent[] };
      }

      const state = await loadStateForOps(trx, streamId, ops);
      const nowMs = this.now();
      const ctx: ApplyContext = { actor, laneId: write?.access.laneId ?? this.defaultLaneId, now: nowMs };
      let versions: (ItemVersion | null)[] = [];
      if (write) {
        write.rows = await loadItemRows(trx, streamId, Object.keys(state.markups));
        const evaluation = await evaluateDocumentWrite(trx, write, state, ops, ctx);
        if (!evaluation.ok) {
          const ack: BatchAck = {
            ok: false,
            index: evaluation.index,
            opId: ops[evaluation.index]!.opId,
            rejection: evaluation.rejection,
          };
          return { ack, events: [] as StreamEvent[] };
        }
        versions = evaluation.versions;
      }
      const applied = applyBatch(state, ops, ctx);

      if (!applied.ok) {
        const failedOp = ops[applied.index]!;
        const ack: BatchAck = {
          ok: false,
          index: applied.index,
          opId: failedOp.opId,
          rejection: applied.rejection,
        };
        return { ack, events: [] as StreamEvent[] };
      }

      let seq = seqByStream.get(streamId) ?? 0;
      const receivedAtDate = new Date(nowMs);
      const receivedAt = receivedAtDate.toISOString();
      const results: Extract<OpAck, { ok: true }>[] = [];
      const events: StreamEvent[] = [];

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        seq += 1;
        await trx
          .insertInto('events')
          .values({
            stream_id: streamId,
            seq: String(seq),
            op_id: op.opId,
            actor_id: actor.userId,
            op_type: op.type,
            entity_id: op.entityId,
            payload_json: sql`${JSON.stringify(op)}::jsonb`,
            received_at: receivedAtDate,
            client_time: op.clientTime === undefined ? null : new Date(op.clientTime),
            ...eventAudience(versions[i]),
          })
          .execute();

        const opAck: Extract<OpAck, { ok: true }> = {
          ok: true,
          opId: op.opId,
          streamId,
          seq,
          receivedAt,
        };
        results.push(opAck);

        await trx
          .insertInto('op_results')
          .values({
            op_id: op.opId,
            stream_id: streamId,
            actor_id: actor.userId,
            payload_hash: hashes[i]!,
            accepted: true,
            result_json: sql`${JSON.stringify(opAck)}::jsonb`,
          })
          .execute();

        events.push({
          streamId,
          seq,
          opId: op.opId,
          actorId: actor.userId,
          opType: op.type,
          entityId: op.entityId,
          op,
          receivedAt,
        });
      }

      await trx
        .updateTable('streams')
        .set({
          seq: String(seq),
          updated_at: receivedAtDate,
          ...(write ? { project_id: write.access.projectId } : {}),
        })
        .where('id', '=', streamId)
        .execute();

      await persistChanges(trx, streamId, applied.state, applied.changes, write);
      if (write) {
        for (const [i, op] of ops.entries()) {
          const version = versions[i];
          if (version) await writeItemVersion(trx, write.access, op, version, receivedAtDate);
        }
      }

      if (this.hooks.onBeforeCommit) {
        await this.hooks.onBeforeCommit({ opIds: ops.map((o) => o.opId), streamId });
      }

      const ack: BatchAck = { ok: true, streamId, results };
      return { ack, events };
    });

    if (txOutcome.events.length > 0) {
      if (this.hooks.onAfterCommitBeforeAck) {
        await this.hooks.onAfterCommitBeforeAck({
          opIds: ops.map((o) => o.opId),
          streamId,
          events: txOutcome.events,
        });
      }
      for (const event of txOutcome.events) {
        this.broadcaster.publish(event);
      }
    }

    return txOutcome.ack;
  }
}
