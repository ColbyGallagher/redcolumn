//! Draws pages with wgpu: GPU scenes (see `rc_scene::scene`), raster tiles from PDFium, overview
//! tiles and images.
//!
//! - Opaque scene geometry is drawn with depth from its paint order, so cells can be culled and
//!   drawn in any order and still overlap exactly as the PDF paints them.
//! - Transparent geometry and images are drawn after, in paint order.
//! - Edges are smoothed with MSAA (4× where the adapter supports it). Round caps and joins use
//!   coverage from a distance field so they stay round at any zoom; thin lines write their exact
//!   coverage as a sample mask.
//! - Textured quads (tiles, overlays) have no depth: those listed before a scene sit under it,
//!   those after sit over it.

use bytemuck::{Pod, Zeroable};
use rc_scene::clip::Rect;
use rc_scene::scene::{FillVert, ImageVert, Scene, SceneImage, StreamEntry, StrokeSeg, stream};
use std::ops::Range;
use wgpu::util::DeviceExt;

pub use wgpu;

/// The format pages are drawn in: 8-bit RGBA, blended in gamma space as PDF renderers do.
pub const COLOR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// A device and queue, with what the renderer needs to know about the adapter.
pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub info: wgpu::AdapterInfo,
    pub sample_count: u32,
}

impl Gpu {
    /// A device for drawing off screen (tests, tools, benchmarks). Uses the adapter's own limits,
    /// so large scenes fit in as few buffers as the hardware allows.
    pub fn headless() -> anyhow::Result<Gpu> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            apply_limit_buckets: false,
        }))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("redcolumn headless"),
            required_limits: adapter.limits(),
            ..Default::default()
        }))?;
        Ok(Gpu { sample_count: sample_count(&adapter), info: adapter.get_info(), device, queue })
    }

    /// Whether the adapter draws in software (WARP, llvmpipe, lavapipe, SwiftShader). The view
    /// uses the raster path only on these.
    pub fn is_software(&self) -> bool {
        is_software(&self.info)
    }
}

pub fn is_software(info: &wgpu::AdapterInfo) -> bool {
    info.device_type == wgpu::DeviceType::Cpu
        || ["llvmpipe", "lavapipe", "swiftshader", "microsoft basic render"]
            .iter()
            .any(|n| info.name.to_lowercase().contains(n))
}

