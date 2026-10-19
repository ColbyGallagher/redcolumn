//! Markups: Rectangle and Text, the first two of the TypeScript app's types.
//!
//! [`Markup`] serialises to the same JSON as the TypeScript `Markup` (camelCase, the same field
//! names), and keeps every field it does not know in `extra`, so a markup written by the
//! TypeScript app survives a round trip through this one unchanged.

pub mod geometry;
pub mod import;
pub mod store;
pub mod text;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A point in page space: PDF points, origin at the top-left of the displayed (rotated) page,
/// y down.
pub type Point = [f64; 2];

pub const RECT: &str = "rect";
pub const TEXT: &str = "text";

/// Red, the TypeScript app's default markup colour.
pub const RED: &str = "#ff0000";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    /// CSS hex colour, e.g. `#ff0000`.
    pub stroke: String,
    /// Fill colour, or none.
    pub fill: Option<String>,
    /// Line width in points.
    pub width: f64,
    /// 0..1
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    /// Text colour (the line colour when unset).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Style {
    pub fn rect() -> Self {
        Self {
            stroke: RED.into(),
            fill: None,
            width: 1.5,
            opacity: 1.0,
            font_size: None,
            text_color: None,
            extra: Map::new(),
        }
    }

    pub fn text() -> Self {
        Self {
            stroke: RED.into(),
            fill: None,
            width: 1.0,
            opacity: 1.0,
            font_size: Some(12.0),
            text_color: None,
            extra: Map::new(),
        }
    }

    pub fn font_size(&self) -> f64 {
        self.font_size.unwrap_or(12.0)
    }

    pub fn text_color(&self) -> &str {
        self.text_color.as_deref().unwrap_or(&self.stroke)
    }

    pub fn text_align(&self) -> &str {
        self.extra.get("textAlign").and_then(Value::as_str).unwrap_or("left")
    }
}

/// Links an imported markup to the PDF annotation it came from (see the TypeScript
/// `PdfAnnotLink`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotLink {
    /// Position in its page's /Annots.
    pub index: u32,
    /// [`digest`] of the markup as imported: a different one now means it was changed.
    pub digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Markup {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(rename = "type")]
    pub kind: String,
    pub page_index: usize,
    /// Rectangle and Text: two opposite corners.
    pub points: Vec<Point>,
    pub style: Style,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Locked markups cannot be moved, reshaped, restyled or deleted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf_annot: Option<PdfAnnotLink>,
    #[serde(default = "no_status")]
    pub status: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub created_at: f64,
    #[serde(default)]
    pub modified_at: f64,
    /// Every field this app does not know, kept as it was.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn no_status() -> String {
    "none".into()
}

impl Markup {
    /// A new markup of `kind` (`rect` or `text`) with its default style.
    pub fn new(kind: &str, page_index: usize, points: Vec<Point>, author: &str) -> Self {
        let now = now_ms();
        Self {
            id: new_id(),
            seq: None,
            kind: kind.into(),
            page_index,
            points,
            style: if kind == TEXT { Style::text() } else { Style::rect() },
            text: if kind == TEXT { Some(String::new()) } else { None },
            subject: None,
            comment: None,
            locked: None,
            hidden: None,
            pdf_annot: None,
            status: no_status(),
            author: author.into(),
            created_at: now,
            modified_at: now,
            extra: Map::new(),
        }
    }

    pub fn is_locked(&self) -> bool {
        self.locked == Some(true)
    }

    pub fn is_hidden(&self) -> bool {
        self.hidden == Some(true)
    }

    /// Rectangle and Text are drawn and edited here; other types stay as the PDF draws them.
    pub fn supported(kind: &str) -> bool {
        kind == RECT || kind == TEXT
    }

