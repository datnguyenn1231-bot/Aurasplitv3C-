//!HOOK RGB
//!BIND HOOKED
//!DESC Pixel enlarge effect (GPU equivalent of FFmpeg scale 3x neighbor + eq boost)

vec4 hook() {
    // Pixelate: snap UV to a grid (simulates 3x upscale with nearest neighbor then 3x down)
    vec2 uv = gl_FragCoord.xy / input_size;
    float pixelSize = 3.0;
    vec2 snapped = floor(uv * input_size / pixelSize) * pixelSize / input_size;

    vec4 c = HOOKED_tex(snapped);

    // === eq=contrast=1.12:brightness=0.04 ===
    // Post-pixelate contrast/brightness boost to match CSS intensity
    c.rgb += 0.04;
    c.rgb = (c.rgb - 0.5) * 1.12 + 0.5;

    return clamp(c, 0.0, 1.0);
}