/// MSAA samples to use: 4 when the adapter supports it for our formats, else 1.
pub fn sample_count(adapter: &wgpu::Adapter) -> u32 {
    let c = adapter.get_texture_format_features(COLOR_FORMAT);
    let d = adapter.get_texture_format_features(DEPTH_FORMAT);
    if c.flags.sample_count_supported(4) && d.flags.sample_count_supported(4) { 4 } else { 1 }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
struct ViewUniform {
    m: [f32; 4],
    t: [f32; 2],
    target_size: [f32; 2],
    hairline: f32,
    cols: u32,
    thin: u32,
    alpha: f32,
    samples: u32,
    scale: f32,
    _pad: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
struct QuadUniform {
    dest: [f32; 4],
    uv: [f32; 4],
    target_size: [f32; 2],
    opacity: f32,
    flags: u32,
    _pad: [f32; 4],
}

const UNIFORM_SIZE: u64 = 64;

/// A texture the renderer can draw as a quad.
pub struct GpuTexture {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    bind_group: wgpu::BindGroup,
    pub width: u32,
    pub height: u32,
}

/// A slice of a scene's segments in one storage buffer (a scene larger than the device's binding
/// limit is split across several).
struct SegChunk {
    bind_group: wgpu::BindGroup,
    range: Range<u32>,
}

/// A scene on the GPU, plus the CPU-side index the renderer culls with.
pub struct GpuScene {
    pub size: [f32; 2],
    pub cols: u32,
    pub rows: u32,
    seg_cells: Vec<[u32; 2]>,
    seg_cell_bounds: Vec<Rect>,
    fill_cells: Vec<[u32; 2]>,
    fill_cell_bounds: Vec<Rect>,
    stream: Vec<StreamEntry>,
    /// Half the widest stroke (points), for culling.
    reach: f32,
    layers: wgpu::Buffer,
    layer_bits: Vec<u32>,
    pub layer_names: Vec<String>,
    seg_chunks: Vec<SegChunk>,
    t_seg_chunks: Vec<SegChunk>,
    /// Bind group for fills and images (items and layers; any segment buffer).
    base_group: wgpu::BindGroup,
    fill_vb: Option<wgpu::Buffer>,
    fill_ib: Option<wgpu::Buffer>,
    t_fill_ib: Option<wgpu::Buffer>,
    image_vb: Option<wgpu::Buffer>,
    image_ib: Option<wgpu::Buffer>,
    images: Vec<GpuTexture>,
    /// Bytes on the GPU.
    pub bytes: u64,
    pub segments: usize,
    pub triangles: usize,
}

impl GpuScene {
    /// Shows or hides a layer (takes effect on the next draw).
    pub fn set_layer_visible(&mut self, queue: &wgpu::Queue, layer: usize, visible: bool) {
        let (w, b) = (layer / 32, layer % 32);
        if w >= self.layer_bits.len() {
            return;
        }
        if visible {
            self.layer_bits[w] |= 1 << b;
        } else {
            self.layer_bits[w] &= !(1 << b);
        }
        queue.write_buffer(&self.layers, 0, bytemuck::cast_slice(&self.layer_bits));
    }

    pub fn layer_visible(&self, layer: usize) -> bool {
        self.layer_bits.get(layer / 32).is_some_and(|w| w >> (layer % 32) & 1 == 1)
    }

    /// Opaque segments and triangles in cells overlapping `r` (page space): the cost of drawing
    /// that view directly.
    pub fn visible_cost(&self, r: Rect) -> (u64, u64) {
        let (mut s, mut t) = (0u64, 0u64);
        let m = self.reach;
        let rr = [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
        for (i, b) in self.seg_cell_bounds.iter().enumerate() {
            if rc_scene::clip::rect_overlaps(*b, rr) {
                s += self.seg_cells[i][1] as u64;
            }
        }
        for (i, b) in self.fill_cell_bounds.iter().enumerate() {
            if rc_scene::clip::rect_overlaps(*b, r) {
                t += self.fill_cells[i][1] as u64 / 3;
            }
        }
        (s, t)
    }
}

/// Where a frame is drawn: a multisampled colour and depth buffer, resolved into a texture that
/// can be shown (as an egui texture), drawn as a tile, or read back.
pub struct Target {
    pub width: u32,
    pub height: u32,
    msaa: Option<wgpu::TextureView>,
    depth: wgpu::TextureView,
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    /// The same texture viewed as sRGB, for compositors that work in linear light (egui).
    pub srgb_view: wgpu::TextureView,
}

impl Target {
    pub fn new(device: &wgpu::Device, width: u32, height: u32, sample_count: u32) -> Self {
        let size = wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("target"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[wgpu::TextureFormat::Rgba8UnormSrgb],
        });
        let view = texture.create_view(&Default::default());
        let srgb_view = texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(wgpu::TextureFormat::Rgba8UnormSrgb),
            ..Default::default()
        });
        let msaa = (sample_count > 1).then(|| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some("target msaa"),
                    size,
                    mip_level_count: 1,
                    sample_count,
                    dimension: wgpu::TextureDimension::D2,
                    format: COLOR_FORMAT,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        });
        let depth = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("target depth"),
                size,
                mip_level_count: 1,
                sample_count,
                dimension: wgpu::TextureDimension::D2,
                format: DEPTH_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&Default::default());
        Target { width: size.width, height: size.height, msaa, depth, texture, view, srgb_view }
    }

    /// Copies the target back as RGBA rows (for tests, thumbnails and the fidelity check).
    pub fn read_rgba(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> Vec<u8> {
        read_texture(device, queue, &self.texture, self.width, self.height)
    }
}

pub fn read_texture(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture, width: u32, height: u32) -> Vec<u8> {
    let row = (width * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (row * height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) },
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    queue.submit([enc.finish()]);
    let slice = buffer.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    let _ = device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
    let data = slice.get_mapped_range().expect("readback buffer is mapped");
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        let s = (y * row) as usize;
        out.extend_from_slice(&data[s..s + (width * 4) as usize]);
    }
    drop(data);
    buffer.unmap();
    out
}

