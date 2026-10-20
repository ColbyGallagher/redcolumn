//! Scene tiles drawn on the CPU: the GPU renderer's rules (`rc-gpu`'s `scene.wgsl`) in software,
//! for machines whose GPU is a software rasteriser (WARP, llvmpipe) and as a check on the GPU.
//!
//! A tile is drawn alone, single-threaded, so the view draws many at once on the rayon pool (the
//! way MuPDF and open-pdf-studio split a page). The scene's 128 pt cells are the spatial index: a
//! tile only touches the segments and triangles of the cells it overlaps, put back in paint order
//! by their depth.
//!
//! - Strokes: the shader's coverage (a box filter across and along the line, distance for round
//!   ends, at least a hairline wide), blended by coverage.
//! - Fills and images: triangles sampled at pixel centres with the top-left rule, so shared edges
//!   are drawn once. Drawing at 2× and averaging gives their edges four levels of smoothing, as
//!   the GPU's 4× MSAA does.
//! - Transparent parts and images blend in paint order; opaque parts overwrite.

use rc_scene::Scene;
use rc_scene::clip::rect_overlaps;
use rc_scene::scene::{CELL, QUANT, StrokeSeg, end, stream};
use std::sync::Arc;

/// Page space to pixels: `x' = a x + c y + e`, `y' = b x + d y + f` (as `rc_gpu::Affine2`).
pub type Affine2 = [f32; 6];

/// A scene ready for the CPU: the scene, its images' mip levels, and its widest stroke.
pub struct CpuScene {
    pub scene: Arc<Scene>,
    mips: Vec<Vec<Mip>>,
    reach: f32,
}

struct Mip {
    w: u32,
    h: u32,
    rgba: Vec<u8>,
}

impl CpuScene {
    pub fn new(scene: Arc<Scene>) -> Self {
        let mips = scene
            .images
            .iter()
            .map(|i| mip_chain(i.width, i.height, &i.rgba))
            .collect();
        let reach = scene.items.iter().map(|i| i.width).fold(0.0f32, f32::max) * 0.5 + 0.5;
        Self { scene, mips, reach }
    }

    /// Bytes held (for the view's memory budget).
    pub fn bytes(&self) -> u64 {
        let s = &self.scene;
        let geometry = s.segs.len() * 16
            + s.t_segs.len() * 16
            + s.fill_verts.len() * 12
            + (s.fill_idx.len() + s.t_fill_idx.len() + s.image_idx.len()) * 4
            + s.image_verts.len() * 20
            + s.items.len() * 16;
        let images: usize = self.mips.iter().flatten().map(|m| m.rgba.len()).sum();
        (geometry + images) as u64
    }
}

/// Which layers are drawn, as the GPU's bit mask: bit `i` set when layer `i` is visible.
pub fn layer_mask(scene: &Scene, hidden: &[usize]) -> Vec<u32> {
    let n = scene.layers.len();
    let mut mask = vec![u32::MAX; n.div_ceil(32).max(1)];
    for &l in scene
        .layers_off
        .iter()
        .map(|l| *l as usize)
        .collect::<Vec<_>>()
        .iter()
        .chain(hidden)
    {
        if l < n {
            mask[l / 32] &= !(1 << (l % 32));
        }
    }
    mask
}

fn visible(mask: &[u32], layer: u32) -> bool {
    layer == u32::MAX
        || mask
            .get(layer as usize / 32)
            .is_none_or(|w| (w >> (layer % 32)) & 1 == 1)
}

/// What to draw, in paint order once sorted by depth.
#[derive(Clone, Copy)]
enum Op {
    Seg { seg: u32, transparent: bool },
    Tri { first: u32, transparent: bool },
    Image { first: u32, image: u32 },
}

