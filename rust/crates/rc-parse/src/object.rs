//! PDF objects and the lexer that reads them.

use std::fmt;

#[derive(Clone, PartialEq)]
pub enum Obj {
    Null,
    Bool(bool),
    Int(i64),
    Real(f64),
    Str(Vec<u8>),
    Name(Name),
    Array(Vec<Obj>),
    Dict(Dict),
    Ref(u32, u16),
    Stream(Stream),
}

/// A name without its leading slash, `#xx` escapes decoded.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Name(pub Vec<u8>);

impl Name {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn is(&self, s: &str) -> bool {
        self.0 == s.as_bytes()
    }

    pub fn as_str(&self) -> std::borrow::Cow<'_, str> {
        String::from_utf8_lossy(&self.0)
    }
}

impl fmt::Debug for Name {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "/{}", self.as_str())
    }
}

/// A dictionary: few entries, kept in order, looked up linearly.
#[derive(Clone, Default, PartialEq)]
pub struct Dict(pub Vec<(Name, Obj)>);

impl Dict {
    pub fn get(&self, key: &str) -> Option<&Obj> {
        self.0.iter().find(|(k, _)| k.0 == key.as_bytes()).map(|(_, v)| v)
    }

    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&Name, &Obj)> {
        self.0.iter().map(|(k, v)| (k, v))
    }
}

impl fmt::Debug for Dict {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_map().entries(self.0.iter().map(|(k, v)| (k, v))).finish()
    }
}

/// A stream: its dictionary and where its raw bytes are in the file (or, for streams built in
/// memory, the bytes themselves).
#[derive(Clone, PartialEq)]
pub struct Stream {
    pub dict: Dict,
    pub data: StreamData,
}

#[derive(Clone, PartialEq)]
pub enum StreamData {
    /// Offset and length in the file.
    File(usize, usize),
    Owned(std::sync::Arc<[u8]>),
}

impl fmt::Debug for Stream {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "stream {:?}", self.dict)
    }
}

impl fmt::Debug for Obj {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Obj::Null => write!(f, "null"),
            Obj::Bool(b) => write!(f, "{b}"),
            Obj::Int(i) => write!(f, "{i}"),
            Obj::Real(r) => write!(f, "{r}"),
            Obj::Str(s) => write!(f, "({})", String::from_utf8_lossy(s)),
            Obj::Name(n) => write!(f, "{n:?}"),
            Obj::Array(a) => f.debug_list().entries(a).finish(),
            Obj::Dict(d) => write!(f, "{d:?}"),
            Obj::Ref(n, g) => write!(f, "{n} {g} R"),
            Obj::Stream(s) => write!(f, "{s:?}"),
        }
    }
}

impl Obj {
    pub fn as_f64(&self) -> Option<f64> {
        match *self {
            Obj::Int(i) => Some(i as f64),
            Obj::Real(r) => Some(r),
            _ => None,
        }
    }

    pub fn as_f32(&self) -> Option<f32> {
        self.as_f64().map(|v| v as f32)
    }

    pub fn as_i64(&self) -> Option<i64> {
        match *self {
            Obj::Int(i) => Some(i),
            Obj::Real(r) => Some(r as i64),
            _ => None,
        }
    }

    pub fn as_name(&self) -> Option<&Name> {
        match self {
            Obj::Name(n) => Some(n),
            _ => None,
        }
    }

