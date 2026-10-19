//! The worker pool against real PDFium and the repository's fixture drawings.

use rc_pdf::*;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn pdfium_path() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/pdfium");
    if cfg!(windows) { dir.join("win-x64/bin/pdfium.dll") } else { dir.join("linux-x64/lib/libpdfium.so") }
}

pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../e2e/fixtures").join(name)
}

fn pool(workers: usize) -> Pool {
    Pool::new(PoolOptions {
        workers,
        program: PathBuf::from(env!("CARGO_BIN_EXE_rc-pdf-worker")),
        args: vec![],
        pdfium: pdfium_path(),
    })
    .unwrap()
}

fn wait(pool: &Pool, id: JobId) -> Event {
    loop {
        let e = pool.events().recv_timeout(Duration::from_secs(60)).expect("no answer from the pool");
        if e.id == id {
            return e;
        }
    }
}

#[test]
fn pages_render_extract() {
    let pool = pool(2);
    pool.open(1, fixture("plan.pdf"), None);
    let e = wait(&pool, pool.submit(Job::Pages { doc: 1 }, 0));
    let JobResult::Pages(pages) = e.result else { panic!("{:?}", e.result) };
    assert!(!pages.is_empty());
    let p = &pages[0];
    assert!(p.width > 100.0 && p.height > 100.0);

    let req = RenderRequest {
        doc: 1,
        page: 0,
        scale: 0.5,
        x: 0,
        y: 0,
        width: (p.width * 0.5).ceil() as u32,
        height: (p.height * 0.5).ceil() as u32,
        layer: Layer::Full,
        thin_lines: false,
        rotate: 0,
        hide_annots: vec![],
        generation: 1,
    };
    let e = wait(&pool, pool.submit(Job::Render(req.clone()), 0));
    let JobResult::Rendered { width, height, rgba, .. } = e.result else { panic!("{:?}", e.result) };
    assert_eq!(rgba.len(), (width * height * 4) as usize);
    // Something is drawn: not every pixel is white.
    assert!(rgba.chunks(4).any(|px| px[0] < 200));

    let e = wait(&pool, pool.submit(Job::Extract { doc: 1, page: 0 }, 0));
    let JobResult::Extracted { content, .. } = e.result else { panic!("{:?}", e.result) };
    assert!(!content.items.is_empty());
    assert!((content.size[0] - p.width).abs() < 0.5);

    // A cancelled generation stops a job that has not started.
    pool.cancel_below(5);
    let e = wait(&pool, pool.submit(Job::Render(req), 0));
    assert!(matches!(e.result, JobResult::Cancelled), "{:?}", e.result);
}

#[test]
fn missing_file_and_closed_document() {
    let pool = pool(1);
    pool.open(7, fixture("does-not-exist.pdf"), None);
    let e = wait(&pool, pool.submit(Job::Pages { doc: 7 }, 0));
    assert!(matches!(e.result, JobResult::Failed(_)));
    pool.close_and_wait(7);
    let e = wait(&pool, pool.submit(Job::Pages { doc: 7 }, 0));
    assert!(matches!(e.result, JobResult::Failed(ref m) if m.contains("closed")));
}

#[test]
fn many_tiles_in_parallel() {
    let pool = pool(3);
    pool.open(1, fixture("sheets.pdf"), None);
    let e = wait(&pool, pool.submit(Job::Pages { doc: 1 }, 0));
    let JobResult::Pages(pages) = e.result else { panic!() };
    let mut ids = Vec::new();
    for (i, _) in pages.iter().enumerate() {
        for t in 0..4 {
            ids.push(pool.submit(
                Job::Render(RenderRequest {
                    doc: 1,
                    page: i as u32,
                    scale: 1.0,
                    x: (t % 2) * 256,
                    y: (t / 2) * 256,
                    width: 256,
                    height: 256,
                    layer: Layer::Content,
                    thin_lines: false,
                    rotate: 0,
                    hide_annots: vec![],
                    generation: 1,
                }),
                t as i64,
            ));
        }
    }
    let mut done = 0;
    let mut workers = std::collections::HashSet::new();
    while done < ids.len() {
        let e = pool.events().recv_timeout(Duration::from_secs(60)).unwrap();
        assert!(matches!(e.result, JobResult::Rendered { .. }), "{:?}", e.result);
        workers.insert(e.worker);
        done += 1;
    }
    if ids.len() >= 6 {
        assert!(workers.len() > 1, "work should spread over workers");
    }
}
