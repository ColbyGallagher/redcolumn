//! Saving markups into the PDF as an incremental update: the file's bytes stay as they are, and
//! the new and changed annotations, their appearance streams, the pages whose /Annots changed
//! and a cross-reference section chained to the file's last one are appended. Saving a 200 MB
//! drawing writes a few kilobytes plus one copy of the file (into a temporary file that then
//! replaces the original atomically).
//!
//! Each annotation carries the markup's JSON in /NBData, as the TypeScript app writes it, so
//! either app reads the other's markups back exactly; other tools see a standard Square or
//! FreeText annotation with an appearance stream.

mod appearance;
pub mod serialize;

use rc_markup::Markup;
use rc_parse::Document;
use rc_parse::object::Obj;
use serialize::{dict, write};
use std::collections::{HashMap, HashSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Unsupported(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// One object of the update: number, generation and body.
struct Object {
    num: u32,
    generation: u16,
    body: Vec<u8>,
}

/// The bytes to append to the file for these markups, or none when nothing changed since the
/// file was read. `imported` lists the (page, /Annots index) of every annotation the markups were
/// imported from: one with no markup linked to it any more was deleted, and is removed.
pub fn update(doc: &Document, markups: &[Markup], imported: &[(usize, u32)]) -> Result<Option<Vec<u8>>, Error> {
    let Some((prev, prev_is_stream)) = doc.last_xref else {
        return Err(Error::Unsupported(
            "the file's cross-reference table is damaged; it cannot be updated in place".into(),
        ));
    };
    let mut next = doc.next_object();
    let mut alloc = || {
        let n = next;
        next += 1;
        n
    };
    let mut objects: Vec<Object> = Vec::new();
    let now = rc_markup::now_ms();
    for (pi, page) in (0..doc.page_count()).filter_map(|i| doc.page(i).map(|p| (i, p))) {
        let on_page: Vec<&Markup> = markups
            .iter()
            .filter(|m| m.page_index == pi && Markup::supported(&m.kind))
            .collect();
        // A markup linked to an annotation is the one imported from it (a copy has another id).
        let linked: HashMap<u32, &Markup> = on_page
            .iter()
            .filter_map(|m| {
                m.pdf_annot
                    .as_ref()
                    .filter(|l| l.id.as_deref() == Some(&m.id))
                    .map(|l| (l.index, *m))
            })
            .collect();
        let added: Vec<&Markup> = on_page
            .iter()
            .copied()
            .filter(|m| !linked.values().any(|l| l.id == m.id))
            .collect();
        let changed: HashSet<u32> = linked
            .iter()
            .filter(|(_, m)| m.changed_since_import())
            .map(|(i, _)| *i)
            .collect();
        let dropped: HashSet<u32> = imported
            .iter()
            .filter(|(p, i)| *p == pi && !linked.contains_key(i))
            .map(|(_, i)| *i)
            .collect();
        if added.is_empty() && changed.is_empty() && dropped.is_empty() {
            continue;
        }
        if page.object == 0 {
            return Err(Error::Unsupported(format!("page {} is not an indirect object", pi + 1)));
        }
        let page_ref = Obj::Ref(page.object, doc.generation(page.object));
        let old: Vec<Obj> = page
            .dict
            .get("Annots")
            .map(|a| doc.resolve(a))
            .and_then(|a| a.as_array().map(<[Obj]>::to_vec))
            .unwrap_or_default();
        let dropped_refs: HashSet<u32> = old
            .iter()
            .enumerate()
            .filter(|(i, _)| dropped.contains(&(*i as u32)))
            .filter_map(|(_, e)| if let Obj::Ref(n, _) = e { Some(*n) } else { None })
            .collect();
        let mut entries = Vec::new();
        for (i, entry) in old.iter().enumerate() {
            let i = i as u32;
            if dropped.contains(&i) {
                continue;
            }
            // A deleted markup's popup goes with it.
            let resolved = doc.resolve(entry);
            if let Some(d) = resolved.as_dict()
                && d.get("Subtype").and_then(Obj::as_name).is_some_and(|s| s.is("Popup"))
                && matches!(d.get("Parent"), Some(Obj::Ref(p, _)) if dropped_refs.contains(p))
            {
                continue;
            }
            if changed.contains(&i) {
                let m = linked[&i];
                let (num, generation) = match entry {
                    Obj::Ref(n, g) => (*n, *g),
                    _ => (alloc(), 0),
                };
                let ap = alloc();
                let (annot, stream) = appearance::annotation(m, page, &page_ref, ap, now);
                objects.push(object(num, generation, &Obj::Dict(annot)));
                objects.push(object(ap, 0, &stream));
                entries.push(Obj::Ref(num, generation));
            } else {
                entries.push(entry.clone());
            }
        }
        for m in added {
            let (num, ap) = (alloc(), alloc());
            let (annot, stream) = appearance::annotation(m, page, &page_ref, ap, now);
            objects.push(object(num, 0, &Obj::Dict(annot)));
            objects.push(object(ap, 0, &stream));
            entries.push(Obj::Ref(num, 0));
        }
        let mut pd = page.dict.clone();
        pd.0.retain(|(k, _)| !k.is("Annots"));
        if !entries.is_empty() {
            pd.0.push((serialize::name("Annots"), Obj::Array(entries)));
        }
        objects.push(object(page.object, doc.generation(page.object), &Obj::Dict(pd)));
    }
    if objects.is_empty() {
        return Ok(None);
    }
    // The objects, then the cross-reference section.
    let data = doc.data();
    let mut out = Vec::new();
    if !data.ends_with(b"\n") && !data.ends_with(b"\r") {
        out.push(b'\n');
    }
    let base = data.len();
    let mut offsets: Vec<(u32, u16, usize)> = Vec::new();
    for o in &objects {
        offsets.push((o.num, o.generation, base + out.len()));
        out.extend_from_slice(format!("{} {} obj\n", o.num, o.generation).as_bytes());
        out.extend_from_slice(&o.body);
        out.extend_from_slice(b"\nendobj\n");
    }
    let mut trailer = dict(vec![]);
    for k in ["Root", "Info", "ID"] {
        if let Some(v) = doc.trailer.get(k) {
            trailer.0.push((serialize::name(k), v.clone()));
        }
    }
    trailer.0.push((serialize::name("Prev"), Obj::Int(prev as i64)));
    let xref_at = base + out.len();
    if prev_is_stream {
        // The file uses cross-reference streams: so does its update.
        let num = alloc();
        offsets.push((num, 0, xref_at));
        offsets.sort_by_key(|o| o.0);
        let mut rows = Vec::new();
        for &(_, generation, off) in &offsets {
            rows.push(1u8);
            rows.extend_from_slice(&(off as u32).to_be_bytes());
            rows.extend_from_slice(&generation.to_be_bytes());
        }
        trailer.0.extend([
            (serialize::name("Type"), serialize::n("XRef")),
            (serialize::name("Size"), Obj::Int(next as i64)),
            (serialize::name("W"), serialize::nums(&[1.0, 4.0, 2.0])),
            (
                serialize::name("Index"),
                Obj::Array(
                    subsections(&offsets)
                        .into_iter()
                        .flat_map(|(s, c)| [Obj::Int(s as i64), Obj::Int(c as i64)])
                        .collect(),
                ),
            ),
        ]);
        let stream = Obj::Stream(rc_parse::object::Stream {
            dict: trailer,
            data: rc_parse::object::StreamData::Owned(rows.into()),
        });
        out.extend_from_slice(format!("{num} 0 obj\n").as_bytes());
        write(&mut out, &stream);
        out.extend_from_slice(b"\nendobj\n");
    } else {
        offsets.sort_by_key(|o| o.0);
        out.extend_from_slice(b"xref\n");
        let mut k = 0;
        for (start, count) in subsections(&offsets) {
            out.extend_from_slice(format!("{start} {count}\n").as_bytes());
            for &(_, generation, off) in &offsets[k..k + count as usize] {
                out.extend_from_slice(format!("{off:010} {generation:05} n\r\n").as_bytes());
            }
            k += count as usize;
        }
        trailer.0.insert(0, (serialize::name("Size"), Obj::Int(next as i64)));
        out.extend_from_slice(b"trailer\n");
        write(&mut out, &Obj::Dict(trailer));
        out.push(b'\n');
    }
    out.extend_from_slice(format!("startxref\n{xref_at}\n%%EOF\n").as_bytes());
    Ok(Some(out))
}

fn object(num: u32, generation: u16, o: &Obj) -> Object {
    let mut body = Vec::new();
    write(&mut body, o);
    Object { num, generation, body }
}

/// Runs of consecutive object numbers: (first, count).
fn subsections(sorted: &[(u32, u16, usize)]) -> Vec<(u32, u32)> {
    let mut out: Vec<(u32, u32)> = Vec::new();
    for &(n, _, _) in sorted {
        match out.last_mut() {
            Some((s, c)) if *s + *c == n => *c += 1,
            _ => out.push((n, 1)),
        }
    }
    out
}

/// Writes the file with its update to a temporary file beside it. Returns its path, or none
/// when nothing changed. The caller lets go of the document (and any map of the file) and then
/// calls [`replace`].
pub fn prepare(
    path: &Path,
    doc: &Document,
    markups: &[Markup],
    imported: &[(usize, u32)],
) -> Result<Option<PathBuf>, Error> {
    let Some(tail) = update(doc, markups, imported)? else {
        return Ok(None);
    };
    let dir = path
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = dir.join(format!(".{name}.{}.saving", std::process::id()));
    let mut f = std::fs::File::create(&tmp)?;
    let r = (|| {
        f.write_all(doc.data())?;
        f.write_all(&tail)?;
        f.sync_all()
    })();
    if let Err(e) = r {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(Some(tmp))
}

/// Puts the temporary file in place of the original in one step (keeping the original's
/// attributes and permissions on Windows).
pub fn replace(tmp: &Path, path: &Path) -> Result<(), Error> {
    #[cfg(windows)]
    {
        use windows::Win32::Storage::FileSystem::{REPLACEFILE_IGNORE_MERGE_ERRORS, ReplaceFileW};
        use windows::core::HSTRING;
        let (to, from) = (HSTRING::from(path.as_os_str()), HSTRING::from(tmp.as_os_str()));
        // SAFETY: both strings are valid null-terminated paths for the duration of the call.
        let r = unsafe { ReplaceFileW(&to, &from, None, REPLACEFILE_IGNORE_MERGE_ERRORS, None, None) };
        if r.is_ok() {
            return Ok(());
        }
    }
    std::fs::rename(tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        e.into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs() {
        let v = [(3, 0, 0), (4, 0, 0), (9, 0, 0), (10, 0, 0), (12, 0, 0)];
        assert_eq!(subsections(&v), vec![(3, 2), (9, 2), (12, 1)]);
    }
}
