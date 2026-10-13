/**
 * TIFF files for File › Export › Page Images (Preferences › Images › TIFF Compression and Create
 * Multi-Page TIFFs): colour, greyscale or black-and-white pages, uncompressed, LZW, or CCITT Group 4
 * (fax compression, black and white only). Little-endian, one strip per page.
 */

export type TiffCompression = 'ccittG4' | 'lzw' | 'none';
export type TiffColour = 'colour' | 'grey' | 'mono';

export interface TiffPage {
  width: number;
  height: number;
  /** RGBA pixels, as from a canvas. */
  rgba: Uint8ClampedArray;
}

const COMPRESSION = { none: 1, ccittG4: 4, lzw: 5 } as const;

/**
 * Pages as one TIFF. Group 4 is black and white only, so with it every page is made black and
 * white (at half brightness).
 */
export function encodeTiff(pages: readonly TiffPage[], o: TiffOptions): Uint8Array {
  const b = new TiffBuilder(o);
  for (const p of pages) b.add(p);
  return b.result();
}

export interface TiffOptions {
  compression: TiffCompression;
  colour: TiffColour;
  dpi: number;
}

/** Builds a TIFF a page at a time, keeping only each page's compressed data. */
export class TiffBuilder {
  private pages: { width: number; height: number; data: Uint8Array }[] = [];
  constructor(private o: TiffOptions) {}
  add(page: TiffPage) {
    this.pages.push({ width: page.width, height: page.height, data: pixelData(page, this.colour, this.o.compression) });
  }
  get count() {
    return this.pages.length;
  }
  private get colour(): TiffColour {
    return this.o.compression === 'ccittG4' ? 'mono' : this.o.colour;
  }
  result(): Uint8Array {
    return writeTiff(this.pages, this.colour, this.o);
  }
}

function writeTiff(pages: readonly { width: number; height: number; data: Uint8Array }[], colour: TiffColour, o: TiffOptions): Uint8Array {
  const out = new Writer();
  out.bytes([0x49, 0x49, 42, 0]);
  let linkAt = out.length;
  out.u32(0);
  for (const page of pages) {
    const data = page.data;
    if (out.length % 2) out.u8(0);
    const dataAt = out.length;
    out.bytes(data);
    if (out.length % 2) out.u8(0);
    // Values that do not fit in an entry: the bits per sample (colour) and the resolutions.
    const bitsAt = out.length;
    if (colour === 'colour') [8, 8, 8].forEach((b) => out.u16(b));
    const resAt = out.length;
    const dpi = Math.max(1, Math.round(o.dpi));
    out.u32(dpi);
    out.u32(1);
    const entries: [tag: number, type: 3 | 4 | 5, count: number, value: number][] = [
      [256, 4, 1, page.width],
      [257, 4, 1, page.height],
      [258, 3, colour === 'colour' ? 3 : 1, colour === 'colour' ? bitsAt : colour === 'grey' ? 8 : 1],
      [259, 3, 1, COMPRESSION[o.compression]],
      // Black and white: 0 is white; greyscale: 0 is black; else RGB.
      [262, 3, 1, colour === 'mono' ? 0 : colour === 'grey' ? 1 : 2],
      [273, 4, 1, dataAt],
      [277, 3, 1, colour === 'colour' ? 3 : 1],
      [278, 4, 1, page.height],
      [279, 4, 1, data.length],
      [282, 5, 1, resAt],
      [283, 5, 1, resAt],
      ...(o.compression === 'ccittG4' ? [[293, 4, 1, 0] as [number, 4, number, number]] : []),
      [296, 3, 1, 2],
    ];
    const ifdAt = out.length;
    out.setU32(linkAt, ifdAt);
    out.u16(entries.length);
    for (const [tag, type, count, value] of entries) {
      out.u16(tag);
      out.u16(type);
      out.u32(count);
      // A single SHORT sits in the first two bytes of the value field.
      if (type === 3 && count === 1) {
        out.u16(value);
        out.u16(0);
      } else out.u32(value);
    }
    linkAt = out.length;
    out.u32(0);
  }
  return out.result();
}

