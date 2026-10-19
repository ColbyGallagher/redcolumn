//! Stream filters: Flate (with PNG and TIFF predictors), LZW, ASCIIHex, ASCII85 and RunLength.
//! Image-only filters (DCT, JPX, CCITT, JBIG2) are left to the image decoder.

use crate::Error;
use crate::object::{Dict, Obj};
use std::io::Read;

/// Applies one filter. Damaged Flate data yields what decoded before the damage, as other readers
/// do, rather than nothing.
pub fn apply(name: &[u8], data: &[u8], parms: Option<&Dict>) -> Result<Vec<u8>, Error> {
    let out = match name {
        b"FlateDecode" | b"Fl" => inflate(data),
        b"LZWDecode" | b"LZW" => {
            let early = parms
                .and_then(|p| p.get("EarlyChange"))
                .and_then(Obj::as_i64)
                .unwrap_or(1);
            lzw(data, early != 0)
        }
        b"ASCIIHexDecode" | b"AHx" => ascii_hex(data),
        b"ASCII85Decode" | b"A85" => ascii85(data),
        b"RunLengthDecode" | b"RL" => run_length(data),
        b"Crypt" => data.to_vec(),
        other => return Err(Error::Unsupported(format!("filter {}", String::from_utf8_lossy(other)))),
    };
    match parms {
        Some(p) if matches!(name, b"FlateDecode" | b"Fl" | b"LZWDecode" | b"LZW") => predict(out, p),
        _ => Ok(out),
    }
}

/// Whether a filter is decoded by the image decoder, not here.
pub fn is_image_filter(name: &[u8]) -> bool {
    matches!(
        name,
        b"DCTDecode" | b"DCT" | b"JPXDecode" | b"CCITTFaxDecode" | b"CCF" | b"JBIG2Decode"
    )
}

pub fn inflate(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() * 4);
    // zlib first; some writers emit raw deflate.
    let mut z = flate2::read::ZlibDecoder::new(data);
    if z.read_to_end(&mut out).is_ok() || !out.is_empty() {
        return out;
    }
    out.clear();
    let mut d = flate2::read::DeflateDecoder::new(data);
    let _ = d.read_to_end(&mut out);
    out
}

fn predict(data: Vec<u8>, p: &Dict) -> Result<Vec<u8>, Error> {
    let predictor = p.get("Predictor").and_then(Obj::as_i64).unwrap_or(1);
    if predictor <= 1 {
        return Ok(data);
    }
    let colors = p.get("Colors").and_then(Obj::as_i64).unwrap_or(1).clamp(1, 32) as usize;
    let bpc = p
        .get("BitsPerComponent")
        .and_then(Obj::as_i64)
        .unwrap_or(8)
        .clamp(1, 16) as usize;
    let columns = p.get("Columns").and_then(Obj::as_i64).unwrap_or(1).clamp(1, 1 << 24) as usize;
    let bpp = (colors * bpc).div_ceil(8);
    let row = (colors * bpc * columns).div_ceil(8);
    if predictor == 2 {
        // TIFF predictor 2, 8-bit components only (what files use in practice).
        let mut out = data;
        if bpc == 8 {
            for r in out.chunks_mut(row) {
                for i in bpp..r.len() {
                    r[i] = r[i].wrapping_add(r[i - bpp]);
                }
            }
        }
        return Ok(out);
    }
    // PNG predictors: each row starts with its filter type.
    let mut out = Vec::with_capacity(data.len());
    let mut prev = vec![0u8; row];
    let mut cur = vec![0u8; row];
    for chunk in data.chunks(row + 1) {
        if chunk.len() < 2 {
            break;
        }
        let ty = chunk[0];
        let src = &chunk[1..];
        cur[..src.len()].copy_from_slice(src);
        cur[src.len()..].fill(0);
        for i in 0..row {
            let a = if i >= bpp { cur[i - bpp] } else { 0 };
            let b = prev[i];
            let c = if i >= bpp { prev[i - bpp] } else { 0 };
            cur[i] = match ty {
                1 => cur[i].wrapping_add(a),
                2 => cur[i].wrapping_add(b),
                3 => cur[i].wrapping_add(((a as u16 + b as u16) / 2) as u8),
                4 => {
                    let p = a as i16 + b as i16 - c as i16;
                    let (pa, pb, pc) = ((p - a as i16).abs(), (p - b as i16).abs(), (p - c as i16).abs());
                    let pred = if pa <= pb && pa <= pc {
                        a
                    } else if pb <= pc {
                        b
                    } else {
                        c
                    };
                    cur[i].wrapping_add(pred)
                }
                _ => cur[i],
            };
        }
        out.extend_from_slice(&cur[..src.len().min(row)]);
        std::mem::swap(&mut prev, &mut cur);
    }
    Ok(out)
}

