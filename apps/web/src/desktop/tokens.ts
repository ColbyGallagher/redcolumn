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
