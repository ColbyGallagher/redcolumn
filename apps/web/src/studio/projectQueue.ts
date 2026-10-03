/**
 * Team Projects offline. Each Project's last view (its tree, revisions, check-outs and Record)
 * is kept so it can be browsed without the redcolumn server, and check-ins and notes made offline are
 * queued here and sent, in order, when the server can be reached again. Plain module (storage is
 * passed in) so the queue and its replay can be tested without a browser.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface QueuedBase {
  id: string;
  projectId: string;
  fileId: string;
  fileName: string;
  /** When it was made, and by whom. */
  at: number;
  by: string;
  /** Why the last attempt to send it was refused (it stays until retried or discarded). */
  error?: string;
}

/** A check-in of the library copy: its contents (with markups) are read when it is sent. */
export interface QueuedCheckIn extends QueuedBase {
  kind: 'checkin';
  libraryId: string;
  /** The revision the copy was based on, to detect that someone else checked in meanwhile. */
  baseRev: number;
  comment: string;
  keep: boolean;
}

export interface QueuedNote extends QueuedBase {
  kind: 'note';
  text: string;
}

export type QueuedChange = QueuedCheckIn | QueuedNote;
export type NewQueuedChange = Omit<QueuedCheckIn, 'id' | 'at' | 'error'> | Omit<QueuedNote, 'id' | 'at' | 'error'>;

const QUEUE = 'nb.projectQueue';
const SNAPSHOTS = 'nb.projectSnapshots';

function read<T>(store: KeyValueStore, key: string, fallback: T): T {
  try {
    return (JSON.parse(store.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(store: KeyValueStore, key: string, v: unknown) {
  try {
    store.setItem(key, JSON.stringify(v));
  } catch {
    // Storage full or blocked: not kept.
  }
}

/** A failure to reach the server (keep the change queued) rather than a refusal (report it). */
export const isUnreachable = (err: unknown) => (err as { status?: number } | null)?.status === 0;

export interface SendResult {
  sent: QueuedChange[];
  failed: QueuedChange[];
  /** The server could not be reached; the rest stay queued. */
  stopped: boolean;
}

export class ProjectQueue {
  private store: KeyValueStore;
  private listeners = new Set<() => void>();
  private cached: QueuedChange[] | null = null;
  private sending: Promise<SendResult> | null = null;
  constructor(store: KeyValueStore) {
    this.store = store;
  }

  all = (): QueuedChange[] => (this.cached ??= read<QueuedChange[]>(this.store, QUEUE, []));
  forProject = (projectId: string) => this.all().filter((c) => c.projectId === projectId);
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  get busy() {
    return !!this.sending;
  }

  private save(items: QueuedChange[]) {
    this.cached = items;
    write(this.store, QUEUE, items);
    this.listeners.forEach((l) => l());
  }

  add(change: NewQueuedChange, now = Date.now()): QueuedChange {
    const item = { ...change, id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: now } as QueuedChange;
    // A second offline check-in of the same file replaces the first: both would send the same copy.
    const rest = item.kind === 'checkin' ? this.all().filter((c) => !(c.kind === 'checkin' && c.projectId === item.projectId && c.fileId === item.fileId)) : this.all();
    this.save([...rest, item]);
    return item;
  }

  discard(id: string) {
    this.save(this.all().filter((c) => c.id !== id));
  }

  /** Clears the errors so refused changes are tried again on the next send. */
  retry(id?: string) {
    this.save(this.all().map((c) => (!id || c.id === id ? { ...c, error: undefined } : c)));
  }

  /** A check-in waiting for this file, if any. */
  pendingCheckIn = (projectId: string, fileId: string) => this.all().find((c): c is QueuedCheckIn => c.kind === 'checkin' && c.projectId === projectId && c.fileId === fileId) ?? null;

  /**
   * Sends the queued changes in order. A change the server refuses keeps its reason and stays
   * (later changes to the same file wait behind it); one the server cannot be reached for stops
   * the run with everything from it on still queued.
   */
  send(sender: (change: QueuedChange) => Promise<void>): Promise<SendResult> {
    if (this.sending) return this.sending;
    const run = this.run(sender).finally(() => {
      this.sending = null;
      this.listeners.forEach((l) => l());
    });
    this.sending = run;
    this.listeners.forEach((l) => l());
    return run;
  }

  private async run(sender: (change: QueuedChange) => Promise<void>): Promise<SendResult> {
    const result: SendResult = { sent: [], failed: [], stopped: false };
    const blocked = new Set<string>();
    for (const change of this.all()) {
      const fileKey = `${change.projectId}/${change.fileId}`;
      if (change.error || blocked.has(fileKey)) {
        blocked.add(fileKey);
        continue;
      }
      try {
        await sender(change);
        result.sent.push(change);
        this.save(this.all().filter((c) => c.id !== change.id));
      } catch (err) {
        if (isUnreachable(err)) {
          result.stopped = true;
          break;
        }
        const failed = { ...change, error: err instanceof Error ? err.message : String(err) };
        result.failed.push(failed);
        blocked.add(fileKey);
        this.save(this.all().map((c) => (c.id === change.id ? failed : c)));
      }
    }
    return result;
  }
}

/** A Project as last seen from the server, for browsing offline. */
export interface ProjectSnapshot<V, R> {
  view: V;
  record: R[];
  savedAt: number;
}

export function saveSnapshot<V, R>(store: KeyValueStore, id: string, view: V, record: R[], now = Date.now()) {
  const all = read<Record<string, ProjectSnapshot<V, R>>>(store, SNAPSHOTS, {});
  // The Record can grow long; the last 200 entries are plenty to read offline.
  all[id] = { view, record: record.slice(-200), savedAt: now };
  write(store, SNAPSHOTS, all);
}

export const loadSnapshot = <V, R>(store: KeyValueStore, id: string): ProjectSnapshot<V, R> | null => read<Record<string, ProjectSnapshot<V, R>>>(store, SNAPSHOTS, {})[id] ?? null;

export function dropSnapshot(store: KeyValueStore, id: string) {
  const all = read<Record<string, unknown>>(store, SNAPSHOTS, {});
  delete all[id];
  write(store, SNAPSHOTS, all);
}

export type CopyState = { kind: 'none' } | { kind: 'current'; rev: number } | { kind: 'stale'; rev: number; latest: number };

/** Whether this device has a copy of a Project file, and whether it is the latest revision. */
export function copyState(link: { rev: number } | null, latest: number): CopyState {
  if (!link) return { kind: 'none' };
  return link.rev >= latest ? { kind: 'current', rev: link.rev } : { kind: 'stale', rev: link.rev, latest };
}

/** How a queued change reads in the panel and the Record. */
export function describeQueued(c: QueuedChange): string {
  return c.kind === 'checkin' ? `Check in ${c.fileName}${c.comment ? `: ${c.comment}` : ''}` : `Note on ${c.fileName}: ${c.text}`;
}

/** The note as it is sent: when it was written offline, so the Record reads right. */
export function noteText(c: QueuedNote, sentAt = Date.now()): string {
  const late = sentAt - c.at > 60_000;
  return `noted on ${c.fileName}${late ? ` (written offline ${new Date(c.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})` : ''}: “${c.text}”`;
}

/** The queue for this browser (localStorage). */
let shared: ProjectQueue | null = null;
export const projectQueue = () => (shared ??= new ProjectQueue(typeof localStorage === 'undefined' ? { getItem: () => null, setItem: () => {} } : localStorage));
