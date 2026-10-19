//! A page's content as extracted from a PDF, in paint order, in page space.
//!
//! Both extractors produce this: the PDFium worker (through PDFium's page object API) and our own
//! content stream interpreter (`rc-parse`). The scene builder turns it into a [`crate::Scene`].
//!
//! Page space is the app's everywhere: PDF points, origin at the top-left of the displayed
//! (rotated, cropped) page, y down. Every coordinate here has the object's transform, the page's
//! crop box and its /Rotate already applied.

use bytemuck::{Pod, Zeroable};

/// Path verbs. Each consumes points from the item's point range: Move 1, Line 1, Cubic 3, Close 0.
pub mod verb {
    pub const MOVE: u8 = 0;
    pub const LINE: u8 = 1;
    pub const CUBIC: u8 = 2;
    pub const CLOSE: u8 = 3;
}

/// How many points each verb consumes.
pub fn verb_points(v: u8) -> usize {
    match v {
        verb::MOVE | verb::LINE => 1,
        verb::CUBIC => 3,
        _ => 0,
    }
}

/// Fill rules. `NONE` means the path is not filled.
pub mod fill {
    pub const NONE: u8 = 0;
    pub const NONZERO: u8 = 1;
    pub const EVENODD: u8 = 2;
}

pub mod cap {
    pub const BUTT: u8 = 0;
    pub const ROUND: u8 = 1;
    pub const SQUARE: u8 = 2;
}

pub mod join {
    pub const MITER: u8 = 0;
    pub const ROUND: u8 = 1;
    pub const BEVEL: u8 = 2;
}

pub mod kind {
    pub const PATH: u8 = 0;
    pub const IMAGE: u8 = 1;
}

/// No clip, no layer, no image.
pub const NONE: u32 = u32::MAX;

/// What the content uses that the scene does not draw itself. A page with any of these set is
/// either drawn by the raster path, or (text) gets a PDFium text layer over the scene.
pub mod flags {
    /// Text objects were present and not turned into glyph outlines.
    pub const TEXT_NOT_EXTRACTED: u32 = 1 << 0;
    /// A blend mode other than Normal.
    pub const BLEND_MODE: u32 = 1 << 1;
    /// Soft masks or transparency groups.
    pub const SOFT_MASK: u32 = 1 << 2;
    /// Shading objects or shading patterns.
    pub const SHADING: u32 = 1 << 3;
    /// Tiling patterns used as fill or stroke colour.
    pub const PATTERN: u32 = 1 << 4;
    /// Something else the extractor could not express (unknown object type, damaged data).
    pub const UNSUPPORTED: u32 = 1 << 5;
    /// The content was cut short at the extractor's size limit.
    pub const TRUNCATED: u32 = 1 << 6;
    /// Flags that make the scene unable to draw the page correctly on its own.
    pub const NEEDS_RASTER: u32 = BLEND_MODE | SOFT_MASK | SHADING | PATTERN | UNSUPPORTED | TRUNCATED;
}

/// A colour as straight (not premultiplied) RGBA, 8 bits each, packed little-endian as
/// `r | g << 8 | b << 16 | a << 24`.
pub type Rgba = u32;

pub fn rgba(r: u8, g: u8, b: u8, a: u8) -> Rgba {
    r as u32 | (g as u32) << 8 | (b as u32) << 16 | (a as u32) << 24
}

pub fn rgba_parts(c: Rgba) -> [u8; 4] {
    c.to_le_bytes()
}

/// One painted object, in paint order.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct Item {
    /// [`kind::PATH`] or [`kind::IMAGE`].
    pub kind: u8,
    /// [`fill`] rule; [`fill::NONE`] when the path is only stroked.
    pub fill_rule: u8,
    /// Stroke cap and join ([`cap`], [`join`]).
    pub cap: u8,
    pub join: u8,
    /// Whether the path is stroked.
    pub stroked: u8,
    pub _pad: [u8; 3],
    /// Path: range in `verbs`, and the first point in `points` (the verbs say how many follow).
    pub verb_start: u32,
    pub verb_len: u32,
    pub point_start: u32,
    pub fill_color: Rgba,
    pub stroke_color: Rgba,
    /// Stroke width in page space points; 0 is a hairline (one device pixel).
    pub width: f32,
    pub miter_limit: f32,
    /// Dash pattern in page space points: range in `dashes`, and the phase. Empty for solid.
    pub dash_start: u32,
    pub dash_len: u32,
    pub dash_phase: f32,
    /// Innermost clip node, or [`NONE`].
    pub clip: u32,
    /// Index in `layers`, or [`NONE`].
    pub layer: u32,
    /// Image: index in `images`.
    pub image: u32,
}

