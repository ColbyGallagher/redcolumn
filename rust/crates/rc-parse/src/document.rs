//! The file: cross-reference (tables, streams, hybrid files and incremental updates), objects
//! loaded lazily and cached, object streams, the page tree, and repair by scanning when the
//! cross-reference is damaged.

use crate::Error;
use crate::filter;
use crate::object::*;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Entry {
    /// Byte offset of `N G obj`.
    Offset(usize),
    /// Index within object stream `stream`.
    InStream { stream: u32, index: u32 },
}

/// A decoded object stream: each object's number and offset in `data`.
struct ObjStream {
    data: Arc<[u8]>,
    offsets: Vec<(u32, usize)>,
}

/// The file's bytes, shared (a memory map, or a buffer).
pub type Bytes = Arc<dyn AsRef<[u8]> + Send + Sync>;

pub struct Document {
    bytes: Bytes,
    xref: HashMap<u32, Entry>,
    pub trailer: Dict,
    cache: RwLock<HashMap<u32, Arc<Obj>>>,
    objstms: RwLock<HashMap<u32, Arc<ObjStream>>>,
    pages: Vec<PageNode>,
}

/// A page with its inherited attributes resolved.
#[derive(Clone, Debug)]
pub struct PageNode {
    pub dict: Dict,
    pub resources: Dict,
    pub media_box: [f64; 4],
    pub crop_box: [f64; 4],
    pub rotate: i32,
}

const MAX_DEPTH: usize = 64;

impl Document {
    /// Opens a copy of these bytes (tools and tests; the app maps the file with [`Self::open_shared`]).
    pub fn open(data: &[u8]) -> Result<Self, Error> {
        Self::open_shared(Arc::new(data.to_vec()))
    }

    pub fn open_shared(bytes: Bytes) -> Result<Self, Error> {
        let mut doc = Document {
            bytes,
            xref: HashMap::new(),
            trailer: Dict::default(),
            cache: RwLock::new(HashMap::new()),
            objstms: RwLock::new(HashMap::new()),
            pages: Vec::new(),
        };
        if doc.read_xref().is_err() || doc.trailer.get("Root").is_none() {
            doc.rebuild()?;
        }
        if doc.trailer.has("Encrypt") {
            return Err(Error::Unsupported("encrypted file".into()));
        }
        if doc.collect_pages().is_err() || doc.pages.is_empty() {
            // The xref pointed somewhere plausible but wrong: rebuild and try again.
            doc.xref.clear();
            doc.cache.write().unwrap().clear();
            doc.rebuild()?;
            doc.pages.clear();
            doc.collect_pages()?;
        }
        Ok(doc)
    }

    /// The file's bytes.
    pub fn data(&self) -> &[u8] {
        (*self.bytes).as_ref()
    }

    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    pub fn page(&self, i: usize) -> Option<&PageNode> {
        self.pages.get(i)
    }

    fn read_xref(&mut self) -> Result<(), Error> {
        let bytes = self.bytes.clone();
        let data = (*bytes).as_ref();
        let tail = &data[data.len().saturating_sub(2048)..];
        let at = rfind(tail, b"startxref").ok_or_else(|| Error::Damaged("no startxref".into()))?;
        let mut lx = Lexer::new(tail, at + 9);
        let Some(Token::Int(mut off)) = lx.next() else { return Err(Error::Damaged("bad startxref".into())) };
        let mut seen = std::collections::HashSet::new();
        let mut first = true;
        while off >= 0 && (off as usize) < data.len() && seen.insert(off) {
            let trailer = self.read_section(off as usize)?;
            if first {
                self.trailer = trailer.clone();
                first = false;
            }
            // A hybrid file's table refers to an xref stream holding the objects in streams.
            if let Some(stm) = trailer.get("XRefStm").and_then(Obj::as_i64) {
                let _ = self.read_section(stm as usize);
            }
            match trailer.get("Prev").and_then(Obj::as_i64) {
                Some(p) => off = p,
                None => break,
            }
        }
        if first { Err(Error::Damaged("no cross-reference".into())) } else { Ok(()) }
    }

