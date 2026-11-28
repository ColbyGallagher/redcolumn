import type { Operation, ProtocolRange } from '@nb/ops';
import type { ServerMessage } from './types.ts';

/*
 * The JSON frames a client and a server exchange over the WebSocket. A connection first agrees a
 * protocol version (`hello`, `welcome`), then opens document streams. Everything about a stream's
 * content arrives as a `sync` frame carrying the message `SyncDocument` reads.
 *
 * A message's `seq` counts the messages delivered on one open stream; it is not the stream's own
 * position, which a client only ever holds sealed inside `cursor`.
 */

/** The most pending operation ids an `open` frame lists. */
export const MAX_OPEN_PENDING_IDS = 4000;

/** WebSocket close code: the session ended (signed out, expired or the account disabled). */
export const WS_SESSION_ENDED = 4401;

/** Someone who has a document open. Never stored; gone when their connection is. */
export interface PresenceUser {
  connectionId: string;
  userId: string;
  name: string;
  /** The page they are looking at, from 0, once they have said. */
  pageIndex: number | null;
}

export type ClientFrame =
  | { type: 'hello'; protocol: ProtocolRange }
  | { type: 'ping' }
  | { type: 'open'; streamId: string; cursor: string | null; pendingOpIds: readonly string[] }
  | { type: 'send'; streamId: string; ops: readonly Operation[] }
  | { type: 'presence'; streamId: string; pageIndex: number }
  | { type: 'close'; streamId: string };

export type ServerFrame =
  | {
      type: 'welcome';
      protocolVersion: number;
      user: { id: string; name: string };
      connectionId: string;
      /** The largest operation, or batch of them, the server accepts, in bytes of JSON. */
      maxOpBytes: number;
    }
  | { type: 'pong' }
  | { type: 'error'; code: string; message?: string; streamId?: string; server?: ProtocolRange }
  | { type: 'sync'; streamId: string; message: ServerMessage }
  | { type: 'presence'; streamId: string; users: PresenceUser[] }
  | { type: 'access'; streamId: string; role: string };
