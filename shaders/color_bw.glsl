//!HOOK RGB
//!BIND HOOKED
//!DESC Black & White grading (GPU equivalent of FFmpeg bw preset)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);

    // hue=s=0 (desaturate completely)
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = vec3(luma);

    // eq=contrast=1.20:brightness=0.05
    c.rgb += 0.05;
    c.rgb = (c.rgb - 0.5) * 1.20 + 0.5;

    // curves: slight shadow lift + highlight pull (0/0.05 0.5/0.5 1/0.95)
    c.rgb = 0.05 + c.rgb * 0.90;

    // unsharp=7:7:1.2 (strong sharpen for B&W)
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
    c.rgb += (c.rgb - blur.rgb) * 1.2;

    // noise=alls=2 (subtle film grain for B&W aesthetic)
    vec2 pos = gl_FragCoord.xy;
    float seed = random + dot(pos, vec2(12.9898, 78.233));
    float noise = fract(sin(seed) * 43758.5453) - 0.5;
    c.rgb += vec3(noise * 0.008);

    return clamp(c, 0.0, 1.0);
}