/// A clip node: its path intersected with its parent's clip.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct ClipNode {
    pub parent: u32,
    pub verb_start: u32,
    pub verb_len: u32,
    pub point_start: u32,
    /// [`fill::NONZERO`] or [`fill::EVENODD`].
    pub rule: u8,
    pub _pad: [u8; 3],
}

/// A 2 × 3 affine transform: `x' = a x + c y + e`, `y' = b x + d y + f`.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct Affine {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Default for Affine {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Affine {
    pub const IDENTITY: Affine = Affine { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    pub fn new(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Self {
        Self { a, b, c, d, e, f }
    }

    pub fn apply(&self, x: f64, y: f64) -> [f64; 2] {
        [self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f]
    }

    pub fn apply_f32(&self, x: f64, y: f64) -> [f32; 2] {
        let [x, y] = self.apply(x, y);
        [x as f32, y as f32]
    }

    /// `self` followed by `next`: the result maps p to next(self(p)).
    pub fn then(&self, next: &Affine) -> Affine {
        let m = self;
        Affine {
            a: next.a * m.a + next.c * m.b,
            b: next.b * m.a + next.d * m.b,
            c: next.a * m.c + next.c * m.d,
            d: next.b * m.c + next.d * m.d,
            e: next.a * m.e + next.c * m.f + next.e,
            f: next.b * m.e + next.d * m.f + next.f,
        }
    }

    pub fn invert(&self) -> Option<Affine> {
        let det = self.a * self.d - self.b * self.c;
        if det.abs() < 1e-300 || !det.is_finite() {
            return None;
        }
        let a = self.d / det;
        let b = -self.b / det;
        let c = -self.c / det;
        let d = self.a / det;
        Some(Affine { a, b, c, d, e: -(a * self.e + c * self.f), f: -(b * self.e + d * self.f) })
    }

    /// How much the transform scales lengths on average (for line widths).
    pub fn mean_scale(&self) -> f64 {
        (self.a * self.d - self.b * self.c).abs().sqrt()
    }

    /// The map from PDF user space to page space for a page with this crop box and /Rotate,
    /// the way PDFium lays pages out (`FPDF_PageToDevice` at 1 pixel per point).
    pub fn page_from_user(crop: [f64; 4], rotate: i32) -> Affine {
        let [x0, y0, x1, y1] = crop;
        let w = x1 - x0;
        let h = y1 - y0;
        // Unrotated: x right, y down from the top-left of the crop box.
        let flip = Affine::new(1.0, 0.0, 0.0, -1.0, -x0, y1);
        let turn = match rotate.rem_euclid(360) {
            90 => Affine::new(0.0, 1.0, -1.0, 0.0, h, 0.0),
            180 => Affine::new(-1.0, 0.0, 0.0, -1.0, w, h),
            270 => Affine::new(0.0, -1.0, 1.0, 0.0, 0.0, w),
            _ => Affine::IDENTITY,
        };
        flip.then(&turn)
    }
}

/// An image, decoded to straight-alpha RGBA, and where it lands on the page.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Maps image space (u right, v down, both 0–1 over the image) to page space.
    pub transform: Affine,
    /// Constant opacity applied on top of the pixels' alpha (0–1).
    pub opacity: f32,
    /// Drawn with smoothing (the PDF's /Interpolate, or by default for photos).
    pub smooth: bool,
}

/// A page's content: everything the scene builder needs and nothing else.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PageContent {
    /// Page size in points, rotation applied.
    pub size: [f32; 2],
    pub items: Vec<Item>,
    pub verbs: Vec<u8>,
    pub points: Vec<[f32; 2]>,
    pub dashes: Vec<f32>,
    pub clips: Vec<ClipNode>,
    pub images: Vec<Image>,
    /// Optional content group names; items refer to them by index.
    pub layers: Vec<String>,
    /// [`flags`] for what the content uses that the scene cannot draw.
    pub flags: u32,
}

/// Builds [`PageContent`] item by item. Extractors push paths in page space.
#[derive(Default)]
pub struct ContentBuilder {
    pub content: PageContent,
    layer_index: std::collections::HashMap<String, u32>,
}

impl ContentBuilder {
    pub fn new(size: [f32; 2]) -> Self {
        Self { content: PageContent { size, ..Default::default() }, layer_index: Default::default() }
    }

    /// Starts a path; returns `(verb_start, point_start)` to pass to [`Self::finish_path`].
    pub fn begin_path(&self) -> (u32, u32) {
        (self.content.verbs.len() as u32, self.content.points.len() as u32)
    }

    pub fn move_to(&mut self, p: [f32; 2]) {
        self.content.verbs.push(verb::MOVE);
        self.content.points.push(p);
    }

    pub fn line_to(&mut self, p: [f32; 2]) {
        self.content.verbs.push(verb::LINE);
        self.content.points.push(p);
    }

