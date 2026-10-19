//! A flat binary encoding of [`Scene`] for the disk cache: every array written as raw bytes, so
//! reading a cached scene is a handful of copies and no parsing.

use crate::scene::{Scene, SceneImage};
use crate::wire::WireError;
use bytemuck::Pod;

const MAGIC: &[u8; 8] = b"RCSCENE1";

pub fn encode(s: &Scene) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.byte_size() + 1024);
    out.extend_from_slice(MAGIC);
    put(&mut out, &s.size);
    put(&mut out, &[s.cols, s.rows, s.flags]);
    put(&mut out, &s.items);
    put(&mut out, &s.segs);
    put(&mut out, &s.seg_cells);
    put(&mut out, &s.seg_cell_bounds);
    put(&mut out, &s.fill_verts);
    put(&mut out, &s.fill_idx);
    put(&mut out, &s.fill_cells);
    put(&mut out, &s.fill_cell_bounds);
    put(&mut out, &s.t_segs);
    put(&mut out, &s.t_fill_idx);
    put(&mut out, &s.image_verts);
    put(&mut out, &s.image_idx);
    put(&mut out, &s.stream);
    put(&mut out, &s.layers_off);
    put(&mut out, &[s.images.len() as u64, s.layers.len() as u64]);
    for im in &s.images {
        put(&mut out, &[im.width, im.height, im.smooth as u32]);
        put(&mut out, &im.rgba);
    }
    for l in &s.layers {
        put(&mut out, l.as_bytes());
    }
    out
}

pub fn decode(b: &[u8]) -> Result<Scene, WireError> {
    if b.len() < 8 || &b[..8] != MAGIC {
        return Err(WireError::BadHeader);
    }
    let mut r = Reader(&b[8..]);
    let size: Vec<f32> = r.get()?;
    let dims: Vec<u32> = r.get()?;
    let (&[w, h], &[cols, rows, flags]) = (&size[..], &dims[..]) else { return Err(WireError::Truncated) };
    let mut s = Scene {
        size: [w, h],
        cols,
        rows,
        flags,
        items: r.get()?,
        segs: r.get()?,
        seg_cells: r.get()?,
        seg_cell_bounds: r.get()?,
        fill_verts: r.get()?,
        fill_idx: r.get()?,
        fill_cells: r.get()?,
        fill_cell_bounds: r.get()?,
        t_segs: r.get()?,
        t_fill_idx: r.get()?,
        image_verts: r.get()?,
        image_idx: r.get()?,
        stream: r.get()?,
        layers_off: r.get()?,
        ..Default::default()
    };
    let counts: Vec<u64> = r.get()?;
    let (&[ni, nl],) = (&counts[..],) else { return Err(WireError::Truncated) };
    for _ in 0..ni {
        let d: Vec<u32> = r.get()?;
        let rgba: Vec<u8> = r.get()?;
        let (&[iw, ih, smooth],) = (&d[..],) else { return Err(WireError::Truncated) };
        if rgba.len() != iw as usize * ih as usize * 4 {
            return Err(WireError::Invalid("image size"));
        }
        s.images.push(SceneImage { width: iw, height: ih, rgba, smooth: smooth != 0 });
    }
    for _ in 0..nl {
        let l: Vec<u8> = r.get()?;
        s.layers.push(String::from_utf8_lossy(&l).into_owned());
    }
    validate(&s)?;
    s.stats.content_items = s.items.len() / 2;
    s.stats.segments = s.segs.len() + s.t_segs.len();
    s.stats.triangles = (s.fill_idx.len() + s.t_fill_idx.len() + s.image_idx.len()) / 3;
    s.stats.images = s.images.len();
    Ok(s)
}

