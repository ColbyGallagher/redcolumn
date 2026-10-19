//! The fidelity check: speed must never cost correctness.
//!
//! A page's GPU scene is drawn at two views and compared with PDFium's render of the same views:
//! the whole page at 768 px on its long side, and a detailed crop around the scene's densest cell.
//! Pixels whose colour differs by more than 48 levels in any channel count as different, and the
//! page passes when no more than 1% of pixels differ in either view: the same rule the current
//! app uses for its optimised render copy (`packages/pdf-core/src/worker.ts`). A page that fails is
//! drawn by the raster path.

use rc_gpu::{GpuScene, Renderer, wgpu};
use rc_pdf::{Event, Job, JobResult, Layer, Pool, RenderRequest};

/// Long side of the whole-page view, in pixels.
pub const CHECK_PX: u32 = 768;
/// Largest share of differing pixels that still passes.
pub const MAX_DIFF: f32 = 0.01;
/// A channel difference above this counts.
pub const THRESHOLD: u8 = 48;

/// A view to compare: device pixels per point, and the region of the page at that scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub scale: f32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The whole page, and a crop four times closer centred on the densest cell.
pub fn views(size: [f32; 2], densest: [f32; 2]) -> [View; 2] {
    let fit = CHECK_PX as f32 / size[0].max(size[1]).max(1.0);
    let w = (size[0] * fit).round().max(1.0) as u32;
    let h = (size[1] * fit).round().max(1.0) as u32;
    let detail = fit * 4.0;
    let (dw, dh) = (
        CHECK_PX.min((size[0] * detail) as u32).max(1),
        CHECK_PX.min((size[1] * detail) as u32).max(1),
    );
    let cx = (densest[0] * detail - dw as f32 / 2.0).clamp(0.0, (size[0] * detail - dw as f32).max(0.0)) as i32;
    let cy = (densest[1] * detail - dh as f32 / 2.0).clamp(0.0, (size[1] * detail - dh as f32).max(0.0)) as i32;
    [
        View {
            scale: fit,
            x: 0,
            y: 0,
            width: w,
            height: h,
        },
        View {
            scale: detail,
            x: cx,
            y: cy,
            width: dw,
            height: dh,
        },
    ]
}

/// The scale PDFium actually draws a page at for a requested scale: it lays the page out at a
/// whole number of pixels on each side (`FPDF_RenderPageBitmap` with the rounded size).
pub fn pdfium_scale(size: [f32; 2], scale: f32) -> [f32; 2] {
    let sx = (size[0] * scale).round().max(1.0) / size[0].max(1e-3);
    let sy = (size[1] * scale).round().max(1.0) / size[1].max(1e-3);
    [sx, sy]
}

/// The centre of the cell with the most geometry.
pub fn densest_point(scene: &rc_scene::Scene) -> [f32; 2] {
    let best = (0..scene.seg_cells.len())
        .max_by_key(|&i| scene.seg_cells[i][1] as u64 * 2 + scene.fill_cells.get(i).map_or(0, |c| c[1] as u64))
        .unwrap_or(0);
    scene.cell_center(best as u32)
}

/// Share of pixels (RGBA rows, same size) whose colour differs by more than [`THRESHOLD`].
pub fn diff(a: &[u8], b: &[u8]) -> f32 {
    assert_eq!(a.len(), b.len());
    let n = a.len() / 4;
    if n == 0 {
        return 0.0;
    }
    let differ = a
        .chunks_exact(4)
        .zip(b.chunks_exact(4))
        .filter(|(p, q)| (0..3).any(|c| p[c].abs_diff(q[c]) > THRESHOLD))
        .count();
    differ as f32 / n as f32
}

/// Draws straight-alpha `over` on top of opaque `under`, in place.
pub fn composite(under: &mut [u8], over: &[u8]) {
    for (u, o) in under.chunks_exact_mut(4).zip(over.chunks_exact(4)) {
        let a = o[3] as u32;
        if a == 0 {
            continue;
        }
        for c in 0..3 {
            u[c] = ((o[c] as u32 * a + u[c] as u32 * (255 - a) + 127) / 255) as u8;
        }
    }
}

/// How many times the resolution the scene's tiles are drawn at before filtering down (the
/// view draws pages the same way).
pub const SUPERSAMPLE: u32 = 2;

/// Draws a scene on white for one view the way the view does: as a supersampled tile.
pub fn draw_scene(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    renderer: &Renderer,
    scene: &GpuScene,
    v: View,
) -> Vec<u8> {
    let mut scratch = None;
    let tile = renderer.render_tile(
        device,
        queue,
        scene,
        rc_gpu::scale_offset(pdfium_scale(scene.size, v.scale), [-v.x as f32, -v.y as f32]),
        [v.width, v.height],
        SUPERSAMPLE,
        false,
        &mut scratch,
    );
    rc_gpu::read_texture(device, queue, &tile.texture, v.width, v.height)
}

