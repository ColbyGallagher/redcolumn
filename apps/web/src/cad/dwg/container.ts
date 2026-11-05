import { CadReadError } from '../dxf';
import { BitReader, codePageDecoder, R2000, R2004, R2007 } from './bits';
import { lz77ac18 } from './lz77';
import { readAc21 } from './r2007';

/**
 * The DWG file container: version, code page and the named sections (header, classes, handles,
 * objects). R2000 sections sit at fixed offsets; R2004+ sections are assembled from compressed,
 * encrypted pages (ODA spec 3, 4, 5).
 */

export interface DwgFile {
  /** 1015, 1018, 1021, 1024, 1027 or 1032. */
  version: number;
  maintenance: number;
  decoder: TextDecoder;
  /** A section's bytes (decompressed), or null when the file has none. */
  section(name: string): Uint8Array | null;
  /**
   * The bytes object offsets in the handle map are relative to: the whole file for R2000, the
   * AcDb:AcDbObjects section after.
   */
  objects(): Uint8Array;
}

export const SECTION = {
  header: 'AcDb:Header',
  classes: 'AcDb:Classes',
  handles: 'AcDb:Handles',
  objects: 'AcDb:AcDbObjects',
} as const;

const MAX_SECTION = 1 << 30;
/** Largest a decompressed section can plausibly be for a file of `n` bytes (corrupt sizes stop here). */
export const sectionLimit = (n: number) => Math.min(MAX_SECTION, n * 64 + (1 << 20));

export function versionOf(bytes: Uint8Array): number {
  const tag = String.fromCharCode(...bytes.subarray(0, 6));
  const m = /^AC(\d{4})$/.exec(tag);
  return m ? Number(m[1]) : 0;
}

export function openDwg(bytes: Uint8Array): DwgFile {
  const version = versionOf(bytes);
  if (!version) throw new CadReadError('This is not a DWG file.');
  if (version < R2000) throw new CadReadError('This DWG file is older than AutoCAD 2000. Save it as a newer DWG version (2000 or later) to open it.');
  if (version > 1032) throw new CadReadError(`This DWG version (AC${version}) is newer than the converter knows. Save it as DWG 2018 to open it.`);
  if (version === R2000) return openR2000(bytes);
  if (version === R2007) return readAc21(bytes);
  return openR2004(bytes, version);
}

// ---- R2000 ------------------------------------------------------------------------------------

function openR2000(bytes: Uint8Array): DwgFile {
  const r = new BitReader(bytes, R2000);
  r.bytePos = 0x13;
  const decoder = codePageDecoder(r.RS());
  const n = r.RL();
  const records = new Map<number, { seeker: number; size: number }>();
  for (let i = 0; i < n && i < 16; i++) {
    const num = r.RC();
    const seeker = r.RL();
    const size = r.RL();
    records.set(num, { seeker, size });
  }
  const at: Record<string, number> = { [SECTION.header]: 0, [SECTION.classes]: 1, [SECTION.handles]: 2 };
  return {
    version: R2000,
    maintenance: bytes[0x0b] ?? 0,
    decoder,
    section(name) {
      const rec = records.get(at[name] ?? -1);
      if (!rec || rec.seeker < 0 || rec.seeker >= bytes.length) return null;
      // Sections are read from their start to wherever their own sizes say they end.
      return bytes.subarray(rec.seeker);
    },
    objects: () => bytes,
  };
}

// ---- R2004, R2010, R2013, R2018 -------------------------------------------------------------

/** XOR-decrypts the 0x6C bytes of the R2004 file header with the spec's random sequence. */
function decryptHeader(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data);
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (Math.imul(seed, 0x343fd) + 0x269ec3) | 0;
    out[i]! ^= (seed >> 16) & 0xff;
  }
  return out;
}

const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const i32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 2 ** 32;

/** A system page (page map, section map): 20-byte header, then LZ77 data. */
function systemPage(bytes: Uint8Array, at: number): Uint8Array {
  if (at + 20 > bytes.length) throw new CadReadError('This DWG file is damaged or truncated.');
  const size = u32(bytes, at + 4);
  if (size > sectionLimit(bytes.length)) throw new CadReadError('This DWG file is damaged (bad page size).');
  const out = new Uint8Array(size);
  lz77ac18(bytes, at + 20, out);
  return out;
}

