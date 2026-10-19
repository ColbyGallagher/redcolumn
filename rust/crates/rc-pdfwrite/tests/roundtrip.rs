//! Saving markups and reading them back: with our parser (the exact markups, from /NBData) and
//! with PDFium (the file opens, the annotations are there, and their appearances draw where the
//! markups are), on the repository's fixtures, rotated pages, and a file with cross-reference
//! streams. Then editing and deleting imported markups and saving again.
//!
//! The test binary doubles as a PDFium worker.

use rc_bench::drawing::{GenOptions, generate};
use rc_markup::{Markup, RECT, TEXT, import::import};
use rc_pdf::{Job, JobResult, Layer, Pool, PoolOptions, RenderRequest};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn pdfium() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/pdfium");
    if cfg!(windows) {
        dir.join("win-x64/bin/pdfium.dll")
    } else {
        dir.join("linux-x64/lib/libpdfium.so")
    }
}

fn wait(pool: &Pool, id: u64) -> JobResult {
    loop {
        let e = pool
            .events()
            .recv_timeout(Duration::from_secs(120))
            .expect("pool timed out");
        if e.id == id {
            return e.result;
        }
    }
}

/// A one-page file whose cross-reference is a stream (as PDF 1.5+ writers make them).
fn xref_stream_pdf() -> Vec<u8> {
    let mut out = b"%PDF-1.7\n".to_vec();
    let content = b"0 0 1 RG 4 w 100 100 400 200 re S";
    let objs = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>".to_string(),
        format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            content.len(),
            String::from_utf8_lossy(content)
        ),
    ];
    let mut offs = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offs.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
    }
    let xref = out.len();
    let mut rows = vec![0u8, 0, 0, 0, 0, 0xff, 0xff];
    for &o in offs.iter().chain([&xref]) {
        rows.push(1);
        rows.extend_from_slice(&(o as u32).to_be_bytes());
        rows.extend_from_slice(&[0, 0]);
    }
    out.extend_from_slice(
        format!(
            "5 0 obj\n<< /Type /XRef /Size 6 /W [1 4 2] /Root 1 0 R /Length {} >>\nstream\n",
            rows.len()
        )
        .as_bytes(),
    );
    out.extend_from_slice(&rows);
    out.extend_from_slice(format!("\nendstream\nendobj\nstartxref\n{xref}\n%%EOF\n").as_bytes());
    out
}

fn new_markups(page: usize, size: [f32; 2]) -> Vec<Markup> {
    let (w, h) = (size[0] as f64, size[1] as f64);
    let mut r = Markup::new(RECT, page, vec![[w * 0.1, h * 0.1], [w * 0.4, h * 0.3]], "Tester");
    r.style.width = 6.0;
    r.style.stroke = "#ff0000".into();
    let mut t = Markup::new(TEXT, page, vec![[w * 0.5, h * 0.6], [w * 0.9, h * 0.8]], "Tester");
    t.text = Some("Check (this) dimension\nsecond line é".into());
    t.style.fill = Some("#00ff00".into());
    t.style.font_size = Some(14.0);
    vec![r, t]
}

/// Our parser's markups for every page, and the (page, index) of their annotations.
fn read_back(bytes: &[u8]) -> (Vec<Markup>, Vec<(usize, u32)>) {
    let doc = rc_parse::Document::open(bytes).expect("our parser reads the saved file");
    let mut ms = Vec::new();
    let mut imported = Vec::new();
    for i in 0..doc.page_count() {
        let page = doc.page(i).unwrap();
        let got = import(i, page.rotate, &rc_parse::annotations(&doc, page));
        imported.extend(got.iter().map(|m| (i, m.pdf_annot.as_ref().unwrap().index)));
        ms.extend(got);
    }
    (ms, imported)
}

