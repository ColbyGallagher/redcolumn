//! Fonts for drawing text as outlines: embedded TrueType and OpenType (through skrifa), simple
//! fonts' encodings, Type0 fonts with Identity encodings, and Type 3 fonts (drawn by the
//! interpreter from their glyph procedures). Fonts this cannot draw exactly (CFF and Type 1
//! programs, non-embedded fonts, other CMaps) are reported, and their text is drawn by PDFium in
//! the text layer.

use crate::content::Path;
use crate::document::Document;
use crate::object::{Dict, Obj, Stream};
use rc_scene::Affine;
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId, MetadataProvider};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub enum Kind {
    /// One byte per code; each code's glyph id.
    Simple { gids: Box<[Option<u16>; 256]> },
    /// Two bytes per code (Identity-H); the CID-to-glyph map, or identity when absent.
    Cid { cid_to_gid: Option<Vec<u16>> },
    /// Glyph procedures by code, the font matrix and the procedures' resources.
    Type3 { procs: HashMap<u8, Stream>, matrix: Affine, resources: Dict },
    /// Not drawable here.
    Unsupported,
}

pub struct Font {
    pub kind: Kind,
    /// Simple and Type 3 fonts: width per code in glyph space (thousandths of text space for
    /// simple fonts, the font matrix's units for Type 3).
    widths: Box<[f32; 256]>,
    /// CID fonts: widths by CID, and the default.
    cid_widths: HashMap<u32, f32>,
    default_width: f32,
    program: Option<Arc<[u8]>>,
    upem: f32,
    outlines: Mutex<HashMap<u16, Arc<Path>>>,
}

impl Font {
    pub fn unsupported() -> Self {
        Font {
            kind: Kind::Unsupported,
            widths: Box::new([0.0; 256]),
            cid_widths: HashMap::new(),
            default_width: 1000.0,
            program: None,
            upem: 1000.0,
            outlines: Mutex::new(HashMap::new()),
        }
    }

    pub fn drawable(&self) -> bool {
        !matches!(self.kind, Kind::Unsupported)
    }

    pub fn two_byte(&self) -> bool {
        matches!(self.kind, Kind::Cid { .. })
    }

    /// Splits a string into codes.
    pub fn codes(&self, s: &[u8]) -> Vec<u32> {
        if self.two_byte() {
            s.chunks(2).map(|c| (c[0] as u32) << 8 | *c.get(1).unwrap_or(&0) as u32).collect()
        } else {
            s.iter().map(|&b| b as u32).collect()
        }
    }

    /// A code's advance in thousandths of text space (simple and CID fonts) or glyph space (Type 3).
    pub fn width(&self, code: u32) -> f32 {
        match self.kind {
            Kind::Cid { .. } => self.cid_widths.get(&code).copied().unwrap_or(self.default_width),
            _ => self.widths[(code & 0xff) as usize],
        }
    }

    pub fn gid(&self, code: u32) -> Option<u16> {
        match &self.kind {
            Kind::Simple { gids } => gids[(code & 0xff) as usize],
            Kind::Cid { cid_to_gid } => match cid_to_gid {
                Some(map) => map.get(code as usize).copied(),
                None => u16::try_from(code).ok(),
            },
            _ => None,
        }
    }

    /// A glyph's outline in text space units (1 = the font size), y up.
    pub fn outline(&self, gid: u16) -> Option<Arc<Path>> {
        if let Some(p) = self.outlines.lock().unwrap().get(&gid) {
            return Some(p.clone());
        }
        let data = self.program.as_ref()?;
        let font = FontRef::new(data).ok()?;
        let glyph = font.outline_glyphs().get(GlyphId::new(gid as u32))?;
        let mut pen = Pen { path: Path::default(), scale: 1.0 / self.upem };
        glyph
            .draw(skrifa::outline::DrawSettings::unhinted(skrifa::instance::Size::unscaled(), skrifa::instance::LocationRef::default()), &mut pen)
            .ok()?;
        let p = Arc::new(pen.path);
        self.outlines.lock().unwrap().insert(gid, p.clone());
        Some(p)
    }
}

struct Pen {
    path: Path,
    scale: f32,
}

