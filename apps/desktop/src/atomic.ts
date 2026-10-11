import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes beside the target, then renames over it. A crash, a full disk or a refused write leaves
 * the original file as it was.
 */
export async function writeAtomic(filePath: string, data: Uint8Array | string, options: { mode?: number } = {}) {
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temp, data, { mode: options.mode });
    await fs.rename(temp, filePath);
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    throw err;
  }
}

/** What a failed save tells the person, in place of a Node error code. */
export function saveError(err: unknown, filePath: string): Error {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  const name = path.basename(filePath);
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return new Error(`${name} could not be saved. It may be open in another program (such as Bluebeam or Acrobat), read-only, or in a folder you cannot write to. Close it there and save again.`);
  }
  if (code === 'ENOSPC') return new Error(`${name} could not be saved: the disk is full.`);
  if (code === 'ENOENT') return new Error(`${name} could not be saved: its folder no longer exists.`);
  return new Error(`${name} could not be saved${err instanceof Error ? `: ${err.message}` : '.'}`);
}
