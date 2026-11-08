import { CadReadError } from '../dxf';

/**
 * Copies `count` bytes from `offset` bytes back to `at`. When they overlap, the last `offset`
 * bytes repeat, as byte-by-byte copying would: done as non-overlapping runs of at most `offset`.
 */
export function backCopy(dst: Uint8Array, at: number, offset: number, count: number) {
  if (count > 0 && !(offset >= 1 && offset <= at && at + count <= dst.length)) throw new CadReadError('This DWG file is damaged (bad compressed page).');
  for (let done = 0; done < count; ) {
    const n = Math.min(offset, count - done);
    const from = at + done - offset;
    dst.copyWithin(at + done, from, from + n);
    done += n;
  }
}

/**
 * The LZ77 variant of R2004+ DWG section pages (ODA spec 4.7). Decompresses from `src` at `at`
 * into `dst` (a buffer of the page's decompressed size); returns the number of bytes written.
 */
export function lz77ac18(src: Uint8Array, at: number, dst: Uint8Array): number {
  let ip = at;
  let op = 0;
  const bad = () => new CadReadError('This DWG file is damaged (bad compressed page).');
  const next = () => {
    if (ip >= src.length) throw bad();
    return src[ip++]!;
  };
  const literal = (n: number) => {
    if (ip + n > src.length || op + n > dst.length) throw bad();
    dst.set(src.subarray(ip, ip + n), op);
    ip += n;
    op += n;
    return next();
  };
  const literalCount = (code: number) => {
    let n = code & 0x0f;
    if (n === 0) {
      let b = next();
      while (b === 0) {
        n += 0xff;
        b = next();
      }
      n += 0x0f + b;
    }
    return n;
  };
  const compressedCount = (op1: number, valid: number) => {
    let n = op1 & valid;
    if (n === 0) {
      let b = next();
      while (b === 0) {
        n += 0xff;
        b = next();
      }
      n += b + valid;
    }
    return n + 2;
  };

  let op1 = next();
  if (op1 > 0x11) op1 = literal(op1 - 17);
  if ((op1 & 0xf0) === 0) op1 = literal(literalCount(op1) + 3);
  while (op1 !== 0x11) {
    let count: number;
    let offset: number;
    if (op1 < 0x10 || op1 >= 0x40) {
      count = (op1 >> 4) - 1;
      const op2 = next();
      offset = (((op1 >> 2) & 3) | (op2 << 2)) + 1;
    } else if (op1 < 0x20) {
      count = compressedCount(op1, 0x07);
      offset = (op1 & 8) << 11;
      const b1 = next();
      offset |= b1 >> 2;
      offset |= next() << 6;
      offset += 0x4000;
      op1 = b1;
    } else {
      count = compressedCount(op1, 0x1f);
      const b1 = next();
      offset = (b1 >> 2) | (next() << 6);
      offset += 1;
      op1 = b1;
    }
    if (offset > op || op + count > dst.length) throw bad();
    backCopy(dst, op, offset, count);
    op += count;
    let lit = op1 & 3;
    if (lit === 0) {
      op1 = next();
      if ((op1 & 0xf0) === 0) lit = literalCount(op1) + 3;
    }
    if (lit > 0) op1 = literal(lit);
  }
  return op;
}
