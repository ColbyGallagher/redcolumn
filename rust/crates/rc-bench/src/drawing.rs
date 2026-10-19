//! Synthetic engineering drawings with controlled weight, for tests and benchmarks.
//!
//! Each page has what makes real sheets heavy, in proportions set by the options: a border and
//! title block, dashed grid lines, walls, dense hatching placed as a repeated form inside clipped
//! regions, door swings (curves), stroked "SHX" text, short detail lines to reach the segment
//! target, and optionally real (base-14) text, a transparent fill, an image, layers and rotation.
//! The output is deterministic for a given seed.

use flate2::Compression;
use flate2::write::ZlibEncoder;
use std::fmt::Write as _;
use std::io::Write as _;

#[derive(Clone, Debug)]
pub struct GenOptions {
    pub pages: u32,
    /// Roughly how many line segments each page draws.
    pub segments: u64,
    /// Page size in points (A1 landscape by default).
    pub width: f32,
    pub height: f32,
    /// /Rotate for every page.
    pub rotate: i32,
    /// Base-14 text labels (text objects, not strokes).
    pub text: bool,
    /// An RGB image on each page.
    pub image: bool,
    /// A translucent fill on each page.
    pub transparency: bool,
    /// Put content on optional content groups (layers).
    pub layers: bool,
    pub seed: u64,
}

impl Default for GenOptions {
    fn default() -> Self {
        Self {
            pages: 1,
            segments: 100_000,
            width: 2384.0,
            height: 1684.0,
            rotate: 0,
            text: true,
            image: true,
            transparency: true,
            layers: true,
            seed: 1,
        }
    }
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn f(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }

    fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.f()
    }
}

fn n(v: f32) -> String {
    let s = format!("{v:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" { "0".into() } else { s.into() }
}

/// The layers pages use, in order.
pub const LAYERS: [&str; 5] = ["A-WALL", "A-HATCH", "A-DETL", "A-ANNO", "GRID"];

/// A small stroke font: each glyph is polylines on a 4 × 6 grid (like an SHX font exported as
/// lines).
fn glyph(c: char) -> &'static [&'static [(f32, f32)]] {
    match c {
        'A' => &[&[(0.0, 0.0), (2.0, 6.0), (4.0, 0.0)], &[(1.0, 3.0), (3.0, 3.0)]],
        'B' => &[&[(0.0, 0.0), (0.0, 6.0), (3.0, 6.0), (4.0, 5.0), (3.0, 3.0), (0.0, 3.0)], &[(3.0, 3.0), (4.0, 1.0), (3.0, 0.0), (0.0, 0.0)]],
        'D' => &[&[(0.0, 0.0), (0.0, 6.0), (3.0, 6.0), (4.0, 4.0), (4.0, 2.0), (3.0, 0.0), (0.0, 0.0)]],
        'E' => &[&[(4.0, 0.0), (0.0, 0.0), (0.0, 6.0), (4.0, 6.0)], &[(0.0, 3.0), (3.0, 3.0)]],
        'L' => &[&[(0.0, 6.0), (0.0, 0.0), (4.0, 0.0)]],
        'O' | '0' => &[&[(0.0, 0.0), (0.0, 6.0), (4.0, 6.0), (4.0, 0.0), (0.0, 0.0)]],
        'R' => &[&[(0.0, 0.0), (0.0, 6.0), (4.0, 6.0), (4.0, 3.0), (0.0, 3.0), (4.0, 0.0)]],
        'T' => &[&[(0.0, 6.0), (4.0, 6.0)], &[(2.0, 6.0), (2.0, 0.0)]],
        '1' => &[&[(1.0, 5.0), (2.0, 6.0), (2.0, 0.0)]],
        '2' => &[&[(0.0, 6.0), (4.0, 6.0), (4.0, 3.0), (0.0, 3.0), (0.0, 0.0), (4.0, 0.0)]],
        '3' => &[&[(0.0, 6.0), (4.0, 6.0), (4.0, 0.0), (0.0, 0.0)], &[(1.0, 3.0), (4.0, 3.0)]],
        _ => &[&[(0.0, 0.0), (4.0, 6.0)]],
    }
}

const WORDS: [&str; 6] = ["DOOR", "BED", "LOT 12", "AREA 3", "TOILET", "DR 21"];

