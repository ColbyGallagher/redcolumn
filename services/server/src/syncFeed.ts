import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  emptyState,
  type AnyOperation,
  type Issue,
  type LaneStatus,
  type MarkupRecord,
  type OpsState,
  type Placement,
  type StatusEvent,
} from '@nb/ops';
import { sql, type Kysely, type Transaction } from 'kysely';
import type pg from 'pg';
import { resolveDocumentAccess, type DocumentAccess } from './documentAccess.ts';
import type { Database } from './db.ts';
import { statusEventFromRow } from './issueRows.ts';

/*
 * What a client may read of a document stream. Content is read as a database role that row-level
 * security applies to, with the user set for the transaction, so a row without an access row for
 * this user is not returned whatever the query asks for. Stream positions never leave the server
 * as such: a client holds a sealed cursor.
 */

/** The role content is read as. It can only SELECT the row-level security tables. */
export const READER_ROLE = 'redcolumn_reader';

/** More missed events than this and a reconnecting client gets a new snapshot. */
export const MAX_CATCH_UP_EVENTS = 2000;

const ROLE_LOCK_KEY = '724918302411892';

/**
 * Creates the reader role if the cluster lacks it, lets the server's role switch to it, and resets
 * its privileges to what the current schema lists. Safe to run at every start; it must run again
 * after any migration (a restore also drops grants).
 */
export async function ensureReaderRole(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [ROLE_LOCK_KEY]);
    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [READER_ROLE]);
    if (!existing.rowCount) await client.query(`CREATE ROLE ${READER_ROLE} NOLOGIN`);
    const canSet = await client.query<{ ok: boolean }>(`SELECT pg_has_role(current_user, $1, 'SET') AS ok`, [READER_ROLE]);
    if (!canSet.rows[0]?.ok) await client.query(`GRANT ${READER_ROLE} TO CURRENT_USER`);
    await client.query('SELECT app_grant_reader($1)', [READER_ROLE]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Everything after this in `trx` is read as `userId`, under row-level security. */
async function readAs(trx: Transaction<Database>, userId: string): Promise<void> {
  await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx);
  await sql`SET LOCAL ROLE ${sql.raw(READER_ROLE)}`.execute(trx);
}

async function headOf(trx: Transaction<Database>, streamId: string): Promise<number> {
  const row = await trx.selectFrom('streams').select('seq').where('id', '=', streamId).executeTakeFirst();
  return row ? Number(row.seq) : 0;
}

/** Events accepted together: one operation, or one batch. */
export interface FeedUnit {
  /** The stream position of the unit's last event. Server use only. */
  seq: number;
  actorId: string;
  serverTime: number;
  ops: AnyOperation[];
}

export type FeedRead =
  | { kind: 'denied' }
  | { kind: 'events'; access: DocumentAccess; head: number; units: FeedUnit[] }
  | { kind: 'snapshot'; access: DocumentAccess; head: number; state: OpsState; appliedOpIds: string[] };

async function visibleUnits(trx: Transaction<Database>, streamId: string, after: number, head: number): Promise<FeedUnit[]> {
  const rows = await trx
    .selectFrom('events')
    .select(['seq', 'actor_id', 'payload_json', 'received_at'])
    .where('stream_id', '=', streamId)
    .where('seq', '>', String(after))
    .where('seq', '<=', String(head))
    .orderBy('seq', 'asc')
    .execute();
  const units: FeedUnit[] = [];
  for (const row of rows) {
    const op = row.payload_json as AnyOperation;
    const previous = units.at(-1);
    if (previous && op.batchId !== undefined && previous.ops[0]!.batchId === op.batchId && previous.actorId === row.actor_id) {
      previous.ops.push(op);
      previous.seq = Number(row.seq);
    } else {
      units.push({ seq: Number(row.seq), actorId: row.actor_id, serverTime: row.received_at.getTime(), ops: [op] });
    }
  }
  return units;
}

async function visibleState(trx: Transaction<Database>, streamId: string): Promise<OpsState> {
  const markupRows = await trx.selectFrom('markups').select(['id', 'record_json']).where('stream_id', '=', streamId).execute();
  const placementRows = await trx
    .selectFrom('placements')
    .select(['id', 'record_json'])
    .where('stream_id', '=', streamId)
    .execute();
  const markups: Record<string, MarkupRecord> = {};
  for (const row of markupRows) markups[row.id] = row.record_json as MarkupRecord;
  const placements: Record<string, Placement> = {};
  for (const row of placementRows) placements[row.id] = row.record_json as Placement;
  return { ...emptyState(), markups, placements, ...(await visibleIssues(trx, streamId)) };
}

