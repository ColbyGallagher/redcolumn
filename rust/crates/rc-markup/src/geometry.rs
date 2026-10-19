//! Boxes, hit testing, handles, moving and resizing (page space, points).

use crate::{Markup, Point, TEXT};

/// `[x0, y0, x1, y1]`, x0 <= x1 and y0 <= y1.
pub type Rect = [f64; 4];

pub fn bounds(points: &[Point]) -> Rect {
    let mut r = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for p in points {
        r = [r[0].min(p[0]), r[1].min(p[1]), r[2].max(p[0]), r[3].max(p[1])];
    }
    if r[0] > r[2] { [0.0; 4] } else { r }
}

/// The box a markup covers, including half its line width.
pub fn outer(m: &Markup) -> Rect {
    let b = bounds(&m.points);
    let w = m.style.width / 2.0;
    [b[0] - w, b[1] - w, b[2] + w, b[3] + w]
}

pub fn contains(r: Rect, p: Point) -> bool {
    p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]
}

pub fn intersects(a: Rect, b: Rect) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

/// Whether `p` picks the markup; `tol` is how far off a line still counts, in points.
pub fn hit(m: &Markup, p: Point, tol: f64) -> bool {
    if m.is_hidden() {
        return false;
    }
    let b = bounds(&m.points);
    // Text boxes and filled rectangles are picked anywhere inside; open rectangles on their edge.
    if m.kind == TEXT || m.style.fill.is_some() {
        return contains([b[0] - tol, b[1] - tol, b[2] + tol, b[3] + tol], p);
    }
    let t = tol + m.style.width / 2.0;
    let near_outer = contains([b[0] - t, b[1] - t, b[2] + t, b[3] + t], p);
    let inside_inner =
        b[2] - b[0] > 2.0 * t && b[3] - b[1] > 2.0 * t && contains([b[0] + t, b[1] + t, b[2] - t, b[3] - t], p);
    near_outer && !inside_inner
}

/// The topmost markup at `p` on `page` (drawn last, picked first).
pub fn pick(markups: &[Markup], page: usize, p: Point, tol: f64) -> Option<&Markup> {
    markups.iter().rev().find(|m| m.page_index == page && hit(m, p, tol))
}

/// The eight resize handles: corners and edge middles, clockwise from the top-left.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handle {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

pub const HANDLES: [Handle; 8] = [
    Handle::TopLeft,
    Handle::Top,
    Handle::TopRight,
    Handle::Right,
    Handle::BottomRight,
    Handle::Bottom,
    Handle::BottomLeft,
    Handle::Left,
];

impl Handle {
    /// Where the handle sits on a box.
    pub fn at(self, r: Rect) -> Point {
        let (cx, cy) = ((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0);
        match self {
            Handle::TopLeft => [r[0], r[1]],
            Handle::Top => [cx, r[1]],
            Handle::TopRight => [r[2], r[1]],
            Handle::Right => [r[2], cy],
            Handle::BottomRight => [r[2], r[3]],
            Handle::Bottom => [cx, r[3]],
            Handle::BottomLeft => [r[0], r[3]],
            Handle::Left => [r[0], cy],
        }
    }

    /// Which edges it moves: (left, top, right, bottom).
    fn edges(self) -> (bool, bool, bool, bool) {
        match self {
            Handle::TopLeft => (true, true, false, false),
            Handle::Top => (false, true, false, false),
            Handle::TopRight => (false, true, true, false),
            Handle::Right => (false, false, true, false),
            Handle::BottomRight => (false, false, true, true),
            Handle::Bottom => (false, false, false, true),
            Handle::BottomLeft => (true, false, false, true),
            Handle::Left => (true, false, false, false),
        }
    }

    /// The cursor shape for it, as a name (the interface maps it).
    pub fn diagonal(self) -> Option<bool> {
        match self {
            Handle::TopLeft | Handle::BottomRight => Some(true),
            Handle::TopRight | Handle::BottomLeft => Some(false),
            _ => None,
        }
    }
}

/// The handle within `tol` of `p` on a box, if any.
pub fn handle_at(r: Rect, p: Point, tol: f64) -> Option<Handle> {
    HANDLES.into_iter().find(|h| {
        let q = h.at(r);
        (q[0] - p[0]).abs() <= tol && (q[1] - p[1]).abs() <= tol
    })
}

/// A box with the handle's edges moved to `p`, normalised (dragging past the opposite edge flips
/// it), at least `min` wide and tall.
pub fn resized(r: Rect, h: Handle, p: Point, min: f64) -> Rect {
    let (l, t, rr, b) = h.edges();
    let mut n = r;
    if l {
        n[0] = p[0];
    }
    if t {
        n[1] = p[1];
    }
    if rr {
        n[2] = p[0];
    }
    if b {
        n[3] = p[1];
    }
    let mut n = [n[0].min(n[2]), n[1].min(n[3]), n[0].max(n[2]), n[1].max(n[3])];
    if n[2] - n[0] < min {
        if l && !rr { n[0] = n[2] - min } else { n[2] = n[0] + min }
    }
    if n[3] - n[1] < min {
        if t && !b { n[1] = n[3] - min } else { n[3] = n[1] + min }
    }
    n
}

/// The two corners of a box, as Rectangle and Text store them.
pub fn corners(r: Rect) -> Vec<Point> {
    vec![[r[0], r[1]], [r[2], r[3]]]
}

pub fn translate(m: &mut Markup, dx: f64, dy: f64) {
    for p in &mut m.points {
        p[0] += dx;
        p[1] += dy;
    }
}

/// Keeps a box on the page (moving it, not resizing it, unless it is larger than the page).
pub fn clamp_to_page(r: Rect, page: [f64; 2]) -> (f64, f64) {
    let dx = if r[0] < 0.0 {
        -r[0]
    } else if r[2] > page[0] {
        (page[0] - r[2]).max(-r[0])
    } else {
        0.0
    };
    let dy = if r[1] < 0.0 {
        -r[1]
    } else if r[3] > page[1] {
        (page[1] - r[3]).max(-r[1])
    } else {
        0.0
    };
    (dx, dy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Markup, RECT};

    #[test]
    fn rect_hit_on_edge_only_unless_filled() {
        let mut m = Markup::new(RECT, 0, vec![[0.0, 0.0], [100.0, 50.0]], "");
        assert!(hit(&m, [0.5, 25.0], 2.0));
        assert!(!hit(&m, [50.0, 25.0], 2.0));
        assert!(!hit(&m, [120.0, 25.0], 2.0));
        m.style.fill = Some("#00ff00".into());
        assert!(hit(&m, [50.0, 25.0], 2.0));
    }

    #[test]
    fn resize_flips_and_keeps_min() {
        let r = [0.0, 0.0, 100.0, 50.0];
        assert_eq!(
            resized(r, Handle::BottomRight, [120.0, 80.0], 1.0),
            [0.0, 0.0, 120.0, 80.0]
        );
        assert_eq!(resized(r, Handle::Left, [150.0, 0.0], 1.0), [100.0, 0.0, 150.0, 50.0]);
        assert_eq!(resized(r, Handle::Top, [0.0, 50.0], 4.0), [0.0, 46.0, 100.0, 50.0]);
        assert_eq!(handle_at(r, [99.0, 26.0], 3.0), Some(Handle::Right));
    }

    #[test]
    fn clamp() {
        assert_eq!(clamp_to_page([-5.0, 10.0, 20.0, 30.0], [100.0, 100.0]), (5.0, 0.0));
        assert_eq!(clamp_to_page([90.0, 95.0, 110.0, 105.0], [100.0, 100.0]), (-10.0, -5.0));
    }
}