    pub fn cubic_to(&mut self, c1: [f32; 2], c2: [f32; 2], p: [f32; 2]) {
        self.content.verbs.push(verb::CUBIC);
        self.content.points.extend_from_slice(&[c1, c2, p]);
    }

    pub fn close(&mut self) {
        self.content.verbs.push(verb::CLOSE);
    }

    /// Drops a path begun with [`Self::begin_path`] (an empty or invisible one).
    pub fn discard_path(&mut self, start: (u32, u32)) {
        self.content.verbs.truncate(start.0 as usize);
        self.content.points.truncate(start.1 as usize);
    }

    /// Adds the path begun at `start` as an item with this paint. Returns false (and drops the
    /// path) when there is nothing to draw.
    pub fn finish_path(&mut self, start: (u32, u32), mut item: Item) -> bool {
        let verb_len = self.content.verbs.len() as u32 - start.0;
        if verb_len == 0 || (item.fill_rule == fill::NONE && item.stroked == 0) {
            self.discard_path(start);
            return false;
        }
        item.kind = kind::PATH;
        item.verb_start = start.0;
        item.verb_len = verb_len;
        item.point_start = start.1;
        self.content.items.push(item);
        true
    }

    /// Adds the path begun at `start` as a clip node under `parent`. Returns the node's index.
    pub fn finish_clip(&mut self, start: (u32, u32), rule: u8, parent: u32) -> u32 {
        let verb_len = self.content.verbs.len() as u32 - start.0;
        self.content.clips.push(ClipNode {
            parent,
            verb_start: start.0,
            verb_len,
            point_start: start.1,
            rule,
            _pad: [0; 3],
        });
        self.content.clips.len() as u32 - 1
    }

    pub fn add_dashes(&mut self, dashes: &[f32]) -> (u32, u32) {
        let start = self.content.dashes.len() as u32;
        self.content.dashes.extend_from_slice(dashes);
        (start, dashes.len() as u32)
    }

    pub fn add_image(&mut self, image: Image, clip: u32, layer: u32) {
        self.content.images.push(image);
        self.content.items.push(Item {
            kind: kind::IMAGE,
            image: self.content.images.len() as u32 - 1,
            clip,
            layer,
            ..Default::default()
        });
    }

    pub fn layer(&mut self, name: &str) -> u32 {
        if let Some(&i) = self.layer_index.get(name) {
            return i;
        }
        let i = self.content.layers.len() as u32;
        self.content.layers.push(name.to_string());
        self.layer_index.insert(name.to_string(), i);
        i
    }

    pub fn finish(self) -> PageContent {
        self.content
    }
}

impl PageContent {
    /// The verbs and points of an item's path.
    pub fn path(&self, verb_start: u32, verb_len: u32, point_start: u32) -> PathIter<'_> {
        PathIter {
            verbs: &self.verbs[verb_start as usize..(verb_start + verb_len) as usize],
            points: &self.points[point_start as usize..],
        }
    }

    pub fn item_path(&self, item: &Item) -> PathIter<'_> {
        self.path(item.verb_start, item.verb_len, item.point_start)
    }

    pub fn clip_path(&self, clip: &ClipNode) -> PathIter<'_> {
        self.path(clip.verb_start, clip.verb_len, clip.point_start)
    }

    /// Path segments (lines and curves, before flattening), for statistics.
    pub fn segment_count(&self) -> usize {
        self.verbs.iter().filter(|&&v| v == verb::LINE || v == verb::CUBIC).count()
    }
}

/// A path's verbs with their points.
#[derive(Clone)]
pub struct PathIter<'a> {
    verbs: &'a [u8],
    points: &'a [[f32; 2]],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PathEl {
    Move([f32; 2]),
    Line([f32; 2]),
    Cubic([f32; 2], [f32; 2], [f32; 2]),
    Close,
}

impl Iterator for PathIter<'_> {
    type Item = PathEl;

    fn next(&mut self) -> Option<PathEl> {
        let (&v, rest) = self.verbs.split_first()?;
        self.verbs = rest;
        let n = verb_points(v);
        let p = self.points;
        self.points = &p[n.min(p.len())..];
        Some(match v {
            verb::MOVE => PathEl::Move(*p.first()?),
            verb::LINE => PathEl::Line(*p.first()?),
            verb::CUBIC => PathEl::Cubic(*p.first()?, *p.get(1)?, *p.get(2)?),
            _ => PathEl::Close,
        })
    }
}