    /// The type's name as the markups list shows it.
    pub fn label(&self) -> &'static str {
        match self.kind.as_str() {
            RECT => "Rectangle",
            TEXT => "Text Box",
            _ => "Markup",
        }
    }

    /// The JSON saved in the annotation's /NBData: the markup without its link to the PDF.
    pub fn app_data(&self) -> String {
        let mut m = self.clone();
        m.pdf_annot = None;
        serde_json::to_string(&m).unwrap_or_default()
    }

    /// Whether it differs from the annotation it was imported from.
    pub fn changed_since_import(&self) -> bool {
        self.pdf_annot.as_ref().is_none_or(|l| l.digest != digest(self))
    }
}

/// A fingerprint of a markup's content (not its link to the PDF or its modified time).
pub fn digest(m: &Markup) -> String {
    let mut m = m.clone();
    m.pdf_annot = None;
    m.modified_at = 0.0;
    let s = serde_json::to_string(&m).unwrap_or_default();
    // FNV-1a, 64 bits: enough to tell an edit from none.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// A unique id (time and a counter, like the TypeScript app's).
pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    format!("{:x}-{:x}-{:x}", t, std::process::id(), n)
}

/// `#rrggbb` (or `#rgb`) to 0–1 RGB; black when it cannot be read.
pub fn parse_color(s: &str) -> [f64; 3] {
    let h = s.trim().trim_start_matches('#');
    let v: Vec<u8> = match h.len() {
        3 => h
            .chars()
            .filter_map(|c| c.to_digit(16))
            .map(|d| (d * 17) as u8)
            .collect(),
        6 | 8 => (0..3)
            .filter_map(|i| u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).ok())
            .collect(),
        _ => vec![],
    };
    if v.len() < 3 {
        return [0.0; 3];
    }
    [v[0] as f64 / 255.0, v[1] as f64 / 255.0, v[2] as f64 / 255.0]
}

pub fn hex_color(c: [f32; 3]) -> String {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_json_round_trips() {
        // As the TypeScript app writes it, with fields this app does not know.
        let json = r##"{"id":"a1","seq":7,"type":"rect","pageIndex":2,"points":[[10,20],[110,70]],"style":{"stroke":"#ff0000","fill":null,"width":1.5,"opacity":1,"dash":"dashed","cornerRadius":4},"status":"none","author":"Sam","createdAt":1,"modifiedAt":2,"layer":"Review","fields":{"c1":"x"}}"##;
        let m: Markup = serde_json::from_str(json).unwrap();
        assert_eq!(m.kind, RECT);
        assert_eq!(m.points[1], [110.0, 70.0]);
        assert_eq!(m.extra["layer"], "Review");
        assert_eq!(m.style.extra["dash"], "dashed");
        // Numbers compare as numbers (1 and 1.0 are the same to JSON.parse).
        fn norm(v: Value) -> Value {
            match v {
                Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
                Value::Array(a) => Value::Array(a.into_iter().map(norm).collect()),
                Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, norm(v))).collect()),
                v => v,
            }
        }
        let back: Value = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        let orig: Value = serde_json::from_str(json).unwrap();
        assert_eq!(norm(back), norm(orig));
    }

    #[test]
    fn digest_ignores_link_and_time() {
        let mut m = Markup::new(RECT, 0, vec![[0.0, 0.0], [10.0, 10.0]], "me");
        let d = digest(&m);
        m.modified_at += 5.0;
        m.pdf_annot = Some(PdfAnnotLink {
            index: 1,
            digest: d.clone(),
            id: None,
            extra: Map::new(),
        });
        assert_eq!(digest(&m), d);
        assert!(!m.changed_since_import());
        m.points[1][0] = 11.0;
        assert!(m.changed_since_import());
    }

    #[test]
    fn colors() {
        assert_eq!(parse_color("#ff0000"), [1.0, 0.0, 0.0]);
        assert_eq!(parse_color("#0f0"), [0.0, 1.0, 0.0]);
        assert_eq!(hex_color([0.0, 0.0, 1.0]), "#0000ff");
    }
}
