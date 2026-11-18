import { useEffect, useState } from 'react';

/** Sent when Window > Reset Layout runs, so panels holding their own remembered state drop it. */
export const LAYOUT_RESET_EVENT = 'nb:layout-reset';

/** Per-section open/closed keys cleared by Reset Layout (the Library group keys live in storage/fileGroups.ts). */
export const SECTION_KEYS = ['nb.library.recentsOpen', 'nb.measure.sections'] as const;

/**
 * State kept in localStorage under `key` as JSON. `valid` decides whether a stored value is usable;
 * anything else gives `initial`. Storage that is off limits just means the state lasts this session.
 */
export function usePersistedState<T>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (next: T | ((prev: T) => T)) => void] {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const v: unknown = JSON.parse(raw);
      return valid(v) ? v : initial;
    } catch {
      return initial;
    }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const onReset = () => setValue(initial);
    window.addEventListener(LAYOUT_RESET_EVENT, onReset);
    return () => window.removeEventListener(LAYOUT_RESET_EVENT, onReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (next: T | ((prev: T) => T)) =>
    setValue((prev) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* the choice lasts for this session */
      }
      return v;
    });
  return [value, set];
}
