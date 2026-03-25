//!HOOK RGB
//!BIND HOOKED
//!DESC Glow/Bloom effect (GPU equivalent of FFmpeg eq+colorbalance+unsharp)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);

    // === eq=brightness=0.08:contrast=1.05 ===
    c.rgb += 0.08;
    c.rgb = (c.rgb - 0.5) * 1.05 + 0.5;

    // === colorbalance=rm=0.04:gm=0.02:bm=-0.02 ===
    // Midtone color balance: warm glow tint
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    // Weight towards midtones (not shadows/highlights)
    float midWeight = 1.0 - abs(luma - 0.5) * 2.0;
    midWeight = max(midWeight, 0.0);
    c.r += 0.04 * midWeight;
    c.g += 0.02 * midWeight;
    c.b -= 0.02 * midWeight;

    // === unsharp=7:7:0.6:7:7:0.0 (local contrast) ===
    vec4 blur = vec4(0.0);
    float w = 0.0;
    for (int x = -3; x <= 3; x++) {
        for (int y = -3; y <= 3; y++) {
            float g = exp(-float(x*x + y*y) / 8.0);
            blur += HOOKED_texOff(vec2(float(x), float(y))) * g;
            w += g;
        }
    }
    blur /= w;

    // Sharpen with amount=0.6
    c.rgb += (c.rgb - blur.rgb) * 0.6;

    return clamp(c, 0.0, 1.0);
}
