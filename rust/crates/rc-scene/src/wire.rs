//! A flat binary encoding of [`PageContent`], for passing it between processes and caching it.
//!
//! Sections are written in a fixed order, each as a little-endian `u64` byte length followed by
//! the raw bytes of a `Pod` slice, so decoding is a handful of copies with no per-item parsing.

use crate::content::{Affine, ClipNode, Image, Item, PageContent};
use bytemuck::Pod;

const MAGIC: &[u8; 8] = b"RCPAGE01";

#[derive(Debug, thiserror::Error)]
pub enum WireError {
    #[error("not page content (bad header)")]
    BadHeader,
    #[error("page content is truncated")]
    Truncated,
    #[error("page content is inconsistent: {0}")]
    Invalid(&'static str),
}

pub fn encode(c: &PageContent) -> Vec<u8> {
    let image_bytes: usize = c.images.iter().map(|i| i.rgba.len() + 96).sum();
    let mut out = Vec::with_capacity(
        64 + c.items.len() * size_of::<Item>()
            + c.verbs.len()
            + c.points.len() * 8
            + c.dashes.len() * 4
            + c.clips.len() * size_of::<ClipNode>()
            + image_bytes,
    );
    out.extend_from_slice(MAGIC);
    put_slice(&mut out, &c.size);
    put_slice(&mut out, &[c.flags]);
    put_slice(&mut out, &c.items);
    put_slice(&mut out, &c.verbs);
    put_slice(&mut out, &c.points);
    put_slice(&mut out, &c.dashes);
    put_slice(&mut out, &c.clips);
    put_slice(&mut out, &c.clip_verbs);
    put_slice(&mut out, &c.clip_points);
    put_slice(&mut out, &c.layers_off);
    put_slice(&mut out, &[c.slot_base, c.slot_total]);
    put_slice(&mut out, &[c.images.len() as u64]);
    for img in &c.images {
        put_slice(&mut out, &[img.width, img.height, img.smooth as u32]);
        put_slice(&mut out, &[img.opacity]);
        put_slice(&mut out, &[img.transform]);
        put_slice(&mut out, &img.rgba);
    }
    put_slice(&mut out, &[c.layers.len() as u64]);
    for l in &c.layers {
        put_slice(&mut out, l.as_bytes());
    }
    out
}

pub fn decode(bytes: &[u8]) -> Result<PageContent, WireError> {
    if bytes.len() < 8 || &bytes[..8] != MAGIC {
        return Err(WireError::BadHeader);
    }
    let mut r = Reader { b: &bytes[8..] };
    let size: Vec<f32> = r.slice()?;
    let flags: Vec<u32> = r.slice()?;
    let mut c = PageContent {
        size: [*size.first().ok_or(WireError::Truncated)?, *size.get(1).ok_or(WireError::Truncated)?],
        flags: *flags.first().ok_or(WireError::Truncated)?,
        items: r.slice()?,
        verbs: r.slice()?,
        points: r.slice()?,
        dashes: r.slice()?,
        clips: r.slice()?,
        clip_verbs: r.slice()?,
        clip_points: r.slice()?,
        layers_off: r.slice()?,
        ..Default::default()
    };
    let slots: Vec<u32> = r.slice()?;
    let (&[base, total],) = (&slots[..],) else { return Err(WireError::Truncated) };
    c.slot_base = base;
    c.slot_total = total;
    let n: Vec<u64> = r.slice()?;
    for _ in 0..*n.first().ok_or(WireError::Truncated)? {
        let dims: Vec<u32> = r.slice()?;
        let opacity: Vec<f32> = r.slice()?;
        let transform: Vec<Affine> = r.slice()?;
        let rgba: Vec<u8> = r.slice()?;
        let (&[w, h, smooth], &[opacity], &[transform]) = (&dims[..], &opacity[..], &transform[..]) else {
            return Err(WireError::Truncated);
        };
        if rgba.len() != w as usize * h as usize * 4 {
            return Err(WireError::Invalid("image size"));
        }
        c.images.push(Image { width: w, height: h, rgba, transform, opacity, smooth: smooth != 0 });
    }
    let n: Vec<u64> = r.slice()?;
    for _ in 0..*n.first().ok_or(WireError::Truncated)? {
        let s: Vec<u8> = r.slice()?;
        c.layers.push(String::from_utf8_lossy(&s).into_owned());
    }
    validate(&c)?;
    Ok(c)
}

/// Checks every index in the content is in range, so later code can index without checks
/// failing on content from a crashed or confused worker.
pub fn validate(c: &PageContent) -> Result<(), WireError> {
    let range_ok = |verbs: &[u8], points: &[[f32; 2]], vs: u32, vl: u32, ps: u32| -> bool {
        let Some(end) = vs.checked_add(vl) else { return false };
        if end as usize > verbs.len() {
            return false;
        }
        let pts: usize = verbs[vs as usize..end as usize].iter().map(|&v| crate::content::verb_points(v)).sum();
        (ps as usize).checked_add(pts).is_some_and(|e| e <= points.len())
    };
    let path_ok = |vs: u32, vl: u32, ps: u32| range_ok(&c.verbs, &c.points, vs, vl, ps);
    let clip_ok = |vs: u32, vl: u32, ps: u32| range_ok(&c.clip_verbs, &c.clip_points, vs, vl, ps);
    for it in &c.items {
        match it.kind {
            crate::content::kind::PATH => {
                if !path_ok(it.verb_start, it.verb_len, it.point_start) {
                    return Err(WireError::Invalid("item path range"));
                }
                if it.dash_len > 0 && (it.dash_start as usize + it.dash_len as usize) > c.dashes.len() {
                    return Err(WireError::Invalid("dash range"));
                }
            }
            crate::content::kind::IMAGE => {
                if it.image as usize >= c.images.len() {
                    return Err(WireError::Invalid("image index"));
                }
            }
            _ => return Err(WireError::Invalid("item kind")),
        }
        if it.clip != crate::content::NONE && it.clip as usize >= c.clips.len() {
            return Err(WireError::Invalid("clip index"));
        }
        if it.layer != crate::content::NONE && it.layer as usize >= c.layers.len() {
            return Err(WireError::Invalid("layer index"));
        }
    }
    if c.layers_off.iter().any(|&l| l as usize >= c.layers.len()) {
        return Err(WireError::Invalid("layer index"));
    }
    for (i, cl) in c.clips.iter().enumerate() {
        if !clip_ok(cl.verb_start, cl.verb_len, cl.point_start) {
            return Err(WireError::Invalid("clip path range"));
        }
        // Parents come first, so chains always end.
        if cl.parent != crate::content::NONE && cl.parent as usize >= i {
            return Err(WireError::Invalid("clip parent"));
        }
    }
    Ok(())
}

fn put_slice<T: Pod>(out: &mut Vec<u8>, s: &[T]) {
    let bytes: &[u8] = bytemuck::cast_slice(s);
    out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    out.extend_from_slice(bytes);
}

struct Reader<'a> {
    b: &'a [u8],
}

