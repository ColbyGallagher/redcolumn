//! Image XObjects and inline images to straight-alpha RGBA.
//!
//! Handles 1–16 bit samples in grey, RGB, CMYK and indexed colour, /Decode arrays, stencil masks
//! (painted in the fill colour), soft masks, explicit masks and colour-key masks, and JPEG
//! (`DCTDecode`). JPEG 2000, CCITT and JBIG2 images are reported as unsupported.

use crate::Error;
use crate::color::{self, ColorSpace};
use crate::document::Document;
use crate::filter;
use crate::object::{Dict, Obj, Stream};

/// Largest image decoded (pixels); larger ones are left to PDFium.
const MAX_PIXELS: u64 = 400_000_000;

pub struct Decoded {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

fn int(doc: &Document, d: &Dict, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|k| doc.dict_get(d, k)).and_then(|o| o.as_i64())
}

/// The last filter's name, if it is an image codec.
fn image_filter(doc: &Document, d: &Dict) -> Option<Vec<u8>> {
    let f = keys_get(doc, d, &["Filter", "F"])?;
    let last = match f.as_ref() {
        Obj::Name(n) => n.as_bytes().to_vec(),
        Obj::Array(a) => a.last()?.as_name()?.as_bytes().to_vec(),
        _ => return None,
    };
    filter::is_image_filter(&last).then_some(last)
}

fn keys_get(doc: &Document, d: &Dict, keys: &[&str]) -> Option<std::sync::Arc<Obj>> {
    keys.iter().find_map(|k| doc.dict_get(d, k))
}

