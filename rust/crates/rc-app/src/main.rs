//! redcolumn for heavy drawings: the desktop viewer.
//!
//! `redcolumn-rs [FILE]` opens the viewer. `redcolumn-rs --bench FILE [--bench-out OUT.jsonl]`
//! opens FILE, waits until it is sharp, zooms in and pans, writes timing events as JSON lines
//! and exits (for comparing with the current app). The same executable runs as a PDFium worker
//! with `--rc-pdfium-worker`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod settings;

use std::path::PathBuf;
use std::sync::Arc;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--rc-pdfium-worker") {
        return rc_pdf::worker::main_from_args(args.into_iter().skip(1));
    }
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn".into()))
        .with_writer(std::io::stderr)
        .init();
    let mut file = None;
    let mut bench = None;
    let mut bench_out = None;
    let mut it = args.iter().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--bench" => bench = it.next().map(PathBuf::from),
            "--bench-out" => bench_out = it.next().map(PathBuf::from),
            _ if !a.starts_with("--") => file = Some(PathBuf::from(a)),
            _ => {}
        }
    }
    let bench = bench.map(|f| app::BenchSpec {
        file: f,
        out: bench_out,
    });
    let mut options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("redcolumn")
            .with_inner_size([1440.0, 900.0])
            .with_min_inner_size([480.0, 320.0])
            .with_drag_and_drop(true),
        renderer: eframe::Renderer::Wgpu,
        // The canvas is ours; egui needs neither depth nor multisampling.
        depth_buffer: 0,
        multisampling: 0,
        ..Default::default()
    };
    // The renderer sizes its buffers from the adapter's own limits (a 3 million segment sheet
    // needs more than the portable defaults allow).
    if let eframe::egui_wgpu::WgpuSetup::CreateNew(setup) = &mut options.wgpu_options.wgpu_setup {
        setup.device_descriptor = Arc::new(|adapter| eframe::egui_wgpu::wgpu::DeviceDescriptor {
            label: Some("redcolumn"),
            required_limits: adapter.limits(),
            ..Default::default()
        });
    }
    eframe::run_native(
        "redcolumn",
        options,
        Box::new(move |cc| Ok(Box::new(app::App::new(cc, file, bench)?))),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))
}