/// Averages `f` × `f` blocks of RGBA pixels.
pub fn box_down(px: &[u8], w: u32, h: u32, f: u32) -> Vec<u8> {
    let (nw, nh) = (w / f, h / f);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for y in 0..nh {
        for x in 0..nw {
            for c in 0..4 {
                let mut acc = 0u32;
                for dy in 0..f {
                    for dx in 0..f {
                        acc += px[(((y * f + dy) * w + x * f + dx) * 4 + c) as usize] as u32;
                    }
                }
                out[((y * nw + x) * 4 + c) as usize] = ((acc + f * f / 2) / (f * f)) as u8;
            }
        }
    }
    out
}

/// The render request for a view of a page.
pub fn request(doc: u32, page: u32, v: View, layer: Layer, hide_annots: Vec<u32>) -> RenderRequest {
    RenderRequest {
        doc,
        page,
        scale: v.scale,
        x: v.x,
        y: v.y,
        width: v.width,
        height: v.height,
        layer,
        thin_lines: false,
        rotate: 0,
        hide_annots,
        generation: rc_pdf::pool::NEVER_CANCEL,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Verdict {
    pub ok: bool,
    /// Share of differing pixels in each view.
    pub diffs: [f32; 2],
}

/// Compares GPU images (with PDFium's overlay already composited where the scene needs one)
/// against PDFium's references.
pub fn judge(gpu: [&[u8]; 2], reference: [&[u8]; 2]) -> Verdict {
    let diffs = [diff(gpu[0], reference[0]), diff(gpu[1], reference[1])];
    Verdict {
        ok: diffs.iter().all(|&d| d <= MAX_DIFF),
        diffs,
    }
}

/// Runs the whole check for one page, blocking on the pool (for tools and tests; the app runs
/// the same steps without blocking). `with_text` composites PDFium's text layer over the scene.
pub fn check_blocking(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    renderer: &Renderer,
    pool: &Pool,
    doc: u32,
    page: u32,
    scene: &rc_scene::Scene,
    gpu_scene: &GpuScene,
) -> anyhow::Result<(Verdict, [Vec<u8>; 2], [Vec<u8>; 2])> {
    let vs = views(scene.size, densest_point(scene));
    let with_text = scene.flags & rc_scene::content::flags::TEXT_NOT_EXTRACTED != 0;
    let mut refs: Vec<Vec<u8>> = Vec::new();
    let mut gpus: Vec<Vec<u8>> = Vec::new();
    for v in vs {
        let r = wait(
            pool,
            pool.submit(Job::Render(request(doc, page, v, Layer::Full, vec![])), 0),
        )?;
        let mut g = draw_scene(device, queue, renderer, gpu_scene, v);
        // The overlay carries annotations (and text when the scene has none), as on screen.
        let overlay = wait(
            pool,
            pool.submit(
                Job::Render(request(doc, page, v, Layer::Overlay { text: with_text }, vec![])),
                0,
            ),
        )?;
        composite(&mut g, &overlay);
        refs.push(r);
        gpus.push(g);
    }
    let verdict = judge([&gpus[0], &gpus[1]], [&refs[0], &refs[1]]);
    let [g0, g1]: [Vec<u8>; 2] = gpus.try_into().unwrap();
    let [r0, r1]: [Vec<u8>; 2] = refs.try_into().unwrap();
    Ok((verdict, [g0, g1], [r0, r1]))
}

fn wait(pool: &Pool, id: u64) -> anyhow::Result<Vec<u8>> {
    loop {
        let e: Event = pool.events().recv_timeout(std::time::Duration::from_secs(120))?;
        if e.id != id {
            continue;
        }
        return match e.result {
            JobResult::Rendered { rgba, .. } => Ok(rgba),
            other => anyhow::bail!("render failed: {other:?}"),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_counts_only_large_differences() {
        let a = [10u8, 10, 10, 255, 200, 200, 200, 255];
        let b = [50u8, 10, 10, 255, 100, 200, 200, 255];
        assert_eq!(diff(&a, &b), 0.5);
    }

    #[test]
    fn views_fit_and_stay_on_the_page() {
        let [fit, detail] = views([1000.0, 500.0], [990.0, 490.0]);
        assert_eq!((fit.width, fit.height), (768, 384));
        assert!(detail.x as u32 + detail.width <= (1000.0 * detail.scale) as u32 + 1);
        assert!(detail.y as u32 + detail.height <= (500.0 * detail.scale) as u32 + 1);
    }
}
