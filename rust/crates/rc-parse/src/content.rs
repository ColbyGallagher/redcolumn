//! The content stream interpreter: runs a page's operators and writes its content
//! (`rc_scene::PageContent`) in page space, as it goes.
//!
//! - Points are transformed to page space as paths are built (the CTM cannot change inside a
//!   path), straight into the content's arrays.
//! - The page's content streams and the forms it places are decompressed in parallel before the
//!   interpreter starts.
//! - With `chunk_items` set, content is handed over in chunks while the page is still being
//!   read, so the scene can be built (and shown) in pieces.

use crate::color::{self, ColorSpace};
use crate::document::{Document, PageNode};
use crate::font::{self, Font, Kind};
use crate::image;
use crate::object::{Dict, Lexer, Name, Obj, Stream, StreamData, Token};
use rayon::prelude::*;
use rc_scene::content::{self as rc, Affine, ContentBuilder, Item, PageContent, cap, fill, flags, join, rgba};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// A path in its own coordinates (glyph outlines), before transforming to page space.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Path {
    pub verbs: Vec<u8>,
    pub points: Vec<[f32; 2]>,
}

impl Path {
    pub fn move_to(&mut self, p: [f32; 2]) {
        self.verbs.push(rc::verb::MOVE);
        self.points.push(p);
    }
    pub fn line_to(&mut self, p: [f32; 2]) {
        self.verbs.push(rc::verb::LINE);
        self.points.push(p);
    }
    pub fn cubic_to(&mut self, c1: [f32; 2], c2: [f32; 2], p: [f32; 2]) {
        self.verbs.push(rc::verb::CUBIC);
        self.points.extend_from_slice(&[c1, c2, p]);
    }
    pub fn close(&mut self) {
        self.verbs.push(rc::verb::CLOSE);
    }
    pub fn current(&self) -> [f32; 2] {
        self.points.last().copied().unwrap_or([0.0, 0.0])
    }
}

#[derive(Clone, Debug)]
pub struct Options {
    /// Hand content over every this many items (0: return the page whole).
    pub chunk_items: usize,
    /// Draw text as glyph outlines where every font on the page allows it.
    pub text: bool,
    /// Tokenise large streams on several cores: streams of at least `parallel_min` bytes, in
    /// tasks of `token_chunk` bytes.
    pub parallel: bool,
    pub parallel_min: usize,
    pub token_chunk: usize,
}

impl Default for Options {
    fn default() -> Self {
        Self { chunk_items: 0, text: true, parallel: true, parallel_min: 4 << 20, token_chunk: 1 << 20 }
    }
}

/// Item count depth is spread over when a page comes in chunks (its total is not known yet).
pub const CHUNK_SLOT_TOTAL: u32 = 1 << 22;
/// Forms nest no deeper than this.
const MAX_FORM_DEPTH: usize = 28;

#[derive(Clone)]
struct GState {
    ctm: Affine,
    fill_cs: ColorSpace,
    stroke_cs: ColorSpace,
    fill: Option<[u8; 3]>,
    stroke: Option<[u8; 3]>,
    fill_alpha: f32,
    stroke_alpha: f32,
    width: f32,
    cap: u8,
    join: u8,
    miter: f32,
    dash: Arc<[f32]>,
    dash_phase: f32,
    clip: u32,
    // Text state.
    font: Option<Arc<Font>>,
    font_size: f32,
    char_spacing: f32,
    word_spacing: f32,
    h_scale: f32,
    leading: f32,
    rise: f32,
    render: i32,
}

impl GState {
    fn new(ctm: Affine) -> Self {
        GState {
            ctm,
            fill_cs: ColorSpace::Gray,
            stroke_cs: ColorSpace::Gray,
            fill: Some([0, 0, 0]),
            stroke: Some([0, 0, 0]),
            fill_alpha: 1.0,
            stroke_alpha: 1.0,
            width: 1.0,
            cap: cap::BUTT,
            join: join::MITER,
            miter: 10.0,
            dash: Arc::from(&[][..]),
            dash_phase: 0.0,
            clip: rc::NONE,
            font: None,
            font_size: 0.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            h_scale: 1.0,
            leading: 0.0,
            rise: 0.0,
            render: 0,
        }
    }
}

#[derive(Clone, Debug)]
enum Operand<'a> {
    Num(f64),
    Name(&'a [u8]),
    Str(Vec<u8>),
    Arr(Vec<Operand<'a>>),
    Dict(Dict),
    Other,
}

impl Operand<'_> {
    fn num(&self) -> Option<f64> {
        match self {
            Operand::Num(n) => Some(*n),
            _ => None,
        }
    }
}

struct Interp<'d, 'f> {
    doc: &'d Document,
    out: ContentBuilder,
    gs: GState,
    stack: Vec<GState>,
    /// The path being built: where it starts in the content's arrays.
    path: Option<(u32, u32)>,
    /// Current point and subpath start, in user space.
    cur: [f64; 2],
    start: [f64; 2],
    clip_rule: Option<u8>,
    tm: Affine,
    tlm: Affine,
    fonts: HashMap<(usize, Vec<u8>), Arc<Font>>,
    /// Marked content: the layer each level sets (NONE when it sets none).
    marks: Vec<u32>,
    layer: u32,
    hidden: HashSet<u32>,
    forms: HashMap<u32, Arc<Vec<u8>>>,
    form_stack: Vec<u32>,
    /// Text is drawn as outlines on this page (every font allows it).
    text_outlines: bool,
    /// Inside an uncoloured Type 3 glyph: colour operators are ignored.
    uncolored: bool,
    opts: &'f Options,
    on_chunk: &'f mut dyn FnMut(PageContent),
}

