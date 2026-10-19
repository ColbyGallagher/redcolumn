// redcolumn's page renderer. Everything is drawn in device pixels of the target, with depth for
// paint order (later parts of the page are nearer). See rc-scene's scene module for the data.

struct View {
    // Device pixels per point on each axis (PDFium rounds the page's pixel size, so its scale
    // can differ slightly between x and y; matching it keeps the scene aligned with its tiles).
    scale: vec2<f32>,
    // Where the page's origin is in the target (pixels), and the target's size.
    offset: vec2<f32>,
    target_size: vec2<f32>,
    // The thinnest a stroke is drawn, in pixels (hairlines).
    hairline: f32,
    cols: u32,
    // Non-zero: draw every stroke as a hairline (Disable Line Weights).
    thin: u32,
    // Multiplies every colour's alpha (fading a page in).
    alpha: f32,
    // MSAA samples per pixel (stroke coverage is written as a sample mask).
    samples: u32,
    _pad: f32,
};

struct Item {
    color: u32,
    width: f32,
    depth: f32,
    layer: u32,
};

@group(0) @binding(0) var<uniform> view: View;

@group(1) @binding(0) var<storage, read> items: array<Item>;
@group(1) @binding(1) var<storage, read> layers: array<u32>;
@group(1) @binding(2) var<storage, read> segs: array<vec4<u32>>;

@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var samp: sampler;

const CELL: f32 = 128.0;
const QUANT: f32 = 256.0;
const NOWHERE: vec4<f32> = vec4<f32>(2.0, 2.0, 2.0, 1.0);

fn unpack_rgba(c: u32) -> vec4<f32> {
    return vec4<f32>(f32(c & 255u), f32((c >> 8u) & 255u), f32((c >> 16u) & 255u), f32(c >> 24u)) / 255.0;
}

fn layer_visible(layer: u32) -> bool {
    if (layer == 0xffffffffu) {
        return true;
    }
    return ((layers[layer >> 5u] >> (layer & 31u)) & 1u) == 1u;
}

fn to_clip(px: vec2<f32>, depth: f32) -> vec4<f32> {
    let n = px / view.target_size * 2.0 - 1.0;
    return vec4<f32>(n.x, -n.y, depth, 1.0);
}

fn cell_center(cell: u32) -> vec2<f32> {
    let cx = cell % view.cols;
    let cy = cell / view.cols;
    return (vec2<f32>(f32(cx), f32(cy)) + 0.5) * CELL;
}

fn unpack_point(v: u32) -> vec2<f32> {
    let x = i32(v << 16u) >> 16u;
    let y = i32(v) >> 16u;
    return vec2<f32>(f32(x), f32(y)) / QUANT;
}

// ---- Strokes: one quad per segment, widened in the vertex shader ----

struct StrokeOut {
    @builtin(position) pos: vec4<f32>,
    // Position along the segment from its start, and across it from its centre line (pixels).
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) color: vec4<f32>,
    // Half width, length, start cap, end cap (0 butt, 1 round, 2 square).
    @location(2) @interpolate(flat) info: vec4<f32>,
    // Which samples this segment's partial coverage starts at, and the pixel's half footprint
    // across the line (wider for diagonal lines).
    @location(3) @interpolate(flat) rot_foot: vec2<u32>,
};

@vertex
fn stroke_vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> StrokeOut {
    var out: StrokeOut;
    let s = segs[ii];
    let item = items[s.w];
    if (!layer_visible(item.layer)) {
        out.pos = NOWHERE;
        return out;
    }
    let cell = s.z & 0xffffu;
    let flags = s.z >> 16u;
    let c = cell_center(cell);
    let a = (c + unpack_point(s.x)) * view.scale + view.offset;
    let b = (c + unpack_point(s.y)) * view.scale + view.offset;
    var w = item.width * 0.5 * (view.scale.x + view.scale.y);
    if (view.thin != 0u) {
        w = 0.0;
    }
    w = max(w, view.hairline);
    let hw = w * 0.5;
    let d = b - a;
    let len = length(d);
    var dir = vec2<f32>(1.0, 0.0);
    if (len > 1e-6) {
        dir = d / len;
    }
    let nrm = vec2<f32>(-dir.y, dir.x);
    let cap0 = flags & 3u;
    let cap1 = (flags >> 2u) & 3u;
    // One pixel of margin all round, so partly covered pixels get their exact coverage.
    let e0 = select(0.0, hw, cap0 != 0u) + 1.0;
    let e1 = select(0.0, hw, cap1 != 0u) + 1.0;
    var corner = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);
    let k = corner[vi];
    let along = select(-e0, len + e1, (k & 1u) == 1u);
    let across = select(-hw - 1.0, hw + 1.0, k >= 2u);
    out.pos = to_clip(a + dir * along + nrm * across, item.depth);
    out.local = vec2<f32>(along, across);
    var col = unpack_rgba(item.color);
    col.a = col.a * view.alpha;
    out.color = col;
    out.info = vec4<f32>(hw, len, f32(cap0), f32(cap1));
    // Footprint: a pixel seen across a line at angle t spans |cos t| + |sin t| (in half units).
    let foot = 0.5 * (abs(dir.x) + abs(dir.y));
    out.rot_foot = vec2<u32>((ii * 2654435761u) >> 16u, bitcast<u32>(foot));
    return out;
}

