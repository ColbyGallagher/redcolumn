/**
 * Session Roundtrip: which library file each session document came from, so finishing the
 * session can send the result back there.
 * Kept by the host's browser, which is the one that finishes the session.
 */

export type RoundtripSource = { kind: 'file'; fileId: string; name: string };

const KEY = 'nb.roundtrip';

function all(): Record<string, RoundtripSource> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, RoundtripSource>) ?? {};
  } catch {
    return {};
  }
}

export function rememberSource(sessionId: string, docId: string, source: RoundtripSource) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...all(), [`${sessionId}:${docId}`]: source }));
  } catch {
    // Not remembered: the document just cannot be sent back.
  }
}

export const sourceOf = (sessionId: string, docId: string): RoundtripSource | null => all()[`${sessionId}:${docId}`] ?? null;

export function forgetSession(sessionId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(all()).filter(([k]) => !k.startsWith(`${sessionId}:`)))));
  } catch {
    // Harmless.
  }
}