interface Page {
  number: number;
  offset: number;
}
interface Descriptor {
  size: number;
  maxPage: number;
  compressed: boolean;
  pages: Page[];
}

function openR2004(bytes: Uint8Array, version: number): DwgFile {
  if (bytes.length < 0x100) throw new CadReadError('This DWG file is damaged or truncated.');
  const decoder = codePageDecoder(bytes[0x13]! | (bytes[0x14]! << 8));
  const head = decryptHeader(bytes.subarray(0x80, 0x80 + 0x6c));
  if (String.fromCharCode(...head.subarray(0, 11)) !== 'AcFssFcAJMB') throw new CadReadError('This DWG file is damaged (bad file header).');
  const sectionMapId = u32(head, 0x5c);
  const pageMapAddr = u64(head, 0x54) + 0x100;

  // Page map: page numbers and sizes; pages are laid out one after another from 0x100.
  const pageMap = systemPage(bytes, pageMapAddr);
  const seekers = new Map<number, number>();
  let total = 0x100;
  for (let p = 0; p + 8 <= pageMap.length; ) {
    const num = i32(pageMap, p);
    const size = u32(pageMap, p + 4);
    p += 8;
    if (num >= 0) seekers.set(num, total);
    else p += 16;
    total += size;
  }
  const mapAt = seekers.get(sectionMapId);
  if (mapAt === undefined) throw new CadReadError('This DWG file is damaged (no section map).');

  // Section map: each named section and its pages.
  const sm = systemPage(bytes, mapAt);
  const descriptors = new Map<string, Descriptor>();
  const count = u32(sm, 0);
  let q = 20;
  for (let i = 0; i < count && q + 0x60 <= sm.length; i++) {
    const size = u64(sm, q);
    const pageCount = u32(sm, q + 8);
    const maxPage = u32(sm, q + 12);
    const compressed = u32(sm, q + 20) === 2;
    let name = '';
    for (let k = 0; k < 64 && sm[q + 32 + k]; k++) name += String.fromCharCode(sm[q + 32 + k]!);
    q += 0x60;
    const pages: Page[] = [];
    for (let j = 0; j < pageCount && q + 16 <= sm.length; j++) {
      pages.push({ number: u32(sm, q), offset: u64(sm, q + 8) });
      q += 16;
    }
    descriptors.set(name, { size, maxPage, compressed, pages });
  }

  const cache = new Map<string, Uint8Array | null>();
  const section = (name: string): Uint8Array | null => {
    if (cache.has(name)) return cache.get(name)!;
    const d = descriptors.get(name);
    let out: Uint8Array | null = null;
    if (d) {
      if (d.size > sectionLimit(bytes.length) || d.maxPage > 0x100000) throw new CadReadError('This DWG file is damaged (bad section size).');
      out = new Uint8Array(d.size);
      const page = new Uint8Array(d.maxPage);
      for (const p of d.pages) {
        const at = seekers.get(p.number);
        if (at === undefined || at + 32 > bytes.length) continue;
        // Data page header, encrypted with a mask from its own position.
        const mask = (0x4164536b ^ at) >>> 0;
        const field = (k: number) => (u32(bytes, at + k * 4) ^ mask) >>> 0;
        const compSize = field(2);
        const start = at + 32;
        let n: number;
        if (d.compressed) {
          page.fill(0);
          n = lz77ac18(bytes, start, page);
        } else {
          n = Math.min(compSize, d.maxPage, bytes.length - start);
          page.set(bytes.subarray(start, start + n));
        }
        const len = Math.min(n, out.length - p.offset);
        if (len > 0 && p.offset < out.length) out.set(page.subarray(0, len), p.offset);
      }
    }
    cache.set(name, out);
    return out;
  };
  return {
    version,
    maintenance: bytes[0x0b] ?? 0,
    decoder,
    section,
    objects: () => section(SECTION.objects) ?? new Uint8Array(0),
  };
}

export { R2004 };
