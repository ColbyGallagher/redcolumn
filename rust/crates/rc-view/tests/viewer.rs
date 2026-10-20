//! The viewer end to end, headless: open a drawing, draw frames until it is sharp, check that its
//! pages came from scenes that passed the fidelity check, zoom and rotate, then open it again and
//! see the scenes come from the disk cache.
//!
//! The test binary doubles as a PDFium worker (as the app does).

use rc_bench::drawing::{GenOptions, generate};
use rc_gpu::Gpu;
use rc_pdf::PoolOptions;
use rc_view::layout::Mode;
use rc_view::viewer::{Engine, GpuCtx, PageMode, Source, Verdict, Viewer, ViewerOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn pdfium() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/pdfium");
    if cfg!(windows) {
        dir.join("win-x64/bin/pdfium.dll")
    } else {
        dir.join("linux-x64/lib/libpdfium.so")
    }
}

fn opts_for(cache: &Path) -> ViewerOptions {
    let mut opts = ViewerOptions::new(PoolOptions {
        workers: 2,
        program: std::env::current_exe().unwrap(),
        args: vec!["--rc-pdfium-worker".into()],
        pdfium: pdfium(),
    });
    opts.cache_root = cache.to_path_buf();
    opts
}

/// Draws frames until nothing is pending (or the time runs out). Returns the frame count.
fn settle(v: &mut Viewer, what: &str) -> usize {
    let t = Instant::now();
    let mut frames = 0;
    loop {
        v.update();
        let (_, more) = v.render(1280, 800);
        frames += 1;
        if !more {
            return frames;
        }
        assert!(
            t.elapsed() < Duration::from_secs(120),
            "{what}: not settled after 120 s ({:?})",
            v.diag
        );
        std::thread::sleep(Duration::from_millis(5));
    }
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
            eprintln!("viewer: no GPU adapter, skipping ({e})");
            return;
        }
    };
    let tmp = std::env::temp_dir().join(format!("rc-viewer-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let path = tmp.join("sheet.pdf");
    std::fs::write(
        &path,
        generate(&GenOptions {
            segments: 50_000,
            pages: 3,
            ..Default::default()
        }),
    )
    .unwrap();
    // These first runs test the engines themselves; on a software GPU the speed gate would
    // (rightly) send the page to PDFium, so it is tested on its own below.
    let mut opts = opts_for(&tmp.join("cache"));
    opts.speed_gate = false;
    let ctx = GpuCtx {
        device: gpu.device.clone(),
        queue: gpu.queue.clone(),
        sample_count: gpu.sample_count,
        software: false,
    };
    let mut v = Viewer::new(ctx.clone(), opts).unwrap();

    v.open(&path).unwrap();
    let frames = settle(&mut v, "open");
    assert_eq!(v.page_count(), 3);
    let info = v.page_info(0).unwrap().clone();
    assert_eq!(info.mode, PageMode::Scene, "{info:?}");
    assert_eq!(info.source, Some(Source::Parser));
    assert_eq!(info.verdict, Verdict::Pass, "{info:?}");
    assert_eq!(info.engine, Some(Engine::Gpu));
    let events: Vec<_> = v.take_events().into_iter().map(|e| e.0).collect();
    assert!(
        events.contains(&"first-paint") && events.contains(&"page-sharp"),
        "{events:?}"
    );
    eprintln!("viewer: open settled in {frames} frames, page 0 {:?}", info.stats);

    // The frame itself: the page is drawn (not all background).
    let rgba = v.render(1280, 800).0.read_rgba(&gpu.device, &gpu.queue);
    let white = rgba
        .chunks(4)
        .filter(|p| p[0] > 240 && p[1] > 240 && p[2] > 240)
        .count();
    assert!(white > 1280 * 800 / 10, "page not drawn ({white} white pixels)");

    // Zoom in on the centre, scroll, rotate, switch layout, go to a page.
    v.zoom_at(8.0, [640.0, 400.0]);
    settle(&mut v, "zoom");
    v.scroll_by(300.0, 200.0);
    settle(&mut v, "scroll");
    v.rotate(1);
    settle(&mut v, "rotate");
    v.set_mode(Mode::Single);
    v.go_to_page(2);
    settle(&mut v, "page 3");
    assert_eq!(v.current_page(), 2);
    let layers = v.layers();
    if let Some(l) = layers.first() {
        v.set_layer_visible(l, false);
        settle(&mut v, "layer");
        assert!(!v.layer_visible(l));
    }
    // A point maps to the page and back.
    let (page, pt) = v.screen_to_page([640.0, 400.0]).expect("centre is on a page");
    let back = rc_view::layout::apply(&v.page_to_screen(page), pt);
    assert!(
        (back[0] - 640.0).abs() < 0.01 && (back[1] - 400.0).abs() < 0.01,
        "{back:?}"
    );

    // Open again: scenes and verdicts come from the disk cache.
    v.close();
    v.rotate(-1);
    v.set_mode(Mode::Continuous);
    v.open(&path).unwrap();
    settle(&mut v, "reopen");
    let info = v.page_info(0).unwrap();
    assert_eq!(info.source, Some(Source::Cache), "{info:?}");
    assert_eq!(info.verdict, Verdict::Pass);

    // Saving: the file is let go of and opened again.
    let p = v.prepare_save().unwrap();
    assert_eq!(p, path);
    v.reopen().unwrap();
    settle(&mut v, "after save");
    v.close();
    drop(v);

    // The CPU engine (what software GPUs use): tiles drawn on the rayon pool, checked against
    // PDFium the same way.
    let mut cpu_opts = opts_for(&tmp.join("cache-cpu"));
    cpu_opts.engine = Engine::Cpu;
    cpu_opts.speed_gate = false;
    let mut v = Viewer::new(ctx.clone(), cpu_opts).unwrap();
    v.open(&path).unwrap();
    settle(&mut v, "cpu open");
    let info = v.page_info(0).unwrap().clone();
    assert_eq!(info.mode, PageMode::Scene, "{info:?}");
    assert_eq!(info.engine, Some(Engine::Cpu));
    assert_eq!(info.verdict, Verdict::Pass, "{info:?}");
    assert!(info.stats.tiles_timed > 0, "CPU tiles are timed: {:?}", info.stats);
    let rgba = v.render(1280, 800).0.read_rgba(&gpu.device, &gpu.queue);
    let dark = rgba.chunks(4).filter(|p| p[0] < 128).count();
    assert!(dark > 1000, "CPU tiles drew the drawing ({dark} dark pixels)");
    eprintln!(
        "viewer: CPU engine, page 0 tile {:.1} ms (median of {}), PDFium page {:?} ms",
        info.stats.tile_ms, info.stats.tiles_timed, info.stats.pdfium_ms
    );
    v.close();
    drop(v);

    // The speed gate, made to fire: any scene tile slower than nothing sends the page to PDFium,
    // and the disk cache remembers it on the next open.
    let mut gate_opts = opts_for(&tmp.join("cache-gate"));
    gate_opts.gate_factor = 0.0;
    gate_opts.gate_floor_ms = 0.0;
    gate_opts.gate_samples = 1;
    gate_opts.check = false;
    let mut v = Viewer::new(ctx.clone(), gate_opts).unwrap();
    v.open(&path).unwrap();
    settle(&mut v, "gate open");
    let info = v.page_info(0).unwrap().clone();
    assert_eq!(info.mode, PageMode::Raster, "{info:?}");
    assert!(info.gate.is_some(), "{info:?}");
    eprintln!("viewer: speed gate: {}", info.gate.as_ref().unwrap());
    v.close();
    v.open(&path).unwrap();
    settle(&mut v, "gate reopen");
    let info = v.page_info(0).unwrap().clone();
    assert_eq!(info.mode, PageMode::Raster, "{info:?}");
    assert!(
        info.gate.is_some() && info.stats.tiles_timed == 0,
        "cached, with no scene drawn: {info:?}"
    );
    v.close();
    let _ = std::fs::remove_dir_all(&tmp);
    eprintln!("viewer: ok");
}