impl skrifa::outline::OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.path.move_to([x * self.scale, y * self.scale]);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.path.line_to([x * self.scale, y * self.scale]);
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        let s = self.scale;
        let p0 = self.path.current();
        let c = [cx * s, cy * s];
        let p = [x * s, y * s];
        // Quadratic to cubic.
        let c1 = [p0[0] + 2.0 / 3.0 * (c[0] - p0[0]), p0[1] + 2.0 / 3.0 * (c[1] - p0[1])];
        let c2 = [p[0] + 2.0 / 3.0 * (c[0] - p[0]), p[1] + 2.0 / 3.0 * (c[1] - p[1])];
        self.path.cubic_to(c1, c2, p);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let s = self.scale;
        self.path.cubic_to([cx0 * s, cy0 * s], [cx1 * s, cy1 * s], [x * s, y * s]);
    }
    fn close(&mut self) {
        self.path.close();
    }
}

/// Loads a font dictionary.
pub fn load(doc: &Document, font: &Dict) -> Font {
    let subtype = font.get("Subtype").and_then(Obj::as_name).map(|n| n.as_bytes().to_vec()).unwrap_or_default();
    match &subtype[..] {
        b"Type0" => load_type0(doc, font),
        b"Type3" => load_type3(doc, font),
        b"TrueType" | b"Type1" | b"MMType1" => load_simple(doc, font),
        _ => Font::unsupported(),
    }
}

/// The embedded program, if it is one skrifa reads (TrueType, or OpenType in FontFile3).
fn program(doc: &Document, descriptor: &Dict) -> Option<Arc<[u8]>> {
    for key in ["FontFile2", "FontFile3"] {
        let Some(s) = doc.dict_get(descriptor, key) else { continue };
        let Obj::Stream(s) = s.as_ref() else { continue };
        if key == "FontFile3" && !s.dict.get("Subtype").and_then(Obj::as_name).is_some_and(|n| n.is("OpenType")) {
            // Bare CFF (Type1C, CIDFontType0C) is not drawn here.
            return None;
        }
        let data: Arc<[u8]> = doc.decode(s).ok()?.into();
        if FontRef::new(&data).is_ok() {
            return Some(data);
        }
    }
    None
}

fn upem(data: &[u8]) -> f32 {
    FontRef::new(data).ok().and_then(|f| f.head().ok()).map(|h| h.units_per_em() as f32).filter(|&u| u > 0.0).unwrap_or(1000.0)
}

fn load_simple(doc: &Document, font: &Dict) -> Font {
    let mut f = Font::unsupported();
    let first = doc.dict_get(font, "FirstChar").and_then(|o| o.as_i64()).unwrap_or(0).clamp(0, 255) as usize;
    if let Some(w) = doc.dict_get(font, "Widths") {
        for (i, v) in w.as_array().unwrap_or(&[]).iter().enumerate() {
            if first + i < 256 {
                f.widths[first + i] = doc.resolve(v).as_f32().unwrap_or(0.0);
            }
        }
    }
    let Some(desc) = doc.dict_get(font, "FontDescriptor") else { return f };
    let Some(desc) = desc.as_dict() else { return f };
    let Some(data) = program(doc, desc) else { return f };
    let flags = doc.dict_get(desc, "Flags").and_then(|o| o.as_i64()).unwrap_or(0);
    let symbolic = flags & 4 != 0;
    let names = encoding_names(doc, font);
    let gids = {
    let Ok(fr) = FontRef::new(&data) else { return f };
    let charmap = fr.charmap();
    let mut gids: Box<[Option<u16>; 256]> = Box::new([None; 256]);
    let records = cmap_lookup(&fr);
    for code in 0..256usize {
        let mut gid = None;
        if !symbolic || names.as_ref().is_some_and(|n| n[code].is_some()) {
            let uni = names.as_ref().and_then(|n| n[code].as_deref()).and_then(glyph_unicode).or_else(|| (!symbolic).then(|| winansi(code as u8)));
            if let Some(u) = uni {
                gid = charmap.map(u).map(|g| g.to_u32() as u16).filter(|&g| g != 0);
            }
        }
        if gid.is_none() {
            // Symbolic fonts: the (3,0) table at F000+code, or the Mac (1,0) table at code.
            for c in [0xF000 + code as u32, code as u32, 0xF100 + code as u32, 0xF200 + code as u32] {
                if let Some(g) = records(c) {
                    gid = Some(g);
                    break;
                }
            }
        }
        gids[code] = gid;
    }
    gids
    };
    f.upem = upem(&data);
    f.program = Some(data);
    f.kind = Kind::Simple { gids };
    f
}

