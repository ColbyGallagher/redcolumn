//! The tile grid: half-octave zoom levels, and 512-pixel tiles of each page as the view shows it
//! (rotated), at each level.

use crate::layout::{Layout, then};
use rc_gpu::Affine2;

pub const TILE: u32 = 512;

/// The level drawn for a screen scale: the first level at least as sharp. Levels are half an
/// octave apart, so a tile is never more than 1.41 times the pixels it covers on screen.
pub fn level_for(scale: f32) -> i32 {
    (2.0 * scale.max(1e-4).log2()).ceil() as i32
}

pub fn level_scale(level: i32) -> f32 {
    2f32.powf(level as f32 / 2.0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    /// Drawn by the GPU from the page's scene.
    Scene,
    /// Drawn by PDFium: the page's content, no annotations.
    Raster,
    /// Drawn by PDFium: annotations (and text, when the scene has none) over the base.
    Overlay,
    /// Drawn by PDFium: the whole page, small, while it loads.
    Preview,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TileKey {
    pub page: u32,
    pub kind: Kind,
    pub level: i32,
    pub tx: i32,
    pub ty: i32,
}

/// The page's size in pixels at a level, as the view shows it.
pub fn page_px(layout: &Layout, page: usize, level: i32) -> [u32; 2] {
    let [w, h] = layout.rotated_size(page);
    let s = level_scale(level);
    [(w * s).ceil().max(1.0) as u32, (h * s).ceil().max(1.0) as u32]
}

/// A tile's size in pixels (smaller at the page's right and bottom edges).
pub fn tile_size(layout: &Layout, k: &TileKey) -> [u32; 2] {
    let [pw, ph] = page_px(layout, k.page as usize, k.level);
    let x = k.tx as u32 * TILE;
    let y = k.ty as u32 * TILE;
    [
        TILE.min(pw.saturating_sub(x)).max(1),
        TILE.min(ph.saturating_sub(y)).max(1),
    ]
}

/// Page space to the tile's pixels.
pub fn tile_transform(layout: &Layout, k: &TileKey) -> Affine2 {
    let s = level_scale(k.level);
    let rot = layout.rotate(k.page as usize);
    then(
        &rot,
        &[
            s,
            0.0,
            0.0,
            s,
            -(k.tx as f32 * TILE as f32),
            -(k.ty as f32 * TILE as f32),
        ],
    )
}

/// Tiles of a page at a level covering `region` (in the rotated page's points).
pub fn covering(layout: &Layout, page: usize, level: i32, region: [f32; 4]) -> Vec<(i32, i32)> {
    let s = level_scale(level);
    let [pw, ph] = page_px(layout, page, level);
    let nx = pw.div_ceil(TILE) as i32;
    let ny = ph.div_ceil(TILE) as i32;
    let t = TILE as f32;
    let x0 = ((region[0] * s / t).floor() as i32).clamp(0, nx);
    let x1 = ((region[2] * s / t).ceil() as i32).clamp(0, nx);
    let y0 = ((region[1] * s / t).floor() as i32).clamp(0, ny);
    let y1 = ((region[3] * s / t).ceil() as i32).clamp(0, ny);
    let mut out = Vec::with_capacity(((x1 - x0) * (y1 - y0)).max(0) as usize);
    for ty in y0..y1 {
        for tx in x0..x1 {
            out.push((tx, ty));
        }
    }
    out
}

/// Where a tile lands in the rotated page, in points `[x0, y0, x1, y1]`.
pub fn tile_rect(layout: &Layout, k: &TileKey) -> [f32; 4] {
    let s = level_scale(k.level);
    let [w, h] = tile_size(layout, k);
    let x0 = k.tx as f32 * TILE as f32 / s;
    let y0 = k.ty as f32 * TILE as f32 / s;
    [x0, y0, x0 + w as f32 / s, y0 + h as f32 / s]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{Mode, apply};

    #[test]
    fn levels() {
        assert_eq!(level_for(1.0), 0);
        assert_eq!(level_for(1.2), 1);
        assert!((level_scale(1) - 1.41421).abs() < 1e-3);
        assert!(level_scale(level_for(3.0)) >= 3.0 && level_scale(level_for(3.0)) < 3.0 * 1.415);
    }

    #[test]
    fn tiles_cover_the_region() {
        let l = Layout::new(vec![[2384.0, 1684.0]], Mode::Single, 0, 0);
        let t = covering(&l, 0, 0, [0.0, 0.0, 600.0, 100.0]);
        assert_eq!(t, vec![(0, 0), (1, 0)]);
        let inner = TileKey {
            page: 0,
            kind: Kind::Scene,
            level: 0,
            tx: 1,
            ty: 1,
        };
        assert_eq!(tile_size(&l, &inner), [512, 512]);
        // The last tile is cut at the page's edge: 2384 - 2048 by 1684 - 1536.
        let k = TileKey { tx: 4, ty: 3, ..inner };
        assert_eq!(tile_size(&l, &k), [336, 148]);
        assert_eq!(tile_rect(&l, &k)[0], 2048.0);
        let m = tile_transform(&l, &k);
        assert_eq!(apply(&m, [2048.0, 1536.0]), [0.0, 0.0]);
    }

    #[test]
    fn rotated_tiles() {
        let l = Layout::new(vec![[100.0, 50.0]], Mode::Single, 1, 0);
        let k = TileKey {
            page: 0,
            kind: Kind::Scene,
            level: 0,
            tx: 0,
            ty: 0,
        };
        // Rotated 90°: the page is 50 wide, 100 tall; its top-left corner is now at top-right.
        assert_eq!(tile_size(&l, &k), [50, 100]);
        assert_eq!(apply(&tile_transform(&l, &k), [0.0, 0.0]), [50.0, 0.0]);
    }
}