/**
 * The issues raised for the stream's markups, with their status changes and the status the reader's
 * lane sees. Everything is read under row-level security, and an issue names only the markups
 * whose link the reader may see.
 */
async function visibleIssues(
  trx: Transaction<Database>,
  streamId: string,
): Promise<Pick<OpsState, 'issues' | 'statusEvents' | 'laneStatus'>> {
  const links = await trx
    .selectFrom('issue_links')
    .innerJoin('markups', 'markups.id', 'issue_links.markup_id')
    .select(['issue_links.issue_id', 'issue_links.markup_id'])
    .where('markups.stream_id', '=', streamId)
    .execute();
  const linked = new Map<string, Set<string>>();
  for (const link of links) {
    const markupIds = linked.get(link.issue_id) ?? new Set<string>();
    markupIds.add(link.markup_id);
    linked.set(link.issue_id, markupIds);
  }
  const issues: Record<string, Issue> = {};
  const statusEvents: Record<string, StatusEvent> = {};
  const laneStatus: Record<string, Record<string, LaneStatus>> = {};
  const ids = [...linked.keys()];
  if (!ids.length) return { issues, statusEvents, laneStatus };

  const issueRows = await trx.selectFrom('issues').select(['id', 'record_json']).where('id', 'in', ids).execute();
  for (const row of issueRows) {
    const record = row.record_json as Issue;
    issues[row.id] = { ...record, markupIds: record.markupIds.filter((id) => linked.get(row.id)!.has(id)) };
  }
  const eventRows = await trx.selectFrom('status_events').selectAll().where('issue_id', 'in', ids).execute();
  for (const row of eventRows) statusEvents[row.id] = statusEventFromRow(row);
  const laneRows = await trx
    .selectFrom('issue_lane_state')
    .select(['issue_id', 'lane_id', 'status', 'status_event_id'])
    .where('issue_id', 'in', ids)
    .execute();
  for (const row of laneRows) {
    (laneStatus[row.issue_id] ??= {})[row.lane_id] = { status: row.status, eventId: row.status_event_id };
  }
  return { issues, statusEvents, laneStatus };
}

/**
 * What `userId` gets from a document stream: the events after `after`, or a snapshot when `after`
 * is null or too far behind. One consistent view; nothing when they have no access.
 * `pendingOpIds` are operations the client still holds: a snapshot says which were already applied.
 */
export async function readFeed(
  db: Kysely<Database>,
  userId: string,
  streamId: string,
  after: number | null,
  pendingOpIds: readonly string[] = [],
): Promise<FeedRead> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx): Promise<FeedRead> => {
      const access = await resolveDocumentAccess(trx, userId, streamId);
      if (!access) return { kind: 'denied' };
      const head = await headOf(trx, streamId);
      await readAs(trx, userId);
      if (after !== null && after <= head && head - after <= MAX_CATCH_UP_EVENTS) {
        const units = after === head ? [] : await visibleUnits(trx, streamId, after, head);
        return { kind: 'events', access, head, units };
      }
      const state = await visibleState(trx, streamId);
      const applied = pendingOpIds.length
        ? await trx
            .selectFrom('op_results')
            .select('op_id')
            .where('stream_id', '=', streamId)
            .where('accepted', '=', true)
            .where('op_id', 'in', [...pendingOpIds])
            .execute()
        : [];
      return { kind: 'snapshot', access, head, state, appliedOpIds: applied.map((r) => r.op_id) };
    });
}

/**
 * Seals a stream position for one user and stream, so a client can hand it back but cannot read or
 * make one. The key lives as long as the process: after a restart an old cursor does not open and
 * the client gets a snapshot.
 */
export class CursorSealer {
  private readonly key: Buffer;

  constructor(key: Buffer = randomBytes(32)) {
    this.key = key;
  }

  seal(streamId: string, userId: string, seq: number): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([streamId, userId]), 'utf8'));
    const body = Buffer.concat([cipher.update(String(seq).padStart(16, '0'), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  /** The position a cursor holds, or null when it is not one this process sealed for this user and stream. */
  open(cursor: string, streamId: string, userId: string): number | null {
    try {
      const raw = Buffer.from(cursor, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(JSON.stringify([streamId, userId]), 'utf8'));
      decipher.setAuthTag(raw.subarray(12, 28));
      const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
      const seq = Number(text);
      return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
    } catch {
      return null;
    }
  }
}