/// Draws a tile `size` pixels wide and high: `transform` maps page space to the tile's pixels.
/// `ss` is the supersampling (strokes are at least `ss` sub-pixels, one pixel, wide); `thin`
/// draws every stroke as a hairline; `layers` is from [`layer_mask`]. Returns straight RGBA,
/// opaque (the page is white).
pub fn render_tile(cs: &CpuScene, transform: Affine2, size: [u32; 2], ss: u32, thin: bool, layers: &[u32]) -> Vec<u8> {
    let ss = ss.max(1);
    let f = ss as f32;
    let t = transform.map(|v| v * f);
    let (w, h) = (size[0] * ss, size[1] * ss);
    let mut buf = Buffer {
        w,
        h,
        px: vec![255u8; (w * h * 4) as usize],
    };
    let scene = &*cs.scene;
    let scale = (t[0] * t[3] - t[1] * t[2]).abs().sqrt();
    if scale <= 0.0 || w == 0 || h == 0 {
        return vec![255; (size[0] * size[1] * 4) as usize];
    }
    // The tile in page space, with room for strokes reaching into it.
    let Some(inv) = invert(&t) else {
        return vec![255; (size[0] * size[1] * 4) as usize];
    };
    let corners = [[0.0, 0.0], [w as f32, 0.0], [0.0, h as f32], [w as f32, h as f32]].map(|p| apply(&inv, p));
    let px = 2.0 / scale;
    let m = cs.reach + px;
    let area = [
        corners.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min) - m,
        corners.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min) - m,
        corners.iter().map(|p| p[0]).fold(f32::NEG_INFINITY, f32::max) + m,
        corners.iter().map(|p| p[1]).fold(f32::NEG_INFINITY, f32::max) + m,
    ];

    // Gather, with each part's depth.
    let mut ops: Vec<(f32, Op)> = Vec::new();
    for (i, &[start, count]) in scene.seg_cells.iter().enumerate() {
        if count == 0 || !rect_overlaps(scene.seg_cell_bounds[i], area) {
            continue;
        }
        for s in start..start + count {
            let item = &scene.items[scene.segs[s as usize].item as usize];
            if visible(layers, item.layer) {
                ops.push((
                    item.depth,
                    Op::Seg {
                        seg: s,
                        transparent: false,
                    },
                ));
            }
        }
    }
    for (i, &[start, count]) in scene.fill_cells.iter().enumerate() {
        if count == 0 || !rect_overlaps(scene.fill_cell_bounds[i], area) {
            continue;
        }
        for k in (start..start + count).step_by(3) {
            let item = &scene.items[scene.fill_verts[scene.fill_idx[k as usize] as usize].item as usize];
            if visible(layers, item.layer) {
                ops.push((
                    item.depth,
                    Op::Tri {
                        first: k,
                        transparent: false,
                    },
                ));
            }
        }
    }
    for e in &scene.stream {
        if !rect_overlaps(e.bounds, area) {
            continue;
        }
        match e.kind {
            stream::STROKES => {
                for s in e.start..e.start + e.count {
                    let item = &scene.items[scene.t_segs[s as usize].item as usize];
                    if visible(layers, item.layer) {
                        ops.push((
                            item.depth,
                            Op::Seg {
                                seg: s,
                                transparent: true,
                            },
                        ));
                    }
                }
            }
            stream::FILLS => {
                for k in (e.start..e.start + e.count).step_by(3) {
                    let item = &scene.items[scene.fill_verts[scene.t_fill_idx[k as usize] as usize].item as usize];
                    if visible(layers, item.layer) {
                        ops.push((
                            item.depth,
                            Op::Tri {
                                first: k,
                                transparent: true,
                            },
                        ));
                    }
                }
            }
            _ => {
                for k in (e.start..e.start + e.count).step_by(3) {
                    let item = &scene.items[scene.image_verts[scene.image_idx[k as usize] as usize].item as usize];
                    if visible(layers, item.layer) {
                        ops.push((
                            item.depth,
                            Op::Image {
                                first: k,
                                image: e.image,
                            },
                        ));
                    }
                }
            }
        }
    }
    // Paint order: earlier parts are farther (larger depth). Stable, so a run keeps its order.
    ops.sort_by(|a, b| b.0.total_cmp(&a.0));

    let hairline = f;
    for &(_, op) in &ops {
        match op {
            Op::Seg { seg, transparent } => {
                let s = if transparent {
                    &scene.t_segs[seg as usize]
                } else {
                    &scene.segs[seg as usize]
                };
                let item = &scene.items[s.item as usize];
                let mut width = if thin { 0.0 } else { item.width * scale };
                width = width.max(hairline);
                let (a, b) = seg_ends(scene, s);
                draw_segment(
                    &mut buf,
                    apply(&t, a),
                    apply(&t, b),
                    width * 0.5,
                    s.flags,
                    item.color,
                    transparent,
                );
            }
            Op::Tri { first, transparent } => {
                let idx = if transparent {
                    &scene.t_fill_idx
                } else {
                    &scene.fill_idx
                };
                let v = [0, 1, 2].map(|j| &scene.fill_verts[idx[(first + j) as usize] as usize]);
                let color = scene.items[v[0].item as usize].color;
                let p = v.map(|v| apply(&t, v.pos));
                fill_triangle(&mut buf, p, |_, _| Some(unpack(color)), transparent);
            }
            Op::Image { first, image } => {
                let v = [0, 1, 2].map(|j| &scene.image_verts[scene.image_idx[(first + j) as usize] as usize]);
                let alpha = (scene.items[v[0].item as usize].color >> 24) as f32 / 255.0;
                let Some(levels) = cs.mips.get(image as usize) else {
                    continue;
                };
                let p = v.map(|v| apply(&t, v.pos));
                let uv = v.map(|v| v.uv);
                let mip = pick_mip(levels, p, uv);
                fill_triangle(
                    &mut buf,
                    p,
                    |l0, l1| {
                        let u = uv[0][0] * (1.0 - l0 - l1) + uv[1][0] * l0 + uv[2][0] * l1;
                        let vv = uv[0][1] * (1.0 - l0 - l1) + uv[1][1] * l0 + uv[2][1] * l1;
                        let c = sample(mip, u, vv);
                        Some([c[0], c[1], c[2], c[3] * alpha])
                    },
                    true,
                );
            }
        }
    }
    box_down(&buf.px, w, h, ss)
}

