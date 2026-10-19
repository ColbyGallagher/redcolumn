//! The GPU scene: a page's content in the form the renderer draws directly, at any zoom, without
//! asking PDFium to walk the page again.
//!
//! - **Strokes** are line segments, each 16 bytes: two endpoints quantised to 1/256 pt relative to
//!   the centre of the 128 pt grid cell their midpoint is in, the cell, cap flags and an item index.
//!   Opaque segments are sorted by cell, so culling a view is a lookup of the visible cells.
//! - **Fills** (and strokes too wide to draw as quads) are triangles, also sorted by cell.
//! - **Paint order** is kept as depth: every painted part gets a depth from its place in the content,
//!   so opaque geometry can be drawn in any order and still overlap exactly as PDF paints it.
//!   Transparent geometry and images are kept in paint order in a separate stream, drawn after the
//!   opaque geometry, back to front.
//! - **Clipping** is done here, once ([`crate::clip`]); the GPU draws only what is visible.
//! - **Dashes** are applied here, in page space.

use crate::clip::{self, Rect, ResolvedClip};
use crate::content::{self, Image, Item, PageContent, cap, fill, flatten, join, kind};
use bytemuck::{Pod, Zeroable};
use lyon::math::point;
use lyon::path::Path as LyonPath;
use lyon::tessellation as tess;
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;

/// Grid cell edge in points.
pub const CELL: f32 = 128.0;
/// Quantisation steps per point: endpoints are stored to 1/256 pt.
pub const QUANT: f32 = 256.0;
/// Longest segment stored; longer ones are split so both ends stay within ±128 pt of their cell's
/// centre (the `i16` range).
pub const MAX_SEGMENT: f32 = CELL;
/// Strokes at least this wide (points) without round joins are tessellated, so their joins and
/// caps are exact; thinner ones are drawn as quads with round joins.
pub const THICK_STROKE: f32 = 1.0;

/// Segment end styles in [`StrokeSeg::flags`]: bits 0–1 the start, bits 2–3 the end.
pub mod end {
    pub const BUTT: u16 = 0;
    pub const ROUND: u16 = 1;
    pub const SQUARE: u16 = 2;
}

/// One stroked line segment.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct StrokeSeg {
    pub p0: [i16; 2],
    pub p1: [i16; 2],
    /// Cell index (row-major) the endpoints are relative to.
    pub cell: u16,
    /// End styles ([`end`]).
    pub flags: u16,
    /// Index in [`Scene::items`].
    pub item: u32,
}

/// What every painted part shares: colour, width, depth and layer. Indexed by slot: content item
/// `i` has slot `2i` for its fill (or image) and `2i + 1` for its stroke.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct GpuItem {
    /// Straight RGBA, `r | g << 8 | b << 16 | a << 24`.
    pub color: u32,
    /// Stroke width in points (0 is a hairline: one device pixel).
    pub width: f32,
    /// Depth for paint order: later parts are nearer (smaller).
    pub depth: f32,
    /// Layer index, or `u32::MAX` when on no layer.
    pub layer: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct FillVert {
    pub pos: [f32; 2],
    pub item: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct ImageVert {
    pub pos: [f32; 2],
    pub uv: [f32; 2],
    pub item: u32,
}

/// An image the scene draws, at the resolution it can ever be seen at.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SceneImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub smooth: bool,
}

pub mod stream {
    pub const STROKES: u32 = 0;
    pub const FILLS: u32 = 1;
    pub const IMAGE: u32 = 2;
}

/// A run of transparent geometry or one image, in paint order.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct StreamEntry {
    /// [`stream`] kind.
    pub kind: u32,
    /// Strokes: range in `t_segs`. Fills: range in `t_fill_idx`. Image: range in `image_idx`.
    pub start: u32,
    pub count: u32,
    /// Image: index in `images`.
    pub image: u32,
    pub bounds: Rect,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SceneStats {
    pub content_items: usize,
    pub dropped_items: usize,
    pub segments: usize,
    pub triangles: usize,
    pub images: usize,
    pub build_ms: f64,
}

/// A page ready for the GPU. See the module documentation.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scene {
    pub size: [f32; 2],
    pub cols: u32,
    pub rows: u32,
    pub items: Vec<GpuItem>,
    pub segs: Vec<StrokeSeg>,
    /// Per cell: `[start, count]` in `segs`, and the area its segments reach (strokes included).
    pub seg_cells: Vec<[u32; 2]>,
    pub seg_cell_bounds: Vec<Rect>,
    pub fill_verts: Vec<FillVert>,
    /// Opaque triangles, sorted by the cell of their centroid.
    pub fill_idx: Vec<u32>,
    pub fill_cells: Vec<[u32; 2]>,
    pub fill_cell_bounds: Vec<Rect>,
    /// Transparent strokes and triangles, in paint order, referenced from `stream`.
    pub t_segs: Vec<StrokeSeg>,
    pub t_fill_idx: Vec<u32>,
    pub image_verts: Vec<ImageVert>,
    pub image_idx: Vec<u32>,
    pub images: Vec<SceneImage>,
    pub stream: Vec<StreamEntry>,
    pub layers: Vec<String>,
    /// The content's [`content::flags`].
    pub flags: u32,
    pub stats: SceneStats,
}

