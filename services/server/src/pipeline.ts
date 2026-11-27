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

export type PipelineRejection =
  | Rejection
  | { code: 'op_id_conflict'; message: string }
  | { code: 'payload_too_large'; message: string }
  | { code: 'unsupported_operation'; message: string };

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

function measureBytes(raw: unknown, provided?: number): number {
  if (provided !== undefined) return provided;
  try {
    return Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  } catch {
    return Infinity;
  }
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
): Promise<void> {
  const nowDate = new Date();
  for (const change of changes) {
    if (change.kind === 'markup') {
      const record = state.markups[change.id];
      if (!record) continue;
      await trx
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
          updated_at: nowDate,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            rev: record.rev,
            deleted: record.deleted,
            record_json: sql`${JSON.stringify(record)}::jsonb`,
            updated_at: nowDate,
          }),
        )
        .execute();
    } else if (change.kind === 'placement') {
      const record = state.placements[change.id];
      if (!record) continue;
      await trx
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
          updated_at: nowDate,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            rev: record.rev,
            deleted: record.deleted,
            record_json: sql`${JSON.stringify(record)}::jsonb`,
            updated_at: nowDate,
          }),
        )
        .execute();
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

  async submitOperation(rawInput: unknown, actor: Actor, rawByteLength?: number): Promise<OpAck> {
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

    const txOutcome = await this.db.transaction().execute(async (trx) => {
      const seqByStream = await lockStreams(trx, [op.streamId]);

      const existing = await trx
        .selectFrom('op_results')
        .select(['payload_hash', 'result_json'])
        .where('op_id', '=', op.opId)
        .executeTakeFirst();

      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          const conflictAck: OpAck = {
            ok: false,
            opId: op.opId,
            rejection: { code: 'op_id_conflict', message: 'Operation id was already used with different content' },
          };
          return { ack: conflictAck, events: [] as StreamEvent[] };
        }
        const stored = existing.result_json as OpAck;
        return { ack: { ...stored, replayed: true }, events: [] as StreamEvent[] };
      }

      const state = await loadStateForOps(trx, op.streamId, [op]);
      const nowMs = this.now();
      const ctx: ApplyContext = { actor, laneId: this.defaultLaneId, now: nowMs };
      const applied = applyOp(state, op, ctx);

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
        .set({ seq: String(nextSeq), updated_at: receivedAtDate })
        .where('id', '=', op.streamId)
        .execute();

      await persistChanges(trx, op.streamId, applied.state, applied.changes);

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

  async submitBatch(rawInputs: unknown[], actor: Actor, rawByteLength?: number): Promise<BatchAck> {
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

    const txOutcome = await this.db.transaction().execute(async (trx) => {
      const seqByStream = await lockStreams(trx, [streamId]);

      const existingRows = await trx
        .selectFrom('op_results')
        .select(['op_id', 'payload_hash', 'result_json'])
        .where('op_id', 'in', ops.map((o) => o.opId))
        .execute();

      const existingById = new Map(existingRows.map((r) => [r.op_id, r]));
      if (existingById.size > 0) {
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]!;
          const existing = existingById.get(op.opId);
          if (existing && existing.payload_hash !== hashes[i]) {
            const ack: BatchAck = {
              ok: false,
              index: i,
              opId: op.opId,
              rejection: { code: 'op_id_conflict', message: 'Operation id was already used with different content' },
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

      const state = await loadStateForOps(trx, streamId, ops);
      const nowMs = this.now();
      const ctx: ApplyContext = { actor, laneId: this.defaultLaneId, now: nowMs };
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
        .set({ seq: String(seq), updated_at: receivedAtDate })
        .where('id', '=', streamId)
        .execute();

      await persistChanges(trx, streamId, applied.state, applied.changes);

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