impl Reader<'_> {
    fn slice<T: Pod>(&mut self) -> Result<Vec<T>, WireError> {
        if self.b.len() < 8 {
            return Err(WireError::Truncated);
        }
        let n = u64::from_le_bytes(self.b[..8].try_into().unwrap()) as usize;
        let rest = &self.b[8..];
        if n > rest.len() || n % size_of::<T>() != 0 {
            return Err(WireError::Truncated);
        }
        let (data, rest) = rest.split_at(n);
        self.b = rest;
        // The input may not be aligned for T: copy through a zeroed, aligned buffer.
        let mut v: Vec<T> = vec![T::zeroed(); n / size_of::<T>()];
        bytemuck::cast_slice_mut::<T, u8>(&mut v).copy_from_slice(data);
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::*;

    #[test]
    fn round_trip() {
        let mut b = ContentBuilder::new([595.0, 842.0]);
        let s = b.begin_path();
        b.move_to([1.0, 2.0]);
        b.line_to([3.0, 4.0]);
        let layer = b.layer("A-WALL");
        b.finish_path(s, Item { stroked: 1, width: 0.5, stroke_color: rgba(1, 2, 3, 255), layer, clip: NONE, ..Default::default() });
        let s = b.begin_path();
        b.move_to([0.0, 0.0]);
        b.line_to([10.0, 0.0]);
        b.line_to([10.0, 10.0]);
        b.close();
        let clip = b.finish_clip(s, fill::NONZERO, NONE);
        b.add_image(
            Image { width: 1, height: 1, rgba: vec![9, 8, 7, 255], transform: Affine::IDENTITY, opacity: 0.5, smooth: true },
            clip,
            NONE,
        );
        let c = b.finish();
        let bytes = encode(&c);
        assert_eq!(decode(&bytes).unwrap(), c);
        assert!(matches!(decode(&bytes[..bytes.len() - 3]), Err(_)));
    }

    #[test]
    fn rejects_bad_indices() {
        let mut c = PageContent { size: [1.0, 1.0], ..Default::default() };
        c.items.push(Item { verb_len: 5, clip: NONE, layer: NONE, ..Default::default() });
        assert!(decode(&encode(&c)).is_err());
    }
}