fn lzw(data: &[u8], early: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() * 3);
    let mut table: Vec<Vec<u8>> = (0..256u16).map(|i| vec![i as u8]).collect();
    table.push(Vec::new());
    table.push(Vec::new());
    let mut width = 9;
    let mut prev: Option<usize> = None;
    let (mut acc, mut bits) = (0u32, 0u32);
    for &byte in data {
        acc = acc << 8 | byte as u32;
        bits += 8;
        while bits >= width {
            let code = ((acc >> (bits - width)) & ((1 << width) - 1)) as usize;
            bits -= width;
            match code {
                256 => {
                    table.truncate(258);
                    width = 9;
                    prev = None;
                    continue;
                }
                257 => return out,
                _ => {}
            }
            let entry = if code < table.len() {
                table[code].clone()
            } else if let Some(p) = prev {
                let mut e = table[p].clone();
                e.push(table[p][0]);
                e
            } else {
                return out;
            };
            out.extend_from_slice(&entry);
            if let Some(p) = prev
                && table.len() < 4096
            {
                let mut e = table[p].clone();
                e.push(entry[0]);
                table.push(e);
            }
            prev = Some(code);
            let next = table.len() + early as usize;
            width = if next >= 2048 {
                12
            } else if next >= 1024 {
                11
            } else if next >= 512 {
                10
            } else {
                9
            };
        }
    }
    out
}

fn ascii_hex(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() / 2);
    let mut hi: Option<u8> = None;
    for &c in data {
        if c == b'>' {
            break;
        }
        let Some(v) = (c as char).to_digit(16) else { continue };
        match hi.take() {
            Some(h) => out.push(h << 4 | v as u8),
            None => hi = Some(v as u8),
        }
    }
    if let Some(h) = hi {
        out.push(h << 4);
    }
    out
}

fn ascii85(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() * 4 / 5);
    let mut group = [0u8; 5];
    let mut n = 0;
    let data = data.strip_prefix(b"<~").unwrap_or(data);
    for &c in data {
        match c {
            b'~' => break,
            b'z' if n == 0 => out.extend_from_slice(&[0; 4]),
            b'!'..=b'u' => {
                group[n] = c - b'!';
                n += 1;
                if n == 5 {
                    let v = group.iter().fold(0u64, |a, &d| a * 85 + d as u64) as u32;
                    out.extend_from_slice(&v.to_be_bytes());
                    n = 0;
                }
            }
            _ => {}
        }
    }
    if n > 1 {
        for g in group.iter_mut().skip(n) {
            *g = 84;
        }
        let v = group.iter().fold(0u64, |a, &d| a * 85 + d as u64) as u32;
        out.extend_from_slice(&v.to_be_bytes()[..n - 1]);
    }
    out
}

fn run_length(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() * 2);
    let mut i = 0;
    while i < data.len() {
        let l = data[i];
        i += 1;
        match l {
            128 => break,
            0..=127 => {
                let n = l as usize + 1;
                out.extend_from_slice(&data[i..(i + n).min(data.len())]);
                i += n;
            }
            _ => {
                if let Some(&b) = data.get(i) {
                    out.extend(std::iter::repeat_n(b, 257 - l as usize));
                }
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_filters() {
        assert_eq!(ascii_hex(b"48 65 6c6C6f>"), b"Hello");
        assert_eq!(ascii85(b"<~87cURD]i,\"Ebo80~>"), b"Hello World!");
        assert_eq!(run_length(&[2, b'a', b'b', b'c', 254, b'x', 128]), b"abcxxx");
        // "TOBEORNOT" LZW-encoded, as in the PDF reference.
        let lz = [0x80, 0x0B, 0x60, 0x50, 0x22, 0x0C, 0x0C, 0x85, 0x01];
        assert_eq!(&lzw(&lz, true)[..], &b"-----A---B"[..]);
    }

    #[test]
    fn png_up_predictor() {
        let parms = crate::object::Lexer::new(b"<< /Predictor 12 /Columns 3 >>", 0)
            .object()
            .unwrap();
        let data = vec![2, 1, 2, 3, 2, 1, 1, 1];
        let out = predict(data, parms.as_dict().unwrap()).unwrap();
        assert_eq!(out, vec![1, 2, 3, 2, 3, 4]);
    }
}
