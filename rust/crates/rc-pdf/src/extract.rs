//! Page content through PDFium's page object API: the scene's source until (and wherever) our
//! own parser does not take over.
//!
//! Each path's segments are read once and transformed to page space with the object's matrix,
//! the matrices of the forms it is in, and the page's crop box and rotation. Clip paths become
//! clip nodes, deduplicated by content so thousands of objects sharing a viewport share a node.

use pdfium_render::prelude::*;
use rc_scene::content::{self, Affine, ContentBuilder, Image, Item, PageContent, cap, fill, flags, join, rgba};
use std::collections::HashMap;
use std::os::raw::{c_int, c_uint, c_ulong};

const SEG_LINETO: c_int = 0;
const SEG_BEZIERTO: c_int = 1;
const SEG_MOVETO: c_int = 2;
const TEXT_INVISIBLE: c_int = 3;
/// Stop extracting past this many points (the content is flagged as truncated).
const MAX_POINTS: usize = 80_000_000;

pub(crate) struct Page<'a> {
    pub b: &'a dyn PdfiumLibraryBindings,
    pub doc: FPDF_DOCUMENT,
    pub page: FPDF_PAGE,
}

/// The page's map from PDF user space to page space.
pub fn page_transform(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> Affine {
    let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
    // SAFETY: page is live; r is a valid out pointer.
    unsafe { b.FPDF_GetPageBoundingBox(page, &mut r) };
    let rot = unsafe { b.FPDFPage_GetRotation(page) }.rem_euclid(4) * 90;
    let (x0, x1) = (r.left.min(r.right) as f64, r.left.max(r.right) as f64);
    let (y0, y1) = (r.bottom.min(r.top) as f64, r.bottom.max(r.top) as f64);
    Affine::page_from_user([x0, y0, x1, y1], rot)
}

struct Extractor<'a> {
    p: Page<'a>,
    out: ContentBuilder,
    /// Clip nodes by (content hash, parent).
    clip_nodes: HashMap<(u64, u32), u32>,
}

/// Extracts a page's content in paint order.
pub fn extract_page(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT, page: FPDF_PAGE) -> PageContent {
    // SAFETY: page is live for the whole extraction.
    let (w, h) = unsafe { (b.FPDF_GetPageWidthF(page), b.FPDF_GetPageHeightF(page)) };
    let base = page_transform(b, page);
    let mut x = Extractor { p: Page { b, doc, page }, out: ContentBuilder::new([w, h]), clip_nodes: HashMap::new() };
    let n = unsafe { b.FPDFPage_CountObjects(page) };
    for i in 0..n {
        let obj = unsafe { b.FPDFPage_GetObject(page, i) };
        if obj.is_null() {
            continue;
        }
        if x.out.content.points.len() > MAX_POINTS {
            x.out.content.flags |= flags::TRUNCATED;
            break;
        }
        x.object(obj, &base, content::NONE, content::NONE);
    }
    x.out.finish()
}

