//! Clipping done once at scene build time, so the GPU never clips.
//!
//! Most clips on drawings are rectangles (viewports, the page border), handled with
//! Liang–Barsky for lines and Sutherland–Hodgman for polygons. Any other clip shape is resolved
//! to polygons once per clip node and applied with boolean operations (`i_overlay`).

use crate::content::{PageContent, fill, flatten};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::clip::FloatClip;
use i_overlay::float::simplify::SimplifyShape;
use i_overlay::float::single::SingleFloatOverlay;
use i_overlay::string::clip::ClipRule;

/// Axis-aligned rectangle `[x0, y0, x1, y1]` with x0 <= x1, y0 <= y1.
pub type Rect = [f32; 4];

pub type Contour = Vec<[f64; 2]>;
pub type Shapes = Vec<Vec<Contour>>;

/// Flattening tolerance for clip paths, in points.
const CLIP_TOLERANCE: f32 = 0.01;

/// A clip node resolved to what it allows: a rectangle, and (when the clip is not just a
/// rectangle) polygons inside it, normalised so the non-zero rule applies.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedClip {
    pub rect: Rect,
    /// `None` when the clip is exactly `rect`.
    pub shapes: Option<Shapes>,
}

impl ResolvedClip {
    pub fn is_empty(&self) -> bool {
        self.rect[0] >= self.rect[2]
            || self.rect[1] >= self.rect[3]
            || self.shapes.as_ref().is_some_and(|s| s.is_empty())
    }
}

pub fn rect_intersect(a: Rect, b: Rect) -> Rect {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])]
}

pub fn rect_overlaps(a: Rect, b: Rect) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

