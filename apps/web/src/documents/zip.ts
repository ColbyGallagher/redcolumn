import { msg } from '@nb/i18n';

/** CRC-32 (IEEE) for zip entries. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip archive of files stored without compression (PDFs are already compressed), for downloading
 * several documents at once.
 */
export function zipFiles(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.data.length, true);
    dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A zip that cannot be read, with a message fit to show. */
export class ZipReadError extends Error {}

/**
 * The files in a zip (stored or deflated), for archives people bring in: sizes are capped before
 * and while unpacking, as the sizes a zip declares are not to be trusted. Folders are skipped.
 */
export async function unzipFiles(zip: Uint8Array, maxTotal = 200 * 1024 * 1024): Promise<{ name: string; data: Uint8Array }[]> {
  const bad = () => new ZipReadError(msg('That file is not a zip archive.'));
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad();
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new ZipReadError(msg('That archive is too large.'));
  const dec = new TextDecoder();
  const out: { name: string; data: Uint8Array }[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || view.getUint32(p, true) !== 0x02014b50) throw bad();
    const nameLen = view.getUint16(p + 28, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    const encrypted = view.getUint16(p + 8, true) & 1;
    const method = view.getUint16(p + 10, true);
    const packed = view.getUint32(p + 20, true);
    const local = view.getUint32(p + 42, true);
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    if (name.endsWith('/')) continue;
    if (encrypted) throw new ZipReadError(msg('That archive is password-protected.'));
    if (local + 30 > zip.length || view.getUint32(local, true) !== 0x04034b50) throw bad();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = zip.subarray(start, start + packed);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw, maxTotal - total);
    else throw new ZipReadError(msg('That archive uses a compression this app cannot read.'));
    total += data.length;
    if (total > maxTotal) throw new ZipReadError(msg('That archive is too large.'));
    out.push({ name, data });
  }
  return out;
}

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read().catch(() => {
      throw new ZipReadError(msg('That archive is damaged.'));
    });
    if (done) break;
    total += value.length;
    if (total > limit) {
      void reader.cancel().catch(() => undefined);
      throw new ZipReadError(msg('That archive is too large.'));
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
