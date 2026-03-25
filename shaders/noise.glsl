//!HOOK RGB
//!BIND HOOKED
//!DESC Add film grain noise (GPU equivalent of FFmpeg noise=alls=N:allf=t+u)

vec4 hook() {
    vec4 color = HOOKED_texOff(0);

    // Generate per-pixel noise using position + frame random
    // 'random' is a per-frame pseudo-random [0,1) provided by libplacebo
    vec2 pos = gl_FragCoord.xy;
    float seed = random + dot(pos, vec2(12.9898, 78.233));
    float noise = fract(sin(seed) * 43758.5453) - 0.5;

    // Intensity: 10/255 ≈ 0.039 (matches FFmpeg noise=alls=10)
    float intensity = 0.039;
    color.rgb += vec3(noise * intensity);

    return clamp(color, 0.0, 1.0);
}
