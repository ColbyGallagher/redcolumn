//! `rc-bench`: synthetic drawings and engine timings.
//!
//! ```text
//! rc-bench gen <out.pdf> [--segments N] [--pages N] [--rotate D]
//! rc-bench render <file.pdf> [pages]      PDFium parse and draw per page at 2048 px (native),
//!                                         the same table as scripts/render-bench.mjs (wasm)
//! rc-bench scene <file.pdf> [pages]       extraction, scene build, GPU upload and tile times
//! rc-bench parse <file.pdf> [pages]       our own parser against PDFium: open, read, scene build
//! ```
//! Pages are 1-based and comma separated (`1,2,40`); all pages when omitted.

use rc_bench::drawing::{GenOptions, generate};
use rc_pdf::{Job, JobResult, Layer, Pool, PoolOptions, RenderRequest};
use std::time::{Duration, Instant};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--rc-pdfium-worker") {
        return rc_pdf::worker::main_from_args(args.into_iter().skip(1));
    }
    let opt = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    match args.get(1).map(String::as_str) {
        Some("gen") => {
            let out = args.get(2).ok_or_else(|| anyhow::anyhow!("gen needs an output file"))?;
            let o = GenOptions {
                segments: opt("--segments").map_or(Ok(1_000_000), |v| v.parse())?,
                pages: opt("--pages").map_or(Ok(1), |v| v.parse())?,
                rotate: opt("--rotate").map_or(Ok(0), |v| v.parse())?,
                ..Default::default()
            };
            let t = Instant::now();
            let bytes = generate(&o);
            std::fs::write(out, &bytes)?;
            println!(
                "{out}: {} pages, ~{} segments each, {:.1} MB in {:.1} s",
                o.pages,
                o.segments,
                bytes.len() as f64 / 1e6,
                t.elapsed().as_secs_f64()
            );
            Ok(())
        }
        Some("render") => render(&args[2], args.get(3)),
        Some("scene") => scene(&args[2], args.get(3)),
        Some("parse") => parse(&args[2], args.get(3)),
        _ => {
            eprintln!(
                "usage: rc-bench gen <out.pdf> [--segments N] [--pages N] [--rotate D]\n       rc-bench render <file.pdf> [pages]\n       rc-bench scene <file.pdf> [pages]"
            );
            std::process::exit(2);
        }
    }
}

fn pool(workers: usize) -> anyhow::Result<Pool> {
    let mut o = PoolOptions::current_exe(workers)?;
    o.workers = workers;
    if !o.pdfium.exists() {
        let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/pdfium");
        o.pdfium = if cfg!(windows) {
            dev.join("win-x64/bin/pdfium.dll")
        } else {
            dev.join("linux-x64/lib/libpdfium.so")
        };
    }
    Pool::new(o)
}

fn wait(pool: &Pool, id: u64) -> anyhow::Result<rc_pdf::Event> {
    loop {
        let e = pool.events().recv_timeout(Duration::from_secs(600))?;
        if e.id == id {
            return Ok(e);
        }
    }
}

fn pages_of(pool: &Pool, file: &str, which: Option<&String>) -> anyhow::Result<Vec<(u32, rc_pdf::PageInfo)>> {
    pool.open(1, file.into(), None);
    let JobResult::Pages(pages) = wait(pool, pool.submit(Job::Pages { doc: 1 }, 0))?.result else {
        anyhow::bail!("cannot read pages of {file}");
    };
    let picked: Vec<u32> = match which {
        Some(list) => list
            .split(',')
            .filter_map(|p| p.trim().parse::<u32>().ok())
            .map(|p| p - 1)
            .collect(),
        None => (0..pages.len() as u32).collect(),
    };
    Ok(picked
        .into_iter()
        .filter_map(|i| pages.get(i as usize).map(|p| (i, p.clone())))
        .collect())
}

/// Native PDFium on one worker: parse and draw each page whole at 2048 px on its long side.
fn render(file: &str, which: Option<&String>) -> anyhow::Result<()> {
    let pool = pool(1)?;
    let pages = pages_of(&pool, file, which)?;
    println!("page  objects  parse ms  draw ms");
    let (mut parse, mut draw) = (0.0, 0.0);
    for (i, info) in pages {
        let s = 2048.0 / info.width.max(info.height);
        let req = RenderRequest {
            doc: 1,
            page: i,
            scale: s,
            x: 0,
            y: 0,
            width: (info.width * s).ceil() as u32,
            height: (info.height * s).ceil() as u32,
            layer: Layer::Content,
            thin_lines: false,
            rotate: 0,
            hide_annots: vec![],
            generation: rc_pdf::pool::NEVER_CANCEL,
        };
        let e = wait(&pool, pool.submit(Job::Render(req), 0))?;
        let JobResult::Rendered { timing, .. } = e.result else {
            anyhow::bail!("page {}: {:?}", i + 1, e.result)
        };
        println!(
            "{:4} {:8} {:9.0} {:8.0}",
            i + 1,
            timing.objects,
            timing.parse_ms,
            timing.work_ms
        );
        parse += timing.parse_ms;
        draw += timing.work_ms;
    }
    println!("total parse {:.2} s, draw {:.2} s", parse / 1000.0, draw / 1000.0);
    Ok(())
}

