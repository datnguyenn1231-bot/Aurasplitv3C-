//!HOOK RGB
//!BIND HOOKED
//!DESC Subtle rotation (GPU equivalent of FFmpeg rotate=rad:c=none)

vec4 hook() {
    // Rotation angle in radians (~2 degrees = 0.0349)
    float angle = 0.0349;

    vec2 center = input_size * 0.5;
    vec2 pos = gl_FragCoord.xy - center;

    float c = cos(angle);
    float s = sin(angle);
    vec2 rotated = vec2(pos.x * c - pos.y * s, pos.x * s + pos.y * c);
    vec2 uv = (rotated + center) / input_size;

    // c=none: show transparent/black for out-of-bounds pixels
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        return vec4(0.0, 0.0, 0.0, 1.0);

    return HOOKED_tex(uv);
}