function pixelData(page: TiffPage, colour: TiffColour, compression: TiffCompression): Uint8Array {
  const { width, height, rgba } = page;
  const n = width * height;
  const lum = (i: number) => 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
  if (colour === 'mono') {
    // 1 is black (white is zero), rows padded to whole bytes.
    const black = new Uint8Array(n);
    for (let i = 0; i < n; i++) black[i] = lum(i) < 128 ? 1 : 0;
    if (compression === 'ccittG4') return encodeG4(black, width, height);
    const stride = Math.ceil(width / 8);
    const packed = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (black[y * width + x]) packed[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    return compression === 'lzw' ? encodeLzw(packed) : packed;
  }
  let raw: Uint8Array;
  if (colour === 'grey') {
    raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) raw[i] = Math.round(lum(i));
  } else {
    raw = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      raw[i * 3] = rgba[i * 4]!;
      raw[i * 3 + 1] = rgba[i * 4 + 1]!;
      raw[i * 3 + 2] = rgba[i * 4 + 2]!;
    }
  }
  return compression === 'lzw' ? encodeLzw(raw) : raw;
}

class Writer {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  private room(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  u8(v: number) {
    this.room(1);
    this.buf[this.length++] = v;
  }
  u16(v: number) {
    this.room(2);
    this.buf[this.length++] = v & 0xff;
    this.buf[this.length++] = (v >> 8) & 0xff;
  }
  u32(v: number) {
    this.room(4);
    this.setU32(this.length, v);
    this.length += 4;
  }
  setU32(at: number, v: number) {
    this.buf[at] = v & 0xff;
    this.buf[at + 1] = (v >>> 8) & 0xff;
    this.buf[at + 2] = (v >>> 16) & 0xff;
    this.buf[at + 3] = (v >>> 24) & 0xff;
  }
  bytes(b: ArrayLike<number>) {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  result() {
    return this.buf.slice(0, this.length);
  }
}

/** Codes written most significant bit first. */
class BitWriter {
  private out: number[] = [];
  private acc = 0;
  private n = 0;
  write(code: number, bits: number) {
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      if (++this.n === 8) {
        this.out.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  /** A code given as a string of 0s and 1s. */
  bitString(s: string) {
    for (const c of s) this.write(c === '1' ? 1 : 0, 1);
  }
  result(): Uint8Array {
    if (this.n) this.out.push(this.acc << (8 - this.n));
    return Uint8Array.from(this.out);
  }
}

// ---- LZW (TIFF 6.0 section 13, as libtiff writes it) ---------------------------------------------

const CLEAR = 256;
const EOI = 257;

export function encodeLzw(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  let bits = 9;
  let next = 258;
  let table = new Map<number, number>();
  const reset = () => {
    table = new Map();
    next = 258;
    bits = 9;
  };
  // After each new entry the code width grows once the next entry would not fit (libtiff's rule).
  const added = () => {
    next++;
    if (next === 4094) {
      w.write(CLEAR, bits);
      reset();
    } else if (next > (1 << bits) - 1) bits++;
  };
  w.write(CLEAR, bits);
  if (!data.length) {
    w.write(EOI, bits);
    return w.result();
  }
  let prefix = data[0]!;
  for (let i = 1; i < data.length; i++) {
    const c = data[i]!;
    const key = prefix * 256 + c;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    w.write(prefix, bits);
    table.set(key, next);
    added();
    prefix = c;
  }
  w.write(prefix, bits);
  added();
  w.write(EOI, bits);
  return w.result();
}

// ---- CCITT Group 4 (ITU-T T.6) ---------------------------------------------------------------------

const WHITE_TERM = '00110101 000111 0111 1000 1011 1100 1110 1111 10011 10100 00111 01000 001000 000011 110100 110101 101010 101011 0100111 0001100 0001000 0010111 0000011 0000100 0101000 0101011 0010011 0100100 0011000 00000010 00000011 00011010 00011011 00010010 00010011 00010100 00010101 00010110 00010111 00101000 00101001 00101010 00101011 00101100 00101101 00000100 00000101 00001010 00001011 01010010 01010011 01010100 01010101 00100100 00100101 01011000 01011001 01011010 01011011 01001010 01001011 00110010 00110011 00110100'.split(' ');
const BLACK_TERM = '0000110111 010 11 10 011 0011 0010 00011 000101 000100 0000100 0000101 0000111 00000100 00000111 000011000 0000010111 0000011000 0000001000 00001100111 00001101000 00001101100 00000110111 00000101000 00000010111 00000011000 000011001010 000011001011 000011001100 000011001101 000001101000 000001101001 000001101010 000001101011 000011010010 000011010011 000011010100 000011010101 000011010110 000011010111 000001101100 000001101101 000011011010 000011011011 000001010100 000001010101 000001010110 000001010111 000001100100 000001100101 000001010010 000001010011 000000100100 000000110111 000000111000 000000100111 000000101000 000001011000 000001011001 000000101011 000000101100 000001011010 000001100110 000001100111'.split(' ');
/** Make-up codes for 64, 128, … 1728. */
const WHITE_MAKEUP = '11011 10010 010111 0110111 00110110 00110111 01100100 01100101 01101000 01100111 011001100 011001101 011010010 011010011 011010100 011010101 011010110 011010111 011011000 011011001 011011010 011011011 010011000 010011001 010011010 011000 010011011'.split(' ');
const BLACK_MAKEUP = '0000001111 000011001000 000011001001 000001011011 000000110011 000000110100 000000110101 0000001101100 0000001101101 0000001001010 0000001001011 0000001001100 0000001001101 0000001110010 0000001110011 0000001110100 0000001110101 0000001110110 0000001110111 0000001010010 0000001010011 0000001010100 0000001010101 0000001011010 0000001011011 0000001100100 0000001100101'.split(' ');
/** Make-up codes for 1792, 1856, … 2560, the same for both colours. */
const EXTENDED_MAKEUP = '00000001000 00000001100 00000001101 000000010010 000000010011 000000010100 000000010101 000000010110 000000010111 000000011100 000000011101 000000011110 000000011111'.split(' ');
const VERTICAL: Record<number, string> = { [-3]: '0000010', [-2]: '000010', [-1]: '010', 0: '1', 1: '011', 2: '000011', 3: '0000011' };

function writeRun(w: BitWriter, run: number, black: boolean) {
  while (run >= 2560 + 64) {
    w.bitString(EXTENDED_MAKEUP[12]!);
    run -= 2560;
  }
  if (run >= 64) {
    const m = Math.floor(run / 64);
    w.bitString(m <= 27 ? (black ? BLACK_MAKEUP : WHITE_MAKEUP)[m - 1]! : EXTENDED_MAKEUP[m - 28]!);
    run -= m * 64;
  }
  w.bitString((black ? BLACK_TERM : WHITE_TERM)[run]!);
}

/** Where a row's colour changes: each x whose pixel differs from the one before (white before the row). */
function changes(row: Uint8Array): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let x = 0; x < row.length; x++) {
    if (row[x] !== prev) {
      out.push(x);
      prev = row[x]!;
    }
  }
  return out;
}

/** `pixels` (1 black, 0 white, row by row) coded as Group 4, ending with EOFB. */
export function encodeG4(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const w = new BitWriter();
  // The line above the first is white.
  let ref: number[] = [];
  for (let y = 0; y < height; y++) {
    const cur = changes(pixels.subarray(y * width, (y + 1) * width));
    // Changing elements past the end of a line sit at `width`.
    const at = (list: number[], i: number) => (i < list.length ? list[i]! : width);
    let a0 = -1;
    let black = false;
    // The first change right of a0 on each line. Changes alternate colour: even ones turn black.
    let ia = 0;
    let ib = 0;
    while (a0 < width) {
      while (ia < cur.length && cur[ia]! <= a0) ia++;
      while (ib < ref.length && ref[ib]! <= a0) ib++;
      const a1 = at(cur, ia);
      const a2 = at(cur, ia + 1);
      // b1: the first change on the line above, right of a0, to the colour opposite a0's.
      const i1 = ib + ((ib % 2 === 0) === !black ? 0 : 1);
      const b1 = at(ref, i1);
      const b2 = at(ref, i1 + 1);
      if (b2 < a1) {
        w.bitString('0001');
        a0 = b2;
      } else if (Math.abs(a1 - b1) <= 3) {
        w.bitString(VERTICAL[a1 - b1]!);
        a0 = a1;
        black = !black;
      } else {
        w.bitString('001');
        writeRun(w, a1 - Math.max(a0, 0), black);
        writeRun(w, a2 - a1, !black);
        a0 = a2;
      }
    }
    ref = cur;
  }
  // End of facsimile block: two EOLs.
  w.bitString('000000000001000000000001');
  return w.result();
}