/// Flattens a path into polylines (page space), curves within `tolerance` points. Each polyline
/// comes with whether it was closed.
pub fn flatten(path: PathIter<'_>, tolerance: f32) -> Vec<(Vec<[f32; 2]>, bool)> {
    let mut out: Vec<(Vec<[f32; 2]>, bool)> = Vec::new();
    let mut cur: Vec<[f32; 2]> = Vec::new();
    let mut start = [0.0f32; 2];
    let push = |out: &mut Vec<(Vec<[f32; 2]>, bool)>, cur: &mut Vec<[f32; 2]>, closed: bool| {
        if cur.len() > 1 {
            out.push((std::mem::take(cur), closed));
        } else {
            cur.clear();
        }
    };
    for el in path {
        match el {
            PathEl::Move(p) => {
                push(&mut out, &mut cur, false);
                cur.push(p);
                start = p;
            }
            PathEl::Line(p) => {
                if cur.is_empty() {
                    cur.push(start);
                }
                cur.push(p);
            }
            PathEl::Cubic(c1, c2, p) => {
                if cur.is_empty() {
                    cur.push(start);
                }
                let p0 = *cur.last().unwrap();
                flatten_cubic(p0, c1, c2, p, tolerance, &mut cur);
            }
            PathEl::Close => {
                if cur.len() > 1 {
                    let first = cur[0];
                    out.push((std::mem::take(&mut cur), true));
                    // A path continuing after a close starts again at the subpath's start.
                    start = first;
                } else {
                    cur.clear();
                }
            }
        }
    }
    push(&mut out, &mut cur, false);
    out
}

/// Appends a cubic Bézier's points (after `p0`) flattened to within `tol`.
pub fn flatten_cubic(p0: [f32; 2], c1: [f32; 2], c2: [f32; 2], p3: [f32; 2], tol: f32, out: &mut Vec<[f32; 2]>) {
    // Number of segments from the curve's second differences (Wang's formula).
    let dd = |a: [f32; 2], b: [f32; 2], c: [f32; 2]| {
        let x = a[0] - 2.0 * b[0] + c[0];
        let y = a[1] - 2.0 * b[1] + c[1];
        (x * x + y * y).sqrt()
    };
    let m = dd(p0, c1, c2).max(dd(c1, c2, p3));
    let n = ((0.75 * m / tol.max(1e-6)).sqrt().ceil() as usize).clamp(1, 512);
    for i in 1..=n {
        let t = i as f32 / n as f32;
        let u = 1.0 - t;
        let a = u * u * u;
        let b = 3.0 * u * u * t;
        let c = 3.0 * u * t * t;
        let d = t * t * t;
        out.push([
            a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
            a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
        ]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_from_user_matches_pdfium_layout() {
        // A 200 x 100 pt crop box at (10, 20).
        let crop = [10.0, 20.0, 210.0, 120.0];
        let m = Affine::page_from_user(crop, 0);
        assert_eq!(m.apply(10.0, 120.0), [0.0, 0.0]); // top-left
        assert_eq!(m.apply(210.0, 20.0), [200.0, 100.0]); // bottom-right
        // Rotated 90° clockwise: the page is 100 wide and 200 tall; the old top-left is at top-right.
        let m = Affine::page_from_user(crop, 90);
        assert_eq!(m.apply(10.0, 120.0), [100.0, 0.0]);
        assert_eq!(m.apply(210.0, 20.0), [0.0, 200.0]);
        let m = Affine::page_from_user(crop, 180);
        assert_eq!(m.apply(10.0, 120.0), [200.0, 100.0]);
        let m = Affine::page_from_user(crop, 270);
        assert_eq!(m.apply(10.0, 120.0), [0.0, 200.0]);
        assert_eq!(m.apply(210.0, 20.0), [100.0, 0.0]);
    }

    #[test]
    fn affine_then_and_invert() {
        let a = Affine::new(2.0, 0.0, 0.0, 3.0, 5.0, 7.0);
        let b = Affine::new(0.0, 1.0, -1.0, 0.0, 1.0, 1.0);
        let ab = a.then(&b);
        let p = ab.apply(1.0, 2.0);
        let q = a.apply(1.0, 2.0);
        assert_eq!(p, b.apply(q[0], q[1]));
        let inv = ab.invert().unwrap();
        let r = inv.apply(p[0], p[1]);
        assert!((r[0] - 1.0).abs() < 1e-12 && (r[1] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn flatten_closes_and_curves() {
        let mut b = ContentBuilder::new([100.0, 100.0]);
        let s = b.begin_path();
        b.move_to([0.0, 0.0]);
        b.line_to([10.0, 0.0]);
        b.cubic_to([10.0, 5.0], [5.0, 10.0], [0.0, 10.0]);
        b.close();
        b.move_to([50.0, 50.0]);
        b.line_to([60.0, 60.0]);
        assert!(b.finish_path(s, Item { stroked: 1, ..Default::default() }));
        let c = b.finish();
        let lines = flatten(c.item_path(&c.items[0]), 0.01);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].1);
        assert!(lines[0].0.len() > 4);
        assert_eq!(*lines[0].0.last().unwrap(), [0.0, 10.0]);
        assert_eq!(lines[1], (vec![[50.0, 50.0], [60.0, 60.0]], false));
    }
}