impl Extractor<'_> {
    fn object(&mut self, obj: FPDF_PAGEOBJECT, parent: &Affine, parent_clip: u32, parent_layer: u32) {
        let b = self.p.b;
        // SAFETY: obj is a live object of the page (or of a form on it).
        let ty = unsafe { b.FPDFPageObj_GetType(obj) } as u32;
        let m = matrix(b, obj);
        let clip = self.clip(obj, parent, parent_clip);
        let layer = self.layer(obj).unwrap_or(parent_layer);
        match ty {
            FPDF_PAGEOBJ_PATH => self.path(obj, &m.then(parent), clip, layer),
            FPDF_PAGEOBJ_FORM => {
                let to_page = m.then(parent);
                let n = unsafe { b.FPDFFormObj_CountObjects(obj) };
                for i in 0..n.max(0) {
                    let child = unsafe { b.FPDFFormObj_GetObject(obj, i as c_ulong) };
                    if !child.is_null() {
                        self.object(child, &to_page, clip, layer);
                    }
                }
            }
            FPDF_PAGEOBJ_IMAGE => self.image(obj, &m, parent, clip, layer),
            FPDF_PAGEOBJ_TEXT => {
                if unsafe { b.FPDFTextObj_GetTextRenderMode(obj) } != TEXT_INVISIBLE {
                    self.out.content.flags |= flags::TEXT_NOT_EXTRACTED;
                }
            }
            FPDF_PAGEOBJ_SHADING => self.out.content.flags |= flags::SHADING,
            _ => self.out.content.flags |= flags::UNSUPPORTED,
        }
    }

    fn path(&mut self, obj: FPDF_PAGEOBJECT, to_page: &Affine, clip: u32, layer: u32) {
        let b = self.p.b;
        let mut fillmode: c_int = 0;
        let mut stroke: FPDF_BOOL = 0;
        // SAFETY: obj is a live path object; out pointers are valid.
        unsafe { b.FPDFPath_GetDrawMode(obj, &mut fillmode, &mut stroke) };
        if fillmode == 0 && stroke == 0 {
            return;
        }
        let mut item = Item { clip, layer, miter_limit: 10.0, ..Default::default() };
        if fillmode != 0 {
            match color(b, obj, false) {
                Some(c) => {
                    item.fill_rule = if fillmode == 1 { fill::EVENODD } else { fill::NONZERO };
                    item.fill_color = c;
                }
                None => self.out.content.flags |= flags::PATTERN,
            }
        }
        if stroke != 0 {
            match color(b, obj, true) {
                Some(c) => {
                    item.stroked = 1;
                    item.stroke_color = c;
                    let mut w: f32 = 0.0;
                    unsafe { b.FPDFPageObj_GetStrokeWidth(obj, &mut w) };
                    let scale = to_page.mean_scale() as f32;
                    item.width = w.max(0.0) * scale;
                    item.cap = match unsafe { b.FPDFPageObj_GetLineCap(obj) } {
                        1 => cap::ROUND,
                        2 => cap::SQUARE,
                        _ => cap::BUTT,
                    };
                    item.join = match unsafe { b.FPDFPageObj_GetLineJoin(obj) } {
                        1 => join::ROUND,
                        2 => join::BEVEL,
                        _ => join::MITER,
                    };
                    let n = unsafe { b.FPDFPageObj_GetDashCount(obj) };
                    if n > 0 {
                        let mut d = vec![0f32; n as usize];
                        unsafe { b.FPDFPageObj_GetDashArray(obj, d.as_mut_ptr(), n as _) };
                        let mut phase: f32 = 0.0;
                        unsafe { b.FPDFPageObj_GetDashPhase(obj, &mut phase) };
                        let d: Vec<f32> = d.iter().map(|v| v * scale).collect();
                        let (start, len) = self.out.add_dashes(&d);
                        item.dash_start = start;
                        item.dash_len = len;
                        item.dash_phase = phase * scale;
                    }
                }
                None => self.out.content.flags |= flags::PATTERN,
            }
        }
        if (item.fill_rule == fill::NONE) && item.stroked == 0 {
            return;
        }
        let alpha_ok = item.fill_color >> 24 == 255 || item.fill_rule == fill::NONE;
        let alpha_ok = alpha_ok && (item.stroke_color >> 24 == 255 || item.stroked == 0);
        if alpha_ok && unsafe { b.FPDFPageObj_HasTransparency(obj) } != 0 {
            // Transparent without a constant alpha: a blend mode or soft mask.
            self.out.content.flags |= flags::BLEND_MODE;
        }
        let start = self.out.begin_path();
        let n = unsafe { b.FPDFPath_CountSegments(obj) };
        read_segments(n, |i| unsafe { b.FPDFPath_GetPathSegment(obj, i) }, b, to_page, &mut self.out);
        self.out.finish_path(start, item);
    }

    fn image(&mut self, obj: FPDF_PAGEOBJECT, m: &Affine, parent: &Affine, clip: u32, layer: u32) {
        let b = self.p.b;
        // SAFETY: obj is a live image object.
        let transparent = unsafe { b.FPDFPageObj_HasTransparency(obj) } != 0;
        let axis_aligned = m.b.abs() <= 1e-6 && m.c.abs() <= 1e-6 && m.a > 0.0 && m.d > 0.0;
        if transparent && !axis_aligned {
            // PDFium's masked rendering of an image is upright in its bounds; a rotated one with a
            // mask is left to the raster path.
            self.out.content.flags |= flags::SOFT_MASK;
            return;
        }
        // SAFETY: obj is live; the bitmap is destroyed below.
        let bitmap = unsafe {
            if transparent {
                b.FPDFImageObj_GetRenderedBitmap(self.p.doc, self.p.page, obj)
            } else {
                b.FPDFImageObj_GetBitmap(obj)
            }
        };
        if bitmap.is_null() {
            self.out.content.flags |= flags::UNSUPPORTED;
            return;
        }
        let rgba_px = bitmap_rgba(b, bitmap);
        unsafe { b.FPDFBitmap_Destroy(bitmap) };
        let Some((width, height, px)) = rgba_px else {
            self.out.content.flags |= flags::UNSUPPORTED;
            return;
        };
        // Image space (u right, v down, 0..1) to the PDF unit square (y up), then the image's
        // matrix and the containers' transforms. A masked image rendered by PDFium covers the
        // same square, top row first, so the same map holds.
        let unit = Affine::new(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
        let to_page = unit.then(m).then(parent);
        let opacity = 1.0;
        self.out.add_image(Image { width, height, rgba: px, transform: to_page, opacity, smooth: true }, clip, layer);
    }

    /// The object's clip as a clip node (parented to its form's clip), deduplicated.
    fn clip(&mut self, obj: FPDF_PAGEOBJECT, parent: &Affine, parent_clip: u32) -> u32 {
        let b = self.p.b;
        // SAFETY: obj is live; the clip path handle belongs to it.
        let cp = unsafe { b.FPDFPageObj_GetClipPath(obj) };
        if cp.is_null() {
            return parent_clip;
        }
        let paths = unsafe { b.FPDFClipPath_CountPaths(cp) };
        if paths <= 0 {
            return parent_clip;
        }
        // Read the clip's points to hash them (and keep them if the node is new).
        let mut node = parent_clip;
        for pi in 0..paths {
            let n = unsafe { b.FPDFClipPath_CountPathSegments(cp, pi) };
            if n <= 0 {
                continue;
            }
            let mut scratch = ContentBuilder::new([0.0, 0.0]);
            read_segments(n, |i| unsafe { b.FPDFClipPath_GetPathSegment(cp, pi, i) }, b, parent, &mut scratch);
            let c = scratch.finish();
            let hash = hash_path(&c.verbs, &c.points);
            if let Some(&existing) = self.clip_nodes.get(&(hash, node)) {
                node = existing;
                continue;
            }
            let id = self.out.add_clip(&c.verbs, &c.points, fill::NONZERO, node);
            self.clip_nodes.insert((hash, node), id);
            node = id;
        }
        node
    }

    /// The optional content group the object is marked with, if any.
    fn layer(&mut self, obj: FPDF_PAGEOBJECT) -> Option<u32> {
        let b = self.p.b;
        // SAFETY: obj is live; marks belong to it.
        let n = unsafe { b.FPDFPageObj_CountMarks(obj) };
        for i in 0..n.max(0) {
            let mark = unsafe { b.FPDFPageObj_GetMark(obj, i as c_ulong) };
            if mark.is_null() || mark_name(b, mark).as_deref() != Some("OC") {
                continue;
            }
            let name = mark_param(b, mark, "Name").unwrap_or_else(|| "(unnamed layer)".to_string());
            return Some(self.out.layer(&name));
        }
        None
    }
}