#[derive(Clone, Debug)]
pub struct SceneOptions {
    /// Curve flattening tolerance in points.
    pub curve_tolerance: f32,
    /// Images are kept at no more than this many pixels per point of page...
    pub image_px_per_pt: f32,
    /// ...and no larger than this on either side (the GPU's texture limit).
    pub max_image_side: u32,
}

impl Default for SceneOptions {
    fn default() -> Self {
        // 0.005 pt is a quarter of a pixel at 3200% on a 150% display.
        Self { curve_tolerance: 0.005, image_px_per_pt: 12.0, max_image_side: 8192 }
    }
}

impl Scene {
    pub fn cell_of(&self, x: f32, y: f32) -> u32 {
        let cx = ((x / CELL).floor().max(0.0) as u32).min(self.cols - 1);
        let cy = ((y / CELL).floor().max(0.0) as u32).min(self.rows - 1);
        cy * self.cols + cx
    }

    /// The centre of a cell in page space.
    pub fn cell_center(&self, cell: u32) -> [f32; 2] {
        cell_center(cell, self.cols)
    }

    /// A segment's endpoints in page space.
    pub fn seg_points(&self, s: &StrokeSeg) -> ([f32; 2], [f32; 2]) {
        let c = self.cell_center(s.cell as u32);
        (dequant(s.p0, c), dequant(s.p1, c))
    }

    /// Cells overlapping `r`, as `(col_range, row_range)`.
    pub fn cells_in(&self, r: Rect) -> (std::ops::Range<u32>, std::ops::Range<u32>) {
        // Segments reach up to MAX_SEGMENT / 2 outside their cell, fills further: callers use the
        // per-cell bounds to cull exactly; this is the coarse range.
        let c0 = ((r[0] / CELL).floor().max(0.0) as u32).min(self.cols);
        let c1 = ((r[2] / CELL).floor() + 1.0).clamp(0.0, self.cols as f32) as u32;
        let r0 = ((r[1] / CELL).floor().max(0.0) as u32).min(self.rows);
        let r1 = ((r[3] / CELL).floor() + 1.0).clamp(0.0, self.rows as f32) as u32;
        (c0..c1, r0..r1)
    }

    /// Bytes the scene's buffers take.
    pub fn byte_size(&self) -> usize {
        self.items.len() * 16
            + (self.segs.len() + self.t_segs.len()) * 16
            + self.fill_verts.len() * 12
            + (self.fill_idx.len() + self.t_fill_idx.len() + self.image_idx.len()) * 4
            + self.image_verts.len() * 20
            + self.images.iter().map(|i| i.rgba.len()).sum::<usize>()
            + (self.seg_cells.len() + self.fill_cells.len()) * 24
    }
}

pub fn cell_center(cell: u32, cols: u32) -> [f32; 2] {
    let cx = cell % cols;
    let cy = cell / cols;
    [(cx as f32 + 0.5) * CELL, (cy as f32 + 0.5) * CELL]
}

fn quant(p: [f32; 2], c: [f32; 2]) -> [i16; 2] {
    let q = |v: f32| (v * QUANT).round().clamp(i16::MIN as f32, i16::MAX as f32) as i16;
    [q(p[0] - c[0]), q(p[1] - c[1])]
}

pub fn dequant(p: [i16; 2], c: [f32; 2]) -> [f32; 2] {
    [c[0] + p[0] as f32 / QUANT, c[1] + p[1] as f32 / QUANT]
}

/// Depth for a part's slot: the first slot is farthest.
fn depth(slot: u32, slots: u32) -> f32 {
    1.0 - (slot as f64 + 1.0) as f32 / (slots as f64 + 2.0) as f32
}

/// What one chunk of content items produced, before merging.
#[derive(Default)]
struct Part {
    segs: Vec<StrokeSeg>,
    fill_verts: Vec<FillVert>,
    /// Opaque triangles with their cell.
    tris: Vec<(u32, [u32; 3])>,
    t_segs: Vec<StrokeSeg>,
    t_fill_idx: Vec<u32>,
    image_verts: Vec<ImageVert>,
    image_idx: Vec<u32>,
    images: Vec<(u32, SceneImage)>,
    stream: Vec<StreamEntry>,
    dropped: usize,
}

struct Ctx<'a> {
    content: &'a PageContent,
    clips: &'a HashMap<u32, Arc<ResolvedClip>>,
    page: Rect,
    cols: u32,
    rows: u32,
    #[allow(dead_code)]
    slots: u32,
    opts: &'a SceneOptions,
}