pub fn rect_contains(outer: Rect, inner: Rect) -> bool {
    outer[0] <= inner[0] && outer[1] <= inner[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
}

pub fn bounds(points: impl IntoIterator<Item = [f32; 2]>) -> Rect {
    let mut r = [f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY];
    for [x, y] in points {
        r[0] = r[0].min(x);
        r[1] = r[1].min(y);
        r[2] = r[2].max(x);
        r[3] = r[3].max(y);
    }
    r
}

/// The rectangle a closed polyline is, if it is one (axis-aligned, 4 corners, optionally repeated
/// first point).
pub fn as_rect(poly: &[[f32; 2]]) -> Option<Rect> {
    let pts = match poly.len() {
        4 => poly,
        5 if poly[0] == poly[4] => &poly[..4],
        _ => return None,
    };
    let axis = |a: [f32; 2], b: [f32; 2]| a[0] == b[0] || a[1] == b[1];
    for i in 0..4 {
        if !axis(pts[i], pts[(i + 1) % 4]) {
            return None;
        }
    }
    let r = bounds(pts.iter().copied());
    // Each corner must be a corner of the bounds (rules out degenerate zig-zags).
    let corner = |p: [f32; 2]| (p[0] == r[0] || p[0] == r[2]) && (p[1] == r[1] || p[1] == r[3]);
    pts.iter().all(|&p| corner(p)).then_some(r)
}

/// Resolves the clip chain ending at `node` (or none) within `page` (the page's own bounds).
pub fn resolve(content: &PageContent, node: u32, page: Rect) -> ResolvedClip {
    let mut rect = page;
    let mut shape_list: Vec<Shapes> = Vec::new();
    let mut n = node;
    while n != crate::content::NONE {
        let Some(c) = content.clips.get(n as usize) else { break };
        let polys = flatten(content.clip_path(c), CLIP_TOLERANCE);
        // A clip path's subpaths are implicitly closed.
        let rect_only = polys.len() == 1 && as_rect(&polys[0].0).is_some();
        if rect_only {
            rect = rect_intersect(rect, as_rect(&polys[0].0).unwrap());
        } else if polys.is_empty() {
            // An empty clip path clips everything away.
            return ResolvedClip {
                rect: [0.0; 4],
                shapes: Some(Vec::new()),
            };
        } else {
            let contours: Vec<Contour> = polys.iter().map(|(p, _)| to_f64(p)).collect();
            let rule = if c.rule == fill::EVENODD {
                FillRule::EvenOdd
            } else {
                FillRule::NonZero
            };
            shape_list.push(contours.simplify_shape(rule));
        }
        n = c.parent;
    }
    if shape_list.is_empty() {
        return ResolvedClip { rect, shapes: None };
    }
    // Intersect every non-rectangular clip, then the rectangle, into one set of shapes.
    let mut acc = shape_list.pop().unwrap();
    for s in shape_list {
        acc = acc.overlay(&s, OverlayRule::Intersect, FillRule::NonZero);
    }
    let all = shapes_bounds(&acc);
    if !rect_contains(rect, all) {
        let r = rect_contour(rect);
        acc = acc.overlay(&r, OverlayRule::Intersect, FillRule::NonZero);
    }
    let rect = rect_intersect(rect, shapes_bounds(&acc));
    ResolvedClip {
        rect,
        shapes: Some(acc),
    }
}

fn to_f64(p: &[[f32; 2]]) -> Contour {
    p.iter().map(|&[x, y]| [x as f64, y as f64]).collect()
}

fn rect_contour(r: Rect) -> Contour {
    let [x0, y0, x1, y1] = r.map(|v| v as f64);
    vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

pub fn shapes_bounds(s: &Shapes) -> Rect {
    bounds(s.iter().flatten().flatten().map(|&[x, y]| [x as f32, y as f32]))
}

/// Clips an open polyline to a rectangle (Liang–Barsky), keeping connected runs together.
pub fn polyline_rect(poly: &[[f32; 2]], r: Rect, out: &mut Vec<Vec<[f32; 2]>>) {
    let mut cur: Vec<[f32; 2]> = Vec::new();
    for w in poly.windows(2) {
        match segment_rect(w[0], w[1], r) {
            Some((a, b)) => {
                if cur.last() != Some(&a) {
                    if cur.len() > 1 {
                        out.push(std::mem::take(&mut cur));
                    }
                    cur.clear();
                    cur.push(a);
                }
                cur.push(b);
            }
            None => {
                if cur.len() > 1 {
                    out.push(std::mem::take(&mut cur));
                }
                cur.clear();
            }
        }
    }
    if cur.len() > 1 {
        out.push(cur);
    }
}

/// The part of segment `a`–`b` inside `r`, if any.
pub fn segment_rect(a: [f32; 2], b: [f32; 2], r: Rect) -> Option<([f32; 2], [f32; 2])> {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let mut t0 = 0.0f32;
    let mut t1 = 1.0f32;
    for (p, q) in [
        (-dx, a[0] - r[0]),
        (dx, r[2] - a[0]),
        (-dy, a[1] - r[1]),
        (dy, r[3] - a[1]),
    ] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else {
            let t = q / p;
            if p < 0.0 {
                t0 = t0.max(t);
            } else {
                t1 = t1.min(t);
            }
        }
    }
    if t0 > t1 {
        return None;
    }
    let at = |t: f32| {
        if t == 0.0 {
            a
        } else if t == 1.0 {
            b
        } else {
            [a[0] + t * dx, a[1] + t * dy]
        }
    };
    Some((at(t0), at(t1)))
}

/// Clips open polylines to resolved clip shapes.
pub fn polylines_shapes(polys: &[Vec<[f32; 2]>], shapes: &Shapes, out: &mut Vec<Vec<[f32; 2]>>) {
    if polys.is_empty() || shapes.is_empty() {
        return;
    }
    let paths: Vec<Contour> = polys.iter().map(|p| to_f64(p)).collect();
    let rule = ClipRule {
        invert: false,
        boundary_included: true,
    };
    for p in paths.clip_by(shapes, FillRule::NonZero, rule) {
        if p.len() > 1 {
            out.push(p.iter().map(|&[x, y]| [x as f32, y as f32]).collect());
        }
    }
}

/// Clips a polygon to a rectangle (Sutherland–Hodgman). Correct for either fill rule when every
/// contour of a shape is clipped the same way, since the rectangle is convex.
pub fn polygon_rect(poly: &[[f32; 2]], r: Rect) -> Vec<[f32; 2]> {
    let mut out: Vec<[f32; 2]> = poly.to_vec();
    let edges: [(usize, f32, bool); 4] = [(0, r[0], true), (0, r[2], false), (1, r[1], true), (1, r[3], false)];
    for (axis, v, keep_greater) in edges {
        if out.is_empty() {
            break;
        }
        let input = std::mem::take(&mut out);
        let inside = |p: [f32; 2]| if keep_greater { p[axis] >= v } else { p[axis] <= v };
        let cross = |a: [f32; 2], b: [f32; 2]| {
            let t = (v - a[axis]) / (b[axis] - a[axis]);
            let mut p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
            p[axis] = v;
            p
        };
        let mut prev = *input.last().unwrap();
        for &p in &input {
            match (inside(prev), inside(p)) {
                (true, true) => out.push(p),
                (true, false) => out.push(cross(prev, p)),
                (false, true) => {
                    out.push(cross(prev, p));
                    out.push(p);
                }
                (false, false) => {}
            }
            prev = p;
        }
    }
    out
}

/// Intersects filled polygons (with their fill rule) with resolved clip shapes. The result uses
/// the non-zero rule.
pub fn polygons_shapes(polys: &[Vec<[f32; 2]>], rule: u8, shapes: &Shapes) -> Shapes {
    let contours: Vec<Contour> = polys.iter().map(|p| to_f64(p)).collect();
    let rule = if rule == fill::EVENODD {
        FillRule::EvenOdd
    } else {
        FillRule::NonZero
    };
    let subject = contours.simplify_shape(rule);
    subject.overlay(shapes, OverlayRule::Intersect, FillRule::NonZero)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{ContentBuilder, NONE};

    #[test]
    fn rect_detection() {
        assert_eq!(
            as_rect(&[[0.0, 0.0], [10.0, 0.0], [10.0, 5.0], [0.0, 5.0]]),
            Some([0.0, 0.0, 10.0, 5.0])
        );
        assert_eq!(
            as_rect(&[[0.0, 0.0], [10.0, 0.0], [10.0, 5.0], [0.0, 5.0], [0.0, 0.0]]),
            Some([0.0, 0.0, 10.0, 5.0])
        );
        assert_eq!(as_rect(&[[0.0, 0.0], [10.0, 1.0], [10.0, 5.0], [0.0, 5.0]]), None);
    }

    #[test]
    fn liang_barsky() {
        let r = [0.0, 0.0, 10.0, 10.0];
        assert_eq!(
            segment_rect([-5.0, 5.0], [15.0, 5.0], r),
            Some(([0.0, 5.0], [10.0, 5.0]))
        );
        assert_eq!(segment_rect([-5.0, -5.0], [-1.0, 20.0], r), None);
        let mut out = Vec::new();
        polyline_rect(
            &[[-5.0, 5.0], [5.0, 5.0], [5.0, 20.0], [5.0, 30.0], [5.0, 8.0]],
            r,
            &mut out,
        );
        assert_eq!(
            out,
            vec![vec![[0.0, 5.0], [5.0, 5.0], [5.0, 10.0]], vec![[5.0, 10.0], [5.0, 8.0]]]
        );
    }

    #[test]
    fn sutherland_hodgman() {
        let tri = [[-10.0, 0.0], [20.0, 0.0], [5.0, 30.0]];
        let out = polygon_rect(&tri, [0.0, 0.0, 10.0, 10.0]);
        let b = bounds(out.iter().copied());
        assert_eq!(b, [0.0, 0.0, 10.0, 10.0]);
    }

    #[test]
    fn resolves_nested_clips() {
        let mut b = ContentBuilder::new([100.0, 100.0]);
        let s = b.begin_path();
        for p in [[10.0, 10.0], [90.0, 10.0], [90.0, 90.0], [10.0, 90.0]] {
            if p == [10.0, 10.0] { b.move_to(p) } else { b.line_to(p) }
        }
        b.close();
        let outer = b.finish_clip(s, fill::NONZERO, NONE);
        let s = b.begin_path();
        b.move_to([0.0, 0.0]);
        b.line_to([50.0, 0.0]);
        b.line_to([0.0, 50.0]);
        b.close();
        let inner = b.finish_clip(s, fill::NONZERO, outer);
        let c = b.finish();
        let page = [0.0, 0.0, 100.0, 100.0];
        let r = resolve(&c, outer, page);
        assert_eq!(
            r,
            ResolvedClip {
                rect: [10.0, 10.0, 90.0, 90.0],
                shapes: None
            }
        );
        let r = resolve(&c, inner, page);
        let s = r.shapes.unwrap();
        assert_eq!(r.rect, [10.0, 10.0, 40.0, 40.0]);
        assert_eq!(s.len(), 1);
        // A line through the triangle is cut at its hypotenuse and by the rectangle.
        let mut out = Vec::new();
        polylines_shapes(&[vec![[0.0, 20.0], [100.0, 20.0]]], &s, &mut out);
        assert_eq!(out.len(), 1);
        let xs: Vec<f32> = out[0].iter().map(|p| p[0]).collect();
        assert!((xs.iter().cloned().fold(f32::MAX, f32::min) - 10.0).abs() < 0.01);
        assert!((xs.iter().cloned().fold(f32::MIN, f32::max) - 30.0).abs() < 0.01);
    }
}