/// Looks codes up in the font's (3,0) and (1,0) cmap subtables.
fn cmap_lookup<'a>(fr: &FontRef<'a>) -> impl Fn(u32) -> Option<u16> + 'a {
    let tables: Vec<skrifa::raw::tables::cmap::CmapSubtable<'a>> = match fr.cmap() {
        Ok(cmap) => cmap
            .encoding_records()
            .iter()
            .filter(|r| {
                let (p, e) = (r.platform_id() as u16, r.encoding_id());
                (p == 3 && e == 0) || (p == 1 && e == 0)
            })
            .filter_map(|r| r.subtable(cmap.offset_data()).ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    use skrifa::raw::tables::cmap::CmapSubtable as T;
    move |c| {
        tables
            .iter()
            .find_map(|t| match t {
                T::Format0(t) => t.map_codepoint(c),
                T::Format4(t) => t.map_codepoint(c),
                T::Format6(t) => t.map_codepoint(c),
                T::Format12(t) => t.map_codepoint(c),
                _ => None,
            })
            .map(|g| g.to_u32() as u16)
            .filter(|&g| g != 0)
    }
}

fn load_type0(doc: &Document, font: &Dict) -> Font {
    let mut f = Font::unsupported();
    let identity = doc.dict_get(font, "Encoding").and_then(|e| e.as_name().map(|n| n.is("Identity-H"))).unwrap_or(false);
    if !identity {
        return f;
    }
    let Some(desc_fonts) = doc.dict_get(font, "DescendantFonts") else { return f };
    let Some(cid) = desc_fonts.as_array().and_then(|a| a.first()).map(|o| doc.resolve(o)) else { return f };
    let Some(cid) = cid.as_dict() else { return f };
    f.default_width = doc.dict_get(cid, "DW").and_then(|o| o.as_f32()).unwrap_or(1000.0);
    if let Some(w) = doc.dict_get(cid, "W") {
        parse_cid_widths(doc, w.as_array().unwrap_or(&[]), &mut f.cid_widths);
    }
    let Some(desc) = doc.dict_get(cid, "FontDescriptor") else { return f };
    let Some(desc) = desc.as_dict() else { return f };
    let Some(data) = program(doc, desc) else { return f };
    let cid_to_gid = match doc.dict_get(cid, "CIDToGIDMap").as_deref() {
        Some(Obj::Stream(s)) => doc.decode(s).ok().map(|b| b.chunks(2).map(|c| (c[0] as u16) << 8 | *c.get(1).unwrap_or(&0) as u16).collect()),
        _ => None,
    };
    f.upem = upem(&data);
    f.program = Some(data);
    f.kind = Kind::Cid { cid_to_gid };
    f
}

fn parse_cid_widths(doc: &Document, w: &[Obj], out: &mut HashMap<u32, f32>) {
    let mut i = 0;
    while i < w.len() {
        let Some(first) = doc.resolve(&w[i]).as_i64() else { break };
        let next = doc.resolve(w.get(i + 1).unwrap_or(&Obj::Null));
        match next.as_ref() {
            Obj::Array(list) => {
                for (k, v) in list.iter().enumerate() {
                    out.insert(first as u32 + k as u32, doc.resolve(v).as_f32().unwrap_or(0.0));
                }
                i += 2;
            }
            _ => {
                let last = next.as_i64().unwrap_or(first);
                let width = w.get(i + 2).map(|o| doc.resolve(o).as_f32().unwrap_or(0.0)).unwrap_or(0.0);
                for c in first..=last.min(first + 65535) {
                    out.insert(c as u32, width);
                }
                i += 3;
            }
        }
    }
}

