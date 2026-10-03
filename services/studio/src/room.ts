import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { WebSocket } from 'ws';
import { MSG_AWARENESS, MSG_META, MSG_SYNC } from './protocol.ts';

/** One attendee's socket in a room. */
export interface Conn {
  ws: WebSocket;
  name: string;
  isHost: boolean;
  /** Google email verified by the server, when the attendee is signed in. */
  email: string | null;
  /** Awareness client ids this socket has announced, removed when it closes. */
  clients: Set<number>;
}

/**
 * A shared Yjs document and the sockets editing it. Speaks the y-websocket message format, so any
 * y-protocols client can join. Writes from a socket are dropped unless `canWrite` allows them.
 */
export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Set<Conn>();
  readonly name: string;
  private canWrite: (conn: Conn) => boolean;

  constructor(name: string, initial: Uint8Array | null, canWrite: (conn: Conn) => boolean, onUpdate: () => void) {
    this.name = name;
    this.canWrite = canWrite;
    if (initial) Y.applyUpdate(this.doc, initial);
    // The server takes part in the document but has no presence of its own.
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
      onUpdate();
    });
    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (origin && typeof origin === 'object' && 'clients' in origin) {
        const conn = origin as Conn;
        for (const id of added) conn.clients.add(id);
        for (const id of removed) conn.clients.delete(id);
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(encoder));
    });
  }

  join(conn: Conn, meta: string | null) {
    this.conns.add(conn);
    if (meta) this.send(conn, encodeMeta(meta));
    // Start the sync handshake and share who is here.
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, MSG_SYNC);
    syncProtocol.writeSyncStep1(sync, this.doc);
    this.send(conn, encoding.toUint8Array(sync));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MSG_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states));
      this.send(conn, encoding.toUint8Array(aw));
    }
  }

  leave(conn: Conn) {
    if (!this.conns.delete(conn)) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.clients], null);
  }

  receive(conn: Conn, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      // Peek at the sync step: step 2 and updates carry edits.
      const step = decoding.peekVarUint(decoder);
      if (step !== syncProtocol.messageYjsSyncStep1 && !this.canWrite(conn)) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);
      if (encoding.length(encoder) > 1) this.send(conn, encoding.toUint8Array(encoder));
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn);
    }
  }

  broadcastMeta(meta: string) {
    this.broadcast(encodeMeta(meta));
  }

  close(code: number, reason: string) {
    for (const conn of this.conns) conn.ws.close(code, reason);
  }

  destroy() {
    this.awareness.destroy();
    this.doc.destroy();
  }

  private broadcast(message: Uint8Array) {
    for (const conn of this.conns) this.send(conn, message);
  }

  private send(conn: Conn, message: Uint8Array) {
    if (conn.ws.readyState !== conn.ws.OPEN) return;
    conn.ws.send(message, (err) => {
      if (err) conn.ws.terminate();
    });
  }
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

function encodeMeta(meta: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_META);
  encoding.writeVarString(encoder, meta);
  return encoding.toUint8Array(encoder);
}