/// Reads a page. With `opts.chunk_items` set, chunks go to `on_chunk` as they fill and the rest
/// is returned; otherwise the whole page is returned.
pub fn extract_page(doc: &Document, page: &PageNode, opts: &Options, on_chunk: &mut dyn FnMut(PageContent)) -> PageContent {
    let rotate = page.rotate;
    let base = Affine::page_from_user(page.crop_box, rotate);
    let [x0, y0, x1, y1] = page.crop_box;
    let (w, h) = if rotate % 180 == 0 { (x1 - x0, y1 - y0) } else { (y1 - y0, x1 - x0) };
    let hidden: HashSet<u32> = doc
        .hidden_layers()
        .iter()
        .filter_map(|o| match o {
            Obj::Ref(n, _) => Some(*n),
            _ => None,
        })
        .collect();
    let mut it = Interp {
        doc,
        out: ContentBuilder::new([w as f32, h as f32]),
        gs: GState::new(base),
        stack: Vec::new(),
        path: None,
        cur: [0.0; 2],
        start: [0.0; 2],
        clip_rule: None,
        tm: Affine::IDENTITY,
        tlm: Affine::IDENTITY,
        fonts: HashMap::new(),
        marks: Vec::new(),
        layer: rc::NONE,
        hidden,
        forms: HashMap::new(),
        form_stack: Vec::new(),
        text_outlines: opts.text,
        uncolored: false,
        opts,
        on_chunk,
    };
    if doc.hidden_layers().iter().any(|o| matches!(o, Obj::Name(n) if n.is("*"))) {
        it.out.content.flags |= flags::UNSUPPORTED;
    }
    // Every font must be drawable for text to be outlines; otherwise PDFium draws all of it.
    if it.text_outlines && !fonts_drawable(&mut it, &page.resources, 0) {
        it.text_outlines = false;
    }
    let contents = page.dict.get("Contents").map(|c| doc.resolve(c));
    let streams: Vec<Stream> = match contents.as_deref() {
        Some(Obj::Stream(s)) => vec![s.clone()],
        Some(Obj::Array(a)) => a.iter().filter_map(|o| match doc.resolve(o).as_ref() {
            Obj::Stream(s) => Some(s.clone()),
            _ => None,
        }).collect(),
        _ => vec![],
    };
    // Decompress the content streams and the page's forms in parallel.
    prefetch_forms(&mut it, &page.resources);
    let parts: Vec<Vec<u8>> = streams.par_iter().map(|s| doc.decode(s).unwrap_or_default()).collect();
    let mut data = Vec::with_capacity(parts.iter().map(|p| p.len() + 1).sum());
    for p in parts {
        data.extend_from_slice(&p);
        data.push(b'\n');
    }
    it.run(&data, &page.resources);
    if opts.chunk_items > 0 {
        it.out.take_chunk(CHUNK_SLOT_TOTAL)
    } else {
        it.out.finish()
    }
}

/// Whether every font reachable from these resources (forms included) can be drawn as outlines.
fn fonts_drawable(it: &mut Interp, resources: &Dict, depth: usize) -> bool {
    if depth > 6 {
        return true;
    }
    let doc = it.doc;
    if let Some(fonts) = doc.dict_get(resources, "Font").and_then(|f| f.as_dict().cloned()) {
        for (name, _) in fonts.iter() {
            let f = it.font(resources, name.as_bytes());
            if !f.is_some_and(|f| f.drawable()) {
                return false;
            }
        }
    }
    if let Some(xobjs) = doc.dict_get(resources, "XObject").and_then(|x| x.as_dict().cloned()) {
        for (_, v) in xobjs.iter() {
            let o = doc.resolve(v);
            if let Obj::Stream(s) = o.as_ref()
                && s.dict.get("Subtype").and_then(Obj::as_name).is_some_and(|n| n.is("Form"))
                && let Some(r) = doc.dict_get(&s.dict, "Resources").and_then(|r| r.as_dict().cloned())
                && !fonts_drawable(it, &r, depth + 1)
            {
                return false;
            }
        }
    }
    true
}

fn prefetch_forms(it: &mut Interp, resources: &Dict) {
    let doc = it.doc;
    let Some(xobjs) = doc.dict_get(resources, "XObject").and_then(|x| x.as_dict().cloned()) else { return };
    let forms: Vec<(u32, Stream)> = xobjs
        .iter()
        .filter_map(|(_, v)| {
            let Obj::Ref(n, _) = v else { return None };
            let o = doc.resolve(v);
            match o.as_ref() {
                Obj::Stream(s) if s.dict.get("Subtype").and_then(Obj::as_name).is_some_and(|t| t.is("Form")) => Some((*n, s.clone())),
                _ => None,
            }
        })
        .collect();
    let decoded: Vec<(u32, Vec<u8>)> = forms.par_iter().map(|(n, s)| (*n, doc.decode(s).unwrap_or_default())).collect();
    for (n, d) in decoded {
        it.forms.insert(n, Arc::new(d));
    }
}

fn affine_of(a: &[Operand]) -> Option<Affine> {
    let v: Vec<f64> = a.iter().filter_map(Operand::num).collect();
    (v.len() == 6).then(|| Affine::new(v[0], v[1], v[2], v[3], v[4], v[5]))
}

fn translate(x: f64, y: f64) -> Affine {
    Affine::new(1.0, 0.0, 0.0, 1.0, x, y)
}

impl Interp<'_, '_> {
    /// Runs a content stream with these resources. Large streams are tokenised on several cores
    /// (in windows, overlapped with interpreting the window before); the operators still run in
    /// order on this thread.
    fn run(&mut self, data: &[u8], resources: &Dict) {
        if !self.opts.parallel || data.len() < self.opts.parallel_min || rayon::current_num_threads() < 2 {
            self.run_seq(data, resources);
            return;
        }
        // Chunk boundaries at white space, so no token is cut (most of the time; see below).
        let mut bounds = vec![0usize];
        let chunk = self.opts.token_chunk.max(64);
        let mut at = chunk;
        while at < data.len() {
            while at < data.len() && !crate::object::is_white(data[at]) {
                at += 1;
            }
            bounds.push(at.min(data.len()));
            at += chunk;
        }
        if *bounds.last().unwrap() != data.len() {
            bounds.push(data.len());
        }
        let ranges: Vec<(usize, usize)> = bounds.windows(2).map(|w| (w[0], w[1])).collect();
        let window = (rayon::current_num_threads() * 2).max(2);
        let tokenize_window = |w: usize| -> Vec<(Vec<Tok>, usize)> {
            let lo = w * window;
            let hi = ((w + 1) * window).min(ranges.len());
            ranges[lo..hi]
                .par_iter()
                .map(|&(s, e)| {
                    let mut toks = Vec::with_capacity((e - s) / 5);
                    let end = tokenize(data, s, e, &mut toks);
                    (toks, end)
                })
                .collect()
        };
        let windows = ranges.len().div_ceil(window);
        let mut current = tokenize_window(0);
        let mut prev_end = 0usize;
        // Operands carry over chunk boundaries (`x y` | `m`).
        let mut ops: Vec<Operand> = Vec::with_capacity(16);
        for w in 0..windows {
            let mut next: Option<Vec<(Vec<Tok>, usize)>> = None;
            rayon::in_place_scope(|scope| {
                if w + 1 < windows {
                    let slot = &mut next;
                    let tw = &tokenize_window;
                    scope.spawn(move |_| *slot = Some(tw(w + 1)));
                }
                for (k, (toks, end)) in current.drain(..).enumerate() {
                    let (s, e) = ranges[w * window + k];
                    if prev_end > s {
                        // The previous chunk's last token ran past this chunk's start (a string
                        // or array across the boundary): this chunk's tokens may be misread, so
                        // read it again from where that token ended.
                        let mut again = Vec::new();
                        let end2 = if prev_end < e { tokenize(data, prev_end, e, &mut again) } else { prev_end };
                        self.exec(data, &again, resources, &mut ops);
                        prev_end = end2;
                    } else {
                        self.exec(data, &toks, resources, &mut ops);
                        prev_end = end;
                    }
                }
            });
            current = next.unwrap_or_default();
        }
    }