fn save(bytes: &[u8], markups: &[Markup], imported: &[(usize, u32)]) -> Vec<u8> {
    let doc = rc_parse::Document::open(bytes).unwrap();
    let tail = rc_pdfwrite::update(&doc, markups, imported)
        .unwrap()
        .expect("something to save");
    assert!(tail.len() < 64 * 1024, "an update is small ({} bytes)", tail.len());
    [bytes, &tail[..]].concat()
}

/// PDFium's render of a page at `scale`: what colour is at a page-space point.
fn pixel(pool: &Pool, doc: u32, page: u32, scale: f32, size: [f32; 2], p: [f64; 2]) -> [u8; 4] {
    let (w, h) = ((size[0] * scale).ceil() as u32, (size[1] * scale).ceil() as u32);
    let req = RenderRequest {
        doc,
        page,
        scale,
        x: 0,
        y: 0,
        width: w,
        height: h,
        layer: Layer::Full,
        thin_lines: false,
        rotate: 0,
        hide_annots: vec![],
        generation: rc_pdf::pool::NEVER_CANCEL,
    };
    let JobResult::Rendered { rgba, .. } = wait(pool, pool.submit(Job::Render(req), 0)) else {
        panic!("render failed")
    };
    let (x, y) = ((p[0] * scale as f64) as usize, (p[1] * scale as f64) as usize);
    let i = (y * w as usize + x) * 4;
    [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}

fn same(a: &Markup, b: &Markup) -> bool {
    let strip = |m: &Markup| {
        let mut m = m.clone();
        m.pdf_annot = None;
        m.seq = None;
        m
    };
    strip(a) == strip(b)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--rc-pdfium-worker") {
        rc_pdf::worker::main_from_args(args.into_iter().skip(1)).unwrap();
        return;
    }
    let pool = Pool::new(PoolOptions {
        workers: 1,
        program: std::env::current_exe().unwrap(),
        args: vec!["--rc-pdfium-worker".into()],
        pdfium: pdfium(),
    })
    .unwrap();
    let tmp = std::env::temp_dir().join(format!("rc-roundtrip-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../e2e/fixtures");
    let mut cases: Vec<(String, Vec<u8>)> = ["plan.pdf", "plan-rev1.pdf", "sheets.pdf", "stitch.pdf", "forms.pdf"]
        .iter()
        .map(|n| (n.to_string(), std::fs::read(fixtures.join(n)).unwrap()))
        .collect();
    cases.push(("xref-stream".into(), xref_stream_pdf()));
    for rotate in [90, 180, 270] {
        cases.push((
            format!("rotated-{rotate}"),
            generate(&GenOptions {
                segments: 2_000,
                rotate,
                text: false,
                image: false,
                ..Default::default()
            }),
        ));
    }
    let mut doc_id = 0;
    for (name, original) in &cases {
        let parsed = rc_parse::Document::open(original).unwrap();
        let sizes = rc_parse::page_sizes(&parsed);
        let (before, before_imported) = read_back(original);
        // New markups on the first and last page.
        let mut markups = before.clone();
        let last = sizes.len() - 1;
        markups.extend(new_markups(0, sizes[0]));
        if last > 0 {
            markups.extend(new_markups(last, sizes[last]));
        }
        let saved = save(original, &markups, &before_imported);
        assert!(
            saved.starts_with(original),
            "{name}: the original bytes stay as they are"
        );
        let (back, imported) = read_back(&saved);
        assert_eq!(back.len(), markups.len(), "{name}: every markup comes back");
        for m in &markups {
            let b = back
                .iter()
                .find(|b| b.id == m.id)
                .unwrap_or_else(|| panic!("{name}: markup {} missing", m.id));
            assert!(
                same(m, b) || before.iter().any(|o| o.id == m.id),
                "{name}: markup changed on the way\n{m:?}\n{b:?}"
            );
        }
        // PDFium opens it, finds the annotations, and draws them where the markups are.
        let path = tmp.join(format!("{name}.pdf"));
        std::fs::write(&path, &saved).unwrap();
        doc_id += 1;
        pool.open(doc_id, path.clone(), None);
        let JobResult::Annotations(annots) = wait(&pool, pool.submit(Job::Annotations { doc: doc_id, page: 0 }, 0))
        else {
            panic!("{name}: no annotations")
        };
        let ours: Vec<_> = annots.iter().filter(|a| !a.app_data.is_empty()).collect();
        assert!(ours.len() >= 2, "{name}: PDFium sees {} of our annotations", ours.len());
        let r = &markups[before.len()];
        let edge = [r.points[0][0], (r.points[0][1] + r.points[1][1]) / 2.0];
        let px = pixel(&pool, doc_id, 0, 1.0, sizes[0], edge);
        assert!(
            px[0] > 200 && px[1] < 80 && px[2] < 80,
            "{name}: the rectangle's red edge is drawn at {edge:?} (got {px:?})"
        );
        let t = &markups[before.len() + 1];
        let inside = [t.points[1][0] - 3.0, t.points[1][1] - 3.0];
        let px = pixel(&pool, doc_id, 0, 1.0, sizes[0], inside);
        assert!(
            px[1] > 200 && px[0] < 80,
            "{name}: the text box's green fill is drawn at {inside:?} (got {px:?})"
        );

        // Edit one, delete the other, save again.
        let mut edited = back.clone();
        let ri = edited.iter().position(|m| m.id == r.id).unwrap();
        edited[ri].points[1][0] += 20.0;
        edited[ri].style.stroke = "#0000ff".into();
        edited.retain(|m| m.id != t.id);
        let saved2 = save(&saved, &edited, &imported);
        let (back2, _) = read_back(&saved2);
        assert_eq!(back2.len(), edited.len(), "{name}: the deleted markup is gone");
        let r2 = back2.iter().find(|m| m.id == r.id).unwrap();
        assert_eq!(r2.style.stroke, "#0000ff");
        assert_eq!(r2.points[1][0], edited[ri].points[1][0]);
        let doc2 = rc_parse::Document::open(&saved2).unwrap();
        let n_annots = rc_parse::annotations(&doc2, doc2.page(0).unwrap()).len();
        let n_before = rc_parse::annotations(&parsed, parsed.page(0).unwrap()).len();
        assert_eq!(
            n_annots,
            n_before + 1,
            "{name}: page 1 has its old annotations and the rectangle"
        );
        // Nothing changed: nothing to save.
        let (back3, imported3) = read_back(&saved2);
        assert!(
            rc_pdfwrite::update(&doc2, &back3, &imported3).unwrap().is_none(),
            "{name}: unchanged markups are left alone"
        );
        // PDFium still opens it.
        let path2 = tmp.join(format!("{name}-2.pdf"));
        std::fs::write(&path2, &saved2).unwrap();
        doc_id += 1;
        pool.open(doc_id, path2, None);
        let edge = [r2.points[1][0], (r2.points[0][1] + r2.points[1][1]) / 2.0];
        let px = pixel(&pool, doc_id, 0, 1.0, sizes[0], edge);
        assert!(
            px[2] > 200 && px[0] < 80,
            "{name}: the edited rectangle's blue edge is drawn at {edge:?} (got {px:?})"
        );
        eprintln!(
            "roundtrip: {name}: ok ({} + {} bytes)",
            saved.len() - original.len(),
            saved2.len() - saved.len()
        );
    }
    // Saving to disk: the temporary file replaces the original.
    let path = tmp.join("replace.pdf");
    std::fs::write(&path, &cases[0].1).unwrap();
    let doc = rc_parse::Document::open(&cases[0].1).unwrap();
    let tmpfile = rc_pdfwrite::prepare(&path, &doc, &new_markups(0, [600.0, 600.0]), &[])
        .unwrap()
        .unwrap();
    drop(doc);
    rc_pdfwrite::replace(&tmpfile, &path).unwrap();
    assert!(!tmpfile.exists());
    assert_eq!(read_back(&std::fs::read(&path).unwrap()).0.len(), 2);
    let _ = std::fs::remove_dir_all(&tmp);
    eprintln!("roundtrip: ok");
}
