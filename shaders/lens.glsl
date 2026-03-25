//!HOOK RGB
//!BIND HOOKED
//!DESC Barrel lens distortion (GPU equivalent of FFmpeg lenscorrection=cx=0.5:cy=0.5:k1=-0.05:k2=-0.03)

vec4 hook() {
    // Normalized coordinates centered at (0.5, 0.5)
    vec2 uv = gl_FragCoord.xy / input_size;
    vec2 centered = uv - 0.5;

    // Radial distance squared
    float r2 = dot(centered, centered);

    // Barrel distortion coefficients (matching FFmpeg lenscorrection)
    float k1 = -0.05;
    float k2 = -0.03;

    // Apply distortion
    vec2 distorted = centered * (1.0 + k1 * r2 + k2 * r2 * r2) + 0.5;

    // Black for out-of-bounds
    if (distorted.x < 0.0 || distorted.x > 1.0 || distorted.y < 0.0 || distorted.y > 1.0)
        return vec4(0.0, 0.0, 0.0, 1.0);

    return HOOKED_tex(distorted);
}
