import type { StatusEvent } from '@nb/ops';
import type { Selectable } from 'kysely';
import type { StatusEventsTable } from './db.ts';

/** A stored status change as the record the operation made. */
export function statusEventFromRow(row: Selectable<StatusEventsTable>): StatusEvent {
  return {
    id: row.id,
    rev: 1,
    issueId: row.issue_id,
    laneId: row.origin_lane_id,
    from: row.from_status,
    to: row.to_status,
    note: row.note,
    revisionSeenId: row.revision_seen_id,
    actor: { userId: row.actor_user_id, partyId: row.actor_party_id, groupId: null },
    at: row.received_at.getTime(),
    clientTime: row.client_time === null ? null : row.client_time.getTime(),
  };
}
