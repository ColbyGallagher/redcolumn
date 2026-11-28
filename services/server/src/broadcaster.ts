import type { AnyOperation } from '@nb/ops';

export interface StreamEvent {
  streamId: string;
  seq: number;
  opId: string;
  actorId: string;
  opType: AnyOperation['type'];
  entityId: string;
  op: AnyOperation;
  receivedAt: string;
}

export type StreamListener = (event: StreamEvent) => void;

export interface Broadcaster {
  subscribe(streamId: string, listener: StreamListener): () => void;
  publish(event: StreamEvent): void;
}

export class InProcessBroadcaster implements Broadcaster {
  private readonly channels = new Map<string, Set<StreamListener>>();
  private readonly onError?: (err: unknown, event: StreamEvent) => void;

  constructor(options?: { onError?: (err: unknown, event: StreamEvent) => void }) {
    this.onError = options?.onError;
  }

  subscribe(streamId: string, listener: StreamListener): () => void {
    let listeners = this.channels.get(streamId);
    if (!listeners) {
      listeners = new Set();
      this.channels.set(streamId, listeners);
    }
    listeners.add(listener);

    return () => {
      const current = this.channels.get(streamId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.channels.delete(streamId);
      }
    };
  }

  publish(event: StreamEvent): void {
    const listeners = this.channels.get(event.streamId);
    if (!listeners || listeners.size === 0) return;
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (err) {
        this.onError?.(err, event);
      }
    }
  }

  subscriberCount(streamId: string): number {
    return this.channels.get(streamId)?.size ?? 0;
  }
}
