import fs from 'node:fs/promises';
import type { PathAllowlist } from './allowlist';

/** True when an existing regular file lives at `filePath`. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves an opaque file token via the allowlist, verifies the path still exists on disk,
 * and reveals it in the OS file manager. Arbitrary paths from the renderer are never accepted.
 */
export async function revealFileByToken(
  allowlist: PathAllowlist,
  token: unknown,
  showItemInFolder: (fullPath: string) => void,
  exists: (fullPath: string) => Promise<boolean> = fileExists,
): Promise<boolean> {
  if (typeof token !== 'string' || !token) return false;
  const resolvedPath = allowlist.get(token);
  if (!resolvedPath) return false;
  if (!(await exists(resolvedPath))) return false;
  showItemInFolder(resolvedPath);
  return true;
}