// Pixel coverage of the stroke: a box filter across the line and along it (butt and square
// ends), and a distance field for round ends.
fn stroke_coverage(in: StrokeOut) -> f32 {
    let hw = in.info.x;
    let len = in.info.y;
    let x = in.local.x;
    let d = in.local.y;
    if (x < 0.0 && in.info.z == 1.0) {
        return clamp(hw - length(in.local) + 0.5, 0.0, 1.0);
    }
    if (x > len && in.info.w == 1.0) {
        return clamp(hw - length(in.local - vec2<f32>(len, 0.0)) + 0.5, 0.0, 1.0);
    }
    let start = select(0.0, -hw, in.info.z == 2.0);
    let end = select(len, len + hw, in.info.w == 2.0);
    let f = bitcast<f32>(in.rot_foot.y);
    let across = clamp((min(hw, d + f) - max(-hw, d - f)) / (2.0 * f), 0.0, 1.0);
    let along = clamp(min(end, x + 0.5) - max(start, x - 0.5), 0.0, 1.0);
    return across * along;
}

struct MaskedOut {
    @location(0) color: vec4<f32>,
    @builtin(sample_mask) mask: u32,
};

// Opaque: the coverage becomes that many of the pixel's samples, starting at a sample chosen per
// segment. Overlapping thin lines then cover different samples and add up, as they do when PDFium
// rasterises them, instead of all darkening the same ones.
@fragment
fn stroke_fs(in: StrokeOut) -> MaskedOut {
    let cov = stroke_coverage(in);
    let n = view.samples;
    var out: MaskedOut;
    out.color = vec4<f32>(in.color.rgb, 1.0);
    if (n <= 1u) {
        if (cov < 0.5) {
            discard;
        }
        out.mask = 1u;
        return out;
    }
    let k = u32(round(cov * f32(n)));
    if (k == 0u) {
        discard;
    }
    let full = (1u << n) - 1u;
    let bits = (1u << k) - 1u;
    let r = in.rot_foot.x % n;
    out.mask = ((bits << r) | (bits >> (n - r))) & full;
    return out;
}

// Transparent: premultiplied, blended over what is below.
@fragment
fn stroke_fs_t(in: StrokeOut) -> @location(0) vec4<f32> {
    let a = in.color.a * stroke_coverage(in);
    if (a <= 0.0) {
        discard;
    }
    return vec4<f32>(in.color.rgb * a, a);
}

// ---- Fills: triangles in page space ----

struct FillOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) @interpolate(flat) color: vec4<f32>,
};

@vertex
fn fill_vs(@location(0) pos: vec2<f32>, @location(1) item_index: u32) -> FillOut {
    var out: FillOut;
    let item = items[item_index];
    if (!layer_visible(item.layer)) {
        out.pos = NOWHERE;
        return out;
    }
    out.pos = to_clip(pos * view.scale + view.offset, item.depth);
    var col = unpack_rgba(item.color);
    col.a = col.a * view.alpha;
    out.color = col;
    return out;
}

@fragment
fn fill_fs(in: FillOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color.rgb, 1.0);
}

@fragment
fn fill_fs_t(in: FillOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color.rgb * in.color.a, in.color.a);
}

// ---- Images: textured triangles (already clipped), straight alpha in the texture ----

struct ImageOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) alpha: f32,
};

@vertex
fn image_vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>, @location(2) item_index: u32) -> ImageOut {
    var out: ImageOut;
    let item = items[item_index];
    if (!layer_visible(item.layer)) {
        out.pos = NOWHERE;
        return out;
    }
    out.pos = to_clip(pos * view.scale + view.offset, item.depth);
    out.uv = uv;
    out.alpha = unpack_rgba(item.color).a * view.alpha;
    return out;
}

@fragment
fn image_fs(in: ImageOut) -> @location(0) vec4<f32> {
    let c = textureSample(tex, samp, in.uv);
    let a = c.a * in.alpha;
    return vec4<f32>(c.rgb * a, a);
}

