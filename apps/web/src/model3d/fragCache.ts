/**
 * Converted models, kept on the device so opening the same IFC again skips the conversion (the
 * slow part). Kept by the IFC's content hash next to the library (Origin Private File System), and
 * sealed like the library's files when "Encrypt local data" is on.
 */
import { openLocal, sealLocal } from '../storage/localCrypto';

/** Bumped when the fragments format or the conversion settings change, so older conversions are not used. */
export const FRAG_VERSION = 2;

const DIR = 'model3d';

/** The cache file for a model's contents. */
export function fragName(hash: string): string {
  return `${hash}.v${FRAG_VERSION}.frag`;
}

async function dir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create });
  } catch {
    return null;
  }
}

/** The fragments converted earlier from this IFC, or null. */
export async function readFragments(hash: string): Promise<Uint8Array | null> {
  try {
    const d = await dir(false);
    if (!d) return null;
    const file = await (await d.getFileHandle(fragName(hash))).getFile();
    return await openLocal(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Keeps a conversion for next time. Failing to (no space, no storage) only means converting again. */
export async function writeFragments(hash: string, fragments: Uint8Array): Promise<void> {
  try {
    const d = await dir(true);
    if (!d) return;
    const w = await (await d.getFileHandle(fragName(hash), { create: true })).createWritable();
    await w.write((await sealLocal(fragments)) as Uint8Array<ArrayBuffer>);
    await w.close();
  } catch {
    // Not kept.
  }
}

/** Forgets a model's conversion (its file left the library). */
export async function dropFragments(hash: string): Promise<void> {
  try {
    await (await dir(false))?.removeEntry(fragName(hash));
  } catch {
    // Nothing kept.
  }
}
