//! Opens a file in a headless viewer and prints, frame by frame, what is still pending until the
//! view is sharp. `cargo run --release -p rc-view --example trace -- FILE [cpu|gpu]`
use rc_view::viewer::{Engine, GpuCtx, Viewer, ViewerOptions};
use std::time::{Duration, Instant};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--rc-pdfium-worker") {
        rc_pdf::worker::main_from_args(args.into_iter().skip(1)).unwrap();
        return;
    }
    let gpu = rc_gpu::Gpu::headless().unwrap();
    let ctx = GpuCtx {
        device: gpu.device.clone(),
        queue: gpu.queue.clone(),
        sample_count: gpu.sample_count,
        software: false,
    };
    let mut opts = ViewerOptions::new(rc_pdf::PoolOptions::current_exe(8).unwrap());
    opts.engine = if args.get(2).map(String::as_str) == Some("gpu") {
        Engine::Gpu
    } else {
        Engine::Cpu
    };
    opts.cache = std::env::var_os("TRACE_CACHE").is_some();
    let mut v = Viewer::new(ctx, opts).unwrap();
    let t = Instant::now();
    v.open(std::path::Path::new(&args[1])).unwrap();
    let mut last = String::new();
    loop {
        v.update();
        let (_, more) = v.render(1280, 800);
        let d = &v.diag;
        let i = v.page_info(0).unwrap();
        let line = format!(
            "missing {} raster_pending {} tiles {} | p0 {:?} {:?} tiles timed {} overlays {} ({:.0} ms) text layer {} annots {}",
            d.missing,
            d.raster_pending,
            d.tiles_cached,
            i.mode,
            i.verdict,
            i.stats.tiles_timed,
            i.stats.overlays_timed,
            i.stats.overlay_ms,
            i.lacks_text,
            i.annots.len()
        );
        for (e, ms) in v.take_events() {
            println!("{:>7.0} ms  EVENT {e} ({ms:.0})", t.elapsed().as_secs_f64() * 1000.0);
        }
        if line != last {
            println!("{:>7.0} ms  {line}", t.elapsed().as_secs_f64() * 1000.0);
            last = line;
        }
        if !more {
            break;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}
