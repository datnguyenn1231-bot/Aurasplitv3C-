//!HOOK RGB
//!BIND HOOKED
//!DESC Slow zoom-in effect (Ken Burns, GPU equivalent of FFmpeg zoompan)

vec4 hook() {
    // 'frame' is the frame counter provided by libplacebo
    // Zoom increases slowly per frame: 0.0005 per frame (matches FFmpeg zoompan)
    // Max zoom configurable (default 1.05 = 5% zoom)
    float maxZoom = 1.050;
    float zoomRate = 0.0005;
    float zoom = min(1.0 + float(frame) * zoomRate, maxZoom);

    // Center the zoom
    vec2 center = vec2(0.5, 0.5);
    vec2 uv = gl_FragCoord.xy / input_size;

    // Apply zoom: scale coordinates around center
    vec2 zoomed = (uv - center) / zoom + center;

    // Clamp to valid range
    if (zoomed.x < 0.0 || zoomed.x > 1.0 || zoomed.y < 0.0 || zoomed.y > 1.0)
        return vec4(0.0, 0.0, 0.0, 1.0);

    return HOOKED_tex(zoomed);
}
