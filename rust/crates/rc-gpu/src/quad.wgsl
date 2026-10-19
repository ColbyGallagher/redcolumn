// Textured quads: raster tiles, pyramid tiles, overlays, page backgrounds.

@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct Quad {
    // Destination rectangle in target pixels, and the texture coordinates it shows.
    dest: vec4<f32>,
    uv: vec4<f32>,
    target_size: vec2<f32>,
    opacity: f32,
    // Bit 0: the texture holds straight alpha (PDFium output) and is premultiplied here.
    // Bits 1-2: page filter (1 dark mode: inverted with hues kept; 2 dimmed).
    flags: u32,
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
    if ((quad.flags & 1u) != 0u) {
        c = vec4<f32>(c.rgb * c.a, c.a);
    }
    let page_filter = (quad.flags >> 1u) & 3u;
    if (page_filter == 1u) {
        // invert(1) hue-rotate(180deg), as the current app's dark mode: on premultiplied colour.
        let inv = vec3<f32>(c.a) - c.rgb;
        let m = mat3x3<f32>(
            vec3<f32>(-0.574, 0.426, 0.426),
            vec3<f32>(1.430, 0.430, 1.430),
            vec3<f32>(0.144, 0.144, -0.856),
        );
        c = vec4<f32>(clamp(m * inv, vec3<f32>(0.0), vec3<f32>(c.a)), c.a);
    } else if (page_filter == 2u) {
        c = vec4<f32>(c.rgb * 0.65, c.a);
    }
    return c * quad.opacity;
}
