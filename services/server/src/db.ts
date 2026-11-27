import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

export interface SchemaMigrationsTable {
  version: string;
  name: string;
  checksum: string;
  applied_at: Generated<Date>;
}

export interface UsersTable {
  id: string;
  email: string;
  email_lower: string;
  name: string;
  password_hash: string;
  role: 'user' | 'admin';
  is_admin: boolean;
  disabled_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Generated<Date>;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Generated<Date>;
}

export interface StreamsTable {
  id: string;
  kind: string;
  seq: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OpResultsTable {
  op_id: string;
  stream_id: string;
  actor_id: string;
  payload_hash: string;
  accepted: boolean;
  result_json: unknown;
  created_at: Generated<Date>;
}

export interface MarkupsTable {
  id: string;
  stream_id: string;
  scope_id: string;
  type: string;
  rev: number;
  deleted: boolean;
  owner_user_id: string;
  owner_party_id: string | null;
  owner_group_id: string | null;
  record_json: unknown;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlacementsTable {
  id: string;
  stream_id: string;
  markup_id: string;
  revision_id: string;
  page_id: string;
  rev: number;
  deleted: boolean;
  record_json: unknown;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EventsTable {
  stream_id: string;
  seq: string;
  op_id: string;
  actor_id: string;
  op_type: string;
  entity_id: string;
  payload_json: unknown;
  received_at: Generated<Date>;
}

export interface Database {
  schema_migrations: SchemaMigrationsTable;
  users: UsersTable;
  sessions: SessionsTable;
  streams: StreamsTable;
  op_results: OpResultsTable;
  markups: MarkupsTable;
  placements: PlacementsTable;
  events: EventsTable;
}

export interface DbHandle {
  db: Kysely<Database>;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
  return {
    db,
    pool,
    close: async () => {
      await db.destroy();
    },
  };
}

export async function checkDbConnection(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