fn matrix(b: &dyn PdfiumLibraryBindings, obj: FPDF_PAGEOBJECT) -> Affine {
    let mut m = FS_MATRIX { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };
    // SAFETY: obj is live; m is a valid out pointer.
    if unsafe { b.FPDFPageObj_GetMatrix(obj, &mut m) } == 0 {
        return Affine::IDENTITY;
    }
    Affine::new(m.a as f64, m.b as f64, m.c as f64, m.d as f64, m.e as f64, m.f as f64)
}

fn color(b: &dyn PdfiumLibraryBindings, obj: FPDF_PAGEOBJECT, stroke: bool) -> Option<u32> {
    let (mut r, mut g, mut bl, mut a): (c_uint, c_uint, c_uint, c_uint) = (0, 0, 0, 255);
    // SAFETY: obj is live; out pointers are valid.
    let ok = unsafe {
        if stroke {
            b.FPDFPageObj_GetStrokeColor(obj, &mut r, &mut g, &mut bl, &mut a)
        } else {
            b.FPDFPageObj_GetFillColor(obj, &mut r, &mut g, &mut bl, &mut a)
        }
    };
    (ok != 0).then(|| rgba(r as u8, g as u8, bl as u8, a as u8))
}

/// Reads `n` path segments through `get`, transforms them and appends them to `out`.
fn read_segments(
    n: c_int,
    get: impl Fn(c_int) -> FPDF_PATHSEGMENT,
    b: &dyn PdfiumLibraryBindings,
    to_page: &Affine,
    out: &mut ContentBuilder,
) {
    let mut i = 0;
    let mut pending: Vec<[f32; 2]> = Vec::with_capacity(3);
    while i < n {
        let seg = get(i);
        i += 1;
        if seg.is_null() {
            continue;
        }
        let (mut x, mut y) = (0f32, 0f32);
        // SAFETY: seg is a live segment handle; out pointers are valid.
        unsafe { b.FPDFPathSegment_GetPoint(seg, &mut x, &mut y) };
        let p = to_page.apply_f32(x as f64, y as f64);
        match unsafe { b.FPDFPathSegment_GetType(seg) } {
            SEG_MOVETO => {
                pending.clear();
                out.move_to(p);
            }
            SEG_LINETO => {
                pending.clear();
                out.line_to(p);
            }
            SEG_BEZIERTO => {
                pending.push(p);
                if pending.len() == 3 {
                    out.cubic_to(pending[0], pending[1], pending[2]);
                    pending.clear();
                }
            }
            _ => {}
        }
        if unsafe { b.FPDFPathSegment_GetClose(seg) } != 0 && pending.is_empty() {
            out.close();
        }
    }
}