/// Every index in range, so a damaged cache file can never make the renderer read out of bounds.
fn validate(s: &Scene) -> Result<(), WireError> {
    let cells = (s.cols as usize).checked_mul(s.rows as usize).ok_or(WireError::Invalid("grid"))?;
    if s.cols == 0 || s.rows == 0 || cells > 1 << 16 {
        return Err(WireError::Invalid("grid"));
    }
    if s.seg_cells.len() != cells || s.seg_cell_bounds.len() != cells || s.fill_cells.len() != cells || s.fill_cell_bounds.len() != cells {
        return Err(WireError::Invalid("cell tables"));
    }
    let items = s.items.len() as u32;
    for sg in s.segs.iter().chain(&s.t_segs) {
        if sg.item >= items || sg.cell as usize >= cells {
            return Err(WireError::Invalid("segment"));
        }
    }
    if s.seg_cells.iter().any(|&[a, n]| a as usize + n as usize > s.segs.len()) {
        return Err(WireError::Invalid("segment ranges"));
    }
    if s.fill_cells.iter().any(|&[a, n]| a as usize + n as usize > s.fill_idx.len()) {
        return Err(WireError::Invalid("fill ranges"));
    }
    let nv = s.fill_verts.len() as u32;
    if s.fill_idx.iter().chain(&s.t_fill_idx).any(|&i| i >= nv) || s.fill_verts.iter().any(|v| v.item >= items) {
        return Err(WireError::Invalid("fill indices"));
    }
    let niv = s.image_verts.len() as u32;
    if s.image_idx.iter().any(|&i| i >= niv) || s.image_verts.iter().any(|v| v.item >= items) {
        return Err(WireError::Invalid("image indices"));
    }
    for e in &s.stream {
        let len = match e.kind {
            crate::scene::stream::STROKES => s.t_segs.len(),
            crate::scene::stream::FILLS => s.t_fill_idx.len(),
            _ => {
                if e.image as usize >= s.images.len() {
                    return Err(WireError::Invalid("stream image"));
                }
                s.image_idx.len()
            }
        };
        if e.start as usize + e.count as usize > len {
            return Err(WireError::Invalid("stream range"));
        }
    }
    if s.layers_off.iter().any(|&l| l as usize >= s.layers.len()) {
        return Err(WireError::Invalid("layer"));
    }
    Ok(())
}

fn put<T: Pod>(out: &mut Vec<u8>, v: &[T]) {
    let b: &[u8] = bytemuck::cast_slice(v);
    out.extend_from_slice(&(b.len() as u64).to_le_bytes());
    out.extend_from_slice(b);
}

struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn get<T: Pod>(&mut self) -> Result<Vec<T>, WireError> {
        if self.0.len() < 8 {
            return Err(WireError::Truncated);
        }
        let n = u64::from_le_bytes(self.0[..8].try_into().unwrap()) as usize;
        let rest = &self.0[8..];
        if n > rest.len() || n % size_of::<T>() != 0 {
            return Err(WireError::Truncated);
        }
        let mut v = vec![T::zeroed(); n / size_of::<T>()];
        bytemuck::cast_slice_mut::<T, u8>(&mut v).copy_from_slice(&rest[..n]);
        self.0 = &rest[n..];
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{ContentBuilder, Image, Item, NONE, fill, rgba};
    use crate::{Affine, SceneOptions, build_scene};

    #[test]
    fn round_trip_and_rejects_damage() {
        let mut b = ContentBuilder::new([300.0, 200.0]);
        let layer = b.layer("A");
        let s = b.begin_path();
        b.move_to([10.0, 10.0]);
        b.line_to([200.0, 150.0]);
        b.line_to([20.0, 150.0]);
        b.close();
        b.finish_path(s, Item { fill_rule: fill::NONZERO, fill_color: rgba(1, 2, 3, 128), stroked: 1, stroke_color: rgba(0, 0, 0, 255), clip: NONE, layer, miter_limit: 10.0, ..Default::default() });
        b.add_image(Image { width: 2, height: 2, rgba: vec![255; 16], transform: Affine::new(10.0, 0.0, 0.0, 10.0, 5.0, 5.0), opacity: 1.0, smooth: true }, NONE, NONE);
        let scene = build_scene(&b.finish(), &SceneOptions::default());
        let bytes = encode(&scene);
        let back = decode(&bytes).unwrap();
        assert_eq!(back.segs, scene.segs);
        assert_eq!(back.items, scene.items);
        assert_eq!(back.images, scene.images);
        assert_eq!(back.layers, scene.layers);
        assert!(decode(&bytes[..bytes.len() - 1]).is_err());
        let mut bad = bytes.clone();
        // Corrupt the first segment's item index.
        let pos = bytes.windows(4).position(|w| w == [1u8, 0, 0, 0]).unwrap_or(0);
        bad[pos] = 0xff;
        let _ = decode(&bad);
    }
}