/// Builds the scene for a page. Work is spread over the rayon pool in chunks of items, then
/// merged in paint order.
pub fn build_scene(content: &PageContent, opts: &SceneOptions) -> Scene {
    let t0 = std::time::Instant::now();
    let [w, h] = content.size;
    let cols = ((w / CELL).ceil() as u32).max(1);
    let rows = ((h / CELL).ceil() as u32).max(1);
    let page: Rect = [0.0, 0.0, w, h];
    let n = content.items.len();
    let slots = (n as u32).saturating_mul(2);

    // Resolve every clip node items use, once, in parallel.
    let mut used: Vec<u32> = content.items.iter().map(|i| i.clip).filter(|&c| c != content::NONE).collect();
    used.sort_unstable();
    used.dedup();
    let clips: HashMap<u32, Arc<ResolvedClip>> =
        used.par_iter().map(|&c| (c, Arc::new(clip::resolve(content, c, page)))).collect();

    let ctx = Ctx { content, clips: &clips, page, cols, rows, slots, opts };
    let mut items = vec![GpuItem::default(); slots as usize];
    for (i, it) in content.items.iter().enumerate() {
        let layer = if it.layer == content::NONE { u32::MAX } else { it.layer };
        let s = 2 * i as u32;
        if it.kind == kind::IMAGE {
            let opacity = content.images.get(it.image as usize).map_or(1.0, |im| im.opacity);
            let a = (opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
            items[s as usize] = GpuItem { color: 0x00ff_ffff | a << 24, width: 0.0, depth: depth(s, slots), layer };
        } else {
            items[s as usize] = GpuItem { color: it.fill_color, width: 0.0, depth: depth(s, slots), layer };
            items[s as usize + 1] =
                GpuItem { color: it.stroke_color, width: it.width.max(0.0), depth: depth(s + 1, slots), layer };
        }
    }

    const CHUNK: usize = 1024;
    let parts: Vec<Part> = content
        .items
        .par_chunks(CHUNK)
        .enumerate()
        .map(|(ci, chunk)| {
            let mut part = Part::default();
            for (k, it) in chunk.iter().enumerate() {
                let index = (ci * CHUNK + k) as u32;
                emit_item(&ctx, &items, index, it, &mut part);
            }
            part
        })
        .collect();

    let mut scene = merge(parts, cols, rows);
    scene.size = content.size;
    scene.items = items;
    scene.layers = content.layers.clone();
    scene.flags = content.flags;
    scene.stats.content_items = n;
    scene.stats.segments = scene.segs.len() + scene.t_segs.len();
    scene.stats.triangles = (scene.fill_idx.len() + scene.t_fill_idx.len() + scene.image_idx.len()) / 3;
    scene.stats.images = scene.images.len();
    scene.stats.build_ms = t0.elapsed().as_secs_f64() * 1000.0;
    scene
}

fn emit_item(ctx: &Ctx, items: &[GpuItem], index: u32, it: &Item, part: &mut Part) {
    let clip = if it.clip == content::NONE { None } else { ctx.clips.get(&it.clip).map(|c| c.as_ref()) };
    if clip.is_some_and(|c| c.is_empty()) {
        part.dropped += 1;
        return;
    }
    let clip_rect = clip.map_or(ctx.page, |c| clip::rect_intersect(c.rect, ctx.page));
    if clip_rect[0] >= clip_rect[2] || clip_rect[1] >= clip_rect[3] {
        part.dropped += 1;
        return;
    }
    let shapes = clip.and_then(|c| c.shapes.as_ref());
    if it.kind == kind::IMAGE {
        emit_image(ctx, items, index, it, clip_rect, shapes, part);
        return;
    }
    let lines = flatten(ctx.content.item_path(it), ctx.opts.curve_tolerance);
    if lines.is_empty() {
        part.dropped += 1;
        return;
    }
    let half = it.width.max(0.0) * 0.5 * if it.join == join::MITER { it.miter_limit.max(1.0) } else { 1.0 };
    let b = clip::bounds(lines.iter().flat_map(|(p, _)| p.iter().copied()));
    let reach = [b[0] - half - 1.0, b[1] - half - 1.0, b[2] + half + 1.0, b[3] + half + 1.0];
    if !clip::rect_overlaps(reach, clip_rect) {
        part.dropped += 1;
        return;
    }
    let inside = clip::rect_contains(clip_rect, reach) && shapes.is_none();
    if it.fill_rule != fill::NONE && it.fill_color >> 24 != 0 {
        let slot = 2 * index;
        let polys: Vec<Vec<[f32; 2]>> = lines.iter().filter(|(p, _)| p.len() > 2).map(|(p, _)| p.clone()).collect();
        let opaque = it.fill_color >> 24 == 255;
        if inside {
            fill_polygons(&polys, it.fill_rule, slot, opaque, part, ctx);
        } else if let Some(shapes) = shapes {
            let clipped = clip::polygons_shapes(&polys, it.fill_rule, shapes);
            let contours: Vec<Vec<[f32; 2]>> = clipped
                .iter()
                .flatten()
                .map(|c| c.iter().map(|&[x, y]| [x as f32, y as f32]).collect())
                .collect();
            fill_polygons(&contours, fill::NONZERO, slot, opaque, part, ctx);
        } else {
            let contours: Vec<Vec<[f32; 2]>> =
                polys.iter().map(|p| clip::polygon_rect(p, clip_rect)).filter(|p| p.len() > 2).collect();
            fill_polygons(&contours, it.fill_rule, slot, opaque, part, ctx);
        }
    }
    if it.stroked != 0 && it.stroke_color >> 24 != 0 {
        let slot = 2 * index + 1;
        let opaque = it.stroke_color >> 24 == 255;
        let dashes = &ctx.content.dashes
            [it.dash_start as usize..(it.dash_start as usize + it.dash_len as usize).min(ctx.content.dashes.len())];
        let mut runs: Vec<(Vec<[f32; 2]>, bool)> = if dash_visible(dashes) {
            let mut out = Vec::new();
            for (p, closed) in &lines {
                apply_dash(p, *closed, dashes, it.dash_phase, &mut out);
            }
            out.into_iter().map(|p| (p, false)).collect()
        } else {
            lines
        };
        if !inside {
            let mut open: Vec<Vec<[f32; 2]>> = Vec::new();
            for (mut p, closed) in runs.drain(..) {
                if closed {
                    p.push(p[0]);
                }
                open.push(p);
            }
            let mut clipped = Vec::new();
            for p in &open {
                clip::polyline_rect(p, clip_rect, &mut clipped);
            }
            if let Some(shapes) = shapes {
                let mut out = Vec::new();
                clip::polylines_shapes(&clipped, shapes, &mut out);
                clipped = out;
            }
            runs = clipped.into_iter().map(|p| (p, false)).collect();
        }
        let thick = it.width >= THICK_STROKE && it.join != join::ROUND;
        if thick {
            // Exact joins and caps when zoomed in; the segments under them keep the stroke at
            // least a pixel wide when zoomed out, as PDFium draws it.
            stroke_tessellate(&runs, it, slot, opaque, part, ctx);
        }
        stroke_segments(&runs, it.cap, slot, items[slot as usize].width, opaque, part, ctx);
    }
}

fn dash_visible(d: &[f32]) -> bool {
    !d.is_empty() && d.iter().all(|v| v.is_finite() && *v >= 0.0) && d.iter().sum::<f32>() > 1e-4
}

/// Cuts a polyline into its dashes.
pub fn apply_dash(p: &[[f32; 2]], closed: bool, dashes: &[f32], phase: f32, out: &mut Vec<Vec<[f32; 2]>>) {
    let mut pts = p.to_vec();
    if closed {
        pts.push(p[0]);
    }
    // An odd-length pattern repeats twice so on and off alternate.
    let pat: Vec<f32> = if dashes.len() % 2 == 1 { [dashes, dashes].concat() } else { dashes.to_vec() };
    let total: f32 = pat.iter().sum();
    let mut idx = 0usize;
    let mut left = pat[0];
    let mut ph = phase.rem_euclid(total);
    while ph > 0.0 {
        if ph >= left {
            ph -= left;
            idx = (idx + 1) % pat.len();
            left = pat[idx];
        } else {
            left -= ph;
            ph = 0.0;
        }
    }
    let mut on = idx % 2 == 0;
    let mut cur: Vec<[f32; 2]> = if on { vec![pts[0]] } else { Vec::new() };
    for w in pts.windows(2) {
        let (a, b) = (w[0], w[1]);
        let len = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
        let mut t = 0.0f32;
        while len - t > left {
            t += left;
            let q = [a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len];
            if on {
                cur.push(q);
                if cur.len() > 1 {
                    out.push(std::mem::take(&mut cur));
                }
                cur.clear();
            } else {
                cur.push(q);
            }
            on = !on;
            idx = (idx + 1) % pat.len();
            left = pat[idx];
            // A zero-length dash still draws its caps; keep it as a one-point run that becomes a
            // zero-length segment.
            if on && left == 0.0 {
                cur.push(q);
                out.push(std::mem::take(&mut cur));
                on = false;
                idx = (idx + 1) % pat.len();
                left = pat[idx];
            }
        }
        left -= len - t;
        if on {
            cur.push(b);
        }
    }
    if on && cur.len() > 1 {
        out.push(cur);
    }
}

fn cell_index(x: f32, y: f32, cols: u32, rows: u32) -> u32 {
    let cx = ((x / CELL).floor().max(0.0) as u32).min(cols - 1);
    let cy = ((y / CELL).floor().max(0.0) as u32).min(rows - 1);
    cy * cols + cx
}

fn stroke_segments(
    runs: &[(Vec<[f32; 2]>, bool)],
    item_cap: u8,
    slot: u32,
    _width: f32,
    opaque: bool,
    part: &mut Part,
    ctx: &Ctx,
) {
    let cap = match item_cap {
        cap::ROUND => end::ROUND,
        cap::SQUARE => end::SQUARE,
        _ => end::BUTT,
    };
    let mut seg_start = part.t_segs.len() as u32;
    let mut bounds = [f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY];
    for (p, closed) in runs {
        let mut pts: Vec<[f32; 2]> = p.clone();
        if *closed {
            pts.push(p[0]);
        }
        // Drop repeated points; a run that collapses to one point still draws its caps.
        pts.dedup();
        if pts.len() == 1 {
            if cap == end::BUTT {
                continue;
            }
            pts.push(pts[0]);
        }
        let last = pts.len() - 2;
        for (i, w) in pts.windows(2).enumerate() {
            let (a, b) = (w[0], w[1]);
            let len = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
            let pieces = ((len / MAX_SEGMENT).ceil() as usize).max(1);
            for k in 0..pieces {
                let t0 = k as f32 / pieces as f32;
                let t1 = (k + 1) as f32 / pieces as f32;
                let q0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
                let q1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
                let first = i == 0 && k == 0;
                let lastp = i == last && k == pieces - 1;
                let s_end = if first && !*closed { cap } else { end::ROUND };
                let e_end = if lastp && !*closed { cap } else { end::ROUND };
                let mid = [(q0[0] + q1[0]) * 0.5, (q0[1] + q1[1]) * 0.5];
                let cell = cell_index(mid[0], mid[1], ctx.cols, ctx.rows);
                let c = cell_center(cell, ctx.cols);
                let seg = StrokeSeg {
                    p0: quant(q0, c),
                    p1: quant(q1, c),
                    cell: cell as u16,
                    flags: s_end | e_end << 2,
                    item: slot,
                };
                if opaque {
                    part.segs.push(seg);
                } else {
                    part.t_segs.push(seg);
                    bounds = grow(bounds, q0);
                    bounds = grow(bounds, q1);
                }
            }
        }
    }
    if !opaque {
        let count = part.t_segs.len() as u32 - seg_start;
        if count > 0 {
            push_stream(part, stream::STROKES, seg_start, count, 0, bounds);
        }
        seg_start = part.t_segs.len() as u32;
        let _ = seg_start;
    }
}

fn grow(r: Rect, p: [f32; 2]) -> Rect {
    [r[0].min(p[0]), r[1].min(p[1]), r[2].max(p[0]), r[3].max(p[1])]
}

fn push_stream(part: &mut Part, kind: u32, start: u32, count: u32, image: u32, bounds: Rect) {
    if let Some(last) = part.stream.last_mut()
        && last.kind == kind
        && kind != stream::IMAGE
        && last.start + last.count == start
    {
        last.count += count;
        last.bounds = [
            last.bounds[0].min(bounds[0]),
            last.bounds[1].min(bounds[1]),
            last.bounds[2].max(bounds[2]),
            last.bounds[3].max(bounds[3]),
        ];
        return;
    }
    part.stream.push(StreamEntry { kind, start, count, image, bounds });
}

fn lyon_fill_rule(rule: u8) -> tess::FillRule {
    if rule == fill::EVENODD { tess::FillRule::EvenOdd } else { tess::FillRule::NonZero }
}

fn fill_polygons(polys: &[Vec<[f32; 2]>], rule: u8, slot: u32, opaque: bool, part: &mut Part, ctx: &Ctx) {
    if polys.is_empty() {
        return;
    }
    let mut b = LyonPath::builder();
    for p in polys {
        if p.len() < 3 {
            continue;
        }
        b.begin(point(p[0][0], p[0][1]));
        for q in &p[1..] {
            b.line_to(point(q[0], q[1]));
        }
        b.end(true);
    }
    let path = b.build();
    let mut geom: tess::VertexBuffers<[f32; 2], u32> = tess::VertexBuffers::new();
    let opts = tess::FillOptions::tolerance(0.01).with_fill_rule(lyon_fill_rule(rule));
    if tess::FillTessellator::new()
        .tessellate_path(&path, &opts, &mut tess::BuffersBuilder::new(&mut geom, |v: tess::FillVertex| v.position().to_array()))
        .is_err()
    {
        return;
    }
    push_triangles(&geom, slot, opaque, part, ctx);
}

fn push_triangles(geom: &tess::VertexBuffers<[f32; 2], u32>, slot: u32, opaque: bool, part: &mut Part, ctx: &Ctx) {
    if geom.indices.is_empty() {
        return;
    }
    let base = part.fill_verts.len() as u32;
    part.fill_verts.extend(geom.vertices.iter().map(|&pos| FillVert { pos, item: slot }));
    if opaque {
        for t in geom.indices.chunks_exact(3) {
            let [a, b, c] = [t[0], t[1], t[2]].map(|i| geom.vertices[i as usize]);
            let cx = (a[0] + b[0] + c[0]) / 3.0;
            let cy = (a[1] + b[1] + c[1]) / 3.0;
            let cell = cell_index(cx, cy, ctx.cols, ctx.rows);
            part.tris.push((cell, [t[0] + base, t[1] + base, t[2] + base]));
        }
    } else {
        let start = part.t_fill_idx.len() as u32;
        part.t_fill_idx.extend(geom.indices.iter().map(|i| i + base));
        let bounds = clip::bounds(geom.vertices.iter().copied());
        push_stream(part, stream::FILLS, start, geom.indices.len() as u32, 0, bounds);
    }
}

fn stroke_tessellate(runs: &[(Vec<[f32; 2]>, bool)], it: &Item, slot: u32, opaque: bool, part: &mut Part, ctx: &Ctx) {
    let mut b = LyonPath::builder();
    let mut any = false;
    for (p, closed) in runs {
        if p.len() < 2 {
            continue;
        }
        b.begin(point(p[0][0], p[0][1]));
        for q in &p[1..] {
            b.line_to(point(q[0], q[1]));
        }
        b.end(*closed);
        any = true;
    }
    if !any {
        return;
    }
    let path = b.build();
    let cap = match it.cap {
        cap::ROUND => tess::LineCap::Round,
        cap::SQUARE => tess::LineCap::Square,
        _ => tess::LineCap::Butt,
    };
    let join = match it.join {
        join::ROUND => tess::LineJoin::Round,
        join::BEVEL => tess::LineJoin::Bevel,
        _ => tess::LineJoin::MiterClip,
    };
    let opts = tess::StrokeOptions::tolerance(0.01)
        .with_line_width(it.width)
        .with_line_cap(cap)
        .with_line_join(join)
        .with_miter_limit(it.miter_limit.max(1.0));
    let mut geom: tess::VertexBuffers<[f32; 2], u32> = tess::VertexBuffers::new();
    if tess::StrokeTessellator::new()
        .tessellate_path(&path, &opts, &mut tess::BuffersBuilder::new(&mut geom, |v: tess::StrokeVertex| v.position().to_array()))
        .is_err()
    {
        return;
    }
    push_triangles(&geom, slot, opaque, part, ctx);
}

fn emit_image(
    ctx: &Ctx,
    _items: &[GpuItem],
    index: u32,
    it: &Item,
    clip_rect: Rect,
    shapes: Option<&clip::Shapes>,
    part: &mut Part,
) {
    let Some(img) = ctx.content.images.get(it.image as usize) else { return };
    if img.width == 0 || img.height == 0 {
        return;
    }
    let t = img.transform;
    let quad = [t.apply_f32(0.0, 0.0), t.apply_f32(1.0, 0.0), t.apply_f32(1.0, 1.0), t.apply_f32(0.0, 1.0)];
    let qb = clip::bounds(quad.iter().copied());
    if !clip::rect_overlaps(qb, clip_rect) {
        part.dropped += 1;
        return;
    }
    let Some(inv) = t.invert() else { return };
    let mut contours: Vec<Vec<[f32; 2]>> = vec![clip::polygon_rect(&quad, clip_rect)];
    if let Some(shapes) = shapes {
        contours = clip::polygons_shapes(&contours, fill::NONZERO, shapes)
            .iter()
            .flatten()
            .map(|c| c.iter().map(|&[x, y]| [x as f32, y as f32]).collect())
            .collect();
    }
    contours.retain(|c| c.len() > 2);
    if contours.is_empty() {
        part.dropped += 1;
        return;
    }
    let mut b = LyonPath::builder();
    for p in &contours {
        b.begin(point(p[0][0], p[0][1]));
        for q in &p[1..] {
            b.line_to(point(q[0], q[1]));
        }
        b.end(true);
    }
    let mut geom: tess::VertexBuffers<[f32; 2], u32> = tess::VertexBuffers::new();
    if tess::FillTessellator::new()
        .tessellate_path(&b.build(), &tess::FillOptions::tolerance(0.01), &mut tess::BuffersBuilder::new(&mut geom, |v: tess::FillVertex| v.position().to_array()))
        .is_err()
    {
        return;
    }
    let slot = 2 * index;
    let base = part.image_verts.len() as u32;
    part.image_verts.extend(geom.vertices.iter().map(|&pos| {
        let uv = inv.apply(pos[0] as f64, pos[1] as f64);
        ImageVert { pos, uv: [uv[0] as f32, uv[1] as f32], item: slot }
    }));
    let start = part.image_idx.len() as u32;
    part.image_idx.extend(geom.indices.iter().map(|i| i + base));
    // Page-space size of the image's edges decides the resolution worth keeping.
    let edge = |a: [f32; 2], b: [f32; 2]| ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
    let want_w = (edge(quad[0], quad[1]) * ctx.opts.image_px_per_pt).ceil() as u32;
    let want_h = (edge(quad[0], quad[3]) * ctx.opts.image_px_per_pt).ceil() as u32;
    let scene_img = downsample(img, want_w.max(1), want_h.max(1), ctx.opts.max_image_side);
    let local = part.images.len() as u32;
    part.images.push((index, scene_img));
    let bounds = clip::bounds(geom.vertices.iter().copied());
    push_stream(part, stream::IMAGE, start, geom.indices.len() as u32, local, bounds);
}

/// Halves an image (box filter) along each axis until that axis is no more than twice what the
/// page can show and fits the side limit.
pub fn downsample(img: &Image, want_w: u32, want_h: u32, max_side: u32) -> SceneImage {
    let (mut w, mut h) = (img.width, img.height);
    let mut px = img.rgba.clone();
    loop {
        let hx = w > 1 && (w > want_w * 2 || w > max_side);
        let hy = h > 1 && (h > want_h * 2 || h > max_side);
        if !hx && !hy {
            break;
        }
        let (fx, fy) = (if hx { 2 } else { 1 }, if hy { 2 } else { 1 });
        let nw = w.div_ceil(fx);
        let nh = h.div_ceil(fy);
        let mut out = vec![0u8; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                let mut acc = [0u32; 4];
                let mut n = 0;
                for dy in 0..fy {
                    for dx in 0..fx {
                        let sx = (fx * x + dx).min(w - 1);
                        let sy = (fy * y + dy).min(h - 1);
                        let i = ((sy * w + sx) * 4) as usize;
                        for c in 0..4 {
                            acc[c] += px[i + c] as u32;
                        }
                        n += 1;
                    }
                }
                let o = ((y * nw + x) * 4) as usize;
                for c in 0..4 {
                    out[o + c] = (acc[c] / n) as u8;
                }
            }
        }
        px = out;
        w = nw;
        h = nh;
    }
    SceneImage { width: w, height: h, rgba: px, smooth: img.smooth }
}

