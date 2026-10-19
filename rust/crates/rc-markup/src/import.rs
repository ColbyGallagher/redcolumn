//! Markups from a page's annotations: this app's (and the TypeScript app's) own from /NBData,
//! else other tools' Square and FreeText annotations.

use crate::{Markup, PdfAnnotLink, RECT, Style, TEXT, digest, hex_color};
use rc_parse::Annotation;

/// The markups a page's annotations stand for. `rotate` is the page's /Rotate (0, 90, 180 or
/// 270). Annotations that are not Rectangle or Text stay as the PDF draws them.
pub fn import(page: usize, rotate: i32, annots: &[Annotation]) -> Vec<Markup> {
    let mut out = Vec::new();
    for a in annots {
        if a.subtype == "Popup" {
            continue;
        }
        let m = from_app_data(page, a).or_else(|| from_annotation(page, rotate, a));
        if let Some(mut m) = m {
            m.pdf_annot = Some(PdfAnnotLink {
                index: a.index,
                digest: String::new(),
                id: Some(m.id.clone()),
                extra: Default::default(),
            });
            let d = digest(&m);
            m.pdf_annot.as_mut().unwrap().digest = d;
            out.push(m);
        }
    }
    out
}

fn from_app_data(page: usize, a: &Annotation) -> Option<Markup> {
    if a.app_data.is_empty() {
        return None;
    }
    let mut m: Markup = serde_json::from_str(&a.app_data).ok()?;
    if !Markup::supported(&m.kind) || m.points.len() < 2 {
        return None;
    }
    m.page_index = page;
    Some(m)
}

/// Displayed insets `[left, top, right, bottom]` from /RD (user space, unrotated).
fn insets(rd: Option<[f32; 4]>, rotate: i32) -> [f64; 4] {
    let Some(rd) = rd else { return [0.0; 4] };
    let turn = (rotate.rem_euclid(360) / 90) as usize;
    std::array::from_fn(|k| rd[(k + 4 - turn) % 4].max(0.0) as f64)
}

fn from_annotation(page: usize, rotate: i32, a: &Annotation) -> Option<Markup> {
    let kind = match a.subtype.as_str() {
        "Square" => RECT,
        "FreeText" if a.intent.is_empty() => TEXT,
        _ => return None,
    };
    let r = a.rect.map(|v| v as f64);
    let i = insets(a.rd, rotate);
    let mut b = [r[0] + i[0], r[1] + i[1], r[2] - i[2], r[3] - i[3]];
    let width = a.border_width.unwrap_or(1.0) as f64;
    let mut style = if kind == TEXT { Style::text() } else { Style::rect() };
    style.width = width;
    style.opacity = a.opacity as f64;
    if kind == RECT {
        // The border is drawn inside the box: its centre line is half a width in.
        let h = width / 2.0;
        b = [b[0] + h, b[1] + h, b[2] - h, b[3] - h];
        style.stroke = a.color.map_or("#000000".into(), hex_color);
        style.fill = a.interior.map(hex_color);
        if a.color.is_none() {
            style.width = 0.0;
        }
    } else {
        // /C is a FreeText's background; its text size and colour are in /DA.
        style.fill = a.color.map(hex_color);
        let (size, color) = parse_da(&a.da);
        style.font_size = Some(size.unwrap_or(12.0));
        let c = color.map_or("#000000".into(), hex_color);
        style.stroke = c.clone();
        style.text_color = Some(c);
    }
    if b[2] < b[0] || b[3] < b[1] {
        b = r;
    }
    let mut m = Markup::new(kind, page, vec![[b[0], b[1]], [b[2], b[3]]], &a.author);
    m.id = if a.name.is_empty() { m.id } else { a.name.clone() };
    m.style = style;
    if kind == TEXT {
        m.text = Some(a.contents.replace('\r', "\n"));
        if a.quadding == 1 {
            m.style.extra.insert("textAlign".into(), "center".into());
        } else if a.quadding == 2 {
            m.style.extra.insert("textAlign".into(), "right".into());
        }
    } else if !a.contents.is_empty() {
        m.comment = Some(a.contents.clone());
    }
    if !a.subject.is_empty() {
        m.subject = Some(a.subject.clone());
    }
    m.created_at = 0.0;
    m.modified_at = 0.0;
    Some(m)
}

/// The font size and fill colour in a default appearance string (`/Helv 12 Tf 1 0 0 rg`).
pub fn parse_da(da: &str) -> (Option<f64>, Option<[f32; 3]>) {
    let toks: Vec<&str> = da.split_whitespace().collect();
    let mut size = None;
    let mut color = None;
    for (i, t) in toks.iter().enumerate() {
        let num = |k: usize| toks.get(i.wrapping_sub(k)).and_then(|s| s.parse::<f32>().ok());
        match *t {
            "Tf" => size = num(1).map(|v| v as f64).filter(|v| *v > 0.0),
            "rg" => {
                if let (Some(r), Some(g), Some(b)) = (num(3), num(2), num(1)) {
                    color = Some([r, g, b]);
                }
            }
            "g" => color = num(1).map(|v| [v, v, v]),
            _ => {}
        }
    }
    (size, color)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn annot(subtype: &str) -> Annotation {
        Annotation {
            index: 3,
            subtype: subtype.into(),
            rect: [10.0, 20.0, 110.0, 70.0],
            opacity: 1.0,
            border_width: Some(2.0),
            color: Some([0.0, 0.0, 1.0]),
            ..Default::default()
        }
    }

    #[test]
    fn square_and_freetext() {
        let ms = import(
            1,
            0,
            &[
                annot("Square"),
                Annotation {
                    da: "/Helv 9 Tf 0 1 0 rg".into(),
                    contents: "Hi".into(),
                    ..annot("FreeText")
                },
                annot("Ink"),
            ],
        );
        assert_eq!(ms.len(), 2);
        assert_eq!(ms[0].kind, RECT);
        assert_eq!(ms[0].points, vec![[11.0, 21.0], [109.0, 69.0]]);
        assert_eq!(ms[0].style.stroke, "#0000ff");
        assert_eq!(ms[1].kind, TEXT);
        assert_eq!(ms[1].style.font_size, Some(9.0));
        assert_eq!(ms[1].style.text_color.as_deref(), Some("#00ff00"));
        assert_eq!(ms[1].style.fill.as_deref(), Some("#0000ff"));
        assert_eq!(ms[1].text.as_deref(), Some("Hi"));
        assert!(
            ms.iter()
                .all(|m| m.pdf_annot.as_ref().unwrap().index == 3 && !m.changed_since_import())
        );
    }

    #[test]
    fn app_data_wins() {
        let mut orig = Markup::new(TEXT, 0, vec![[1.0, 2.0], [3.0, 4.0]], "Sam");
        orig.text = Some("ours".into());
        let a = Annotation {
            app_data: orig.app_data(),
            ..annot("FreeText")
        };
        let ms = import(4, 0, &[a]);
        assert_eq!(ms[0].text.as_deref(), Some("ours"));
        assert_eq!(ms[0].id, orig.id);
        assert_eq!(ms[0].page_index, 4);
    }

    #[test]
    fn rotated_insets() {
        // /RD left 1, top 2, right 3, bottom 4 on a page turned 90°: shown left is the bottom.
        assert_eq!(insets(Some([1.0, 2.0, 3.0, 4.0]), 90), [4.0, 1.0, 2.0, 3.0]);
        assert_eq!(insets(Some([1.0, 2.0, 3.0, 4.0]), 270), [2.0, 3.0, 4.0, 1.0]);
    }
}
