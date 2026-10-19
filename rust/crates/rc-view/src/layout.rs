//! Where pages sit and how the view looks at them: layout space (points, pages rotated by the view
//! rotation and stacked), and the camera (zoom and scroll) that maps layout space to screen pixels.

use rc_gpu::Affine2;

/// Gap between pages in continuous layout, in points.
pub const PAGE_GAP: f32 = 24.0;
/// Space kept around the document when scrolled to its ends, in points.
pub const MARGIN: f32 = 16.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum Mode {
    /// One page at a time.
    Single,
    /// All pages in a scrolling column.
    #[default]
    Continuous,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    pub mode: Mode,
    /// View rotation in clockwise quarter turns.
    pub rotation: u8,
    /// Page sizes in points (the page's own rotation applied, not the view's).
    pub sizes: Vec<[f32; 2]>,
    /// Each page's rectangle in layout space `[x0, y0, x1, y1]`.
    pub rects: Vec<[f32; 4]>,
    /// The page shown in single-page mode.
    pub current: usize,
}

impl Layout {
    pub fn new(sizes: Vec<[f32; 2]>, mode: Mode, rotation: u8, current: usize) -> Self {
        let mut l = Layout {
            mode,
            rotation: rotation % 4,
            sizes,
            rects: Vec::new(),
            current,
        };
        l.place();
        l
    }

    pub fn rotated_size(&self, i: usize) -> [f32; 2] {
        let [w, h] = self.sizes[i];
        if self.rotation % 2 == 1 { [h, w] } else { [w, h] }
    }

    fn place(&mut self) {
        let n = self.sizes.len();
        self.rects = vec![[0.0; 4]; n];
        if n == 0 {
            return;
        }
        match self.mode {
            Mode::Single => {
                for i in 0..n {
                    let [w, h] = self.rotated_size(i);
                    self.rects[i] = [0.0, 0.0, w, h];
                }
            }
            Mode::Continuous => {
                let widest = (0..n).map(|i| self.rotated_size(i)[0]).fold(0.0f32, f32::max);
                let mut y = 0.0;
                for i in 0..n {
                    let [w, h] = self.rotated_size(i);
                    let x = (widest - w) / 2.0;
                    self.rects[i] = [x, y, x + w, y + h];
                    y += h + PAGE_GAP;
                }
            }
        }
    }

    /// Pages present in the layout (all of them, or the current one).
    pub fn shown(&self) -> std::ops::Range<usize> {
        match self.mode {
            Mode::Single => {
                self.current.min(self.sizes.len().saturating_sub(1))..(self.current + 1).min(self.sizes.len())
            }
            Mode::Continuous => 0..self.sizes.len(),
        }
    }

    /// The layout's extent, margins included.
    pub fn bounds(&self) -> [f32; 4] {
        let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for i in self.shown() {
            let r = self.rects[i];
            b = [b[0].min(r[0]), b[1].min(r[1]), b[2].max(r[2]), b[3].max(r[3])];
        }
        if b[0] > b[2] {
            return [0.0; 4];
        }
        [b[0] - MARGIN, b[1] - MARGIN, b[2] + MARGIN, b[3] + MARGIN]
    }

    /// Page space to rotated page space (the page as the view shows it, origin top-left).
    pub fn rotate(&self, i: usize) -> Affine2 {
        let [w, h] = self.sizes[i];
        match self.rotation % 4 {
            1 => [0.0, 1.0, -1.0, 0.0, h, 0.0],
            2 => [-1.0, 0.0, 0.0, -1.0, w, h],
            3 => [0.0, -1.0, 1.0, 0.0, 0.0, w],
            _ => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }
    }

    /// The page under a layout point.
    pub fn page_at(&self, p: [f32; 2]) -> Option<usize> {
        self.shown().find(|&i| {
            let r = self.rects[i];
            p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]
        })
    }

    /// The page nearest a layout point (the one whose rectangle is closest).
    pub fn nearest_page(&self, p: [f32; 2]) -> usize {
        self.shown()
            .min_by(|&a, &b| dist(self.rects[a], p).total_cmp(&dist(self.rects[b], p)))
            .unwrap_or(0)
    }
}

fn dist(r: [f32; 4], p: [f32; 2]) -> f32 {
    let dx = (r[0] - p[0]).max(0.0).max(p[0] - r[2]);
    let dy = (r[1] - p[1]).max(0.0).max(p[1] - r[3]);
    dx * dx + dy * dy
}

/// `a` followed by `b`.
pub fn then(a: &Affine2, b: &Affine2) -> Affine2 {
    [
        b[0] * a[0] + b[2] * a[1],
        b[1] * a[0] + b[3] * a[1],
        b[0] * a[2] + b[2] * a[3],
        b[1] * a[2] + b[3] * a[3],
        b[0] * a[4] + b[2] * a[5] + b[4],
        b[1] * a[4] + b[3] * a[5] + b[5],
    ]
}

