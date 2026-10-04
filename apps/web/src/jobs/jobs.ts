import { useSyncExternalStore } from 'react';

/**
 * Long-running work (OCR, page operations, indexing, …) runs as jobs: each reports progress, can
 * be cancelled if its work checks the signal, and shows in the jobs bar until it finishes. A job's
 * kind lets the app tell what is running (to disable what would clash with it).
 */
export interface Job {
  id: number;
  label: string;
  kind: string | null;
  /** Work done and total, e.g. pages. */
  done: number;
  total: number;
  status: string;
  /** Null for work that cannot stop part-way. */
  cancel: (() => void) | null;
  /** Shown in the jobs bar (short edits are not). */
  shown: boolean;
}

export interface JobContext {
  signal: AbortSignal;
  progress: (done: number, total: number, status?: string) => void;
}

export interface JobOptions {
  kind?: string;
  /** Default true. */
  cancellable?: boolean;
  /** Default true. */
  shown?: boolean;
}

let jobs: Job[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  jobs = [...jobs];
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Starts a job that runs until `end` is called (in a `finally`), for work not in one function. */
export function startJob(label: string, { kind, cancellable = true, shown = true }: JobOptions = {}): JobContext & { end: () => void } {
  const abort = new AbortController();
  const job: Job = { id: nextId++, label, kind: kind ?? null, done: 0, total: 0, status: 'Starting…', cancel: cancellable ? () => abort.abort() : null, shown };
  jobs.push(job);
  emit();
  const update = (patch: Partial<Job>) => {
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) {
      jobs[i] = { ...jobs[i]!, ...patch };
      emit();
    }
  };
  return {
    signal: abort.signal,
    progress: (done, total, status) => update({ done, total, ...(status !== undefined ? { status } : {}) }),
    end: () => {
      if (!jobs.some((j) => j.id === job.id)) return;
      jobs = jobs.filter((j) => j.id !== job.id);
      emit();
    },
  };
}

/** Runs `work` as a job; resolves with its result, or rejects (with an AbortError if cancelled). */
export async function runJob<T>(label: string, work: (ctx: JobContext) => Promise<T>, options: JobOptions = {}): Promise<T> {
  const { end, ...ctx } = startJob(label, options);
  try {
    return await work(ctx);
  } finally {
    end();
  }
}

/** The jobs running now. */
export const runningJobs = (): readonly Job[] => jobs;

export function useJobs(): Job[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

/** Whether a job of this kind is running. */
export function useJobRunning(kind: string): boolean {
  return useSyncExternalStore(subscribe, () => jobs.some((j) => j.kind === kind));
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