/// Decodes an image stream. `fill` is the fill colour, for stencil masks.
pub fn decode(doc: &Document, s: &Stream, resources: &Dict, fill: [u8; 3]) -> Result<Decoded, Error> {
    let d = &s.dict;
    let width = int(doc, d, &["Width", "W"]).unwrap_or(0).max(0) as u32;
    let height = int(doc, d, &["Height", "H"]).unwrap_or(0).max(0) as u32;
    if width == 0 || height == 0 {
        return Err(Error::Damaged("image without a size".into()));
    }
    if width as u64 * height as u64 > MAX_PIXELS {
        return Err(Error::Unsupported("very large image".into()));
    }
    let n = (width * height) as usize;
    let mask = keys_get(doc, d, &["ImageMask", "IM"])
        .and_then(|o| o.as_bool())
        .unwrap_or(false);
    let decode_arr: Option<Vec<f32>> = keys_get(doc, d, &["Decode", "D"]).and_then(|o| {
        o.as_array()
            .map(|a| a.iter().filter_map(|v| doc.resolve(v).as_f32()).collect())
    });
    let codec = image_filter(doc, d);
    let mut rgba = vec![0u8; n * 4];

    if mask {
        let bits = doc.decode(s)?;
        let invert = decode_arr.as_ref().is_some_and(|a| a.first() == Some(&1.0));
        let row = (width as usize).div_ceil(8);
        for y in 0..height as usize {
            for x in 0..width as usize {
                let byte = bits.get(y * row + x / 8).copied().unwrap_or(0xff);
                let bit = byte >> (7 - x % 8) & 1;
                // Sample 0 paints (with the default Decode [0 1]).
                let paint = (bit == 0) != invert;
                let o = (y * width as usize + x) * 4;
                if paint {
                    rgba[o..o + 4].copy_from_slice(&[fill[0], fill[1], fill[2], 255]);
                }
            }
        }
        return Ok(Decoded { width, height, rgba });
    }

    let cs_obj = keys_get(doc, d, &["ColorSpace", "CS"]);
    match codec.as_deref() {
        Some(b"DCTDecode" | b"DCT") => {
            let data = doc.decode(s)?;
            let (w, h, rgb) = jpeg(&data)?;
            if (w, h) != (width, height) {
                return Err(Error::Damaged("JPEG size differs from the image dictionary".into()));
            }
            for i in 0..n {
                rgba[i * 4..i * 4 + 3].copy_from_slice(&rgb[i * 3..i * 3 + 3]);
                rgba[i * 4 + 3] = 255;
            }
        }
        Some(other) => {
            return Err(Error::Unsupported(format!(
                "image filter {}",
                String::from_utf8_lossy(other)
            )));
        }
        None => {
            let cs = match &cs_obj {
                Some(o) => color::resolve(doc, o, resources, 0),
                None => return Err(Error::Damaged("image without a colour space".into())),
            };
            if matches!(cs, ColorSpace::Pattern | ColorSpace::Unsupported(_)) {
                return Err(Error::Unsupported("image colour space".into()));
            }
            let bpc = int(doc, d, &["BitsPerComponent", "BPC"]).unwrap_or(8) as u32;
            if !matches!(bpc, 1 | 2 | 4 | 8 | 16) {
                return Err(Error::Damaged("image bits per component".into()));
            }
            let data = doc.decode(s)?;
            let comps = cs.components();
            let indexed = matches!(cs, ColorSpace::Indexed { .. });
            let max = ((1u32 << bpc) - 1) as f32;
            let ranges: Vec<(f32, f32)> = (0..comps)
                .map(|c| match &decode_arr {
                    Some(a) if a.len() >= 2 * comps => (a[2 * c], a[2 * c + 1]),
                    _ if indexed => (0.0, max),
                    _ => (0.0, 1.0),
                })
                .collect();
            let row_bits = width as usize * comps * bpc as usize;
            let row = row_bits.div_ceil(8);
            let mut vals = vec![0f32; comps];
            // A palette cache for the common 8-bit case.
            for y in 0..height as usize {
                let rb = &data.get(y * row..).unwrap_or(&[]);
                for x in 0..width as usize {
                    for c in 0..comps {
                        let raw = sample(rb, (x * comps + c) * bpc as usize, bpc);
                        let (lo, hi) = ranges[c];
                        vals[c] = lo + raw as f32 * (hi - lo) / max;
                    }
                    let rgb = cs.to_rgb(&vals).unwrap_or([0, 0, 0]);
                    let o = (y * width as usize + x) * 4;
                    rgba[o..o + 3].copy_from_slice(&rgb);
                    rgba[o + 3] = 255;
                }
            }
            // A colour-key mask: samples in every range are transparent.
            if let Some(Obj::Array(key)) = keys_get(doc, d, &["Mask"]).as_deref() {
                let key: Vec<u32> = key.iter().filter_map(|o| o.as_i64()).map(|v| v as u32).collect();
                if key.len() >= 2 * comps {
                    for y in 0..height as usize {
                        let rb = data.get(y * row..).unwrap_or(&[]);
                        for x in 0..width as usize {
                            let inside = (0..comps).all(|c| {
                                let v = sample(rb, (x * comps + c) * bpc as usize, bpc);
                                v >= key[2 * c] && v <= key[2 * c + 1]
                            });
                            if inside {
                                rgba[(y * width as usize + x) * 4 + 3] = 0;
                            }
                        }
                    }
                }
            }
        }
    }

    // Soft mask, or an explicit (stencil) mask.
    if let Some(sm) = keys_get(doc, d, &["SMask"]) {
        if let Obj::Stream(sm) = sm.as_ref() {
            let a = alpha(doc, sm, false)?;
            apply_alpha(&mut rgba, width, height, &a);
        }
    } else if let Some(m) = keys_get(doc, d, &["Mask"])
        && let Obj::Stream(m) = m.as_ref()
    {
        let a = alpha(doc, m, true)?;
        apply_alpha(&mut rgba, width, height, &a);
    }
    Ok(Decoded { width, height, rgba })
}