fn merge(parts: Vec<Part>, cols: u32, rows: u32) -> Scene {
    let ncells = (cols * rows) as usize;
    let mut s = Scene { cols, rows, ..Default::default() };
    let total_segs: usize = parts.iter().map(|p| p.segs.len()).sum();
    let total_tris: usize = parts.iter().map(|p| p.tris.len()).sum();
    let mut segs_unsorted: Vec<StrokeSeg> = Vec::with_capacity(total_segs);
    let mut tris_unsorted: Vec<(u32, [u32; 3])> = Vec::with_capacity(total_tris);
    for p in parts {
        let vbase = s.fill_verts.len() as u32;
        let tsbase = s.t_segs.len() as u32;
        let tfbase = s.t_fill_idx.len() as u32;
        let ivbase = s.image_verts.len() as u32;
        let iibase = s.image_idx.len() as u32;
        let imgbase = s.images.len() as u32;
        segs_unsorted.extend_from_slice(&p.segs);
        tris_unsorted.extend(p.tris.iter().map(|&(c, t)| (c, t.map(|i| i + vbase))));
        s.fill_verts.extend_from_slice(&p.fill_verts);
        s.t_segs.extend_from_slice(&p.t_segs);
        s.t_fill_idx.extend(p.t_fill_idx.iter().map(|i| i + vbase));
        s.image_verts.extend_from_slice(&p.image_verts);
        s.image_idx.extend(p.image_idx.iter().map(|i| i + ivbase));
        s.images.extend(p.images.into_iter().map(|(_, im)| im));
        for e in p.stream {
            let (start, image) = match e.kind {
                stream::STROKES => (e.start + tsbase, 0),
                stream::FILLS => (e.start + tfbase, 0),
                _ => (e.start + iibase, e.image + imgbase),
            };
            let entry = StreamEntry { start, image, ..e };
            if let Some(last) = s.stream.last_mut()
                && last.kind == entry.kind
                && entry.kind != stream::IMAGE
                && last.start + last.count == entry.start
            {
                last.count += entry.count;
                last.bounds = [
                    last.bounds[0].min(entry.bounds[0]),
                    last.bounds[1].min(entry.bounds[1]),
                    last.bounds[2].max(entry.bounds[2]),
                    last.bounds[3].max(entry.bounds[3]),
                ];
            } else {
                s.stream.push(entry);
            }
        }
        s.stats.dropped_items += p.dropped;
    }

    // Counting sort of opaque segments and triangles by cell (stable, so paint order holds
    // within a cell, which keeps memory access ordered).
    let empty: Rect = [f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY];
    let mut counts = vec![0u32; ncells];
    for sg in &segs_unsorted {
        counts[sg.cell as usize] += 1;
    }
    s.seg_cells = prefix(&counts);
    let mut next: Vec<u32> = s.seg_cells.iter().map(|r| r[0]).collect();
    s.segs = vec![StrokeSeg::default(); segs_unsorted.len()];
    s.seg_cell_bounds = vec![empty; ncells];
    for sg in segs_unsorted {
        let c = sg.cell as usize;
        s.segs[next[c] as usize] = sg;
        next[c] += 1;
    }
    for c in 0..ncells {
        let [start, count] = s.seg_cells[c];
        let center = cell_center(c as u32, cols);
        let mut b = empty;
        for sg in &s.segs[start as usize..(start + count) as usize] {
            b = grow(b, dequant(sg.p0, center));
            b = grow(b, dequant(sg.p1, center));
        }
        s.seg_cell_bounds[c] = b;
    }

    counts.iter_mut().for_each(|v| *v = 0);
    for (c, _) in &tris_unsorted {
        counts[*c as usize] += 1;
    }
    let tri_cells = prefix(&counts);
    s.fill_cells = tri_cells.iter().map(|r| [r[0] * 3, r[1] * 3]).collect();
    let mut next: Vec<u32> = tri_cells.iter().map(|r| r[0]).collect();
    s.fill_idx = vec![0; tris_unsorted.len() * 3];
    s.fill_cell_bounds = vec![empty; ncells];
    for (c, t) in tris_unsorted {
        let c = c as usize;
        let at = next[c] as usize * 3;
        s.fill_idx[at..at + 3].copy_from_slice(&t);
        next[c] += 1;
        for i in t {
            s.fill_cell_bounds[c] = grow(s.fill_cell_bounds[c], s.fill_verts[i as usize].pos);
        }
    }
    s
}