fn load_type3(doc: &Document, font: &Dict) -> Font {
    let mut f = Font::unsupported();
    let m: Vec<f64> = doc
        .dict_get(font, "FontMatrix")
        .and_then(|a| a.as_array().map(|a| a.iter().filter_map(|o| doc.resolve(o).as_f64()).collect()))
        .unwrap_or_default();
    let matrix = if m.len() == 6 { Affine::new(m[0], m[1], m[2], m[3], m[4], m[5]) } else { Affine::new(0.001, 0.0, 0.0, 0.001, 0.0, 0.0) };
    let first = doc.dict_get(font, "FirstChar").and_then(|o| o.as_i64()).unwrap_or(0).clamp(0, 255) as usize;
    if let Some(w) = doc.dict_get(font, "Widths") {
        for (i, v) in w.as_array().unwrap_or(&[]).iter().enumerate() {
            if first + i < 256 {
                f.widths[first + i] = doc.resolve(v).as_f32().unwrap_or(0.0);
            }
        }
    }
    let names = encoding_names(doc, font).unwrap_or_else(|| Box::new(std::array::from_fn(|_| None)));
    let Some(procs) = doc.dict_get(font, "CharProcs") else { return f };
    let Some(procs) = procs.as_dict() else { return f };
    let mut by_code = HashMap::new();
    for (code, name) in names.iter().enumerate() {
        let Some(name) = name else { continue };
        if let Some(p) = procs.0.iter().find(|(k, _)| k.as_bytes() == name.as_bytes()).map(|(_, v)| doc.resolve(v))
            && let Obj::Stream(s) = p.as_ref()
        {
            by_code.insert(code as u8, s.clone());
        }
    }
    let resources = doc.dict_get(font, "Resources").and_then(|r| r.as_dict().cloned()).unwrap_or_default();
    f.kind = Kind::Type3 { procs: by_code, matrix, resources };
    f
}

/// Glyph names by code from /Encoding (a base encoding and /Differences). None when the font
/// has no /Encoding.
fn encoding_names(doc: &Document, font: &Dict) -> Option<Box<[Option<String>; 256]>> {
    let enc = doc.dict_get(font, "Encoding")?;
    let mut names: Box<[Option<String>; 256]> = Box::new(std::array::from_fn(|_| None));
    let base = match enc.as_ref() {
        Obj::Name(n) => Some(n.clone()),
        Obj::Dict(d) => d.get("BaseEncoding").and_then(Obj::as_name).cloned(),
        _ => None,
    };
    if let Some(b) = base {
        for (code, slot) in names.iter_mut().enumerate() {
            let u = match b.as_bytes() {
                b"MacRomanEncoding" => macroman(code as u8),
                _ => winansi(code as u8),
            };
            *slot = Some(format!("uni{u:04X}"));
        }
    }
    if let Obj::Dict(d) = enc.as_ref()
        && let Some(diffs) = doc.dict_get(d, "Differences")
    {
        let mut code = 0usize;
        for o in diffs.as_array().unwrap_or(&[]) {
            match o {
                Obj::Int(c) => code = (*c).clamp(0, 255) as usize,
                Obj::Name(n) => {
                    if code < 256 {
                        names[code] = Some(n.as_str().into_owned());
                    }
                    code += 1;
                }
                _ => {}
            }
        }
    }
    Some(names)
}

/// The Unicode value of a glyph name: `uniXXXX`, `uXXXX[XX]`, single characters and the common
/// Latin names.
pub fn glyph_unicode(name: &str) -> Option<u32> {
    if let Some(h) = name.strip_prefix("uni")
        && h.len() >= 4
    {
        return u32::from_str_radix(&h[..4], 16).ok();
    }
    if let Some(h) = name.strip_prefix('u')
        && (4..=6).contains(&h.len())
        && let Ok(v) = u32::from_str_radix(h, 16)
    {
        return Some(v);
    }
    let mut chars = name.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return Some(c as u32);
    }
    const NAMES: &[(&str, u32)] = &[
        ("space", 0x20), ("exclam", 0x21), ("quotedbl", 0x22), ("numbersign", 0x23), ("dollar", 0x24), ("percent", 0x25),
        ("ampersand", 0x26), ("quotesingle", 0x27), ("quoteright", 0x2019), ("parenleft", 0x28), ("parenright", 0x29),
        ("asterisk", 0x2a), ("plus", 0x2b), ("comma", 0x2c), ("hyphen", 0x2d), ("minus", 0x2212), ("period", 0x2e),
        ("slash", 0x2f), ("zero", 0x30), ("one", 0x31), ("two", 0x32), ("three", 0x33), ("four", 0x34), ("five", 0x35),
        ("six", 0x36), ("seven", 0x37), ("eight", 0x38), ("nine", 0x39), ("colon", 0x3a), ("semicolon", 0x3b),
        ("less", 0x3c), ("equal", 0x3d), ("greater", 0x3e), ("question", 0x3f), ("at", 0x40), ("bracketleft", 0x5b),
        ("backslash", 0x5c), ("bracketright", 0x5d), ("asciicircum", 0x5e), ("underscore", 0x5f), ("grave", 0x60),
        ("quoteleft", 0x2018), ("braceleft", 0x7b), ("bar", 0x7c), ("braceright", 0x7d), ("asciitilde", 0x7e),
        ("degree", 0xb0), ("plusminus", 0xb1), ("multiply", 0xd7), ("divide", 0xf7), ("mu", 0xb5), ("Omega", 0x3a9),
        ("periodcentered", 0xb7), ("bullet", 0x2022), ("endash", 0x2013), ("emdash", 0x2014), ("copyright", 0xa9),
        ("registered", 0xae), ("trademark", 0x2122), ("section", 0xa7), ("paragraph", 0xb6), ("twosuperior", 0xb2),
        ("threesuperior", 0xb3), ("onehalf", 0xbd), ("onequarter", 0xbc), ("threequarters", 0xbe), ("diameter", 0x2300),
        ("Euro", 0x20ac), ("nbspace", 0xa0), ("quotedblleft", 0x201c), ("quotedblright", 0x201d), ("ellipsis", 0x2026),
    ];
    NAMES.iter().find(|(n, _)| *n == name).map(|&(_, u)| u)
}

