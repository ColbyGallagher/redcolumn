import { useSyncExternalStore } from 'react';

/**
 * Long-running work (OCR now; batch processing later) runs as jobs: each reports progress, can be
 * cancelled, and shows in the jobs bar until it finishes.
 */
export interface Job {
  id: number;
  label: string;
  /** Work done and total, e.g. pages. */
  done: number;
  total: number;
  status: string;
  cancel: () => void;
}

export interface JobContext {
  signal: AbortSignal;
  progress: (done: number, total: number, status?: string) => void;
}

let jobs: Job[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  jobs = [...jobs];
  listeners.forEach((l) => l());
};

/** Runs `work` as a job; resolves with its result, or rejects (with an AbortError if cancelled). */
export async function runJob<T>(label: string, work: (ctx: JobContext) => Promise<T>): Promise<T> {
  const abort = new AbortController();
  const job: Job = { id: nextId++, label, done: 0, total: 0, status: 'Starting…', cancel: () => abort.abort() };
  jobs.push(job);
  emit();
  const update = (patch: Partial<Job>) => {
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) {
      jobs[i] = { ...jobs[i]!, ...patch };
      emit();
    }
  };
  try {
    return await work({ signal: abort.signal, progress: (done, total, status) => update({ done, total, ...(status !== undefined ? { status } : {}) }) });
  } finally {
    jobs = jobs.filter((j) => j.id !== job.id);
    emit();
  }
}

/** The jobs running now. */
export const runningJobs = (): readonly Job[] => jobs;

export function useJobs(): Job[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => jobs,
  );
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
