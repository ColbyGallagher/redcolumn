/// <reference lib="webworker" />
import { diffMasks, findOffset, inkMask, type DiffOptions } from './diff';

export interface CompareWorkRequest {
  id: number;
  old: { rgba: Uint8ClampedArray; width: number; height: number };
  cur: { rgba: Uint8ClampedArray; width: number; height: number };
  /** Largest shift searched when aligning, in pixels; 0 for no alignment. */
  maxShift: number;
  /** False to only line the pages up (Overlay Pages). */
  diff: boolean;
  options: Omit<DiffOptions, 'offset'>;
}

/** Pixel work of Compare Documents, off the main thread. */
self.onmessage = (e: MessageEvent<CompareWorkRequest>) => {
  const { id, old, cur, maxShift, diff, options } = e.data;
  try {
    const a = inkMask(old.rgba, old.width, old.height);
    const b = inkMask(cur.rgba, cur.width, cur.height);
    const offset = maxShift > 0 ? findOffset(a, b, maxShift) : ([0, 0] as [number, number]);
    const differences = diff ? diffMasks(a, b, { ...options, offset }) : [];
    self.postMessage({ id, offset, differences });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
