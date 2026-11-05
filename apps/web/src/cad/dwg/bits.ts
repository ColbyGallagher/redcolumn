import { CadReadError } from '../dxf';

/**
 * Bit-level reader for DWG data (Open Design Specification for .dwg files, chapter 2). Positions
 * are in bits. Everything reads little-endian except handle bytes (most significant first).
 */

/** DWG version codes, compared by number: AC1015 R2000 … AC1032 R2018. */
export const R2000 = 1015;
export const R2004 = 1018;
export const R2007 = 1021;
export const R2010 = 1024;
export const R2013 = 1027;
export const R2018 = 1032;

/** Drawing code page index (file header) to a TextDecoder label. */
const CODE_PAGES: Record<number, string> = {
  1: 'ascii',
  2: 'iso-8859-1',
  3: 'iso-8859-2',
  4: 'iso-8859-3',
  5: 'iso-8859-4',
  6: 'iso-8859-5',
  7: 'iso-8859-6',
  8: 'iso-8859-7',
  9: 'iso-8859-8',
  10: 'iso-8859-9',
  11: 'ibm437',
  12: 'ibm850',
  13: 'ibm852',
  14: 'ibm855',
  15: 'ibm857',
  16: 'ibm860',
  17: 'ibm861',
  18: 'ibm863',
  19: 'ibm864',
  20: 'ibm865',
  21: 'ibm869',
  22: 'shift_jis',
  23: 'macintosh',
  24: 'big5',
  25: 'euc-kr',
  26: 'euc-kr',
  27: 'ibm866',
  28: 'windows-1250',
  29: 'windows-1251',
  30: 'windows-1252',
  31: 'gbk',
  32: 'windows-1253',
  33: 'windows-1254',
  34: 'windows-1255',
  35: 'windows-1256',
  36: 'windows-1257',
  37: 'windows-874',
  38: 'shift_jis',
  39: 'gbk',
  40: 'euc-kr',
  41: 'big5',
  42: 'euc-kr',
  44: 'windows-1258',
};