    /// Reads one cross-reference section at `off` (a table or a stream); earlier sections never
    /// override entries already read (later updates win). Returns its trailer.
    fn read_section(&mut self, off: usize) -> Result<Dict, Error> {
        let bytes = self.bytes.clone();
        let mut lx = Lexer::new((*bytes).as_ref(), off);
        match lx.next() {
            Some(Token::Word(b"xref")) => {
                loop {
                    let save = lx.pos;
                    match (lx.next(), lx.next()) {
                        (Some(Token::Int(start)), Some(Token::Int(count))) => {
                            lx.skip_ws();
                            for i in 0..count.max(0) {
                                let (Some(Token::Int(o)), Some(Token::Int(_g)), Some(Token::Word(kind))) =
                                    (lx.next(), lx.next(), lx.next())
                                else {
                                    return Err(Error::Damaged("bad xref entry".into()));
                                };
                                let num = (start + i) as u32;
                                if kind == b"n" && o > 0 {
                                    self.xref.entry(num).or_insert(Entry::Offset(o as usize));
                                }
                            }
                        }
                        _ => {
                            lx.pos = save;
                            break;
                        }
                    }
                }
                match lx.next() {
                    Some(Token::Word(b"trailer")) => lx.object().and_then(|o| o.as_dict().cloned()).ok_or_else(|| Error::Damaged("bad trailer".into())),
                    _ => Err(Error::Damaged("no trailer".into())),
                }
            }
            Some(Token::Int(_)) => {
                let obj = self.parse_at(off, 0)?;
                let Obj::Stream(s) = &obj else { return Err(Error::Damaged("xref is not a stream".into())) };
                if !s.dict.get("Type").and_then(Obj::as_name).is_some_and(|n| n.is("XRef")) {
                    return Err(Error::Damaged("xref stream has no /Type /XRef".into()));
                }
                let data = self.decode(s)?;
                let w: Vec<usize> = s.dict.get("W").and_then(Obj::as_array).unwrap_or(&[]).iter().filter_map(Obj::as_i64).map(|v| v.max(0) as usize).collect();
                if w.len() < 3 {
                    return Err(Error::Damaged("xref stream /W".into()));
                }
                let size = s.dict.get("Size").and_then(Obj::as_i64).unwrap_or(0);
                let index: Vec<i64> = match s.dict.get("Index").and_then(Obj::as_array) {
                    Some(a) => a.iter().filter_map(Obj::as_i64).collect(),
                    None => vec![0, size],
                };
                let row = w[0] + w[1] + w[2];
                let field = |b: &[u8]| b.iter().fold(0u64, |a, &x| a << 8 | x as u64);
                let mut pos = 0;
                for pair in index.chunks(2) {
                    let [start, count] = pair else { break };
                    for i in 0..*count {
                        if pos + row > data.len() {
                            break;
                        }
                        let r = &data[pos..pos + row];
                        pos += row;
                        let ty = if w[0] == 0 { 1 } else { field(&r[..w[0]]) };
                        let f1 = field(&r[w[0]..w[0] + w[1]]);
                        let f2 = field(&r[w[0] + w[1]..]);
                        let num = (start + i) as u32;
                        let e = match ty {
                            1 => Entry::Offset(f1 as usize),
                            2 => Entry::InStream { stream: f1 as u32, index: f2 as u32 },
                            _ => continue,
                        };
                        self.xref.entry(num).or_insert(e);
                    }
                }
                Ok(s.dict.clone())
            }
            _ => Err(Error::Damaged("cross-reference not found".into())),
        }
    }

    /// Rebuilds the cross-reference by scanning for `N G obj`, as readers do for damaged files.
    fn rebuild(&mut self) -> Result<(), Error> {
        let bytes = self.bytes.clone();
        let d = (*bytes).as_ref();
        let mut i = 0;
        while let Some(rel) = find(&d[i..], b"obj") {
            let at = i + rel;
            i = at + 3;
            // Walk back over "N G " to the object number.
            let mut p = at;
            let back = |p: &mut usize, digits: bool| {
                while *p > 0 && is_white(d[*p - 1]) {
                    *p -= 1;
                }
                let end = *p;
                while *p > 0 && d[*p - 1].is_ascii_digit() {
                    *p -= 1;
                }
                digits && *p < end
            };
            if !back(&mut p, true) {
                continue;
            }
            if !back(&mut p, true) {
                continue;
            }
            if p > 0 && is_regular(d[p - 1]) {
                continue;
            }
            let mut lx = Lexer::new(d, p);
            if let Some(Token::Int(n)) = lx.next() {
                self.xref.insert(n as u32, Entry::Offset(p));
            }
        }
        // The trailer: the last `trailer` dictionary, or an xref stream's dictionary, with /Root.
        let mut trailer = None;
        let mut search = d.len();
        while let Some(at) = rfind(&d[..search], b"trailer") {
            if let Some(Obj::Dict(t)) = Lexer::new(d, at + 7).object()
                && t.has("Root")
            {
                trailer = Some(t);
                break;
            }
            search = at;
        }
        if trailer.is_none() {
            let mut nums: Vec<u32> = self.xref.keys().copied().collect();
            nums.sort_unstable();
            for n in nums.into_iter().rev() {
                if let Ok(o) = self.get(n)
                    && let Some(dict) = o.as_dict()
                {
                    if dict.has("Root") {
                        trailer = Some(dict.clone());
                        break;
                    }
                    if dict.get("Type").and_then(Obj::as_name).is_some_and(|t| t.is("Catalog")) {
                        trailer = Some(Dict(vec![(Name(b"Root".to_vec()), Obj::Ref(n, 0))]));
                        break;
                    }
                }
            }
        }
        self.trailer = trailer.ok_or_else(|| Error::Damaged("no document catalog".into()))?;
        Ok(())
    }