/// One thing to draw, in order.
pub enum Draw<'a> {
    /// A page's scene. `clip` is the part of the target it may draw in (pixels), usually the
    /// page's visible area.
    /// `transform` maps page space to target pixels (zoom, scroll, rotation). `hairline` is the
    /// thinnest stroke in target pixels: 1 on screen, more when drawing a supersampled tile that
    /// is filtered down.
    Scene { scene: &'a GpuScene, transform: Affine2, clip: [f32; 4], alpha: f32, thin: bool, hairline: f32 },
    /// A texture drawn into `dest` (pixels), showing `uv` of it, with a page filter.
    Quad { texture: &'a GpuTexture, dest: [f32; 4], uv: [f32; 4], opacity: f32, straight: bool, filter: PageFilter },
}

/// A 2 × 3 affine transform `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f.
pub type Affine2 = [f32; 6];

/// Scale and offset, without rotation.
pub fn scale_offset(scale: [f32; 2], offset: [f32; 2]) -> Affine2 {
    [scale[0], 0.0, 0.0, scale[1], offset[0], offset[1]]
}

fn affine_scale(m: &Affine2) -> f32 {
    (m[0] * m[3] - m[1] * m[2]).abs().sqrt()
}

fn affine_invert(m: &Affine2) -> Option<Affine2> {
    let det = m[0] * m[3] - m[1] * m[2];
    if det.abs() < 1e-20 {
        return None;
    }
    let (a, b, c, d) = (m[3] / det, -m[1] / det, -m[2] / det, m[0] / det);
    Some([a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])])
}