fn prefix(counts: &[u32]) -> Vec<[u32; 2]> {
    let mut at = 0u32;
    counts
        .iter()
        .map(|&n| {
            let r = [at, n];
            at += n;
            r
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{Affine, ContentBuilder, NONE, rgba};

    fn line_item(width: f32, color: u32) -> Item {
        Item { stroked: 1, width, stroke_color: color, clip: NONE, layer: NONE, miter_limit: 10.0, ..Default::default() }
    }

    #[test]
    fn segments_land_in_cells_and_round_trip() {
        let mut b = ContentBuilder::new([1000.0, 500.0]);
        let s = b.begin_path();
        b.move_to([10.0, 10.0]);
        b.line_to([900.0, 400.0]);
        b.finish_path(s, line_item(0.0, rgba(0, 0, 0, 255)));
        let scene = build_scene(&b.finish(), &SceneOptions::default());
        assert_eq!(scene.cols, 8);
        assert_eq!(scene.rows, 4);
        // 970 pt long: split into 8 pieces of at most 128 pt.
        assert_eq!(scene.segs.len(), 8);
        let (a, _) = scene.seg_points(&scene.segs.iter().find(|s| s.flags & 3 == end::BUTT).unwrap());
        assert!((a[0] - 10.0).abs() < 0.01 && (a[1] - 10.0).abs() < 0.01);
        for sg in &scene.segs {
            let (p, q) = scene.seg_points(sg);
            let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
            assert_eq!(scene.cell_of(mid[0], mid[1]), sg.cell as u32);
        }
        // Every segment is listed under its cell.
        let listed: u32 = scene.seg_cells.iter().map(|r| r[1]).sum();
        assert_eq!(listed, 8);
    }

    #[test]
    fn paint_order_is_depth_order() {
        let mut b = ContentBuilder::new([100.0, 100.0]);
        for _ in 0..3 {
            let s = b.begin_path();
            b.move_to([0.0, 0.0]);
            b.line_to([50.0, 50.0]);
            b.finish_path(s, line_item(0.5, rgba(0, 0, 0, 255)));
        }
        let scene = build_scene(&b.finish(), &SceneOptions::default());
        let d: Vec<f32> = scene.segs.iter().map(|s| scene.items[s.item as usize].depth).collect();
        assert!(d.windows(2).all(|w| w[1] < w[0]), "{d:?}");
    }

    #[test]
    fn clipping_and_dropping() {
        let mut b = ContentBuilder::new([200.0, 200.0]);
        let s = b.begin_path();
        b.move_to([20.0, 20.0]);
        b.line_to([60.0, 20.0]);
        b.line_to([60.0, 60.0]);
        b.line_to([20.0, 60.0]);
        b.close();
        let clip = b.finish_clip(s, fill::NONZERO, NONE);
        // Crosses the clip: cut to 20..60.
        let s = b.begin_path();
        b.move_to([0.0, 40.0]);
        b.line_to([200.0, 40.0]);
        b.finish_path(s, Item { clip, ..line_item(0.0, rgba(255, 0, 0, 255)) });
        // Outside the clip: dropped.
        let s = b.begin_path();
        b.move_to([100.0, 100.0]);
        b.line_to([150.0, 150.0]);
        b.finish_path(s, Item { clip, ..line_item(0.0, rgba(255, 0, 0, 255)) });
        let scene = build_scene(&b.finish(), &SceneOptions::default());
        assert_eq!(scene.stats.dropped_items, 1);
        assert_eq!(scene.segs.len(), 1);
        let (p, q) = scene.seg_points(&scene.segs[0]);
        assert!((p[0] - 20.0).abs() < 0.01 && (q[0] - 60.0).abs() < 0.01);
    }

    #[test]
    fn fills_tessellate_and_transparency_streams() {
        let mut b = ContentBuilder::new([200.0, 200.0]);
        for alpha in [255u8, 128] {
            let s = b.begin_path();
            b.move_to([10.0, 10.0]);
            b.line_to([110.0, 10.0]);
            b.line_to([110.0, 110.0]);
            b.line_to([10.0, 110.0]);
            b.close();
            b.finish_path(
                s,
                Item { fill_rule: fill::NONZERO, fill_color: rgba(0, 0, 255, alpha), clip: NONE, layer: NONE, ..Default::default() },
            );
        }
        let scene = build_scene(&b.finish(), &SceneOptions::default());
        assert_eq!(scene.fill_idx.len(), 6);
        assert_eq!(scene.t_fill_idx.len(), 6);
        assert_eq!(scene.stream.len(), 1);
        assert_eq!(scene.stream[0].kind, stream::FILLS);
    }

    #[test]
    fn dashes() {
        let mut out = Vec::new();
        apply_dash(&[[0.0, 0.0], [10.0, 0.0]], false, &[2.0, 3.0], 0.0, &mut out);
        let xs: Vec<(f32, f32)> = out.iter().map(|r| (r[0][0], r.last().unwrap()[0])).collect();
        assert_eq!(xs, vec![(0.0, 2.0), (5.0, 7.0)]);
        out.clear();
        apply_dash(&[[0.0, 0.0], [10.0, 0.0]], false, &[2.0, 3.0], 1.0, &mut out);
        let xs: Vec<(f32, f32)> = out.iter().map(|r| (r[0][0], r.last().unwrap()[0])).collect();
        assert_eq!(xs, vec![(0.0, 1.0), (4.0, 6.0), (9.0, 10.0)]);
    }

    #[test]
    fn thick_strokes_tessellate_over_segments() {
        let mut b = ContentBuilder::new([100.0, 100.0]);
        let s = b.begin_path();
        b.move_to([10.0, 10.0]);
        b.line_to([90.0, 10.0]);
        b.line_to([90.0, 90.0]);
        b.finish_path(s, line_item(4.0, rgba(0, 0, 0, 255)));
        let scene = build_scene(&b.finish(), &SceneOptions::default());
        assert_eq!(scene.segs.len(), 2);
        assert!(!scene.fill_idx.is_empty());
    }

    #[test]
    fn images_downsample_and_clip() {
        let mut b = ContentBuilder::new([100.0, 100.0]);
        let img = Image {
            width: 4000,
            height: 10,
            rgba: vec![200; 4000 * 10 * 4],
            transform: Affine::new(50.0, 0.0, 0.0, 10.0, 0.0, 0.0),
            opacity: 1.0,
            smooth: true,
        };
        b.add_image(img, NONE, NONE);
        let scene = build_scene(&b.finish(), &SceneOptions::default());
        assert_eq!(scene.images.len(), 1);
        // 50 pt wide at 12 px/pt needs 600 px; halving from 4000 stops at 1000.
        assert_eq!(scene.images[0].width, 1000);
        assert_eq!(scene.stream[0].kind, stream::IMAGE);
        let v = scene.image_verts.iter().find(|v| v.pos == [50.0, 10.0]).unwrap();
        assert_eq!(v.uv, [1.0, 1.0]);
    }
}
