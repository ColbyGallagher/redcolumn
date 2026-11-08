/** If the engine dies again within this long of a restart, it is not restarted again (that would loop). */
export const RESTART_WINDOW_MS = 30_000;

/** What the supervisor needs of a render engine; `PdfEngine` provides it. */
export interface SupervisedEngine<D> {
  readonly openDocuments: D[];
  onFailure(listener: (err: Error) => void): () => void;
  /** Replaces a dead (or hung) worker; false if the engine was shut down. */
  restart(): boolean;
  reopen(doc: D, bytes: ArrayBuffer): Promise<void>;
  abandon(doc: D): void;
}

export interface RestartReport {
  reopened: number;
  /** Documents that could not be reopened and so cannot be drawn until their tab is reopened. */
  lost: number;
}

export interface SupervisorHooks<D> {
  /** The bytes a document was opened from (kept on this device), or null if unknown. */
  bytesFor(doc: D): Promise<ArrayBuffer | null>;
  /** Size in bytes of a document's file, for the log. */
  sizeOf?(doc: D): number | undefined;
  /** The engine restarted and the documents are open again: redraw. */
  onRestarted(report: RestartReport): void;
  /** The engine failed and will not be restarted automatically. */
  onGaveUp(err: Error): void;
  log?(message: string, detail: Record<string, unknown>): void;
  now?(): number;
}

/** Memory use as the browser reports it (Chromium only). */
export function memoryDetail(): Record<string, number> | undefined {
  const m = (globalThis as { performance?: { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } } }).performance?.memory;
  return m ? { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize, jsHeapSizeLimit: m.jsHeapSizeLimit } : undefined;
}

/**
 * Keeps the viewer's render engine usable. When the engine fails (its worker crashed, ran out of
 * memory, or stopped answering) it starts a new worker, opens every document again from the file
 * kept on this device, and tells the app to redraw. Markups live outside the engine and are
 * untouched. A second failure within RESTART_WINDOW_MS of a restart is not restarted: the app is
 * told, and the user can retry by hand.
 */
export class EngineSupervisor<D> {
  private lastRestart: number | null = null;
  private busy = false;
  /** The engine failed during a restart or too soon after one, and is waiting for a manual retry. */
  private stuck = false;
  private stopListening: () => void;
  private disposed = false;

  constructor(
    private engine: SupervisedEngine<D>,
    private hooks: SupervisorHooks<D>,
  ) {
    this.stopListening = engine.onFailure((err) => this.failed(err));
  }

  /** True when the engine is dead and will only come back through `retry`. */
  get needsRetry(): boolean {
    return this.stuck;
  }

  dispose() {
    this.disposed = true;
    this.stopListening();
  }

  private now() {
    return this.hooks.now ? this.hooks.now() : Date.now();
  }

  private logFailure(err: Error) {
    const docs = this.engine.openDocuments;
    const sizes = docs.map((d) => this.hooks.sizeOf?.(d));
    this.hooks.log?.('PDF engine failed', {
      cause: err.message,
      openDocuments: docs.length,
      totalBytes: sizes.every((s) => s !== undefined) ? (sizes as number[]).reduce((a, b) => a + b, 0) : undefined,
      memory: memoryDetail(),
    });
  }

  private failed(err: Error) {
    if (this.disposed) return;
    this.logFailure(err);
    const recent = this.lastRestart !== null && this.now() - this.lastRestart < RESTART_WINDOW_MS;
    if (this.busy || recent) {
      this.stuck = true;
      this.hooks.onGaveUp(err);
      return;
    }
    void this.restart();
  }

  /** Restarts the engine now, whatever its state and however recently it last restarted (the Retry action). */
  async retry(): Promise<RestartReport | null> {
    if (this.disposed || this.busy) return null;
    return this.restart();
  }

  private async restart(): Promise<RestartReport | null> {
    this.busy = true;
    this.stuck = false;
    this.lastRestart = this.now();
    try {
      if (!this.engine.restart()) return null;
      const docs = this.engine.openDocuments;
      const report: RestartReport = { reopened: 0, lost: 0 };
      for (const doc of docs) {
        if (this.stuck) break; // The new worker died too: the rest wait for a retry.
        try {
          const bytes = await this.hooks.bytesFor(doc);
          if (!bytes) throw new Error('no stored copy of the file');
          await this.engine.reopen(doc, bytes);
          report.reopened++;
        } catch (err) {
          if (this.stuck) break;
          this.engine.abandon(doc);
          report.lost++;
          this.hooks.log?.('Could not reopen a document after the PDF engine restarted', { cause: err instanceof Error ? err.message : String(err) });
        }
      }
      if (!this.disposed && !this.stuck) this.hooks.onRestarted(report);
      return report;
    } finally {
      this.busy = false;
    }
  }
}
