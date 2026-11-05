import { CadReadError } from '../dxf';
import { codePageDecoder, R2007 } from './bits';
import { sectionLimit, type DwgFile } from './container';

/**
 * R2007 (AC1021) container (ODA spec 5): a Reed-Solomon coded file header, a page map and a
 * section map, and pages that are interleaved (Reed-Solomon) and compressed with their own LZ77
 * variant. Ported from ACadSharp (MIT).
 */

/** De-interleaves Reed-Solomon coded data (the parity bytes are dropped, not checked). */
function rsDecode(encoded: Uint8Array, out: Uint8Array, factor: number, blockSize: number) {
  let index = 0;
  let length = out.length;
  for (let i = 0; i < factor; i++) {
    let c = i;
    if (i < encoded.length) {
      const size = Math.min(length, blockSize);
      length -= size;
      const end = index + size;
      while (index < end) {
        out[index++] = encoded[c] ?? 0;
        c += factor;
      }
    }
  }
}

// ---- LZ77, R2007 variant --------------------------------------------------------------------

type CopyFn = (s: Uint8Array, si: number, d: Uint8Array, di: number) => void;
const c1: CopyFn = (s, si, d, di) => {
  d[di] = s[si]!;
};
const c2: CopyFn = (s, si, d, di) => {
  d[di] = s[si + 1]!;
  d[di + 1] = s[si]!;
};
const c3: CopyFn = (s, si, d, di) => {
  d[di] = s[si + 2]!;
  d[di + 1] = s[si + 1]!;
  d[di + 2] = s[si]!;
};
const c4: CopyFn = (s, si, d, di) => {
  d[di] = s[si]!;
  d[di + 1] = s[si + 1]!;
  d[di + 2] = s[si + 2]!;
  d[di + 3] = s[si + 3]!;
};
const c8: CopyFn = (s, si, d, di) => {
  c4(s, si, d, di);
  c4(s, si + 4, d, di + 4);
};
const c16: CopyFn = (s, si, d, di) => {
  c8(s, si + 8, d, di);
  c8(s, si, d, di + 8);
};
/** Literal runs of 1–31 bytes are stored in a shuffled order; each length has its own. */
const COPIES: (CopyFn | null)[] = [
  null,
  c1,
  c2,
  c3,
  c4,
  (s, si, d, di) => (c1(s, si + 4, d, di), c4(s, si, d, di + 1)),
  (s, si, d, di) => (c1(s, si + 5, d, di), c4(s, si + 1, d, di + 1), c1(s, si, d, di + 5)),
  (s, si, d, di) => (c2(s, si + 5, d, di), c4(s, si + 1, d, di + 2), c1(s, si, d, di + 6)),
  c8,
  (s, si, d, di) => (c1(s, si + 8, d, di), c8(s, si, d, di + 1)),
  (s, si, d, di) => (c1(s, si + 9, d, di), c8(s, si + 1, d, di + 1), c1(s, si, d, di + 9)),
  (s, si, d, di) => (c2(s, si + 9, d, di), c8(s, si + 1, d, di + 2), c1(s, si, d, di + 10)),
  (s, si, d, di) => (c4(s, si + 8, d, di), c8(s, si, d, di + 4)),
  (s, si, d, di) => (c1(s, si + 12, d, di), c4(s, si + 8, d, di + 1), c8(s, si, d, di + 5)),
  (s, si, d, di) => (c1(s, si + 13, d, di), c4(s, si + 9, d, di + 1), c8(s, si + 1, d, di + 5), c1(s, si, d, di + 13)),
  (s, si, d, di) => (c2(s, si + 13, d, di), c4(s, si + 9, d, di + 2), c8(s, si + 1, d, di + 6), c1(s, si, d, di + 14)),
  c16,
  (s, si, d, di) => (c8(s, si + 9, d, di), c1(s, si + 8, d, di + 8), c8(s, si, d, di + 9)),
  (s, si, d, di) => (c1(s, si + 17, d, di), c16(s, si + 1, d, di + 1), c1(s, si, d, di + 17)),
  (s, si, d, di) => (c3(s, si + 16, d, di), c16(s, si, d, di + 3)),
  (s, si, d, di) => (c4(s, si + 16, d, di), c8(s, si + 8, d, di + 4), c8(s, si, d, di + 12)),
  (s, si, d, di) => (c1(s, si + 20, d, di), c4(s, si + 16, d, di + 1), c8(s, si + 8, d, di + 5), c8(s, si, d, di + 13)),
  (s, si, d, di) => (c2(s, si + 20, d, di), c4(s, si + 16, d, di + 2), c8(s, si + 8, d, di + 6), c8(s, si, d, di + 14)),
  (s, si, d, di) => (c3(s, si + 20, d, di), c4(s, si + 16, d, di + 3), c8(s, si + 8, d, di + 7), c8(s, si, d, di + 15)),
  (s, si, d, di) => (c8(s, si + 16, d, di), c16(s, si, d, di + 8)),
  (s, si, d, di) => (c8(s, si + 17, d, di), c1(s, si + 16, d, di + 8), c16(s, si, d, di + 9)),
  (s, si, d, di) => (c1(s, si + 25, d, di), c8(s, si + 17, d, di + 1), c1(s, si + 16, d, di + 9), c16(s, si, d, di + 10)),
  (s, si, d, di) => (c2(s, si + 25, d, di), c8(s, si + 17, d, di + 2), c1(s, si + 16, d, di + 10), c16(s, si, d, di + 11)),
  (s, si, d, di) => (c4(s, si + 24, d, di), c8(s, si + 16, d, di + 4), c8(s, si + 8, d, di + 12), c8(s, si, d, di + 20)),
  (s, si, d, di) => (c1(s, si + 28, d, di), c4(s, si + 24, d, di + 1), c8(s, si + 16, d, di + 5), c8(s, si + 8, d, di + 13), c8(s, si, d, di + 21)),
  (s, si, d, di) => (c2(s, si + 28, d, di), c4(s, si + 24, d, di + 2), c8(s, si + 16, d, di + 6), c8(s, si + 8, d, di + 14), c8(s, si, d, di + 22)),
  (s, si, d, di) => (c1(s, si + 30, d, di), c4(s, si + 26, d, di + 1), c8(s, si + 18, d, di + 5), c8(s, si + 10, d, di + 13), c8(s, si + 2, d, di + 21), c2(s, si, d, di + 29)),
];