fn affine_apply(m: &Affine2, x: f32, y: f32) -> [f32; 2] {
    [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/// How pages are coloured on screen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PageFilter {
    #[default]
    None,
    /// Inverted with hues kept, for night work.
    Dark,
    Dim,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DrawStats {
    pub segments: u64,
    pub triangles: u64,
    pub draw_calls: u32,
}

pub struct Renderer {
    pub sample_count: u32,
    uniform_bgl: wgpu::BindGroupLayout,
    scene_bgl: wgpu::BindGroupLayout,
    tex_bgl: wgpu::BindGroupLayout,
    stroke: wgpu::RenderPipeline,
    stroke_t: wgpu::RenderPipeline,
    fill: wgpu::RenderPipeline,
    fill_t: wgpu::RenderPipeline,
    image: wgpu::RenderPipeline,
    quad: wgpu::RenderPipeline,
    /// Filters a supersampled tile down (one sample, no depth).
    down: wgpu::RenderPipeline,
    down_uniforms: wgpu::Buffer,
    down_group: wgpu::BindGroup,
    pub sampler: wgpu::Sampler,
    uniforms: wgpu::Buffer,
    uniform_group: wgpu::BindGroup,
    align: u64,
    max_binding: u64,
    max_buffer: u64,
    white: GpuTexture,
}

fn storage(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::VERTEX,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only: true },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

impl Renderer {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, sample_count: u32) -> Self {
        let uniform_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("uniforms"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(UNIFORM_SIZE),
                },
                count: None,
            }],
        });
        let scene_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene"),
            entries: &[storage(0), storage(1), storage(2)],
        });
        let tex_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("texture"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let scene_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("scene.wgsl").into()),
        });
        let quad_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("quad.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("quad.wgsl").into()),
        });
        let scene_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene"),
            bind_group_layouts: &[Some(&uniform_bgl), Some(&scene_bgl)],
            immediate_size: 0,
        });
        let image_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("image"),
            bind_group_layouts: &[Some(&uniform_bgl), Some(&scene_bgl), Some(&tex_bgl)],
            immediate_size: 0,
        });
        let quad_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("quad"),
            bind_group_layouts: &[Some(&uniform_bgl), Some(&tex_bgl)],
            immediate_size: 0,
        });
        let premul = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation: wgpu::BlendOperation::Add,
            },
        };
        let depth = |write: bool, compare: wgpu::CompareFunction| wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: Some(write),
            depth_compare: Some(compare),
            stencil: Default::default(),
            bias: Default::default(),
        };
        let fill_layout = wgpu::VertexBufferLayout {
            array_stride: size_of::<FillVert>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Uint32],
        };
        let image_vlayout = wgpu::VertexBufferLayout {
            array_stride: size_of::<ImageVert>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Uint32],
        };
        let make = |label: &str,
                    layout: &wgpu::PipelineLayout,
                    module: &wgpu::ShaderModule,
                    vs: &str,
                    fs: &str,
                    buffers: &[Option<wgpu::VertexBufferLayout>],
                    blend: Option<wgpu::BlendState>,
                    depth_state: wgpu::DepthStencilState,
                    a2c: bool| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(layout),
                vertex: wgpu::VertexState { module, entry_point: Some(vs), compilation_options: Default::default(), buffers },
                primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleList, ..Default::default() },
                depth_stencil: Some(depth_state),
                multisample: wgpu::MultisampleState {
                    count: sample_count,
                    mask: !0,
                    alpha_to_coverage_enabled: a2c && sample_count > 1,
                },
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend, write_mask: wgpu::ColorWrites::ALL })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        use wgpu::CompareFunction::{Always, Less};
        let stroke = make("stroke", &scene_layout, &scene_module, "stroke_vs", "stroke_fs", &[], None, depth(true, Less), false);
        let stroke_t =
            make("stroke_t", &scene_layout, &scene_module, "stroke_vs", "stroke_fs_t", &[], Some(premul), depth(true, Less), false);
        let fill = make("fill", &scene_layout, &scene_module, "fill_vs", "fill_fs", &[Some(fill_layout.clone())], None, depth(true, Less), false);
        let fill_t =
            make("fill_t", &scene_layout, &scene_module, "fill_vs", "fill_fs_t", &[Some(fill_layout)], Some(premul), depth(true, Less), false);
        let image =
            make("image", &image_layout, &scene_module, "image_vs", "image_fs", &[Some(image_vlayout)], Some(premul), depth(true, Less), false);
        let quad = make("quad", &quad_layout, &quad_module, "quad_vs", "quad_fs", &[], Some(premul), depth(false, Always), false);
        let down = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("downsample"),
            layout: Some(&quad_layout),
            vertex: wgpu::VertexState {
                module: &quad_module,
                entry_point: Some("quad_vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleList, ..Default::default() },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &quad_module,
                entry_point: Some("quad_fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend: None, write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("linear"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let limits = device.limits();
        let align = limits.min_uniform_buffer_offset_alignment.max(UNIFORM_SIZE as u32) as u64;
        let uniforms = Self::uniform_buffer(device, align * 64);
        let uniform_group = Self::uniform_group(device, &uniform_bgl, &uniforms);
        let down_uniforms = Self::uniform_buffer(device, align);
        let down_group = Self::uniform_group(device, &uniform_bgl, &down_uniforms);
        let white = Self::texture_with(device, queue, &tex_bgl, &sampler, 1, 1, &[255, 255, 255, 255], false);
        Renderer {
            sample_count,
            uniform_bgl,
            scene_bgl,
            tex_bgl,
            stroke,
            stroke_t,
            fill,
            fill_t,
            image,
            quad,
            down,
            down_uniforms,
            down_group,
            sampler,
            uniforms,
            uniform_group,
            align,
            max_binding: limits.max_storage_buffer_binding_size as u64,
            max_buffer: limits.max_buffer_size,
            white,
        }
    }

    fn uniform_buffer(device: &wgpu::Device, size: u64) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniforms"),
            size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    fn uniform_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, buffer: &wgpu::Buffer) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("uniforms"),
            layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(UNIFORM_SIZE),
                }),
            }],
        })
    }

    /// Draws a scene through `transform` (page space to the tile's pixels) into a new tile:
    /// at `ss` times the resolution with hairlines `ss` pixels wide, then box-filtered down, so the
    /// tile matches an antialiased render at `scale` (PDFium's, within the fidelity check's
    /// limits). Submits its own work. `scratch` keeps the large target between calls.
    pub fn render_tile(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        scene: &GpuScene,
        transform: Affine2,
        size: [u32; 2],
        ss: u32,
        thin: bool,
        scratch: &mut Option<Target>,
    ) -> GpuTexture {
        let ss = ss.max(1);
        let (bw, bh) = (size[0] * ss, size[1] * ss);
        if scratch.as_ref().is_none_or(|t| t.width < bw || t.height < bh) {
            *scratch = Some(Target::new(device, bw.max(size[0]), bh.max(size[1]), self.sample_count));
        }
        let big = scratch.as_ref().unwrap();
        let f = ss as f32;
        let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("tile") });
        self.draw(
            device,
            queue,
            &mut enc,
            big,
            wgpu::Color::WHITE,
            &[Draw::Scene {
                scene,
                transform: transform.map(|v| v * f),
                clip: [0.0, 0.0, bw as f32, bh as f32],
                alpha: 1.0,
                thin,
                hairline: f,
            }],
        );
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("tile"),
            size: wgpu::Extent3d { width: size[0], height: size[1], depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let u = QuadUniform {
            dest: [0.0, 0.0, size[0] as f32, size[1] as f32],
            // Only the drawn part of the (possibly larger) scratch target.
            uv: [0.0, 0.0, bw as f32 / big.width as f32, bh as f32 / big.height as f32],
            target_size: [size[0] as f32, size[1] as f32],
            opacity: 1.0,
            flags: 0,
            ..Default::default()
        };
        queue.write_buffer(&self.down_uniforms, 0, bytemuck::bytes_of(&u));
        let src = self.tex_group(device, &big.view);
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("downsample"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::WHITE), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.down);
            pass.set_bind_group(0, &self.down_group, &[0]);
            pass.set_bind_group(1, &src, &[]);
            pass.draw(0..6, 0..1);
        }
        queue.submit([enc.finish()]);
        let bind_group = self.tex_group(device, &view);
        GpuTexture { texture, view, bind_group, width: size[0], height: size[1] }
    }

    /// A white 1 × 1 texture (page backgrounds).
    pub fn white(&self) -> &GpuTexture {
        &self.white
    }

    /// Uploads RGBA pixels as a texture (raster tiles, thumbnails).
    pub fn texture(&self, device: &wgpu::Device, queue: &wgpu::Queue, width: u32, height: u32, rgba: &[u8]) -> GpuTexture {
        Self::texture_with(device, queue, &self.tex_bgl, &self.sampler, width, height, rgba, false)
    }

    /// Wraps a target's resolved texture so it can be drawn as a quad (overview tiles).
    pub fn texture_from_target(&self, device: &wgpu::Device, target: Target) -> GpuTexture {
        let bind_group = self.tex_group(device, &target.view);
        GpuTexture { bind_group, width: target.width, height: target.height, texture: target.texture, view: target.view }
    }

    fn tex_group(&self, device: &wgpu::Device, view: &wgpu::TextureView) -> wgpu::BindGroup {
        tex_group(device, &self.tex_bgl, &self.sampler, view)
    }

    fn texture_with(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        layout: &wgpu::BindGroupLayout,
        sampler: &wgpu::Sampler,
        width: u32,
        height: u32,
        rgba: &[u8],
        mips: bool,
    ) -> GpuTexture {
        let levels = if mips { mip_chain(width, height, rgba) } else { vec![(width, height, rgba.to_vec())] };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("texture"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: levels.len() as u32,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        for (level, (w, h, px)) in levels.iter().enumerate() {
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: level as u32,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                px,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 4), rows_per_image: Some(*h) },
                wgpu::Extent3d { width: *w, height: *h, depth_or_array_layers: 1 },
            );
        }
        let view = texture.create_view(&Default::default());
        let bind_group = tex_group(device, layout, sampler, &view);
        GpuTexture { texture, view, bind_group, width, height }
    }

    /// Uploads a scene. Fails when a buffer would exceed the device's limits (the caller then
    /// draws the page with the raster path).
    pub fn upload(&self, device: &wgpu::Device, queue: &wgpu::Queue, scene: &Scene) -> anyhow::Result<GpuScene> {
        let mut bytes = 0u64;
        let mut buffer = |label: &str, data: &[u8], usage: wgpu::BufferUsages| -> anyhow::Result<wgpu::Buffer> {
            // Bindings and vertex buffers may not be empty.
            let padded;
            let data = if data.len() < 16 {
                padded = [data, &[0u8; 16][..16 - data.len()]].concat();
                &padded[..]
            } else {
                data
            };
            if data.len() as u64 > self.max_buffer {
                anyhow::bail!("{label} needs {} bytes; the GPU allows {}", data.len(), self.max_buffer);
            }
            bytes += data.len() as u64;
            Ok(device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents: data, usage }))
        };
        let storage_usage = wgpu::BufferUsages::STORAGE;
        let items = buffer("items", bytemuck::cast_slice(&scene.items), storage_usage)?;
        let mut layer_bits = vec![u32::MAX; scene.layers.len().div_ceil(32).max(1)];
        for &l in &scene.layers_off {
            if let Some(w) = layer_bits.get_mut(l as usize / 32) {
                *w &= !(1 << (l % 32));
            }
        }
        let layers = buffer("layers", bytemuck::cast_slice(&layer_bits), storage_usage | wgpu::BufferUsages::COPY_DST)?;
        let per_chunk = (self.max_binding.min(self.max_buffer) / size_of::<StrokeSeg>() as u64).max(1) as usize;
        let mut chunks = |segs: &[StrokeSeg], label: &str| -> anyhow::Result<Vec<SegChunk>> {
            let mut out = Vec::new();
            let mut start = 0usize;
            loop {
                let end = (start + per_chunk).min(segs.len());
                let buf = buffer(label, bytemuck::cast_slice(&segs[start..end]), storage_usage)?;
                let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some(label),
                    layout: &self.scene_bgl,
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: items.as_entire_binding() },
                        wgpu::BindGroupEntry { binding: 1, resource: layers.as_entire_binding() },
                        wgpu::BindGroupEntry { binding: 2, resource: buf.as_entire_binding() },
                    ],
                });
                out.push(SegChunk { bind_group, range: start as u32..end as u32 });
                start = end;
                if start >= segs.len() {
                    return Ok(out);
                }
            }
        };
        let seg_chunks = chunks(&scene.segs, "segments")?;
        let t_seg_chunks = chunks(&scene.t_segs, "transparent segments")?;
        let base_group = seg_chunks[0].bind_group.clone();
        let vb = wgpu::BufferUsages::VERTEX;
        let ib = wgpu::BufferUsages::INDEX;
        let opt = |v: bool, b: anyhow::Result<wgpu::Buffer>| -> anyhow::Result<Option<wgpu::Buffer>> { if v { b.map(Some) } else { Ok(None) } };
        let fill_vb = opt(!scene.fill_verts.is_empty(), buffer("fill vertices", bytemuck::cast_slice(&scene.fill_verts), vb))?;
        let fill_ib = opt(!scene.fill_idx.is_empty(), buffer("fill indices", bytemuck::cast_slice(&scene.fill_idx), ib))?;
        let t_fill_ib = opt(!scene.t_fill_idx.is_empty(), buffer("transparent fill indices", bytemuck::cast_slice(&scene.t_fill_idx), ib))?;
        let image_vb = opt(!scene.image_verts.is_empty(), buffer("image vertices", bytemuck::cast_slice(&scene.image_verts), vb))?;
        let image_ib = opt(!scene.image_idx.is_empty(), buffer("image indices", bytemuck::cast_slice(&scene.image_idx), ib))?;
        let max_tex = device.limits().max_texture_dimension_2d;
        let images: Vec<GpuTexture> = scene
            .images
            .iter()
            .map(|img: &SceneImage| {
                let fitted;
                let img = if img.width > max_tex || img.height > max_tex {
                    fitted = fit_image(img, max_tex);
                    &fitted
                } else {
                    img
                };
                bytes += img.rgba.len() as u64 * 4 / 3;
                Self::texture_with(device, queue, &self.tex_bgl, &self.sampler, img.width, img.height, &img.rgba, true)
            })
            .collect();
        let reach = scene.items.iter().map(|i| i.width).fold(0.0f32, f32::max) * 0.5 + 0.5;
        Ok(GpuScene {
            size: scene.size,
            cols: scene.cols,
            rows: scene.rows,
            seg_cells: scene.seg_cells.clone(),
            seg_cell_bounds: scene.seg_cell_bounds.clone(),
            fill_cells: scene.fill_cells.clone(),
            fill_cell_bounds: scene.fill_cell_bounds.clone(),
            stream: scene.stream.clone(),
            reach,
            layers,
            layer_bits,
            layer_names: scene.layers.clone(),
            seg_chunks,
            t_seg_chunks,
            base_group,
            fill_vb,
            fill_ib,
            t_fill_ib,
            image_vb,
            image_ib,
            images,
            bytes,
            segments: scene.segs.len() + scene.t_segs.len(),
            triangles: (scene.fill_idx.len() + scene.t_fill_idx.len() + scene.image_idx.len()) / 3,
        })
    }

    /// Draws `draws` into `target`, clearing it to `clear` first.
    pub fn draw(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &Target,
        clear: wgpu::Color,
        draws: &[Draw],
    ) -> DrawStats {
        let mut stats = DrawStats::default();
        let size = [target.width as f32, target.height as f32];
        // One uniform block per draw, at aligned offsets.
        let mut arena: Vec<u8> = Vec::with_capacity(draws.len() * self.align as usize);
        let mut offsets = Vec::with_capacity(draws.len());
        for d in draws {
            offsets.push(arena.len() as u32);
            let block: [u8; UNIFORM_SIZE as usize] = match d {
                Draw::Scene { scene, transform: m, alpha, thin, hairline, .. } => bytemuck::cast(ViewUniform {
                    m: [m[0], m[1], m[2], m[3]],
                    t: [m[4], m[5]],
                    hairline: *hairline,
                    target_size: size,
                    cols: scene.cols,
                    thin: *thin as u32,
                    alpha: *alpha,
                    samples: self.sample_count,
                    scale: affine_scale(m),
                    ..Default::default()
                }),
                Draw::Quad { dest, uv, opacity, straight, filter, .. } => bytemuck::cast(QuadUniform {
                    dest: *dest,
                    uv: *uv,
                    target_size: size,
                    opacity: *opacity,
                    flags: *straight as u32
                        | match filter {
                            PageFilter::None => 0,
                            PageFilter::Dark => 2,
                            PageFilter::Dim => 4,
                        },
                    ..Default::default()
                }),
            };
            arena.extend_from_slice(&block);
            arena.resize(arena.len().next_multiple_of(self.align as usize), 0);
        }
        if arena.len() as u64 > self.uniforms.size() {
            self.uniforms = Self::uniform_buffer(device, (arena.len() as u64).next_power_of_two());
            self.uniform_group = Self::uniform_group(device, &self.uniform_bgl, &self.uniforms);
        }
        if !arena.is_empty() {
            queue.write_buffer(&self.uniforms, 0, &arena);
        }
        let (view, resolve) = match &target.msaa {
            Some(m) => (m, Some(&target.view)),
            None => (&target.view, None),
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("page"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: resolve,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(clear), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &target.depth,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        for (d, &off) in draws.iter().zip(&offsets) {
            match d {
                Draw::Quad { texture, .. } => {
                    pass.set_scissor_rect(0, 0, target.width, target.height);
                    pass.set_pipeline(&self.quad);
                    pass.set_bind_group(0, &self.uniform_group, &[off]);
                    pass.set_bind_group(1, &texture.bind_group, &[]);
                    pass.draw(0..6, 0..1);
                    stats.draw_calls += 1;
                }
                Draw::Scene { scene, transform, clip, .. } => {
                    let Some(sc) = scissor(*clip, target.width, target.height) else { continue };
                    let Some(inv) = affine_invert(transform) else { continue };
                    pass.set_scissor_rect(sc[0], sc[1], sc[2], sc[3]);
                    // The part of the page the scissor shows, in page space.
                    let (x0, y0, x1, y1) = (sc[0] as f32, sc[1] as f32, (sc[0] + sc[2]) as f32, (sc[1] + sc[3]) as f32);
                    let corners = [affine_apply(&inv, x0, y0), affine_apply(&inv, x1, y0), affine_apply(&inv, x0, y1), affine_apply(&inv, x1, y1)];
                    let r = rc_scene::clip::bounds(corners);
                    self.draw_scene(&mut pass, scene, off, r, 2.0 / affine_scale(transform).max(1e-6), &mut stats);
                }
            }
        }
        stats
    }

    fn draw_scene(&self, pass: &mut wgpu::RenderPass, scene: &GpuScene, off: u32, r: Rect, px: f32, stats: &mut DrawStats) {
        pass.set_bind_group(0, &self.uniform_group, &[off]);
        // Opaque strokes: runs of consecutive visible cells are contiguous in the buffer.
        let m = scene.reach + px;
        let reach = [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
        let seg_ranges = visible_ranges(&scene.seg_cells, &scene.seg_cell_bounds, reach);
        if !seg_ranges.is_empty() {
            pass.set_pipeline(&self.stroke);
            for range in &seg_ranges {
                stats.segments += (range.end - range.start) as u64;
                for c in &scene.seg_chunks {
                    let a = range.start.max(c.range.start);
                    let b = range.end.min(c.range.end);
                    if a < b {
                        pass.set_bind_group(1, &c.bind_group, &[]);
                        pass.draw(0..6, a - c.range.start..b - c.range.start);
                        stats.draw_calls += 1;
                    }
                }
            }
        }
        // Opaque fills.
        if let (Some(vb), Some(ib)) = (&scene.fill_vb, &scene.fill_ib) {
            let ranges = visible_ranges(&scene.fill_cells, &scene.fill_cell_bounds, [r[0] - px, r[1] - px, r[2] + px, r[3] + px]);
            if !ranges.is_empty() {
                pass.set_pipeline(&self.fill);
                pass.set_bind_group(1, &scene.base_group, &[]);
                pass.set_vertex_buffer(0, vb.slice(..));
                pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                for range in ranges {
                    stats.triangles += ((range.end - range.start) / 3) as u64;
                    pass.draw_indexed(range, 0, 0..1);
                    stats.draw_calls += 1;
                }
            }
        }
        // Transparent geometry and images, in paint order.
        for e in &scene.stream {
            if !rc_scene::clip::rect_overlaps(e.bounds, reach) {
                continue;
            }
            match e.kind {
                stream::STROKES => {
                    pass.set_pipeline(&self.stroke_t);
                    for c in &scene.t_seg_chunks {
                        let a = e.start.max(c.range.start);
                        let b = (e.start + e.count).min(c.range.end);
                        if a < b {
                            pass.set_bind_group(1, &c.bind_group, &[]);
                            pass.draw(0..6, a - c.range.start..b - c.range.start);
                            stats.draw_calls += 1;
                        }
                    }
                    stats.segments += e.count as u64;
                }
                stream::FILLS => {
                    let (Some(vb), Some(ib)) = (&scene.fill_vb, &scene.t_fill_ib) else { continue };
                    pass.set_pipeline(&self.fill_t);
                    pass.set_bind_group(1, &scene.base_group, &[]);
                    pass.set_vertex_buffer(0, vb.slice(..));
                    pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(e.start..e.start + e.count, 0, 0..1);
                    stats.triangles += (e.count / 3) as u64;
                    stats.draw_calls += 1;
                }
                _ => {
                    let (Some(vb), Some(ib), Some(tex)) = (&scene.image_vb, &scene.image_ib, scene.images.get(e.image as usize)) else {
                        continue;
                    };
                    pass.set_pipeline(&self.image);
                    pass.set_bind_group(1, &scene.base_group, &[]);
                    pass.set_bind_group(2, &tex.bind_group, &[]);
                    pass.set_vertex_buffer(0, vb.slice(..));
                    pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(e.start..e.start + e.count, 0, 0..1);
                    stats.triangles += (e.count / 3) as u64;
                    stats.draw_calls += 1;
                }
            }
        }
    }
}

fn tex_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, sampler: &wgpu::Sampler, view: &wgpu::TextureView) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("texture"),
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    })
}

