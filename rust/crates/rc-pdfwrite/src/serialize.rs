//! PDF object syntax.

use rc_parse::object::{Dict, Name, Obj, StreamData};

pub fn name(s: &str) -> Name {
    Name(s.as_bytes().to_vec())
}

pub fn dict(entries: Vec<(&str, Obj)>) -> Dict {
    Dict(entries.into_iter().map(|(k, v)| (name(k), v)).collect())
}

pub fn n(s: &str) -> Obj {
    Obj::Name(name(s))
}

pub fn num(v: f64) -> Obj {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        Obj::Int(v as i64)
    } else {
        Obj::Real(v)
    }
}

pub fn nums(v: &[f64]) -> Obj {
    Obj::Array(v.iter().map(|&x| num(x)).collect())
}

/// A text string: PDFDocEncoding when it is plain ASCII, else UTF-16BE with a byte order mark.
pub fn text(s: &str) -> Obj {
    if s.bytes()
        .all(|b| (0x20..0x7f).contains(&b) || b == b'\n' || b == b'\r' || b == b'\t')
    {
        return Obj::Str(s.as_bytes().to_vec());
    }
    let mut v = vec![0xfe, 0xff];
    for u in s.encode_utf16() {
        v.extend_from_slice(&u.to_be_bytes());
    }
    Obj::Str(v)
}

/// A number the way PDF writes it: no exponent, at most 4 decimals, no trailing zeros.
pub fn fmt(v: f64) -> String {
    if !v.is_finite() {
        return "0".into();
    }
    let s = format!("{:.4}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

pub fn write(out: &mut Vec<u8>, o: &Obj) {
    match o {
        Obj::Null => out.extend_from_slice(b"null"),
        Obj::Bool(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Obj::Int(i) => out.extend_from_slice(i.to_string().as_bytes()),
        Obj::Real(r) => out.extend_from_slice(fmt(*r).as_bytes()),
        Obj::Str(s) => write_string(out, s),
        Obj::Name(nm) => write_name(out, &nm.0),
        Obj::Array(a) => {
            out.push(b'[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(b' ');
                }
                write(out, x);
            }
            out.push(b']');
        }
        Obj::Dict(d) => write_dict(out, d),
        Obj::Ref(num, generation) => out.extend_from_slice(format!("{num} {generation} R").as_bytes()),
        Obj::Stream(s) => {
            let data: &[u8] = match &s.data {
                StreamData::Owned(d) => d,
                // Streams from the file are never written again, only referred to.
                StreamData::File(..) => &[],
            };
            let mut d = s.dict.clone();
            d.0.retain(|(k, _)| !k.is("Length"));
            d.0.push((name("Length"), Obj::Int(data.len() as i64)));
            write_dict(out, &d);
            out.extend_from_slice(b"\nstream\n");
            out.extend_from_slice(data);
            out.extend_from_slice(b"\nendstream");
        }
    }
}

fn write_dict(out: &mut Vec<u8>, d: &Dict) {
    out.extend_from_slice(b"<<");
    for (k, v) in &d.0 {
        write_name(out, &k.0);
        out.push(b' ');
        write(out, v);
    }
    out.extend_from_slice(b">>");
}

fn write_name(out: &mut Vec<u8>, n: &[u8]) {
    out.push(b'/');
    for &b in n {
        if (0x21..0x7f).contains(&b) && !b"#()<>[]{}/%".contains(&b) {
            out.push(b);
        } else {
            out.extend_from_slice(format!("#{b:02X}").as_bytes());
        }
    }
}

fn write_string(out: &mut Vec<u8>, s: &[u8]) {
    let printable = s.iter().filter(|&&b| (0x20..0x7f).contains(&b) || b == b'\n').count();
    if printable * 10 < s.len() * 9 {
        out.push(b'<');
        for b in s {
            out.extend_from_slice(format!("{b:02X}").as_bytes());
        }
        out.push(b'>');
        return;
    }
    out.push(b'(');
    for &b in s {
        match b {
            b'(' | b')' | b'\\' => {
                out.push(b'\\');
                out.push(b);
            }
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            0x20..=0x7e => out.push(b),
            _ => out.extend_from_slice(format!("\\{b:03o}").as_bytes()),
        }
    }
    out.push(b')');
}

/// A string in a content stream, in WinAnsiEncoding (characters it lacks become `?`).
pub fn win_ansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| match c as u32 {
            0x20..=0x7e | 0xa0..=0xff => c as u32 as u8,
            0x20ac => 0x80,
            0x2018 => 0x91,
            0x2019 => 0x92,
            0x201c => 0x93,
            0x201d => 0x94,
            0x2022 => 0x95,
            0x2013 => 0x96,
            0x2014 => 0x97,
            0x2026 => 0x85,
            _ => b'?',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(o: &Obj) -> String {
        let mut v = Vec::new();
        write(&mut v, o);
        String::from_utf8_lossy(&v).into_owned()
    }

    #[test]
    fn syntax() {
        assert_eq!(fmt(1.5), "1.5");
        assert_eq!(fmt(2.0), "2");
        assert_eq!(fmt(-0.00001), "0");
        assert_eq!(s(&Obj::Str(b"a(b)\\".to_vec())), "(a\\(b\\)\\\\)");
        assert_eq!(s(&Obj::Name(name("A B#"))), "/A#20B#23");
        assert_eq!(
            s(&Obj::Dict(dict(vec![
                ("Type", n("Annot")),
                ("Rect", nums(&[0.0, 1.5]))
            ]))),
            "<</Type /Annot/Rect [0 1.5]>>"
        );
        assert_eq!(text("é"), Obj::Str(vec![0xfe, 0xff, 0x00, 0xe9]));
        assert_eq!(win_ansi("a€é✓"), vec![b'a', 0x80, 0xe9, b'?']);
    }
}