fn hash_path(verbs: &[u8], points: &[[f32; 2]]) -> u64 {
    // FNV-1a over the raw bytes: clip paths are short, and collisions only cost a shared node
    // between two identical-looking clips.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &byte in verbs.iter().chain(bytemuck_bytes(points)) {
        h ^= byte as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

fn bytemuck_bytes(p: &[[f32; 2]]) -> &[u8] {
    // SAFETY: [f32; 2] has no padding; any bit pattern is a valid u8.
    unsafe { std::slice::from_raw_parts(p.as_ptr() as *const u8, std::mem::size_of_val(p)) }
}

/// A PDFium bitmap as straight RGBA rows.
pub fn bitmap_rgba(b: &dyn PdfiumLibraryBindings, bmp: FPDF_BITMAP) -> Option<(u32, u32, Vec<u8>)> {
    // SAFETY: bmp is live; the buffer holds stride * height bytes.
    let (w, h, stride, format, buf) = unsafe {
        (
            b.FPDFBitmap_GetWidth(bmp),
            b.FPDFBitmap_GetHeight(bmp),
            b.FPDFBitmap_GetStride(bmp),
            b.FPDFBitmap_GetFormat(bmp),
            b.FPDFBitmap_GetBuffer(bmp) as *const u8,
        )
    };
    if w <= 0 || h <= 0 || buf.is_null() {
        return None;
    }
    let (w, h, stride) = (w as usize, h as usize, stride as usize);
    let src = unsafe { std::slice::from_raw_parts(buf, stride * h) };
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        let row = &src[y * stride..];
        let o = &mut out[y * w * 4..(y + 1) * w * 4];
        match format {
            1 => {
                for x in 0..w {
                    let g = row[x];
                    o[x * 4..x * 4 + 4].copy_from_slice(&[g, g, g, 255]);
                }
            }
            2 => {
                for x in 0..w {
                    o[x * 4..x * 4 + 4].copy_from_slice(&[row[x * 3 + 2], row[x * 3 + 1], row[x * 3], 255]);
                }
            }
            3 => {
                for x in 0..w {
                    o[x * 4..x * 4 + 4].copy_from_slice(&[row[x * 4 + 2], row[x * 4 + 1], row[x * 4], 255]);
                }
            }
            4 => {
                for x in 0..w {
                    o[x * 4..x * 4 + 4].copy_from_slice(&[row[x * 4 + 2], row[x * 4 + 1], row[x * 4], row[x * 4 + 3]]);
                }
            }
            _ => return None,
        }
    }
    Some((w as u32, h as u32, out))
}

