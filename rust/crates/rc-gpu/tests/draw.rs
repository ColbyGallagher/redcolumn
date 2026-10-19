//! Draws small scenes off screen and checks the pixels.

use rc_gpu::*;
use rc_scene::content::{ContentBuilder, Item, NONE, fill, rgba};
use rc_scene::{SceneOptions, build_scene};

fn gpu() -> Option<Gpu> {
    match Gpu::headless() {
        Ok(g) => Some(g),
        Err(e) => {
            eprintln!("no GPU adapter, skipping: {e}");
            None
        }
    }
}

fn render(gpu: &Gpu, scene: &rc_scene::Scene, scale: f32, w: u32, h: u32) -> Vec<u8> {
    let mut r = Renderer::new(&gpu.device, &gpu.queue, gpu.sample_count);
    let gs = r.upload(&gpu.device, &gpu.queue, scene).unwrap();
    let target = Target::new(&gpu.device, w, h, gpu.sample_count);
    let mut enc = gpu.device.create_command_encoder(&Default::default());
    r.draw(
        &gpu.device,
        &gpu.queue,
        &mut enc,
        &target,
        wgpu::Color::WHITE,
        &[Draw::Scene { scene: &gs, transform: scale_offset([scale, scale], [0.0, 0.0]), clip: [0.0, 0.0, w as f32, h as f32], alpha: 1.0, thin: false, hairline: 1.0 }],
    );
    gpu.queue.submit([enc.finish()]);
    target.read_rgba(&gpu.device, &gpu.queue)
}

fn px(img: &[u8], w: u32, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * w + x) * 4) as usize;
    [img[i], img[i + 1], img[i + 2], img[i + 3]]
}

#[test]
fn strokes_fills_and_paint_order() {
    let Some(gpu) = gpu() else { return };
    let mut b = ContentBuilder::new([200.0, 200.0]);
    // A blue square, then a red line over it, then a green square over part of the line.
    let s = b.begin_path();
    b.move_to([20.0, 20.0]);
    b.line_to([120.0, 20.0]);
    b.line_to([120.0, 120.0]);
    b.line_to([20.0, 120.0]);
    b.close();
    b.finish_path(s, Item { fill_rule: fill::NONZERO, fill_color: rgba(0, 0, 255, 255), clip: NONE, layer: NONE, ..Default::default() });
    let s = b.begin_path();
    b.move_to([10.0, 70.0]);
    b.line_to([190.0, 70.0]);
    b.finish_path(s, Item { stroked: 1, width: 4.0, stroke_color: rgba(255, 0, 0, 255), join: 1, clip: NONE, layer: NONE, miter_limit: 10.0, ..Default::default() });
    let s = b.begin_path();
    b.move_to([100.0, 60.0]);
    b.line_to([180.0, 60.0]);
    b.line_to([180.0, 100.0]);
    b.line_to([100.0, 100.0]);
    b.close();
    b.finish_path(s, Item { fill_rule: fill::NONZERO, fill_color: rgba(0, 255, 0, 255), clip: NONE, layer: NONE, ..Default::default() });
    let scene = build_scene(&b.finish(), &SceneOptions::default());
    let img = render(&gpu, &scene, 1.0, 200, 200);
    assert_eq!(px(&img, 200, 5, 5), [255, 255, 255, 255], "background");
    assert_eq!(px(&img, 200, 40, 40), [0, 0, 255, 255], "blue fill");
    assert_eq!(px(&img, 200, 50, 70), [255, 0, 0, 255], "red line over blue");
    assert_eq!(px(&img, 200, 150, 70), [0, 255, 0, 255], "green over red");
    assert_eq!(px(&img, 200, 185, 70), [255, 0, 0, 255], "red past green");
}

#[test]
fn hairlines_are_one_pixel_and_layers_hide() {
    let Some(gpu) = gpu() else { return };
    let mut b = ContentBuilder::new([100.0, 100.0]);
    let layer = b.layer("HIDE-ME");
    let s = b.begin_path();
    b.move_to([0.0, 50.5]);
    b.line_to([100.0, 50.5]);
    b.finish_path(s, Item { stroked: 1, width: 0.0, stroke_color: rgba(0, 0, 0, 255), clip: NONE, layer: NONE, miter_limit: 10.0, ..Default::default() });
    let s = b.begin_path();
    b.move_to([50.5, 0.0]);
    b.line_to([50.5, 100.0]);
    b.finish_path(s, Item { stroked: 1, width: 0.0, stroke_color: rgba(0, 0, 0, 255), clip: NONE, layer, miter_limit: 10.0, ..Default::default() });
    let scene = build_scene(&b.finish(), &SceneOptions::default());
    let mut r = Renderer::new(&gpu.device, &gpu.queue, gpu.sample_count);
    let mut gs = r.upload(&gpu.device, &gpu.queue, &scene).unwrap();
    let draw = |r: &mut Renderer, gs: &GpuScene| {
        let target = Target::new(&gpu.device, 100, 100, gpu.sample_count);
        let mut enc = gpu.device.create_command_encoder(&Default::default());
        r.draw(&gpu.device, &gpu.queue, &mut enc, &target, wgpu::Color::WHITE, &[Draw::Scene {
            scene: gs,
            transform: scale_offset([1.0, 1.0], [0.0, 0.0]),
            clip: [0.0, 0.0, 100.0, 100.0],
            alpha: 1.0,
            thin: false,
            hairline: 1.0,
        }]);
        gpu.queue.submit([enc.finish()]);
        target.read_rgba(&gpu.device, &gpu.queue)
    };
    let img = draw(&mut r, &gs);
    // A hairline centred on a pixel row covers that row and not its neighbours.
    assert!(px(&img, 100, 20, 50)[0] < 30);
    assert!(px(&img, 100, 20, 48)[0] > 225);
    assert!(px(&img, 100, 50, 20)[0] < 30, "vertical line on its layer");
    gs.set_layer_visible(&gpu.queue, 0, false);
    let img = draw(&mut r, &gs);
    assert!(px(&img, 100, 50, 20)[0] > 225, "hidden layer");
}
