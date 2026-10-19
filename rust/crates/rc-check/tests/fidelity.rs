//! The GPU scene against PDFium, page by page, on the repository's fixtures and on generated heavy
//! drawings (rotated, layered, transparent, with images and text).
//!
//! The test binary doubles as a PDFium worker (as the app does), so it needs no other binary.
//! Set `RC_CHECK_OUT=<dir>` to save each view's GPU and PDFium images as PNG.

use rc_bench::drawing::{GenOptions, generate};
use rc_check::*;
use rc_gpu::{Gpu, Renderer};
use rc_pdf::{Job, JobResult, Pool, PoolOptions};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn pdfium() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/pdfium");
    if cfg!(windows) { dir.join("win-x64/bin/pdfium.dll") } else { dir.join("linux-x64/lib/libpdfium.so") }
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../e2e/fixtures").join(name)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--rc-pdfium-worker") {
        rc_pdf::worker::main_from_args(args.into_iter().skip(1)).unwrap();
        return;
    }
    let gpu = match Gpu::headless() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("fidelity: no GPU adapter, skipping ({e})");
            return;
        }
    };
    eprintln!("fidelity: {} ({:?}), {}x MSAA", gpu.info.name, gpu.info.backend, gpu.sample_count);
    let pool = Pool::new(PoolOptions {
        workers: 2,
        program: std::env::current_exe().unwrap(),
        args: vec!["--rc-pdfium-worker".into()],
        pdfium: pdfium(),
    })
    .unwrap();
    let mut renderer = Renderer::new(&gpu.device, &gpu.queue, gpu.sample_count);
    let tmp = std::env::temp_dir().join(format!("rc-fidelity-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let mut cases: Vec<(String, PathBuf)> = ["plan.pdf", "plan-rev1.pdf", "sheets.pdf", "stitch.pdf", "forms.pdf"]
        .iter()
        .map(|n| (n.to_string(), fixture(n)))
        .collect();
    let generated = [
        ("generated", GenOptions { segments: 20_000, ..Default::default() }),
        ("rotated-90", GenOptions { segments: 10_000, rotate: 90, ..Default::default() }),
        ("rotated-270", GenOptions { segments: 10_000, rotate: 270, width: 1684.0, height: 2384.0, ..Default::default() }),
        ("plain", GenOptions { segments: 10_000, text: false, image: false, transparency: false, layers: false, ..Default::default() }),
        ("heavy", GenOptions { segments: 300_000, ..Default::default() }),
    ];
    for (name, o) in generated {
        let p = tmp.join(format!("{name}.pdf"));
        std::fs::write(&p, generate(&o)).unwrap();
        cases.push((name.to_string(), p));
    }
    let out = std::env::var_os("RC_CHECK_OUT").map(PathBuf::from);
    let mut failures = Vec::new();
    for (doc, (name, path)) in cases.iter().enumerate() {
        let doc = doc as u32 + 1;
        pool.open(doc, path.clone(), None);
        let pages = match wait(&pool, pool.submit(Job::Pages { doc }, 0)) {
            JobResult::Pages(p) => p.len() as u32,
            other => panic!("{name}: {other:?}"),
        };
        let bytes = std::fs::read(path).unwrap();
        let parsed = rc_parse::Document::open(&bytes);
        if let Err(e) = &parsed {
            eprintln!("fidelity: {name}: own parser cannot read it ({e})");
        }
        for page in 0..pages {
          for source in ["pdfium", "parser"] {
            let content = if source == "pdfium" {
                match wait(&pool, pool.submit(Job::Extract { doc, page }, 0)) {
                    JobResult::Extracted { content, .. } => content,
                    other => panic!("{name} p{page}: {other:?}"),
                }
            } else {
                let Ok(d) = &parsed else { continue };
                let t = std::time::Instant::now();
                let c = rc_parse::page_content(d, page as usize, &Default::default()).unwrap();
                eprintln!("fidelity: {name} p{} parsed in {:.1} ms", page + 1, t.elapsed().as_secs_f64() * 1000.0);
                Box::new(c)
            };
            if content.flags & rc_scene::content::flags::NEEDS_RASTER != 0 {
                eprintln!("fidelity: {name} p{} [{source}] flags {:#x}: drawn by the raster path", page + 1, content.flags);
                continue;
            }
            let scene = rc_scene::build_scene(&content, &Default::default());
            let gs = renderer.upload(&gpu.device, &gpu.queue, &scene).unwrap();
            let (verdict, gpus, refs) = check_blocking(&gpu.device, &gpu.queue, &mut renderer, &pool, doc, page, &scene, &gs).unwrap();
            eprintln!(
                "fidelity: {name} p{} [{source}] {} segs {} tris, flags {:#x}: diff {:.4} / {:.4} {}",
                page + 1,
                scene.stats.segments,
                scene.stats.triangles,
                scene.flags,
                verdict.diffs[0],
                verdict.diffs[1],
                if verdict.ok { "ok" } else { "FAIL" }
            );
            if let Some(dir) = &out {
                let vs = views(scene.size, densest_point(&scene));
                for (i, v) in vs.iter().enumerate() {
                    let save = |kind: &str, px: &[u8]| {
                        image::save_buffer(dir.join(format!("{name}-p{}-{source}-v{i}-{kind}.png", page + 1)), px, v.width, v.height, image::ColorType::Rgba8).unwrap();
                    };
                    save("gpu", &gpus[i]);
                    save("pdfium", &refs[i]);
                }
            }
            if !verdict.ok {
                failures.push(format!("{name} page {} [{source}]: {:?}", page + 1, verdict.diffs));
            }
          }
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    if !failures.is_empty() {
        eprintln!("fidelity: {} page(s) differ from PDFium:\n  {}", failures.len(), failures.join("\n  "));
        std::process::exit(1);
    }
    eprintln!("fidelity: all pages match PDFium");
}

fn wait(pool: &Pool, id: u64) -> JobResult {
    loop {
        let e = pool.events().recv_timeout(Duration::from_secs(300)).expect("pool timed out");
        if e.id == id {
            return e.result;
        }
    }
}