/// Index ranges of cells whose bounds overlap `r`, with neighbouring ranges merged.
fn visible_ranges(cells: &[[u32; 2]], bounds: &[Rect], r: Rect) -> Vec<Range<u32>> {
    let mut out: Vec<Range<u32>> = Vec::new();
    for (i, &[start, count]) in cells.iter().enumerate() {
        if count == 0 || !rc_scene::clip::rect_overlaps(bounds[i], r) {
            continue;
        }
        match out.last_mut() {
            Some(last) if last.end == start => last.end = start + count,
            _ => out.push(start..start + count),
        }
    }
    out
}

/// A clip rectangle as a scissor `[x, y, w, h]` inside the target, or None when it is empty.
fn scissor(clip: [f32; 4], w: u32, h: u32) -> Option<[u32; 4]> {
    let x0 = clip[0].floor().clamp(0.0, w as f32) as u32;
    let y0 = clip[1].floor().clamp(0.0, h as f32) as u32;
    let x1 = clip[2].ceil().clamp(0.0, w as f32) as u32;
    let y1 = clip[3].ceil().clamp(0.0, h as f32) as u32;
    (x1 > x0 && y1 > y0).then_some([x0, y0, x1 - x0, y1 - y0])
}

/// Box-filtered mip levels down to 1 × 1.
fn mip_chain(width: u32, height: u32, rgba: &[u8]) -> Vec<(u32, u32, Vec<u8>)> {
    let mut levels = vec![(width, height, rgba.to_vec())];
    while let Some((w, h, px)) = levels.last()
        && (*w > 1 || *h > 1)
    {
        let (w, h) = (*w, *h);
        let nw = (w / 2).max(1);
        let nh = (h / 2).max(1);
        let mut out = vec![0u8; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                for c in 0..4 {
                    let mut acc = 0u32;
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let sx = (2 * x + dx).min(w - 1);
                        let sy = (2 * y + dy).min(h - 1);
                        acc += px[((sy * w + sx) * 4 + c) as usize] as u32;
                    }
                    out[((y * nw + x) * 4 + c) as usize] = (acc / 4) as u8;
                }
            }
        }
        levels.push((nw, nh, out));
    }
    levels
}

fn fit_image(img: &SceneImage, max: u32) -> SceneImage {
    let content = rc_scene::content::Image {
        width: img.width,
        height: img.height,
        rgba: img.rgba.clone(),
        transform: Default::default(),
        opacity: 1.0,
        smooth: img.smooth,
    };
    rc_scene::scene::downsample(&content, img.width, img.height, max)
}