export function lz77ac21(src: Uint8Array, start: number, length: number, dst: Uint8Array) {
  let si = start;
  const end = start + length;
  let len = 0;
  let off = 0;
  let op = src[si++] ?? 0;
  let di = 0;
  const bad = () => new CadReadError('This DWG file is damaged (bad compressed page).');
  const byte = () => {
    if (si >= src.length) throw bad();
    return src[si++]!;
  };
  if (si >= end) return;
  if ((op & 0xf0) === 0x20) {
    si += 3;
    len = src[si - 1]! & 7;
  }
  const literal = () => {
    if (len === 0) {
      len = op + 8;
      if (len === 0x17) {
        let n = byte();
        len += n;
        if (n === 0xff) {
          do {
            n = byte() | (byte() << 8);
            len += n;
          } while (n === 0xffff);
        }
      }
    }
    if (si + len > src.length || di + len > dst.length) throw bad();
    let n = len;
    let s = si;
    let d = di;
    for (; n >= 32; n -= 32, s += 32, d += 32) {
      c4(src, s + 24, dst, d);
      c4(src, s + 28, dst, d + 4);
      c4(src, s + 16, dst, d + 8);
      c4(src, s + 20, dst, d + 12);
      c4(src, s + 8, dst, d + 16);
      c4(src, s + 12, dst, d + 20);
      c4(src, s, dst, d + 24);
      c4(src, s + 4, dst, d + 28);
    }
    if (n > 0) COPIES[n]!(src, s, dst, d);
    si += len;
    di += len;
  };
  const instructions = () => {
    switch (op >> 4) {
      case 0:
        len = (op & 0xf) + 0x13;
        off = byte();
        op = byte();
        len = ((op >> 3) & 0x10) + len;
        off = ((op & 0x78) << 5) + 1 + off;
        break;
      case 1:
        len = (op & 0xf) + 3;
        off = byte();
        op = byte();
        off = ((op & 0xf8) << 5) + 1 + off;
        break;
      case 2:
        off = byte();
        off = ((byte() << 8) & 0xff00) | off;
        len = op & 7;
        if ((op & 8) === 0) {
          op = byte();
          len = (op & 0xf8) + len;
        } else {
          off++;
          len = (byte() << 3) + len;
          op = byte();
          len = ((op & 0xf8) << 8) + len + 0x100;
        }
        break;
      default:
        len = op >> 4;
        off = op & 15;
        op = byte();
        off = ((op & 0xf8) << 1) + off + 1;
    }
  };
  const chunks = () => {
    len = 0;
    op = byte();
    instructions();
    for (;;) {
      if (off > di || di + len > dst.length) throw bad();
      for (let k = 0; k < len; k++, di++) dst[di] = dst[di - off]!;
      len = op & 7;
      if (len !== 0 || si >= end) break;
      op = byte();
      if (op >> 4 === 0) break;
      if (op >> 4 === 15) op &= 15;
      instructions();
    }
  };
  while (si < end) {
    literal();
    if (si >= end) break;
    chunks();
  }
}

// ---- container --------------------------------------------------------------------------------

const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 2 ** 32;
const i64 = (b: Uint8Array, at: number) => {
  const hi = u32(b, at + 4) | 0;
  return hi * 2 ** 32 + u32(b, at);
};

/** A system page: Reed-Solomon coded (block size 239 or 239+), then compressed. */
function pageBuffer(bytes: Uint8Array, pageOffset: number, compressed: number, uncompressed: number, correction: number, blockSize: number): Uint8Array {
  const aligned = (compressed + 7) & ~7;
  const total = aligned * correction;
  const factor = Math.ceil(total / blockSize);
  const length = factor * 255;
  const at = 0x480 + pageOffset;
  if (total > sectionLimit(bytes.length) || uncompressed > sectionLimit(bytes.length) || at + length > bytes.length) throw new CadReadError('This DWG file is damaged or truncated.');
  const coded = bytes.subarray(at, at + length);
  const data = new Uint8Array(total);
  rsDecode(coded, data, factor, blockSize);
  const out = new Uint8Array(uncompressed);
  lz77ac21(data, 0, compressed, out);
  return out;
}