/// Builds one page's content stream. Returns it and how many segments it draws.
fn page_content(o: &GenOptions, page: u32, rng: &mut Rng) -> (String, u64) {
    let (w, h) = (o.width, o.height);
    let mut s = String::new();
    let mut segs: u64 = 0;
    let layer = |s: &mut String, i: usize| {
        if o.layers {
            let _ = writeln!(s, "/OC /oc{i} BDC");
        }
    };
    let end_layer = |s: &mut String| {
        if o.layers {
            s.push_str("EMC\n");
        }
    };
    // Border and title block: thick, mitred.
    let _ = writeln!(s, "q 0 0 0 RG 2.5 w 0 j 0 J 20 20 {} {} re S", n(w - 40.0), n(h - 40.0));
    let _ = writeln!(s, "1.2 w {} 20 m {} 20 l {} 220 l {} 220 l h S Q", n(w - 420.0), n(w - 20.0), n(w - 20.0), n(w - 420.0));
    segs += 8;
    // Grid lines, dashed, grey.
    layer(&mut s, 4);
    s.push_str("q 0.55 G 0.5 w [12 4 2 4] 0 d\n");
    let mut x = 100.0;
    while x < w - 100.0 {
        let _ = writeln!(s, "{} 40 m {} {} l S", n(x), n(x), n(h - 40.0));
        x += 300.0;
        segs += ((h - 80.0) / 22.0) as u64;
    }
    s.push_str("Q\n");
    end_layer(&mut s);
    // Hatching: the form tiled inside clipped rooms.
    let rooms = 6 + (o.segments / 40_000).min(60) as usize;
    let tiles_per_room = ((o.segments / 4) / (rooms as u64 * 32)).clamp(1, 4000) as usize;
    layer(&mut s, 1);
    for r in 0..rooms {
        let rw = rng.range(120.0, 360.0);
        let rh = rng.range(90.0, 260.0);
        let rx = rng.range(60.0, w - rw - 460.0);
        let ry = rng.range(260.0, h - rh - 60.0);
        if r % 3 == 0 {
            // A triangular (non-rectangular) clip.
            let _ = writeln!(s, "q {} {} m {} {} l {} {} l h W n", n(rx), n(ry), n(rx + rw), n(ry), n(rx + rw / 2.0), n(ry + rh));
        } else {
            let _ = writeln!(s, "q {} {} {} {} re W n", n(rx), n(ry), n(rw), n(rh));
        }
        let side = (rw * rh / tiles_per_room as f32).sqrt().max(4.0);
        let scale = side / 64.0;
        let mut ty = ry;
        let mut placed = 0;
        while ty < ry + rh && placed < tiles_per_room {
            let mut tx = rx;
            while tx < rx + rw && placed < tiles_per_room {
                let _ = writeln!(s, "q {} 0 0 {} {} {} cm /Hatch Do Q", n(scale), n(scale), n(tx), n(ty));
                tx += side;
                placed += 1;
                segs += 32;
            }
            ty += side;
        }
        s.push_str("Q\n");
    }
    end_layer(&mut s);
    // Walls: thick polylines with round joins, and a filled column grid (even-odd donuts).
    layer(&mut s, 0);
    s.push_str("q 0 0 0 RG 1.4 w 1 j 1 J\n");
    for _ in 0..(8 + o.segments / 20_000).min(400) {
        let mut px = rng.range(60.0, w - 500.0);
        let mut py = rng.range(260.0, h - 60.0);
        let _ = write!(s, "{} {} m", n(px), n(py));
        for k in 0..6 {
            if k % 2 == 0 {
                px = (px + rng.range(-200.0, 200.0)).clamp(40.0, w - 460.0);
            } else {
                py = (py + rng.range(-200.0, 200.0)).clamp(240.0, h - 40.0);
            }
            let _ = write!(s, " {} {} l", n(px), n(py));
            segs += 1;
        }
        s.push_str(" S\n");
    }
    s.push_str("0.25 g\n");
    for i in 0..12 {
        let cx = 200.0 + i as f32 * 140.0;
        let cy = h - 140.0;
        let _ = writeln!(s, "{} {} 30 30 re {} {} 14 14 re f*", n(cx), n(cy), n(cx + 8.0), n(cy + 8.0));
        segs += 8;
    }
    s.push_str("Q\n");
    end_layer(&mut s);
    // Door swings: quarter circles as Béziers, and leaves.
    layer(&mut s, 2);
    s.push_str("q 0 0 0.6 RG 0.35 w\n");
    let k = 0.5523;
    for _ in 0..(20 + o.segments / 5000).min(2000) {
        let r = rng.range(20.0, 40.0);
        let cx = rng.range(60.0, w - 500.0);
        let cy = rng.range(260.0, h - 60.0);
        let _ = writeln!(
            s,
            "{} {} m {} {} {} {} {} {} c {} {} m {} {} l S",
            n(cx + r),
            n(cy),
            n(cx + r),
            n(cy + r * k),
            n(cx + r * k),
            n(cy + r),
            n(cx),
            n(cy + r),
            n(cx),
            n(cy),
            n(cx),
            n(cy + r)
        );
        segs += 2;
    }
    s.push_str("Q\n");
    end_layer(&mut s);
    // Stroked text, as CAD exports SHX fonts.
    layer(&mut s, 3);
    s.push_str("q 0 0 0 RG 0 w\n");
    let labels = (30 + o.segments / 3000).min(3000);
    for i in 0..labels {
        let word = WORDS[(i as usize + page as usize) % WORDS.len()];
        let size = rng.range(0.9, 1.6);
        let mut lx = rng.range(60.0, w - 520.0);
        let ly = rng.range(260.0, h - 60.0);
        for c in word.chars() {
            for stroke in glyph(c) {
                let mut first = true;
                for &(gx, gy) in stroke.iter() {
                    let _ = write!(s, "{} {} {} ", n(lx + gx * size), n(ly + gy * size), if first { "m" } else { "l" });
                    if !first {
                        segs += 1;
                    }
                    first = false;
                }
            }
            lx += 6.0 * size;
        }
        s.push_str("S\n");
    }
    s.push_str("Q\n");
    end_layer(&mut s);
    // Detail lines up to the segment target: short hairlines, many to a path as in exports.
    layer(&mut s, 2);
    s.push_str("q 0.2 0.2 0.2 RG 0 w\n");
    let mut left = o.segments.saturating_sub(segs);
    while left > 0 {
        let batch = left.min(64);
        for _ in 0..batch {
            let x0 = rng.range(50.0, w - 470.0);
            let y0 = rng.range(250.0, h - 50.0);
            let _ = write!(s, "{} {} m {} {} l ", n(x0), n(y0), n(x0 + rng.range(-6.0, 6.0)), n(y0 + rng.range(-6.0, 6.0)));
        }
        s.push_str("S\n");
        segs += batch;
        left -= batch;
    }
    s.push_str("Q\n");
    end_layer(&mut s);
    if o.transparency {
        let _ = writeln!(s, "q /GS1 gs 0.9 0.2 0.1 rg {} 260 300 200 re f Q", n(w - 900.0));
        segs += 4;
    }
    if o.image {
        let _ = writeln!(s, "q 240 0 0 160 {} 40 cm /Im1 Do Q", n(w - 400.0));
    }
    if o.text {
        s.push_str("q 0 g BT /F1 9 Tf\n");
        for i in 0..20 {
            let _ = writeln!(s, "1 0 0 1 {} {} Tm (ROOM {}) Tj", n(w - 400.0), n(200.0 - i as f32 * 8.0), i + 1);
        }
        let _ = writeln!(s, "/F1 14 Tf 1 0 0 1 {} 60 Tm (SHEET A-{:03}) Tj ET Q", n(w - 400.0), page + 101);
    }
    (s, segs)
}

