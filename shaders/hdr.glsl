//!HOOK RGB
//!BIND HOOKED
//!DESC HDR enhancement + unsharp (GPU equivalent of FFmpeg eq+unsharp)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);

    // === eq=contrast=1.15:saturation=1.20:brightness=0.02 ===

    // Brightness
    c.rgb += 0.02;

    // Contrast
    c.rgb = (c.rgb - 0.5) * 1.15 + 0.5;

    // Saturation
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(luma), c.rgb, 1.20);

    // === unsharp=5:5:0.5:3:3:0.0 (luma sharpening) ===
    // Simple unsharp mask: original + (original - blur) * amount
    vec4 blur = vec4(0.0);
    float w = 0.0;
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            float g = exp(-float(x*x + y*y) / 4.5);
            blur += HOOKED_texOff(vec2(float(x), float(y))) * g;
            w += g;
        }
    }
    blur /= w;

    // Sharpen with amount=0.5
    c.rgb += (c.rgb - blur.rgb) * 0.5;

    return clamp(c, 0.0, 1.0);
}
