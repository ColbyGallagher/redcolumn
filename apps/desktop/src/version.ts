/** Numeric parts of a release tag such as `v1.2.3`, or null when it is not a plain version. */
export function parseVersion(tag: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True when `latest` is a newer plain version than `current`. Anything else is not newer. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}