    pub fn as_dict(&self) -> Option<&Dict> {
        match self {
            Obj::Dict(d) => Some(d),
            Obj::Stream(s) => Some(&s.dict),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Obj]> {
        match self {
            Obj::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match *self {
            Obj::Bool(b) => Some(b),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&[u8]> {
        match self {
            Obj::Str(s) => Some(s),
            _ => None,
        }
    }
}

const WHITE: u8 = 1;
const DELIM: u8 = 2;

/// Byte classes: white space, delimiters, and (neither) regular characters.
static CLASS: [u8; 256] = {
    let mut t = [0u8; 256];
    let white = [b' ', b'\n', b'\r', b'\t', 0x0c, 0];
    let mut i = 0;
    while i < white.len() {
        t[white[i] as usize] = WHITE;
        i += 1;
    }
    let delim = *b"()<>[]{}/%";
    let mut i = 0;
    while i < delim.len() {
        t[delim[i] as usize] = DELIM;
        i += 1;
    }
    t
};

#[inline]
pub fn is_white(c: u8) -> bool {
    CLASS[c as usize] == WHITE
}

#[inline]
pub fn is_delim(c: u8) -> bool {
    CLASS[c as usize] == DELIM
}

#[inline]
pub fn is_regular(c: u8) -> bool {
    CLASS[c as usize] == 0
}

/// A position in a byte buffer, reading PDF tokens.
pub struct Lexer<'a> {
    pub b: &'a [u8],
    pub pos: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Token<'a> {
    Int(i64),
    Real(f64),
    Str(Vec<u8>),
    Name(&'a [u8]),
    /// A keyword or operator (`obj`, `R`, `re`, `Tj`, ...).
    Word(&'a [u8]),
    ArrayStart,
    ArrayEnd,
    DictStart,
    DictEnd,
    BraceOpen,
    BraceClose,
}

impl<'a> Lexer<'a> {
    pub fn new(b: &'a [u8], pos: usize) -> Self {
        Self { b, pos }
    }

    pub fn skip_ws(&mut self) {
        let b = self.b;
        let mut p = self.pos;
        while p < b.len() {
            let c = b[p];
            if is_white(c) {
                p += 1;
            } else if c == b'%' {
                while p < b.len() && b[p] != b'\n' && b[p] != b'\r' {
                    p += 1;
                }
            } else {
                break;
            }
        }
        self.pos = p;
    }

    pub fn at_end(&mut self) -> bool {
        self.skip_ws();
        self.pos >= self.b.len()
    }

    #[allow(clippy::should_implement_trait)] // A lexer, not an iterator: callers peek and seek between tokens.
    pub fn next(&mut self) -> Option<Token<'a>> {
        self.skip_ws();
        let b = self.b;
        let start = self.pos;
        let c = *b.get(start)?;
        match c {
            b'[' => {
                self.pos += 1;
                Some(Token::ArrayStart)
            }
            b']' => {
                self.pos += 1;
                Some(Token::ArrayEnd)
            }
            b'{' => {
                self.pos += 1;
                Some(Token::BraceOpen)
            }
            b'}' => {
                self.pos += 1;
                Some(Token::BraceClose)
            }
            b'<' => {
                if b.get(start + 1) == Some(&b'<') {
                    self.pos += 2;
                    Some(Token::DictStart)
                } else {
                    Some(Token::Str(self.hex_string()))
                }
            }
            b'>' => {
                self.pos += if b.get(start + 1) == Some(&b'>') { 2 } else { 1 };
                Some(Token::DictEnd)
            }
            b'(' => Some(Token::Str(self.literal_string())),
            b'/' => {
                let mut p = start + 1;
                while p < b.len() && is_regular(b[p]) {
                    p += 1;
                }
                self.pos = p;
                Some(Token::Name(&b[start + 1..p]))
            }
            b'+' | b'-' | b'.' | b'0'..=b'9' => {
                let mut p = start;
                while p < b.len() && is_regular(b[p]) {
                    p += 1;
                }
                self.pos = p;
                Some(number(&b[start..p]).unwrap_or(Token::Word(&b[start..p])))
            }
            b')' => {
                // A stray close parenthesis: skip it.
                self.pos += 1;
                self.next()
            }
            _ => {
                let mut p = start;
                while p < b.len() && is_regular(b[p]) {
                    p += 1;
                }
                if p == start {
                    p += 1;
                }
                self.pos = p;
                Some(Token::Word(&b[start..p]))
            }
        }
    }

    fn hex_string(&mut self) -> Vec<u8> {
        let b = self.b;
        let mut p = self.pos + 1;
        let mut out = Vec::new();
        let mut hi: Option<u8> = None;
        while p < b.len() && b[p] != b'>' {
            let v = match b[p] {
                c @ b'0'..=b'9' => Some(c - b'0'),
                c @ b'a'..=b'f' => Some(c - b'a' + 10),
                c @ b'A'..=b'F' => Some(c - b'A' + 10),
                _ => None,
            };
            if let Some(v) = v {
                match hi.take() {
                    Some(h) => out.push(h << 4 | v),
                    None => hi = Some(v),
                }
            }
            p += 1;
        }
        if let Some(h) = hi {
            out.push(h << 4);
        }
        self.pos = (p + 1).min(b.len());
        out
    }

    fn literal_string(&mut self) -> Vec<u8> {
        let b = self.b;
        let mut p = self.pos + 1;
        let mut depth = 1;
        let mut out = Vec::new();
        while p < b.len() {
            let c = b[p];
            p += 1;
            match c {
                b'\\' => {
                    let Some(&e) = b.get(p) else { break };
                    p += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'\r' => {
                            if b.get(p) == Some(&b'\n') {
                                p += 1;
                            }
                        }
                        b'\n' => {}
                        b'0'..=b'7' => {
                            let mut v = (e - b'0') as u32;
                            for _ in 0..2 {
                                match b.get(p) {
                                    Some(&d @ b'0'..=b'7') => {
                                        v = v * 8 + (d - b'0') as u32;
                                        p += 1;
                                    }
                                    _ => break,
                                }
                            }
                            out.push(v as u8);
                        }
                        other => out.push(other),
                    }
                }
                b'(' => {
                    depth += 1;
                    out.push(c);
                }
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                    out.push(c);
                }
                _ => out.push(c),
            }
        }
        self.pos = p;
        out
    }

    /// Reads one object (references `N G R` included). Streams are handled by the caller, which
    /// knows where the file's bytes are.
    pub fn object(&mut self) -> Option<Obj> {
        let t = self.next()?;
        self.object_from(t)
    }

    fn object_from(&mut self, t: Token<'a>) -> Option<Obj> {
        Some(match t {
            Token::Int(i) => {
                // `N G R`?
                let save = self.pos;
                if let Some(Token::Int(g)) = self.next() {
                    let save2 = self.pos;
                    if let Some(Token::Word(b"R")) = self.next()
                        && i >= 0
                        && i <= u32::MAX as i64
                    {
                        return Some(Obj::Ref(i as u32, g.clamp(0, u16::MAX as i64) as u16));
                    }
                    self.pos = save2;
                }
                self.pos = save;
                Obj::Int(i)
            }
            Token::Real(r) => Obj::Real(r),
            Token::Str(s) => Obj::Str(s),
            Token::Name(n) => Obj::Name(Name(decode_name(n))),
            Token::ArrayStart => {
                let mut a = Vec::new();
                loop {
                    match self.next()? {
                        Token::ArrayEnd => break,
                        t => a.push(self.object_from(t)?),
                    }
                }
                Obj::Array(a)
            }
            Token::DictStart => Obj::Dict(self.dict_body()?),
            Token::Word(b"true") => Obj::Bool(true),
            Token::Word(b"false") => Obj::Bool(false),
            Token::Word(b"null") => Obj::Null,
            Token::Word(_) | Token::ArrayEnd | Token::DictEnd | Token::BraceOpen | Token::BraceClose => Obj::Null,
        })
    }

    /// Reads a dictionary's entries after `<<`, through `>>`.
    pub fn dict_body(&mut self) -> Option<Dict> {
        let mut d = Vec::new();
        loop {
            match self.next()? {
                Token::DictEnd => break,
                Token::Name(k) => {
                    let t = self.next()?;
                    if t == Token::DictEnd {
                        d.push((Name(decode_name(k)), Obj::Null));
                        break;
                    }
                    let v = self.object_from(t)?;
                    d.push((Name(decode_name(k)), v));
                }
                _ => {}
            }
        }
        Some(Dict(d))
    }
}

pub fn decode_name(n: &[u8]) -> Vec<u8> {
    if !n.contains(&b'#') {
        return n.to_vec();
    }
    let mut out = Vec::with_capacity(n.len());
    let mut i = 0;
    while i < n.len() {
        if n[i] == b'#' && i + 2 < n.len() + 1 {
            let h = |c: u8| (c as char).to_digit(16);
            if let (Some(a), Some(b)) = (n.get(i + 1).and_then(|&c| h(c)), n.get(i + 2).and_then(|&c| h(c))) {
                out.push((a * 16 + b) as u8);
                i += 3;
                continue;
            }
        }
        out.push(n[i]);
        i += 1;
    }
    out
}

/// Parses a PDF number (no exponents; tolerates a doubled sign and trailing junk the way readers do).
pub fn number<'a>(s: &[u8]) -> Option<Token<'a>> {
    let mut i = 0;
    let mut neg = false;
    while i < s.len() && (s[i] == b'+' || s[i] == b'-') {
        neg ^= s[i] == b'-';
        i += 1;
    }
    let mut int: i64 = 0;
    let mut digits = 0;
    while i < s.len() && s[i].is_ascii_digit() {
        int = int.wrapping_mul(10).wrapping_add((s[i] - b'0') as i64);
        i += 1;
        digits += 1;
    }
    if i == s.len() {
        if digits == 0 {
            return None;
        }
        return Some(Token::Int(if neg { -int } else { int }));
    }
    if s[i] != b'.' {
        return if digits > 0 {
            Some(Token::Int(if neg { -int } else { int }))
        } else {
            None
        };
    }
    i += 1;
    let mut frac: f64 = 0.0;
    let mut scale = 1.0;
    while i < s.len() && s[i].is_ascii_digit() {
        frac = frac * 10.0 + (s[i] - b'0') as f64;
        scale *= 10.0;
        i += 1;
        digits += 1;
    }
    if digits == 0 {
        return None;
    }
    let v = int as f64 + frac / scale;
    Some(Token::Real(if neg { -v } else { v }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers() {
        assert_eq!(number(b"12"), Some(Token::Int(12)));
        assert_eq!(number(b"-3.5"), Some(Token::Real(-3.5)));
        assert_eq!(number(b".25"), Some(Token::Real(0.25)));
        assert_eq!(number(b"--4"), Some(Token::Int(4)));
        assert_eq!(number(b"5."), Some(Token::Real(5.0)));
        assert_eq!(number(b"-"), None);
    }

    #[test]
    fn objects() {
        let src = b"<< /Type /Page /Kids [1 0 R 2 0 R] /N 3 /S (a\\(b\\)) /H <414> /E /A#20B >>";
        let o = Lexer::new(src, 0).object().unwrap();
        let d = o.as_dict().unwrap();
        assert!(d.get("Type").unwrap().as_name().unwrap().is("Page"));
        assert_eq!(
            d.get("Kids").unwrap().as_array().unwrap(),
            &[Obj::Ref(1, 0), Obj::Ref(2, 0)]
        );
        assert_eq!(d.get("N"), Some(&Obj::Int(3)));
        assert_eq!(d.get("S").unwrap().as_str(), Some(&b"a(b)"[..]));
        assert_eq!(d.get("H").unwrap().as_str(), Some(&b"A@"[..]));
        assert!(d.get("E").unwrap().as_name().unwrap().is("A B"));
    }
}