struct Buffer {
    w: u32,
    h: u32,
    px: Vec<u8>,
}

impl Buffer {
    /// Blends a straight colour over a pixel with the given opacity.
    #[inline]
    fn blend(&mut self, x: u32, y: u32, c: [f32; 3], a: f32) {
        if a <= 0.0 {
            return;
        }
        let i = ((y * self.w + x) * 4) as usize;
        let p = &mut self.px[i..i + 3];
        if a >= 1.0 {
            for k in 0..3 {
                p[k] = (c[k] * 255.0 + 0.5) as u8;
            }
        } else {
            for k in 0..3 {
                let d = p[k] as f32;
                p[k] = (d + (c[k] * 255.0 - d) * a + 0.5) as u8;
            }
        }
    }
}

fn unpack(c: u32) -> [f32; 4] {
    [
        (c & 255) as f32 / 255.0,
        ((c >> 8) & 255) as f32 / 255.0,
        ((c >> 16) & 255) as f32 / 255.0,
        (c >> 24) as f32 / 255.0,
    ]
}

fn apply(m: &Affine2, p: [f32; 2]) -> [f32; 2] {
    [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

fn invert(m: &Affine2) -> Option<Affine2> {
    let det = m[0] * m[3] - m[1] * m[2];
    if det.abs() < 1e-12 {
        return None;
    }
    let (a, b, c, d) = (m[3] / det, -m[1] / det, -m[2] / det, m[0] / det);
    Some([a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])])
}

/// A segment's ends in page space.
fn seg_ends(scene: &Scene, s: &StrokeSeg) -> ([f32; 2], [f32; 2]) {
    let cell = s.cell as u32;
    let c = [
        ((cell % scene.cols) as f32 + 0.5) * CELL,
        ((cell / scene.cols) as f32 + 0.5) * CELL,
    ];
    let a = [c[0] + s.p0[0] as f32 / QUANT, c[1] + s.p0[1] as f32 / QUANT];
    let b = [c[0] + s.p1[0] as f32 / QUANT, c[1] + s.p1[1] as f32 / QUANT];
    (a, b)
}

