/** How long the render worker may stay silent while a draw or lookup waits on it. */
export const RENDER_STALL_MS = 90_000;
/** The same for opening, editing, redacting and other whole-file work, which can take much longer on big files. */
export const LONG_STALL_MS = 300_000;
/** How often a waiting engine checks whether its worker has gone quiet. */
export const STALL_CHECK_MS = 5_000;

/** Whole-file requests get the long limit; everything else (tiles, text, geometry) the short one. */
export function stallLimit(type: string): number {
  switch (type) {
    case 'open':
    case 'edit':
    case 'extract':
    case 'unlock':
    case 'create':
    case 'redact':
    case 'replaceText':
    case 'addText':
    case 'bytes':
    case 'setRenderCopy':
      return LONG_STALL_MS;
    default:
      return RENDER_STALL_MS;
  }
}

/**
 * Decides whether a worker has hung. The worker does one thing at a time, so while any call
 * waits, a worker that has said nothing at all (no answer, no progress) for longer than the
 * longest limit among the waiting calls is stuck or dead. Pure, so it can be tested with a clock.
 */
export class StallTracker {
  private limits = new Map<number, number>();
  private lastActivity = 0;

  get waiting(): boolean {
    return this.limits.size > 0;
  }

  begin(id: number, limitMs: number, now: number) {
    if (!this.limits.size) this.lastActivity = now;
    this.limits.set(id, limitMs);
  }

  /** The worker said something (an answer or progress). */
  activity(now: number) {
    this.lastActivity = now;
  }

  end(id: number) {
    this.limits.delete(id);
  }

  clear() {
    this.limits.clear();
  }

  /** Milliseconds of silence if the worker is overdue, else null. */
  stalledFor(now: number): number | null {
    if (!this.limits.size) return null;
    const silent = now - this.lastActivity;
    return silent > Math.max(...this.limits.values()) ? silent : null;
  }
}