    /// Runs tokens read by [`tokenize`].
    fn exec<'a>(&mut self, data: &'a [u8], toks: &[Tok], resources: &Dict, ops: &mut Vec<Operand<'a>>) {
        for &t in toks {
            match t {
                Tok::Num(v) => ops.push(Operand::Num(v)),
                Tok::Name(s, e) => ops.push(Operand::Name(&data[s as usize..e as usize])),
                Tok::Op(s, e) => {
                    self.op(&data[s as usize..e as usize], ops, resources);
                    ops.clear();
                }
                Tok::Complex(at) => {
                    let mut lx = Lexer::new(data, at as usize);
                    match lx.next() {
                        Some(Token::Str(s)) => ops.push(Operand::Str(s)),
                        Some(Token::ArrayStart) => ops.push(Operand::Arr(read_array(&mut lx))),
                        Some(Token::DictStart) => ops.push(Operand::Dict(lx.dict_body().unwrap_or_default())),
                        _ => ops.push(Operand::Other),
                    }
                }
                Tok::InlineImage(at) => {
                    let mut lx = Lexer::new(data, at as usize);
                    self.inline_image(&mut lx, resources);
                    ops.clear();
                }
            }
            if ops.len() > 64 {
                ops.clear();
            }
        }
    }

    /// Runs a content stream on this thread, reading it as it goes.
    fn run_seq(&mut self, data: &[u8], resources: &Dict) {
        // Size the output for the content: about one point per 12 bytes of path data.
        let c = &mut self.out.content;
        if c.points.capacity() < c.points.len() + data.len() / 12 {
            c.points.reserve(data.len() / 12);
            c.verbs.reserve(data.len() / 12);
        }
        let b = data;
        let n = b.len();
        let mut p = 0usize;
        let mut ops: Vec<Operand> = Vec::with_capacity(16);
        while p < n {
            let c = b[p];
            // White space and comments.
            if crate::object::is_white(c) {
                p += 1;
                continue;
            }
            if c == b'%' {
                while p < n && b[p] != b'\n' && b[p] != b'\r' {
                    p += 1;
                }
                continue;
            }
            if c.is_ascii_digit() || c == b'-' || c == b'+' || c == b'.' {
                let (v, end) = fast_number(b, p);
                ops.push(Operand::Num(v));
                p = end;
                continue;
            }
            if c == b'/' {
                let s = p + 1;
                let mut e = s;
                while e < n && crate::object::is_regular(b[e]) {
                    e += 1;
                }
                ops.push(Operand::Name(&b[s..e]));
                p = e;
                continue;
            }
            if crate::object::is_regular(c) {
                let s = p;
                let mut e = p + 1;
                while e < n && crate::object::is_regular(b[e]) {
                    e += 1;
                }
                p = e;
                let op = &b[s..e];
                if op == b"BI" {
                    let mut lx = Lexer::new(b, p);
                    self.inline_image(&mut lx, resources);
                    p = lx.pos;
                } else {
                    self.op(op, &ops, resources);
                }
                ops.clear();
                continue;
            }
            // Strings, arrays, dictionaries (and stray delimiters).
            let mut lx = Lexer::new(b, p);
            match lx.next() {
                Some(Token::Str(s)) => ops.push(Operand::Str(s)),
                Some(Token::ArrayStart) => ops.push(Operand::Arr(read_array(&mut lx))),
                Some(Token::DictStart) => ops.push(Operand::Dict(lx.dict_body().unwrap_or_default())),
                Some(_) => ops.push(Operand::Other),
                None => break,
            }
            p = lx.pos.max(p + 1);
            if ops.len() > 64 {
                // Junk: no operator takes this many operands.
                ops.clear();
            }
        }
    }

    fn op(&mut self, op: &[u8], a: &[Operand], res: &Dict) {
        let n = |i: usize| a.get(i).and_then(Operand::num).unwrap_or(0.0);
        match op {
            // Paths: points go to page space at once.
            b"m" if a.len() >= 2 => self.move_to(n(0), n(1)),
            b"l" if a.len() >= 2 => self.line_to(n(0), n(1)),
            b"c" if a.len() >= 6 => self.curve_to([n(0), n(1)], [n(2), n(3)], [n(4), n(5)]),
            b"v" if a.len() >= 4 => self.curve_to(self.cur, [n(0), n(1)], [n(2), n(3)]),
            b"y" if a.len() >= 4 => self.curve_to([n(0), n(1)], [n(2), n(3)], [n(2), n(3)]),
            b"h" => self.close(),
            b"re" if a.len() >= 4 => {
                let (x, y, w, h) = (n(0), n(1), n(2), n(3));
                self.move_to(x, y);
                self.line_to(x + w, y);
                self.line_to(x + w, y + h);
                self.line_to(x, y + h);
                self.close();
            }
            b"S" => self.paint(false, fill::NONE, true),
            b"s" => {
                self.close();
                self.paint(false, fill::NONE, true)
            }
            b"f" | b"F" => self.paint(true, fill::NONZERO, false),
            b"f*" => self.paint(true, fill::EVENODD, false),
            b"B" => self.paint(true, fill::NONZERO, true),
            b"B*" => self.paint(true, fill::EVENODD, true),
            b"b" => {
                self.close();
                self.paint(true, fill::NONZERO, true)
            }
            b"b*" => {
                self.close();
                self.paint(true, fill::EVENODD, true)
            }
            b"n" => self.paint(false, fill::NONE, false),
            b"W" => self.clip_rule = Some(fill::NONZERO),
            b"W*" => self.clip_rule = Some(fill::EVENODD),
            // Graphics state.
            b"q" => {
                if self.stack.len() < 4096 {
                    self.stack.push(self.gs.clone());
                }
            }
            b"Q" => {
                if let Some(g) = self.stack.pop() {
                    self.gs = g;
                }
            }
            b"cm" => {
                if let Some(m) = affine_of(a) {
                    self.gs.ctm = m.then(&self.gs.ctm);
                }
            }
            b"w" => self.gs.width = n(0) as f32,
            b"J" => self.gs.cap = (n(0) as u8).min(2),
            b"j" => self.gs.join = (n(0) as u8).min(2),
            b"M" => self.gs.miter = n(0) as f32,
            b"d" => {
                if let Some(Operand::Arr(arr)) = a.first() {
                    self.gs.dash = arr.iter().filter_map(Operand::num).map(|v| v as f32).collect::<Vec<_>>().into();
                    self.gs.dash_phase = n(1) as f32;
                }
            }
            b"gs" => {
                if let Some(Operand::Name(name)) = a.first() {
                    self.ext_gstate(res, name);
                }
            }
            b"ri" | b"i" | b"d0" | b"BX" | b"EX" | b"MP" | b"DP" => {}
            b"d1" => self.uncolored = true,
            // Colour.
            b"g" => self.set_color(false, ColorSpace::Gray, a),
            b"G" => self.set_color(true, ColorSpace::Gray, a),
            b"rg" => self.set_color(false, ColorSpace::Rgb, a),
            b"RG" => self.set_color(true, ColorSpace::Rgb, a),
            b"k" => self.set_color(false, ColorSpace::Cmyk, a),
            b"K" => self.set_color(true, ColorSpace::Cmyk, a),
            b"cs" | b"CS" => {
                if self.uncolored {
                    return;
                }
                if let Some(Operand::Name(name)) = a.first() {
                    let cs = color::resolve(self.doc, &Obj::Name(Name(name.to_vec())), res, 0);
                    let init = cs.initial();
                    let rgb = cs.to_rgb(&init);
                    if op == b"cs" {
                        self.gs.fill_cs = cs;
                        self.gs.fill = rgb;
                    } else {
                        self.gs.stroke_cs = cs;
                        self.gs.stroke = rgb;
                    }
                }
            }
            b"sc" | b"scn" | b"SC" | b"SCN" => {
                if self.uncolored {
                    return;
                }
                let stroke = op[0] == b'S';
                let comps: Vec<f32> = a.iter().filter_map(Operand::num).map(|v| v as f32).collect();
                let cs = if stroke { &self.gs.stroke_cs } else { &self.gs.fill_cs };
                // A pattern name (last operand) leaves the colour undrawable.
                let rgb = if matches!(a.last(), Some(Operand::Name(_))) { None } else { cs.to_rgb(&comps) };
                if stroke {
                    self.gs.stroke = rgb;
                } else {
                    self.gs.fill = rgb;
                }
            }
            b"sh" => self.out.content.flags |= flags::SHADING,
            // XObjects.
            b"Do" => {
                if let Some(Operand::Name(name)) = a.first() {
                    self.xobject(res, name);
                }
            }
            // Marked content and layers.
            b"BMC" => self.push_mark(rc::NONE),
            b"BDC" => {
                let layer = match (a.first(), a.get(1)) {
                    (Some(Operand::Name(b"OC")), Some(props)) => self.oc_layer(res, props),
                    _ => rc::NONE,
                };
                self.push_mark(layer);
            }
            b"EMC" => {
                self.marks.pop();
                self.layer = self.marks.iter().rev().copied().find(|&l| l != rc::NONE).unwrap_or(rc::NONE);
            }
            // Text.
            b"BT" => {
                self.tm = Affine::IDENTITY;
                self.tlm = Affine::IDENTITY;
            }
            b"ET" => {}
            b"Tc" => self.gs.char_spacing = n(0) as f32,
            b"Tw" => self.gs.word_spacing = n(0) as f32,
            b"Tz" => self.gs.h_scale = n(0) as f32 / 100.0,
            b"TL" => self.gs.leading = n(0) as f32,
            b"Ts" => self.gs.rise = n(0) as f32,
            b"Tr" => self.gs.render = n(0) as i32,
            b"Tf" => {
                if let Some(Operand::Name(name)) = a.first() {
                    self.gs.font = self.font(res, name);
                    self.gs.font_size = n(1) as f32;
                }
            }
            b"Td" => self.td(n(0), n(1)),
            b"TD" => {
                self.gs.leading = -n(1) as f32;
                self.td(n(0), n(1));
            }
            b"Tm" => {
                if let Some(m) = affine_of(a) {
                    self.tm = m;
                    self.tlm = m;
                }
            }
            b"T*" => self.td(0.0, -self.gs.leading as f64),
            b"Tj" => {
                if let Some(Operand::Str(s)) = a.first() {
                    self.show(s, res);
                }
            }
            b"'" => {
                self.td(0.0, -self.gs.leading as f64);
                if let Some(Operand::Str(s)) = a.first() {
                    self.show(s, res);
                }
            }
            b"\"" => {
                self.gs.word_spacing = n(0) as f32;
                self.gs.char_spacing = n(1) as f32;
                self.td(0.0, -self.gs.leading as f64);
                if let Some(Operand::Str(s)) = a.get(2) {
                    self.show(s, res);
                }
            }
            b"TJ" => {
                if let Some(Operand::Arr(arr)) = a.first() {
                    for e in arr {
                        match e {
                            Operand::Str(s) => self.show(s, res),
                            Operand::Num(adj) => {
                                let tx = -(*adj as f32) / 1000.0 * self.gs.font_size * self.gs.h_scale;
                                self.tm = translate(tx as f64, 0.0).then(&self.tm);
                            }
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn move_to(&mut self, x: f64, y: f64) {
        if self.path.is_none() {
            self.path = Some(self.out.begin_path());
        }
        self.out.move_to(self.gs.ctm.apply_f32(x, y));
        self.cur = [x, y];
        self.start = [x, y];
    }

    fn line_to(&mut self, x: f64, y: f64) {
        if self.path.is_none() {
            // A line with no current point: start where it is.
            self.move_to(x, y);
            return;
        }
        self.out.line_to(self.gs.ctm.apply_f32(x, y));
        self.cur = [x, y];
    }

    fn curve_to(&mut self, c1: [f64; 2], c2: [f64; 2], p: [f64; 2]) {
        if self.path.is_none() {
            self.move_to(c1[0], c1[1]);
        }
        let m = &self.gs.ctm;
        self.out.cubic_to(m.apply_f32(c1[0], c1[1]), m.apply_f32(c2[0], c2[1]), m.apply_f32(p[0], p[1]));
        self.cur = p;
    }

    fn close(&mut self) {
        if self.path.is_some() {
            self.out.close();
            self.cur = self.start;
        }
    }

    fn color(rgb: Option<[u8; 3]>, alpha: f32) -> Option<u32> {
        rgb.map(|[r, g, b]| rgba(r, g, b, (alpha.clamp(0.0, 1.0) * 255.0 + 0.5) as u8))
    }

    /// Paints (or just ends) the current path, then applies a pending clip.
    fn paint(&mut self, do_fill: bool, rule: u8, stroke: bool) {
        let Some(start) = self.path.take() else {
            self.clip_rule = None;
            return;
        };
        let mut item = Item { clip: self.gs.clip, layer: self.layer, miter_limit: self.gs.miter, ..Default::default() };
        let mut drawn = false;
        if do_fill {
            match Self::color(self.gs.fill, self.gs.fill_alpha) {
                Some(c) => {
                    item.fill_rule = rule;
                    item.fill_color = c;
                    drawn = true;
                }
                None => self.out.content.flags |= flags::PATTERN,
            }
        }
        if stroke {
            match Self::color(self.gs.stroke, self.gs.stroke_alpha) {
                Some(c) => {
                    let scale = self.gs.ctm.mean_scale() as f32;
                    item.stroked = 1;
                    item.stroke_color = c;
                    item.width = self.gs.width.max(0.0) * scale;
                    item.cap = self.gs.cap;
                    item.join = self.gs.join;
                    if !self.gs.dash.is_empty() {
                        let d: Vec<f32> = self.gs.dash.iter().map(|v| v * scale).collect();
                        let (s, l) = self.out.add_dashes(&d);
                        item.dash_start = s;
                        item.dash_len = l;
                        item.dash_phase = self.gs.dash_phase * scale;
                    }
                    drawn = true;
                }
                None => self.out.content.flags |= flags::PATTERN,
            }
        }
        let clip = self.clip_rule.take();
        if drawn {
            item.kind = rc::kind::PATH;
            item.verb_start = start.0;
            item.verb_len = self.out.content.verbs.len() as u32 - start.0;
            item.point_start = start.1;
            if item.verb_len > 0 {
                self.out.content.items.push(item);
            }
        }
        if let Some(rule) = clip {
            self.gs.clip = self.out.clip_from_path(start, rule, self.gs.clip);
        }
        if !drawn {
            self.out.discard_path(start);
        }
        self.maybe_chunk();
    }

    fn maybe_chunk(&mut self) {
        if self.opts.chunk_items > 0 && self.path.is_none() && self.out.content.items.len() >= self.opts.chunk_items {
            let chunk = self.out.take_chunk(CHUNK_SLOT_TOTAL);
            (self.on_chunk)(chunk);
        }
    }

    fn set_color(&mut self, stroke: bool, cs: ColorSpace, a: &[Operand]) {
        if self.uncolored {
            return;
        }
        let comps: Vec<f32> = a.iter().filter_map(Operand::num).map(|v| v as f32).collect();
        let rgb = cs.to_rgb(&comps);
        if stroke {
            self.gs.stroke_cs = cs;
            self.gs.stroke = rgb;
        } else {
            self.gs.fill_cs = cs;
            self.gs.fill = rgb;
        }
    }

    fn ext_gstate(&mut self, res: &Dict, name: &[u8]) {
        let doc = self.doc;
        let Some(gs) = doc.dict_get(res, "ExtGState").and_then(|g| g.as_dict().and_then(|d| d.0.iter().find(|(k, _)| k.as_bytes() == name).map(|(_, v)| doc.resolve(v)))) else {
            return;
        };
        let Some(d) = gs.as_dict() else { return };
        for (k, v) in d.iter() {
            let v = doc.resolve(v);
            match k.as_bytes() {
                b"LW" => self.gs.width = v.as_f32().unwrap_or(self.gs.width),
                b"LC" => self.gs.cap = v.as_i64().unwrap_or(0).clamp(0, 2) as u8,
                b"LJ" => self.gs.join = v.as_i64().unwrap_or(0).clamp(0, 2) as u8,
                b"ML" => self.gs.miter = v.as_f32().unwrap_or(10.0),
                b"CA" => self.gs.stroke_alpha = v.as_f32().unwrap_or(1.0),
                b"ca" => self.gs.fill_alpha = v.as_f32().unwrap_or(1.0),
                b"D" => {
                    if let Some(arr) = v.as_array()
                        && let Some(dash) = arr.first().map(|o| doc.resolve(o))
                    {
                        self.gs.dash = dash.as_array().unwrap_or(&[]).iter().filter_map(|o| o.as_f32()).collect::<Vec<_>>().into();
                        self.gs.dash_phase = arr.get(1).and_then(Obj::as_f32).unwrap_or(0.0);
                    }
                }
                b"BM" => {
                    let normal = match v.as_ref() {
                        Obj::Name(n) => n.is("Normal") || n.is("Compatible"),
                        Obj::Array(a) => a.first().and_then(Obj::as_name).is_some_and(|n| n.is("Normal") || n.is("Compatible")),
                        _ => true,
                    };
                    if !normal {
                        self.out.content.flags |= flags::BLEND_MODE;
                    }
                }
                b"SMask" => {
                    if !matches!(v.as_ref(), Obj::Name(n) if n.is("None")) {
                        self.out.content.flags |= flags::SOFT_MASK;
                    }
                }
                b"Font" => {
                    if let Some(arr) = v.as_array()
                        && let (Some(Obj::Ref(num, _)), Some(size)) = (arr.first(), arr.get(1).and_then(Obj::as_f32))
                    {
                        let key = (*num as usize, Vec::new());
                        let f = match self.fonts.get(&key) {
                            Some(f) => f.clone(),
                            None => {
                                let fd = doc.get(*num).ok();
                                let f = Arc::new(fd.as_deref().and_then(Obj::as_dict).map(|d| font::load(doc, d)).unwrap_or_else(Font::unsupported));
                                self.fonts.insert(key, f.clone());
                                f
                            }
                        };
                        self.gs.font = Some(f);
                        self.gs.font_size = size;
                    }
                }
                _ => {}
            }
        }
    }

    fn font(&mut self, res: &Dict, name: &[u8]) -> Option<Arc<Font>> {
        let doc = self.doc;
        let fonts = doc.dict_get(res, "Font")?;
        let entry = fonts.as_dict()?.0.iter().find(|(k, _)| k.as_bytes() == name).map(|(_, v)| v.clone())?;
        // Fonts are cached by object number (shared across forms), else by name and resources.
        let key = match entry {
            Obj::Ref(n, _) => (n as usize, Vec::new()),
            _ => (res as *const Dict as usize, name.to_vec()),
        };
        if let Some(f) = self.fonts.get(&key) {
            return Some(f.clone());
        }
        let fd = doc.resolve(&entry);
        let f = Arc::new(fd.as_dict().map(|d| font::load(doc, d)).unwrap_or_else(Font::unsupported));
        self.fonts.insert(key, f.clone());
        Some(f)
    }

    fn td(&mut self, x: f64, y: f64) {
        self.tlm = translate(x, y).then(&self.tlm);
        self.tm = self.tlm;
    }

    /// Shows a string: glyph outlines as one item, then advances the text matrix.
    fn show(&mut self, s: &[u8], res: &Dict) {
        let Some(font) = self.gs.font.clone() else { return };
        let gs = &self.gs;
        let (size, hs, cs, ws, rise) = (gs.font_size, gs.h_scale, gs.char_spacing, gs.word_spacing, gs.rise);
        let mode = gs.render;
        let visible = mode != 3 && mode != 7;
        if mode >= 4 {
            // Text used as a clip.
            self.out.content.flags |= flags::UNSUPPORTED;
        }
        let draw = visible && self.text_outlines && font.drawable();
        if visible && !draw {
            self.out.content.flags |= flags::TEXT_NOT_EXTRACTED;
        }
        let codes = font.codes(s);
        if let Kind::Type3 { procs, matrix, resources } = &font.kind {
            for &code in &codes {
                let trm = Affine::new((size * hs) as f64, 0.0, 0.0, size as f64, 0.0, rise as f64).then(&self.tm);
                if draw && let Some(proc) = procs.get(&(code as u8)) {
                    let r = if resources.0.is_empty() { res.clone() } else { resources.clone() };
                    self.type3_glyph(proc, matrix.then(&trm), &r);
                }
                let w = font.width(code) as f64 * matrix.a;
                let tx = (w * size as f64 + cs as f64 + if code == 32 { ws as f64 } else { 0.0 }) * hs as f64;
                self.tm = translate(tx, 0.0).then(&self.tm);
            }
            return;
        }
        let start = draw.then(|| self.out.begin_path());
        for &code in &codes {
            if draw
                && let Some(gid) = font.gid(code)
                && let Some(outline) = font.outline(gid)
            {
                let m = Affine::new((size * hs) as f64, 0.0, 0.0, size as f64, 0.0, rise as f64).then(&self.tm).then(&self.gs.ctm);
                let mut pi = 0;
                for &v in &outline.verbs {
                    match v {
                        rc::verb::MOVE => {
                            let [x, y] = outline.points[pi];
                            self.out.move_to(m.apply_f32(x as f64, y as f64));
                            pi += 1;
                        }
                        rc::verb::LINE => {
                            let [x, y] = outline.points[pi];
                            self.out.line_to(m.apply_f32(x as f64, y as f64));
                            pi += 1;
                        }
                        rc::verb::CUBIC => {
                            let p = |i: usize| {
                                let [x, y] = outline.points[i];
                                m.apply_f32(x as f64, y as f64)
                            };
                            self.out.cubic_to(p(pi), p(pi + 1), p(pi + 2));
                            pi += 3;
                        }
                        _ => self.out.close(),
                    }
                }
            }
            let w0 = font.width(code) / 1000.0;
            let space = !font.two_byte() && code == 32;
            let tx = (w0 * size + cs + if space { ws } else { 0.0 }) * hs;
            self.tm = translate(tx as f64, 0.0).then(&self.tm);
        }
        if let Some(start) = start {
            let mut item = Item { clip: self.gs.clip, layer: self.layer, miter_limit: self.gs.miter, ..Default::default() };
            if matches!(mode, 0 | 2 | 4 | 6)
                && let Some(c) = Self::color(self.gs.fill, self.gs.fill_alpha)
            {
                item.fill_rule = fill::NONZERO;
                item.fill_color = c;
            }
            if matches!(mode, 1 | 2 | 5 | 6)
                && let Some(c) = Self::color(self.gs.stroke, self.gs.stroke_alpha)
            {
                item.stroked = 1;
                item.stroke_color = c;
                item.width = self.gs.width.max(0.0) * self.gs.ctm.mean_scale() as f32;
                item.cap = self.gs.cap;
                item.join = self.gs.join;
            }
            self.out.finish_path(start, item);
            self.maybe_chunk();
        }
    }

    fn type3_glyph(&mut self, proc: &Stream, glyph_to_text: Affine, res: &Dict) {
        if self.form_stack.len() >= MAX_FORM_DEPTH {
            return;
        }
        let data = self.doc.decode(proc).unwrap_or_default();
        let saved = (self.gs.clone(), self.stack.len(), self.tm, self.tlm, self.uncolored, self.path.take());
        self.gs.ctm = glyph_to_text.then(&saved.0.ctm);
        self.form_stack.push(u32::MAX);
        self.run(&data, res);
        self.form_stack.pop();
        self.stack.truncate(saved.1);
        self.gs = saved.0;
        self.tm = saved.2;
        self.tlm = saved.3;
        self.uncolored = saved.4;
        self.path = saved.5;
    }

    fn xobject(&mut self, res: &Dict, name: &[u8]) {
        let doc = self.doc;
        let Some(xobjs) = doc.dict_get(res, "XObject") else { return };
        let Some(entry) = xobjs.as_dict().and_then(|d| d.0.iter().find(|(k, _)| k.as_bytes() == name).map(|(_, v)| v.clone())) else {
            return;
        };
        let num = match entry {
            Obj::Ref(n, _) => n,
            _ => u32::MAX - 1,
        };
        let obj = doc.resolve(&entry);
        let Obj::Stream(s) = obj.as_ref() else { return };
        let subtype = s.dict.get("Subtype").and_then(Obj::as_name).map(|n| n.as_bytes().to_vec()).unwrap_or_default();
        match &subtype[..] {
            b"Image" => self.image(s, res),
            b"Form" => self.form(num, s, res),
            _ => {}
        }
    }

    fn form(&mut self, num: u32, s: &Stream, res: &Dict) {
        if self.form_stack.len() >= MAX_FORM_DEPTH || (num != u32::MAX - 1 && self.form_stack.contains(&num)) {
            return;
        }
        let doc = self.doc;
        let data = match self.forms.get(&num) {
            Some(d) if num != u32::MAX - 1 => d.clone(),
            _ => {
                let d = Arc::new(doc.decode(s).unwrap_or_default());
                if num != u32::MAX - 1 {
                    self.forms.insert(num, d.clone());
                }
                d
            }
        };
        let form_res = doc.dict_get(&s.dict, "Resources").and_then(|r| r.as_dict().cloned());
        let res = form_res.as_ref().unwrap_or(res);
        if let Some(r) = &form_res {
            prefetch_forms(self, r);
        }
        let saved = (self.gs.clone(), self.stack.len(), self.path.take(), self.marks.len(), self.layer);
        if let Some(m) = doc.dict_get(&s.dict, "Matrix").and_then(|m| {
            m.as_array().and_then(|a| {
                let v: Vec<f64> = a.iter().filter_map(|o| doc.resolve(o).as_f64()).collect();
                (v.len() == 6).then(|| Affine::new(v[0], v[1], v[2], v[3], v[4], v[5]))
            })
        }) {
            self.gs.ctm = m.then(&self.gs.ctm);
        }
        // The form's bounding box clips it.
        if let Some([x0, y0, x1, y1]) = doc.rect(&s.dict, "BBox") {
            let m = self.gs.ctm;
            let pts = [m.apply_f32(x0, y0), m.apply_f32(x1, y0), m.apply_f32(x1, y1), m.apply_f32(x0, y1)];
            let verbs = [rc::verb::MOVE, rc::verb::LINE, rc::verb::LINE, rc::verb::LINE, rc::verb::CLOSE];
            self.gs.clip = self.out.add_clip(&verbs, &pts, fill::NONZERO, self.gs.clip);
        }
        if let Some(oc) = s.dict.get("OC") {
            let l = self.oc_layer_obj(oc);
            self.push_mark(l);
        }
        self.form_stack.push(num);
        self.run(&data, res);
        self.form_stack.pop();
        self.stack.truncate(saved.1);
        self.gs = saved.0;
        self.path = saved.2;
        self.marks.truncate(saved.3);
        self.layer = saved.4;
    }

    fn image(&mut self, s: &Stream, res: &Dict) {
        let fill = self.gs.fill.unwrap_or([0, 0, 0]);
        let is_mask = self.doc.dict_get(&s.dict, "ImageMask").and_then(|o| o.as_bool()).unwrap_or(false);
        if is_mask && self.gs.fill.is_none() {
            self.out.content.flags |= flags::PATTERN;
            return;
        }
        match image::decode(self.doc, s, res, fill) {
            Ok(img) => {
                let unit = Affine::new(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
                let smooth = self.doc.dict_get(&s.dict, "Interpolate").and_then(|o| o.as_bool()).unwrap_or(!is_mask);
                self.out.add_image(
                    rc::Image {
                        width: img.width,
                        height: img.height,
                        rgba: img.rgba,
                        transform: unit.then(&self.gs.ctm),
                        opacity: self.gs.fill_alpha,
                        smooth,
                    },
                    self.gs.clip,
                    self.layer,
                );
                self.maybe_chunk();
            }
            Err(_) => self.out.content.flags |= flags::UNSUPPORTED,
        }
    }

    fn inline_image(&mut self, lx: &mut Lexer, res: &Dict) {
        // Entries up to ID, abbreviations expanded.
        let mut dict = Vec::new();
        loop {
            let Some(t) = lx.next() else { return };
            match t {
                Token::Word(b"ID") => break,
                Token::Name(k) => {
                    let Some(v) = lx.object() else { return };
                    let key: &[u8] = match k {
                        b"W" => b"Width",
                        b"H" => b"Height",
                        b"BPC" => b"BitsPerComponent",
                        b"CS" => b"ColorSpace",
                        b"F" => b"Filter",
                        b"DP" => b"DecodeParms",
                        b"D" => b"Decode",
                        b"IM" => b"ImageMask",
                        b"I" => b"Interpolate",
                        other => other,
                    };
                    dict.push((Name(key.to_vec()), v));
                }
                _ => {}
            }
        }
        // One white-space byte after ID, then data up to white space, EI and a delimiter.
        let b = lx.b;
        let start = (lx.pos + 1).min(b.len());
        let mut end = start;
        let mut found = None;
        while end + 2 < b.len() {
            if b[end] == b'E'
                && b[end + 1] == b'I'
                && (end == start || crate::object::is_white(b[end - 1]))
                && (end + 2 >= b.len() || !crate::object::is_regular(b[end + 2]))
            {
                found = Some(end);
                break;
            }
            end += 1;
        }
        let Some(ei) = found else {
            lx.pos = b.len();
            return;
        };
        let mut data_end = ei;
        if data_end > start && crate::object::is_white(b[data_end - 1]) {
            data_end -= 1;
        }
        lx.pos = ei + 2;
        let stream = Stream { dict: Dict(dict), data: StreamData::Owned(b[start..data_end].to_vec().into()) };
        self.image(&stream, res);
    }

    fn push_mark(&mut self, layer: u32) {
        self.marks.push(layer);
        if layer != rc::NONE {
            self.layer = layer;
        }
    }

    fn oc_layer(&mut self, res: &Dict, props: &Operand) -> u32 {
        let doc = self.doc;
        match props {
            Operand::Name(n) => {
                let Some(p) = doc.dict_get(res, "Properties") else { return rc::NONE };
                let Some(entry) = p.as_dict().and_then(|d| d.0.iter().find(|(k, _)| k.as_bytes() == *n).map(|(_, v)| v.clone())) else {
                    return rc::NONE;
                };
                self.oc_layer_obj(&entry)
            }
            Operand::Dict(d) => self.oc_layer_obj(&Obj::Dict(d.clone())),
            _ => rc::NONE,
        }
    }

    /// A layer for an optional content group (or the first group of a membership dictionary).
    fn oc_layer_obj(&mut self, oc: &Obj) -> u32 {
        let doc = self.doc;
        let mut target = oc.clone();
        let d = doc.resolve(oc);
        if let Some(dict) = d.as_dict()
            && dict.get("Type").and_then(Obj::as_name).is_some_and(|t| t.is("OCMD"))
        {
            match doc.dict_get(dict, "OCGs").as_deref() {
                Some(Obj::Array(a)) if !a.is_empty() => target = a[0].clone(),
                Some(_) => target = dict.get("OCGs").cloned().unwrap_or(Obj::Null),
                None => return rc::NONE,
            }
        }
        let ocg = doc.resolve(&target);
        let Some(ocg) = ocg.as_dict() else { return rc::NONE };
        let name = doc.dict_get(ocg, "Name").and_then(|n| n.as_str().map(decode_text)).unwrap_or_else(|| "(unnamed layer)".into());
        let index = self.out.layer(&name);
        if let Obj::Ref(num, _) = target
            && self.hidden.contains(&num)
            && !self.out.content.layers_off.contains(&index)
        {
            self.out.content.layers_off.push(index);
        }
        index
    }
}

/// A token of a content stream, as positions in it (strings, arrays, dictionaries and inline
/// images are read again from their start when run).
#[derive(Clone, Copy, Debug)]
enum Tok {
    Num(f64),
    Name(u32, u32),
    Op(u32, u32),
    Complex(u32),
    /// Position just after `BI`.
    InlineImage(u32),
}

/// Tokenises `b[start..]` until a token starts at or after `end`. Returns where it stopped (past
/// `end` when the last token runs over it).
fn tokenize(b: &[u8], start: usize, end: usize, out: &mut Vec<Tok>) -> usize {
    let n = b.len();
    let mut p = start;
    while p < end.min(n) {
        let c = b[p];
        if crate::object::is_white(c) {
            p += 1;
            continue;
        }
        if c == b'%' {
            while p < n && b[p] != b'\n' && b[p] != b'\r' {
                p += 1;
            }
            continue;
        }
        if c.is_ascii_digit() || c == b'-' || c == b'+' || c == b'.' {
            let (v, e) = fast_number(b, p);
            out.push(Tok::Num(v));
            p = e;
            continue;
        }
        if c == b'/' {
            let s = p + 1;
            let mut e = s;
            while e < n && crate::object::is_regular(b[e]) {
                e += 1;
            }
            out.push(Tok::Name(s as u32, e as u32));
            p = e;
            continue;
        }
        if crate::object::is_regular(c) {
            let s = p;
            let mut e = p + 1;
            while e < n && crate::object::is_regular(b[e]) {
                e += 1;
            }
            if &b[s..e] == b"BI" {
                out.push(Tok::InlineImage(e as u32));
                p = skip_inline_image(b, e);
            } else {
                out.push(Tok::Op(s as u32, e as u32));
                p = e;
            }
            continue;
        }
        out.push(Tok::Complex(p as u32));
        let mut lx = Lexer::new(b, p);
        match lx.next() {
            Some(Token::ArrayStart) => {
                read_array(&mut lx);
            }
            Some(Token::DictStart) => {
                lx.dict_body();
            }
            None => break,
            _ => {}
        }
        p = lx.pos.max(p + 1);
    }
    p
}

/// Where an inline image's data ends (after `EI`), from just after `BI`.
fn skip_inline_image(b: &[u8], mut p: usize) -> usize {
    let mut lx = Lexer::new(b, p);
    loop {
        match lx.next() {
            Some(Token::Word(b"ID")) => break,
            None => return b.len(),
            _ => {}
        }
    }
    p = (lx.pos + 1).min(b.len());
    while p + 2 < b.len() {
        if b[p] == b'E' && b[p + 1] == b'I' && crate::object::is_white(b[p - 1]) && !crate::object::is_regular(b[p + 2]) {
            return p + 2;
        }
        p += 1;
    }
    b.len()
}

/// Parses a number at `p` (sign, digits, fraction; no exponents), returning it and where it ends.
/// Junk after the number (`12.5.3`, `4-`) is skipped to the next delimiter, as readers do.
#[inline]
fn fast_number(b: &[u8], mut p: usize) -> (f64, usize) {
    let n = b.len();
    let mut neg = false;
    while p < n && (b[p] == b'-' || b[p] == b'+') {
        neg ^= b[p] == b'-';
        p += 1;
    }
    let mut int: u64 = 0;
    while p < n && b[p].is_ascii_digit() {
        int = int.wrapping_mul(10).wrapping_add((b[p] - b'0') as u64);
        p += 1;
    }
    let mut v = int as f64;
    if p < n && b[p] == b'.' {
        p += 1;
        let mut frac: u64 = 0;
        let mut digits = 0i32;
        while p < n && b[p].is_ascii_digit() {
            if digits < 18 {
                frac = frac * 10 + (b[p] - b'0') as u64;
                digits += 1;
            }
            p += 1;
        }
        const POW: [f64; 19] = [1.0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18];
        v += frac as f64 / POW[digits as usize];
    }
    while p < n && crate::object::is_regular(b[p]) {
        p += 1;
    }
    (if neg { -v } else { v }, p)
}

fn read_array<'a>(lx: &mut Lexer<'a>) -> Vec<Operand<'a>> {
    let mut out = Vec::new();
    while let Some(t) = lx.next() {
        match t {
            Token::ArrayEnd => break,
            Token::Int(i) => out.push(Operand::Num(i as f64)),
            Token::Real(r) => out.push(Operand::Num(r)),
            Token::Str(s) => out.push(Operand::Str(s)),
            Token::Name(n) => out.push(Operand::Name(n)),
            Token::ArrayStart => out.push(Operand::Arr(read_array(lx))),
            Token::DictStart => out.push(Operand::Dict(lx.dict_body().unwrap_or_default())),
            _ => out.push(Operand::Other),
        }
        if out.len() > 1 << 20 {
            break;
        }
    }
    out
}

/// A PDF text string (UTF-16 with a byte order mark, or PDFDocEncoding treated as Latin-1).
pub fn decode_text(s: &[u8]) -> String {
    if s.len() >= 2 && s[0] == 0xfe && s[1] == 0xff {
        let units: Vec<u16> = s[2..].chunks(2).map(|c| (c[0] as u16) << 8 | *c.get(1).unwrap_or(&0) as u16).collect();
        return String::from_utf16_lossy(&units);
    }
    s.iter().map(|&b| b as char).collect()
}