/// One stroke segment, with the shader's coverage, over the pixels of its quad.
fn draw_segment(buf: &mut Buffer, a: [f32; 2], b: [f32; 2], hw: f32, flags: u16, color: u32, transparent: bool) {
    let d = [b[0] - a[0], b[1] - a[1]];
    let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
    let dir = if len > 1e-6 {
        [d[0] / len, d[1] / len]
    } else {
        [1.0, 0.0]
    };
    let nrm = [-dir[1], dir[0]];
    let cap0 = flags & 3;
    let cap1 = (flags >> 2) & 3;
    let e0 = if cap0 != end::BUTT { hw } else { 0.0 } + 1.0;
    let e1 = if cap1 != end::BUTT { hw } else { 0.0 } + 1.0;
    let at = |along: f32, across: f32| {
        [
            a[0] + dir[0] * along + nrm[0] * across,
            a[1] + dir[1] * along + nrm[1] * across,
        ]
    };
    let quad = [
        at(-e0, -hw - 1.0),
        at(len + e1, -hw - 1.0),
        at(len + e1, hw + 1.0),
        at(-e0, hw + 1.0),
    ];
    let foot = 0.5 * (dir[0].abs() + dir[1].abs());
    let start = if cap0 == end::SQUARE { -hw } else { 0.0 };
    let stop = if cap1 == end::SQUARE { len + hw } else { len };
    let c = unpack(color);
    let rgb = [c[0], c[1], c[2]];
    scan_convex(buf, &quad, |buf, x, y| {
        let p = [x as f32 + 0.5 - a[0], y as f32 + 0.5 - a[1]];
        let lx = p[0] * dir[0] + p[1] * dir[1];
        let ly = p[0] * nrm[0] + p[1] * nrm[1];
        let cov = if lx < 0.0 && cap0 == end::ROUND {
            (hw - (lx * lx + ly * ly).sqrt() + 0.5).clamp(0.0, 1.0)
        } else if lx > len && cap1 == end::ROUND {
            let dx = lx - len;
            (hw - (dx * dx + ly * ly).sqrt() + 0.5).clamp(0.0, 1.0)
        } else {
            let across = ((hw.min(ly + foot) - (-hw).max(ly - foot)) / (2.0 * foot)).clamp(0.0, 1.0);
            let along = ((stop.min(lx + 0.5)) - (start.max(lx - 0.5))).clamp(0.0, 1.0);
            across * along
        };
        let alpha = if transparent { c[3] * cov } else { cov };
        buf.blend(x, y, rgb, alpha);
    });
}

/// Calls `f` for every pixel whose centre is inside a convex polygon (any winding).
fn scan_convex(buf: &mut Buffer, poly: &[[f32; 2]], mut f: impl FnMut(&mut Buffer, u32, u32)) {
    let y0 = poly.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min);
    let y1 = poly.iter().map(|p| p[1]).fold(f32::NEG_INFINITY, f32::max);
    let ya = (y0 - 0.5).ceil().max(0.0) as i64;
    let yb = ((y1 - 0.5).floor() as i64).min(buf.h as i64 - 1);
    for y in ya..=yb {
        let cy = y as f32 + 0.5;
        let (mut xl, mut xr) = (f32::INFINITY, f32::NEG_INFINITY);
        for i in 0..poly.len() {
            let p = poly[i];
            let q = poly[(i + 1) % poly.len()];
            if (p[1] <= cy && q[1] >= cy) || (q[1] <= cy && p[1] >= cy) {
                let x = if (q[1] - p[1]).abs() < 1e-12 {
                    p[0].min(q[0])
                } else {
                    p[0] + (cy - p[1]) / (q[1] - p[1]) * (q[0] - p[0])
                };
                let x2 = if (q[1] - p[1]).abs() < 1e-12 { p[0].max(q[0]) } else { x };
                xl = xl.min(x);
                xr = xr.max(x2);
            }
        }
        if xl > xr {
            continue;
        }
        let xa = (xl - 0.5).ceil().max(0.0) as i64;
        let xb = ((xr - 0.5).floor() as i64).min(buf.w as i64 - 1);
        for x in xa..=xb {
            f(buf, x as u32, y as u32);
        }
    }
}

