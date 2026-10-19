//! Colour spaces, reduced to what drawings use: device and calibrated grey, RGB and CMYK, ICC
//! profiles by their component count, indexed colour, and patterns (reported, not drawn).

use crate::document::Document;
use crate::object::{Dict, Obj};

#[derive(Clone, Debug, PartialEq)]
pub enum ColorSpace {
    Gray,
    Rgb,
    Cmyk,
    Indexed {
        base: Box<ColorSpace>,
        hival: u32,
        lookup: Vec<u8>,
    },
    Pattern,
    /// Separation, DeviceN, Lab and others: their component count, so operands can be skipped.
    Unsupported(usize),
}

impl ColorSpace {
    pub fn components(&self) -> usize {
        match self {
            ColorSpace::Gray | ColorSpace::Indexed { .. } => 1,
            ColorSpace::Rgb => 3,
            ColorSpace::Cmyk => 4,
            ColorSpace::Pattern => 1,
            ColorSpace::Unsupported(n) => *n,
        }
    }

    /// The initial colour of the space (black, or index 0).
    pub fn initial(&self) -> Vec<f32> {
        match self {
            ColorSpace::Cmyk => vec![0.0, 0.0, 0.0, 1.0],
            other => vec![0.0; other.components()],
        }
    }

    /// Components (0–1, or an index for Indexed) to 8-bit RGB. None for spaces not drawn.
    pub fn to_rgb(&self, c: &[f32]) -> Option<[u8; 3]> {
        let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        match self {
            ColorSpace::Gray => Some([b(*c.first()?); 3]),
            ColorSpace::Rgb => Some([b(*c.first()?), b(*c.get(1)?), b(*c.get(2)?)]),
            ColorSpace::Cmyk => {
                let (cy, m, y, k) = (*c.first()?, *c.get(1)?, *c.get(2)?, *c.get(3)?);
                Some(cmyk_to_rgb(cy, m, y, k))
            }
            ColorSpace::Indexed { base, hival, lookup } => {
                let i = (c.first()?.round().max(0.0) as u32).min(*hival) as usize;
                let n = base.components();
                let entry = lookup.get(i * n..i * n + n)?;
                let comps: Vec<f32> = entry.iter().map(|&v| v as f32 / 255.0).collect();
                base.to_rgb(&comps)
            }
            _ => None,
        }
    }
}

/// CMYK to RGB the simple way (no colour management), as PDFium does without a profile.
pub fn cmyk_to_rgb(c: f32, m: f32, y: f32, k: f32) -> [u8; 3] {
    let f = |v: f32| ((1.0 - (v + k).min(1.0)).clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    [f(c), f(m), f(y)]
}

/// Resolves a colour space operand: a name (device spaces, or a resource) or an array.
pub fn resolve(doc: &Document, obj: &Obj, resources: &Dict, depth: usize) -> ColorSpace {
    if depth > 8 {
        return ColorSpace::Unsupported(1);
    }
    let obj = doc.resolve(obj);
    match obj.as_ref() {
        Obj::Name(n) => match n.as_bytes() {
            b"DeviceGray" | b"G" | b"CalGray" => ColorSpace::Gray,
            b"DeviceRGB" | b"RGB" | b"CalRGB" => ColorSpace::Rgb,
            b"DeviceCMYK" | b"CMYK" => ColorSpace::Cmyk,
            b"Pattern" => ColorSpace::Pattern,
            name => {
                let named = doc.dict_get(resources, "ColorSpace").and_then(|cs| {
                    cs.as_dict()
                        .and_then(|d| d.0.iter().find(|(k, _)| k.as_bytes() == name).map(|(_, v)| v.clone()))
                });
                match named {
                    Some(o) => resolve(doc, &o, resources, depth + 1),
                    None => ColorSpace::Unsupported(1),
                }
            }
        },
        Obj::Array(a) => {
            let Some(kind) = a.first().and_then(|o| o.as_name()) else {
                return ColorSpace::Unsupported(1);
            };
            match kind.as_bytes() {
                b"CalGray" => ColorSpace::Gray,
                b"CalRGB" => ColorSpace::Rgb,
                b"DeviceGray" => ColorSpace::Gray,
                b"DeviceRGB" => ColorSpace::Rgb,
                b"DeviceCMYK" => ColorSpace::Cmyk,
                b"ICCBased" => {
                    let s = a.get(1).map(|o| doc.resolve(o));
                    let n = s
                        .as_ref()
                        .and_then(|s| s.as_dict())
                        .and_then(|d| d.get("N"))
                        .and_then(Obj::as_i64)
                        .unwrap_or(3);
                    match n {
                        1 => ColorSpace::Gray,
                        4 => ColorSpace::Cmyk,
                        _ => ColorSpace::Rgb,
                    }
                }
                b"Indexed" | b"I" => {
                    let base = a
                        .get(1)
                        .map(|o| resolve(doc, o, resources, depth + 1))
                        .unwrap_or(ColorSpace::Rgb);
                    let hival = a
                        .get(2)
                        .and_then(|o| doc.resolve(o).as_i64())
                        .unwrap_or(0)
                        .clamp(0, 255) as u32;
                    let lookup = match a.get(3).map(|o| doc.resolve(o)) {
                        Some(o) => match o.as_ref() {
                            Obj::Str(s) => s.clone(),
                            Obj::Stream(s) => doc.decode(s).unwrap_or_default(),
                            _ => Vec::new(),
                        },
                        None => Vec::new(),
                    };
                    ColorSpace::Indexed {
                        base: Box::new(base),
                        hival,
                        lookup,
                    }
                }
                b"Pattern" => ColorSpace::Pattern,
                b"Separation" => ColorSpace::Unsupported(1),
                b"DeviceN" => {
                    let n = a
                        .get(1)
                        .and_then(|o| doc.resolve(o).as_array().map(|x| x.len()))
                        .unwrap_or(1);
                    ColorSpace::Unsupported(n.max(1))
                }
                b"Lab" => ColorSpace::Unsupported(3),
                _ => ColorSpace::Unsupported(1),
            }
        }
        _ => ColorSpace::Unsupported(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversions() {
        assert_eq!(ColorSpace::Gray.to_rgb(&[0.5]), Some([128, 128, 128]));
        assert_eq!(ColorSpace::Cmyk.to_rgb(&[0.0, 0.0, 0.0, 1.0]), Some([0, 0, 0]));
        assert_eq!(ColorSpace::Cmyk.to_rgb(&[1.0, 0.0, 0.0, 0.0]), Some([0, 255, 255]));
        let idx = ColorSpace::Indexed {
            base: Box::new(ColorSpace::Rgb),
            hival: 1,
            lookup: vec![1, 2, 3, 4, 5, 6],
        };
        assert_eq!(idx.to_rgb(&[1.0]), Some([4, 5, 6]));
        assert_eq!(ColorSpace::Pattern.to_rgb(&[0.0]), None);
    }
}