    /// Parses the indirect object at `off` (`N G obj ... endobj`).
    fn parse_at(&self, off: usize, depth: usize) -> Result<Obj, Error> {
        let mut lx = Lexer::new(self.data(), off);
        let (Some(Token::Int(_)), Some(Token::Int(_)), Some(Token::Word(b"obj"))) = (lx.next(), lx.next(), lx.next()) else {
            return Err(Error::Damaged(format!("no object at {off}")));
        };
        let obj = lx.object().ok_or_else(|| Error::Damaged(format!("bad object at {off}")))?;
        let save = lx.pos;
        if let Obj::Dict(dict) = &obj
            && let Some(Token::Word(b"stream")) = lx.next()
        {
            let mut start = lx.pos;
            if self.data().get(start) == Some(&b'\r') {
                start += 1;
            }
            if self.data().get(start) == Some(&b'\n') {
                start += 1;
            }
            let declared = match dict.get("Length") {
                Some(Obj::Ref(n, _)) if depth < MAX_DEPTH => self.get_depth(*n, depth + 1).ok().and_then(|o| o.as_i64()),
                Some(o) => o.as_i64(),
                None => None,
            };
            let len = match declared {
                Some(l) if l >= 0 && start + (l as usize) <= self.data().len() && self.looks_like_end(start + l as usize) => l as usize,
                // A wrong or missing /Length: find `endstream`.
                _ => {
                    let end = find(&self.data()[start..], b"endstream").map(|e| start + e).unwrap_or(self.data().len());
                    let mut e = end;
                    while e > start && matches!(self.data()[e - 1], b'\r' | b'\n') {
                        e -= 1;
                    }
                    e - start
                }
            };
            return Ok(Obj::Stream(Stream { dict: dict.clone(), data: StreamData::File(start, len) }));
        }
        let _ = save;
        Ok(obj)
    }

    fn looks_like_end(&self, at: usize) -> bool {
        let mut lx = Lexer::new(self.data(), at);
        matches!(lx.next(), Some(Token::Word(b"endstream")))
    }

    pub fn get(&self, num: u32) -> Result<Arc<Obj>, Error> {
        self.get_depth(num, 0)
    }

    fn get_depth(&self, num: u32, depth: usize) -> Result<Arc<Obj>, Error> {
        if let Some(o) = self.cache.read().unwrap().get(&num) {
            return Ok(o.clone());
        }
        let obj = match self.xref.get(&num) {
            None => Obj::Null,
            Some(Entry::Offset(off)) => self.parse_at(*off, depth)?,
            Some(&Entry::InStream { stream, index }) => self.from_stream(stream, index, num, depth)?,
        };
        let obj = Arc::new(obj);
        self.cache.write().unwrap().insert(num, obj.clone());
        Ok(obj)
    }

    fn from_stream(&self, stream: u32, index: u32, num: u32, depth: usize) -> Result<Obj, Error> {
        if depth > MAX_DEPTH {
            return Err(Error::Damaged("object streams nest too deep".into()));
        }
        let os = if let Some(os) = self.objstms.read().unwrap().get(&stream) {
            os.clone()
        } else {
            let s = self.get_depth(stream, depth + 1)?;
            let Obj::Stream(s) = s.as_ref() else { return Err(Error::Damaged("object stream is not a stream".into())) };
            let data: Arc<[u8]> = self.decode(s)?.into();
            let n = s.dict.get("N").and_then(Obj::as_i64).unwrap_or(0).max(0) as usize;
            let first = s.dict.get("First").and_then(Obj::as_i64).unwrap_or(0).max(0) as usize;
            let mut lx = Lexer::new(&data, 0);
            let mut offsets = Vec::with_capacity(n);
            for _ in 0..n {
                let (Some(Token::Int(o)), Some(Token::Int(off))) = (lx.next(), lx.next()) else { break };
                offsets.push((o as u32, first + off as usize));
            }
            let os = Arc::new(ObjStream { data, offsets });
            self.objstms.write().unwrap().insert(stream, os.clone());
            os
        };
        // Prefer the index, but trust the object number when they disagree.
        let off = match os.offsets.get(index as usize) {
            Some(&(n, off)) if n == num => off,
            _ => os.offsets.iter().find(|(n, _)| *n == num).map(|&(_, o)| o).ok_or_else(|| Error::Damaged(format!("object {num} not in its stream")))?,
        };
        Lexer::new(&os.data, off).object().ok_or_else(|| Error::Damaged(format!("bad object {num}")))
    }