/// WinAnsiEncoding (Windows-1252) to Unicode.
pub fn winansi(c: u8) -> u32 {
    const HIGH: [u16; 32] = [
        0x20ac, 0x2022, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x2022,
        0x017d, 0x2022, 0x2022, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
        0x0153, 0x2022, 0x017e, 0x0178,
    ];
    match c {
        0x80..=0x9f => HIGH[(c - 0x80) as usize] as u32,
        _ => c as u32,
    }
}

/// MacRomanEncoding to Unicode.
pub fn macroman(c: u8) -> u32 {
    const HIGH: [u16; 128] = [
        0xc4, 0xc5, 0xc7, 0xc9, 0xd1, 0xd6, 0xdc, 0xe1, 0xe0, 0xe2, 0xe4, 0xe3, 0xe5, 0xe7, 0xe9, 0xe8, 0xea, 0xeb, 0xed,
        0xec, 0xee, 0xef, 0xf1, 0xf3, 0xf2, 0xf4, 0xf6, 0xf5, 0xfa, 0xf9, 0xfb, 0xfc, 0x2020, 0xb0, 0xa2, 0xa3, 0xa7,
        0x2022, 0xb6, 0xdf, 0xae, 0xa9, 0x2122, 0xb4, 0xa8, 0x2260, 0xc6, 0xd8, 0x221e, 0xb1, 0x2264, 0x2265, 0xa5, 0xb5,
        0x2202, 0x2211, 0x220f, 0x3c0, 0x222b, 0xaa, 0xba, 0x3a9, 0xe6, 0xf8, 0xbf, 0xa1, 0xac, 0x221a, 0x192, 0x2248,
        0x2206, 0xab, 0xbb, 0x2026, 0xa0, 0xc0, 0xc3, 0xd5, 0x152, 0x153, 0x2013, 0x2014, 0x201c, 0x201d, 0x2018, 0x2019,
        0xf7, 0x25ca, 0xff, 0x178, 0x2044, 0x20ac, 0x2039, 0x203a, 0xfb01, 0xfb02, 0x2021, 0xb7, 0x201a, 0x201e, 0x2030,
        0xc2, 0xca, 0xc1, 0xcb, 0xc8, 0xcd, 0xce, 0xcf, 0xcc, 0xd3, 0xd4, 0xf8ff, 0xd2, 0xda, 0xdb, 0xd9, 0x131, 0x2c6,
        0x2dc, 0xaf, 0x2d8, 0x2d9, 0x2da, 0xb8, 0x2dd, 0x2db, 0x2c7,
    ];
    if c < 0x80 { c as u32 } else { HIGH[(c - 0x80) as usize] as u32 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyph_names() {
        assert_eq!(glyph_unicode("A"), Some(0x41));
        assert_eq!(glyph_unicode("uni2300"), Some(0x2300));
        assert_eq!(glyph_unicode("u1F600"), Some(0x1F600));
        assert_eq!(glyph_unicode("degree"), Some(0xb0));
        assert_eq!(glyph_unicode("notaname"), None);
        assert_eq!(winansi(0x80), 0x20ac);
        assert_eq!(macroman(0x80), 0xc4);
    }
}