fn utf16_bytes(buf: &[u8]) -> String {
    let units: Vec<u16> = buf.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
    String::from_utf16_lossy(&units[..end])
}

fn mark_name(b: &dyn PdfiumLibraryBindings, mark: FPDF_PAGEOBJECTMARK) -> Option<String> {
    let mut len: c_ulong = 0;
    // SAFETY: two-call pattern; the buffer is as long as PDFium says.
    unsafe { b.FPDFPageObjMark_GetName(mark, std::ptr::null_mut(), 0, &mut len) };
    if len < 2 {
        return None;
    }
    let mut buf = vec![0u8; len as usize];
    unsafe { b.FPDFPageObjMark_GetName(mark, buf.as_mut_ptr() as *mut FPDF_WCHAR, len, &mut len) };
    Some(utf16_bytes(&buf))
}

fn mark_param(b: &dyn PdfiumLibraryBindings, mark: FPDF_PAGEOBJECTMARK, key: &str) -> Option<String> {
    let mut len: c_ulong = 0;
    // SAFETY: two-call pattern, as above.
    if unsafe { b.FPDFPageObjMark_GetParamStringValue(mark, key, std::ptr::null_mut(), 0, &mut len) } == 0 || len < 2 {
        return None;
    }
    let mut buf = vec![0u8; len as usize];
    unsafe { b.FPDFPageObjMark_GetParamStringValue(mark, key, buf.as_mut_ptr() as *mut FPDF_WCHAR, len, &mut len) };
    Some(utf16_bytes(&buf))
}

fn annot_string(b: &dyn PdfiumLibraryBindings, annot: FPDF_ANNOTATION, key: &str) -> String {
    // SAFETY: two-call pattern; the size is in bytes, UTF-16LE with NUL.
    let n = unsafe { b.FPDFAnnot_GetStringValue(annot, key, std::ptr::null_mut(), 0) } as usize;
    if n <= 2 {
        return String::new();
    }
    let mut buf = vec![0u8; n];
    unsafe { b.FPDFAnnot_GetStringValue(annot, key, buf.as_mut_ptr() as *mut FPDF_WCHAR, n as _) };
    utf16_bytes(&buf)
}

fn annot_color(b: &dyn PdfiumLibraryBindings, annot: FPDF_ANNOTATION, interior: bool) -> Option<[u8; 4]> {
    let key = if interior { "IC" } else { "C" };
    // FPDFAnnot_GetColor answers from the appearance stream when there is one; only report
    // colours the dictionary actually has.
    if unsafe { b.FPDFAnnot_HasKey(annot, key) } == 0 {
        return None;
    }
    let (mut r, mut g, mut bl, mut a): (c_uint, c_uint, c_uint, c_uint) = (0, 0, 0, 255);
    let ty: FPDFANNOT_COLORTYPE = if interior { 1 } else { 0 };
    let ok = unsafe { b.FPDFAnnot_GetColor(annot, ty, &mut r, &mut g, &mut bl, &mut a) };
    (ok != 0).then_some([r as u8, g as u8, bl as u8, a as u8])
}

pub fn subtype_name(t: c_int) -> &'static str {
    const NAMES: [&str; 29] = [
        "Unknown", "Text", "Link", "FreeText", "Line", "Square", "Circle", "Polygon", "PolyLine", "Highlight",
        "Underline", "Squiggly", "StrikeOut", "Stamp", "Caret", "Ink", "Popup", "FileAttachment", "Sound", "Movie",
        "Widget", "Screen", "PrinterMark", "TrapNet", "Watermark", "3D", "RichMedia", "XFAWidget", "Redact",
    ];
    NAMES.get(t as usize).copied().unwrap_or("Unknown")
}