    /// Follows references (any number of them) to the object itself.
    pub fn resolve(&self, o: &Obj) -> Arc<Obj> {
        let mut cur = match o {
            Obj::Ref(n, _) => self.get(*n).unwrap_or_else(|_| Arc::new(Obj::Null)),
            other => return Arc::new(other.clone()),
        };
        for _ in 0..MAX_DEPTH {
            let Obj::Ref(n, _) = cur.as_ref() else { return cur };
            cur = self.get(*n).unwrap_or_else(|_| Arc::new(Obj::Null));
        }
        Arc::new(Obj::Null)
    }

    /// A dictionary entry, references followed.
    pub fn dict_get(&self, d: &Dict, key: &str) -> Option<Arc<Obj>> {
        d.get(key).map(|o| self.resolve(o)).filter(|o| !matches!(o.as_ref(), Obj::Null))
    }

    /// A stream's bytes with its filters applied (image filters excluded: the result then holds
    /// the image codec's data).
    pub fn decode(&self, s: &Stream) -> Result<Vec<u8>, Error> {
        let raw: &[u8] = match &s.data {
            StreamData::File(off, len) => &self.data()[*off..(*off + *len).min(self.data().len())],
            StreamData::Owned(b) => b,
        };
        let filters: Vec<Name> = match s.dict.get("Filter").map(|f| self.resolve(f)) {
            Some(f) => match f.as_ref() {
                Obj::Name(n) => vec![n.clone()],
                Obj::Array(a) => a.iter().filter_map(|o| o.as_name().cloned()).collect(),
                _ => vec![],
            },
            None => vec![],
        };
        let parms: Vec<Option<Dict>> = match s.dict.get("DecodeParms").map(|p| self.resolve(p)) {
            Some(p) => match p.as_ref() {
                Obj::Dict(d) => vec![Some(d.clone())],
                Obj::Array(a) => a.iter().map(|o| self.resolve(o).as_dict().cloned()).collect(),
                _ => vec![],
            },
            None => vec![],
        };
        let mut data: Option<Vec<u8>> = None;
        for (i, f) in filters.iter().enumerate() {
            if filter::is_image_filter(f.as_bytes()) {
                break;
            }
            let input = data.as_deref().unwrap_or(raw);
            data = Some(filter::apply(f.as_bytes(), input, parms.get(i).and_then(|p| p.as_ref()))?);
        }
        Ok(data.unwrap_or_else(|| raw.to_vec()))
    }

    /// The raw bytes of a stream as stored (for image codecs).
    pub fn raw<'s>(&'s self, s: &'s Stream) -> &'s [u8] {
        match &s.data {
            StreamData::File(off, len) => &self.data()[*off..(*off + *len).min(self.data().len())],
            StreamData::Owned(b) => b,
        }
    }

    fn collect_pages(&mut self) -> Result<(), Error> {
        let root = self.dict_get(&self.trailer, "Root").ok_or_else(|| Error::Damaged("no /Root".into()))?;
        let root = root.as_dict().ok_or_else(|| Error::Damaged("/Root is not a dictionary".into()))?;
        let pages = root.get("Pages").cloned().ok_or_else(|| Error::Damaged("no /Pages".into()))?;
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        self.walk_pages(&pages, &Inherited::default(), &mut out, &mut seen, 0)?;
        self.pages = out;
        Ok(())
    }