/// A triangle sampled at pixel centres with the top-left rule. `shade` gets the barycentric
/// weights of the second and third vertices and gives a straight colour and opacity.
fn fill_triangle(
    buf: &mut Buffer,
    p: [[f32; 2]; 3],
    mut shade: impl FnMut(f32, f32) -> Option<[f32; 4]>,
    transparent: bool,
) {
    let area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    if area.abs() < 1e-9 || !area.is_finite() {
        return;
    }
    // Make the winding positive so "inside" is the same sign for every edge.
    let (v, flip) = if area < 0.0 {
        ([p[0], p[2], p[1]], true)
    } else {
        (p, false)
    };
    let area = area.abs();
    let x0 = v.iter().map(|q| q[0]).fold(f32::INFINITY, f32::min);
    let x1 = v.iter().map(|q| q[0]).fold(f32::NEG_INFINITY, f32::max);
    let y0 = v.iter().map(|q| q[1]).fold(f32::INFINITY, f32::min);
    let y1 = v.iter().map(|q| q[1]).fold(f32::NEG_INFINITY, f32::max);
    let xa = (x0 - 0.5).ceil().max(0.0) as i64;
    let xb = ((x1 - 0.5).floor() as i64).min(buf.w as i64 - 1);
    let ya = (y0 - 0.5).ceil().max(0.0) as i64;
    let yb = ((y1 - 0.5).floor() as i64).min(buf.h as i64 - 1);
    if xa > xb || ya > yb {
        return;
    }
    // Edge i is opposite vertex i: from v[(i+1)%3] to v[(i+2)%3].
    let edges = [0, 1, 2].map(|i| {
        let a = v[(i + 1) % 3];
        let b = v[(i + 2) % 3];
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        // y grows downward, positive winding: a top edge is horizontal going left... (dy == 0, dx < 0);
        // a left edge goes up (dy < 0).
        let top_left = (dy == 0.0 && dx < 0.0) || dy < 0.0;
        (a, dx, dy, top_left)
    });
    for y in ya..=yb {
        let cy = y as f32 + 0.5;
        for x in xa..=xb {
            let cx = x as f32 + 0.5;
            let mut w = [0f32; 3];
            let mut inside = true;
            for (i, &(a, dx, dy, tl)) in edges.iter().enumerate() {
                let e = dx * (cy - a[1]) - dy * (cx - a[0]);
                if e < 0.0 || (e == 0.0 && !tl) {
                    inside = false;
                    break;
                }
                w[i] = e;
            }
            if !inside {
                continue;
            }
            // Barycentric weights of the original second and third vertices.
            let (l1, l2) = if flip {
                (w[2] / area, w[1] / area)
            } else {
                (w[1] / area, w[2] / area)
            };
            if let Some(c) = shade(l1, l2) {
                let a = if transparent { c[3] } else { 1.0 };
                buf.blend(x as u32, y as u32, [c[0], c[1], c[2]], a);
            }
        }
    }
}

/// The mip level whose texels are about one pixel at this triangle's scale.
fn pick_mip(levels: &[Mip], p: [[f32; 2]; 3], uv: [[f32; 2]; 3]) -> &Mip {
    let base = &levels[0];
    let px_area = ((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0])).abs();
    let tx_area = ((uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[1][1] - uv[0][1]) * (uv[2][0] - uv[0][0])).abs()
        * base.w as f32
        * base.h as f32;
    if px_area <= 0.0 {
        return base;
    }
    let ratio = (tx_area / px_area).sqrt();
    let level = if ratio > 1.0 { ratio.log2().floor() as usize } else { 0 };
    &levels[level.min(levels.len() - 1)]
}

/// Bilinear sample, clamped to the edge; straight colour and alpha.
fn sample(m: &Mip, u: f32, v: f32) -> [f32; 4] {
    let x = (u * m.w as f32 - 0.5).clamp(0.0, m.w as f32 - 1.0);
    let y = (v * m.h as f32 - 0.5).clamp(0.0, m.h as f32 - 1.0);
    let (x0, y0) = (x.floor() as u32, y.floor() as u32);
    let (x1, y1) = ((x0 + 1).min(m.w - 1), (y0 + 1).min(m.h - 1));
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    let at = |x: u32, y: u32| {
        let i = ((y * m.w + x) * 4) as usize;
        [
            m.rgba[i] as f32,
            m.rgba[i + 1] as f32,
            m.rgba[i + 2] as f32,
            m.rgba[i + 3] as f32,
        ]
    };
    let (a, b, c, d) = (at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1));
    // Weight colour by alpha so transparent texels do not darken their neighbours.
    let mut out = [0f32; 4];
    let ws = [(1.0 - fx) * (1.0 - fy), fx * (1.0 - fy), (1.0 - fx) * fy, fx * fy];
    let mut wa = 0.0;
    for (t, wt) in [a, b, c, d].iter().zip(ws) {
        let al = t[3] / 255.0 * wt;
        for k in 0..3 {
            out[k] += t[k] / 255.0 * al;
        }
        wa += al;
    }
    if wa > 0.0 {
        for o in &mut out[..3] {
            *o /= wa;
        }
    }
    out[3] = wa;
    out
}

