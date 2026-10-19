//! A markup's annotation dictionary and appearance stream.
//!
//! The appearance is drawn in page space (y down, the page's rotation applied) under a `cm` that
//! maps it to user space, so it looks the same on a rotated page as on screen.

use crate::serialize::{dict, fmt, n, name, num, nums, text, win_ansi};
use rc_markup::geometry::bounds;
use rc_markup::{Markup, TEXT, parse_color};
use rc_parse::document::PageNode;
use rc_parse::object::{Dict, Obj, Stream, StreamData};
use rc_scene::content::Affine;

/// The annotation (pointing at its appearance stream, object `ap`) and that stream.
pub fn annotation(m: &Markup, page: &PageNode, page_ref: &Obj, ap: u32, now_ms: f64) -> (Dict, Obj) {
    let to_page = Affine::page_from_user(page.crop_box, page.rotate);
    let to_user = to_page.invert().unwrap_or_default();
    let b = bounds(&m.points);
    let w = m.style.width.max(0.0);
    let h = w / 2.0;
    let outer = [b[0] - h, b[1] - h, b[2] + h, b[3] + h];
    let corners = [
        [outer[0], outer[1]],
        [outer[2], outer[1]],
        [outer[2], outer[3]],
        [outer[0], outer[3]],
    ]
    .map(|p| to_user.apply(p[0], p[1]));
    let rect = [
        corners.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min),
        corners.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min),
        corners.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max),
        corners.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max),
    ];
    let stroke = parse_color(&m.style.stroke);
    let fill = m.style.fill.as_deref().map(parse_color);
    let op = m.style.opacity.clamp(0.0, 1.0);
    let is_text = m.kind == TEXT;

    // The appearance, in page space.
    let rgb = |c: [f64; 3]| format!("{} {} {}", fmt(c[0]), fmt(c[1]), fmt(c[2]));
    let mut c = format!(
        "q {} {} {} {} {} {} cm /GS0 gs\n",
        fmt(to_user.a),
        fmt(to_user.b),
        fmt(to_user.c),
        fmt(to_user.d),
        fmt(to_user.e),
        fmt(to_user.f)
    );
    let re = format!(
        "{} {} {} {} re",
        fmt(b[0]),
        fmt(b[1]),
        fmt(b[2] - b[0]),
        fmt(b[3] - b[1])
    );
    if let Some(f) = fill {
        c += &format!("{} rg {re} f\n", rgb(f));
    }
    if w > 0.0 {
        c += &format!("{} w {} RG {re} S\n", fmt(w), rgb(stroke));
    }
    let size = m.style.font_size();
    let text_color = parse_color(m.style.text_color());
    if is_text {
        c += &format!("q {re} W n BT /Helv {} Tf {} rg\n", fmt(size), rgb(text_color));
        for l in rc_markup::text::layout(m) {
            let mut s = Vec::new();
            crate::serialize::write(&mut s, &Obj::Str(win_ansi(&l.text)));
            c += &format!(
                "1 0 0 -1 {} {} Tm {} Tj\n",
                fmt(l.x),
                fmt(l.baseline),
                String::from_utf8_lossy(&s)
            );
        }
        c += "ET Q\n";
    }
    c += "Q\n";
    let mut resources = dict(vec![(
        "ExtGState",
        Obj::Dict(dict(vec![(
            "GS0",
            Obj::Dict(dict(vec![("CA", num(op)), ("ca", num(op))])),
        )])),
    )]);
    if is_text {
        resources.0.push((
            name("Font"),
            Obj::Dict(dict(vec![(
                "Helv",
                Obj::Dict(dict(vec![
                    ("Type", n("Font")),
                    ("Subtype", n("Type1")),
                    ("BaseFont", n("Helvetica")),
                    ("Encoding", n("WinAnsiEncoding")),
                ])),
            )])),
        ));
    }
    let stream = Obj::Stream(Stream {
        dict: dict(vec![
            ("Type", n("XObject")),
            ("Subtype", n("Form")),
            ("BBox", nums(&rect)),
            ("Resources", Obj::Dict(resources)),
        ]),
        data: StreamData::Owned(c.into_bytes().into()),
    });

    // The annotation.
    let mut flags = 4; // Print
    if m.is_hidden() {
        flags |= 2;
    }
    if m.is_locked() {
        flags |= 128;
    }
    let date = Obj::Str(pdf_date(m.modified_at.max(m.created_at).max(1.0).min(now_ms)).into_bytes());
    let created = Obj::Str(pdf_date(if m.created_at > 0.0 { m.created_at } else { now_ms }).into_bytes());
    let mut d = dict(vec![
        ("Type", n("Annot")),
        ("Subtype", n(if is_text { "FreeText" } else { "Square" })),
        ("Rect", nums(&rect)),
        ("P", page_ref.clone()),
        ("NM", text(&m.id)),
        ("T", text(&m.author)),
        ("Subj", text(m.subject.as_deref().unwrap_or(m.label()))),
        ("M", date),
        ("CreationDate", created),
        ("F", Obj::Int(flags)),
        ("CA", num(op)),
        ("BS", Obj::Dict(dict(vec![("W", num(w)), ("S", n("S"))]))),
        ("RD", nums(&[0.0; 4])),
        ("AP", Obj::Dict(dict(vec![("N", Obj::Ref(ap, 0))]))),
    ]);
    let push = |d: &mut Dict, k: &str, v: Obj| d.0.push((name(k), v));
    if is_text {
        let body = m.text.as_deref().unwrap_or("");
        push(&mut d, "Contents", text(body));
        push(
            &mut d,
            "DA",
            Obj::Str(format!("/Helv {} Tf {} rg", fmt(size), rgb(text_color)).into_bytes()),
        );
        let q = match m.style.text_align() {
            "center" => 1,
            "right" => 2,
            _ => 0,
        };
        push(&mut d, "Q", Obj::Int(q));
        push(
            &mut d,
            "DS",
            text(&format!(
                "font: Helvetica {}pt; text-align:{}; color:{}",
                fmt(size),
                m.style.text_align(),
                m.style.text_color().to_uppercase()
            )),
        );
        push(&mut d, "RC", text(&rich_text(body)));
        // A FreeText's /C is its background.
        push(&mut d, "C", fill.map_or(Obj::Array(vec![]), |f| nums(&f)));
    } else {
        push(&mut d, "C", nums(&stroke));
        if let Some(f) = fill {
            push(&mut d, "IC", nums(&f));
        }
        if let Some(cm) = &m.comment {
            push(&mut d, "Contents", text(cm));
        }
    }
    push(&mut d, "NBData", text(&m.app_data()));
    (d, stream)
}

fn rich_text(s: &str) -> String {
    let esc = |l: &str| l.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let body: String = s
        .split('\n')
        .map(|l| {
            if l.is_empty() {
                "<p/>".to_string()
            } else {
                format!("<p>{}</p>", esc(l))
            }
        })
        .collect();
    format!(
        "<?xml version=\"1.0\"?><body xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:xfa=\"http://www.xfa.org/schema/xfa-data/1.0/\" xfa:APIVersion=\"Acrobat:11.0.0\" xfa:spec=\"2.0.2\">{body}</body>"
    )
}

/// `D:YYYYMMDDHHmmSSZ` for a time in milliseconds since 1970 (UTC).
pub fn pdf_date(ms: f64) -> String {
    let secs = (ms / 1000.0).floor() as i64;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // Civil from days (Howard Hinnant's algorithm).
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!(
        "D:{y:04}{mo:02}{d:02}{:02}{:02}{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn dates() {
        assert_eq!(super::pdf_date(0.0), "D:19700101000000Z");
        assert_eq!(super::pdf_date(1_700_000_000_000.0), "D:20231114221320Z");
    }
}