export function codePageDecoder(index: number): TextDecoder {
  const label = CODE_PAGES[index] ?? 'windows-1252';
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

const utf16 = new TextDecoder('utf-16le');

export interface Color {
  /** ACI index (0 BYBLOCK, 256 BYLAYER), or null for a true colour. */
  aci: number | null;
  /** 0xRRGGBB when a true colour. */
  rgb: number | null;
  /** The colour comes from a book (DBCOLOR object) through a handle. */
  book?: boolean;
}

export class BitReader {
  pos = 0;
  readonly end: number;
  private readonly f64 = new DataView(new ArrayBuffer(8));

  constructor(
    readonly buf: Uint8Array,
    /** Version number (1015, 1018, …) for version-dependent types. */
    readonly version: number,
    readonly decoder: TextDecoder = new TextDecoder('windows-1252'),
  ) {
    this.end = buf.length * 8;
  }

  clone(pos = this.pos): BitReader {
    const r = new BitReader(this.buf, this.version, this.decoder);
    r.pos = pos;
    return r;
  }

  private need(bits: number) {
    if (this.pos + bits > this.end || this.pos < 0) throw new CadReadError('This DWG file is damaged or truncated.');
  }

  get bytePos(): number {
    return this.pos >> 3;
  }
  set bytePos(b: number) {
    this.pos = b * 8;
  }

  B(): number {
    this.need(1);
    const v = (this.buf[this.pos >> 3]! >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }

  BB(): number {
    return (this.B() << 1) | this.B();
  }

  /** Three bits as a number (BLL length). */
  B3(): number {
    return (this.B() << 2) | (this.B() << 1) | this.B();
  }

  RC(): number {
    this.need(8);
    const i = this.pos >> 3;
    const s = this.pos & 7;
    this.pos += 8;
    if (!s) return this.buf[i]!;
    return ((this.buf[i]! << s) | (this.buf[i + 1]! >> (8 - s))) & 255;
  }

  bytes(n: number): Uint8Array {
    this.need(n * 8);
    if (!(this.pos & 7)) {
      const out = this.buf.subarray(this.pos >> 3, (this.pos >> 3) + n);
      this.pos += n * 8;
      return out;
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.RC();
    return out;
  }

  skipBytes(n: number) {
    this.need(n * 8);
    this.pos += n * 8;
  }

  RS(): number {
    const a = this.RC();
    const b = this.RC();
    const v = a | (b << 8);
    return v & 0x8000 ? v - 0x10000 : v;
  }

  RSu(): number {
    return this.RC() | (this.RC() << 8);
  }

  RL(): number {
    const a = this.RC();
    const b = this.RC();
    const c = this.RC();
    const d = this.RC();
    return (a | (b << 8) | (c << 16) | (d << 24)) | 0;
  }

  RLu(): number {
    return this.RL() >>> 0;
  }

  RD(): number {
    for (let i = 0; i < 8; i++) this.f64.setUint8(i, this.RC());
    return this.f64.getFloat64(0, true);
  }

  BS(): number {
    switch (this.BB()) {
      case 0:
        return this.RS();
      case 1:
        return this.RC();
      case 2:
        return 0;
      default:
        return 256;
    }
  }

  BL(): number {
    switch (this.BB()) {
      case 0:
        return this.RL();
      case 1:
        return this.RC();
      case 2:
        return 0;
      default:
        throw new CadReadError('This DWG file is damaged (bad bit long).');
    }
  }

  BLL(): number {
    const n = this.B3();
    let v = 0;
    for (let i = 0; i < n; i++) v += this.RC() * 2 ** (8 * i);
    return v;
  }

  BD(): number {
    switch (this.BB()) {
      case 0:
        return this.RD();
      case 1:
        return 1;
      case 2:
        return 0;
      default:
        throw new CadReadError('This DWG file is damaged (bad bit double).');
    }
  }

  /** Bit double with default: patches bytes of the default value. */
  DD(def: number): number {
    const code = this.BB();
    if (code === 0) return def;
    if (code === 3) return this.RD();
    this.f64.setFloat64(0, def, true);
    if (code === 1) {
      for (let i = 0; i < 4; i++) this.f64.setUint8(i, this.RC());
    } else {
      this.f64.setUint8(4, this.RC());
      this.f64.setUint8(5, this.RC());
      for (let i = 0; i < 4; i++) this.f64.setUint8(i, this.RC());
    }
    return this.f64.getFloat64(0, true);
  }

  RD2(): [number, number] {
    return [this.RD(), this.RD()];
  }
  BD2(): [number, number] {
    return [this.BD(), this.BD()];
  }
  BD3(): [number, number, number] {
    return [this.BD(), this.BD(), this.BD()];
  }
  DD2(d: readonly number[]): [number, number] {
    return [this.DD(d[0]!), this.DD(d[1]!)];
  }
  DD3(d: readonly number[]): [number, number, number] {
    return [this.DD(d[0]!), this.DD(d[1]!), this.DD(d[2]!)];
  }

  /** Extrusion (R2000+: one bit for 0,0,1). */
  BE(): [number, number, number] {
    return this.B() ? [0, 0, 1] : this.BD3();
  }

  /** Thickness (R2000+: one bit for 0). */
  BT(): number {
    return this.B() ? 0 : this.BD();
  }

  /** Modular char: 7 bits per byte, high bit continues. */
  MC(): number {
    let v = 0;
    let shift = 0;
    for (let i = 0; i < 9; i++) {
      const b = this.RC();
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) return v;
    }
    throw new CadReadError('This DWG file is damaged (bad modular char).');
  }

  /** Signed modular char: the last byte's 0x40 bit is the sign. */
  MCs(): number {
    let v = 0;
    let shift = 0;
    for (let i = 0; i < 9; i++) {
      const b = this.RC();
      if (b & 0x80) {
        v += (b & 0x7f) * 2 ** shift;
        shift += 7;
        continue;
      }
      v += (b & 0x3f) * 2 ** shift;
      return b & 0x40 ? -v : v;
    }
    throw new CadReadError('This DWG file is damaged (bad modular char).');
  }

  /** Modular short: 15 bits per two bytes, high bit continues. */
  MS(): number {
    let v = 0;
    let shift = 0;
    for (let i = 0; i < 4; i++) {
      const lo = this.RC();
      const hi = this.RC();
      v += (lo | ((hi & 0x7f) << 8)) * 2 ** shift;
      shift += 15;
      if (!(hi & 0x80)) return v;
    }
    throw new CadReadError('This DWG file is damaged (bad modular short).');
  }

  /** Handle reference, resolved against `ref` (the object's own handle) for relative codes. */
  H(ref = 0): number {
    const form = this.RC();
    const code = form >> 4;
    const n = form & 15;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.RC();
    switch (code) {
      case 6:
        return ref + 1;
      case 8:
        return ref - 1;
      case 0xa:
        return ref + v;
      case 0xc:
        return ref - v;
      default:
        return v;
    }
  }

  /** Variable text: code-page bytes before R2007, UTF-16 after. */
  TV(): string {
    const len = this.BS();
    if (len <= 0) return '';
    if (this.version >= R2007) return utf16.decode(this.bytes(len * 2)).replace(/\0+$/, '').replace(/\0/g, '');
    return this.decoder.decode(this.bytes(len)).replace(/\0+$/, '').replace(/\0/g, '');
  }

  /** Object type: a bit short before R2010, then a 2-bit-prefixed byte/short. */
  OT(): number {
    if (this.version < R2010) return this.BS();
    switch (this.BB()) {
      case 0:
        return this.RC();
      case 1:
        return 0x1f0 + this.RC();
      default:
        return this.RSu();
    }
  }

  /** Colour (CMC): a bit short before R2004; index, RGB and optional names after. `text` reads names. */
  CMC(text: BitReader = this): Color {
    const index = this.BS();
    if (this.version < R2004) return { aci: index, rgb: null };
    const rgb = this.BL() >>> 0;
    const flags = this.RC();
    if (flags & 1) text.TV();
    if (flags & 2) text.TV();
    const kind = rgb >>> 24;
    if (rgb === 0xc0000000 || kind === 0xc0) return { aci: 256, rgb: null };
    if (kind === 0xc1) return { aci: 0, rgb: null };
    if (kind === 0xc3 || kind === 0xc5) return { aci: rgb & 0xff, rgb: null };
    if (kind === 0xc2) return { aci: null, rgb: rgb & 0xffffff };
    return { aci: index || 7, rgb: null };
  }

  /** Entity colour (ENC, R2004+): flags and index, optional RGB and transparency. */
  ENC(): Color {
    const v = this.BS();
    if (this.version < R2004) return { aci: v, rgb: null };
    if (v === 0) return { aci: 0, rgb: null };
    const flags = v & 0xff00;
    let c: Color;
    if (flags & 0x4000) c = { aci: 0, rgb: null, book: true };
    else if (flags & 0x8000) c = { aci: null, rgb: (this.BL() >>> 0) & 0xffffff };
    else c = { aci: v & 0xfff, rgb: null };
    if (flags & 0x2000) this.BL();
    return c;
  }

  /** 16-byte sentinel (not checked). */
  sentinel() {
    this.skipBytes(16);
  }

  /** Aligns to the next byte. */
  align() {
    this.pos = (this.pos + 7) & ~7;
  }
}

/**
 * The string stream of an R2007+ object: located backwards from the end of its data, as the
 * spec's "string stream present" bit says. Returns a reader positioned at its start, or null.
 */
export function stringStream(r: BitReader, endBit: number): BitReader | null {
  const s = r.clone(endBit);
  if (!s.B()) return null;
  let at = endBit - 16;
  s.pos = at;
  let size = s.RSu();
  if (size & 0x8000) {
    at -= 16;
    s.pos = at;
    const hi = s.RSu();
    size = (size & 0x7fff) | (hi << 15);
  }
  s.pos = at - size;
  return s;
}