fn mip_chain(w: u32, h: u32, rgba: &[u8]) -> Vec<Mip> {
    let mut levels = vec![Mip {
        w,
        h,
        rgba: rgba.to_vec(),
    }];
    while let Some(l) = levels.last() {
        if l.w <= 1 && l.h <= 1 {
            break;
        }
        let (nw, nh) = ((l.w / 2).max(1), (l.h / 2).max(1));
        let mut out = vec![0u8; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                for c in 0..4 {
                    let mut acc = 0u32;
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let sx = (x * 2 + dx).min(l.w - 1);
                        let sy = (y * 2 + dy).min(l.h - 1);
                        acc += l.rgba[((sy * l.w + sx) * 4 + c) as usize] as u32;
                    }
                    out[((y * nw + x) * 4 + c) as usize] = (acc / 4) as u8;
                }
            }
        }
        levels.push(Mip {
            w: nw,
            h: nh,
            rgba: out,
        });
    }
    levels
}

/// Averages `f` × `f` blocks.
fn box_down(px: &[u8], w: u32, h: u32, f: u32) -> Vec<u8> {
    if f == 1 {
        return px.to_vec();
    }
    let (nw, nh) = (w / f, h / f);
    let mut out = vec![255u8; (nw * nh * 4) as usize];
    let n = f * f;
    for y in 0..nh {
        for x in 0..nw {
            for c in 0..3 {
                let mut acc = 0u32;
                for dy in 0..f {
                    let row = ((y * f + dy) * w + x * f) * 4 + c;
                    for dx in 0..f {
                        acc += px[(row + dx * 4) as usize] as u32;
                    }
                }
                out[((y * nw + x) * 4 + c) as usize] = ((acc + n / 2) / n) as u8;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use rc_scene::content::{ContentBuilder, Item, NONE, fill, rgba};

    fn path(b: &mut ContentBuilder, pts: &[[f32; 2]], close: bool, item: Item) {
        let start = b.begin_path();
        b.move_to(pts[0]);
        for p in &pts[1..] {
            b.line_to(*p);
        }
        if close {
            b.close();
        }
        b.finish_path(start, item);
    }

    #[test]
    fn hairline_and_fill() {
        let mut b = ContentBuilder::new([200.0, 100.0]);
        let base = Item {
            clip: NONE,
            layer: NONE,
            image: NONE,
            miter_limit: 10.0,
            ..Default::default()
        };
        let red = Item {
            fill_rule: fill::NONZERO,
            fill_color: rgba(255, 0, 0, 255),
            ..base
        };
        path(
            &mut b,
            &[[10.0, 10.0], [60.0, 10.0], [60.0, 40.0], [10.0, 40.0]],
            true,
            red,
        );
        let line = Item {
            stroked: 1,
            stroke_color: rgba(0, 0, 0, 255),
            width: 0.0,
            ..base
        };
        path(&mut b, &[[100.0, 50.0], [190.0, 50.0]], false, line);
        let cs = CpuScene::new(Arc::new(rc_scene::build_scene(&b.finish(), &Default::default())));
        let px = render_tile(
            &cs,
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            [200, 100],
            2,
            false,
            &layer_mask(&cs.scene, &[]),
        );
        let at = |x: usize, y: usize| px[(y * 200 + x) * 4..(y * 200 + x) * 4 + 3].to_vec();
        assert_eq!(at(30, 20), [255, 0, 0], "inside the red fill");
        assert_eq!(at(5, 5), [255, 255, 255], "outside is white");
        // A hairline is one pixel wide: centred on y = 50, it shades rows 49 and 50.
        let dark = (0..100).filter(|&y| at(150, y)[0] < 250).count();
        assert!((1..=2).contains(&dark), "hairline rows: {dark}");
    }
}