    fn walk_pages(
        &self,
        node: &Obj,
        inh: &Inherited,
        out: &mut Vec<PageNode>,
        seen: &mut std::collections::HashSet<u32>,
        depth: usize,
    ) -> Result<(), Error> {
        if depth > MAX_DEPTH {
            return Ok(());
        }
        if let Obj::Ref(n, _) = node
            && !seen.insert(*n)
        {
            return Ok(());
        }
        let o = self.resolve(node);
        let Some(d) = o.as_dict() else { return Ok(()) };
        let mut inh = inh.clone();
        if let Some(r) = self.dict_get(d, "Resources").and_then(|r| r.as_dict().cloned()) {
            inh.resources = Some(r);
        }
        if let Some(b) = self.rect(d, "MediaBox") {
            inh.media_box = Some(b);
        }
        if let Some(b) = self.rect(d, "CropBox") {
            inh.crop_box = Some(b);
        }
        if let Some(r) = self.dict_get(d, "Rotate").and_then(|r| r.as_i64()) {
            inh.rotate = Some(r as i32);
        }
        let is_page = d.get("Type").and_then(Obj::as_name).is_some_and(|t| t.is("Page"))
            || (!d.has("Kids") && d.has("Contents"));
        if is_page {
            let media = inh.media_box.unwrap_or([0.0, 0.0, 612.0, 792.0]);
            let crop = inh.crop_box.map(|c| intersect(c, media)).unwrap_or(media);
            out.push(PageNode {
                dict: d.clone(),
                resources: inh.resources.clone().unwrap_or_default(),
                media_box: media,
                crop_box: crop,
                rotate: inh.rotate.unwrap_or(0).rem_euclid(360) / 90 * 90,
            });
            return Ok(());
        }
        if let Some(kids) = self.dict_get(d, "Kids") {
            for k in kids.as_array().unwrap_or(&[]) {
                self.walk_pages(k, &inh, out, seen, depth + 1)?;
            }
        }
        Ok(())
    }

    /// A rectangle entry, normalised to `[x0, y0, x1, y1]` with x0 <= x1 and y0 <= y1.
    pub fn rect(&self, d: &Dict, key: &str) -> Option<[f64; 4]> {
        let a = self.dict_get(d, key)?;
        let v: Vec<f64> = a.as_array()?.iter().filter_map(|o| self.resolve(o).as_f64()).collect();
        if v.len() != 4 {
            return None;
        }
        Some([v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])])
    }

    /// The catalog's optional content groups that are off in the default configuration.
    pub fn hidden_layers(&self) -> Vec<Obj> {
        let Some(root) = self.dict_get(&self.trailer, "Root") else { return vec![] };
        let Some(ocp) = root.as_dict().and_then(|r| self.dict_get(r, "OCProperties")) else { return vec![] };
        let Some(d) = ocp.as_dict().and_then(|o| self.dict_get(o, "D")) else { return vec![] };
        let Some(d) = d.as_dict() else { return vec![] };
        let base_off = d.get("BaseState").and_then(Obj::as_name).is_some_and(|n| n.is("OFF"));
        if base_off {
            // Everything off except /ON: report it as not supported (rare); callers fall back.
            return vec![Obj::Name(Name(b"*".to_vec()))];
        }
        self.dict_get(d, "OFF").and_then(|a| a.as_array().map(|a| a.to_vec())).unwrap_or_default()
    }
}

#[derive(Clone, Default)]
struct Inherited {
    resources: Option<Dict>,
    media_box: Option<[f64; 4]>,
    crop_box: Option<[f64; 4]>,
    rotate: Option<i32>,
}

fn intersect(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    let r = [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])];
    if r[0] < r[2] && r[1] < r[3] { r } else { b }
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn rfind(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).rposition(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_pdf(broken_xref: bool) -> Vec<u8> {
        let mut out = b"%PDF-1.4\n".to_vec();
        let objs = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 100] >>",
            "<< /Type /Page /Parent 2 0 R /Rotate 90 /Contents 4 0 R >>",
        ];
        let mut offs = vec![];
        for (i, o) in objs.iter().enumerate() {
            offs.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
        }
        offs.push(out.len());
        out.extend_from_slice(b"4 0 obj\n<< /Length 99 >>\nstream\n0 0 m 10 10 l S\nendstream\nendobj\n");
        let x = out.len();
        out.extend_from_slice(b"xref\n0 5\n0000000000 65535 f \n");
        for o in offs {
            let o = if broken_xref { o + 3 } else { o };
            out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n").as_bytes());
        out
    }

    #[test]
    fn reads_pages_and_streams() {
        for broken in [false, true] {
            let pdf = tiny_pdf(broken);
            let doc = Document::open(&pdf).unwrap();
            assert_eq!(doc.page_count(), 1);
            let p = doc.page(0).unwrap();
            assert_eq!(p.media_box, [0.0, 0.0, 200.0, 100.0]);
            assert_eq!(p.rotate, 90);
            let c = doc.resolve(p.dict.get("Contents").unwrap());
            let Obj::Stream(s) = c.as_ref() else { panic!() };
            // /Length is wrong (99): the stream ends at `endstream`.
            assert_eq!(doc.decode(s).unwrap(), b"0 0 m 10 10 l S");
        }
    }
}
