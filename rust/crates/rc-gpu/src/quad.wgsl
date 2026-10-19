// Textured quads: raster tiles, pyramid tiles, overlays, page backgrounds.

@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct Quad {
    // Destination rectangle in target pixels, and the texture coordinates it shows.
    dest: vec4<f32>,
    uv: vec4<f32>,
    target_size: vec2<f32>,
    opacity: f32,
    // Non-zero: the texture holds straight alpha (PDFium output) and is premultiplied here.
    straight: u32,
};

@group(0) @binding(0) var<uniform> quad: Quad;

struct QuadOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn quad_vs(@builtin(vertex_index) vi: u32) -> QuadOut {
    var corner = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    );
    let t = corner[vi];
    let px = mix(quad.dest.xy, quad.dest.zw, t);
    let n = px / quad.target_size * 2.0 - 1.0;
    var out: QuadOut;
    // Farthest depth: quads sit under any scene geometry drawn after them.
    out.pos = vec4<f32>(n.x, -n.y, 1.0, 1.0);
    out.uv = mix(quad.uv.xy, quad.uv.zw, t);
    return out;
}

@fragment
fn quad_fs(in: QuadOut) -> @location(0) vec4<f32> {
    var c = textureSample(tex, samp, in.uv);
    if (quad.straight != 0u) {
        c = vec4<f32>(c.rgb * c.a, c.a);
    }
    return c * quad.opacity;
}
