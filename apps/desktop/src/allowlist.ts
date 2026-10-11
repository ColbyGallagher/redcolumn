import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** Windows paths are case-insensitive: C:\A.pdf and c:\a.pdf are one file and get one token. */
const sameKey = (filePath: string, platform: NodeJS.Platform) => (platform === 'win32' ? filePath.toLowerCase() : filePath);

/**
 * Paths the main process may read, write or reveal. Every entry was handed out by a dialog,
 * a drop, or a launch argument. The renderer only ever sees the token.
 */
export class PathAllowlist {
  private paths = new Map<string, string>();
  /** Called after the map changes, so a token still works after a restart. */
  onChange: (() => void) | null = null;

  private platform: NodeJS.Platform;

  constructor(platform: NodeJS.Platform = process.platform) {
    this.platform = platform;
  }

  add(filePath: string): string {
    const resolved = path.resolve(filePath);
    const key = sameKey(resolved, this.platform);
    for (const [token, existing] of this.paths) {
      if (sameKey(existing, this.platform) === key) return token;
    }
    const token = randomBytes(32).toString('hex');
    this.paths.set(token, resolved);
    this.onChange?.();
    return token;
  }

  get(token: string): string | null {
    return this.paths.get(token) ?? null;
  }

  /** Forgets a token, for a document that was removed from the device. */
  remove(token: string): boolean {
    const removed = this.paths.delete(token);
    if (removed) this.onChange?.();
    return removed;
  }

  /** Replaces the map. Used when restoring tokens the user already opened. */
  load(entries: Record<string, string>) {
    this.paths.clear();
    for (const [token, filePath] of Object.entries(entries)) {
      if (!/^[a-f0-9]{64}$/.test(token) || typeof filePath !== 'string' || !path.isAbsolute(filePath)) continue;
      this.paths.set(token, path.resolve(filePath));
    }
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.paths);
  }
}

/** The kinds of file the app opens. A path from a drop must be one of these. */
export const OPENABLE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];

export function isOpenable(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return OPENABLE_EXTENSIONS.includes(ext);
}
