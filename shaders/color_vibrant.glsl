//!HOOK RGB
//!BIND HOOKED
//!DESC Vibrant color grading (GPU equivalent of FFmpeg vibrant preset)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);

    // === eq=brightness=0.06:contrast=1.12:saturation=1.45 ===
    // Matches FFmpeg getColorGradingFilter('vibrant') in reup-filters.ts

    // Brightness
    c.rgb += 0.06;

    // Contrast
    c.rgb = (c.rgb - 0.5) * 1.12 + 0.5;

    // Saturation
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(luma), c.rgb, 1.45);

    return clamp(c, 0.0, 1.0);
}
