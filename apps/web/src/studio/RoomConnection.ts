import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { CLOSE_DENIED, CLOSE_REMOVED, CLOSE_SIGN_IN, MSG_AWARENESS, MSG_META, MSG_SYNC } from './protocol';
import type { ConnectionStatus } from './types';


interface Handlers {
  onStatus?: (status: ConnectionStatus) => void;
  onMeta?: (json: string) => void;
  /** The server closed the room for good (e.g. the document was removed). */
  onRemoved?: () => void;
  /** The server refused this attendee (no access to the session). */
  onDenied?: () => void;
  /** The server wants a (fresh) Google sign-in; reconnect with `retry` once signed in. */
  onSignIn?: () => void;
  /** WebSocket subprotocols for each connection attempt (they carry the sign-in token). */
  protocols?: () => string[] | undefined;
}

/**
 * Keeps one Yjs document in sync with one Studio room over a WebSocket, reconnecting with backoff.
 * Edits made while offline stay in the document (and its IndexedDB copy) and merge on reconnect.
 */
export class RoomConnection {
  status: ConnectionStatus = 'connecting';
  readonly whenSynced: Promise<void>;
  private resolveSynced!: () => void;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private url: string;
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness | null;
  private handlers: Handlers;

  constructor(url: string, doc: Y.Doc, awareness: awarenessProtocol.Awareness | null, handlers: Handlers = {}) {
    this.url = url;
    this.doc = doc;
    this.awareness = awareness;
    this.handlers = handlers;
    this.whenSynced = new Promise((resolve) => (this.resolveSynced = resolve));
    doc.on('update', this.onDocUpdate);
    awareness?.on('update', this.onAwarenessUpdate);
    // A destroyed store takes its connection with it.
    doc.on('destroy', this.destroy);
    this.connect();
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  private connect() {
    if (this.destroyed) return;
    this.setStatus('connecting');
    const ws = new WebSocket(this.url, this.handlers.protocols?.());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('online');
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      ws.send(encoding.toUint8Array(encoder));
      if (this.awareness?.getLocalState()) this.sendAwareness([this.doc.clientID]);
    };
    ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const decoder = decoding.createDecoder(new Uint8Array(e.data));
      const type = decoding.readVarUint(decoder);
      if (type === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const step = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
        if (step === syncProtocol.messageYjsSyncStep2) this.resolveSynced();
      } else if (type === MSG_AWARENESS && this.awareness) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
      } else if (type === MSG_META) {
        this.handlers.onMeta?.(decoding.readVarString(decoder));
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('offline');
      if (this.awareness) {
        const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
        awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
      }
      if (e.code === CLOSE_REMOVED) {
        this.handlers.onRemoved?.();
        return;
      }
      if (e.code === CLOSE_DENIED) {
        this.handlers.onDenied?.();
        return;
      }
      if (e.code === CLOSE_SIGN_IN) {
        this.handlers.onSignIn?.();
        return;
      }
      if (this.destroyed) return;
      const delay = Math.min(30_000, 500 * 2 ** this.attempts++) * (0.75 + Math.random() * 0.5);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Reconnects now instead of waiting out the backoff (e.g. when the browser comes back online). */
  retry() {
    if (this.destroyed || this.ws) return;
    clearTimeout(this.retryTimer);
    this.attempts = 0;
    this.connect();
  }

  private send(message: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(message);
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };

  private sendAwareness(clients: number[]) {
    if (!this.awareness) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    this.send(encoding.toUint8Array(encoder));
  }

  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    if (this.awareness) {
      // Tell the others we have gone before closing.
      this.awareness.setLocalState(null);
      this.awareness.off('update', this.onAwarenessUpdate);
    }
    this.doc.off('update', this.onDocUpdate);
    this.doc.off('destroy', this.destroy);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus('offline');
  };
}