interface Page {
  offset: number;
  id: number;
  uncompressed: number;
  compressed: number;
}

export function readAc21(bytes: Uint8Array): DwgFile {
  if (bytes.length < 0x480) throw new CadReadError('This DWG file is damaged or truncated.');
  const decoder = codePageDecoder(bytes[0x13]! | (bytes[0x14]! << 8));
  const decoded = new Uint8Array(3 * 239);
  rsDecode(bytes.subarray(0x80, 0x80 + 0x400), decoded, 3, 239);
  const comprLen = u32(decoded, 24) | 0;
  if (comprLen <= 0 || comprLen > decoded.length - 32) throw new CadReadError('This DWG file is damaged (bad file header).');
  const meta = new Uint8Array(0x110);
  lz77ac21(decoded, 32, comprLen, meta);
  const m = (k: number) => u64(meta, k);
  const pagesMapOffset = m(0x38);
  const pagesMapCompressed = m(0x50);
  const pagesMapUncompressed = m(0x58);
  const pagesMapCorrection = m(0x18);
  const sectionsMapCompressed = m(0xb0);
  const sectionsMapId = m(0xc0);
  const sectionsMapUncompressed = m(0xc8);
  const sectionsMapCorrection = m(0xd8);

  const pm = pageBuffer(bytes, pagesMapOffset, pagesMapCompressed, pagesMapUncompressed, pagesMapCorrection, 0xef);
  const records = new Map<number, { seeker: number; size: number }>();
  let offset = 0;
  for (let p = 0; p + 16 <= pm.length; p += 16) {
    const size = i64(pm, p);
    const id = Math.abs(i64(pm, p + 8));
    records.set(id, { seeker: offset, size });
    offset += size;
  }
  const smRec = records.get(sectionsMapId);
  if (!smRec) throw new CadReadError('This DWG file is damaged (no section map).');
  const sm = pageBuffer(bytes, smRec.seeker, sectionsMapCompressed, sectionsMapUncompressed, sectionsMapCorrection, 239);

  const sections = new Map<string, { size: number; encoding: number; pages: Page[] }>();
  for (let q = 0; q + 64 <= sm.length; ) {
    const size = u64(sm, q);
    const nameLength = i64(sm, q + 32);
    const encoding = u64(sm, q + 48);
    const pageCount = u64(sm, q + 56);
    q += 64;
    let name = '';
    if (nameLength > 0) {
      name = new TextDecoder('utf-16le').decode(sm.subarray(q, q + nameLength)).replace(/\0/g, '');
      q += nameLength;
    }
    const pages: Page[] = [];
    for (let i = 0; i < pageCount && q + 56 <= sm.length; i++) {
      pages.push({ offset: u64(sm, q), id: i64(sm, q + 16), uncompressed: u64(sm, q + 24), compressed: u64(sm, q + 32) });
      q += 56;
    }
    if (name) sections.set(name, { size, encoding, pages });
  }

  const cache = new Map<string, Uint8Array | null>();
  const section = (name: string): Uint8Array | null => {
    if (cache.has(name)) return cache.get(name)!;
    const s = sections.get(name);
    let out: Uint8Array | null = null;
    if (s) {
      const total = s.pages.reduce((a, p) => Math.max(a, p.offset + p.uncompressed), 0);
      if (total > sectionLimit(bytes.length)) throw new CadReadError('This DWG file is damaged (bad section size).');
      out = new Uint8Array(total);
      for (const p of s.pages) {
        const rec = records.get(p.id);
        if (!rec) continue;
        const at = rec.seeker + 0x480;
        if (at + rec.size > bytes.length) throw new CadReadError('This DWG file is damaged or truncated.');
        let page = bytes.subarray(at, at + rec.size);
        if (s.encoding === 4) {
          const aligned = (p.compressed + 7) & ~7;
          const factor = Math.ceil(aligned / 251);
          const arr = new Uint8Array(factor * 251);
          rsDecode(page, arr, factor, 251);
          page = arr;
        }
        if (p.uncompressed > sectionLimit(bytes.length)) throw new CadReadError('This DWG file is damaged (bad page size).');
        if (p.compressed !== p.uncompressed) {
          const arr = new Uint8Array(p.uncompressed);
          lz77ac21(page, 0, p.compressed, arr);
          page = arr;
        }
        out.set(page.subarray(0, Math.min(p.uncompressed, out.length - p.offset)), p.offset);
      }
    }
    cache.set(name, out);
    return out;
  };
  return {
    version: R2007,
    maintenance: bytes[0x0b] ?? 0,
    decoder,
    section,
    objects: () => section('AcDb:AcDbObjects') ?? new Uint8Array(0),
  };
}
