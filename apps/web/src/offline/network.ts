import { useSyncExternalStore } from 'react';

/**
 * Whether the device has a network. `navigator.onLine` is false only when there is certainly no
 * connection (it can be true behind a dead Wi-Fi), so features that need the network are disabled
 * when it is false and still report their own errors when it is true.
 */

const subscribe = (fn: () => void) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}

/** Why an online-only feature is unavailable: "<what> needs a network connection…". */
export const offlineReason = (what: string) => `${what} needs a network connection. This device is offline; try again when it is back online.`;

export class OfflineError extends Error {}

/** Throws a clear error for an online-only feature used offline. */
export function requireOnline(what: string) {
  if (!isOnline()) throw new OfflineError(offlineReason(what));
}
