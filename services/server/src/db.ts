import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.ts';

export * from './schema.ts';

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
      // Kysely only ends the pool if it ever used it; callers that query the pool directly
      // (such as the migration CLI) would otherwise leave connections open.
      if (!pool.ending && !pool.ended) await pool.end();
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
