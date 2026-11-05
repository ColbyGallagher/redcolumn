import { desktop } from './host';

const tokens = new WeakMap<object, string>();
const byDocument = new Map<string, string>();
const listeners = new Set<() => void>();

export function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function toBytes(data: Blob | BufferSource): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** A file the main process will read and write. IndexedDB stores the token, not a path. */
export function tokenHandle(token: string, name: string): FileSystemFileHandle {
  const handle = {
    kind: 'file' as const,
    name,
    async getFile() {
      const host = desktop();
      if (!host) throw new Error('The desktop bridge is missing.');
      const bytes = ownedBytes(await host.readToken(token));
      return new File([bytes], name, { type: mimeFor(name) });
    },
    async createWritable() {
      // Writes append, as FileSystemWritableFileStream's do. close() saves them in one go,
      // so the file on disk is replaced whole or not at all.
      const chunks: Uint8Array[] = [];
      let closed = false;
      return {
        async write(data: Blob | BufferSource) {
          if (closed) throw new TypeError('The file has already been closed.');
          chunks.push(ownedBytes(await toBytes(data)));
        },
        async close() {
          if (closed) return;
          closed = true;
          const host = desktop();
          if (!host || !chunks.length) return;
          const ok = await host.writeToken(token, concat(chunks));
          if (!ok) throw new Error(`${name} could not be written.`);
        },
        async abort() {
          closed = true;
          chunks.length = 0;
        },
      };
    },
    async queryPermission() {
      return 'granted' as PermissionState;
    },
    async requestPermission() {
      return 'granted' as PermissionState;
    },
  };
  tokens.set(handle, token);
  return handle as unknown as FileSystemFileHandle;
}

export const tokenOf = (handle: object | null | undefined): string | null => (handle ? tokens.get(handle) ?? null : null);

export function noteLocation(id: string, token: string | null) {
  const prev = byDocument.get(id) ?? null;
  if (token) byDocument.set(id, token);
  else byDocument.delete(id);
  if ((token ?? null) !== prev) for (const listener of listeners) listener();
}

/** Files that arrived from another window as contents rather than from disk: whether they carry unsaved changes, and whether they have a file to save back to. */
export const movedFiles = new WeakMap<File, { dirty: boolean; hasFile: boolean }>();

/**
 * A file handed over by another window. With a token, saving writes back to that file; without
 * one the document is new and Save asks where to put it.
 */
export function transferHandle(item: { token: string; name: string; dirty?: boolean }, read: () => Promise<Uint8Array | null>): FileSystemFileHandle {
  let file: Promise<File> | null = null;
  const getFile = () =>
    (file ??= read().then((bytes) => {
      if (!bytes) throw new Error('That document is no longer available.');
      const f = new File([ownedBytes(bytes)], item.name, { type: mimeFor(item.name) });
      movedFiles.set(f, { dirty: item.dirty === true, hasFile: !!item.token });
      return f;
    }));
  if (item.token) {
    // Saving goes to the original file; reading gives the moved contents instead.
    const handle = tokenHandle(item.token, item.name) as unknown as { getFile: () => Promise<File> };
    handle.getFile = getFile;
    return handle as unknown as FileSystemFileHandle;
  }
  return { kind: 'file', name: item.name, getFile } as unknown as FileSystemFileHandle;
}

/** The token of the file a document was opened from or saved to, if the desktop app holds one. */
export const fileLocationToken = (id: string) => byDocument.get(id) ?? null;

export const hasFileLocation = (id: string) => byDocument.has(id);

export function subscribeFileLocations(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export async function revealFileLocation(id: string): Promise<boolean> {
  const token = byDocument.get(id);
  const host = desktop();
  if (!token || !host) return false;
  return host.showInFolder(token);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function mimeFor(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.bmp$/i.test(name)) return 'image/bmp';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'application/pdf';
}
