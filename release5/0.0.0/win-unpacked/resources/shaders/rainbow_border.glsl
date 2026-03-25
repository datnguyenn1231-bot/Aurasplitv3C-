//!HOOK MAIN
//!BIND HOOKED
//!DESC Rainbow border with glow (GPU equivalent of FFmpeg geq rainbow)

vec4 hook() {
    vec2 pos = HOOKED_pos;
    vec4 color = HOOKED_texOff(vec2(0.0));

    // Distance to nearest edge in pixels
    float px = pos.x * HOOKED_size.x;
    float py = pos.y * HOOKED_size.y;
    float dx = min(px, HOOKED_size.x - px);
    float dy = min(py, HOOKED_size.y - py);
    float dist = min(dx, dy);

    float bw = 8.0;   // solid border width (pixels) — matches FFmpeg bw=8
    float gw = 12.0;  // glow gradient width — matches FFmpeg gw=12
    float tot = bw + gw;

    // Rainbow color cycling using position for spatial variation
    // FFmpeg uses N*0.1 (frame number), here we use pos.x for spatial rainbow
    float phase = pos.x * 6.283 + pos.y * 3.14;
    float cb_color = 0.5 + 0.39 * sin(phase);         // Cb: 128+100*sin → 0.5+0.39
    float cr_color = 0.5 + 0.39 * cos(phase);         // Cr: 128+100*cos → 0.5+0.39

    // Convert Cb/Cr to RGB offset (BT.709 YCbCr → RGB)
    vec3 borderRGB = vec3(
        1.5748 * (cr_color - 0.5),
        -0.1873 * (cb_color - 0.5) - 0.4681 * (cr_color - 0.5),
        1.8556 * (cb_color - 0.5)
    );

    if (dist < bw) {
        // Solid border zone: FFmpeg lum=200 → Y=200/255≈0.784
        color.rgb = vec3(0.784) + borderRGB;
    } else if (dist < tot) {
        // Glow gradient: FFmpeg lum+=40*(tot-d)/gw, cb/cr blend
        float blend = (tot - dist) / gw;
        // Brightness boost matching FFmpeg: +40/255 * blend ≈ +0.157 * blend
        color.rgb += vec3(0.157 * blend);
        // Color bleed from border
        color.rgb += borderRGB * blend * 0.4;
    }

    return clamp(color, 0.0, 1.0);
}
