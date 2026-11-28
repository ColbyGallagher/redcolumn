import { msg } from '@nb/i18n';
import type { ConnectionState, InboxEntry, ServerRejection } from '@nb/sync';

/** The words the sync status bar uses. */

export type SyncState = 'synced' | 'pending' | 'offline' | 'connecting' | 'revoked' | 'update' | 'signed-out';

export function syncSummary(connection: ConnectionState, pending: number, sessionEnded: boolean): { state: SyncState; text: string } {
  if (sessionEnded) return { state: 'signed-out', text: msg('Signed out. Reload to sign in again.') };
  if (connection === 'revoked') return { state: 'revoked', text: msg('Your access to this document was removed.') };
  if (connection === 'update_required') return { state: 'update', text: msg('The server was updated. Reload to carry on.') };
  if (connection === 'connected') {
    return pending
      ? { state: 'pending', text: msg('{count} pending', { count: pending }) }
      : { state: 'synced', text: msg('Synced') };
  }
  if (connection === 'disconnected') {
    return {
      state: 'offline',
      text: pending ? msg('Offline · {count} pending', { count: pending }) : msg('Offline'),
    };
  }
  return { state: 'connecting', text: pending ? msg('Connecting… {count} pending', { count: pending }) : msg('Connecting…') };
}

export function describeChange(entry: Pick<InboxEntry, 'ops'>): string {
  const types = new Set(entry.ops.map((op) => op.type));
  if (types.has('markup.create')) return msg('New markup.');
  if (types.has('markup.delete') || types.has('placement.delete')) return msg('Delete.');
  if (types.has('markup.restore') || types.has('placement.restore')) return msg('Restore.');
  if (types.has('markup.patch')) return msg('Change to a markup.');
  if (types.has('placement.patch') || types.has('placement.create')) return msg('Move or reshape.');
  if (types.has('status.transition')) return msg('Status change.');
  if (types.has('issue.patch')) return msg('Checkmark.');
  if (types.has('issue.create') || types.has('issue.link')) return msg('Status change.');
  return msg('Change.');
}

/**
 * Whether a refused change can be sent again as it was. A status, or what raises an issue, is
 * decided again by the person who set it, looking at what is there now.
 */
export const canRetry = (entry: Pick<InboxEntry, 'ops'>): boolean =>
  !entry.ops.some((op) => op.type === 'status.transition' || op.type === 'issue.create' || op.type === 'issue.link');

export function describeRejection(reason: ServerRejection): string {
  switch (reason.code) {
    case 'conflict':
      return reason.conflicts.some((c) => c.kind === 'issue' && c.groups.includes('status'))
        ? msg('Someone else set the status first. Set it again if you still want to.')
        : msg('Someone else changed the same thing first.');
    case 'forbidden':
      return msg('You do not have permission to make this change.');
    case 'deleted':
    case 'not_found':
      return msg('The markup is no longer there.');
    case 'dependency_rejected':
    case 'batch_rejected':
      return msg('It depended on another change that was not saved.');
    case 'invalid':
      return reason.message === 'Too large to send' ? msg('It is too large to send.') : msg('The server could not accept it.');
    default:
      return msg('The server could not accept it.');
  }
}
