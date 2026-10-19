//! Text box layout with Helvetica's metrics, so the box on screen and the appearance written to
//! the PDF (in Helvetica) wrap the same way. The app draws it with Liberation Sans, which has
//! Helvetica's widths.

use crate::Markup;
use crate::geometry::bounds;

/// Inside a text box's edge, in points (the TypeScript app's `TEXT_PADDING`).
pub const PADDING: f64 = 4.0;
/// Line spacing as a multiple of the font size (`TEXT_LINE_HEIGHT`).
pub const LINE_HEIGHT: f64 = 1.2;
/// Helvetica's ascent, as a fraction of the font size: the first baseline sits this far below a
/// line's top (plus the half-leading).
pub const ASCENT: f64 = 0.718;

/// Helvetica's advance widths for 32..=126, in thousandths of the font size (the standard AFM).
const WIDTHS: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space../
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0-9
    278, 278, 584, 584, 584, 556, 1015, // :;<=>?@
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
    667, 667, 611, // A-Z
    278, 278, 278, 469, 556, 333, // [\]^_`
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722,
    500, 500, 500, // a-z
    334, 260, 334, 584, // {|}~
];

/// A character's width in points at `size`.
pub fn char_width(c: char, size: f64) -> f64 {
    let w = match c as u32 {
        32..=126 => WIDTHS[c as usize - 32],
        0xa0 => 278,
        _ => 556,
    };
    w as f64 * size / 1000.0
}

pub fn width(s: &str, size: f64) -> f64 {
    s.chars().map(|c| char_width(c, size)).sum()
}

/// Greedy word wrap into lines no wider than `max` (a word longer than a line is broken).
pub fn wrap(text: &str, size: f64, max: f64) -> Vec<String> {
    let mut out = Vec::new();
    for para in text.split('\n') {
        let mut line = String::new();
        let mut line_w = 0.0;
        for word in para.split_inclusive(' ') {
            let w = width(word, size);
            let trimmed = width(word.trim_end_matches(' '), size);
            if line_w + trimmed <= max || line.is_empty() {
                if line.is_empty() && trimmed > max {
                    // Break a long word by characters.
                    for c in word.chars() {
                        let cw = char_width(c, size);
                        if line_w + cw > max && !line.is_empty() {
                            out.push(std::mem::take(&mut line));
                            line_w = 0.0;
                        }
                        line.push(c);
                        line_w += cw;
                    }
                    continue;
                }
                line.push_str(word);
                line_w += w;
            } else {
                out.push(line.trim_end_matches(' ').to_string());
                line = word.to_string();
                line_w = w;
            }
        }
        out.push(line.trim_end_matches(' ').to_string());
    }
    out
}

/// One laid-out line: its text, left edge and baseline in page space.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub text: String,
    pub x: f64,
    pub baseline: f64,
    pub width: f64,
}

/// Where each line of a text box goes, for its alignment.
pub fn layout(m: &Markup) -> Vec<Line> {
    let b = bounds(&m.points);
    let size = m.style.font_size();
    let inner = (b[2] - b[0] - 2.0 * PADDING).max(size);
    let line_h = size * LINE_HEIGHT;
    let align = m.style.text_align().to_string();
    wrap(m.text.as_deref().unwrap_or(""), size, inner)
        .into_iter()
        .enumerate()
        .map(|(i, text)| {
            let w = width(&text, size);
            let x = match align.as_str() {
                "center" => b[0] + (b[2] - b[0] - w) / 2.0,
                "right" => b[2] - PADDING - w,
                _ => b[0] + PADDING,
            };
            let top = b[1] + PADDING + i as f64 * line_h;
            Line {
                text,
                x,
                baseline: top + (line_h - size) / 2.0 + ASCENT * size,
                width: w,
            }
        })
        .collect()
}

/// The height a text box needs for its text at its width.
pub fn needed_height(m: &Markup) -> f64 {
    let b = bounds(&m.points);
    let size = m.style.font_size();
    let n = wrap(
        m.text.as_deref().unwrap_or(""),
        size,
        (b[2] - b[0] - 2.0 * PADDING).max(size),
    )
    .len();
    n as f64 * size * LINE_HEIGHT + 2.0 * PADDING
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_match_helvetica() {
        assert!((width("Hello", 10.0) - 22.78).abs() < 1e-9);
    }

    #[test]
    fn wraps_words_and_breaks_long_ones() {
        assert_eq!(wrap("one two three", 10.0, 40.0), vec!["one two", "three"]);
        assert_eq!(wrap("a\n\nb", 10.0, 100.0), vec!["a", "", "b"]);
        let long = wrap("WWWWWWWWWW", 10.0, 30.0);
        assert!(
            long.len() > 1 && long.iter().all(|l| width(l, 10.0) <= 30.0 + 1e-9),
            "{long:?}"
        );
    }

    #[test]
    fn layout_aligns() {
        let mut m = Markup::new(crate::TEXT, 0, vec![[0.0, 0.0], [200.0, 100.0]], "");
        m.text = Some("Hi".into());
        let l = layout(&m);
        assert_eq!(l[0].x, PADDING);
        m.style.extra.insert("textAlign".into(), "right".into());
        let l = layout(&m);
        assert!((l[0].x + l[0].width - (200.0 - PADDING)).abs() < 1e-9);
    }
}