/// A mask image as (width, height, alpha per pixel). A stencil (`/ImageMask`) mask hides where
/// its samples are 1.
fn alpha(doc: &Document, s: &Stream, stencil: bool) -> Result<(u32, u32, Vec<u8>), Error> {
    if stencil {
        let m = decode(doc, s, &Dict::default(), [0, 0, 0])?;
        // decode() painted where the stencil would paint (sample 0): those are the visible pixels.
        let a: Vec<u8> = m.rgba.chunks(4).map(|p| p[3]).collect();
        return Ok((m.width, m.height, a));
    }
    let m = decode(doc, s, &Dict::default(), [0, 0, 0])?;
    let a: Vec<u8> = m.rgba.chunks(4).map(|p| p[0]).collect();
    Ok((m.width, m.height, a))
}

fn apply_alpha(rgba: &mut [u8], w: u32, h: u32, (mw, mh, a): &(u32, u32, Vec<u8>)) {
    for y in 0..h {
        let my = (y as u64 * *mh as u64 / h as u64) as u32;
        for x in 0..w {
            let mx = (x as u64 * *mw as u64 / w as u64) as u32;
            let v = a.get((my * mw + mx) as usize).copied().unwrap_or(255);
            let o = ((y * w + x) * 4 + 3) as usize;
            rgba[o] = ((rgba[o] as u32 * v as u32 + 127) / 255) as u8;
        }
    }
}

fn sample(row: &[u8], bit: usize, bpc: u32) -> u32 {
    match bpc {
        8 => row.get(bit / 8).copied().unwrap_or(0) as u32,
        16 => {
            let i = bit / 8;
            (row.get(i).copied().unwrap_or(0) as u32) << 8 | row.get(i + 1).copied().unwrap_or(0) as u32
        }
        _ => {
            let byte = row.get(bit / 8).copied().unwrap_or(0) as u32;
            let shift = 8 - bpc - (bit % 8) as u32;
            (byte >> shift) & ((1 << bpc) - 1)
        }
    }
}

/// A JPEG as 8-bit RGB.
pub fn jpeg(data: &[u8]) -> Result<(u32, u32, Vec<u8>), Error> {
    use zune_jpeg::zune_core::colorspace::ColorSpace as Zcs;
    use zune_jpeg::zune_core::options::DecoderOptions;
    let opts = DecoderOptions::default()
        .jpeg_set_out_colorspace(Zcs::RGB)
        .set_max_width(1 << 16)
        .set_max_height(1 << 16);
    let mut dec = zune_jpeg::JpegDecoder::new_with_options(data, opts);
    let px = dec.decode().map_err(|e| Error::Damaged(format!("JPEG: {e:?}")))?;
    let info = dec
        .info()
        .ok_or_else(|| Error::Damaged("JPEG without a header".into()))?;
    let (w, h) = (info.width as u32, info.height as u32);
    if px.len() == (w * h * 3) as usize {
        return Ok((w, h, px));
    }
    // Some colour spaces come back as is (CMYK): convert.
    match dec.get_output_colorspace() {
        Some(Zcs::CMYK) if px.len() == (w * h * 4) as usize => {
            let rgb = px
                .chunks(4)
                .flat_map(|p| {
                    // Adobe JPEGs store CMYK inverted.
                    let f = |v: u8| 1.0 - v as f32 / 255.0;
                    color::cmyk_to_rgb(f(p[0]), f(p[1]), f(p[2]), f(p[3]))
                })
                .collect();
            Ok((w, h, rgb))
        }
        Some(Zcs::Luma) if px.len() == (w * h) as usize => Ok((w, h, px.iter().flat_map(|&g| [g, g, g]).collect())),
        cs => Err(Error::Unsupported(format!("JPEG colour space {cs:?}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples() {
        assert_eq!(sample(&[0b1011_0001], 0, 1), 1);
        assert_eq!(sample(&[0b1011_0001], 1, 1), 0);
        assert_eq!(sample(&[0b1011_0001], 4, 4), 1);
        assert_eq!(sample(&[0x12, 0x34], 0, 16), 0x1234);
        assert_eq!(sample(&[0b1110_0100], 2, 2), 0b10);
    }
}
