/**
 * Signs out of the cloud after a while with no cloud work, so a token does not sit in a tab nobody
 * is using (docs/SECURITY-HARDENING.md, 3.2). Live Sessions and open Projects keep reading their
 * folders, so this only happens once nothing cloud-backed is open. Queued Project check-ins stop on
 * the sign-in error and wait for Reconnect, so nothing is lost.
 */

/** How long without cloud calls before signing out. */
export const IDLE_SIGN_OUT_MS = 30 * 60 * 1000;

let last = Date.now();

/** Called on every cloud call (Microsoft Graph, Google APIs). */
export function noteCloudActivity(now = Date.now()) {
  last = now;
}

export function cloudIdleFor(now = Date.now()): number {
  return now - last;
}

/**
 * Checks once a minute; after `IDLE_SIGN_OUT_MS` with no cloud calls, runs `signOut` once (until
 * cloud work starts again). Returns a function that stops the checks.
 */
export function startIdleSignOut(signOut: () => Promise<void> | void, { every = 60_000, after = IDLE_SIGN_OUT_MS } = {}): () => void {
  let signedOutAt = -1;
  const timer = setInterval(() => {
    if (cloudIdleFor() < after || signedOutAt === last) return;
    signedOutAt = last;
    void Promise.resolve(signOut()).catch(() => {});
  }, every);
  return () => clearInterval(timer);
}
