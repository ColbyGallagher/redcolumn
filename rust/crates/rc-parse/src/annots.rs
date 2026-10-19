//! A page's annotations, read straight from its /Annots (PDFium has to parse the whole page's
//! content before it lists them, which on a heavy sheet is most of a second).

use crate::content::decode_text;
use crate::document::{Document, PageNode};
use crate::object::Obj;
use rc_scene::Affine;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Annotation {
    /// Position in the page's /Annots array.
    pub index: u32,
    /// Object number of the annotation's dictionary (0 when it is a direct object).
    pub object: u32,
    pub subtype: String,
    /// /Rect in page space `[x0, y0, x1, y1]` (top-left origin, y down, rotation applied).
    pub rect: [f32; 4],
    /// /RD insets (PDF order: left, top, right, bottom in unrotated user space).
    pub rd: Option<[f32; 4]>,
    /// /C and /IC as 0–1 RGB, when set.
    pub color: Option<[f32; 3]>,
    pub interior: Option<[f32; 3]>,
    /// /BS /W (or /Border's width).
    pub border_width: Option<f32>,
    /// /CA.
    pub opacity: f32,
    pub contents: String,
    pub author: String,
    pub name: String,
    pub subject: String,
    pub da: String,
    pub quadding: i32,
    pub intent: String,
    /// The redcolumn app's own markup data (/NBData), when present.
    pub app_data: String,
    pub flags: u32,
}

impl Annotation {
    /// Drawn (not hidden, not a popup).
    pub fn visible(&self) -> bool {
        const HIDDEN: u32 = 1 << 1;
        const NO_VIEW: u32 = 1 << 5;
        self.flags & (HIDDEN | NO_VIEW) == 0 && self.subtype != "Popup"
    }
}

fn rgb(o: Option<std::sync::Arc<Obj>>) -> Option<[f32; 3]> {
    let o = o?;
    let a = o.as_array()?;
    let v: Vec<f32> = a.iter().filter_map(Obj::as_f32).collect();
    match v.len() {
        1 => Some([v[0]; 3]),
        3 => Some([v[0], v[1], v[2]]),
        4 => {
            let k = v[3];
            Some([
                (1.0 - (v[0] + k).min(1.0)),
                (1.0 - (v[1] + k).min(1.0)),
                (1.0 - (v[2] + k).min(1.0)),
            ])
        }
        _ => None,
    }
}

pub fn annotations(doc: &Document, page: &PageNode) -> Vec<Annotation> {
    let base = Affine::page_from_user(page.crop_box, page.rotate);
    let Some(list) = page.dict.get("Annots").map(|a| doc.resolve(a)) else {
        return Vec::new();
    };
    let Some(list) = list.as_array() else { return Vec::new() };
    let mut out = Vec::new();
    for (i, entry) in list.iter().enumerate() {
        let object = match entry {
            Obj::Ref(n, _) => *n,
            _ => 0,
        };
        let a = doc.resolve(entry);
        let Some(d) = a.as_dict() else { continue };
        let s = |k: &str| {
            doc.dict_get(d, k)
                .and_then(|o| o.as_str().map(decode_text))
                .unwrap_or_default()
        };
        let name = |k: &str| {
            doc.dict_get(d, k)
                .and_then(|o| o.as_name().map(|n| n.as_str().into_owned()))
                .unwrap_or_default()
        };
        let Some(r) = doc.rect(d, "Rect") else { continue };
        let p0 = base.apply_f32(r[0], r[3]);
        let p1 = base.apply_f32(r[2], r[1]);
        let rect = [p0[0].min(p1[0]), p0[1].min(p1[1]), p0[0].max(p1[0]), p0[1].max(p1[1])];
        let rd = doc.dict_get(d, "RD").and_then(|o| {
            let v: Vec<f32> = o.as_array()?.iter().filter_map(Obj::as_f32).collect();
            (v.len() == 4).then(|| [v[0], v[1], v[2], v[3]])
        });
        let border_width = doc
            .dict_get(d, "BS")
            .and_then(|bs| bs.as_dict().and_then(|b| doc.dict_get(b, "W")).and_then(|w| w.as_f32()))
            .or_else(|| {
                doc.dict_get(d, "Border")
                    .and_then(|b| b.as_array().and_then(|a| a.get(2)).and_then(Obj::as_f32))
            });
        out.push(Annotation {
            index: i as u32,
            object,
            subtype: name("Subtype"),
            rect,
            rd,
            color: rgb(doc.dict_get(d, "C")),
            interior: rgb(doc.dict_get(d, "IC")),
            border_width,
            opacity: doc.dict_get(d, "CA").and_then(|o| o.as_f32()).unwrap_or(1.0),
            contents: s("Contents"),
            author: s("T"),
            name: s("NM"),
            subject: s("Subj"),
            da: s("DA"),
            quadding: doc.dict_get(d, "Q").and_then(|o| o.as_i64()).unwrap_or(0) as i32,
            intent: name("IT"),
            app_data: s("NBData"),
            flags: doc.dict_get(d, "F").and_then(|o| o.as_i64()).unwrap_or(0) as u32,
        });
    }
    out
}