fn deflate(data: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::fast());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

/// A PDF file with the given options.
pub fn generate(o: &GenOptions) -> Vec<u8> {
    let mut rng = Rng(o.seed.max(1) * 0x9e37_79b9_7f4a_7c15);
    // Objects: 1 catalog, 2 pages, 3 hatch form, 4 image, 5 font, 6 ExtGState, 7.. OCGs, then
    // per page: page, content.
    let mut objs: Vec<Vec<u8>> = Vec::new();
    let ocg_first = 7;
    let page_first = ocg_first + LAYERS.len();
    let kids: Vec<String> = (0..o.pages).map(|i| format!("{} 0 R", page_first + 2 * i as usize)).collect();
    let ocgs: Vec<String> = (0..LAYERS.len()).map(|i| format!("{} 0 R", ocg_first + i)).collect();
    let ocprops = if o.layers {
        format!(" /OCProperties << /OCGs [{0}] /D << /Order [{0}] /ON [{0}] >> >>", ocgs.join(" "))
    } else {
        String::new()
    };
    objs.push(format!("<< /Type /Catalog /Pages 2 0 R{ocprops} >>").into_bytes());
    objs.push(format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids.join(" "), o.pages).into_bytes());
    // Hatch: 32 diagonal lines across a 64 × 64 box.
    let mut hatch = String::from("0.35 G 0 w\n");
    for i in 1..=32 {
        let d = i as f32 * 4.0;
        if d <= 64.0 {
            let _ = write!(hatch, "{} 0 m 0 {} l ", n(d), n(d));
        } else {
            let _ = write!(hatch, "64 {} m {} 64 l ", n(d - 64.0), n(d - 64.0));
        }
    }
    hatch.push_str("S\n");
    let hz = deflate(hatch.as_bytes());
    let mut form = format!("<< /Type /XObject /Subtype /Form /BBox [0 0 64 64] /Filter /FlateDecode /Length {} >>\nstream\n", hz.len()).into_bytes();
    form.extend_from_slice(&hz);
    form.extend_from_slice(b"\nendstream");
    objs.push(form);
    // A 128 × 128 RGB gradient.
    let mut px = Vec::with_capacity(128 * 128 * 3);
    for y in 0..128u32 {
        for x in 0..128u32 {
            px.extend_from_slice(&[(x * 2) as u8, (y * 2) as u8, 160]);
        }
    }
    let iz = deflate(&px);
    let mut img = format!(
        "<< /Type /XObject /Subtype /Image /Width 128 /Height 128 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>\nstream\n",
        iz.len()
    )
    .into_bytes();
    img.extend_from_slice(&iz);
    img.extend_from_slice(b"\nendstream");
    objs.push(img);
    objs.push(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_vec());
    objs.push(b"<< /Type /ExtGState /ca 0.4 /CA 0.4 >>".to_vec());
    for l in LAYERS {
        objs.push(format!("<< /Type /OCG /Name ({l}) >>").into_bytes());
    }
    let props: Vec<String> = (0..LAYERS.len()).map(|i| format!("/oc{i} {} 0 R", ocg_first + i)).collect();
    for p in 0..o.pages {
        let (content, _) = page_content(o, p, &mut rng);
        let z = deflate(content.as_bytes());
        let rotate = if o.rotate != 0 { format!(" /Rotate {}", o.rotate) } else { String::new() };
        objs.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}]{rotate} /Contents {} 0 R /Resources << /XObject << /Hatch 3 0 R /Im1 4 0 R >> /Font << /F1 5 0 R >> /ExtGState << /GS1 6 0 R >> /Properties << {} >> >> >>",
                n(o.width),
                n(o.height),
                page_first + 2 * p as usize + 1,
                props.join(" ")
            )
            .into_bytes(),
        );
        let mut c = format!("<< /Filter /FlateDecode /Length {} >>\nstream\n", z.len()).into_bytes();
        c.extend_from_slice(&z);
        c.extend_from_slice(b"\nendstream");
        objs.push(c);
    }
    let mut out = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n".to_vec();
    let mut offsets = Vec::with_capacity(objs.len());
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_well_formed() {
        let o = GenOptions { segments: 5000, pages: 2, ..Default::default() };
        let a = generate(&o);
        assert_eq!(a, generate(&o));
        assert!(a.starts_with(b"%PDF-1.7"));
        assert!(a.ends_with(b"%%EOF\n"));
    }

    #[test]
    fn hits_the_segment_target() {
        let o = GenOptions { segments: 50_000, ..Default::default() };
        let mut rng = Rng(7);
        let (_, segs) = page_content(&o, 0, &mut rng);
        assert!(segs >= 50_000 && segs < 80_000, "{segs}");
    }
}