/// The page's annotations, with what importing markups needs.
pub fn annotations(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> Vec<crate::protocol::AnnotInfo> {
    let base = page_transform(b, page);
    // SAFETY: page is live; each annotation handle is closed after use.
    let n = unsafe { b.FPDFPage_GetAnnotCount(page) };
    let mut out = Vec::new();
    for i in 0..n.max(0) {
        let a = unsafe { b.FPDFPage_GetAnnot(page, i) };
        if a.is_null() {
            continue;
        }
        let subtype = subtype_name(unsafe { b.FPDFAnnot_GetSubtype(a) }).to_string();
        let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
        unsafe { b.FPDFAnnot_GetRect(a, &mut r) };
        let p0 = base.apply_f32(r.left as f64, r.top as f64);
        let p1 = base.apply_f32(r.right as f64, r.bottom as f64);
        let rect = [p0[0].min(p1[0]), p0[1].min(p1[1]), p0[0].max(p1[0]), p0[1].max(p1[1])];
        let (mut hr, mut vr, mut bw) = (0f32, 0f32, 1f32);
        if unsafe { b.FPDFAnnot_GetBorder(a, &mut hr, &mut vr, &mut bw) } == 0 {
            bw = 1.0;
        }
        let num = |key: &str| -> Option<f32> {
            let mut v = 0f32;
            (unsafe { b.FPDFAnnot_GetNumberValue(a, key, &mut v) } != 0).then_some(v)
        };
        out.push(crate::protocol::AnnotInfo {
            index: i as u32,
            subtype,
            rect,
            color: annot_color(b, a, false),
            interior: annot_color(b, a, true),
            border_width: bw * base.mean_scale() as f32,
            opacity: num("CA").unwrap_or(1.0),
            contents: annot_string(b, a, "Contents"),
            author: annot_string(b, a, "T"),
            name: annot_string(b, a, "NM"),
            subject: annot_string(b, a, "Subj"),
            da: annot_string(b, a, "DA"),
            quadding: num("Q").unwrap_or(0.0) as i32,
            intent: annot_string(b, a, "IT"),
            app_data: annot_string(b, a, "NBData"),
            flags: unsafe { b.FPDFAnnot_GetFlags(a) } as u32,
        });
        unsafe { b.FPDFPage_CloseAnnot(a) };
    }
    out
}

/// Text runs (one per line rectangle PDFium finds), for selection and search.
pub fn text_runs(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> Vec<crate::protocol::TextRun> {
    let base = page_transform(b, page);
    // SAFETY: page is live; the text page is closed after use.
    let tp = unsafe { b.FPDFText_LoadPage(page) };
    if tp.is_null() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let n = unsafe { b.FPDFText_CountRects(tp, 0, -1) };
    for i in 0..n.max(0) {
        let (mut l, mut t, mut r, mut bo) = (0f64, 0f64, 0f64, 0f64);
        if unsafe { b.FPDFText_GetRect(tp, i, &mut l, &mut t, &mut r, &mut bo) } == 0 {
            continue;
        }
        let len = unsafe { b.FPDFText_GetBoundedText(tp, l, t, r, bo, std::ptr::null_mut(), 0) };
        let mut buf = vec![0u16; len.max(0) as usize + 1];
        unsafe { b.FPDFText_GetBoundedText(tp, l, t, r, bo, buf.as_mut_ptr(), buf.len() as c_int) };
        let end = buf.iter().position(|&u| u == 0).unwrap_or(buf.len());
        let text = String::from_utf16_lossy(&buf[..end]);
        let p0 = base.apply_f32(l, t);
        let p1 = base.apply_f32(r, bo);
        out.push(crate::protocol::TextRun {
            text,
            rect: [p0[0].min(p1[0]), p0[1].min(p1[1]), p0[0].max(p1[0]), p0[1].max(p1[1])],
        });
    }
    unsafe { b.FPDFText_ClosePage(tp) };
    out
}