/// Extraction (PDFium worker), scene build, GPU upload and a fit-page tile, per page.
fn scene(file: &str, which: Option<&String>) -> anyhow::Result<()> {
    let pool = pool(1)?;
    let gpu = rc_gpu::Gpu::headless()?;
    eprintln!("GPU: {} ({:?})", gpu.info.name, gpu.info.backend);
    let renderer = rc_gpu::Renderer::new(&gpu.device, &gpu.queue, gpu.sample_count);
    let pages = pages_of(&pool, file, which)?;
    println!("page   segments  parse ms  extract ms  build ms  scene MB  upload ms  tile ms  (2048px fit, 2x ss)");
    let mut scratch = None;
    for (i, info) in pages {
        let e = wait(&pool, pool.submit(Job::Extract { doc: 1, page: i }, 0))?;
        let JobResult::Extracted { content, timing } = e.result else {
            anyhow::bail!("page {}: {:?}", i + 1, e.result)
        };
        let t = Instant::now();
        let scene = rc_scene::build_scene(&content, &Default::default());
        let build = t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let gs = renderer.upload(&gpu.device, &gpu.queue, &scene)?;
        let _ = gpu.device.poll(rc_gpu::wgpu::PollType::Wait {
            submission_index: None,
            timeout: None,
        });
        let upload = t.elapsed().as_secs_f64() * 1000.0;
        let s = 2048.0 / info.width.max(info.height);
        let size = [(info.width * s).ceil() as u32, (info.height * s).ceil() as u32];
        let t = Instant::now();
        let tile = renderer.render_tile(
            &gpu.device,
            &gpu.queue,
            &gs,
            rc_gpu::scale_offset([s, s], [0.0, 0.0]),
            size,
            2,
            false,
            &mut scratch,
        );
        let _ = gpu.device.poll(rc_gpu::wgpu::PollType::Wait {
            submission_index: None,
            timeout: None,
        });
        let tile_ms = t.elapsed().as_secs_f64() * 1000.0;
        drop(tile);
        println!(
            "{:4} {:10} {:9.0} {:11.0} {:9.0} {:9.1} {:10.0} {:8.0}",
            i + 1,
            scene.stats.segments,
            timing.parse_ms,
            timing.work_ms,
            build,
            scene.byte_size() as f64 / 1e6,
            upload,
            tile_ms
        );
    }
    Ok(())
}

/// Our parser against PDFium on the same pages: time to page content, and to a built scene.
fn parse(file: &str, which: Option<&String>) -> anyhow::Result<()> {
    let pool = pool(1)?;
    let pages = pages_of(&pool, file, which)?;
    let t = Instant::now();
    let bytes = std::fs::read(file)?;
    let doc = rc_parse::Document::open(&bytes).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!(
        "opened in {:.1} ms ({} pages)",
        t.elapsed().as_secs_f64() * 1000.0,
        doc.page_count()
    );
    println!(
        "page   segments | PDFium: parse+extract ms  | parser: read ms  chunked ms  | build ms (chunks in parallel)"
    );
    for (i, _) in pages {
        let e = wait(&pool, pool.submit(Job::Extract { doc: 1, page: i }, 0))?;
        let JobResult::Extracted { timing, .. } = e.result else {
            anyhow::bail!("page {}: {:?}", i + 1, e.result)
        };
        let t = Instant::now();
        let content = rc_parse::page_content(&doc, i as usize, &Default::default()).unwrap();
        let read = t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let scene = rc_scene::build_scene(&content, &Default::default());
        let build = t.elapsed().as_secs_f64() * 1000.0;
        // Chunked: scenes built on the pool while the page is still being read.
        let t = Instant::now();
        let (tx, rx) = std::sync::mpsc::channel();
        rayon::scope(|s| {
            rc_parse::page_content_chunked(&doc, i as usize, 50_000, &Default::default(), &mut |chunk| {
                let tx = tx.clone();
                s.spawn(move |_| {
                    let _ = tx.send(rc_scene::build_scene(&chunk, &Default::default()).stats.segments);
                });
            });
        });
        drop(tx);
        let chunk_segs: usize = rx.iter().sum();
        let chunked = t.elapsed().as_secs_f64() * 1000.0;
        println!(
            "{:4} {:10} | {:24.0}  | {:15.0} {:11.0}  | {:8.0} ({} segments)",
            i + 1,
            scene.stats.segments,
            timing.parse_ms + timing.work_ms,
            read,
            chunked,
            build,
            chunk_segs
        );
    }
    Ok(())
}
