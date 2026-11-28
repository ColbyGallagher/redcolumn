import type { Transaction } from 'kysely';
import type { Database } from './db.ts';

/**
 * Serializes every change to one project's membership and invites: role changes, removal, and
 * creating, revoking and accepting invites. Take it first in the transaction, before locking any
 * invite row, so these transactions cannot deadlock. Statements that follow it see everything the
 * previous holder committed, including newly inserted members, which locking the existing member
 * rows alone would miss.
 *
 * `FOR NO KEY UPDATE` does not block inserts of rows that only reference the project.
 */
export async function lockProject(
  trx: Transaction<Database>,
  projectId: string,
): Promise<{ id: string; archived_at: Date | null } | undefined> {
  return trx
    .selectFrom('projects')
    .select(['id', 'archived_at'])
    .where('id', '=', projectId)
    .forNoKeyUpdate()
    .executeTakeFirst();
}