pub fn apply(m: &Affine2, p: [f32; 2]) -> [f32; 2] {
    [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

pub fn invert(m: &Affine2) -> Option<Affine2> {
    let det = m[0] * m[3] - m[1] * m[2];
    if det.abs() < 1e-20 {
        return None;
    }
    let (a, b, c, d) = (m[3] / det, -m[1] / det, -m[2] / det, m[0] / det);
    Some([a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])])
}

/// Zoom and scroll: layout point `scroll` is at the viewport's top-left, `scale` device pixels per
/// point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    pub scale: f32,
    pub scroll: [f32; 2],
    /// Viewport size in device pixels.
    pub viewport: [f32; 2],
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            scale: 1.0,
            scroll: [0.0, 0.0],
            viewport: [800.0, 600.0],
        }
    }
}

pub const MIN_SCALE: f32 = 0.02;
pub const MAX_SCALE: f32 = 128.0;

impl Camera {
    /// Layout space to screen pixels.
    pub fn transform(&self) -> Affine2 {
        let s = self.scale;
        [s, 0.0, 0.0, s, -self.scroll[0] * s, -self.scroll[1] * s]
    }

    pub fn to_layout(&self, px: [f32; 2]) -> [f32; 2] {
        [px[0] / self.scale + self.scroll[0], px[1] / self.scale + self.scroll[1]]
    }

    pub fn to_screen(&self, p: [f32; 2]) -> [f32; 2] {
        [
            (p[0] - self.scroll[0]) * self.scale,
            (p[1] - self.scroll[1]) * self.scale,
        ]
    }

    /// The viewport in layout space.
    pub fn visible(&self) -> [f32; 4] {
        let a = self.to_layout([0.0, 0.0]);
        let b = self.to_layout(self.viewport);
        [a[0], a[1], b[0], b[1]]
    }

    /// Zooms by `factor` keeping the layout point under `anchor` (pixels) where it is.
    pub fn zoom_at(&mut self, factor: f32, anchor: [f32; 2]) {
        let p = self.to_layout(anchor);
        self.scale = (self.scale * factor).clamp(MIN_SCALE, MAX_SCALE);
        self.scroll = [p[0] - anchor[0] / self.scale, p[1] - anchor[1] / self.scale];
    }

    /// Keeps the view on the layout: content cannot be scrolled out of view, and a layout smaller
    /// than the viewport is centred.
    pub fn clamp(&mut self, bounds: [f32; 4]) {
        let vw = self.viewport[0] / self.scale;
        let vh = self.viewport[1] / self.scale;
        for (axis, v) in [(0, vw), (1, vh)] {
            let (lo, hi) = (bounds[axis], bounds[axis + 2]);
            if hi - lo <= v {
                self.scroll[axis] = lo - (v - (hi - lo)) / 2.0;
            } else {
                self.scroll[axis] = self.scroll[axis].clamp(lo, hi - v);
            }
        }
    }
}

/// Page space to screen pixels for page `i`.
pub fn page_to_screen(layout: &Layout, camera: &Camera, i: usize) -> Affine2 {
    let r = layout.rects[i];
    let to_layout = then(&layout.rotate(i), &[1.0, 0.0, 0.0, 1.0, r[0], r[1]]);
    then(&to_layout, &camera.transform())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuous_stacks_and_centres() {
        let l = Layout::new(vec![[100.0, 50.0], [200.0, 80.0]], Mode::Continuous, 0, 0);
        assert_eq!(l.rects[0], [50.0, 0.0, 150.0, 50.0]);
        assert_eq!(l.rects[1], [0.0, 74.0, 200.0, 154.0]);
        assert_eq!(l.page_at([60.0, 10.0]), Some(0));
        assert_eq!(l.page_at([10.0, 10.0]), None);
        assert_eq!(l.nearest_page([10.0, 10.0]), 0);
    }

    #[test]
    fn rotation_maps_corners() {
        let l = Layout::new(vec![[100.0, 50.0]], Mode::Single, 1, 0);
        assert_eq!(l.rotated_size(0), [50.0, 100.0]);
        let m = l.rotate(0);
        assert_eq!(apply(&m, [0.0, 0.0]), [50.0, 0.0]);
        assert_eq!(apply(&m, [100.0, 50.0]), [0.0, 100.0]);
    }

    #[test]
    fn zoom_keeps_anchor() {
        let mut c = Camera {
            scale: 2.0,
            scroll: [10.0, 20.0],
            viewport: [400.0, 300.0],
        };
        let before = c.to_layout([100.0, 50.0]);
        c.zoom_at(1.5, [100.0, 50.0]);
        let after = c.to_layout([100.0, 50.0]);
        assert!((before[0] - after[0]).abs() < 1e-4 && (before[1] - after[1]).abs() < 1e-4);
        let m = c.transform();
        let inv = invert(&m).unwrap();
        let p = apply(&inv, apply(&m, [3.0, 4.0]));
        assert!((p[0] - 3.0).abs() < 1e-4);
    }

    #[test]
    fn clamp_centres_small_layouts() {
        let mut c = Camera {
            scale: 1.0,
            scroll: [500.0, 500.0],
            viewport: [400.0, 300.0],
        };
        c.clamp([0.0, 0.0, 100.0, 100.0]);
        assert_eq!(c.scroll, [-150.0, -100.0]);
    }
}
